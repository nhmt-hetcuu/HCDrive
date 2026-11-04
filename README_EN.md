<p align="center">
  <img src="frontend/public/pwa-512x512.svg" alt="HCDrive" width="88" height="88" />
</p>

<h1 align="center">HCDrive</h1>

<p align="center">
  Self-hosted cloud storage gateway: merge multiple Google Drive accounts and S3-compatible buckets into a single unified drive,<br />
  streaming data directly through the server without local disk storage.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-2563eb" /></a>
  <img alt="Node.js 20+" src="https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white" />
  <img alt="React 19" src="https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=black" />
  <img alt="Express 5" src="https://img.shields.io/badge/express-5-000000?logo=express&logoColor=white" />
  <img alt="Docker" src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white" />
</p>

<p align="center">
  <a href="README.md">Tiếng Việt</a> · <b>English</b>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#features">Features</a> ·
  <a href="DOCS-GIAO-DIEN-DEMO.md">UI Demo</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#api">API</a> ·
  <a href="#troubleshooting">Troubleshooting</a>
</p>

---

## Overview

Each free Google account provides 15 GB of storage. Managing multiple accounts often fragments your data: one account is full while others are empty, requiring constant switching to locate files.

**HCDrive** solves this by acting as a self-hosted cloud storage gateway:

- **Unified drive for all accounts.** Google Drive accounts and S3 buckets appear together in "My Drive". Folders sharing the same path across multiple accounts are automatically unified into a single virtual folder.
- **Zero local disk storage.** Uploads and downloads stream directly between the browser and Google Drive / S3. The server only maintains metadata (names, paths, file sizes) in its database.
- **Smart upload routing.** New files are automatically routed to the account with the most available space, distributed round-robin, or assigned according to your custom priority list.
- **Modern Material You interface.** Styled after the 2024 Google Drive redesign with light/dark theme adaptation, English & Vietnamese support, and PWA capability.

---

## Features

### Storage Management

| Feature | Details |
|---|---|
| **Multiple Storage Providers** | Connect unlimited Google Drive accounts and S3-compatible endpoints (Cloudflare R2, AWS S3, MinIO, Wasabi, Backblaze B2, etc.). |
| **Quota Tracker** | Live overview of total pooled storage and individual per-account usage breakdown. |
| **Upload Routing Policies** | Three intelligent routing modes: Most Available, Round-Robin, or Priority List. Automatically bypasses full accounts or accounts with Google rate limits. |
| **Google Drive Changes Sync** | Uses the Google Drive Changes API to incrementally poll updates, minimizing API requests and avoiding rate limit errors. |
| **Account Portability** | Export and import account connection tokens as JSON for easy server migrations. |

### Files and Folders

- **Directory Tree Uploads**: Upload entire directory structures (`webkitdirectory`) with subfolder hierarchies preserved in virtual storage.
- **Cross-Account Copy**: Copy any file or folder directly from one connected Google Drive account to another via right-click context menu, streaming through memory without local disk usage.
- **On-The-Fly Streaming ZIP Downloads**: Download entire folders or multiple selected files as a ZIP archive, compressed on-the-fly during transit.
- **Multi-File Selection**: Independent checkbox toggle, range selection (Shift + Click), and multi-item actions (Move, Star, Trash, Permanent Delete, Batch Download).
- **In-Browser Previews**: Native streaming preview for images, video (Plyr player), audio, PDF, code, text, and Office documents.
- **Full-Text Search & Filters**: Search file names and document contents (powered by Google Drive full-text indexing), with quick filter chips for Type, Account, Date Modified, and Size.
- **Trash, Starred, and Recent**: Full lifecycle management with soft-delete and quick recovery.

### Google Drive Integration

Create native Google Docs, Sheets, Slides, and Forms directly from the toolbar; export to standard office formats; duplicate files; create Drive shortcuts; manage comments and file versions; toggle download restrictions; and automatically convert uploaded Office files to Google Docs.

### Sharing & Collaboration

- **Public Share Links**: Generate shareable links (optional password protection and expiration dates) with embedded preview viewer.
- **Google Drive Direct Sharing**: Share files with external Google email addresses using native Google Drive permissions.
- **Internal Member Invites**: Collaborate with other registered HCDrive users with Viewer or Editor permissions.

### Share Management (Courses & Shared Folders)

The **Share Management** section organizes Google Drive folders and links shared with your accounts (purchased courses, shared project folders, document archives) or created internally:

- **Dual-Mode Display ("This is a course" toggle)**:
  - *Course Mode (`isCourse: true`)*: Tailored for learning with continuous Plyr video/audio player, auto resume playback position, lesson playlist, completion checkmarks, progress tracking, and next lesson navigation.
  - *Standard Drive Folder Mode (`isCourse: false`)*: Clean Google Drive folder explorer with multi-level breadcrumbs, List/Grid view toggle, direct file preview modal (`FolderFilePreviewModal`), single-file download, and folder ZIP compression.
- **Multi-Account "Save to Drive"**: Save the entire course or shared folder into any connected Google Drive account in your HCDrive system (not limited to the linked email), streamed directly without server disk buffering.
- **Link Details Inspector**: Inspect sharer email, linked Google Drive access account, and download permission status.
- **Automatic Download Restriction Bypass**: When a shared file or course is restricted by Google Drive (`canDownload: false` / `canCopy: false`), HCDrive automatically streams the file via internal proxy tokens so recipients can still view and download smoothly.
- **Custom Download Controls**: Sharers can toggle download permission (`allowDownload: true / false`) on shared links (`/library/s/:token`).

### Administration & Security

- **Authentication**: Sign in via Email/Password or Google OAuth; link Google accounts to existing email profiles.
- **Device Sessions**: View active sessions with device names, IP addresses, and remote sign-out capability.
- **Bot Protection (Captcha)**: Support for **Google reCAPTCHA v2** or **Cloudflare Turnstile** with mandatory live test token verification before saving.
- **Reverse Proxy Detection**: Automatic detection of Cloudflare and private network reverse proxies (Nginx, Docker) for accurate client IP logging.
- **Hardened Security**: Scoped developer API keys, Argon2 password hashing, AES-256 encrypted OAuth tokens, IDOR prevention, rate limiting, and audit logs.

---

## Quick Start

The recommended deployment method is Docker: an All-in-One container containing the frontend, backend, and SQLite database running on a single port.

**Prerequisites:** Docker and Docker Compose.

```bash
git clone https://github.com/nhmt-hetcuu/HCDrive.git
cd HCDrive
cp .env.docker.example .env
```

### 1. Configure `.env`

Open `.env` and set random 32+ character strings for `JWT_ACCESS_SECRET` and `TOKEN_ENCRYPTION_KEY`:

```env
FRONTEND_URL="http://localhost:5173"
JWT_ACCESS_SECRET="generate-a-random-string-at-least-32-chars-long"
TOKEN_ENCRYPTION_KEY="exactly-32-chars-aes-encryption-key!"

# Google OAuth Credentials (can also be configured later via Settings UI)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

### 2. Launch Container

```bash
docker compose up -d --build
```

Open your browser at **http://localhost:5173** and register your initial administrator account.

### Useful Docker Commands

```bash
# View live application logs
docker compose logs -f 9drive

# Restart container
docker compose restart 9drive

# Stop container
docker compose down

# Seed Google OAuth credentials from .env into the database
docker compose exec 9drive npm run seed:google-config
```

---

## Configuration

### Connecting Google Drive

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. In **APIs & Services → Library**, search for **Google Drive API** and click **Enable**.
3. In **OAuth consent screen**:
   - Choose User Type: **External**.
   - Fill in App Name, Support Email, and Developer Contact.
   - Add the following Scopes:
     ```txt
     https://www.googleapis.com/auth/drive
     https://www.googleapis.com/auth/userinfo.email
     https://www.googleapis.com/auth/userinfo.profile
     ```
   - In **Test users**, add your Google email address while the app is in Testing mode.
4. In **Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized JavaScript origins: `http://localhost:5173` (or your domain).
   - Authorized redirect URIs: `http://localhost:4000/connected-accounts/google/callback` (or your backend domain).
   - Copy the generated **Client ID** and **Client Secret**.
5. In HCDrive, navigate to **Settings → Google Credentials**, paste the credentials, and save.

### Production Nginx Reverse Proxy

When running behind Nginx, disable request buffering so large file uploads stream directly without hitting server disk:

```nginx
server {
    listen 80;
    server_name drive.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name drive.example.com;

    ssl_certificate /etc/letsencrypt/live/drive.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/drive.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Direct streaming: no buffering, no upload size limit
        proxy_request_buffering off;
        proxy_buffering off;
        client_max_body_size 0;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
}
```

---

## Local Development

**Prerequisites:** Node.js 20+ and npm.

```bash
# Generate backend/.env and frontend/.env with random secrets, install dependencies
bash ./setup.sh                                          # Linux / macOS
powershell -ExecutionPolicy Bypass -File .\setup.ps1     # Windows

# Backend: http://localhost:4000
cd backend
npm run prisma:migrate
npm run dev

# Frontend: http://localhost:5173 (in a separate terminal)
cd frontend
npm run dev
```

Before committing changes, verify the TypeScript build:

```bash
cd backend && npm run build
cd frontend && npm run build
```

---

## Architecture

```text
Browser Client ── React 19 · Vite · Tailwind CSS 4 (Material You / PWA)
      │  HTTPS
      ▼
HCDrive Backend ── Express 5 · TypeScript
      │  ├─ Auth: JWT sessions, Scoped API Keys, Captcha verification
      │  ├─ Virtual Filesystem: Merged folders across multiple accounts, search, share management
      │  ├─ Upload Routing: Quota pooling, auto account selection, rate limit mitigation
      │  └─ Streaming Engine: Direct chunked proxy to/from cloud providers (Zero Disk Storage)
      │
      ├─ Prisma + SQLite ── File & folder metadata, user accounts, AES-256 tokens, Argon2 hashes
      ├─ Google Drive API v3 ── Connected account 1, 2, 3…
      └─ S3 API ── Cloudflare R2, AWS S3, MinIO, Backblaze B2…
```

---

## API

Full interactive API documentation is available inside the application at **`/api-docs`**, featuring cURL examples, schema models, and request/response samples.

Authenticated routes expect the `Authorization: Bearer <accessToken>` header.

| Category | Primary Endpoints |
|---|---|
| **Auth** | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me` |
| **Connected Storage** | `GET /connected-accounts`, `POST /connected-accounts/s3`, `GET /storage/summary`, `PATCH /storage/routing-policy` |
| **Folders** | `GET /folders`, `POST /folders`, `PATCH /folders/:id`, `GET /folders/:id/download`, `POST /folders/copy-to-drive` |
| **Files** | `GET /files`, `GET /files/:id/download`, `PATCH /files/:id`, `POST /files/batch-download`, `POST /files/copy-to-drive` |
| **Uploads** | `POST /uploads`, `POST /uploads/resumable/init` |
| **Share Management** | `GET /library`, `POST /library`, `GET /library/:id/items`, `GET /library/shared/:token`, `POST /library/shared/:token/save`, `POST /library/:id/save-to-drive` |
| **External Integration** | `POST /api/v1/uploads` (Guarded by API Key with `files:upload` scope) |

### Uploading via Developer API Key

Generate an API key in **Settings → API Keys**:

```bash
curl -X POST https://drive.example.com/api/v1/uploads \
  -H "Authorization: Bearer 9d_live_xxxxxxxx" \
  -F 'filesMeta=[{"fieldName":"file-0","fileName":"report.pdf","mimeType":"application/pdf","sizeBytes":"20480"}]' \
  -F "file-0=@./report.pdf;type=application/pdf"
```

---

## Troubleshooting

<details>
<summary><b>"Quota exceeded for quota metric 'Queries' … Requests per minute"</b></summary>

Your Google Cloud project's default query quota has been exceeded for the minute. HCDrive will automatically pause syncing for that account for 60 seconds and redirect uploads to other connected accounts. To resolve permanently, configure your own OAuth Client ID in Settings.
</details>

<details>
<summary><b>"Google Drive API has not been used in project … or it is disabled"</b></summary>

Ensure the **Google Drive API** is enabled in the exact Google Cloud project matching your OAuth Client ID (*APIs & Services → Library → Google Drive API → Enable*).
</details>

<details>
<summary><b>"Access blocked … Error 403: access_denied"</b></summary>

Your Google OAuth consent screen is in **Testing** mode. Add the Google account email you want to connect under *OAuth consent screen → Test users*.
</details>

<details>
<summary><b>"redirect_uri_mismatch"</b></summary>

The Redirect URI in Google Cloud Console must match your `FRONTEND_URL` + `/connected-accounts/google/callback` exactly.
</details>

<details>
<summary><b>Large uploads fail when running behind Nginx</b></summary>

Ensure `client_max_body_size 0;`, `proxy_request_buffering off;`, and increased `proxy_read_timeout` / `proxy_send_timeout` are configured in your Nginx block as shown above.
</details>

<details>
<summary><b>Locked out due to Captcha</b></summary>

Set `DISABLE_CAPTCHA=true` in your `.env` file, run `docker compose up -d`, sign in to update your keys in **Settings → Security**, and remove the environment variable afterwards.
</details>

---

## Support the Project

If you find HCDrive useful for managing your cloud storage, consider supporting its development:

<p align="center">
  <img src="https://img.vietqr.io/image/MB-01001200910010-compact2.png?amount=&addInfo=Donate%20HCDrive&accountName=NGUYEN%20HOANG%20MINH%20TRI" alt="VietQR MB Bank - NGUYEN HOANG MINH TRI" width="280" />
</p>

| Information | Details |
|---|---|
| **Bank** | **MB Bank** (Military Commercial Joint Stock Bank) |
| **Account Number** | `01001200910010` |
| **Account Holder** | **NGUYEN HOANG MINH TRI** |
| **Transfer Content** | `Donate HCDrive` |

---

## License

Distributed under the [Apache License 2.0](LICENSE).
