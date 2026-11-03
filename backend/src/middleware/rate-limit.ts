import type { NextFunction, Request, Response } from 'express'
import { verifyAccessToken } from '../utils/jwt.js'

// Giới hạn tốc độ request (rate limiting) theo cửa sổ cố định (fixed window).
//
// Mỗi "khoá" (IP, user, hoặc IP + email khi đăng nhập) có một bộ đếm sống trong `windowMs`.
// Vượt `max` thì trả 429 kèm `Retry-After`, cho tới khi cửa sổ hết hạn.
//
// Trạng thái nằm trong bộ nhớ tiến trình (MemoryRateLimitStore). Cách này hợp với HCDrive vì
// chạy một container, một tiến trình Node, dùng SQLite. Nếu sau này chạy nhiều bản backend sau
// load balancer, mỗi bản sẽ đếm riêng. Khi đó cần store dùng chung như Redis: chỉ cần viết một
// lớp theo interface RateLimitStore (INCR + PEXPIRE) rồi truyền vào `store`.

export type RateLimitHit = { count: number; resetAt: number }

export interface RateLimitStore {
  /** Tăng bộ đếm của khoá, tạo cửa sổ mới nếu chưa có hoặc đã hết hạn. */
  hit(key: string, windowMs: number): RateLimitHit
  /** Trừ lại một lần (dùng cho skipSuccessfulRequests). */
  undo(key: string): void
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, RateLimitHit>()

  constructor(cleanupEveryMs = 60_000) {
    // Dọn các khoá đã hết hạn để Map không phình mãi khi bị quét từ nhiều IP.
    // unref(): bộ hẹn giờ này không giữ tiến trình sống khi server tắt.
    setInterval(() => {
      const now = Date.now()
      for (const [key, bucket] of this.buckets) if (bucket.resetAt <= now) this.buckets.delete(key)
    }, cleanupEveryMs).unref()
  }

  hit(key: string, windowMs: number): RateLimitHit {
    const now = Date.now()
    const current = this.buckets.get(key)
    if (!current || current.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs }
      this.buckets.set(key, fresh)
      return fresh
    }
    current.count += 1
    return current
  }

  undo(key: string) {
    const current = this.buckets.get(key)
    if (current && current.count > 0) current.count -= 1
  }
}

const sharedStore = new MemoryRateLimitStore()

export type RateLimitOptions = {
  /** Tên bộ giới hạn, gắn vào khoá để các bộ khác nhau không dùng chung bộ đếm. */
  name: string
  windowMs: number
  max: number
  /** Trả về khoá cần đếm; null = không giới hạn request này. */
  key: (req: Request) => string | null
  /** Chỉ đếm request thất bại (status >= 400), ví dụ đăng nhập sai mật khẩu. */
  skipSuccessfulRequests?: boolean
  message?: string
  store?: RateLimitStore
}

/** IP thật của client. Chỉ đúng khi `trust proxy` được cấu hình đúng (xem TRUST_PROXY trong env.ts). */
export function clientIp(req: Request) {
  return req.ip || req.socket.remoteAddress || 'unknown'
}

/**
 * Request đã đăng nhập được đếm theo user (mỗi người một hạn mức, kể cả khi nhiều người chung
 * một IP công ty). Còn lại đếm theo IP.
 *
 * Chỉ JWT hợp lệ mới được đếm theo user. Nếu đếm theo chuỗi Bearer bất kỳ, kẻ tấn công chỉ cần
 * gửi chuỗi ngẫu nhiên mỗi lần là có bộ đếm mới, tức là vượt giới hạn.
 */
export function userOrIpKey(req: Request) {
  const header = req.header('Authorization')
  if (header?.startsWith('Bearer ')) {
    try {
      return `user:${verifyAccessToken(header.slice(7)).sub}`
    } catch {
      // Token hết hạn, sai, hoặc là API key: rơi xuống đếm theo IP.
    }
  }
  return `ip:${clientIp(req)}`
}

export function rateLimit(options: RateLimitOptions) {
  const store = options.store ?? sharedStore
  return (req: Request, res: Response, next: NextFunction) => {
    const subject = options.key(req)
    if (!subject) return next()
    const key = `${options.name}:${subject}`
    const { count, resetAt } = store.hit(key, options.windowMs)
    const resetSeconds = Math.max(0, Math.ceil((resetAt - Date.now()) / 1000))

    // Header theo bản nháp IETF "RateLimit header fields", để client biết còn bao nhiêu lượt.
    res.setHeader('RateLimit-Limit', String(options.max))
    res.setHeader('RateLimit-Remaining', String(Math.max(0, options.max - count)))
    res.setHeader('RateLimit-Reset', String(resetSeconds))

    if (count > options.max) {
      // Lượt bị chặn không được trừ lại: cứ spam tiếp thì vẫn bị chặn tới hết cửa sổ.
      res.setHeader('Retry-After', String(resetSeconds))
      return res.status(429).json({
        code: 'RATE_LIMITED',
        message: options.message ?? `Quá nhiều yêu cầu. Thử lại sau ${resetSeconds} giây.`,
        retryAfterSeconds: resetSeconds,
      })
    }

    if (options.skipSuccessfulRequests) {
      // Đăng nhập đúng thì không tính, để người dùng thật không bị khoá vì vài lần gõ sai trước đó.
      res.on('finish', () => {
        if (res.statusCode < 400) store.undo(key)
      })
    }
    return next()
  }
}

const MINUTE = 60_000

/** Lấy email trong body (đã chuẩn hoá) để khoá theo cặp IP + tài khoản khi đăng nhập. */
function bodyEmail(req: Request) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  return email || null
}

// Các bộ giới hạn dùng trong app. Đặt ở một chỗ để dễ chỉnh và dễ đọc khi rà soát bảo mật.
export const limiters = {
  // Toàn bộ API: 2000 request / 15 phút cho mỗi user (hoặc IP nếu chưa đăng nhập).
  // Không dùng 100/15 phút: một lần mở thư mục có ảnh thu nhỏ, hoặc tua video (mỗi lần tua là một
  // range request) đã tốn hàng chục request. Chỉnh bằng RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MINUTES.
  api: (max: number, windowMinutes: number) => rateLimit({ name: 'api', windowMs: windowMinutes * MINUTE, max, key: userOrIpKey }),

  // Chống dò mật khẩu: 10 lần sai / 15 phút cho mỗi cặp IP + email, và 100 lần / 15 phút cho mỗi IP
  // (chặn kiểu thử một mật khẩu trên rất nhiều email).
  loginPerAccount: rateLimit({
    name: 'login-account',
    windowMs: 15 * MINUTE,
    max: 10,
    skipSuccessfulRequests: true,
    key: (req) => {
      const email = bodyEmail(req)
      return email ? `${clientIp(req)}:${email}` : null
    },
    message: 'Sai mật khẩu quá nhiều lần. Hãy đợi 15 phút rồi thử lại.',
  }),
  loginPerIp: rateLimit({ name: 'login-ip', windowMs: 15 * MINUTE, max: 100, skipSuccessfulRequests: true, key: (req) => clientIp(req) }),

  // Tạo tài khoản: 5 / giờ mỗi IP, chống tạo tài khoản rác hàng loạt.
  register: rateLimit({ name: 'register', windowMs: 60 * MINUTE, max: 5, key: (req) => clientIp(req), message: 'Đăng ký quá nhiều lần từ địa chỉ này. Thử lại sau.' }),

  // Làm mới token: rộng tay vì mỗi tab gọi định kỳ; frontend không đăng xuất khi gặp 429 ở đây.
  refresh: rateLimit({ name: 'refresh', windowMs: 15 * MINUTE, max: 300, key: (req) => clientIp(req) }),

  // Các thao tác cần nhập lại mật khẩu (đổi mật khẩu, xuất token lưu trữ): theo user,
  // để token bị lộ cũng không dò được mật khẩu.
  passwordCheck: rateLimit({ name: 'password-check', windowMs: 15 * MINUTE, max: 10, skipSuccessfulRequests: true, key: userOrIpKey, message: 'Nhập sai mật khẩu quá nhiều lần. Hãy đợi 15 phút.' }),

  // Link chia sẻ công khai: token 32 byte ngẫu nhiên nên không đoán được, giới hạn thêm theo IP
  // để chặn quét hàng loạt và tải lặp lại làm cạn băng thông.
  publicShare: rateLimit({ name: 'public-share', windowMs: 15 * MINUTE, max: 600, key: (req) => clientIp(req) }),
}
