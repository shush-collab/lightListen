"""Library: progress upsert, continue-listening, save/unsave."""
import requests
from conftest import API


class TestLibrary:
    def test_save_novel_idempotent(self, api_client, reader_headers, demo_novel):
        nid = demo_novel["id"]
        r1 = requests.post(f"{API}/novels/{nid}/save", headers=reader_headers)
        assert r1.status_code == 200
        assert r1.json()["saved"] is True
        # Save again - idempotent
        r2 = requests.post(f"{API}/novels/{nid}/save", headers=reader_headers)
        assert r2.status_code == 200
        # Verify appears in saved list
        r3 = requests.get(f"{API}/me/saved", headers=reader_headers)
        assert r3.status_code == 200
        ids = [n["id"] for n in r3.json()]
        assert nid in ids

    def test_unsave_novel_idempotent(self, api_client, reader_headers, demo_novel):
        nid = demo_novel["id"]
        # ensure saved first
        requests.post(f"{API}/novels/{nid}/save", headers=reader_headers)
        r1 = requests.delete(f"{API}/novels/{nid}/save", headers=reader_headers)
        assert r1.status_code == 200
        assert r1.json()["saved"] is False
        # Idempotent
        r2 = requests.delete(f"{API}/novels/{nid}/save", headers=reader_headers)
        assert r2.status_code == 200
        r3 = requests.get(f"{API}/me/saved", headers=reader_headers)
        ids = [n["id"] for n in r3.json()]
        assert nid not in ids

    def test_progress_upsert_and_get(self, api_client, reader_headers, demo_novel):
        nid = demo_novel["id"]
        chapters = api_client.get(f"{API}/novels/{nid}/chapters").json()
        cid = chapters[0]["id"]
        # First upsert
        r = requests.put(
            f"{API}/me/progress",
            json={"novel_id": nid, "chapter_id": cid, "position_seconds": 42.5},
            headers=reader_headers,
        )
        assert r.status_code == 200
        # Second upsert same novel -> update, still one record
        r2 = requests.put(
            f"{API}/me/progress",
            json={"novel_id": nid, "chapter_id": cid, "position_seconds": 90.0},
            headers=reader_headers,
        )
        assert r2.status_code == 200
        # GET
        r3 = requests.get(f"{API}/me/progress/{nid}", headers=reader_headers)
        assert r3.status_code == 200
        data = r3.json()
        assert data["chapter_id"] == cid
        assert data["position_seconds"] == 90.0

    def test_continue_listening(self, api_client, reader_headers, demo_novel):
        nid = demo_novel["id"]
        chapters = api_client.get(f"{API}/novels/{nid}/chapters").json()
        cid = chapters[0]["id"]
        requests.put(
            f"{API}/me/progress",
            json={"novel_id": nid, "chapter_id": cid, "position_seconds": 55.0},
            headers=reader_headers,
        )
        r = requests.get(f"{API}/me/continue", headers=reader_headers)
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        first = items[0]
        assert first["novel"]["id"] == nid
        assert first["chapter"]["id"] == cid
        assert first["position_seconds"] == 55.0

    def test_novel_detail_shows_saved_and_progress(self, api_client, reader_headers, demo_novel):
        nid = demo_novel["id"]
        requests.post(f"{API}/novels/{nid}/save", headers=reader_headers)
        r = requests.get(f"{API}/novels/{nid}", headers=reader_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["saved"] is True
        assert data["progress"] is not None
