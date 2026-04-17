import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../utils/asyncHandler.js';

export function signUserToken(user) {
  return jwt.sign(
    { sub: user.id.toString(), type: 'user', plan: user.plan },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

export function signUserRefreshToken(user) {
  return jwt.sign(
    { sub: user.id.toString(), type: 'user-refresh' },
    env.JWT_SECRET,
    { expiresIn: env.JWT_REFRESH_EXPIRES_IN }
  );
}

export function signAdminToken(admin) {
  return jwt.sign(
    { sub: admin.id.toString(), type: 'admin', role: admin.role },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN }
  );
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

export function requireUser(req, _res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw new HttpError(401, 'Authentication required');
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (payload.type !== 'user') throw new HttpError(401, 'Invalid token type');
    req.userId = BigInt(payload.sub);
    req.tokenPlan = payload.plan;
    next();
  } catch (err) {
    if (err instanceof HttpError) return next(err);
    next(new HttpError(401, 'Invalid or expired token'));
  }
}

export function requireAdmin(...allowedRoles) {
  return async (req, _res, next) => {
    try {
      const token = extractToken(req);
      if (!token) throw new HttpError(401, 'Authentication required');
      const payload = jwt.verify(token, env.JWT_SECRET);
      if (payload.type !== 'admin') throw new HttpError(403, 'Admin access required');
      if (allowedRoles.length && !allowedRoles.includes(payload.role)) {
        throw new HttpError(403, 'Insufficient role');
      }
      const admin = await prisma.adminUser.findUnique({ where: { id: BigInt(payload.sub) } });
      if (!admin || !admin.isActive) throw new HttpError(403, 'Admin deactivated');
      req.admin = admin;
      next();
    } catch (err) {
      if (err instanceof HttpError) return next(err);
      next(new HttpError(401, 'Invalid or expired admin token'));
    }
  };
}
