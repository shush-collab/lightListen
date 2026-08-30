"""Admin: security matrix + novel/volume/chapter pipeline + media."""
import uuid
import requests
from conftest import API, ADMIN_KEY


ADMIN_PATHS = [
    ("GET", "/admin/novels"),
    ("GET", "/admin/requests/community"),
    ("GET", "/admin/users"),
]


class TestAdminSecurity:
    def test_admin_no_jwt_returns_401(self, api_client):
        # No auth at all => 401 (bearer missing)
        r = api_client.get(f"{API}/admin/novels")
        assert r.status_code == 401, r.text

    def test_admin_no_admin_key_403(self, api_client, reader_headers):
        # Regular user JWT, no X-Admin-Key => 403
        h = dict(reader_headers)
        r = requests.get(f"{API}/admin/novels", headers=h)
        assert r.status_code == 403, r.text

    def test_admin_wrong_admin_key_403(self, api_client, reader_headers):
        h = dict(reader_headers)
        h["X-Admin-Key"] = "wrong-key"
        r = requests.get(f"{API}/admin/novels", headers=h)
        assert r.status_code == 403, r.text

    def test_admin_non_admin_role_403(self, api_client, reader_headers):
        # Regular user JWT + correct X-Admin-Key => 403 (role not admin)
        h = dict(reader_headers)
        h["X-Admin-Key"] = ADMIN_KEY
        r = requests.get(f"{API}/admin/novels", headers=h)
        assert r.status_code == 403, r.text

    def test_admin_full_auth_200(self, api_client, admin_headers):
        r = requests.get(f"{API}/admin/novels", headers=admin_headers)
        assert r.status_code == 200


class TestAdminContentPipeline:
    def test_full_pipeline_create_publish_appears_in_public(self, api_client, admin_headers):
        # Create novel
        title = f"TEST_AdminNovel_{uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{API}/admin/novels",
            json={"title": title, "author": "Tester", "description": "d", "genres": ["Test"]},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        novel_id = r.json()["id"]

        # Novel starts as draft -> not in public list
        pub = api_client.get(f"{API}/novels?q={title}").json()
        assert all(n["id"] != novel_id for n in pub)

        # Create volume
        vr = requests.post(
            f"{API}/admin/novels/{novel_id}/volumes",
            json={"volume_number": 1},
            headers=admin_headers,
        )
        assert vr.status_code == 201, vr.text
        volume_id = vr.json()["id"]

        # Create chapter via audio_url (multipart form)
        # Must remove Content-Type: application/json for multipart
        h = {k: v for k, v in admin_headers.items() if k.lower() != "content-type"}
        cr = requests.post(
            f"{API}/admin/volumes/{volume_id}/chapters",
            data={
                "chapter_number": 1,
                "title": "Test Chapter",
                "duration_seconds": 100,
                "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
            },
            headers=h,
        )
        assert cr.status_code == 201, cr.text
        chapter_id = cr.json()["id"]

        # Publish
        pubr = requests.put(f"{API}/admin/novels/{novel_id}/publish", headers=admin_headers)
        assert pubr.status_code == 200
        assert pubr.json()["status"] == "published"

        # Now appears in public list
        pub = api_client.get(f"{API}/novels?q={title}").json()
        ids = [n["id"] for n in pub]
        assert novel_id in ids

        # Update chapter
        upd = requests.put(
            f"{API}/admin/chapters/{chapter_id}",
            json={"title": "Test Chapter Renamed", "duration_seconds": 200},
            headers=admin_headers,
        )
        assert upd.status_code == 200
        assert upd.json()["title"] == "Test Chapter Renamed"

        # Unpublish -> disappears from public list
        unp = requests.put(f"{API}/admin/novels/{novel_id}/unpublish", headers=admin_headers)
        assert unp.status_code == 200
        assert unp.json()["status"] == "draft"
        pub = api_client.get(f"{API}/novels?q={title}").json()
        assert all(n["id"] != novel_id for n in pub)

        # Edit novel
        edit = requests.put(
            f"{API}/admin/novels/{novel_id}",
            json={"title": title + "_edited"},
            headers=admin_headers,
        )
        assert edit.status_code == 200
        assert edit.json()["title"].endswith("_edited")

        # Delete chapter cascade OK
        d = requests.delete(f"{API}/admin/chapters/{chapter_id}", headers=admin_headers)
        assert d.status_code == 200
        # Delete volume
        dv = requests.delete(f"{API}/admin/volumes/{volume_id}", headers=admin_headers)
        assert dv.status_code == 200
        # Delete novel
        dn = requests.delete(f"{API}/admin/novels/{novel_id}", headers=admin_headers)
        assert dn.status_code == 200

    def test_chapter_without_audio_400(self, api_client, admin_headers):
        # Prepare a temporary novel+volume
        title = f"TEST_NoAudio_{uuid.uuid4().hex[:6]}"
        nr = requests.post(
            f"{API}/admin/novels",
            json={"title": title, "author": "T"},
            headers=admin_headers,
        )
        novel_id = nr.json()["id"]
        vr = requests.post(
            f"{API}/admin/novels/{novel_id}/volumes",
            json={"volume_number": 1},
            headers=admin_headers,
        )
        volume_id = vr.json()["id"]
        h = {k: v for k, v in admin_headers.items() if k.lower() != "content-type"}
        cr = requests.post(
            f"{API}/admin/volumes/{volume_id}/chapters",
            data={"chapter_number": 1, "title": "no audio", "duration_seconds": 10},
            headers=h,
        )
        assert cr.status_code == 400, cr.text
        # Cleanup
        requests.delete(f"{API}/admin/novels/{novel_id}", headers=admin_headers)

    def test_admin_users_list_and_detail(self, api_client, admin_headers):
        r = requests.get(f"{API}/admin/users", headers=admin_headers)
        assert r.status_code == 200
        users = r.json()
        assert len(users) >= 1

        # Search
        r2 = requests.get(f"{API}/admin/users?q=admin", headers=admin_headers)
        assert r2.status_code == 200
        emails = [u["email"] for u in r2.json()]
        assert any("admin" in e for e in emails)

        # Detail
        uid = users[0]["id"]
        r3 = requests.get(f"{API}/admin/users/{uid}", headers=admin_headers)
        assert r3.status_code == 200
        data = r3.json()
        assert "subscription" in data
        assert data["subscription"]["plan"] == "free"

    def test_admin_requests_community(self, api_client, admin_headers, reader_headers):
        # Create a community request as reader
        title = f"TEST_AdminReq_{uuid.uuid4().hex[:8]}"
        requests.post(f"{API}/requests", json={"title": title}, headers=reader_headers)

        r = requests.get(f"{API}/admin/requests/community", headers=admin_headers)
        assert r.status_code == 200
        found = next((d for d in r.json() if d["title"] == title), None)
        assert found is not None
        rid = found["id"]

        # Update status
        upd = requests.put(
            f"{API}/admin/requests/community/{rid}",
            json={"status": "selected", "genres": ["Fantasy"]},
            headers=admin_headers,
        )
        assert upd.status_code == 200
        assert upd.json()["status"] == "selected"

        # Invalid status
        bad = requests.put(
            f"{API}/admin/requests/community/{rid}",
            json={"status": "invalid_status"},
            headers=admin_headers,
        )
        assert bad.status_code == 400

        # Delete
        d = requests.delete(f"{API}/admin/requests/community/{rid}", headers=admin_headers)
        assert d.status_code == 200


class TestMediaRange:
    def test_media_not_found_404(self, api_client):
        r = api_client.get(f"{API}/media/lightlisten/nonexistent/xyz.mp3")
        assert r.status_code == 404
