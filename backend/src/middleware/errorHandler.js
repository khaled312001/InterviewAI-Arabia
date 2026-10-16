import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { HttpError } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  /*
   * A response that has already started cannot be turned into a JSON error.
   *
   * Every route here answers in one shot except /api/voice/think, which streams
   * server-sent events to Deepgram for the whole of a live interview. If
   * anything throws after the first byte of that stream, writing a status and
   * a body on top of it raises ERR_HTTP_HEADERS_SENT — and the real error,
   * the one worth reading, is lost behind it. Log that one and drop the
   * connection, which is the only honest thing left to do with it.
   */
  if (res.headersSent) {
    logger.error('Error after response started', {
      message: err?.message, path: req.path,
    });
    // A response that already finished needs nothing: destroying the socket
    // here would cut bytes that have not drained yet, turning a complete
    // answer into a truncated one over a logging detail.
    if (res.writableEnded) return undefined;
    return res.destroy();
  }

  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.flatten() });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.details ? { details: err.details } : {}),
    });
  }
  // Prisma known errors
  if (err?.code === 'P2002') {
    return res.status(409).json({ error: 'Duplicate value', target: err.meta?.target });
  }
  if (err?.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }
  logger.error('Unhandled error', { message: err?.message, stack: err?.stack, path: req.path });
  res.status(500).json({
    error: 'Internal server error',
    ...(env.isProd ? {} : { message: err?.message }),
  });
}
