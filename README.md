# LightListen — Light Novel Audiobook App

Android-first audiobook app for light novels: a hand-curated catalog you control, chapter-level
offline downloads, community-voted novel requests, and a full-featured player.

- **App:** Expo SDK 54 · React Native · TypeScript · expo-router (file-based routes)
- **Backend:** FastAPI monolith — every route is prefixed with `/api`
- **Database:** MongoDB
- **Audio/Images:** Emergent-managed object storage, served through the backend at `/api/media/...`
- **Admin:** raw API endpoints (Postman / curl) — no admin UI by design

---

## 1. What the app does (feature list)

### Accounts
- Email + password signup and login (bcrypt hashed)
- JWT access + refresh tokens; the refresh token is kept in the device's secure store and rotated silently
- Profile screen with display name, email and plan badge
- Logout

### Catalog
- **Home:** "Continue listening" (horizontal, with progress bars and a resume button), "New this week",
  "Popular now", and a community-requests preview banner
- **Explore:** live search across **title, alternative title and author**, plus a single-row
  horizontal genre chip filter and a 2-column cover grid (3 columns on tablets)
- **Novel detail:** hero cover with gradient scrim, animated sticky header, genres, synopsis with
  read-more, stats (chapters / total runtime / plays), volume chips when a novel has more than one
  volume, and the full chapter list
- Only **published** novels are visible to users — drafts are admin-only

### Playback
- Streams chapter audio (or plays the local file if the chapter was downloaded)
- Play / pause, **−15s** and **+30s** seek, drag scrubber
- Playback speed: 0.75x, 1x, 1.25x, 1.5x, 1.75x, 2x
- Sleep timer: 15 / 30 / 45 / 60 minutes or "end of chapter"
- Previous / next chapter, auto-advance when a chapter ends, in-player chapter list
- **Persistent mini-player** on every screen (hidden only on the full-screen player and login screens)
- Listening position auto-saves roughly every 12 seconds and on pause/chapter change, so
  "Continue listening" resumes exactly where you stopped — even after closing the app
- "Playing offline" indicator when audio comes from a downloaded file

### Downloads & offline *(device only — not the web preview)*
- Download individual chapters with live percentage
- Offline-first playback: the local file wins over streaming
- **Storage screen:** grouped by novel with file sizes, delete a single chapter or every chapter of a novel
- Handles interrupted downloads (retry from the chapter row) and out-of-space errors gracefully
- Downloads whose files disappear (cache clear) are pruned automatically on next launch

### Library
- Tabs: **Continue** (resume in one tap) · **Saved** (bookmarked novels, unsave inline) · **Downloads**

### Community requests
- Search-first flow: type a title → fuzzy matches appear → **vote** on an existing request, or submit a new one
- One vote per user per request (idempotent — tapping again never double-counts)
- Requests are ranked by vote count and show a status badge:
  `Requested → Selected → In production → Published` (or `Not planned`)
- "My activity" tab lists everything you submitted or voted on; published requests link straight to the novel

### Pro (teaser only)
- "Coming soon" page listing the planned Pro perks (anytime requests, private EPUB audiobooks,
  priority narration, unlimited downloads). **No payment is collected — everything is free in the MVP.**

### Themes
- Three options in Profile → Appearance: **Bookish** (warm light), **Cinematic** (dark), **System**
- The choice is saved on the device and survives restarts

---

## 2. Admin credentials

| What | Value |
|---|---|
| Admin email | `admin@lightlisten.app` |
| Admin password | `LightListen_Admin_2026!` |
| Admin key header | `X-Admin-Key: ll_admin_9f2c47ba61d84e0fa3c5b8e7d1046a92` |

The admin account is created automatically when the backend starts.
Both values live in `/app/backend/.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_KEY`) — change them
there if you want, then restart the backend. Credentials are also mirrored in
`/app/memory/test_credentials.md`.

> **Every `/api/admin/*` request needs BOTH:**
> 1. `Authorization: Bearer <admin access token>` (from logging in as the admin)
> 2. `X-Admin-Key: <ADMIN_KEY>`
>
> Missing or wrong either one → `403`. No token at all → `401`.

### Base URL
- **Preview (now):** `https://5002be5b-5891-4b93-b775-12f7741b6711.preview.emergentagent.com/api`
- **After you hit Publish:** use the deployed backend URL shown in the deployment panel, same paths.

### Step 0 — get an admin token
```bash
BASE="https://5002be5b-5891-4b93-b775-12f7741b6711.preview.emergentagent.com/api"
KEY="ll_admin_9f2c47ba61d84e0fa3c5b8e7d1046a92"

TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@lightlisten.app","password":"LightListen_Admin_2026!"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

echo "$TOKEN"
```
Tokens last 2 hours (`ACCESS_MINUTES` in `/app/backend/.env`). Just log in again when it expires.

---

## 3. Adding a book, start to finish

The order is always: **novel → cover → volume → chapters → publish.**

```bash
# 1) Create the novel (it starts as a draft, invisible in the app)
NOVEL=$(curl -s -X POST "$BASE/admin/novels" \
  -H "Authorization: Bearer $TOKEN" -H "X-Admin-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{
        "title": "The Alchemist of the Silver Spire",
        "alt_title": "Gin no Toh no Renkinjutsushi",
        "author": "Rin Kotobuki",
        "description": "A disgraced alchemist is handed one last commission: rebuild the tower that killed her master.",
        "genres": ["Fantasy", "Adventure", "Magic"]
      }' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "novel id: $NOVEL"

# 2) Upload the cover image (jpg/png/webp, max 10 MB)
curl -s -X POST "$BASE/admin/novels/$NOVEL/cover" \
  -H "Authorization: Bearer $TOKEN" -H "X-Admin-Key: $KEY" \
  -F "file=@/path/to/cover.jpg"

# 3) Add volume 1
VOL=$(curl -s -X POST "$BASE/admin/novels/$NOVEL/volumes" \
  -H "Authorization: Bearer $TOKEN" -H "X-Admin-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"volume_number": 1}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "volume id: $VOL"

# 4) Add chapters — one call per chapter, uploading the MP3
curl -s -X POST "$BASE/admin/volumes/$VOL/chapters" \
  -H "Authorization: Bearer $TOKEN" -H "X-Admin-Key: $KEY" \
  -F "chapter_number=1" \
  -F "title=The Commission" \
  -F "duration_seconds=1284" \
  -F "file=@/path/to/chapter-01.mp3"

# 5) Publish — the novel appears in the app immediately
curl -s -X PUT "$BASE/admin/novels/$NOVEL/publish" \
  -H "Authorization: Bearer $TOKEN" -H "X-Admin-Key: $KEY"
```

### Notes that save time
- **`duration_seconds` is required for a nice UI** (chapter runtime, total runtime, progress bars).
  The server does not read MP3 metadata. Get it locally with:
  ```bash
  ffprobe -v error -show_entries format=duration -of csv=p=0 chapter-01.mp3
  ```
- **Already hosting your audio elsewhere?** Skip the file upload and pass a URL instead:
  ```bash
  -F "chapter_number=2" -F "title=Ash and Silver" -F "duration_seconds=1190" \
  -F "audio_url=https://cdn.example.com/ch02.mp3"
  ```
- **Upload limits:** audio max **200 MB** (`audio/mpeg`, `mp3`, `m4a`, `aac`, `wav`, `ogg`),
  images max **10 MB** (`png`, `jpeg`, `webp`). Anything else returns `415`.
- Uploaded files come back as a path like `/api/media/lightlisten/audio/<volume>/<uuid>.mp3`.
  The app resolves it against the backend URL automatically, so it keeps working after you deploy.
- Chapters are ordered by `chapter_number`, volumes by `volume_number` — numbers do not have to be contiguous.
- `chapter_count` and `total_duration_seconds` on the novel are recalculated automatically on every
  chapter add / edit / delete.
- Publishing is reversible: `PUT /admin/novels/{id}/unpublish` hides it again (progress and bookmarks survive).

---

## 4. Full admin endpoint reference

All paths below are relative to `/api` and require the admin token **and** `X-Admin-Key`.

### Novels
| Method | Path | Body / notes |
|---|---|---|
| `GET` | `/admin/novels` | Every novel, drafts included |
| `POST` | `/admin/novels` | `{title, alt_title?, author, description?, genres?[]}` → created as `draft` |
| `PUT` | `/admin/novels/{id}` | Any subset of `{title, alt_title, author, description, genres}` |
| `DELETE` | `/admin/novels/{id}` | Cascades: volumes, chapters, bookmarks, progress |
| `POST` | `/admin/novels/{id}/cover` | multipart `file=@cover.jpg` → `{cover_image_url}` |
| `PUT` | `/admin/novels/{id}/publish` | Makes it visible in the app |
| `PUT` | `/admin/novels/{id}/unpublish` | Back to draft |

### Volumes
| Method | Path | Body / notes |
|---|---|---|
| `POST` | `/admin/novels/{id}/volumes` | `{volume_number, cover_image_url?}` |
| `PUT` | `/admin/volumes/{id}` | `{volume_number, cover_image_url?}` |
| `DELETE` | `/admin/volumes/{id}` | Also deletes its chapters |

### Chapters
| Method | Path | Body / notes |
|---|---|---|
| `POST` | `/admin/volumes/{id}/chapters` | multipart: `chapter_number`, `title`, `duration_seconds`, **and** `file=@ch.mp3` *or* `audio_url=https://...` |
| `PUT` | `/admin/chapters/{id}` | JSON, any subset of `{chapter_number, title, duration_seconds}` |
| `DELETE` | `/admin/chapters/{id}` | |
| `POST` | `/admin/chapters/{id}/audio` | multipart `file=@new.mp3`, optional `duration_seconds` — replaces the audio |

### Community requests
| Method | Path | Body / notes |
|---|---|---|
| `GET` | `/admin/requests/community` | All requests, highest votes first |
| `PUT` | `/admin/requests/community/{id}` | `{status?, alt_title?, cover_image_url?, genres?[], linked_novel_id?}` — status ∈ `requested, selected, processing, published, rejected` |
| `DELETE` | `/admin/requests/community/{id}` | |

**Typical request workflow:** pick the top-voted request → `status: "selected"` → start narration →
`status: "processing"` → create + publish the novel → `status: "published"` with
`linked_novel_id: "<novel id>"`, which turns the request row into a link to the finished novel.

```bash
curl -s -X PUT "$BASE/admin/requests/community/<REQUEST_ID>" \
  -H "Authorization: Bearer $TOKEN" -H "X-Admin-Key: $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"status":"published","linked_novel_id":"'"$NOVEL"'","genres":["Fantasy"]}'
```

### Users
| Method | Path | Notes |
|---|---|---|
| `GET` | `/admin/users?q=` | List / search by email or display name |
| `GET` | `/admin/users/{id}` | Detail + plan (`free`), saved count, listening count |

---

## 5. Public endpoints (what the app itself calls)

| Method | Path | Auth |
|---|---|---|
| `POST` | `/auth/signup` · `/auth/login` · `/auth/refresh` | none |
| `GET` / `PUT` | `/auth/me` | user |
| `GET` | `/novels?q=&genre=&sort=new\|popular\|title&limit=&skip=` | none |
| `GET` | `/novels/{id}` | optional (adds `saved` + `progress`) |
| `GET` | `/novels/{id}/chapters` | none for published, admin for drafts |
| `GET` | `/genres` | none |
| `POST` | `/novels/{id}/play` | user (bumps the popularity counter) |
| `PUT` | `/me/progress` · `GET /me/progress/{novel_id}` · `GET /me/continue` | user |
| `GET` | `/me/saved` · `POST`/`DELETE` `/novels/{id}/save` | user |
| `GET` | `/requests?q=` · `POST /requests` · `POST /requests/{id}/vote` · `GET /me/requests` | user (list is public) |
| `GET` | `/pro/features` | none |
| `GET` | `/media/{path}` | none — supports HTTP `Range` for seeking |

---

## 6. Using Postman instead of curl

1. Create an environment with `base` = the `/api` URL, `token`, and `adminKey`.
2. `POST {{base}}/auth/login` with the admin credentials → copy `access_token` into `token`.
3. On the collection, add headers `Authorization: Bearer {{token}}` and `X-Admin-Key: {{adminKey}}`.
4. For chapter/cover uploads choose **Body → form-data**, set the `file` row's type to **File**,
   and keep `chapter_number`, `title`, `duration_seconds` as **Text** rows.

---

## 7. Project layout

```
/app
├── backend/
│   ├── server.py         # the whole API: auth, catalog, library, requests, admin, media proxy
│   ├── .env              # MONGO_URL, DB_NAME, JWT_SECRET, ADMIN_KEY, ADMIN_EMAIL/PASSWORD
│   └── tests/            # 109 pytest cases (auth, catalog, library, requests, admin, security)
├── frontend/
│   ├── app/              # routes: (auth), (tabs) Home/Explore/Library, novel/[id], player,
│   │                     #         requests, profile, downloads, pro
│   ├── src/api/          # typed API client + media URL resolver
│   ├── src/context/      # Auth, Player (expo-audio), Downloads, Toast
│   ├── src/components/   # MiniPlayer, ChapterRow, cards, chips, sheets, states
│   └── src/theme/        # palettes + tokens (Bookish / Cinematic)
└── memory/
    ├── PRD.md            # what's built, security audit log, backlog
    └── test_credentials.md
```

## 8. Good to know
- One demo novel ("Reincarnated as the Last Star Sage", 1 volume, 3 playable chapters) is seeded on
  first startup so the app is never empty. Delete it via `DELETE /admin/novels/{id}` once you add your own.
- Drafts are fully hidden from users — nothing leaks until you publish.
- Search input is escaped and length-capped, and the media proxy only serves files inside this app's
  storage folder (see the security audit section in `memory/PRD.md`).
- **Downloads, background audio and lock-screen controls only work on a real device** — generate an
  Android/iOS build from **Publish** to test them. The web preview shows a friendly
  "available on device" message instead.
- No pagination on the catalog yet; add it once you pass roughly 50 novels (`limit`/`skip` already
  exist on `GET /novels`).
