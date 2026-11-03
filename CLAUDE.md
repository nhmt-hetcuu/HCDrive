# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

`AGENTS.md` (imported above) holds the conventions, security rules, env vars, and API list. This file adds what it leaves out, and notes where the code has moved past it.

## Project Identity & Branding

- Project Name: **HCDrive** (formerly 9Drive).
- Brand display: Use **HCDrive** in UI titles, page headers, user-facing notifications, and documentation.
- Internal stability: Preserve existing internal storage conventions (e.g. database schema, internal Google Drive root folder named `9drive`, and existing database table names) to prevent regressions or breaking existing connected accounts.

## Commands

Neither package has a test runner or linter. Verification means running the type-check/build:

- `cd backend && npm run build` (`tsc`)
- `cd frontend && npm run build` (`tsc && vite build`)

Other scripts that `AGENTS.md` doesn't list:

- `cd backend && npm run start:deploy`: `prisma migrate deploy`, then start. For production, never use `migrate reset` there.
- `cd backend && npm run test:s3` / `npm run test:api-upload`: manual smoke scripts in `backend/src/scripts/`.
- `setup.sh` / `setup.ps1`: create `backend/.env` and `frontend/.env` with random secrets, run `npm install`, and generate the Prisma client.
- On Windows, if `prisma generate` fails because a file is locked, stop the running dev servers first.

## Architecture beyond AGENTS.md

### Storage Providers & Upload Routing
- **Two storage providers**: `ConnectedAccount.provider` is `google_drive` or `s3`. An S3-compatible account is a `ConnectedAccount` plus an `S3StorageConfig` row (encrypted keys, bucket, optional endpoint, `prefix` defaulting to `9drive`, optional `quotaBytes`). Code touching stored files branches on provider:
  - Streaming: `modules/files/stream-file.ts` (`streamProviderFile`) sends work to `stream-google-file.ts` or `s3/s3.service.ts`.
  - Quota: `syncGoogleQuota` (google.service) vs `syncS3Quota` (s3.service). Both write to `StorageAccount`.
  - Upload: `ensureGoogleAppFolder` + Drive resumable upload vs `buildS3ObjectKey` + `uploadS3Object` (`@aws-sdk/lib-storage`).
- **Upload routing** (`modules/uploads/upload.routes.ts`, `selectAccount`):
  1. Re-sync quota for any account whose last sync is more than 5 minutes old.
  2. Subtract bytes already reserved by earlier files in the same multipart request.
  3. Apply the user's `UploadRoutingPolicy` mode: `most_available` (default), `round_robin` (cursor kept in the DB), or `priority` (`priorityAccountIds`).
  4. If `availableBytes` is null, treat the account as unlimited. When quotas are unknown, S3 accounts are preferred.
- **Developer Upload API**: Mounted as `POST /api/v1/uploads` (`modules/public-api`). Guarded by `requireApiKey('files:upload')` in `middleware/api-key.middleware.ts`, not by `requireAuth`. API keys are stored hashed and carry scopes.

### Virtual vs. Physical Filesystem
- Folders exist in the database (`Folder.parentId` tree). Files are stored flat in the provider's `9drive` folder or prefix.
- `File.folderId` is purely app-side.
- Folders and files are soft-deleted (`deletedAt`/`status`), which is what the Trash and Archived pages rely on.
- **Merged Folders**: `modules/folders/merged-folders.ts` unifies folder trees across multiple connected Google Drive accounts by name path into a single virtual tree.
- **Live Refresh**: `modules/folders/live-refresh.ts` and `POST /folders/refresh` query Google Drive API directly to sync real-time changes made in Google Drive.
- **Folder Streaming ZIP**: `GET /folders/:id/download` recursively packages virtual folder hierarchies and streams them as a ZIP archive using `archiver`.

### Google OAuth Configuration
- Google OAuth config comes from the DB, not env. `env.ts` doesn't read `GOOGLE_*`. Those vars are read only by the seed scripts, which write a global `ProviderConfig` row (`userId` null) with encrypted credentials. It can also be set in Settings via `POST /system/google-config`. In Docker, `seed:google-config:docker` skips seeding when the credentials are blank or placeholders.

### Backend Module Conventions
- The backend is ESM with `module: NodeNext`, so relative imports need a `.js` suffix even in `.ts` files.
- Most route files hold their logic inline; services exist only for provider integrations (`google/`, `s3/`).
- Token encrypt/hash helpers are in `utils/crypto.ts`.

### Frontend Architecture & Google Drive 2024 UI
- **Google Drive 2024 Design Tokens**: Defined in `frontend/src/style.css` (`--gd-page`, `--gd-surface`, `--gd-surface-2`, `--gd-search`, `--gd-nav-active`, `--gd-primary`, `--gd-selected`, `--gd-text`, etc.) for seamless light/dark mode adaptation.
- **Core Components**:
  - `DriveToolbar`: Handles "Drive của tôi ▾" quick actions menu, breadcrumbs, list/grid toggle, and details drawer trigger.
  - `FilterChips`: Type, Account, Last Modified, and Storage chips. All popover/dropdown menus MUST use `createPortal` to `document.body` with fixed viewport coordinates and `z-[9999]` to bypass container clipping (`overflow-x: auto` / `overflow-y: hidden`).
  - `DriveListView` & `DriveGridView`: Dual rendering views.
  - `SelectionBar`: Floating multi-selection action bar for batch operations (Download ZIP, Move, Star, Trash, Permanent Delete).
  - `DetailsPanel`: Google Drive style right drawer for preview, file properties, and activity.
  - `UserAccountMenu`: Profile popup synchronizing user avatar, storage quota, and settings.
- **Multi-File Selection Conventions**:
  - Both `DriveListView` and `DriveGridView` accept `onToggleFile?: (file: FileItem) => void`.
  - Checkbox and checkmark clicks MUST stop event propagation (`e.stopPropagation()`) and call `onToggleFile` to prevent row selection from wiping out existing selected items.
  - Parent pages (`AllFilesPage`, `RecentPage`, `StarredPage`) track `lastSelectedFileIdRef` to support Google Drive style range selection with `Shift + Click`.
  - Grid view cards feature dynamic Google Drive 2024 circular checkmark buttons (visible on hover, solid blue `#0b57d0` when selected, active checkboxes when any item is selected).
- **Folder Operations**:
  - HTML5 folder tree uploads (`webkitdirectory`) parse `file.webkitRelativePath`, recursively create intermediate virtual folders, and dispatch items to `uploadBatch`.
- **API Base URL**: `lib/api.ts` uses `VITE_API_URL` unless unset or default `http://localhost:4000`. Production builds fall back to `/api`, proxied by Nginx with buffering disabled for streaming uploads.
