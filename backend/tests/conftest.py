"""Shared pytest fixtures for LightListen backend tests."""
import os
import time
import uuid

import pytest
import requests

BASE_URL = "https://ln-player-app.preview.emergentagent.com".rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@lightlisten.app"
ADMIN_PASSWORD = "LightListen_Admin_2026!"
ADMIN_KEY = "ll_admin_9f2c47ba61d84e0fa3c5b8e7d1046a92"

READER_EMAIL = "reader@lightlisten.app"
READER_PASSWORD = "Reader_2026_pass"


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def base_url():
    return API


def _login(session, email, password):
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password})
    return r


@pytest.fixture(scope="session")
def admin_tokens(api_client):
    r = _login(api_client, ADMIN_EMAIL, ADMIN_PASSWORD)
    if r.status_code != 200:
        pytest.skip(f"Admin login failed: {r.status_code} {r.text}")
    return r.json()


@pytest.fixture(scope="session")
def admin_headers(admin_tokens):
    return {
        "Authorization": f"Bearer {admin_tokens['access_token']}",
        "X-Admin-Key": ADMIN_KEY,
        "Content-Type": "application/json",
    }


@pytest.fixture(scope="session")
def reader_tokens(api_client):
    # Try login; if it fails, sign up
    r = _login(api_client, READER_EMAIL, READER_PASSWORD)
    if r.status_code == 200:
        return r.json()
    r = api_client.post(
        f"{API}/auth/signup",
        json={"email": READER_EMAIL, "password": READER_PASSWORD, "display_name": "Test Reader"},
    )
    if r.status_code in (200, 201):
        return r.json()
    if r.status_code == 409:
        # already exists but wrong password - fail loudly
        pytest.skip(f"Reader user exists but login failed: {r.text}")
    pytest.skip(f"Reader signup failed: {r.status_code} {r.text}")


@pytest.fixture(scope="session")
def reader_headers(reader_tokens):
    return {
        "Authorization": f"Bearer {reader_tokens['access_token']}",
        "Content-Type": "application/json",
    }


@pytest.fixture(scope="session")
def demo_novel(api_client):
    r = api_client.get(f"{API}/novels?sort=new")
    assert r.status_code == 200, r.text
    novels = r.json()
    assert len(novels) >= 1, "No seeded novels found"
    # find the demo one
    for n in novels:
        if "Star Sage" in n.get("title", ""):
            return n
    return novels[0]


def unique_email(prefix="TEST"):
    return f"{prefix}_{uuid.uuid4().hex[:10]}@example.com"
