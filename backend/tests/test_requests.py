"""Community requests: create/vote/dedup/list/my."""
import uuid
import requests
from conftest import API


class TestRequests:
    def test_create_new_request(self, api_client, reader_headers):
        title = f"TEST_Request_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{API}/requests", json={"title": title}, headers=reader_headers
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["title"] == title
        assert data["vote_count"] == 1
        assert data["is_mine"] is True
        assert data["has_voted"] is True

    def test_duplicate_request_votes_existing(self, api_client, reader_headers):
        title = f"TEST_Dupe_{uuid.uuid4().hex[:8]}"
        r1 = requests.post(
            f"{API}/requests", json={"title": title}, headers=reader_headers
        )
        assert r1.status_code == 201
        rid = r1.json()["id"]

        # Signup a second user and create with the same title
        email = f"TEST_voter_{uuid.uuid4().hex[:6]}@example.com"
        signup = api_client.post(
            f"{API}/auth/signup",
            json={"email": email, "password": "TestPass_2026", "display_name": "Voter"},
        )
        assert signup.status_code == 201
        headers2 = {
            "Authorization": f"Bearer {signup.json()['access_token']}",
            "Content-Type": "application/json",
        }
        r2 = requests.post(
            f"{API}/requests", json={"title": title}, headers=headers2
        )
        assert r2.status_code == 201
        assert r2.json()["id"] == rid  # same record
        assert r2.json()["vote_count"] == 2

    def test_vote_is_idempotent(self, api_client, reader_headers):
        title = f"TEST_Vote_{uuid.uuid4().hex[:8]}"
        r1 = requests.post(
            f"{API}/requests", json={"title": title}, headers=reader_headers
        )
        rid = r1.json()["id"]
        # Signup a voter
        email = f"TEST_v2_{uuid.uuid4().hex[:6]}@example.com"
        signup = api_client.post(
            f"{API}/auth/signup",
            json={"email": email, "password": "TestPass_2026", "display_name": "V2"},
        )
        headers2 = {
            "Authorization": f"Bearer {signup.json()['access_token']}",
            "Content-Type": "application/json",
        }
        v1 = requests.post(f"{API}/requests/{rid}/vote", headers=headers2)
        assert v1.status_code == 200
        count1 = v1.json()["vote_count"]
        assert count1 == 2
        # Vote again - should stay same
        v2 = requests.post(f"{API}/requests/{rid}/vote", headers=headers2)
        assert v2.status_code == 200
        assert v2.json()["vote_count"] == 2

    def test_list_requests_sorted_by_votes(self, api_client, reader_headers):
        r = api_client.get(f"{API}/requests")
        assert r.status_code == 200
        votes = [d["vote_count"] for d in r.json()]
        assert votes == sorted(votes, reverse=True)

    def test_list_requests_fuzzy_search(self, api_client, reader_headers):
        title = f"TEST_Search_XYZ_{uuid.uuid4().hex[:6]}"
        requests.post(
            f"{API}/requests", json={"title": title}, headers=reader_headers
        )
        r = api_client.get(f"{API}/requests?q=XYZ")
        assert r.status_code == 200
        titles = [d["title"] for d in r.json()]
        assert any("XYZ" in t for t in titles)

    def test_my_requests_lists_submitted_and_voted(self, api_client, reader_headers):
        r = requests.get(f"{API}/me/requests", headers=reader_headers)
        assert r.status_code == 200
        for req in r.json():
            assert req["has_voted"] is True or req["is_mine"] is True
