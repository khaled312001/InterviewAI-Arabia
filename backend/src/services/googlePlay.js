// Google Play purchase verification — only loaded when actually needed.
// `googleapis` is ~100 MB and bloats Vercel cold starts to >60 s if imported
// at module top, so we use dynamic import() inside the verify function.
// On Hostinger this matters less but is still nicer.

import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let publisher = null;

async function getPublisher() {
  if (!env.GOOGLE_PLAY_ENABLED || !env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) return null;
  if (publisher) return publisher;
  let credentials;
  try {
    credentials = JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    logger.error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON', { message: e.message });
    return null;
  }
  let google;
  try {
    ({ google } = await import('googleapis'));
  } catch (e) {
    logger.warn('googleapis not installed — install it to enable Google Play verification', { message: e.message });
    return null;
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  publisher = google.androidpublisher({ version: 'v3', auth });
  return publisher;
}

export async function verifyGooglePlayPurchase({ productId, purchaseToken }) {
  const pub = await getPublisher();
  if (!pub) {
    return {
      valid: false,
      error: 'Google Play verification disabled on server (GOOGLE_PLAY_ENABLED=false)',
    };
  }

  const res = await pub.purchases.subscriptions.get({
    packageName: env.GOOGLE_PLAY_PACKAGE_NAME,
    subscriptionId: productId,
    token: purchaseToken,
  });
  const expiryMs = Number(res.data.expiryTimeMillis);
  const valid = Number.isFinite(expiryMs) && expiryMs > Date.now()
    && (res.data.paymentState === 1 || res.data.paymentState === 2);

  return {
    valid,
    expiresAt: Number.isFinite(expiryMs) ? new Date(expiryMs) : null,
    raw: res.data,
  };
}
