# AGENTS.md

## Project Overview

**HCDrive** (formerly 9Drive) is a high-performance cloud storage gateway modeled after Google Drive 2024 (Material You). It enables users to register/login with email/password or Google, automatically connect the first Drive account during Google sign-in, connect additional Google Drive accounts and S3-compatible buckets, track combined quota in real time, upload files through the backend directly to storage with zero disk usage, organize files in virtual and merged folders, preview/download/share files, sync MySQL/SQLite file records from Google Drive, invite other users to files/folders, and route uploads to a connected storage account with sufficient free space.

## Repository Structure

- `backend/`: Express 5 API, TypeScript, Prisma schema/migrations, MySQL/SQLite access, auth, Google OAuth/Drive integration, S3 integration, streaming proxy, and ZIP archiving.
- `frontend/`: React 19 + Vite app, Tailwind CSS 4, Google Drive 2024 UI, multi-account file/folder management, multi-file selection, sharing, uploads, quota/settings pages.
- `docker-compose.yml`: All-in-One single-container deployment (or multi-service setup).
- `.env.example` / `.env.docker.example`: Environment configuration templates.
- `README.md`: Architectural documentation, Google Cloud setup, Docker instructions, and API guide.

## Requirements

- Node.js 20+
- npm
- MySQL 8+ or SQLite
- Google Cloud project with Google Drive API enabled
- Google OAuth client ID and secret

## Backend

Stack:
- Express 5
- TypeScript
- Prisma 6
- MySQL / SQLite
- Zod
- JWT bearer auth
- Argon2 password hashing
- Busboy streaming uploads
- Archiver for on-the-fly streaming ZIP downloads
- Google APIs client
- Undici for Google file streaming
- AWS SDK v3 for S3 storage integration

Important files:
- `backend/src/server.ts`: server entrypoint.
- `backend/src/app.ts`: Express app and route mounting.
- `backend/src/config/env.ts`: environment validation.
- `backend/src/config/prisma.ts`: Prisma client.
- `backend/prisma/schema.prisma`: database schema.
- `backend/src/middleware/auth.middleware.ts`: bearer auth.
- `backend/src/middleware/api-key.middleware.ts`: external developer API key auth.
- `backend/src/middleware/error.middleware.ts`: JSON error responses.
- `backend/src/modules/**`: feature route modules and provider services.
- `backend/src/modules/folders/merged-folders.ts`: multi-account folder unification.
- `backend/src/modules/folders/live-refresh.ts`: direct real-time Google Drive folder refresh.
- `backend/src/modules/files/stream-google-file.ts`: Google file preview/download streaming.
- `backend/src/modules/files/stream-file.ts`: unified streaming provider dispatcher.
- `backend/src/scripts/seed-google-config.ts`: stores encrypted global Google OAuth config.

Commands:
- `cd backend && npm run dev`: start development server.
- `cd backend && npm run build`: typecheck/build backend.
- `cd backend && npm run start`: run compiled backend from `dist/server.js`.
- `cd backend && npm run prisma:migrate`: run Prisma dev migration.
- `cd backend && npm run prisma:generate`: regenerate Prisma client.
- `cd backend && npm run seed:google-config`: store encrypted Google OAuth config.

Environment:
- `DATABASE_URL`
- `APP_PORT`
- `FRONTEND_URL`
- `JWT_ACCESS_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_SITE_KEY` (optional fallback; captcha is normally set in Settings → Security, reCAPTCHA v2 or Cloudflare Turnstile)
- `DISABLE_CAPTCHA` (`true` skips every captcha check, for an admin locked out by a wrong key)
- `TRUST_PROXY` (optional; empty = detect Cloudflare and private-network proxies automatically, see `utils/client-ip.ts`)
- `ACCESS_TOKEN_TTL_SECONDS`
- `REFRESH_TOKEN_TTL_DAYS`
- `MAX_UPLOAD_BYTES`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`

Backend conventions:
- Put route logic under `backend/src/modules/<feature>/<feature>.routes.ts`.
- Mount new routers in `backend/src/app.ts`.
- Use `requireAuth` for authenticated user routes.
- Use `AuthRequest` when accessing `req.user`.
- Validate request bodies/query params with Zod.
- Use Prisma from `backend/src/config/prisma.ts`.
- Return JSON errors with stable `code` and human-readable `message`.
- Pass unexpected errors to `next(error)`.
- Convert `bigint` values to strings before sending JSON responses.
- Keep Google-specific OAuth/Drive behavior in provider modules/services.
- Keep public-token routes outside `requireAuth`; verify token hash, status, and expiry before streaming/returning data.
- Google sign-in/register uses one-time auth handoff tokens; never send app access/refresh tokens through URL query params.
- Email/password sign-up (and sign-in, if the admin turns it on) verifies a captcha when one is set in Settings → Security (`utils/captcha.ts`). Captcha secrets are stored encrypted and never returned by the API.

Security rules:
- Never commit `.env` files or secrets.
- Never log access tokens, refresh tokens, OAuth client secrets, JWT secrets, encryption keys, or raw public share tokens.
- Google tokens are encrypted before database storage.
- App refresh tokens are hashed before database storage.
- Auth handoff, share, and preview tokens are stored as hashes where applicable.
- Uploaded files must stream directly through backend to Google Drive or S3; do not store uploaded files on server disk.
- Keep CORS restricted by `FRONTEND_URL`.
- Keep auth/token storage behavior centralized; do not change without explicit reason.

Database rules:
- Change DB schema through Prisma schema and migrations.
- Do not hand-edit generated Prisma client files.
- After schema changes, run Prisma migration/generation and backend build.
- Add indexes for new common filters before relying on them in hot paths.

## Frontend

Stack:
- React 19
- Vite 8
- TypeScript
- React Router 7
- Tailwind CSS 4
- lucide-react
- class-variance-authority
- clsx
- tailwind-merge

Important files & components:
- `frontend/src/main.tsx`: React entrypoint.
- `frontend/src/App.tsx`: route registration.
- `frontend/src/layouts/DriveLayout.tsx`: Google Drive 2024 protected shell, sidebar, pill search, storage meter.
- `frontend/src/pages/AllFilesPage.tsx`: core file/folder browser, selection management, context menus, upload handlers.
- `frontend/src/pages/RecentPage.tsx` & `StarredPage.tsx`: filtered file views sharing the Google Drive layout and multi-selection logic.
- `frontend/src/pages/SharedPage.tsx`: shared links and invites UI.
- `frontend/src/pages/QuotaTrackerPage.tsx`: connected-account quota UI and upload routing policy manager.
- `frontend/src/pages/SettingsPage.tsx`: Google and S3 account connection UI.
- `frontend/src/pages/GoogleAuthPage.tsx`: Google auth handoff exchange page.
- `frontend/src/pages/PublicFilePage.tsx`: public shared file viewer/embed page.
- `frontend/src/components/drive/DriveToolbar.tsx`: "Drive của tôi ▾" actions menu, breadcrumbs, list/grid toggle.
- `frontend/src/components/drive/FilterChips.tsx`: quick filter pills (rendered via `createPortal` with fixed coordinates at `z-[9999]`).
- `frontend/src/components/drive/DriveListView.tsx`: Google Drive 2024 table view with independent checkbox selection.
- `frontend/src/components/drive/DriveGridView.tsx`: card grid view with dynamic Google Drive 2024 circular checkmark buttons.
- `frontend/src/components/drive/SelectionBar.tsx`: floating multi-item action bar for batch operations.
- `frontend/src/components/drive/DetailsPanel.tsx`: right-side file property and activity inspector drawer.
- `frontend/src/components/drive/UserAccountMenu.tsx`: avatar and account management dropdown.
- `frontend/src/context/UploadContext.tsx`: upload queue, directory tree upload processing, and progress state.
- `frontend/src/lib/api.ts`: API helper, token refresh retry, formatting utilities.
- `frontend/src/lib/auth.ts`: local auth session storage.
- `frontend/src/style.css`: Google Drive 2024 Material You design tokens (`--gd-*`).

Commands:
- `cd frontend && npm run dev`: start Vite dev server.
- `cd frontend && npm run build`: typecheck/build frontend.
- `cd frontend && npm run preview`: preview production build.

Environment:
- `VITE_API_URL`: backend base URL. Vite embeds this at build time.
- `VITE_RECAPTCHA_SITE_KEY`: optional, only for an env-only reCAPTCHA setup; the site key normally comes from `GET /auth/config` at runtime.

Frontend conventions:
- Use `@/*` imports for files under `frontend/src`.
- Keep route registration in `frontend/src/App.tsx`.
- Use `apiFetch` for normal JSON API calls.
- Use raw `fetch` or `XMLHttpRequest` only when response streaming/blob/progress requires it.
- Keep access/refresh token handling centralized in `frontend/src/lib/api.ts` and `frontend/src/lib/auth.ts`.
- Multi-file selection: pass `onToggleFile` to `DriveListView` and `DriveGridView`, decouple checkbox clicks via `e.stopPropagation()`, and support Shift+click range selection via `lastSelectedFileIdRef`.
- Floating dropdowns and popovers must be rendered via `createPortal` into `document.body` with fixed viewport positioning and `z-[9999]` to bypass container overflow clipping.

## API Notes

General:
- `GET /health`
- Authenticated routes expect `Authorization: Bearer <accessToken>`.

Auth:
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/google/url`
- `GET /auth/google/callback`
- `POST /auth/google/exchange`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`

Provider configs:
- `POST /provider-configs/google`
- `GET /provider-configs`
- `DELETE /provider-configs/:id`

Google connected accounts:
- `GET /connected-accounts/google/connect-url`
- `GET /connected-accounts/google/connect`
- `GET /connected-accounts/google/callback`
- `GET /connected-accounts`
- `POST /connected-accounts/:id/sync-quota`
- `DELETE /connected-accounts/:id`
- `POST /connected-accounts/s3`

Storage:
- `GET /storage/summary`
- `GET /storage/breakdown`
- `GET /storage/routing-policy`
- `PATCH /storage/routing-policy`

Folders:
- `GET /folders?parentId=<id>`
- `GET /folders?all=1`
- `GET /folders/recent?limit=4`
- `POST /folders`
- `POST /folders/refresh`
- `GET /folders/:id/download`
- `PATCH /folders/:id`
- `DELETE /folders/:id`

Files:
- `GET /files`
- `GET /files?folderId=<id>`
- `GET /files?q=<search>`
- `GET /files/shared-links`
- `GET /files/:id`
- `PATCH /files/:id`
- `PATCH /files/batch`
- `DELETE /files/:id`
- `DELETE /files/batch`
- `POST /files/batch/restore`
- `DELETE /files/batch/permanent`
- `POST /files/batch-download`
- `POST /files/sync-google`
- `POST /files/:id/share`
- `DELETE /files/:id/share`
- `POST /files/:id/preview-token`
- `GET /files/:id/view-url`
- `GET /files/:id/download`
- `GET /files/preview/:token`

Invites:
- `GET /invites`
- `POST /invites`
- `DELETE /invites/:id`

Security settings (admin):
- `GET /system/security/captcha`
- `PUT /system/security/captcha` (new keys need `testToken` from a solved test captcha)
- `GET /system/security/network` (detected Cloudflare / reverse proxy, client IP)
- `PUT /system/security/network` (`mode`: `auto` or `off`)

Library (links others shared with the user, e.g. bought courses):
- `GET /library`
- `POST /library` (`url`, or `fileId` + `accountId` from Shared with me)
- `PATCH /library/:id`
- `DELETE /library/:id`
- `POST /library/collections/rename`
- `GET /library/:id/items?folderId=<id>`
- `PUT /library/:id/progress`
- `GET|POST|DELETE /library/:id/share` (internal share link `/library/s/<token>`; recipients open the course with their own Google access)
- `GET /library/shared/:token`, `POST /library/shared/:token/save`
- `POST /library/:id/download-link` → signed `GET /library/download/:token` (course or chapter as a ZIP; files the owner blocks from download are listed in `_KHONG_TAI_DUOC.txt`)
- `GET|POST /library/:id/save-to-drive` (background copy of the course into the user's Drive; real copies, files the owner blocks from copying are skipped)
- `GET /library/stream/:token` (signed, no auth header; only for files the owner allows downloading)

Public shared files:
- `GET /public/files/:token`
- `GET /public/files/:token/download`
- `GET /public/files/:token/preview`

Uploads:
- `POST /uploads` (multipart/form-data with `filesMeta` followed by file chunks)
- `POST /uploads/resumable/init`
- `PUT /uploads/resumable/chunk/:id`
- `GET /uploads/resumable/status/:id`
- `POST /api/v1/uploads` (external upload API guarded by API key with `files:upload` scope)

## Docker

Commands:
- `docker compose up -d --build`: build and start all-in-one HCDrive container.
- `docker compose exec 9drive npm run seed:google-config`: seed Google config from .env.
- `docker compose logs -f 9drive`: view application logs.
- `docker compose down`: stop service.
- `docker compose down -v`: stop service and remove data volume.

## Verification

Before finishing backend changes:
- `cd backend && npm run build`

Before finishing frontend changes:
- `cd frontend && npm run build`

Before finishing schema changes:
- `cd backend && npm run prisma:migrate`
- `cd backend && npm run build`

## Agent Rules

- Name the project **HCDrive** across UI, titles, and documentation.
- Maintain existing database schema and internal storage folder conventions (`9drive`) to preserve zero regression on existing deployments.
- Never write uploaded files to local disk; retain the 100% streaming proxy architecture.
- Preserve Google Drive 2024 UI consistency and design tokens.
- For multi-file selection, preserve decoupled checkbox toggling and range selection.
- Floating dropdowns and menus must be mounted to `document.body` via `createPortal` with fixed positioning.
- Never commit `.env` files or secrets.
- Do not edit `node_modules`, build output, or generated Prisma client.
