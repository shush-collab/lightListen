"""Auth endpoint tests: signup / login / refresh / me."""
import pytest
import requests

from conftest import API, unique_email, READER_EMAIL, READER_PASSWORD


class TestAuth:
    def test_signup_success(self, api_client):
        email = unique_email("SIGNUP")
        r = api_client.post(
            f"{API}/auth/signup",
            json={"email": email, "password": "TestPass_2026", "display_name": "Signup User"},
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["user"]["email"] == email.lower()
        assert data["user"]["display_name"] == "Signup User"
        assert "_id" not in data["user"]

    def test_signup_duplicate_email_409(self, api_client):
        email = unique_email("DUP")
        r1 = api_client.post(
            f"{API}/auth/signup",
            json={"email": email, "password": "TestPass_2026", "display_name": "Dup"},
        )
        assert r1.status_code == 201
        r2 = api_client.post(
            f"{API}/auth/signup",
            json={"email": email, "password": "TestPass_2026", "display_name": "Dup2"},
        )
        assert r2.status_code == 409, r2.text

    def test_signup_short_password_422(self, api_client):
        r = api_client.post(
            f"{API}/auth/signup",
            json={"email": unique_email("SHORT"), "password": "abc", "display_name": "Short"},
        )
        assert r.status_code == 422, r.text

    def test_login_wrong_password_401(self, api_client):
        r = api_client.post(
            f"{API}/auth/login",
            json={"email": READER_EMAIL, "password": "wrong_password_here"},
        )
        assert r.status_code == 401, r.text

    def test_login_reader_success(self, api_client, reader_tokens):
        assert "access_token" in reader_tokens
        assert reader_tokens["user"]["email"] == READER_EMAIL

    def test_refresh_with_access_token_fails_401(self, api_client, reader_tokens):
        # Using access token as refresh must fail
        r = api_client.post(
            f"{API}/auth/refresh", json={"refresh_token": reader_tokens["access_token"]}
        )
        assert r.status_code == 401, r.text

    def test_refresh_valid(self, api_client, reader_tokens):
        r = api_client.post(
            f"{API}/auth/refresh", json={"refresh_token": reader_tokens["refresh_token"]}
        )
        assert r.status_code == 200, r.text
        assert "access_token" in r.json()

    def test_get_me(self, api_client, reader_headers):
        r = requests.get(f"{API}/auth/me", headers=reader_headers)
        assert r.status_code == 200, r.text
        assert r.json()["email"] == READER_EMAIL

    def test_get_me_no_auth_401(self, api_client):
        r = api_client.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_update_me_display_name(self, api_client, reader_headers):
        new_name = f"Test Reader {uuid_short()}"
        r = requests.put(
            f"{API}/auth/me", json={"display_name": new_name}, headers=reader_headers
        )
        assert r.status_code == 200, r.text
        assert r.json()["display_name"] == new_name
        # Verify persistence via GET
        r2 = requests.get(f"{API}/auth/me", headers=reader_headers)
        assert r2.json()["display_name"] == new_name


def uuid_short():
    import uuid as _u
    return _u.uuid4().hex[:6]
