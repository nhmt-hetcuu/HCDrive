import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'

export function errorMiddleware(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    const issues = (error as any).issues || (error as any).errors || []
    const message = (issues as any[]).map((e: any) => `${e.path?.join?.('.') || 'body'}: ${e.message}`).join('; ') || 'Validation failed'
    return res.status(400).json({
      code: 'VALIDATION_ERROR',
      message,
      errors: typeof error.flatten === 'function' ? error.flatten() : issues,
    })
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'The requested record was not found.',
      })
    }
    if (error.code === 'P2002') {
      return res.status(409).json({
        code: 'CONFLICT',
        message: 'A record with this unique value already exists.',
      })
    }
  }

  if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
    return res.status(400).json({
      code: 'INVALID_JSON',
      message: 'Malformed JSON payload.',
    })
  }

  // Google (gaxios) and S3 errors carry the provider's HTTP status, often 401/403. Passing that through would make
  // the frontend treat it as an expired HCDrive session and log the user out, so report an upstream failure instead.
  const upstream = error as { response?: unknown; config?: unknown; $metadata?: unknown }
  if ((upstream.response && upstream.config) || upstream.$metadata) {
    console.error('[errorMiddleware] storage provider error', error)
    return res.status(502).json({
      code: 'STORAGE_PROVIDER_ERROR',
      message: error instanceof Error ? error.message : 'Storage provider request failed.',
    })
  }

  const customError = error as { status?: number; statusCode?: number; code?: string; message?: string }
  const status = typeof customError.status === 'number' ? customError.status : typeof customError.statusCode === 'number' ? customError.statusCode : 500
  const code = customError.code || (status === 500 ? 'INTERNAL_SERVER_ERROR' : 'ERROR')
  const message = error instanceof Error ? error.message : 'Internal server error'

  if (status >= 500) {
    console.error('[errorMiddleware]', error)
  }

  return res.status(status).json({ code, message })
}
