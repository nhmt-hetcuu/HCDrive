# HCDrive

<p align="center">
  <b>Tất cả dung lượng đám mây của bạn, gộp trong một giao diện Google Drive 2024 chuẩn mực.</b><br />
  Kết nối nhiều tài khoản Google Drive và bucket S3 thành một ổ đĩa ảo dung lượng lớn duy nhất, hỗ trợ truyền phát trực tiếp (streaming), định tuyến tải lên thông minh và hoàn toàn không tốn dung lượng ổ cứng máy chủ.
</p>

<p align="center">
  <img alt="Giấy phép: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-4f46e5" />
  <img alt="Node.js 20+" src="https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white" />
  <img alt="React 19" src="https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=white" />
  <img alt="Tailwind CSS 4" src="https://img.shields.io/badge/tailwind-4-38B2AC?logo=tailwindcss&logoColor=white" />
  <img alt="Sẵn sàng cho Docker" src="https://img.shields.io/badge/docker-ready-2496ED?logo=docker&logoColor=white" />
</p>

---

## 📖 Mục lục

1. [HCDrive là gì & Tại sao nên dùng?](#1-hcdrive-là-gì--tại-sao-nên-dùng)
2. [Các tính năng nổi bật](#2-các-tính-năng-nổi-bật)
3. [Giao diện chuẩn Google Drive 2024 (Material You)](#3-giao-diện-chuẩn-google-drive-2024-material-you)
4. [Cơ chế chọn nhiều tệp & Quản lý thư mục](#4-cơ-chế-chọn-nhiều-tệp--quản-lý-thư-mục)
5. [Kiến trúc hệ thống & Cơ chế Streaming](#5-kiến-trúc-hệ-thống--cơ-chế-streaming)
6. [Chạy nhanh bằng Docker (Khuyên dùng)](#6-chạy-nhanh-bằng-docker-khuyên-dùng)
7. [Cài đặt thủ công & Phát triển cục bộ](#7-cài-đặt-thủ-công--phát-triển-cục-bộ)
8. [Hướng dẫn cấu hình Google Cloud OAuth](#8-hướng-dẫn-cấu-hình-google-cloud-oauth)
9. [Biến môi trường (.env)](#9-biến-môi-trường-env)
10. [Danh mục API RESTful](#10-danh-mục-api-restful)
11. [Bảo mật & An toàn dữ liệu](#11-bảo-mật--an-toàn-dữ-liệu)
12. [Xử lý sự cố thường gặp (Troubleshooting)](#12-xử-lý-sự-cố-thường-gặp-troubleshooting)
13. [💖 Ủng hộ dự án (Donate)](#13-ủng-hộ-dự-án-donate)

---

## 1. HCDrive là gì & Tại sao nên dùng?

Mỗi tài khoản Google cá nhân miễn phí được cấp 15 GB dung lượng. Khi bạn sở hữu nhiều tài khoản, dữ liệu bị phân mảnh, khó quản lý và tài khoản này đầy trong khi tài khoản khác còn trống.

**HCDrive** (tiền thân là 9Drive) đóng vai trò là một **cổng lưu trữ đám mây (Cloud Storage Gateway)** tự lưu trữ (self-hosted):
- 📦 **Một kho lưu trữ hợp nhất**: Gộp toàn bộ tài khoản Google Drive cá nhân và các bucket tương thích S3 thành một ổ đĩa ảo dung lượng lớn.
- 📂 **Gộp "Drive của tôi"**: Tự động gộp các thư mục gốc và cây thư mục của tất cả tài khoản theo đường dẫn tên, mang lại trải nghiệm như đang dùng một tài khoản duy nhất.
- ⚡ **Truyền phát trực tiếp (Zero Disk Storage)**: Tệp tải lên hoặc tải xuống được stream trực tiếp qua backend tới Google Drive / S3. **Máy chủ hoàn toàn không lưu trữ tệp tạm trên ổ cứng.**
- 🧭 **Định tuyến thông minh**: Khi tải tệp lên, hệ thống tự động chọn tài khoản còn nhiều dung lượng trống nhất, chia đều (round-robin) hoặc theo thứ tự ưu tiên bạn cài đặt.
- 🎨 **Giao diện chuẩn Google Drive 2024**: Thiết kế hiện đại theo ngôn ngữ Material You của Google Drive (thanh tìm kiếm dạng viên thuốc, thanh chip lọc popover, bảng danh sách/lưới, bảng chi tiết bên phải, chế độ sáng/tối tự động).

---

## 2. Các tính năng nổi bật

### Lưu trữ & Tích hợp đa nền tảng
- **Google Drive không giới hạn**: Thêm bao nhiêu tài khoản Google Drive tùy thích.
- **Tương thích S3**: Kết nối Cloudflare R2, AWS S3, MinIO, Wasabi, Backblaze B2 hoặc bất kỳ endpoint S3 nào.
- **Theo dõi dung lượng (Quota Tracker)**: Xem tổng dung lượng đã dùng / còn trống trên toàn hệ thống và biểu đồ chi tiết từng tài khoản.

### Quản lý tệp & Thư mục thông minh
- **Tải lên cả thư mục (`webkitdirectory`)**: Chọn một thư mục từ máy tính, HCDrive tự động phân tích cây thư mục con và tạo cấu trúc thư mục ảo tương ứng trên hệ thống.
- **Tải xuống thư mục nén ZIP (`archiver`)**: Cho phép tải xuống toàn bộ thư mục và các cấp con dưới dạng file `.zip` nén trực tiếp qua HTTP stream mà không tốn tài nguyên ổ đĩa máy chủ.
- **Thao tác hàng loạt (Batch Actions)**: Chọn nhiều tệp cùng lúc để tải xuống file ZIP gộp, di chuyển thư mục, gắn dấu sao, đưa vào thùng rác hoặc xóa vĩnh viễn.
- **Menu ngữ cảnh đầy đủ**: Nhấp chuột phải vào tệp, thư mục hoặc khoảng trống để thực hiện nhanh các tác vụ: Xem trước, Tải xuống, Đổi tên, Di chuyển, Chia sẻ, Mời, Xóa.

### Chia sẻ & Cộng tác
- **Link chia sẻ công khai**: Tạo liên kết chia sẻ tệp với mật khẩu bảo vệ hoặc giới hạn thời gian. Tích hợp sẵn trình xem trực tiếp: ảnh, video (trình phát Plyr), PDF, văn bản và file Office.
- **Mời người dùng**: Phân quyền Xem (Viewer) hoặc Chỉnh sửa (Editor) cho các tài khoản khác trong hệ thống.
- **Nhật ký hoạt động (Audit Logs)**: Theo dõi toàn bộ lịch sử tải lên, đổi tên, xóa, chia sẻ và đăng nhập.

### Dành cho nhà phát triển (Developer API)
- **API tải lên bên ngoài**: Tuyến đường `POST /api/v1/uploads` sử dụng API Key (`9d_live_...`) cho phép tích hợp tự động hóa từ kịch bản lệnh (scripts), GitHub Actions, hoặc ứng dụng bên thứ ba.

---

## 3. Giao diện chuẩn Google Drive 2024 (Material You)

Giao diện frontend được xây dựng bằng **React 19** và **Tailwind CSS 4**, tái hiện chuẩn xác từng chi tiết của Google Drive phiên bản 2024:

### Hệ thống biến CSS Tokens (`frontend/src/style.css`)
Hệ thống token tự động đồng bộ màu sắc giữa chế độ Sáng (Light) và Tối (Dark):

| Biến CSS Token | Chế độ Sáng | Chế độ Tối | Mục đích sử dụng |
|---|---|---|---|
| `--gd-page` | `#f8fafd` | `#131314` | Màu nền ngoài cùng toàn trang |
| `--gd-surface` | `#ffffff` | `#1e1f20` | Khung nội dung chính, thẻ card, menu popover |
| `--gd-surface-2` | `#f0f4f9` | `#282a2c` | Khối thư mục, thẻ tệp, trạng thái hover |
| `--gd-search` | `#e9eef6` | `#282a2c` | Ô tìm kiếm dạng viên thuốc ở đầu trang |
| `--gd-nav-active` | `#c2e7ff` | `#004a77` | Viên thuốc menu điều hướng đang chọn |
| `--gd-primary` | `#0b57d0` | `#a8c7fa` | Nút hành động chính, viền focus, checkbox |
| `--gd-selected` | `#c2e7ff` | `#004a77` | Hàng hoặc thẻ tệp đang được chọn |
| `--gd-text` | `#1f1f1f` | `#e3e3e3` | Màu chữ chính |
| `--gd-text-2` | `#444746` | `#c4c7c5` | Màu chữ phụ, nhãn, biểu tượng |

### Các thành phần giao diện chính
- **`DriveToolbar`**: Tiêu đề "Drive của tôi ▾" mở nhanh menu tác vụ (Tạo thư mục, Tải tệp, Tải thư mục, Tạo tài liệu Docs/Sheets), đường dẫn breadcrumb, chuyển đổi Danh sách/Lưới, và nút xem chi tiết.
- **`FilterChips`**: Thanh chip lọc nhanh (**Loại**, **Tài khoản**, **Lần sửa đổi**, **Dung lượng**). Toàn bộ menu popover được đưa ra `document.body` qua `createPortal` với toạ độ cố định và `z-[9999]`, loại bỏ hoàn toàn lỗi bị che khuất bởi vùng cuộn.
- **`DetailsPanel`**: Khung trượt bên phải hiển thị ảnh thu nhỏ, thông số chi tiết (loại tệp, kích thước, tài khoản lưu trữ, vị trí, ngày sửa) và lịch sử hoạt động.
- **`UserAccountMenu`**: Menu tài khoản ở góc phải đồng bộ ảnh đại diện (avatar), dung lượng sử dụng và thông tin cá nhân.

---

## 4. Cơ chế chọn nhiều tệp & Quản lý thư mục

### Chọn độc lập (Multi-File Toggle)
- **Chế độ Danh sách (`DriveListView`)**: Checkbox trên từng hàng được thiết kế độc lập. Khi tick chọn hoặc bỏ tick một tệp, hệ thống chỉ cập nhật trạng thái của riêng tệp đó mà không làm mất danh sách các tệp đã chọn trước đó.
- **Chế độ Lưới (`DriveGridView`)**:
  - Trạng thái bình thường: Hiển thị icon định dạng tệp; khi rê chuột vào thẻ sẽ hiển thị nút tròn checkmark.
  - Khi tệp được chọn: Nút checkmark chuyển sang màu xanh dương đậm `#0b57d0` với biểu tượng check trắng.
  - Khi có ít nhất 1 tệp đang chọn trong trang: Tất cả các thẻ tệp còn lại đều tự động hiển thị viền tròn checkbox để bấm chọn tiếp một cách nhanh chóng.
- **Chọn dải (Shift + Click)**: Giữ phím `Shift` và nhấp chuột vào tệp đích để chọn toàn bộ dải tệp từ vị trí chọn gần nhất đến tệp hiện tại.
- **Đảo chọn từng tệp (Ctrl / Cmd + Click)**: Thêm hoặc bớt từng tệp riêng lẻ vào tập hợp đã chọn.
- **Thanh công cụ lựa chọn nổi (`SelectionBar`)**: Hiển thị số lượng tệp đã chọn cùng các nút bấm nhanh: Tải xuống file ZIP, Di chuyển, Gắn dấu sao, Xóa vào thùng rác hoặc Bỏ chọn.

---

## 5. Kiến trúc hệ thống & Cơ chế Streaming

```
┌─────────────────────────────────────────────────────────────┐
│                      Trình duyệt Client                     │
│         React 19 + Vite 8 + Tailwind CSS 4 + Lucide         │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / JSON / Multipart
┌──────────────────────────────▼──────────────────────────────┐
│                    HCDrive Express 5 Backend                │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Middleware xác thực (JWT Bearer / Scoped API Key)       │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Bộ định tuyến hệ thống tệp ảo (Folders, Files, Uploads) │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Công cụ định tuyến tải lên (Quota Sync, Policy Engine)  │ │
│ ├─────────────────────────────────────────────────────────┤ │
│ │ Cổng truyền phát Streaming (Undici HTTP / AWS S3 Lib)   │ │
│ └────────────────────────────┬────────────────────────────┘ │
│                              │                              │
│   Prisma ORM (MySQL/SQLite)  │  Thông tin xác thực mã hoá   │
│   Metadata & Thư mục ảo      │  Token AES-256, Hash Argon2  │
└──────────────┬───────────────┴───────────────┬──────────────┘
               │                               │
        Chunked Stream                  Chunked Stream
               │                               │
┌──────────────▼──────────────┐ ┌──────────────▼──────────────┐
│   Google Drive API v3       │ │   Lưu trữ chuẩn S3          │
│   (Tài khoản 1, 2, 3...)    │ │   (R2, MinIO, AWS, B2...)   │
└─────────────────────────────┘ └─────────────────────────────┘
```

### Nguyên lý Ảo hóa và Không lưu đĩa (Zero Disk Usage)
1. **Thư mục ảo**: Cấu trúc cây thư mục chỉ lưu trong cơ sở dữ liệu (`Folder.parentId`). Trên Google Drive, tất cả tệp nằm phẳng trong thư mục ứng dụng gốc (`9drive`).
2. **Không ghi tệp tạm lên máy chủ**: Khi người dùng tải tệp lên hoặc tải tệp xuống, dữ liệu được truyền thẳng (stream) qua luồng HTTP chunking giữa client và Google Drive/S3. Máy chủ không cần dung lượng ổ cứng lớn để đệm tệp.

---

## 6. Chạy nhanh bằng Docker (Khuyên dùng)

Dự án cung cấp cấu hình **All-in-One** tích hợp cả Frontend, Backend và Cơ sở dữ liệu SQLite trong một container duy nhất, chạy trên 1 cổng duy nhất, tương thích hoàn hảo với Cloudflare Proxy và Nginx.

### 1. Tải mã nguồn & Chuẩn bị biến môi trường
```bash
git clone https://github.com/zenhosta/9drive.git hcdrive
cd hcdrive
cp .env.example .env
```

### 2. Cấu hình tệp `.env`
Mở tệp `.env` và đặt hai chuỗi ngẫu nhiên dài từ 32 ký tự trở lên cho `JWT_ACCESS_SECRET` và `TOKEN_ENCRYPTION_KEY`:
```env
FRONTEND_URL="http://localhost:5173"
JWT_ACCESS_SECRET="chuoi-ngau-nhien-jwt-it-nhat-32-ky-tu"
TOKEN_ENCRYPTION_KEY="chuoi-ngau-nhien-aes-dung-32-ky-tu!"

# Cấu hình Google OAuth (có thể điền sau qua giao diện Cài đặt)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

### 3. Khởi chạy
```bash
docker compose up -d --build
```
Mở trình duyệt tại địa chỉ **http://localhost:5173** và tiến hành tạo tài khoản quản trị đầu tiên! 🎉

### Các lệnh Docker thông dụng
```bash
# Xem log hệ thống
docker compose logs -f 9drive

# Khởi động lại container
docker compose restart 9drive

# Dừng container
docker compose down

# Nạp lại cấu hình Google OAuth từ tệp .env vào cơ sở dữ liệu
docker compose exec 9drive npm run seed:google-config
```

---

## 7. Cài đặt thủ công & Phát triển cục bộ

### Yêu cầu hệ thống
- **Node.js 20+** và **npm**
- **MySQL 8+** (hoặc SQLite)

### Cách 1: Chạy kịch bản tự động
```bash
# Trên Linux hoặc macOS
bash ./setup.sh

# Trên Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

### Cách 2: Thiết lập thủ công từng phần
```bash
# Khởi tạo Backend
cd backend
npm install
npx prisma generate
npm run prisma:migrate
npm run dev # Chạy tại http://localhost:4000

# Khởi tạo Frontend (mở terminal mới)
cd ../frontend
npm install
npm run dev # Chạy tại http://localhost:5173
```

---

## 8. Hướng dẫn cấu hình Google Cloud OAuth

Để kết nối Google Drive và đăng nhập bằng tài khoản Google, bạn cần tạo OAuth Client ID miễn phí từ Google Cloud Console (khoảng 5–10 phút):

1. **Tạo Project**: Truy cập [Google Cloud Console](https://console.cloud.google.com/) và tạo một dự án mới.
2. **Bật Google Drive API**: Vào mục **APIs & Services → Library**, tìm kiếm **Google Drive API** và bấm **Enable**.
3. **Cấu hình màn hình đồng thuận OAuth (OAuth consent screen)**:
   - User Type: Chọn **External**.
   - Điền tên ứng dụng, email hỗ trợ và email nhà phát triển.
   - Thêm các phạm vi quyền (Scopes):
     ```txt
     https://www.googleapis.com/auth/drive
     https://www.googleapis.com/auth/userinfo.email
     https://www.googleapis.com/auth/userinfo.profile
     ```
   - Trong giai đoạn thử nghiệm (**Testing**), thêm các tài khoản Gmail bạn dự định kết nối vào danh sách **Test users**.
4. **Tạo thông tin xác thực OAuth Client ID**:
   - Loại ứng dụng: **Web application**.
   - **Authorized JavaScript origins**: `http://localhost:5173` (hoặc tên miền frontend của bạn).
   - **Authorized redirect URIs**: `http://localhost:4000/connected-accounts/google/callback` (hoặc tên miền backend của bạn).
   - Lưu lại **Client ID** và **Client Secret**.
5. **Lưu cấu hình vào HCDrive**:
   - Đăng nhập vào HCDrive → Vào **Cài đặt (Settings)** → **Thông tin xác thực Google** → Dán Client ID, Client Secret và bấm **Lưu cấu hình**.

---

## 9. Biến môi trường (.env)

### Backend (`backend/.env`)
| Tên biến | Giải thích | Mặc định |
|---|---|---|
| `DATABASE_URL` | Chuỗi kết nối CSDL (MySQL hoặc SQLite) | `mysql://...` hoặc `file:...` |
| `APP_PORT` | Cổng máy chủ backend lắng nghe | `4000` |
| `FRONTEND_URL` | Tên miền frontend được phép gọi API qua CORS | `http://localhost:5173` |
| `JWT_ACCESS_SECRET` | Khóa bí mật ký JWT access token (tối thiểu 32 ký tự) | — |
| `TOKEN_ENCRYPTION_KEY` | Khóa mã hóa AES-256 các token tài khoản (đúng 32 ký tự) | — |
| `ACCESS_TOKEN_TTL_SECONDS` | Thời gian sống của access token (giây) | `3600` (1 giờ) |
| `REFRESH_TOKEN_TTL_DAYS` | Thời gian sống của refresh token (ngày) | `30` |
| `MAX_UPLOAD_BYTES` | Giới hạn dung lượng tối đa cho 1 tệp tải lên (bytes) | `5368709120` (5 GB) |
| `RECAPTCHA_SECRET_KEY` | Khóa bí mật Google reCAPTCHA (tùy chọn) | `""` |

### Frontend (`frontend/.env`)
| Tên biến | Giải thích |
|---|---|
| `VITE_API_URL` | Địa chỉ backend API (nhúng vào mã lúc build) |
| `VITE_RECAPTCHA_SITE_KEY` | Site key Google reCAPTCHA v2/v3 (tùy chọn) |

---

## 10. Danh mục API RESTful

Các API yêu cầu đăng nhập cần truyền header: `Authorization: Bearer <accessToken>`.

### Xác thực & Người dùng (Auth)
- `POST /auth/register` — Đăng ký tài khoản mới bằng email và mật khẩu.
- `POST /auth/login` — Đăng nhập hệ thống.
- `GET /auth/google/url` — Lấy liên kết chuyển hướng đăng nhập bằng Google.
- `GET /auth/google/callback` — Xử lý phản hồi OAuth từ Google.
- `POST /auth/google/exchange` — Đổi mã xác thực tạm thời lấy phiên làm việc JWT.
- `POST /auth/refresh` — Làm mới access token bằng refresh token.
- `POST /auth/logout` — Đăng xuất và vô hiệu hóa phiên.
- `GET /auth/me` — Lấy thông tin tài khoản đang đăng nhập.

### Tài khoản lưu trữ (Connected Accounts & Storage)
- `GET /connected-accounts` — Danh sách các tài khoản Google Drive và S3 đã kết nối.
- `GET /connected-accounts/google/connect-url` — Lấy URL liên kết thêm tài khoản Google Drive mới.
- `GET /connected-accounts/google/callback` — Callback khi liên kết tài khoản Drive thành công.
- `POST /connected-accounts/s3` — Kết nối một bucket S3 mới.
- `POST /connected-accounts/:id/sync-quota` — Yêu cầu đồng bộ lại dung lượng của tài khoản.
- `DELETE /connected-accounts/:id` — Ngắt kết nối một tài khoản lưu trữ.
- `GET /storage/summary` — Tổng hợp dung lượng toàn hệ thống (đã dùng, tổng cộng, phần trăm).
- `GET /storage/breakdown` — Thống kê dung lượng phân bổ trên từng tài khoản.
- `GET /storage/routing-policy` — Lấy chính sách định tuyến tải lên hiện tại.
- `PATCH /storage/routing-policy` — Cập nhật chính sách định tuyến (`most_available`, `round_robin`, `priority`).

### Quản lý Thư mục (Folders)
- `GET /folders?parentId=<id>` — Lấy danh sách thư mục con (hoặc thư mục gốc nếu để trống). Tự động gộp các thư mục cùng tên từ nhiều tài khoản.
- `GET /folders?all=1` — Lấy toàn bộ cây thư mục ảo (dùng cho breadcrumb và hộp thoại di chuyển).
- `POST /folders` — Tạo một thư mục ảo mới.
- `POST /folders/refresh` — Đọc trực tiếp Google Drive API để cập nhật tức thì các thay đổi mới nhất.
- `GET /folders/:id/download` — Tải xuống toàn bộ thư mục và các nhánh con dưới dạng file ZIP (stream trực tiếp bằng `archiver`).
- `PATCH /folders/:id` — Đổi tên hoặc di chuyển thư mục sang thư mục cha khác.
- `DELETE /folders/:id` — Xóa thư mục vào thùng rác.

### Quản lý Tệp (Files)
- `GET /files` — Danh sách tệp kèm bộ lọc (`folderId`, `q`, `kind`, `accountId`, `minSize`, `maxSize`, `startDate`, `endDate`).
- `GET /files/:id` — Chi tiết metadata của một tệp.
- `PATCH /files/:id` — Cập nhật thông tin tệp (đổi tên, chuyển thư mục).
- `PATCH /files/batch` — Cập nhật hàng loạt tệp (di chuyển nhiều tệp cùng lúc).
- `DELETE /files/:id` — Đưa tệp vào thùng rác.
- `DELETE /files/batch` — Đưa hàng loạt tệp vào thùng rác.
- `POST /files/batch/restore` — Khôi phục hàng loạt tệp từ thùng rác.
- `DELETE /files/batch/permanent` — Xóa vĩnh viễn hàng loạt tệp khỏi dịch vụ lưu trữ.
- `POST /files/batch-download` — Tải xuống danh sách nhiều tệp đã chọn gộp chung thành một file ZIP.
- `GET /files/:id/download` — Tải tệp xuống trực tiếp từ dịch vụ lưu trữ qua backend stream.
- `GET /files/:id/view-url` — Lấy đường dẫn xem trước an toàn.
- `POST /files/:id/preview-token` — Tạo mã token xem trước ngắn hạn (phục vụ video Plyr, ảnh, iframe).
- `GET /files/preview/:token` — Truyền phát dữ liệu tệp dựa theo mã preview token.

### Tải lên (Uploads)
- `POST /uploads` — Tải tệp lên hệ thống (Multipart form với `filesMeta` đi trước các phần tệp).
- `POST /api/v1/uploads` — API tải lên dành riêng cho lập trình viên (xác thực bằng API Key mang quyền `files:upload`).

---

## 11. Bảo mật & An toàn dữ liệu

1. **Mã hóa khóa lưu trữ**: Refresh token Google OAuth và khóa bí mật S3 được mã hóa an toàn trong CSDL bằng thuật toán AES-256 thông qua khóa `TOKEN_ENCRYPTION_KEY`.
2. **Băm một chiều mật khẩu & token**: Mật khẩu người dùng được băm bằng thuật toán Argon2 hiện đại. Refresh token của ứng dụng, API Key lập trình viên và mã token xem trước chỉ lưu bản băm (hash).
3. **Không lưu trữ đĩa**: Dữ liệu tệp không bao giờ nằm trên ổ cứng máy chủ, triệt tiêu nguy cơ lộ dữ liệu từ ổ cứng tạm.
4. **Cơ chế CORS nghiêm ngặt**: Chỉ cho phép các yêu cầu có nguồn gốc hợp lệ từ `FRONTEND_URL`.
5. **Phân quyền API Key chi tiết**: API Key được phân quyền theo scope cụ thể và có thể thu hồi bất kỳ lúc nào từ giao diện quản trị.

---

## 12. Xử lý sự cố thường gặp (Troubleshooting)

<details>
<summary><b>Lỗi: "Google Drive API has not been used in project … or it is disabled"</b></summary>

Hãy chắc chắn bạn đã kích hoạt **Google Drive API** trong **chính dự án Google Cloud** chứa OAuth Client ID (truy cập *APIs & Services → Library → Google Drive API → Enable*) và chờ khoảng 3–5 phút để Google áp dụng.
</details>

<details>
<summary><b>Lỗi: "Access blocked … Error 403: access_denied"</b></summary>

Màn hình OAuth của bạn đang ở trạng thái **Testing**. Bạn cần vào *OAuth consent screen → Test users* và thêm email Google mà bạn muốn đăng nhập vào danh sách này.
</details>

<details>
<summary><b>Lỗi: Lệnh Prisma client generate bị khóa file trên Windows</b></summary>

Do tiến trình Node.js đang chạy và khóa tệp mã nguồn Prisma. Hãy tạm dừng dev server, sau đó chạy lại lệnh `npx prisma generate` trong thư mục `backend/`.
</details>

<details>
<summary><b>Frontend vẫn gọi đến địa chỉ API cũ sau khi sửa biến môi trường</b></summary>

Vite nhúng biến `VITE_API_URL` vào mã nguồn tĩnh tại thời điểm build. Sau khi đổi biến này, bạn cần build lại frontend bằng lệnh `npm run build` hoặc `docker compose up -d --build`.
</details>

---

## 13. 💖 Ủng hộ dự án (Donate)

Nếu bạn thấy **HCDrive** hữu ích và giúp bạn quản lý lưu trữ đám mây hiệu quả hơn, bạn có thể ủng hộ tác giả để duy trì và phát triển thêm các tính năng mới:

<p align="center">
  <img src="https://img.vietqr.io/image/MB-01001200910010-compact2.png?amount=&addInfo=Donate%20HCDrive&accountName=NGUYEN%20HOANG%20MINH%20TRI" alt="VietQR MB Bank - NGUYEN HOANG MINH TRI" width="320" style="border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);" />
</p>

| Thông tin chuyển khoản | Chi tiết |
|---|---|
| 🏦 **Ngân hàng** | **MB Bank** (Ngân hàng TMCP Quân Đội) |
| 💳 **Số tài khoản** | `01001200910010` |
| 👤 **Chủ tài khoản** | **NGUYEN HOANG MINH TRI** |
| 💬 **Nội dung** | `Donate HCDrive` (hoặc tin nhắn của bạn) |

*Chân thành cảm ơn mọi sự đóng góp và ủng hộ của bạn!* 🙏

---

## 📄 Giấy phép (License)

Dự án được phân phối dưới giấy phép **Apache-2.0 License**. Xem tệp [LICENSE](LICENSE) để biết thêm chi tiết.
