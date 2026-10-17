## Chạy nhanh trên Windows

Pull hoặc tải đầy đủ project, sau đó bấm đúp `run_server.bat`.

- Tự kiểm tra Node.js, FFmpeg và FFprobe; thiếu công cụ nào thì tải bản portable vào `.tools/` và kiểm tra SHA256.
- Không cần quyền admin, cài npm hay sửa PATH thủ công. Giữ `start-server.ps1` đi kèm file `.bat`.
- Lần đầu cần Internet nếu thiếu công cụ. Những lần sau dùng lại công cụ đã có.
- Server chạy nền và tự mở http://localhost:3636. Lỗi được hiển thị trong cửa sổ; log server nằm ở `server.log` và `server-error.log`.
- Yêu cầu Windows 10/11 64-bit. Bản FFmpeg tải tự động là x64.

# Fast Video

Web local: chọn video mẫu → chọn ảnh → render ra video mới với ảnh đó, **giữ nguyên audio và độ dài** của video mẫu.

## Chạy

```bash
node server.js
```

Mở http://localhost:3000

Đổi port: `PORT=8080 node server.js` (PowerShell: `$env:PORT=8080; node server.js`)

## Thư mục

- `templates/` — thư viện video mẫu, lưu lâu dài. Thêm video bằng nút **+ Thêm video mẫu** trên web, hoặc copy file `.mp4/.mov/.webm/.mkv` vào đây rồi restart server.
- `output/` — kết quả render + ảnh tạm. Ảnh tạm bị xoá ngay sau khi render; video kết quả tự dọn sau 24h.

## Cách dùng

1. Bấm video mẫu trong lưới (hover để xem trước).
2. Kéo thả **nhiều ảnh** cùng lúc — mỗi ảnh ra một video riêng.
3. (Tuỳ chọn) Bấm **Chọn thư mục** để video tự lưu vào đĩa sau khi render xong.
4. Chọn chế độ ảnh + kích thước.
5. Bấm **Render video**.

Video mẫu hiện sẵn luôn, mỗi lần chỉ cần chọn ảnh.

### Lựa chọn được nhớ lại

Cả 3 lựa chọn đều tự lưu, mở lại trang là giữ nguyên:

- **Chế độ ảnh** và **Kích thước** — lưu trong `localStorage`.
- **Nơi lưu video** — lưu trong `IndexedDB`.

Về thư mục: Chrome/Edge nhớ đường dẫn giữa các lần mở trang, nhưng quyền ghi có thể phải cấp lại sau khi trình duyệt khởi động lại — lúc đó ô nhập hiện "cần bấm lại để cấp quyền", bấm **Chọn thư mục** một lần là xong. Đây là hạn chế bắt buộc của trình duyệt, không phải của web.

### Lưu tự động vào thư mục

Bấm **Chọn thư mục** một lần, web sẽ hỏi quyền truy cập thư mục đó. Sau khi render, từng video được ghi thẳng vào thư mục với tên `<ngày giờ>_<tên ảnh>.mp4`.

- Cần **Chrome hoặc Edge** (dùng File System Access API). Firefox/Safari sẽ báo rõ lý do không hỗ trợ.
- Chưa chọn thư mục thì video vẫn nằm trong `output/` như trước.

### Render hàng loạt

Các ảnh được render **tuần tự**, không song song — tránh ffmpeg tranh nhau CPU và vẫn đảm bảo từng video giữ nguyên độ dài. Giao diện hiện tiến độ và trạng thái từng video; video lỗi không chặn các video còn lại.

## Chế độ ảnh

| Mode | Kết quả |
|---|---|
| Lấp đầy | Ảnh phủ kín khung, cắt phần dư (mặc định) |
| Vừa khung | Ảnh vừa trong khung, nền đen |
| Lấp đầy + nền mờ | Ảnh vừa khung, phần nền thừa làm mờ |

## Yêu cầu

- Node.js
- ffmpeg + ffprobe trong PATH

Không có dependency npm nào — server dùng module `http`/`fs`/`child_process` của Node và gọi ffmpeg CLI.

## API

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/templates` | Danh sách video mẫu |
| POST | `/api/templates` | Upload video mẫu (multipart `file`) |
| DELETE | `/api/templates/:name` | Xoá video mẫu |
| GET | `/api/probe?name=` | Thông tin video (kích thước, fps, thời lượng) |
| POST | `/api/render` | Render batch (multipart `image0`, `image1`, … + `settings` JSON) → `{ batchId, items }` |
| GET | `/api/batch/:id` | Trạng thái cả batch + từng video |