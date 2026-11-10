# HCDrive - Google Drive Cookie Exporter (Chrome Extension)

Extension tiện ích mở rộng cho Google Chrome (Manifest V3) giúp bạn tự động trích xuất chuỗi Cookie phiên đăng nhập của Google Drive chỉ với 1 click, không cần phải mở DevTools (F12) thủ công.

---

## 🚀 Tính năng nổi bật

- **Tự động quét**: Tự động phát hiện phiên đăng nhập Google Drive và trích xuất đầy đủ các token phiên (`SID`, `HSID`, `SSID`, `SAPISID`, `OSID`, ...).
- **Sao chép 1-Click**: Bấm nút **"Sao chép Cookie"** để copy ngay toàn bộ chuỗi cookie vào clipboard.
- **Tải file text**: Cho phép xuất ra file `.txt` lưu trữ hoặc sử dụng trên nhiều thiết bị.
- **Mở nhanh HCDrive**: 1-click chuyển thẳng tới trang Quản lý tài khoản của HCDrive để dán cookie và kết nối.
- **Bảo mật 100%**: Hoạt động hoàn toàn cục bộ (offline) trên máy tính của bạn, không gửi cookie ra bất kỳ máy chủ bên thứ ba nào.

---

## 📦 Hướng dẫn cài đặt vào Google Chrome

1. **Mở trang quản lý Extension của Chrome**:
   - Truy cập vào địa chỉ: `chrome://extensions/` trên thanh địa chỉ Chrome (hoặc vào menu Chrome: `Cài đặt` -> `Tiện ích mở rộng` -> `Quản lý tiện ích`).

2. **Bật Chế độ dành cho nhà phát triển (Developer mode)**:
   - Gạt công tắc **"Chế độ dành cho nhà phát triển"** (Developer mode) ở góc trên bên phải sang **BẬT (ON)**.

3. **Tải tiện ích đã giải nén (Load unpacked)**:
   - Bấm vào nút **"Tải tiện ích đã giải nén"** (Load unpacked) ở góc trên bên trái.
   - Chọn thư mục:
     ```
     tools/hcdrive-cookie-extension
     ```
     *(Hoặc từ Windows: `Z:\Docker\9Drive\tools\hcdrive-cookie-extension` hoặc `Z:\Docker\9Drive\extension-chrome`)*

4. **Ghim Extension**:
   - Bấm vào biểu tượng mảnh ghép (Extensions) trên thanh công cụ của Chrome và bấm **Ghim (Pin)** `HCDrive - Google Drive Cookie Exporter`.

---

## 💡 Hướng dẫn sử dụng để kết nối Google Drive vào HCDrive

1. Đảm bảo bạn đã đăng nhập tài khoản Google Drive trên trình duyệt Chrome (`https://drive.google.com`).
2. Bấm vào biểu tượng Extension **HCDrive Cookie Exporter** trên thanh công cụ Chrome:
   - Extension sẽ hiển thị trạng thái phiên: `Đã tìm thấy phiên Google Drive hợp lệ` kèm các tick xanh (`✓ SID`, `✓ HSID`, `✓ SSID`, ...).
3. Bấm nút **"Sao chép Cookie"**.
4. Truy cập **HCDrive** -> Trang **Tài khoản lưu trữ** (`/accounts`) -> Bấm nút **"Kết nối bằng Cookie"** (hoặc mở modal kết nối Google Drive -> chọn *Cookie Google Drive*).
5. Dán chuỗi Cookie vừa sao chép vào ô **Chuỗi Cookie Google Drive** và bấm **"Kiểm tra & Kết nối"**.
6. Hệ thống sẽ tự động xác thực và kết nối tài khoản Google Drive thành công!
