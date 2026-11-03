import type { NextFunction, Response } from 'express'
import type { AuthRequest } from './auth.middleware.js'

// Bảo mật cấp hàng (Row Level Security) ở tầng ứng dụng, và chặn IDOR.
//
// SQLite không có RLS như PostgreSQL (CREATE POLICY ... USING (user_id = current_setting(...))),
// nên HCDrive tự đảm bảo điều đó trong code. Mọi truy vấn đọc/sửa/xoá dữ liệu của người dùng phải
// lọc theo chủ sở hữu ngay trong WHERE. Không được lấy bản ghi theo id rồi mới so userId sau, vì
// rất dễ quên bước so ở một route nào đó.
//
// Tất cả khoá chính đã là UUID v4 (`@default(uuid())` trong schema.prisma), token chia sẻ là 32 byte
// ngẫu nhiên. Vì vậy không đoán được id kế tiếp như với id tự tăng 1, 2, 3...
// Nhưng id khó đoán KHÔNG thay cho kiểm tra quyền: id vẫn lộ ra qua link, log, lịch sử trình duyệt.

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4.test(value)
}

/** Điều kiện WHERE "thuộc về người đang đăng nhập". Dùng chung để mọi route lọc giống nhau. */
export function ownedBy(req: AuthRequest) {
  if (!req.user) throw Object.assign(new Error('Bearer token required.'), { status: 401, code: 'AUTH_REQUIRED' })
  return { userId: req.user.id }
}

function notFound(res: Response, code: string) {
  // Trả 404 cả khi bản ghi có thật nhưng của người khác. Trả 403 thì kẻ tấn công biết id đó tồn tại.
  return res.status(404).json({ code, message: 'Not found.' })
}

export type OwnedRequest<T> = AuthRequest & { owned?: T }

/**
 * Middleware chặn IDOR cho route có id trên URL (ví dụ PATCH /files/:id).
 *
 * 1. Id không phải UUID thì trả 404 luôn, không cần chạm DB.
 * 2. `load(id, userId)` phải tự lọc theo chủ sở hữu trong WHERE (dùng `ownedBy`), và trả null khi
 *    không tìm thấy.
 * 3. Bản ghi tìm được gắn vào `req.owned`. Handler phía sau dùng đúng bản ghi đó, không tự lấy
 *    lại theo id thô.
 */
export function requireOwned<T>(options: { param?: string; notFoundCode: string; load: (id: string, req: AuthRequest) => Promise<T | null> }) {
  const param = options.param ?? 'id'
  return async (req: OwnedRequest<T>, res: Response, next: NextFunction) => {
    try {
      const id = req.params[param]
      if (!isUuid(id)) return notFound(res, options.notFoundCode)
      const record = await options.load(id, req)
      if (!record) return notFound(res, options.notFoundCode)
      req.owned = record
      return next()
    } catch (error) {
      return next(error)
    }
  }
}
