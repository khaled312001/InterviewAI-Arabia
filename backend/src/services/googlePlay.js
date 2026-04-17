import { google } from 'googleapis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

let publisher = null;

function getPublisher() {
  if (!env.GOOGLE_PLAY_ENABLED || !env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) return null;
  if (publisher) return publisher;
  let credentials;
  try {
    credentials = JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    logger.error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON', { message: e.message });
    return null;
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  publisher = google.androidpublisher({ version: 'v3', auth });
  return publisher;
}

// Validates a subscription purchase token with Google Play.
export async function verifyGooglePlayPurchase({ productId, purchaseToken }) {
  const pub = getPublisher();
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
