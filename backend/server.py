"""LightListen — Light Novel Audiobook backend (FastAPI monolith).

Public catalog + auth + playback progress + downloads metadata + community requests,
plus admin content management endpoints (X-Admin-Key + admin JWT).
"""

import logging
import mimetypes
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from hmac import compare_digest
from pathlib import Path
from typing import Annotated, Any, Dict, List, Optional

import bcrypt
import httpx
import jwt
import requests
from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv
from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.concurrency import run_in_threadpool
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, BeforeValidator, EmailStr, Field
from pymongo import ASCENDING, DESCENDING, TEXT
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("lightlisten")

# ---------------------------------------------------------------- config
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
JWT_SECRET = os.environ["JWT_SECRET"]
ADMIN_KEY = os.environ["ADMIN_KEY"]
ADMIN_EMAIL = os.environ["ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]
ACCESS_MINUTES = int(os.environ["ACCESS_MINUTES"])
REFRESH_DAYS = int(os.environ["REFRESH_DAYS"])
ALGORITHM = "HS256"

APP_NAME = "lightlisten"
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")

# Emergent managed push relay (tokens are resolved upstream from the user id).
PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")

# Only these analytics event names are accepted — keeps the collection clean.
ALLOWED_EVENTS = {
    "novel_viewed",
    "chapter_started",
    "chapter_completed",
    "anime_continue_used",
    "catchup_used",
    "bookmark_created",
    "download_started",
    "download_completed",
    "request_submitted",
    "request_voted",
}

# A recap is only offered after this many days away from a novel.
CATCHUP_MIN_DAYS = 3
CATCHUP_MAX_CHAPTERS = 5
CATCHUP_MIN_WORDS = 80
CATCHUP_MAX_WORDS = 120
BOOKMARK_DEDUPE_SECONDS = 3.0

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="LightListen API")
api_router = APIRouter(prefix="/api")


# ---------------------------------------------------------------- object storage
storage_key: Optional[str] = None


def init_storage() -> str:
    global storage_key
    if storage_key:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data,
        timeout=180,
    )
    if resp.status_code == 503:
        globals()["storage_key"] = None
        key = init_storage()
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type},
            data=data,
            timeout=180,
        )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple:
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=120)
    if resp.status_code == 503:
        globals()["storage_key"] = None
        key = init_storage()
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=120)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


# ---------------------------------------------------------------- models
PyObjectId = Annotated[str, BeforeValidator(lambda v: str(v) if isinstance(v, ObjectId) else v)]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


class BaseDocument(BaseModel):
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    model_config = {"populate_by_name": True, "arbitrary_types_allowed": True}

    def to_mongo(self) -> dict:
        data = self.model_dump(by_alias=True)
        raw_id = data.pop("_id", None)
        if raw_id:
            data["_id"] = ObjectId(raw_id)
        return data

    @classmethod
    def from_mongo(cls, doc: Optional[dict]):
        if not doc:
            return None
        return cls.model_validate(doc)


class User(BaseDocument):
    email: str
    password_hash: str
    display_name: str
    avatar_url: Optional[str] = None
    role: str = "user"
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class Novel(BaseDocument):
    title: str
    alt_title: Optional[str] = None
    author: str
    description: str = ""
    genres: List[str] = []
    cover_image_url: Optional[str] = None
    status: str = "draft"
    play_count: int = 0
    chapter_count: int = 0
    total_duration_seconds: int = 0
    # Curated "continue from the anime" jump points.
    anime_mappings: List[Dict[str, Any]] = []
    # Narration casting manifest — admin-only, never exposed in full publicly.
    narration_mode: str = "single"
    cast: List[Dict[str, Any]] = []
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class Volume(BaseDocument):
    novel_id: PyObjectId
    volume_number: int
    cover_image_url: Optional[str] = None
    created_at: datetime = Field(default_factory=now_utc)


class Chapter(BaseDocument):
    volume_id: PyObjectId
    novel_id: PyObjectId
    chapter_number: int
    title: str
    audio_file_url: str
    duration_seconds: int = 0
    file_size_bytes: int = 0
    # Timeline-synced light novel illustrations.
    illustrations: List[Dict[str, Any]] = []
    # Spoiler-safe summary of THIS chapter, only served through /catchup.
    recap_text: str = ""
    created_at: datetime = Field(default_factory=now_utc)


class ListeningProgress(BaseDocument):
    user_id: PyObjectId
    novel_id: PyObjectId
    chapter_id: PyObjectId
    position_seconds: float = 0
    updated_at: datetime = Field(default_factory=now_utc)


class SavedNovel(BaseDocument):
    user_id: PyObjectId
    novel_id: PyObjectId
    saved_at: datetime = Field(default_factory=now_utc)


class CommunityRequest(BaseDocument):
    title: str
    alt_title: Optional[str] = None
    cover_image_url: Optional[str] = None
    genres: List[str] = []
    submitted_by: PyObjectId
    voters: List[PyObjectId] = []
    vote_count: int = 0
    status: str = "requested"
    linked_novel_id: Optional[PyObjectId] = None
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class ProRequest(BaseDocument):
    """Schema-only in MVP (kept for the Pro tier rollout)."""

    user_id: PyObjectId
    novel_title: str
    status: str = "requested"
    request_date: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)


class Subscription(BaseDocument):
    """Schema-only in MVP (all users are free)."""

    user_id: PyObjectId
    plan: str = "free"
    starts_at: datetime = Field(default_factory=now_utc)
    expires_at: Optional[datetime] = None
    status: str = "active"


class ChapterCompletion(BaseDocument):
    user_id: PyObjectId
    novel_id: PyObjectId
    chapter_id: PyObjectId
    completed_at: datetime = Field(default_factory=now_utc)


class AudioBookmark(BaseDocument):
    user_id: PyObjectId
    novel_id: PyObjectId
    chapter_id: PyObjectId
    position_seconds: float
    created_at: datetime = Field(default_factory=now_utc)


class AnalyticsEvent(BaseDocument):
    user_id: Optional[PyObjectId] = None
    event: str
    novel_id: Optional[PyObjectId] = None
    chapter_id: Optional[PyObjectId] = None
    properties: Dict[str, Any] = {}
    created_at: datetime = Field(default_factory=now_utc)


# ------------------------------------------------------------ request/response
class SignupBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    display_name: str = Field(min_length=1, max_length=60)


class LoginBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=72)


class RefreshBody(BaseModel):
    refresh_token: str


class ProgressBody(BaseModel):
    novel_id: str
    chapter_id: str
    position_seconds: float = 0


class RequestCreateBody(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    alt_title: Optional[str] = Field(default=None, max_length=200)


class ProfileBody(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    avatar_url: Optional[str] = None


class NovelBody(BaseModel):
    title: str = Field(min_length=1, max_length=250)
    alt_title: Optional[str] = None
    author: str = Field(min_length=1, max_length=150)
    description: str = ""
    genres: List[str] = []


class NovelPatchBody(BaseModel):
    title: Optional[str] = None
    alt_title: Optional[str] = None
    author: Optional[str] = None
    description: Optional[str] = None
    genres: Optional[List[str]] = None


class VolumeBody(BaseModel):
    volume_number: int
    cover_image_url: Optional[str] = None


class ChapterPatchBody(BaseModel):
    chapter_number: Optional[int] = None
    title: Optional[str] = None
    duration_seconds: Optional[int] = None
    recap_text: Optional[str] = None


class AdminRequestPatchBody(BaseModel):
    status: Optional[str] = None
    alt_title: Optional[str] = None
    cover_image_url: Optional[str] = None
    genres: Optional[List[str]] = None
    linked_novel_id: Optional[str] = None


class BookmarkBody(BaseModel):
    novel_id: str
    chapter_id: str
    position_seconds: float = Field(default=0, ge=0)


class AnimeMappingBody(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    through_episode: Optional[int] = Field(default=None, ge=0)
    continue_chapter_id: str
    note: Optional[str] = Field(default=None, max_length=280)


class AnimeMappingsBody(BaseModel):
    mappings: List[AnimeMappingBody] = []


class CastMemberBody(BaseModel):
    character: str = Field(min_length=1, max_length=80)
    provider: Optional[str] = Field(default=None, max_length=60)
    voice_id: Optional[str] = Field(default=None, max_length=120)
    voice_label: Optional[str] = Field(default=None, max_length=120)


class CastBody(BaseModel):
    narration_mode: str = Field(default="single", pattern="^(single|dual|full_cast)$")
    cast: List[CastMemberBody] = []


class EventBody(BaseModel):
    event: str = Field(min_length=1, max_length=60)
    novel_id: Optional[str] = None
    chapter_id: Optional[str] = None
    properties: Dict[str, Any] = {}


class RegisterPushBody(BaseModel):
    platform: str = Field(min_length=1, max_length=20)
    device_token: str = Field(min_length=1, max_length=500)


# ---------------------------------------------------------------- helpers
def oid(value: str, label: str = "id") -> ObjectId:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise HTTPException(400, f"Invalid {label}")


MAX_QUERY_LEN = 80


def safe_regex(value: str, anchored: bool = False) -> dict:
    """Escapes user input before it reaches a Mongo `$regex` (injection + ReDoS)."""
    trimmed = (value or "").strip()[:MAX_QUERY_LEN]
    pattern = re.escape(trimmed)
    if anchored:
        pattern = f"^{pattern}$"
    return {"$regex": pattern, "$options": "i"}


MAX_AUDIO_BYTES = 200 * 1024 * 1024
MAX_IMAGE_BYTES = 10 * 1024 * 1024
AUDIO_TYPES = {
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/aac": ".aac",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/ogg": ".ogg",
    "application/octet-stream": ".mp3",
}
IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
}
SERVABLE_TYPES = set(AUDIO_TYPES) | set(IMAGE_TYPES)


def validate_storage_path(path: str) -> str:
    """Only well-formed paths inside this app's object prefix may be proxied."""
    normalized = (path or "").replace("\\", "/")
    segments = normalized.split("/")
    if (
        not normalized.startswith(f"{APP_NAME}/")
        or "%" in normalized
        or any(seg in {"", ".", ".."} for seg in segments)
        or len(normalized) > 400
    ):
        raise HTTPException(400, "Invalid media path")
    return normalized


def hash_password(password: str) -> str:
    if len(password.encode("utf-8")) > 72:
        raise HTTPException(400, "Password must be at most 72 UTF-8 bytes")
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def password_ok(password: str, stored_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), stored_hash.encode())
    except (ValueError, TypeError):
        return False


# Compared against when the email is unknown so login timing does not reveal
# whether an account exists.
DUMMY_PASSWORD_HASH = bcrypt.hashpw(b"timing-equalising-placeholder", bcrypt.gensalt(rounds=12)).decode()


def make_token(subject: str, role: str, kind: str, lifetime: timedelta) -> str:
    payload = {
        "sub": subject,
        "role": role,
        "type": kind,
        "iat": now_utc(),
        "exp": now_utc() + lifetime,
        "jti": secrets.token_urlsafe(10),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def token_pair(user: dict) -> dict:
    uid = str(user["_id"])
    role = user.get("role", "user")
    return {
        "access_token": make_token(uid, role, "access", timedelta(minutes=ACCESS_MINUTES)),
        "refresh_token": make_token(uid, role, "refresh", timedelta(days=REFRESH_DAYS)),
        "token_type": "bearer",
    }


def user_out(user: dict) -> dict:
    return {
        "id": str(user["_id"]),
        "email": user["email"],
        "display_name": user.get("display_name", ""),
        "avatar_url": user.get("avatar_url"),
        "role": user.get("role", "user"),
        "created_at": user.get("created_at"),
    }


def novel_out(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "title": doc.get("title", ""),
        "alt_title": doc.get("alt_title"),
        "author": doc.get("author", ""),
        "description": doc.get("description", ""),
        "genres": doc.get("genres", []),
        "cover_image_url": doc.get("cover_image_url"),
        "status": doc.get("status", "draft"),
        "play_count": doc.get("play_count", 0),
        "chapter_count": doc.get("chapter_count", 0),
        "total_duration_seconds": doc.get("total_duration_seconds", 0),
        "anime_mappings": [
            {
                "label": m.get("label", ""),
                "through_episode": m.get("through_episode"),
                "continue_chapter_id": str(m.get("continue_chapter_id"))
                if m.get("continue_chapter_id")
                else None,
                "note": m.get("note"),
            }
            for m in doc.get("anime_mappings", [])
        ],
        "narration_mode": doc.get("narration_mode", "single"),
        "cast_count": len(doc.get("cast", [])),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


def admin_novel_out(doc: dict) -> dict:
    """Same as `novel_out` plus the internal casting manifest (voice ids)."""
    return {**novel_out(doc), "cast": doc.get("cast", [])}


def chapter_out(doc: dict) -> dict:
    illustrations = sorted(
        doc.get("illustrations", []), key=lambda item: item.get("timestamp_seconds", 0)
    )
    return {
        "id": str(doc["_id"]),
        "novel_id": str(doc["novel_id"]),
        "volume_id": str(doc["volume_id"]),
        "chapter_number": doc.get("chapter_number", 0),
        "title": doc.get("title", ""),
        "audio_file_url": doc.get("audio_file_url", ""),
        "duration_seconds": doc.get("duration_seconds", 0),
        "file_size_bytes": doc.get("file_size_bytes", 0),
        "illustrations": illustrations,
        "created_at": doc.get("created_at"),
    }


def admin_chapter_out(doc: dict) -> dict:
    """Same as `chapter_out` plus the spoiler-bearing recap text."""
    return {**chapter_out(doc), "recap_text": doc.get("recap_text", "")}


def days_since(value: Optional[datetime]) -> Optional[float]:
    if not value:
        return None
    aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return (now_utc() - aware).total_seconds() / 86400


def request_out(doc: dict, user_id: Optional[str]) -> dict:
    voters = [str(v) for v in doc.get("voters", [])]
    return {
        "id": str(doc["_id"]),
        "title": doc.get("title", ""),
        "alt_title": doc.get("alt_title"),
        "cover_image_url": doc.get("cover_image_url"),
        "genres": doc.get("genres", []),
        "vote_count": doc.get("vote_count", len(voters)),
        "status": doc.get("status", "requested"),
        "linked_novel_id": str(doc["linked_novel_id"]) if doc.get("linked_novel_id") else None,
        "submitted_by": str(doc.get("submitted_by")) if doc.get("submitted_by") else None,
        "has_voted": bool(user_id and user_id in voters),
        "is_mine": bool(user_id and str(doc.get("submitted_by")) == user_id),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


async def recount_novel(novel_id: ObjectId) -> None:
    chapters = await db.chapters.find({"novel_id": novel_id}).to_list(5000)
    await db.novels.update_one(
        {"_id": novel_id},
        {
            "$set": {
                "chapter_count": len(chapters),
                "total_duration_seconds": int(sum(c.get("duration_seconds", 0) for c in chapters)),
                "updated_at": now_utc(),
            }
        },
    )


async def current_user(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    raw = authorization.split(" ", 1)[1]
    try:
        claims = jwt.decode(raw, JWT_SECRET, algorithms=[ALGORITHM])
        if claims.get("type") != "access" or not claims.get("sub"):
            raise ValueError()
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired access token")
    user = await db.users.find_one({"_id": oid(claims["sub"], "user id")})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    return user


async def optional_user(authorization: Optional[str] = Header(default=None)) -> Optional[dict]:
    if not authorization:
        return None
    try:
        return await current_user(authorization)
    except HTTPException:
        return None


async def require_admin(
    user: dict = Depends(current_user),
    x_admin_key: Optional[str] = Header(default=None),
) -> dict:
    if not x_admin_key or not compare_digest(x_admin_key, ADMIN_KEY):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid admin key")
    if user.get("role") != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin role required")
    return user


# ---------------------------------------------------------------- auth routes
@api_router.get("/")
async def root():
    return {"service": "LightListen API", "status": "ok"}


@api_router.post("/auth/signup", status_code=201)
async def signup(body: SignupBody):
    email = str(body.email).lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already registered")
    user = User(
        email=email,
        password_hash=hash_password(body.password),
        display_name=body.display_name.strip(),
        role="user",
    )
    doc = user.to_mongo()
    result = await db.users.insert_one(doc)
    doc["_id"] = result.inserted_id
    return {**token_pair(doc), "user": user_out(doc)}


@api_router.post("/auth/login")
async def login(body: LoginBody):
    email = str(body.email).lower().strip()
    user = await db.users.find_one({"email": email})
    if not user:
        password_ok(body.password, DUMMY_PASSWORD_HASH)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if not password_ok(body.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    return {**token_pair(user), "user": user_out(user)}


@api_router.post("/auth/refresh")
async def refresh_tokens(body: RefreshBody):
    try:
        claims = jwt.decode(body.refresh_token, JWT_SECRET, algorithms=[ALGORITHM])
        if claims.get("type") != "refresh":
            raise ValueError()
    except (jwt.InvalidTokenError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token")
    user = await db.users.find_one({"_id": oid(claims["sub"], "user id")})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    return {**token_pair(user), "user": user_out(user)}


@api_router.get("/auth/me")
async def get_me(user: dict = Depends(current_user)):
    return user_out(user)


@api_router.put("/auth/me")
async def update_me(body: ProfileBody, user: dict = Depends(current_user)):
    updates: Dict[str, Any] = {"updated_at": now_utc()}
    if body.display_name is not None:
        updates["display_name"] = body.display_name.strip()
    if body.avatar_url is not None:
        updates["avatar_url"] = body.avatar_url
    await db.users.update_one({"_id": user["_id"]}, {"$set": updates})
    fresh = await db.users.find_one({"_id": user["_id"]})
    return user_out(fresh)


# ---------------------------------------------------------------- public catalog
@api_router.get("/genres")
async def list_genres():
    genres = await db.novels.distinct("genres", {"status": "published"})
    return sorted([g for g in genres if g])


@api_router.get("/novels")
async def list_novels(
    q: Optional[str] = None,
    genre: Optional[str] = None,
    sort: str = Query("new", pattern="^(new|popular|title)$"),
    limit: int = Query(50, ge=1, le=200),
    skip: int = Query(0, ge=0),
):
    query: Dict[str, Any] = {"status": "published"}
    if genre:
        query["genres"] = genre
    if q:
        rx = safe_regex(q)
        query["$or"] = [{"title": rx}, {"alt_title": rx}, {"author": rx}]
    sort_spec = {
        "new": [("created_at", DESCENDING)],
        "popular": [("play_count", DESCENDING), ("created_at", DESCENDING)],
        "title": [("title", ASCENDING)],
    }[sort]
    docs = await db.novels.find(query).sort(sort_spec).skip(skip).limit(limit).to_list(limit)
    return [novel_out(d) for d in docs]


@api_router.get("/novels/{novel_id}")
async def novel_detail(novel_id: str, user: Optional[dict] = Depends(optional_user)):
    nid = oid(novel_id, "novel id")
    novel = await db.novels.find_one({"_id": nid})
    if not novel:
        raise HTTPException(404, "Novel not found")
    is_admin = bool(user and user.get("role") == "admin")
    if novel.get("status") != "published" and not is_admin:
        raise HTTPException(404, "Novel not found")

    volumes = await db.volumes.find({"novel_id": nid}).sort([("volume_number", ASCENDING)]).to_list(200)
    chapters = await db.chapters.find({"novel_id": nid}).sort([("chapter_number", ASCENDING)]).to_list(5000)
    by_volume: Dict[str, List[dict]] = {}
    for ch in chapters:
        by_volume.setdefault(str(ch["volume_id"]), []).append(chapter_out(ch))

    saved = False
    progress = None
    if user:
        saved = bool(await db.saved_novels.find_one({"user_id": user["_id"], "novel_id": nid}))
        prog = await db.listening_progress.find_one({"user_id": user["_id"], "novel_id": nid})
        if prog:
            progress = {
                "novel_id": novel_id,
                "chapter_id": str(prog["chapter_id"]),
                "position_seconds": prog.get("position_seconds", 0),
                "updated_at": prog.get("updated_at"),
            }

    return {
        "novel": novel_out(novel),
        "volumes": [
            {
                "id": str(v["_id"]),
                "novel_id": novel_id,
                "volume_number": v.get("volume_number", 1),
                "cover_image_url": v.get("cover_image_url"),
                "chapters": by_volume.get(str(v["_id"]), []),
            }
            for v in volumes
        ],
        "saved": saved,
        "progress": progress,
    }


@api_router.get("/novels/{novel_id}/chapters")
async def novel_chapters(novel_id: str, user: Optional[dict] = Depends(optional_user)):
    nid = oid(novel_id, "novel id")
    novel = await db.novels.find_one({"_id": nid})
    if not novel:
        raise HTTPException(404, "Novel not found")
    if novel.get("status") != "published" and not (user and user.get("role") == "admin"):
        raise HTTPException(404, "Novel not found")
    docs = await db.chapters.find({"novel_id": nid}).sort([("chapter_number", ASCENDING)]).to_list(5000)
    return [chapter_out(d) for d in docs]


@api_router.post("/novels/{novel_id}/play")
async def mark_play(novel_id: str, _: dict = Depends(current_user)):
    nid = oid(novel_id, "novel id")
    result = await db.novels.update_one(
        {"_id": nid, "status": "published"}, {"$inc": {"play_count": 1}}
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Novel not found")
    return {"ok": True}


# ---------------------------------------------------------------- me / library
@api_router.put("/me/progress")
async def save_progress(body: ProgressBody, user: dict = Depends(current_user)):
    nid = oid(body.novel_id, "novel id")
    cid = oid(body.chapter_id, "chapter id")
    await db.listening_progress.update_one(
        {"user_id": user["_id"], "novel_id": nid},
        {
            "$set": {
                "chapter_id": cid,
                "position_seconds": float(body.position_seconds),
                "updated_at": now_utc(),
            }
        },
        upsert=True,
    )
    return {"ok": True}


@api_router.get("/me/progress/{novel_id}")
async def get_progress(novel_id: str, user: dict = Depends(current_user)):
    prog = await db.listening_progress.find_one(
        {"user_id": user["_id"], "novel_id": oid(novel_id, "novel id")}
    )
    if not prog:
        return None
    return {
        "novel_id": novel_id,
        "chapter_id": str(prog["chapter_id"]),
        "position_seconds": prog.get("position_seconds", 0),
        "updated_at": prog.get("updated_at"),
    }


@api_router.get("/me/continue")
async def continue_listening(user: dict = Depends(current_user), limit: int = Query(20, ge=1, le=50)):
    rows = (
        await db.listening_progress.find({"user_id": user["_id"]})
        .sort([("updated_at", DESCENDING)])
        .limit(limit)
        .to_list(limit)
    )
    items = []
    for row in rows:
        novel = await db.novels.find_one({"_id": row["novel_id"], "status": "published"})
        if not novel:
            continue
        chapter = await db.chapters.find_one({"_id": row["chapter_id"]})
        items.append(
            {
                "novel": novel_out(novel),
                "chapter": chapter_out(chapter) if chapter else None,
                "position_seconds": row.get("position_seconds", 0),
                "updated_at": row.get("updated_at"),
            }
        )
    return items


@api_router.get("/me/saved")
async def saved_novels(user: dict = Depends(current_user)):
    rows = await db.saved_novels.find({"user_id": user["_id"]}).sort([("saved_at", DESCENDING)]).to_list(500)
    items = []
    for row in rows:
        novel = await db.novels.find_one({"_id": row["novel_id"], "status": "published"})
        if novel:
            items.append(novel_out(novel))
    return items


@api_router.post("/novels/{novel_id}/save")
async def save_novel(novel_id: str, user: dict = Depends(current_user)):
    nid = oid(novel_id, "novel id")
    if not await db.novels.find_one({"_id": nid, "status": "published"}):
        raise HTTPException(404, "Novel not found")
    await db.saved_novels.update_one(
        {"user_id": user["_id"], "novel_id": nid},
        {"$setOnInsert": {"saved_at": now_utc()}},
        upsert=True,
    )
    return {"saved": True}


@api_router.delete("/novels/{novel_id}/save")
async def unsave_novel(novel_id: str, user: dict = Depends(current_user)):
    await db.saved_novels.delete_one({"user_id": user["_id"], "novel_id": oid(novel_id, "novel id")})
    return {"saved": False}


# ---------------------------------------------------------------- chapter completion
@api_router.post("/me/chapters/{chapter_id}/complete")
async def complete_chapter(chapter_id: str, user: dict = Depends(current_user)):
    cid = oid(chapter_id, "chapter id")
    chapter = await db.chapters.find_one({"_id": cid})
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    novel = await db.novels.find_one({"_id": chapter["novel_id"], "status": "published"})
    if not novel:
        raise HTTPException(404, "Chapter not found")
    await db.chapter_completions.update_one(
        {"user_id": user["_id"], "chapter_id": cid},
        {
            "$set": {"novel_id": chapter["novel_id"]},
            "$setOnInsert": {"completed_at": now_utc()},
        },
        upsert=True,
    )
    return {"completed": True}


@api_router.get("/me/novels/{novel_id}/completed")
async def completed_chapters(novel_id: str, user: dict = Depends(current_user)):
    nid = oid(novel_id, "novel id")
    rows = await db.chapter_completions.find(
        {"user_id": user["_id"], "novel_id": nid}
    ).to_list(5000)
    return {"chapter_ids": [str(row["chapter_id"]) for row in rows]}


# ---------------------------------------------------------------- timestamp bookmarks
def bookmark_out(doc: dict, chapter: Optional[dict] = None) -> dict:
    return {
        "id": str(doc["_id"]),
        "novel_id": str(doc["novel_id"]),
        "chapter_id": str(doc["chapter_id"]),
        "position_seconds": doc.get("position_seconds", 0),
        "chapter_number": (chapter or {}).get("chapter_number"),
        "chapter_title": (chapter or {}).get("title"),
        "created_at": doc.get("created_at"),
    }


@api_router.post("/me/bookmarks", status_code=201)
async def create_bookmark(body: BookmarkBody, user: dict = Depends(current_user)):
    nid = oid(body.novel_id, "novel id")
    cid = oid(body.chapter_id, "chapter id")
    chapter = await db.chapters.find_one({"_id": cid, "novel_id": nid})
    if not chapter:
        raise HTTPException(404, "Chapter not found")

    position = float(body.position_seconds)
    # Tapping the bookmark button twice in a row should not create two rows.
    near = await db.audio_bookmarks.find_one(
        {
            "user_id": user["_id"],
            "chapter_id": cid,
            "position_seconds": {
                "$gte": position - BOOKMARK_DEDUPE_SECONDS,
                "$lte": position + BOOKMARK_DEDUPE_SECONDS,
            },
        }
    )
    if near:
        return bookmark_out(near, chapter)

    doc = AudioBookmark(
        user_id=str(user["_id"]),
        novel_id=body.novel_id,
        chapter_id=body.chapter_id,
        position_seconds=position,
    ).to_mongo()
    doc["user_id"] = user["_id"]
    doc["novel_id"] = nid
    doc["chapter_id"] = cid
    result = await db.audio_bookmarks.insert_one(doc)
    doc["_id"] = result.inserted_id
    return bookmark_out(doc, chapter)


@api_router.get("/me/novels/{novel_id}/bookmarks")
async def list_bookmarks(novel_id: str, user: dict = Depends(current_user)):
    nid = oid(novel_id, "novel id")
    rows = (
        await db.audio_bookmarks.find({"user_id": user["_id"], "novel_id": nid})
        .sort([("created_at", DESCENDING)])
        .to_list(500)
    )
    chapters = await db.chapters.find({"novel_id": nid}).to_list(5000)
    by_id = {str(c["_id"]): c for c in chapters}
    return [bookmark_out(row, by_id.get(str(row["chapter_id"]))) for row in rows]


@api_router.delete("/me/bookmarks/{bookmark_id}")
async def delete_bookmark(bookmark_id: str, user: dict = Depends(current_user)):
    result = await db.audio_bookmarks.delete_one(
        {"_id": oid(bookmark_id, "bookmark id"), "user_id": user["_id"]}
    )
    if result.deleted_count == 0:
        raise HTTPException(404, "Bookmark not found")
    return {"deleted": True}


# ---------------------------------------------------------------- spoiler-safe catch-up
@api_router.get("/me/novels/{novel_id}/catchup")
async def novel_catchup(novel_id: str, user: dict = Depends(current_user)):
    nid = oid(novel_id, "novel id")
    empty = {
        "available": False,
        "last_listened_at": None,
        "days_since": None,
        "through_chapter": None,
        "text": "",
    }
    progress = await db.listening_progress.find_one({"user_id": user["_id"], "novel_id": nid})
    if not progress:
        return empty

    away = days_since(progress.get("updated_at"))
    completions = await db.chapter_completions.find(
        {"user_id": user["_id"], "novel_id": nid}
    ).to_list(5000)
    # The chapter currently in progress is never summarised — that would spoil it.
    current = progress.get("chapter_id")
    completed_ids = [c["chapter_id"] for c in completions if c["chapter_id"] != current]
    if not completed_ids:
        return {**empty, "last_listened_at": progress.get("updated_at"), "days_since": away}

    chapters = (
        await db.chapters.find({"_id": {"$in": completed_ids}, "recap_text": {"$nin": ["", None]}})
        .sort([("chapter_number", ASCENDING)])
        .to_list(5000)
    )
    recent = chapters[-CATCHUP_MAX_CHAPTERS:]

    selected: List[dict] = []
    words = 0
    for chapter in reversed(recent):
        recap = (chapter.get("recap_text") or "").strip()
        if not recap:
            continue
        count = len(recap.split())
        if selected and words + count > CATCHUP_MAX_WORDS:
            break
        selected.append(chapter)
        words += count
        if words >= CATCHUP_MIN_WORDS:
            break
    selected.reverse()

    text = " ".join((c.get("recap_text") or "").strip() for c in selected).strip()
    return {
        "available": bool(text) and (away or 0) >= CATCHUP_MIN_DAYS,
        "last_listened_at": progress.get("updated_at"),
        "days_since": away,
        "through_chapter": selected[-1].get("chapter_number") if selected else None,
        "text": f"Previously… {text}" if text else "",
    }


# ---------------------------------------------------------------- analytics
@api_router.post("/events", status_code=202)
async def track_event(body: EventBody, user: Optional[dict] = Depends(optional_user)):
    if body.event not in ALLOWED_EVENTS:
        raise HTTPException(400, "Unknown event")
    properties = dict(list((body.properties or {}).items())[:20])
    doc = {
        "user_id": user["_id"] if user else None,
        "event": body.event,
        "novel_id": oid(body.novel_id, "novel id") if body.novel_id else None,
        "chapter_id": oid(body.chapter_id, "chapter id") if body.chapter_id else None,
        "properties": properties,
        "created_at": now_utc(),
    }
    await db.analytics_events.insert_one(doc)
    return {"ok": True}


# ---------------------------------------------------------------- community requests
@api_router.get("/requests")
async def list_requests(
    q: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    user: Optional[dict] = Depends(optional_user),
):
    query: Dict[str, Any] = {}
    if q and q.strip():
        rx = safe_regex(q)
        query["$or"] = [{"title": rx}, {"alt_title": rx}]
    docs = (
        await db.community_requests.find(query)
        .sort([("vote_count", DESCENDING), ("created_at", DESCENDING)])
        .limit(limit)
        .to_list(limit)
    )
    uid = str(user["_id"]) if user else None
    return [request_out(d, uid) for d in docs]


@api_router.post("/requests", status_code=201)
async def create_request(body: RequestCreateBody, user: dict = Depends(current_user)):
    title = body.title.strip()
    existing = await db.community_requests.find_one({"title": safe_regex(title, anchored=True)})
    if existing:
        await db.community_requests.update_one(
            {"_id": existing["_id"]},
            {"$addToSet": {"voters": user["_id"]}, "$set": {"updated_at": now_utc()}},
        )
        fresh = await db.community_requests.find_one({"_id": existing["_id"]})
        await db.community_requests.update_one(
            {"_id": existing["_id"]}, {"$set": {"vote_count": len(fresh.get("voters", []))}}
        )
        fresh = await db.community_requests.find_one({"_id": existing["_id"]})
        return request_out(fresh, str(user["_id"]))

    req = CommunityRequest(
        title=title,
        alt_title=(body.alt_title or "").strip() or None,
        submitted_by=str(user["_id"]),
        voters=[str(user["_id"])],
        vote_count=1,
    )
    doc = req.to_mongo()
    doc["submitted_by"] = user["_id"]
    doc["voters"] = [user["_id"]]
    result = await db.community_requests.insert_one(doc)
    doc["_id"] = result.inserted_id
    return request_out(doc, str(user["_id"]))


@api_router.post("/requests/{request_id}/vote")
async def vote_request(request_id: str, user: dict = Depends(current_user)):
    rid = oid(request_id, "request id")
    req = await db.community_requests.find_one({"_id": rid})
    if not req:
        raise HTTPException(404, "Request not found")
    await db.community_requests.update_one(
        {"_id": rid}, {"$addToSet": {"voters": user["_id"]}, "$set": {"updated_at": now_utc()}}
    )
    fresh = await db.community_requests.find_one({"_id": rid})
    await db.community_requests.update_one(
        {"_id": rid}, {"$set": {"vote_count": len(fresh.get("voters", []))}}
    )
    fresh = await db.community_requests.find_one({"_id": rid})
    return request_out(fresh, str(user["_id"]))


@api_router.get("/me/requests")
async def my_requests(user: dict = Depends(current_user)):
    docs = (
        await db.community_requests.find(
            {"$or": [{"submitted_by": user["_id"]}, {"voters": user["_id"]}]}
        )
        .sort([("updated_at", DESCENDING)])
        .to_list(200)
    )
    return [request_out(d, str(user["_id"])) for d in docs]


@api_router.get("/pro/features")
async def pro_features():
    return {
        "status": "coming_soon",
        "features": [
            {"title": "Anytime requests", "description": "Skip the vote queue — request any novel, any time."},
            {"title": "Private EPUB audiobooks", "description": "Upload your own EPUB and get a private narrated audiobook."},
            {"title": "Priority narration", "description": "Your picks get produced first, with premium voices."},
            {"title": "Unlimited downloads", "description": "Keep entire volumes offline with no chapter cap."},
        ],
    }


# ---------------------------------------------------------------- push notifications
push_client = httpx.AsyncClient(
    base_url=PUSH_BASE_URL,
    headers={"X-Push-Key": PUSH_KEY},
    timeout=10.0,
)


@api_router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody, user: dict = Depends(current_user)):
    # The user id always comes from the bearer token — never from the request body.
    payload = {**body.model_dump(), "user_id": str(user["_id"])}
    await db.push_tokens.update_one(
        {"user_id": user["_id"], "device_token": body.device_token},
        {
            "$set": {"platform": body.platform, "updated_at": now_utc()},
            "$setOnInsert": {"created_at": now_utc()},
        },
        upsert=True,
    )
    resp = await push_client.post("/api/v1/push/users/register", json=payload)
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()
    return {"status": "registered"}


async def send_push(
    recipients: List[str],
    data: dict,
    idempotency_key: Optional[str] = None,
) -> None:
    if not recipients:
        return
    if len(recipients) > 100:
        raise ValueError("max 100 recipients per /trigger call; chunk before sending")
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    payload: dict = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    resp = await push_client.post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 401:
        raise HTTPException(500, "EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(502, "Push provider unavailable")
    resp.raise_for_status()


# ---------------------------------------------------------------- media
@api_router.get("/media/{path:path}")
async def media(path: str, request: Request):
    safe_path = validate_storage_path(path)
    try:
        data, raw_ctype = await run_in_threadpool(get_object, safe_path)
    except Exception as exc:  # storage returns 500 for missing objects
        logger.warning("media fetch failed for %s: %s", safe_path, exc)
        raise HTTPException(404, "File not found")

    ctype = (raw_ctype or "").split(";")[0].strip().lower()
    if ctype not in SERVABLE_TYPES:
        ctype = "application/octet-stream"

    total = len(data)
    range_header = request.headers.get("range")
    if range_header and range_header.startswith("bytes="):
        spec = range_header[6:].split("-")
        try:
            start = int(spec[0]) if spec[0] else 0
            end = int(spec[1]) if len(spec) > 1 and spec[1] else total - 1
        except ValueError:
            start, end = 0, total - 1
        start = max(0, min(start, total - 1))
        end = max(start, min(end, total - 1))
        chunk = data[start : end + 1]
        return Response(
            content=chunk,
            status_code=206,
            media_type=ctype,
            headers={
                "Content-Range": f"bytes {start}-{end}/{total}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(len(chunk)),
                "Cache-Control": "public, max-age=86400",
                "X-Content-Type-Options": "nosniff",
            },
        )
    return Response(
        content=data,
        media_type=ctype,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(total),
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
        },
    )


async def store_upload(file: UploadFile, folder: str, owner: str, kind: str) -> tuple:
    """Streams an upload to object storage with a size cap and a content-type allowlist."""
    allowed = AUDIO_TYPES if kind == "audio" else IMAGE_TYPES
    limit = MAX_AUDIO_BYTES if kind == "audio" else MAX_IMAGE_BYTES
    ctype = (
        file.content_type
        or mimetypes.guess_type(file.filename or "")[0]
        or "application/octet-stream"
    ).split(";")[0].strip().lower()
    if ctype not in allowed:
        raise HTTPException(415, f"Unsupported file type: {ctype}")

    chunks: List[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(413, f"File too large (max {limit // (1024 * 1024)} MB)")
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise HTTPException(400, "Empty file")

    # Extension is derived from the validated content type, never from the client filename.
    ext = allowed[ctype]
    path = f"{APP_NAME}/{folder}/{owner}/{uuid.uuid4().hex}{ext}"
    await run_in_threadpool(put_object, path, data, ctype)
    return f"/api/media/{path}", total


# ---------------------------------------------------------------- admin: novels
@api_router.post("/admin/novels", status_code=201)
async def admin_create_novel(body: NovelBody, _: dict = Depends(require_admin)):
    novel = Novel(**body.model_dump())
    doc = novel.to_mongo()
    result = await db.novels.insert_one(doc)
    doc["_id"] = result.inserted_id
    return novel_out(doc)


@api_router.put("/admin/novels/{novel_id}")
async def admin_update_novel(novel_id: str, body: NovelPatchBody, _: dict = Depends(require_admin)):
    nid = oid(novel_id, "novel id")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "Nothing to update")
    updates["updated_at"] = now_utc()
    result = await db.novels.update_one({"_id": nid}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(404, "Novel not found")
    return novel_out(await db.novels.find_one({"_id": nid}))


@api_router.delete("/admin/novels/{novel_id}")
async def admin_delete_novel(novel_id: str, _: dict = Depends(require_admin)):
    nid = oid(novel_id, "novel id")
    await db.chapters.delete_many({"novel_id": nid})
    await db.volumes.delete_many({"novel_id": nid})
    await db.saved_novels.delete_many({"novel_id": nid})
    await db.listening_progress.delete_many({"novel_id": nid})
    await db.chapter_completions.delete_many({"novel_id": nid})
    await db.audio_bookmarks.delete_many({"novel_id": nid})
    result = await db.novels.delete_one({"_id": nid})
    if result.deleted_count == 0:
        raise HTTPException(404, "Novel not found")
    return {"deleted": True}


@api_router.post("/admin/novels/{novel_id}/cover")
async def admin_upload_cover(
    novel_id: str, file: UploadFile = File(...), _: dict = Depends(require_admin)
):
    nid = oid(novel_id, "novel id")
    if not await db.novels.find_one({"_id": nid}):
        raise HTTPException(404, "Novel not found")
    url, _size = await store_upload(file, "covers", novel_id, kind="image")
    await db.novels.update_one({"_id": nid}, {"$set": {"cover_image_url": url, "updated_at": now_utc()}})
    return {"cover_image_url": url}


@api_router.put("/admin/novels/{novel_id}/publish")
async def admin_publish(novel_id: str, _: dict = Depends(require_admin)):
    nid = oid(novel_id, "novel id")
    result = await db.novels.update_one(
        {"_id": nid}, {"$set": {"status": "published", "updated_at": now_utc()}}
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Novel not found")
    return novel_out(await db.novels.find_one({"_id": nid}))


@api_router.put("/admin/novels/{novel_id}/unpublish")
async def admin_unpublish(novel_id: str, _: dict = Depends(require_admin)):
    nid = oid(novel_id, "novel id")
    result = await db.novels.update_one(
        {"_id": nid}, {"$set": {"status": "draft", "updated_at": now_utc()}}
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Novel not found")
    return novel_out(await db.novels.find_one({"_id": nid}))


@api_router.get("/admin/novels")
async def admin_list_novels(_: dict = Depends(require_admin)):
    docs = await db.novels.find().sort([("created_at", DESCENDING)]).to_list(500)
    return [admin_novel_out(d) for d in docs]


@api_router.put("/admin/novels/{novel_id}/anime-mappings")
async def admin_set_anime_mappings(
    novel_id: str, body: AnimeMappingsBody, _: dict = Depends(require_admin)
):
    nid = oid(novel_id, "novel id")
    if not await db.novels.find_one({"_id": nid}):
        raise HTTPException(404, "Novel not found")

    mappings: List[Dict[str, Any]] = []
    for mapping in body.mappings:
        cid = oid(mapping.continue_chapter_id, "continue_chapter_id")
        if not await db.chapters.find_one({"_id": cid, "novel_id": nid}):
            raise HTTPException(400, f"Chapter {mapping.continue_chapter_id} is not part of this novel")
        mappings.append(
            {
                "label": mapping.label.strip(),
                "through_episode": mapping.through_episode,
                "continue_chapter_id": cid,
                "note": (mapping.note or "").strip() or None,
            }
        )

    await db.novels.update_one(
        {"_id": nid}, {"$set": {"anime_mappings": mappings, "updated_at": now_utc()}}
    )
    return admin_novel_out(await db.novels.find_one({"_id": nid}))


@api_router.get("/admin/novels/{novel_id}/cast")
async def admin_get_cast(novel_id: str, _: dict = Depends(require_admin)):
    nid = oid(novel_id, "novel id")
    novel = await db.novels.find_one({"_id": nid})
    if not novel:
        raise HTTPException(404, "Novel not found")
    return {
        "novel_id": novel_id,
        "narration_mode": novel.get("narration_mode", "single"),
        "cast": novel.get("cast", []),
    }


@api_router.put("/admin/novels/{novel_id}/cast")
async def admin_set_cast(novel_id: str, body: CastBody, _: dict = Depends(require_admin)):
    nid = oid(novel_id, "novel id")
    if not await db.novels.find_one({"_id": nid}):
        raise HTTPException(404, "Novel not found")
    cast = [member.model_dump() for member in body.cast]
    await db.novels.update_one(
        {"_id": nid},
        {"$set": {"narration_mode": body.narration_mode, "cast": cast, "updated_at": now_utc()}},
    )
    return {"novel_id": novel_id, "narration_mode": body.narration_mode, "cast": cast}


# ---------------------------------------------------------------- admin: volumes
@api_router.post("/admin/novels/{novel_id}/volumes", status_code=201)
async def admin_create_volume(novel_id: str, body: VolumeBody, _: dict = Depends(require_admin)):
    nid = oid(novel_id, "novel id")
    if not await db.novels.find_one({"_id": nid}):
        raise HTTPException(404, "Novel not found")
    vol = Volume(novel_id=novel_id, volume_number=body.volume_number, cover_image_url=body.cover_image_url)
    doc = vol.to_mongo()
    doc["novel_id"] = nid
    result = await db.volumes.insert_one(doc)
    return {
        "id": str(result.inserted_id),
        "novel_id": novel_id,
        "volume_number": body.volume_number,
        "cover_image_url": body.cover_image_url,
        "chapters": [],
    }


@api_router.put("/admin/volumes/{volume_id}")
async def admin_update_volume(volume_id: str, body: VolumeBody, _: dict = Depends(require_admin)):
    vid = oid(volume_id, "volume id")
    updates: Dict[str, Any] = {"volume_number": body.volume_number}
    if body.cover_image_url is not None:
        updates["cover_image_url"] = body.cover_image_url
    result = await db.volumes.update_one({"_id": vid}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(404, "Volume not found")
    vol = await db.volumes.find_one({"_id": vid})
    return {
        "id": volume_id,
        "novel_id": str(vol["novel_id"]),
        "volume_number": vol.get("volume_number"),
        "cover_image_url": vol.get("cover_image_url"),
    }


@api_router.delete("/admin/volumes/{volume_id}")
async def admin_delete_volume(volume_id: str, _: dict = Depends(require_admin)):
    vid = oid(volume_id, "volume id")
    vol = await db.volumes.find_one({"_id": vid})
    if not vol:
        raise HTTPException(404, "Volume not found")
    await db.chapters.delete_many({"volume_id": vid})
    await db.volumes.delete_one({"_id": vid})
    await recount_novel(vol["novel_id"])
    return {"deleted": True}


# ---------------------------------------------------------------- admin: chapters
@api_router.post("/admin/volumes/{volume_id}/chapters", status_code=201)
async def admin_create_chapter(
    volume_id: str,
    chapter_number: int = Form(...),
    title: str = Form(...),
    duration_seconds: int = Form(0),
    recap_text: str = Form(""),
    audio_url: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    _: dict = Depends(require_admin),
):
    vid = oid(volume_id, "volume id")
    vol = await db.volumes.find_one({"_id": vid})
    if not vol:
        raise HTTPException(404, "Volume not found")

    size = 0
    if file is not None:
        url, size = await store_upload(file, "audio", volume_id, kind="audio")
    elif audio_url:
        url = audio_url
    else:
        raise HTTPException(400, "Provide an MP3 file or audio_url")

    chapter = Chapter(
        volume_id=volume_id,
        novel_id=str(vol["novel_id"]),
        chapter_number=chapter_number,
        title=title,
        audio_file_url=url,
        duration_seconds=duration_seconds,
        file_size_bytes=size,
        recap_text=recap_text.strip(),
    )
    doc = chapter.to_mongo()
    doc["volume_id"] = vid
    doc["novel_id"] = vol["novel_id"]
    result = await db.chapters.insert_one(doc)
    doc["_id"] = result.inserted_id
    await recount_novel(vol["novel_id"])
    return admin_chapter_out(doc)


@api_router.put("/admin/chapters/{chapter_id}")
async def admin_update_chapter(chapter_id: str, body: ChapterPatchBody, _: dict = Depends(require_admin)):
    cid = oid(chapter_id, "chapter id")
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(400, "Nothing to update")
    result = await db.chapters.update_one({"_id": cid}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(404, "Chapter not found")
    ch = await db.chapters.find_one({"_id": cid})
    await recount_novel(ch["novel_id"])
    return admin_chapter_out(ch)


@api_router.delete("/admin/chapters/{chapter_id}")
async def admin_delete_chapter(chapter_id: str, _: dict = Depends(require_admin)):
    cid = oid(chapter_id, "chapter id")
    ch = await db.chapters.find_one({"_id": cid})
    if not ch:
        raise HTTPException(404, "Chapter not found")
    await db.chapters.delete_one({"_id": cid})
    await db.chapter_completions.delete_many({"chapter_id": cid})
    await db.audio_bookmarks.delete_many({"chapter_id": cid})
    await recount_novel(ch["novel_id"])
    return {"deleted": True}


@api_router.post("/admin/chapters/{chapter_id}/audio")
async def admin_replace_audio(
    chapter_id: str,
    duration_seconds: Optional[int] = Form(None),
    file: UploadFile = File(...),
    _: dict = Depends(require_admin),
):
    cid = oid(chapter_id, "chapter id")
    ch = await db.chapters.find_one({"_id": cid})
    if not ch:
        raise HTTPException(404, "Chapter not found")
    url, size = await store_upload(file, "audio", str(ch["volume_id"]), kind="audio")
    updates: Dict[str, Any] = {"audio_file_url": url, "file_size_bytes": size}
    if duration_seconds is not None:
        updates["duration_seconds"] = duration_seconds
    await db.chapters.update_one({"_id": cid}, {"$set": updates})
    await recount_novel(ch["novel_id"])
    return admin_chapter_out(await db.chapters.find_one({"_id": cid}))


# ---------------------------------------------------------------- admin: illustrations
@api_router.post("/admin/chapters/{chapter_id}/illustrations", status_code=201)
async def admin_add_illustration(
    chapter_id: str,
    timestamp_seconds: int = Form(...),
    caption: Optional[str] = Form(None),
    file: UploadFile = File(...),
    _: dict = Depends(require_admin),
):
    cid = oid(chapter_id, "chapter id")
    chapter = await db.chapters.find_one({"_id": cid})
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    url, _size = await store_upload(file, "illustrations", chapter_id, kind="image")
    item = {
        "id": uuid.uuid4().hex,
        "timestamp_seconds": max(0, timestamp_seconds),
        "image_url": url,
        "caption": (caption or "").strip() or None,
    }
    await db.chapters.update_one({"_id": cid}, {"$push": {"illustrations": item}})
    return item


@api_router.delete("/admin/chapters/{chapter_id}/illustrations/{illustration_id}")
async def admin_delete_illustration(
    chapter_id: str, illustration_id: str, _: dict = Depends(require_admin)
):
    cid = oid(chapter_id, "chapter id")
    result = await db.chapters.update_one(
        {"_id": cid}, {"$pull": {"illustrations": {"id": illustration_id}}}
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Chapter not found")
    return {"deleted": True}


# ---------------------------------------------------------------- admin: requests & users
@api_router.get("/admin/requests/community")
async def admin_list_requests(_: dict = Depends(require_admin)):
    docs = (
        await db.community_requests.find()
        .sort([("vote_count", DESCENDING), ("created_at", DESCENDING)])
        .to_list(500)
    )
    return [request_out(d, None) for d in docs]


@api_router.put("/admin/requests/community/{request_id}")
async def admin_update_request(
    request_id: str, body: AdminRequestPatchBody, _: dict = Depends(require_admin)
):
    rid = oid(request_id, "request id")
    previous = await db.community_requests.find_one({"_id": rid})
    if not previous:
        raise HTTPException(404, "Request not found")

    updates: Dict[str, Any] = {"updated_at": now_utc()}
    if body.status is not None:
        if body.status not in {"requested", "selected", "processing", "published", "rejected"}:
            raise HTTPException(400, "Invalid status")
        updates["status"] = body.status
    if body.alt_title is not None:
        updates["alt_title"] = body.alt_title
    if body.cover_image_url is not None:
        updates["cover_image_url"] = body.cover_image_url
    if body.genres is not None:
        updates["genres"] = body.genres
    if body.linked_novel_id is not None:
        updates["linked_novel_id"] = oid(body.linked_novel_id, "novel id")
    await db.community_requests.update_one({"_id": rid}, {"$set": updates})
    fresh = await db.community_requests.find_one({"_id": rid})

    # Tell everyone who voted for it — they are almost certainly not in the app.
    if body.status == "published" and previous.get("status") != "published":
        voters = [str(v) for v in previous.get("voters", [])]
        linked = fresh.get("linked_novel_id")
        action_url = f"/novel/{linked}" if linked else "/requests"
        for start in range(0, len(voters), 100):
            try:
                await send_push(
                    recipients=voters[start : start + 100],
                    data={
                        "title": f"{previous.get('title', 'Your request')} is ready",
                        "message": "The novel you voted for is now available.",
                        "action_url": action_url,
                    },
                    idempotency_key=f"request-published-{request_id}-{start}",
                )
            except Exception as exc:
                logger.warning("Push failed (non-blocking): %s", exc)

    return request_out(fresh, None)


@api_router.delete("/admin/requests/community/{request_id}")
async def admin_delete_request(request_id: str, _: dict = Depends(require_admin)):
    result = await db.community_requests.delete_one({"_id": oid(request_id, "request id")})
    if result.deleted_count == 0:
        raise HTTPException(404, "Request not found")
    return {"deleted": True}


@api_router.get("/admin/users")
async def admin_list_users(q: Optional[str] = None, _: dict = Depends(require_admin)):
    query: Dict[str, Any] = {}
    if q:
        rx = safe_regex(q)
        query["$or"] = [{"email": rx}, {"display_name": rx}]
    docs = await db.users.find(query).sort([("created_at", DESCENDING)]).to_list(500)
    return [user_out(d) for d in docs]


@api_router.get("/admin/users/{user_id}")
async def admin_user_detail(user_id: str, _: dict = Depends(require_admin)):
    uid = oid(user_id, "user id")
    user = await db.users.find_one({"_id": uid})
    if not user:
        raise HTTPException(404, "User not found")
    sub = await db.subscriptions.find_one({"user_id": uid})
    saved = await db.saved_novels.count_documents({"user_id": uid})
    listening = await db.listening_progress.count_documents({"user_id": uid})
    return {
        **user_out(user),
        "subscription": {
            "plan": sub.get("plan") if sub else "free",
            "status": sub.get("status") if sub else "active",
            "expires_at": sub.get("expires_at") if sub else None,
        },
        "saved_count": saved,
        "listening_count": listening,
    }


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Range", "Accept-Ranges", "Content-Length"],
)


# ---------------------------------------------------------------- startup
DEMO_COVER = "https://images.pexels.com/photos/10109585/pexels-photo-10109585.jpeg"
DEMO_CHAPTERS = [
    ("The Night the Stars Fell", "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3", 372),
    ("A Contract Written in Moonlight", "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3", 425),
    ("The Sage Who Forgot His Name", "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3", 336),
]


async def seed_admin() -> None:
    email = ADMIN_EMAIL.lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        await db.users.update_one({"_id": existing["_id"]}, {"$set": {"role": "admin"}})
        return
    admin = User(
        email=email,
        password_hash=hash_password(ADMIN_PASSWORD),
        display_name="LightListen Admin",
        role="admin",
    )
    await db.users.insert_one(admin.to_mongo())
    logger.info("Seeded admin user %s", email)


async def seed_demo_novel() -> None:
    if await db.novels.count_documents({}) > 0:
        return
    novel = Novel(
        title="Reincarnated as the Last Star Sage",
        alt_title="Hoshi no Kenja Saigo no Tensei",
        author="Ayaka Mizushiro",
        description=(
            "Kaito dies on a rain-soaked Tokyo street and wakes in Aureth, a kingdom where "
            "constellations are spells and the last Star Sage has just been executed for treason. "
            "Bound to a dying star's memory, he must learn a magic the world has outlawed — before "
            "the sky itself goes dark."
        ),
        genres=["Isekai", "Fantasy", "Adventure", "Magic"],
        cover_image_url=DEMO_COVER,
        status="published",
    )
    doc = novel.to_mongo()
    novel_result = await db.novels.insert_one(doc)
    nid = novel_result.inserted_id

    vol_doc = Volume(novel_id=str(nid), volume_number=1).to_mongo()
    vol_doc["novel_id"] = nid
    vol_result = await db.volumes.insert_one(vol_doc)
    vid = vol_result.inserted_id

    for index, (title, url, duration) in enumerate(DEMO_CHAPTERS, start=1):
        ch_doc = Chapter(
            volume_id=str(vid),
            novel_id=str(nid),
            chapter_number=index,
            title=title,
            audio_file_url=url,
            duration_seconds=duration,
            file_size_bytes=duration * 16000,
        ).to_mongo()
        ch_doc["volume_id"] = vid
        ch_doc["novel_id"] = nid
        await db.chapters.insert_one(ch_doc)

    await recount_novel(nid)
    logger.info("Seeded demo novel %s", nid)


DEMO_RECAPS = [
    "Kaito died on a Tokyo crosswalk and woke in Aureth, where a dying star bound its memory to "
    "him moments after the last Star Sage was executed for treason.",
    "Hiding in the ruined observatory, Kaito signed a moonlight contract with the star-spirit Vela "
    "and traded a year of his life for the first outlawed constellation glyph.",
    "The royal inquisitors named Kaito a heretic, so Vela burned his old name away — the sky now "
    "answers only to the Sage who forgot who he was.",
]
DEMO_ILLUSTRATIONS = [
    (0, "Kaito wakes beneath the falling stars", "https://images.pexels.com/photos/1257860/pexels-photo-1257860.jpeg"),
    (95, "The ruined observatory of Aureth", "https://images.pexels.com/photos/816608/pexels-photo-816608.jpeg"),
]
DEMO_CAST = [
    {"character": "Kaito", "provider": "in_house", "voice_id": "ll_kaito_01", "voice_label": "Ren (young male)"},
    {"character": "Vela", "provider": "in_house", "voice_id": "ll_vela_01", "voice_label": "Suzu (ethereal female)"},
    {"character": "Narrator", "provider": "in_house", "voice_id": "ll_narr_01", "voice_label": "Kenji (warm baritone)"},
]


async def seed_demo_extras() -> None:
    """Backfill the demo novel with anime mappings, cast, recaps and illustrations.

    Idempotent: only writes fields that are still empty, so admin edits are never clobbered.
    """
    novel = await db.novels.find_one({"title": "Reincarnated as the Last Star Sage"})
    if not novel:
        return
    chapters = (
        await db.chapters.find({"novel_id": novel["_id"]})
        .sort([("chapter_number", ASCENDING)])
        .to_list(100)
    )
    if not chapters:
        return

    novel_set: Dict[str, Any] = {}
    if not novel.get("anime_mappings"):
        novel_set["anime_mappings"] = [
            {
                "label": "Finished the anime (Season 1)",
                "through_episode": 12,
                "continue_chapter_id": chapters[min(1, len(chapters) - 1)]["_id"],
                "note": "Season 1 ends mid-volume 1 — start here to skip what you already watched.",
            },
            {
                "label": "Saw the movie only",
                "through_episode": None,
                "continue_chapter_id": chapters[-1]["_id"],
                "note": "The film compresses the observatory arc; jump straight to the fallout.",
            },
        ]
    if not novel.get("cast"):
        novel_set["cast"] = DEMO_CAST
        novel_set["narration_mode"] = "full_cast"
    if novel_set:
        novel_set["updated_at"] = now_utc()
        await db.novels.update_one({"_id": novel["_id"]}, {"$set": novel_set})

    for index, chapter in enumerate(chapters):
        updates: Dict[str, Any] = {}
        if not (chapter.get("recap_text") or "").strip() and index < len(DEMO_RECAPS):
            updates["recap_text"] = DEMO_RECAPS[index]
        if index == 0 and not chapter.get("illustrations"):
            updates["illustrations"] = [
                {
                    "id": uuid.uuid4().hex,
                    "timestamp_seconds": seconds,
                    "image_url": url,
                    "caption": caption,
                }
                for seconds, caption, url in DEMO_ILLUSTRATIONS
            ]
        if updates:
            await db.chapters.update_one({"_id": chapter["_id"]}, {"$set": updates})
    logger.info("Demo novel extras ensured")


@app.on_event("startup")
async def on_startup() -> None:
    await db.users.create_index([("email", ASCENDING)], unique=True)
    await db.novels.create_index([("status", ASCENDING), ("created_at", DESCENDING)])
    await db.novels.create_index([("title", TEXT), ("alt_title", TEXT), ("author", TEXT)])
    await db.volumes.create_index([("novel_id", ASCENDING), ("volume_number", ASCENDING)])
    await db.chapters.create_index([("novel_id", ASCENDING), ("chapter_number", ASCENDING)])
    await db.chapters.create_index([("volume_id", ASCENDING), ("chapter_number", ASCENDING)])
    await db.listening_progress.create_index(
        [("user_id", ASCENDING), ("novel_id", ASCENDING)], unique=True
    )
    await db.listening_progress.create_index([("user_id", ASCENDING), ("updated_at", DESCENDING)])
    await db.saved_novels.create_index([("user_id", ASCENDING), ("novel_id", ASCENDING)], unique=True)
    await db.community_requests.create_index([("vote_count", DESCENDING)])
    await db.community_requests.create_index([("title", TEXT), ("alt_title", TEXT)])
    await db.chapter_completions.create_index(
        [("user_id", ASCENDING), ("chapter_id", ASCENDING)], unique=True
    )
    await db.chapter_completions.create_index([("user_id", ASCENDING), ("novel_id", ASCENDING)])
    await db.audio_bookmarks.create_index(
        [("user_id", ASCENDING), ("novel_id", ASCENDING), ("created_at", DESCENDING)]
    )
    await db.analytics_events.create_index([("event", ASCENDING), ("created_at", DESCENDING)])
    await db.analytics_events.create_index([("user_id", ASCENDING), ("created_at", DESCENDING)])
    await db.analytics_events.create_index([("novel_id", ASCENDING), ("created_at", DESCENDING)])
    await db.push_tokens.create_index(
        [("user_id", ASCENDING), ("device_token", ASCENDING)], unique=True
    )

    await seed_admin()
    await seed_demo_novel()
    await seed_demo_extras()

    try:
        await run_in_threadpool(init_storage)
        logger.info("Object storage initialised")
    except Exception as exc:
        logger.warning("Object storage init failed (uploads will retry lazily): %s", exc)


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await push_client.aclose()
    client.close()
