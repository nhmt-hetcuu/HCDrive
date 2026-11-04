# HCDrive — Tài liệu Demo Toàn bộ Giao diện (Material You / Google Drive 2024)

> **Địa chỉ trải nghiệm trực tiếp:** `http://localhost:5173/all-files`  
> **Ngôn ngữ thiết kế:** Google Drive 2024 / Material You (bo góc tròn, token `--gd-*`, hỗ trợ giao diện Sáng / Tối, phản hồi tức thì, tối ưu thao tác chuột và phím tắt).

---

## Mục lục

1. [Hệ thống Design Tokens & Bảng màu](#1-hệ-thống-design-tokens--bảng-màu)
2. [Khung sườn ứng dụng tổng thể (App Shell)](#2-khung-sườn-ứng-dụng-tổng-thể-app-shell)
3. [Màn hình 1: Drive của tôi (`/all-files`) — Trung tâm điều khiển](#3-màn-hình-1-drive-của-tôi-all-files--trung-tâm-điều-khiển)
4. [Màn hình 2: Trang chủ (`/home`)](#4-màn-hình-2-trang-chủ-home)
5. [Màn hình 3: Gần đây (`/recent`) & Có gắn dấu sao (`/starred`)](#5-màn-hình-3-gần-đây-recent--có-gắn-dấu-sao-starred)
6. [Màn hình 4: Được chia sẻ với tôi (`/shared`) & Thùng rác (`/trash`)](#6-màn-hình-4-được-chia-sẻ-với-tôi-shared--thùng-rác-trash)
7. [Màn hình 5: Quản lý Share & Khóa học (`/library`)](#7-màn-hình-5-quản-lý-share--khóa-học-library)
8. [Màn hình 6: Quản lý Bộ nhớ & Định tuyến Tải lên (`/storage` & `/accounts`)](#8-màn-hình-6-quản-lý-bộ-nhớ--định-tuyến-tải-lên-storage--accounts)
9. [Màn hình 7: Cài đặt Hệ thống (`/settings`)](#9-màn-hình-7-cài-đặt-hệ-thống-settings)
10. [Màn hình 8: Tài liệu Lập trình viên REST API (`/api-docs`)](#10-màn-hình-8-tài-liệu-lập-trình-viên-rest-api-api-docs)
11. [Màn hình 9: Xác thực & Đăng nhập (`/login`, `/register`)](#11-màn-hình-9-xác-thực--đăng-nhập-login-register)
12. [Hệ thống Hộp thoại & Menu ngữ cảnh (Modals & Context Menus)](#12-hệ-thống-hộp-thoại--menu-ngữ-cảnh-modals--context-menus)
13. [Bảng phím tắt thao tác nhanh (Keyboard Shortcuts)](#13-bảng-phím-tắt-thao-tác-nhanh-keyboard-shortcuts)

---

## 1. Hệ thống Design Tokens & Bảng màu

Toàn bộ ứng dụng sử dụng các biến CSS Material You chuẩn trong `frontend/src/style.css`, tự động chuyển đổi giữa chế độ Sáng (Light) và Tối (Dark):

| Biến CSS Token | Giá trị Sáng (Light) | Giá trị Tối (Dark) | Thành phần áp dụng |
|---|---|---|---|
| `--gd-page` | `#f8fafd` | `#131314` | Nền canvas ngoài cùng của trang |
| `--gd-surface` | `#ffffff` | `#1e1f20` | Vùng nội dung chính, thẻ card, menu ngữ cảnh |
| `--gd-surface-2` | `#f0f4f9` | `#282a2c` | Thẻ thư mục, hover dòng danh sách, toolbar |
| `--gd-search` | `#e9eef6` | `#282a2c` | Thanh tìm kiếm hình viên thuốc (Pill Search Bar) |
| `--gd-nav-active` | `#c2e7ff` | `#004a77` | Nền nút danh mục sidebar đang kích hoạt |
| `--gd-nav-active-text` | `#001d35` | `#c2e7ff` | Chữ mục sidebar đang kích hoạt |
| `--gd-primary` | `#0b57d0` | `#a8c7fa` | Nút hành động chính, viền focus, checkbox xanh |
| `--gd-selected` | `#c2e7ff` | `#004a77` | Highlight dòng tệp/thư mục được chọn |
| `--gd-text` | `#1f1f1f` | `#e3e3e3` | Tiêu đề và nội dung văn bản chính |
| `--gd-text-2` | `#444746` | `#c4c7c5` | Nhãn phụ, kích thước tệp, ngày tháng |
| `--gd-outline` | `#747775` | `#8e918f` | Đường viền chip bộ lọc, viền nút outline |
| `--gd-divider` | `#e1e3e1` | `#444746` | Đường kẻ phân tách giữa các dòng danh sách |

### Phân loại màu theo định dạng tệp (File Type Badges)
- **Tài liệu Google Docs / Word (`.docx`, `.txt`)**: Biểu tượng Xanh dương (`#1a73e8`).
- **Bảng tính Google Sheets / Excel (`.xlsx`, `.csv`)**: Biểu tượng Xanh lá (`#1e8e3e`).
- **Trình chiếu Google Slides / PowerPoint (`.pptx`)**: Biểu tượng Vàng cam (`#f9ab00`).
- **Biểu mẫu Google Forms**: Biểu tượng Tím (`#7248b9`).
- **Tệp PDF**: Biểu tượng Đỏ (`#ea4335`).
- **Tệp nén (`.zip`, `.rar`, `.7z`)**: Biểu tượng Xám ghi (`#5f6368`).
- **Hình ảnh / Video**: Xem trước trực tiếp hình thu nhỏ (Thumbnail Preview) kèm nhãn loại.

---

## 2. Khung sườn ứng dụng tổng thể (App Shell)

Khung sườn bao gồm **Thanh tìm kiếm trên cùng (Header)**, **Thanh điều hướng bên trái (Sidebar)** và **Vùng làm việc bo góc (Main Workspace)**:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [H] HCDrive      🔍  Tìm trong Drive                          [⚙ Bộ lọc]     ⟳  ☾  🌐  ( ? )  [👤 Avatar]   │
├───────────────┬──────────────────────────────────────────────────────────────────────────────────────────────┤
│               │                                                                                              │
│  [ + Mới ▾ ]  │  Drive của tôi ▾  /  Tài liệu dự án  /  Báo cáo                 [ ☵ Danh sách | ⊞ Lưới ] (i) │
│               │ ──────────────────────────────────────────────────────────────────────────────────────────── │
│ 🏠 Trang chủ  │  [ Loại ▾ ]   [ Tài khoản ▾ ]   [ Lần sửa đổi ▾ ]   [ Dung lượng ▾ ]           [ ✕ Xoá lọc ] │
│ 💾 Drive của tôi │                                                                                           │
│ 🗄️ Tài khoản  │  THƯ MỤC                                                                    Sắp xếp: Tên ↑  │
│ ───────────── │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│ 👥 Được chia sẻ│  │ 📁 Kế hoạch ⋮│  │ 📁 Báo cáo ⋮ │  │ 📁 Ảnh demo ⋮│  │ 📁 Backup ⋮  │                      │
│ 🎓 Khóa học   │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘                      │
│ 🕒 Gần đây    │                                                                                              │
│ ⭐ Có gắn sao │  TỆP TIN                                                                                    │
│ ───────────── │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│ 🗑️ Thùng rác  │  │ 🔘 [Doc]  ⋮ │  │ 🔘 [Sheet] ⋮ │  │ 🔘 [PDF]   ⋮ │  │ 🔘 [Img]   ⋮ │                      │
│ ☁️ Bộ nhớ     │  │  Kế-hoạch.doc│  │  Tài-chính.xls│  │  Báo-cáo.pdf │  │  Banner.png  │                      │
│ ───────────── │  │ [Xem trước]  │  │ [Xem trước]  │  │ [Xem trước]  │  │ [Xem trước]  │                      │
│ ▬▬▬▭ 15GB/5TB │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘                      │
└───────────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Các thành phần chính trong App Shell
1. **Logo & Thương hiệu**: `[H] HCDrive` với biểu tượng chữ H bo góc màu xanh đặc trưng.
2. **Thanh tìm kiếm dạng viên thuốc**:
   - Gõ từ khóa tìm kiếm theo tên hoặc nội dung tệp.
   - Nút `[⚙]` mở hộp thoại lọc nâng cao: Tìm theo loại tệp, chủ sở hữu, từ khóa trong tệp, vị trí thư mục, ngày sửa đổi.
3. **Thanh công cụ phụ góc trên phải**:
   - Nút **Đồng bộ trực tiếp (`⟳`)**: Đọc Changes API tức thời từ Google Drive để cập nhật thay đổi.
   - Nút **Giao diện (`☾ / ☼`)**: Chuyển đổi nhanh Sáng / Tối.
   - Nút **Ngôn ngữ (`🌐`)**: Tiếng Việt / English.
   - Nút **Trợ giúp (`?`)**: Hiển thị bảng phím tắt và thông tin trợ giúp.
   - **User Avatar**: Nhấp để mở menu tài khoản nhanh (xem email, trạng thái quản trị, đăng xuất).
4. **Nút `[ + Mới ▾ ]`**: Nút lớn bo tròn dạng viên thuốc `rounded-full` nổi bật, mở menu xổ xuống:
   - *Tải tệp lên*: Chọn 1 hoặc nhiều tệp tải trực tiếp.
   - *Tải thư mục lên*: Hỗ trợ tải toàn bộ cây thư mục con giữ nguyên cấu trúc ảo.
   - *Thư mục mới*: Tạo thư mục ảo, gộp tài khoản tự động.
   - *Tạo Google Docs / Sheets / Slides*: Khởi tạo tệp Google trực tiếp.
5. **Thước đo dung lượng (Storage Gauge)**: Hiển thị trực quan thanh phần trăm dung lượng sử dụng trên tổng tài khoản kết nối (ví dụ: `15,4 GB / 5 TB đã dùng`).

---

## 3. Màn hình 1: Drive của tôi (`/all-files`) — Trung tâm điều khiển

> **Đường dẫn trình duyệt:** `http://localhost:5173/all-files`

Đây là trang cốt lõi, quản lý tập trung toàn bộ cây thư mục ảo gộp từ nhiều tài khoản Google Drive và S3.

### 3.1. Thanh công cụ Toolbar (`DriveToolbar.tsx`)
- **Breadcrumbs (Đường dẫn thư mục)**:
  - Ở gốc: Hiển thị menu `Drive của tôi ▾` cho phép thực hiện thao tác nhanh (Tạo thư mục, Tải lên, v.v.).
  - Trong thư mục con: `Drive của tôi › Thư mục cha › Thư mục con ▾`. Nhấp vào từng đoạn để điều hướng ngược, nhấp mũi tên `▾` ở đoạn cuối để mở menu thao tác cho thư mục hiện tại.
- **Nút chuyển đổi chế độ xem**:
  - `[ ☵ Danh sách ]`: Hiển thị dạng bảng chi tiết (Tên, Chủ sở hữu, Lần sửa đổi cuối, Kích thước, Tài khoản lưu trữ).
  - `[ ⊞ Lưới ]`: Hiển thị dạng thẻ card trực quan với hình thu nhỏ xem trước.
- **Nút Thông tin chi tiết `( i )`**: Bật/tắt ngăn kéo xem thuộc tính tệp bên phải (`DetailsPanel`).

### 3.2. Thanh chip lọc nhanh (`FilterChips.tsx`)
Nằm ngay dưới thanh breadcrumb, giúp lọc tức thời mà không cần gõ lệnh tìm kiếm:
- **`[ Loại ▾ ]`**: Lọc nhanh theo Thư mục, Tài liệu (Docs), Bảng tính (Sheets), Bản trình bày (Slides), PDF, Hình ảnh, Video, Tệp nén.
- **`[ Tài khoản ▾ ]`**: Lọc theo tài khoản Google Drive cụ thể hoặc bucket S3 cụ thể.
- **`[ Lần sửa đổi ▾ ]`**: Lọc theo Hôm nay, 7 ngày qua, 30 ngày qua, Năm nay, hoặc khoảng ngày tùy chọn.
- **`[ Dung lượng ▾ ]`**: Nhỏ (< 1 MB), Trung bình (1 - 100 MB), Lớn (100 MB - 1 GB), Rất lớn (> 1 GB).
- **`[ ✕ Xoá bộ lọc ]`**: Xuất hiện khi có bất kỳ chip nào đang được chọn để thiết lập lại hiển thị gốc.

### 3.3. Hiển thị chế độ Lưới (Grid View - `DriveGridView.tsx`)

```
THƯ MỤC
┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
│ 📁  Hồ sơ dự án      ⋮ │  │ 📁  Ảnh sản phẩm     ⋮ │  │ 📁  Video bài giảng  ⋮ │
└────────────────────────┘  └────────────────────────┘  └────────────────────────┘

TỆP TIN
┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────────┐
│ 🔘 📄 Báo-cáo-2026.docx│  │ 🔘 📊 Doanh-thu-Q3.xlsx│  │ 🔘 🎥 Demo-review.mp4  │
│ ────────────────────── │  │ ────────────────────── │  │ ────────────────────── │
│                        │  │                        │  │     [ ▶ PLAY ]         │
│   [ Thumbnail Doc ]    │  │   [ Thumbnail Sheet ]  │  │   [ Khung video ]      │
│                        │  │                        │  │                        │
│ 12.4 MB · Sửa 2 giờ    │  │ 4.8 MB · Sửa hôm qua   │  │ 128 MB · Sửa 3 ngày    │
└────────────────────────┘  └────────────────────────┘  └────────────────────────┘
```
- **Nút chọn tròn (Circular Checkmark)**: Nằm ở góc trên bên trái mỗi thẻ tệp. Ẩn mặc định, tự động hiện khi hover chuột và chuyển sang màu xanh đặc trưng (`#0b57d0`) khi được chọn.
- **Thao tác kéo thả (Drag and Drop)**: Người dùng có thể kéo thả 1 hoặc nhiều tệp vào các thẻ thư mục để di chuyển vị trí tức thì.
- **Nhấp đúp chuột**: Mở xem trước toàn màn hình (ảnh, tài liệu, video với trình phát Plyr).

### 3.4. Hiển thị chế độ Danh sách (List View - `DriveListView.tsx`)

```
┌────┬──────────────────────────────────────┬──────────────────┬──────────────────┬──────────┬──────────────┐
│ ☑  │ Tên tệp ↑                            │ Chủ sở hữu       │ Sửa đổi lần cuối │ Kích cỡ  │ Tài khoản    │
├────┼──────────────────────────────────────┼──────────────────┼──────────────────┼──────────┼──────────────┤
│ ☐  │ 📁 Kế hoạch Marketing 2026           │ Tôi              │ 14:20 hôm nay    │ --       │ gdrive-acc1  │
│ ☑  │ 📄 Tong-quan-kien-truc.docx          │ Tôi              │ Hôm qua          │ 2.4 MB   │ gdrive-acc2  │
│ ☑  │ 📊 Bao-cao-ngan-sach.xlsx            │ Tôi              │ 28 thg 10        │ 850 KB   │ s3-storage   │
│ ☐  │ 🖼️ Anh-thiet-ke-homepage.png         │ Tôi              │ 25 thg 10        │ 5.1 MB   │ gdrive-acc1  │
└────┴──────────────────────────────────────┴──────────────────┴──────────────────┴──────────┴──────────────┘
```
- **Chọn độc lập & Chọn theo dải**: Nhấp trực tiếp vào ô checkbox để thêm/bớt mục mà không bị mất danh sách đã chọn. Giữ phím `Shift + Nhấp chuột` để chọn toàn bộ dải tệp liên tiếp.

### 3.5. Thanh thao tác hàng loạt nổi (Floating `SelectionBar.tsx`)
Khi có ít nhất 1 tệp hoặc thư mục được chọn, thanh tác vụ nổi sẽ xuất hiện ở cạnh dưới màn hình:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  ✓ 2 mục đã chọn    │  [ ⬇ Tải xuống ZIP ]  [ 📁 Di chuyển ]  [ ⭐ Gắn sao ]  [ 🗑️ Xoá ]     [ ✕ Huỷ ] │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **Tải xuống ZIP gộp**: Máy chủ nén trực tiếp dữ liệu từ Google Drive/S3 thành file ZIP và truyền thẳng về trình duyệt mà không ghi đệm lên ổ cứng máy chủ.

### 3.6. Ngăn thông tin chi tiết bên phải (`DetailsPanel.tsx`)
Mở ra khi bấm nút `( i )` hoặc chọn *Chi tiết tệp*:
- **Tab Chi tiết (Details)**:
  - Xem trước hình thu nhỏ kích thước lớn.
  - Loại tệp (MIME Type), Kích thước thực tế, Tài khoản lưu trữ (`acc1@gmail.com` / `S3 Bucket`).
  - Vị trí thư mục cha, Ngày tạo, Ngày sửa đổi cuối trên Google Drive.
- **Tab Hoạt động (Activity)**: Lịch sử tải lên, đổi tên, di chuyển, chia sẻ của tệp.

---

## 4. Màn hình 2: Trang chủ (`/home`)

> **Đường dẫn trình duyệt:** `http://localhost:5173/home`

Trang chủ được bố trí theo phong cách Google Drive Home 2024, ưu tiên các nội dung người dùng thường xuyên tương tác:
1. **Phần Đề xuất (Suggested Files)**: Hiển thị các thẻ tệp gợi ý mở gần đây nhất với thumbnail lớn và tóm tắt người chỉnh sửa.
2. **Bảng Hoạt động (Activity Table)**: Danh sách các tệp được thêm mới hoặc chỉnh sửa trong ngày/tuần, sắp xếp tự động theo nhóm thời gian (*Hôm nay*, *Hôm qua*, *Tuần trước*).

---

## 5. Màn hình 3: Gần đây (`/recent`) & Có gắn dấu sao (`/starred`)

- **Trang Gần đây (`/recent`)**: Tự động nhóm các tệp theo thời gian truy cập hoặc tải lên. Hỗ trợ đầy đủ bộ lọc chip và chế độ chuyển đổi Lưới/Danh sách.
- **Trang Có gắn dấu sao (`/starred`)**: Gom toàn bộ tài liệu quan trọng đã được đánh dấu sao từ các tài khoản Google Drive khác nhau về một danh sách duy nhất. Thao tác nhấp vào biểu tượng ngôi sao để đánh dấu hoặc bỏ đánh dấu tức thì.

---

## 6. Màn hình 4: Được chia sẻ với tôi (`/shared`) & Thùng rác (`/trash`)

- **Được chia sẻ với tôi (`/shared`)**: Quản lý các tệp và thư mục do người khác chia sẻ đến tài khoản Google của bạn hoặc chia sẻ nội bộ giữa các thành viên HCDrive.
- **Thùng rác (`/trash`)**:
  - Hiển thị các tệp đã xóa mềm.
  - Hàng thông báo màu vàng: *"Các mục trong thùng rác có thể được khôi phục hoặc xóa vĩnh viễn"*.
  - Các nút hành động đặc thù: `[ ↺ Khôi phục ]` và `[ ✕ Xoá vĩnh viễn ]`.
  - Nút **`Dọn sạch thùng rác`** ở góc phải để giải phóng dung lượng nhanh chóng.

---

## 7. Màn hình 5: Quản lý Share & Khóa học (`/library`)

> **Đường dẫn trình duyệt:** `http://localhost:5173/library`

Tính năng chuyên biệt giúp tổ chức các liên kết Google Drive bài giảng, khóa học và thư mục chia sẻ:
- **Tổ chức thẻ Thư viện**: Mỗi liên kết chia sẻ được hiển thị dạng thẻ trực quan kèm ảnh bìa, tên người chia sẻ, email và mô tả.
- **Hỗ trợ 2 chế độ hiển thị linh hoạt (Dual-Mode)**:
  - **Chế độ Khóa học (`isCourse: true`)**: Tối ưu cho việc học tập với trình phát Video Plyr liên tục (tự động ghi nhớ thời điểm đang xem, tự chuyển bài, đánh dấu bài đã học, thanh phần trăm hoàn thành).
  - **Chế độ Thư mục Drive thông thường (`isCourse: false`)**: Duyệt thư mục chia sẻ chuẩn phong cách Google Drive với breadcrumbs nhiều cấp, chuyển đổi hiển thị Lưới/Danh sách, popup modal xem trước trực tiếp tài liệu/video/ảnh, và tải xuống từng tệp hoặc nén tải ZIP cả thư mục.
- **Lưu vào Drive đa tài khoản (Save to Drive)**: Người dùng có thể chọn bất kỳ tài khoản Google Drive nào đã kết nối trong HCDrive để lưu toàn bộ khóa học hoặc thư mục chia sẻ về Drive đó (không phụ thuộc vào email liên kết, truyền stream zero disk).
- **Tự động bypass hạn chế tải xuống từ Google Drive**: Khi liên kết hoặc tệp bị chặn tải xuống, HCDrive tự động trích xuất stream trực tiếp để người dùng xem và tải về mượt mà.
- **Xem thông tin chi tiết**: Xem email người share, tài khoản Google Drive đang gắn kết để truy cập.

---

## 8. Màn hình 6: Quản lý Bộ nhớ & Định tuyến Tải lên (`/storage` & `/accounts`)

> **Đường dẫn trình duyệt:** `http://localhost:5173/storage` hoặc `http://localhost:5173/accounts`

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  BỘ NHỚ LƯU TRỮ HỢP NHẤT                                                                               │
│  68.5 GB đã dùng trên tổng số 15.0 TB                                                  [ + Kết nối mới]│
│  [████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 0.45%           │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  CHÍNH SÁCH PHÂN BỔ TẢI LÊN (UPLOAD ROUTING POLICY)                                                   │
│  (*) Nhiều chỗ trống nhất (Most Available)  ( ) Xoay vòng (Round-Robin)  ( ) Ưu tiên (Priority List)   │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  DANH SÁCH TÀI KHOẢN ĐANG KẾT NỐI                                                                     │
│  ┌─────────────────────────────────┬────────────────────┬────────────────────┬───────────────────────┐ │
│  │ Tài khoản                       │ Nhà cung cấp       │ Đã dùng / Tổng     │ Trạng thái            │ │
│  ├─────────────────────────────────┼────────────────────┼────────────────────┼───────────────────────┤ │
│  │ 🔵 main-drive@gmail.com         │ Google Drive       │ 12.1 GB / 15.0 GB  │ Hoạt động · [⟳ Sync]  │ │
│  │ 🔵 backup-drive@gmail.com       │ Google Drive       │ 3.2 GB / 15.0 GB   │ Hoạt động · [⟳ Sync]  │ │
│  │ 🟠 r2-bucket-singapore          │ S3 Compatible      │ 53.2 GB / Không hạn│ Hoạt động             │ │
│  └─────────────────────────────────┴────────────────────┴────────────────────┴───────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- **Chính sách tải lên tự động**:
  1. *Nhiều chỗ trống nhất*: Tự động định tuyến tệp mới vào tài khoản có dung lượng khả dụng lớn nhất.
  2. *Xoay vòng*: Lần lượt lưu đều vào các tài khoản khả dụng.
  3. *Ưu tiên*: Đổ đầy tài khoản chính trước, khi hết dung lượng mới chuyển sang tài khoản dự phòng.
- **Thao tác nhanh**: Thêm tài khoản Google một chạm, thêm bucket S3 (AWS, Cloudflare R2, MinIO), xuất/nhập cấu hình JSON.

---

## 9. Màn hình 7: Cài đặt Hệ thống (`/settings`)

> **Đường dẫn trình duyệt:** `http://localhost:5173/settings`

Cung cấp các tab cấu hình trực quan:
- **Tab Chung (General)**: Đổi ngôn ngữ (Tiếng Việt / English), chế độ màu giao diện.
- **Tab Khóa API (Developer API Keys)**:
  - Nút **`[ Tài liệu API đầy đủ ]`**: Chuyển nhanh sang trang interactive docs (`/api-docs`).
  - Nút **`[ + Tạo khoá mới ]`**: Tạo API Key với các scope quyền (`files:upload`, `files:read`, v.v.). Secret chỉ hiển thị một lần duy nhất.
  - Khối mã cURL mẫu để tích hợp tải lên vào bash script hoặc hệ thống ngoài.
- **Tab Bảo mật & Captcha (Security)**:
  - Bật/tắt và nhập khóa bảo vệ Google reCAPTCHA v2 hoặc Cloudflare Turnstile.
  - Quản lý phiên đăng nhập (Session Management), đăng xuất từ xa các thiết bị lạ.
- **Tab Quản lý người dùng (Users - Dành cho Quản trị viên)**:
  - Danh sách tài khoản, gán quyền Admin, bật/tắt cho phép đăng ký công khai.
- **Tab Nhật ký hoạt động (Audit Logs)**: Lịch sử thao tác hệ thống, theo dõi IP đăng nhập và sự kiện tải tệp.

---

## 10. Màn hình 8: Tài liệu Lập trình viên REST API (`/api-docs`)

> **Đường dẫn trình duyệt:** `http://localhost:5173/api-docs` (hoặc `/api`)

Được thiết kế theo chuẩn **Stripe 3-Column Documentation Layout**:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [H] HCDrive Developer Reference [REST v1.0]      Base: /api [📋]   [Khoá API]  [Mở Drive]  [☾/☼]       │
├───────────────────┬────────────────────────────────────────────┬───────────────────────────────────────┤
│ 🔍 Tìm kiếm...    │ POST /api/v1/uploads                       │ [ cURL ]  [ JavaScript ]  [ Python ]  │
│                   │ Tải lên tệp qua API Key                    │ ───────────────────────────────────── │
│ TẢI LÊN & API KEY │ Upload a file via API key                  │ curl -X POST                          │
│ [POST] Upload tệp │                                            │   http://localhost:5173/api/v1/uploads│
│                   │ Cho phép ứng dụng bên ngoài upload tệp     │   -H "X-API-Key: hc_live_xxx"        │
│ THƯ MỤC & TẢI ZIP │ trực tiếp vào HCDrive mà không cần cookie. │   -F "file=@/path/to/data.zip"        │
│ [GET]  Tải ZIP    │                                            │                                       │
│ [GET]  Danh sách  │ Tham số yêu cầu (Request Parameters):      │ ───────────────────────────────────── │
│                   │ ┌─────────┬────────┬──────────┬──────────┐ │ [ 200 OK ]   [ 400 Error ]            │
│ TỆP TIN & TẢI GỘP │ │ Field   │ Type   │ Required │ Diễn giải│ │ {                                     │
│ [POST] Tải gộp    │ ├─────────┼────────┼──────────┼──────────┤ │   "success": true,                  │
│ [GET]  Tải tệp    │ │ file    │ Binary │ Bắt buộc │ Dữ liệu  │ │   "file": {                         │
│                   │ │ folderId│ String │ Tuỳ chọn │ Thư mục  │ │     "id": "file_123",               │
│ LƯU TRỮ & DUNG    │ └─────────┴────────┴──────────┴──────────┘ │     "name": "data.zip",             │
│ [GET]  Tổng quan  │                                            │     "size": 1048576                   │
│ [PATCH]Chính sách │                                            │   }                                   │
│                   │                                            │ }                                     │
└───────────────────┴────────────────────────────────────────────┴───────────────────────────────────────┘
```
1. **Cột 1 (Sidebar trái)**:
   - Ô tìm kiếm endpoint trực tiếp.
   - 7 nhóm API (Tải lên & API Key, Thư mục, Tệp tin, Lưu trữ, Xác thực, Chia sẻ, Quản lý Key).
   - Tích hợp **ScrollSpy** bằng `IntersectionObserver`: Tự động cuộn sáng danh mục tương ứng khi người dùng cuộn nội dung.
2. **Cột 2 (Nội dung tài liệu)**:
   - Phương thức HTTP và đường dẫn endpoint (`POST /api/v1/uploads`).
   - Nhãn bảo mật: `API Key` hoặc `Bearer Auth` hoặc `Public`.
   - Mô tả chi tiết song ngữ Việt - Anh.
   - Bảng tham số yêu cầu (Tên, Kiểu, Bắt buộc, Mô tả chi tiết).
3. **Cột 3 (Code Sandbox nền tối `#0f172a`)**:
   - Chuyển đổi linh hoạt giữa các mẫu mã nguồn: **cURL**, **JavaScript (Fetch)**, **Python (requests)**.
   - Chuyển đổi mã phản hồi mẫu: **200 OK** và **400 Error**.
   - Nút sao chép mã nguồn kèm phản hồi trực quan `Đã chép!`.

---

## 11. Màn hình 9: Xác thực & Đăng nhập (`/login`, `/register`)

> **Đường dẫn trình duyệt:** `http://localhost:5173/login`

- **Bố cục khung thẻ Material You**: Nằm chính giữa màn hình với nền bo góc tròn thanh lịch.
- **Nút "Đăng nhập bằng Google" một chạm**: Tự động kết nối và xác thực tài khoản Google Drive đầu tiên.
- **Form đăng nhập Email / Mật khẩu**: Trường nhập liệu chuẩn, hiển thị mật khẩu an toàn, tích hợp widget Captcha chống spam nếu hệ thống bật bảo vệ.

---

## 12. Hệ thống Hộp thoại & Menu ngữ cảnh (Modals & Context Menus)

Tất cả menu chuột phải và popup đều được mount trực tiếp vào `document.body` qua `createPortal` với toạ độ fixed và `z-[9999]`, loại bỏ hoàn toàn lỗi tràn khung hoặc bị che khuất:

1. **Menu chuột phải tệp (`FileContextMenu.tsx`)**:
   - Xem trước / Mở tệp
   - Tải xuống
   - Đổi tên tệp
   - Di chuyển sang thư mục khác
   - Gắn / Bỏ gắn dấu sao
   - Chia sẻ liên kết (Share Dialog)
   - Sao chép liên kết chia sẻ nhanh
   - Xem thông tin chi tiết
   - Chuyển vào thùng rác
2. **Menu chuột phải thư mục (`FolderContextMenu.tsx`)**:
   - Mở thư mục
   - Tải xuống toàn bộ thư mục dạng ZIP
   - Cắt / Di chuyển thư mục
   - Đổi tên thư mục & Đổi màu nhãn thư mục
   - Xoá thư mục
3. **Menu vùng trống (`EmptyAreaContextMenu.tsx`)**:
   - Tạo thư mục mới
   - Tải tệp lên tại đây
   - Tải thư mục lên tại đây
   - Dán thư mục (nếu đang có lệnh Cắt)
4. **Hộp thoại Chia sẻ (`ShareDialog.tsx`)**:
   - Tab 1: Chia sẻ qua Google Drive bằng email người nhận (Quyền Xem / Chỉnh sửa).
   - Tab 2: Tạo link chia sẻ công khai qua HCDrive với tùy chọn đặt mật khẩu, hạn sử dụng, cho phép tải xuống hoặc chỉ xem.

---

## 13. Bảng phím tắt thao tác nhanh (Keyboard Shortcuts)

| Phím tắt | Thao tác tương ứng | Phạm vi |
|---|---|---|
| `Ctrl + A` / `⌘ + A` | Chọn tất cả tệp và thư mục trong thư mục hiện tại | Toàn trang danh sách |
| `Esc` | Hủy toàn bộ lựa chọn hiện tại / Đóng modal / Đóng menu | Toàn hệ thống |
| `Delete` / `Backspace` | Chuyển các mục đang chọn vào Thùng rác | Toàn trang danh sách |
| `Enter` | Mở thư mục hoặc xem trước tệp đang được focus | Toàn trang danh sách |
| `Shift + Click` | Chọn hàng loạt dải tệp liên tiếp | Bảng và lưới tệp |
| `Ctrl + Click` / `⌘ + Click` | Thêm / Bớt từng tệp riêng lẻ vào tập lựa chọn | Bảng và lưới tệp |
| `F2` | Đổi tên tệp hoặc thư mục đang chọn | Trang danh sách tệp |
| `?` | Mở hộp thoại trợ giúp và danh sách phím tắt | Khung App Shell |
| `Space` | Xem trước nhanh tệp tin đang chọn | Trang danh sách tệp |

---

*Tài liệu được cập nhật tự động đồng bộ theo mã nguồn HCDrive 2026.*
