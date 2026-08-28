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
import { sendMail, isConfigured as mailConfigured } from '../services/mail/mailer.js';
import { passwordResetEmail } from '../services/mail/templates.js';
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

const resetSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(200),
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
/** How long a reset link stays valid. Short enough that a forwarded or
 *  archived mail is not a standing key to the account. */
const RESET_TTL_MINUTES = 30;

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

router.post('/forgot-password', authLimiter, asyncHandler(async (req, res) => {
  const body = forgotSchema.parse(req.body);

  // The answer never varies. Saying "no account with that email" turns this
  // endpoint into a membership oracle: anyone can test an address list against
  // it and learn who has an account here — which, for a job-interview product,
  // is telling an employer that their staff are practising for interviews.
  const ok = { ok: true, message: 'If the email exists, a reset link has been sent.' };

  const user = await prisma.user.findUnique({ where: { email: body.email } });
  if (!user || user.isDisabled) return res.json(ok);

  // Google-only accounts have no password to reset; sending them a link would
  // hand them a form that cannot help. They sign in with Google.
  if (!hasUsablePassword(user.passwordHash)) return res.json(ok);

  if (!mailConfigured()) {
    // The old handler returned this same success message with no mail server
    // configured at all, so the app told people to check an inbox nothing had
    // been sent to. The reply still cannot reveal anything, but the operator
    // now finds out from the log instead of from a support ticket.
    logger.error('password reset requested but SMTP is not configured');
    return res.json(ok);
  }

  // Only the hash is stored. A leaked database therefore yields no usable
  // links, and the token exists in plaintext only inside the one email.
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);

  await prisma.$transaction([
    // Any earlier link for this account stops working the moment a new one is
    // asked for, so a stolen older mail cannot be used behind the owner's back.
    prisma.passwordReset.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt },
    }),
  ]);

  const url = `${String(env.APP_URL).replace(/\/$/, '')}/reset-password.html?token=${token}`;
  const mail = passwordResetEmail({ url, minutes: RESET_TTL_MINUTES });

  try {
    await sendMail({ to: user.email, ...mail });
  } catch (err) {
    // Still a 200: the response must not differ by outcome, or it leaks
    // membership by timing and status just as surely as a 404 would.
    logger.error('password reset email failed', { message: err.message });
  }

  return res.json(ok);
}));

/**
 * POST /api/auth/reset-password — spend the token, set the new password.
 */
router.post('/reset-password', authLimiter, asyncHandler(async (req, res) => {
  const body = resetSchema.parse(req.body);

  const row = await prisma.passwordReset.findUnique({
    where: { tokenHash: sha256(body.token) },
    include: { user: true },
  });

  const invalid = () => {
    throw new HttpError(400, 'رابط إعادة التعيين غير صالح أو منتهي / This reset link is invalid or has expired');
  };

  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) invalid();
  if (!row.user || row.user.isDisabled) invalid();

  const passwordHash = await bcrypt.hash(body.password, 12);

  await prisma.$transaction([
    prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    // Every other outstanding link dies with it.
    prisma.passwordReset.updateMany({
      where: { userId: row.userId, usedAt: null },
      data: { usedAt: new Date() },
    }),
  ]);

  logger.info('password reset completed', { userId: row.userId.toString() });
  res.json({ ok: true });
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
