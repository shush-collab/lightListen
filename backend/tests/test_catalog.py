"""Public catalog: genres, novels list/detail/chapters, play increment."""
import requests
from conftest import API


class TestCatalog:
    def test_list_genres(self, api_client):
        r = api_client.get(f"{API}/genres")
        assert r.status_code == 200
        genres = r.json()
        assert isinstance(genres, list)
        assert "Isekai" in genres

    def test_novels_sort_new(self, api_client):
        r = api_client.get(f"{API}/novels?sort=new")
        assert r.status_code == 200
        novels = r.json()
        assert len(novels) >= 1
        assert all(n["status"] == "published" for n in novels)

    def test_novels_sort_popular(self, api_client):
        r = api_client.get(f"{API}/novels?sort=popular")
        assert r.status_code == 200

    def test_novels_sort_title(self, api_client):
        r = api_client.get(f"{API}/novels?sort=title")
        assert r.status_code == 200

    def test_novels_invalid_sort_422(self, api_client):
        r = api_client.get(f"{API}/novels?sort=random")
        assert r.status_code == 422

    def test_novels_search_by_title(self, api_client):
        r = api_client.get(f"{API}/novels?q=Star")
        assert r.status_code == 200
        titles = [n["title"] for n in r.json()]
        assert any("Star" in t for t in titles)

    def test_novels_search_by_author(self, api_client):
        r = api_client.get(f"{API}/novels?q=Ayaka")
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_novels_search_by_alt_title(self, api_client):
        r = api_client.get(f"{API}/novels?q=Hoshi")
        assert r.status_code == 200
        assert len(r.json()) >= 1

    def test_novels_filter_by_genre(self, api_client):
        r = api_client.get(f"{API}/novels?genre=Isekai")
        assert r.status_code == 200
        for n in r.json():
            assert "Isekai" in n["genres"]

    def test_novel_detail(self, api_client, demo_novel):
        r = api_client.get(f"{API}/novels/{demo_novel['id']}")
        assert r.status_code == 200
        data = r.json()
        assert "novel" in data
        assert "volumes" in data
        assert "saved" in data
        assert "progress" in data
        assert len(data["volumes"]) >= 1
        assert len(data["volumes"][0]["chapters"]) >= 1

    def test_novel_detail_invalid_id_400(self, api_client):
        r = api_client.get(f"{API}/novels/not-an-objectid")
        assert r.status_code == 400

    def test_novel_detail_unknown_404(self, api_client):
        r = api_client.get(f"{API}/novels/507f1f77bcf86cd799439011")
        assert r.status_code == 404

    def test_novel_chapters(self, api_client, demo_novel):
        r = api_client.get(f"{API}/novels/{demo_novel['id']}/chapters")
        assert r.status_code == 200
        chapters = r.json()
        assert len(chapters) >= 3
        assert chapters[0]["chapter_number"] == 1

    def test_novel_play_increments(self, api_client, demo_novel):
        before = api_client.get(f"{API}/novels/{demo_novel['id']}").json()["novel"]["play_count"]
        r = api_client.post(f"{API}/novels/{demo_novel['id']}/play")
        assert r.status_code == 200
        after = api_client.get(f"{API}/novels/{demo_novel['id']}").json()["novel"]["play_count"]
        assert after == before + 1

    def test_pro_features_no_auth(self, api_client):
        r = api_client.get(f"{API}/pro/features")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "coming_soon"
        assert isinstance(data["features"], list)
        assert len(data["features"]) >= 1
