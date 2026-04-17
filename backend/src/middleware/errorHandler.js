import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { HttpError } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';

export function notFound(_req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.flatten() });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
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
