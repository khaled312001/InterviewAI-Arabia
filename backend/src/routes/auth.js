import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { signUserToken, signUserRefreshToken } from '../middleware/auth.js';

const router = Router();

const registerSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(200),
  name: z.string().min(2).max(120),
  language: z.enum(['ar', 'en']).default('ar'),
});

const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

const forgotSchema = z.object({
  email: z.string().email().toLowerCase(),
});

function toPublicUser(u) {
  return {
    id: u.id.toString(),
    email: u.email,
    name: u.name,
    language: u.language,
    plan: u.plan,
    dailyQuestionsUsed: u.dailyQuestionsUsed,
    createdAt: u.createdAt,
  };
}

router.post('/register', authLimiter, asyncHandler(async (req, res) => {
  const body = registerSchema.parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: body.email } });
  if (existing) throw new HttpError(409, 'البريد الإلكتروني مستخدم بالفعل / Email already registered');

  const passwordHash = await bcrypt.hash(body.password, 12);
  const user = await prisma.user.create({
    data: {
      email: body.email,
      passwordHash,
      name: body.name,
      language: body.language,
      lastResetDate: new Date(),
    },
  });

  const token = signUserToken(user);
  const refreshToken = signUserRefreshToken(user);
  res.status(201).json({ user: toPublicUser(user), token, refreshToken });
}));

router.post('/login', authLimiter, asyncHandler(async (req, res) => {
  const body = loginSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || user.isDisabled) throw new HttpError(401, 'بيانات الدخول غير صحيحة / Invalid credentials');

  const ok = await bcrypt.compare(body.password, user.passwordHash);
  if (!ok) throw new HttpError(401, 'بيانات الدخول غير صحيحة / Invalid credentials');

  const token = signUserToken(user);
  const refreshToken = signUserRefreshToken(user);
  res.json({ user: toPublicUser(user), token, refreshToken });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  let payload;
  try {
    payload = jwt.verify(refreshToken, env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Invalid refresh token');
  }
  if (payload.type !== 'user-refresh') throw new HttpError(401, 'Invalid refresh token');
  const user = await prisma.user.findUnique({ where: { id: BigInt(payload.sub) } });
  if (!user || user.isDisabled) throw new HttpError(401, 'User not found');
  res.json({ token: signUserToken(user), refreshToken: signUserRefreshToken(user) });
}));

// Stubbed: real flow would issue a reset token via email. Return success to prevent enumeration.
router.post('/forgot-password', authLimiter, asyncHandler(async (req, res) => {
  forgotSchema.parse(req.body);
  // TODO: send reset email when SMTP is configured.
  res.json({ ok: true, message: 'If the email exists, a reset link has been sent.' });
}));

// Stateless JWT: logout is client-side (drop the tokens). Endpoint exists for symmetry.
router.post('/logout', asyncHandler(async (_req, res) => {
  res.json({ ok: true });
}));

export default router;
