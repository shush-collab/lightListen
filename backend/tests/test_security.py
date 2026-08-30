"""Security-fix verification (SEC-001 authz, SEC-002 regex, SEC-003 path,
upload hardening, login enumeration timing/message).

Everything below only exercises the security-related behaviour introduced in
iteration 2. Existing tests still cover the happy paths."""
import io
import struct
import time
import uuid
import zlib

import pytest
import requests

from conftest import API, ADMIN_KEY


# ---------- helpers ---------------------------------------------------------
def _tiny_png_bytes() -> bytes:
    """Return raw bytes of a 1x1 red PNG."""
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)  # 1x1, RGB
    raw = b"\x00\xff\x00\x00"  # one filter byte + RGB pixel
    idat = zlib.compress(raw)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _admin_form_headers(admin_headers: dict) -> dict:
    """Strip Content-Type so `requests` sets the multipart boundary."""
    return {k: v for k, v in admin_headers.items() if k.lower() != "content-type"}


@pytest.fixture()
def draft_novel(admin_headers):
    """Admin creates a fresh draft novel + volume; caller cleans up."""
    title = f"TEST_SEC_Draft_{uuid.uuid4().hex[:6]}"
    r = requests.post(
        f"{API}/admin/novels",
        json={"title": title, "author": "Sec", "description": "d", "genres": ["Test"]},
        headers=admin_headers,
    )
    assert r.status_code == 201, r.text
    novel_id = r.json()["id"]
    v = requests.post(
        f"{API}/admin/novels/{novel_id}/volumes",
        json={"volume_number": 1},
        headers=admin_headers,
    )
    assert v.status_code == 201, v.text
    volume_id = v.json()["id"]
    yield {"novel_id": novel_id, "volume_id": volume_id, "title": title}
    # cleanup
    requests.delete(f"{API}/admin/novels/{novel_id}", headers=admin_headers)


# ==========================================================================
# SEC-001 — Authorization: draft novels must be invisible to non-admins
# ==========================================================================
class TestSec001DraftAccess:
    def test_chapters_anon_on_draft_404(self, api_client, draft_novel):
        r = api_client.get(f"{API}/novels/{draft_novel['novel_id']}/chapters")
        assert r.status_code == 404, r.text

    def test_chapters_reader_on_draft_404(self, reader_headers, draft_novel):
        r = requests.get(
            f"{API}/novels/{draft_novel['novel_id']}/chapters", headers=reader_headers
        )
        assert r.status_code == 404, r.text

    def test_chapters_admin_on_draft_200(self, admin_headers, draft_novel):
        r = requests.get(
            f"{API}/novels/{draft_novel['novel_id']}/chapters", headers=admin_headers
        )
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), list)

    def test_chapters_anon_on_published_200(self, api_client, demo_novel):
        r = api_client.get(f"{API}/novels/{demo_novel['id']}/chapters")
        assert r.status_code == 200

    def test_chapters_publish_flow(self, api_client, admin_headers, draft_novel):
        nid = draft_novel["novel_id"]
        # anon starts as 404
        assert api_client.get(f"{API}/novels/{nid}/chapters").status_code == 404
        # publish
        p = requests.put(f"{API}/admin/novels/{nid}/publish", headers=admin_headers)
        assert p.status_code == 200
        # now anon can list (chapters may be empty but call must 200)
        r = api_client.get(f"{API}/novels/{nid}/chapters")
        assert r.status_code == 200, r.text


class TestSec001PlayRequiresAuth:
    def test_play_no_token_401(self, api_client, demo_novel):
        r = api_client.post(f"{API}/novels/{demo_novel['id']}/play")
        assert r.status_code == 401

    def test_play_unpublished_404(self, reader_headers, draft_novel):
        r = requests.post(
            f"{API}/novels/{draft_novel['novel_id']}/play", headers=reader_headers
        )
        assert r.status_code == 404

    def test_play_published_authed_200_and_increments(self, api_client, reader_headers, demo_novel):
        before = api_client.get(f"{API}/novels/{demo_novel['id']}").json()["novel"]["play_count"]
        r = requests.post(f"{API}/novels/{demo_novel['id']}/play", headers=reader_headers)
        assert r.status_code == 200
        after = api_client.get(f"{API}/novels/{demo_novel['id']}").json()["novel"]["play_count"]
        assert after == before + 1


class TestSec001SaveRequiresPublished:
    def test_save_unpublished_404(self, reader_headers, draft_novel):
        r = requests.post(
            f"{API}/novels/{draft_novel['novel_id']}/save", headers=reader_headers
        )
        assert r.status_code == 404

    def test_save_published_ok_idempotent(self, api_client, reader_headers, demo_novel):
        nid = demo_novel["id"]
        r1 = requests.post(f"{API}/novels/{nid}/save", headers=reader_headers)
        assert r1.status_code == 200 and r1.json()["saved"] is True
        r2 = requests.post(f"{API}/novels/{nid}/save", headers=reader_headers)
        assert r2.status_code == 200
        # verify appears in saved list
        saved = requests.get(f"{API}/me/saved", headers=reader_headers).json()
        assert nid in [n["id"] for n in saved]

    def test_delete_save_still_works(self, reader_headers, demo_novel):
        # ensure saved, then unsave
        requests.post(f"{API}/novels/{demo_novel['id']}/save", headers=reader_headers)
        r = requests.delete(f"{API}/novels/{demo_novel['id']}/save", headers=reader_headers)
        assert r.status_code == 200
        assert r.json()["saved"] is False


# ==========================================================================
# SEC-002 — Regex injection / ReDoS in q= params and duplicate detection
# ==========================================================================
REGEX_PAYLOADS = [
    "(a+)+$",
    ".*",
    "^Rein",
    "[",
    "\\",
    ")(",
    "?*+",
    "(?:x)",
]


class TestSec002RegexNovels:
    @pytest.mark.parametrize("payload", REGEX_PAYLOADS)
    def test_novels_q_metachar_never_crashes(self, api_client, payload):
        started = time.time()
        r = api_client.get(f"{API}/novels", params={"q": payload})
        elapsed = time.time() - started
        assert r.status_code == 200, f"{payload!r} -> {r.status_code} {r.text}"
        assert isinstance(r.json(), list)
        assert elapsed < 5, f"query {payload!r} took {elapsed:.2f}s"

    def test_novels_q_plain_still_matches_demo(self, api_client):
        for q in ("Star", "Ayaka", "Hoshi"):
            r = api_client.get(f"{API}/novels", params={"q": q})
            assert r.status_code == 200
            assert len(r.json()) >= 1, f"expected match for q={q}"

    def test_novels_q_dotstar_does_not_match_everything(self, api_client):
        r = api_client.get(f"{API}/novels", params={"q": ".*"})
        assert r.status_code == 200
        # .* is escaped -> matches nothing (no novel has a literal ".*" in title/author)
        for n in r.json():
            assert (".*" in n["title"]) or (".*" in n.get("author", "")) or (".*" in (n.get("alt_title") or ""))


class TestSec002RegexRequests:
    @pytest.mark.parametrize("payload", REGEX_PAYLOADS)
    def test_requests_q_metachar_never_crashes(self, api_client, payload):
        r = api_client.get(f"{API}/requests", params={"q": payload})
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_requests_duplicate_metachar_title_dedupes(self, reader_headers):
        # Title contains regex metacharacters — anchored escaped regex must
        # still detect duplicates.
        title = f"Regex (Test) [One] {uuid.uuid4().hex[:6]}"
        r1 = requests.post(f"{API}/requests", json={"title": title}, headers=reader_headers)
        assert r1.status_code == 201, r1.text
        rid = r1.json()["id"]

        # Second post from a second user with same title -> vote on existing
        email = f"TEST_sec_{uuid.uuid4().hex[:6]}@example.com"
        signup = requests.post(
            f"{API}/auth/signup",
            json={"email": email, "password": "TestPass_2026", "display_name": "SecDup"},
        )
        assert signup.status_code == 201
        h2 = {
            "Authorization": f"Bearer {signup.json()['access_token']}",
            "Content-Type": "application/json",
        }
        r2 = requests.post(f"{API}/requests", json={"title": title}, headers=h2)
        assert r2.status_code == 201
        assert r2.json()["id"] == rid, "duplicate title should update existing"
        assert r2.json()["vote_count"] == 2

    def test_requests_dotstar_title_matches_literally(self, reader_headers):
        # Creating a request titled '.*' must NOT collide with random other
        # titles — the dedupe regex must be anchored + escaped.
        title = f".*_{uuid.uuid4().hex[:6]}"
        r1 = requests.post(f"{API}/requests", json={"title": title}, headers=reader_headers)
        assert r1.status_code == 201
        rid = r1.json()["id"]

        other_title = f"Totally_Unrelated_{uuid.uuid4().hex[:6]}"
        r2 = requests.post(f"{API}/requests", json={"title": other_title}, headers=reader_headers)
        assert r2.status_code == 201
        assert r2.json()["id"] != rid, "'.*' must not collide with unrelated titles"


class TestSec002RegexAdminUsers:
    @pytest.mark.parametrize("payload", REGEX_PAYLOADS)
    def test_admin_users_q_metachar_never_crashes(self, admin_headers, payload):
        r = requests.get(f"{API}/admin/users", params={"q": payload}, headers=admin_headers)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_admin_users_q_still_matches(self, admin_headers):
        r = requests.get(f"{API}/admin/users", params={"q": "admin"}, headers=admin_headers)
        assert r.status_code == 200
        assert any("admin" in u["email"] for u in r.json())


# ==========================================================================
# SEC-003 — Path traversal + upload hardening + media hardening
# ==========================================================================
BAD_MEDIA_PATHS = [
    "etc/passwd",
    "lightlisten/../etc/passwd",
    "../lightlisten/x",
    "lightlisten/.%2E/x",
    "lightlisten/./x",
    "lightlisten/..",
    "lightlisten/",  # empty segment after prefix
    "lightlisten\\..\\etc",  # backslash traversal
    "notlightlisten/x/y.mp3",
    "lightlisten/" + ("a" * 401),  # over-long
]


class TestSec003PathTraversal:
    @pytest.mark.parametrize("bad", BAD_MEDIA_PATHS)
    def test_media_bad_path_rejected(self, api_client, bad):
        # Either the server's validate_storage_path rejects (400) or the URL
        # normaliser upstream of the app already collapsed the traversal so the
        # request no longer maps to the media route (404). Both outcomes mean
        # the traversal did not read a file — never 200 and never a 5xx.
        r = api_client.get(f"{API}/media/{bad}")
        assert r.status_code in (400, 404), f"{bad!r} -> {r.status_code}"
        assert r.status_code < 500, f"{bad!r} -> {r.status_code}"

    def test_media_valid_but_missing_404(self, api_client):
        # well-formed path that just doesn't exist -> 404 (not 400)
        r = api_client.get(f"{API}/media/lightlisten/nonexistent/xyz.mp3")
        assert r.status_code == 404


class TestSec003UploadHardening:
    def test_cover_rejects_html_415(self, admin_headers, draft_novel):
        h = _admin_form_headers(admin_headers)
        files = {"file": ("evil.html", b"<html>hi</html>", "text/html")}
        r = requests.post(
            f"{API}/admin/novels/{draft_novel['novel_id']}/cover",
            files=files,
            headers=h,
        )
        assert r.status_code == 415, r.text

    def test_cover_rejects_pdf_415(self, admin_headers, draft_novel):
        h = _admin_form_headers(admin_headers)
        files = {"file": ("evil.pdf", b"%PDF-1.4\n", "application/pdf")}
        r = requests.post(
            f"{API}/admin/novels/{draft_novel['novel_id']}/cover",
            files=files,
            headers=h,
        )
        assert r.status_code == 415, r.text

    def test_cover_accepts_png_and_serves_back_as_image(self, api_client, admin_headers, draft_novel):
        png = _tiny_png_bytes()
        h = _admin_form_headers(admin_headers)
        files = {"file": ("cover.png", png, "image/png")}
        r = requests.post(
            f"{API}/admin/novels/{draft_novel['novel_id']}/cover",
            files=files,
            headers=h,
        )
        assert r.status_code == 200, r.text
        url = r.json()["cover_image_url"]
        assert url.startswith("/api/media/lightlisten/covers/"), url

        # Fetch back — must be image content-type and nosniff header
        base = API.rsplit("/api", 1)[0]
        got = requests.get(f"{base}{url}")
        assert got.status_code == 200, got.text
        assert got.headers.get("Content-Type", "").startswith("image/"), got.headers.get("Content-Type")
        assert got.headers.get("X-Content-Type-Options", "").lower() == "nosniff"

        # Range request -> 206 + Content-Range
        rr = requests.get(f"{base}{url}", headers={"Range": "bytes=0-9"})
        assert rr.status_code == 206, rr.text
        assert "Content-Range" in rr.headers
        assert rr.headers.get("X-Content-Type-Options", "").lower() == "nosniff"

    def test_chapter_upload_rejects_non_audio_415(self, admin_headers, draft_novel):
        h = _admin_form_headers(admin_headers)
        files = {"file": ("song.txt", b"not audio", "text/plain")}
        data = {"chapter_number": 1, "title": "Bad", "duration_seconds": 1}
        r = requests.post(
            f"{API}/admin/volumes/{draft_novel['volume_id']}/chapters",
            data=data,
            files=files,
            headers=h,
        )
        assert r.status_code == 415, r.text

    def test_chapter_upload_accepts_audio_mpeg(self, admin_headers, draft_novel):
        # Minimal MP3-ish bytes; store_upload only cares about the mime type.
        h = _admin_form_headers(admin_headers)
        files = {"file": ("clip.mp3", b"ID3\x03\x00\x00\x00" + b"\x00" * 200, "audio/mpeg")}
        data = {"chapter_number": 99, "title": "Audio Upload OK", "duration_seconds": 5}
        r = requests.post(
            f"{API}/admin/volumes/{draft_novel['volume_id']}/chapters",
            data=data,
            files=files,
            headers=h,
        )
        assert r.status_code == 201, r.text
        assert r.json()["audio_file_url"].startswith("/api/media/lightlisten/audio/")

    def test_chapter_audio_url_field_still_works(self, admin_headers, draft_novel):
        h = _admin_form_headers(admin_headers)
        r = requests.post(
            f"{API}/admin/volumes/{draft_novel['volume_id']}/chapters",
            data={
                "chapter_number": 100,
                "title": "Via URL",
                "duration_seconds": 1,
                "audio_url": "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
            },
            headers=h,
        )
        assert r.status_code == 201, r.text
        assert r.json()["audio_file_url"].startswith("https://")


# ==========================================================================
# Login enumeration / timing fix
# ==========================================================================
class TestLoginEnumeration:
    def test_unknown_email_401_generic_message(self, api_client):
        r = api_client.post(
            f"{API}/auth/login",
            json={"email": f"nobody_{uuid.uuid4().hex[:6]}@example.com", "password": "whatever_1234"},
        )
        assert r.status_code == 401
        assert r.json().get("detail") == "Invalid email or password"

    def test_wrong_password_401_generic_message(self, api_client):
        from conftest import READER_EMAIL

        r = api_client.post(
            f"{API}/auth/login",
            json={"email": READER_EMAIL, "password": "wrong_password_1234"},
        )
        assert r.status_code == 401
        assert r.json().get("detail") == "Invalid email or password"

    def test_short_password_still_422(self, api_client):
        r = api_client.post(
            f"{API}/auth/signup",
            json={"email": f"TEST_{uuid.uuid4().hex[:6]}@example.com", "password": "abc", "display_name": "S"},
        )
        assert r.status_code == 422

    def test_duplicate_signup_still_409(self, api_client):
        email = f"TEST_dup_{uuid.uuid4().hex[:6]}@example.com"
        r1 = api_client.post(
            f"{API}/auth/signup",
            json={"email": email, "password": "TestPass_2026", "display_name": "D"},
        )
        assert r1.status_code == 201
        r2 = api_client.post(
            f"{API}/auth/signup",
            json={"email": email, "password": "TestPass_2026", "display_name": "D2"},
        )
        assert r2.status_code == 409


# ==========================================================================
# CORS — allow_credentials=False must not break the Expo web preview
# ==========================================================================
class TestCorsStillOpen:
    def test_get_from_browser_origin_ok(self, api_client):
        # Expo preview origin
        r = requests.get(
            f"{API}/novels?sort=new",
            headers={"Origin": "https://ln-player-app.preview.emergentagent.com"},
        )
        assert r.status_code == 200
        # allow-origin still returned as *
        assert r.headers.get("access-control-allow-origin") in ("*", "https://ln-player-app.preview.emergentagent.com")
