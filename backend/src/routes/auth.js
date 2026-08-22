import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import crypto from 'node:crypto';

import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';
import { authLimiter, registerLimiter } from '../middleware/rateLimit.js';
import { asyncHandler, HttpError } from '../utils/asyncHandler.js';
import { signUserToken, signUserRefreshToken } from '../middleware/auth.js';
import { setting } from '../services/appSettings.js';
import { verifyGoogleIdToken, NO_PASSWORD, hasUsablePassword } from '../services/auth/googleIdentity.js';
import { logger } from '../utils/logger.js';

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

const googleSchema = z.object({
  idToken: z.string().min(20).max(4096),
  language: z.enum(['ar', 'en']).optional(),
});

function toPublicUser(u) {
  return {
    id: u.id.toString(),
    email: u.email,
    name: u.name,
    language: u.language,
    plan: u.plan,
    dailyQuestionsUsed: u.dailyQuestionsUsed,
    avatarUrl: u.avatarUrl ?? null,
    // Whether a password can be used to sign in or to confirm deletion. False
    // for a Google-only account, and the client needs it: a screen that demands
    // a password from someone who has never had one is a dead end.
    hasPassword: hasUsablePassword(u.passwordHash),
    createdAt: u.createdAt,
  };
}

// BOTH limiters, and they do different jobs: authLimiter skips successful
// requests (right for guessing, useless against sign-up farming), while
// registerLimiter counts every one. Each free account is worth ten minutes of
// model time, so creating them cannot be free and unlimited.
router.post('/register', registerLimiter, authLimiter, asyncHandler(async (req, res) => {
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

/* ------------------------------------------------------------------ *
 * POST /api/auth/google — sign in with Google
 * ------------------------------------------------------------------ */

/**
 * Every client id this deployment will accept a token for.
 *
 * Google issues a different one per platform and the ID token's `aud` is
 * whichever client started the flow, so the web button, the Android app and
 * iOS each produce a different value for the same human. Android can
 * contribute MORE than one: an Android OAuth client carries a single SHA-1, and
 * a published app has two that matter — the upload key and the Play App
 * Signing key — so each setting holds a comma-separated list.
 *
 * All are public values (they ship inside the client), so they live in
 * app_settings and can be pasted into the admin panel without a deploy.
 */
function googleAudiences() {
  return [
    setting('google_client_id_web'),
    setting('google_client_id_android'),
    setting('google_client_id_ios'),
  ]
    .filter(Boolean)
    .flatMap((v) => String(v).split(',').map((s) => s.trim()))
    .filter(Boolean);
}

router.post('/google', authLimiter, asyncHandler(async (req, res) => {
  const body = googleSchema.parse(req.body);

  let profile;
  try {
    profile = await verifyGoogleIdToken(body.idToken, googleAudiences());
  } catch (err) {
    // Deliberately not echoed: the reason distinguishes "not configured" from
    // "forged token", and only the operator needs that difference.
    logger.warn('google sign-in rejected', { message: err.message });
    throw new HttpError(401, 'تعذّر تسجيل الدخول عبر جوجل / Google sign-in failed');
  }

  // Match on the Google subject first. It is the stable identifier: an account
  // whose Google email later changes must stay the same account, and matching
  // on email alone would silently create a second one.
  let user = await prisma.user.findFirst({ where: { googleSub: profile.sub } });

  if (!user) {
    const byEmail = await prisma.user.findUnique({ where: { email: profile.email } });
    if (byEmail) {
      // An existing password account with the same VERIFIED Google address.
      // Linking is safe precisely because the address is verified by Google —
      // it is the same person, and refusing here would strand them behind a
      // password they may not have.
      //
      // The password on that account is a different question, and the answer
      // is only safe one way round. Anyone can sign up with anyone's address:
      // registration proves possession of a mailbox only once the address is
      // verified, and until then `passwordHash` belongs to whoever typed it,
      // not to whoever owns the address. So an account that was never verified
      // and still has a real bcrypt hash is a pre-registration: someone claimed
      // this address ahead of its owner, and linking as-is would hand them a
      // working password into the account Google just proved is somebody
      // else's.
      //
      // Google's verification settles the address; it says nothing about that
      // password, so the password does not survive the link. The genuine owner
      // loses nothing they can prove they had — they are signing in with Google
      // right now, and "forgot password" is open to them afterwards from an
      // inbox that is now verified.
      const unprovenPassword = !byEmail.emailVerifiedAt && hasUsablePassword(byEmail.passwordHash);
      if (unprovenPassword) {
        logger.warn('google link cleared an unverified password', { userId: byEmail.id.toString() });
      }

      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleSub: profile.sub,
          avatarUrl: byEmail.avatarUrl ?? profile.picture,
          emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
          lastLoginAt: new Date(),
          ...(unprovenPassword ? { passwordHash: NO_PASSWORD } : null),
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email: profile.email,
          passwordHash: NO_PASSWORD,
          name: profile.name || profile.email.split('@')[0],
          language: body.language || 'ar',
          googleSub: profile.sub,
          avatarUrl: profile.picture,
          emailVerifiedAt: new Date(),
          lastLoginAt: new Date(),
          lastResetDate: new Date(),
        },
      });
    }
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), avatarUrl: user.avatarUrl ?? profile.picture },
    });
  }

  if (user.isDisabled) throw new HttpError(403, 'هذا الحساب موقوف / This account is suspended');

  res.json({
    user: toPublicUser(user),
    token: signUserToken(user),
    refreshToken: signUserRefreshToken(user),
  });
}));

/**
 * GET /api/auth/google/config — is the button worth rendering?
 *
 * The client asks before drawing a "sign in with Google" button, so an
 * unconfigured deployment shows no button at all rather than one that fails
 * when tapped. Returns only public client ids.
 */
router.get('/google/config', asyncHandler(async (_req, res) => {
  /*
   * The client starts the flow with exactly ONE id per platform, so it gets the
   * FIRST of each list — handing it a comma-separated string would be sent as
   * `client_id` verbatim and rejected by Google as malformed.
   *
   * The rest of the list still matters on the way back in: /google exists to
   * ACCEPT a token from any of our clients, and a Play-signed install presents
   * a different `aud` than the same build installed from a local APK. So the
   * client picks one to ask with, and the server trusts all of them.
   */
  const first = (key) => {
    const v = setting(key);
    return v ? String(v).split(',')[0].trim() : null;
  };
  res.json({
    enabled: googleAudiences().length > 0,
    webClientId: first('google_client_id_web'),
    androidClientId: first('google_client_id_android'),
    iosClientId: first('google_client_id_ios'),
  });
}));

// Stateless JWT: logout is client-side (drop the tokens). Endpoint exists for symmetry.
router.post('/logout', asyncHandler(async (_req, res) => {
  res.json({ ok: true });
}));

export default router;
