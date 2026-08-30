# LightListen — Light Novel Audiobook App (PRD & Build Log)

## Original Problem Statement (verbatim summary)
A monolithic Android audiobook app for light novels with a manually-curated public catalog,
community-driven content requests, and chapter-level download/offline playback.

- Mobile App: Android (React Native + TypeScript)
- Backend: FastAPI monolith
- Database: MongoDB
- Storage: Object storage (S3-compatible) for audio files and cover images
- Admin: Raw API endpoints, secured with API key + admin role check
- MVP is free-only; Pro tier displayed as "Coming Soon" with feature previews, no billing.

## User Choices (gathered before build)
1. **Audio engine:** `expo-audio` (works in Expo Go preview; background + lock-screen after a build)
2. **Storage:** Emergent-managed Object Storage (S3-compatible, no keys needed)
3. **Seed data:** 1 demo novel for testing; the rest uploaded by the user via the admin API
4. **Admin:** Raw API endpoints only (Postman) — no in-app admin UI
5. **Look & feel:** Multiple configurable themes — dark cinematic + light warm bookish (+ System)

## Architecture
| Layer | Choice |
|---|---|
| App | Expo SDK 54, expo-router (file routes), TypeScript |
| Audio | `expo-audio` (`useAudioPlayer` / `useAudioPlayerStatus`), background audio mode |
| Offline | `expo-file-system/legacy` `createDownloadResumable` + AsyncStorage-backed download registry |
| Local KV | `@/src/utils/storage` (AsyncStorage + SecureStore for refresh tokens) |
| Backend | FastAPI monolith (`/app/backend/server.py`), all routes under `/api` |
| DB | MongoDB (motor), 9 collections, indexes + compound unique indexes |
| Files | Emergent Object Storage via backend `/api/media/{path}` proxy (Range/206 supported) |
| Auth | bcrypt + PyJWT access/refresh, admin = admin JWT **and** `X-Admin-Key` |

### Data models (9, as specified)
`User`, `Novel`, `Volume`, `Chapter`, `ListeningProgress`, `SavedNovel`, `CommunityRequest`,
`ProRequest` (schema only), `Subscription` (schema only).
All extend a `BaseDocument` with `PyObjectId` (`_id` → `id` as string), `to_mongo()` / `from_mongo()`.

### Navigation
```
Stack root
├── (auth): login, signup
├── (tabs): Home | Explore | Library      (JS Tabs; NativeTabs on iOS 26+)
├── novel/[id]
├── player           (full-screen modal)
├── requests, profile, downloads, pro
└── MiniPlayer overlay (mounted once in the root layout — persists across all screens)
```

## Implemented (2026-06 / build date 2026-08-30)
### Backend
- Auth: signup / login / refresh / me (GET, PUT), bcrypt 12 rounds, 409 on duplicate email
- Public catalog: `GET /api/novels` (sort=new|popular|title, `q` regex over title/alt_title/author, `genre`),
  `GET /api/genres`, `GET /api/novels/{id}` (novel + volumes + chapters + saved + progress),
  `GET /api/novels/{id}/chapters`, `POST /api/novels/{id}/play` (play_count)
- Library: `PUT /api/me/progress` (upsert, unique user+novel), `GET /api/me/progress/{novel_id}`,
  `GET /api/me/continue`, save/unsave + `GET /api/me/saved`
- Community: `GET /api/requests` (?q fuzzy, sorted by votes), `POST /api/requests`
  (duplicate title votes the existing request instead of creating a twin), idempotent
  `POST /api/requests/{id}/vote`, `GET /api/me/requests`
- Pro: `GET /api/pro/features` (coming_soon + feature list)
- Media: `GET /api/media/{path}` public streaming with `Accept-Ranges` / 206 partial content
- Admin (admin JWT + `X-Admin-Key`): novels CRUD + cover upload + publish/unpublish,
  volumes CRUD, chapters CRUD (MP3 upload **or** `audio_url` form field) + audio replace,
  community request list/update/delete, users list/search/detail
- Startup: index creation, idempotent admin seed, one demo novel seed (1 volume, 3 real MP3 chapters)

### App
- Auth screens with keyboard-aware forms, secure refresh-token storage, silent token refresh
- Home: Continue listening (horizontal, progress + resume), New this week, Popular now,
  Community requests banner, pull-to-refresh, skeleton/error/empty states
- Explore: sticky search + single-row horizontal genre chip scroller (36pt chips / 56pt row), 2-col grid
- Novel detail: hero cover with gradient scrim, animated sticky header, stats, Play/Resume CTA,
  save toggle, volume chips, chapter rows with per-chapter download state
- Player (modal): blurred cover backdrop, scrubber, ±15/±30, prev/next chapter, speed sheet
  (0.75x–2x), sleep timer sheet (15/30/45/60/end-of-chapter), chapter list sheet, offline badge
- Mini-player: glass/blur, persists on every screen except the player & auth, tap to expand
- Downloads: per-chapter download with live %, offline-first playback, storage screen
  (per-novel grouping, sizes, delete chapter / delete all), storage-full & retry handling
- Library: Continue / Saved / Downloads tabs
- Community requests: search-first UX (type → fuzzy matches → vote or create), status badges, My activity
- Profile: account card, theme segmented control (Bookish / Cinematic / System, persisted),
  storage row, Pro banner, logout
- Themes: full token set per palette from `design_guidelines.json`, Playfair Display + Manrope fonts

## Testing
- Backend: 46/46 pytest cases pass (auth, catalog, library, requests, admin security matrix,
  full admin content pipeline, media Range) — `/app/test_reports/iteration_1.json`
- Frontend: all flows verified in the 390x844 mobile web preview (auth, home, explore, novel,
  player, mini-player persistence, library, requests, profile, theme switch + persistence)

## Backlog
### P0 (next)
- Bulk/volume download queue with a foreground-service notification (needs a native build)
- Lock-screen / notification transport controls verification on a real Android build
- Pagination on `/api/novels` once the catalog passes ~50 novels

### P1
- Admin web UI on top of the existing admin endpoints
- Server-side MP3 duration probing on upload (currently supplied by the admin as a form field)
- Sleep-timer fade-out, "resume where the sleep timer stopped" affordance
- Continue-listening chapter completion tracking (mark chapter finished, next-up card)

### P2
- Google Sign-In (auth layer is modular), Google Play Billing + Pro tier activation
- ProRequest endpoints, private EPUB upload pipeline
- Push notifications for request status changes / new novel alerts
- Basic analytics events (plays, completions, drop-off)

## Notes / constraints
- Downloads are native-only; the web preview shows a friendly "available on device" state.
- Background audio and lock-screen controls require a generated Android/iOS build (not Expo Go).
- Admin endpoints require BOTH the admin JWT and the `X-Admin-Key` header.
- Credentials live in `/app/memory/test_credentials.md`.
