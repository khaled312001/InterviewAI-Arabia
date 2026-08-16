/**
 * Envelope encryption for provider credentials.
 *
 * AES-256-GCM with the credential key bound in as AAD. Binding the key name
 * means a ciphertext copied from one row to another fails to authenticate —
 * without it, an attacker with DB write access could move the (still secret)
 * EasyKash webhook secret into the ANTHROPIC_API_KEY row and have the app
 * happily send it to a third party.
 *
 * Blob format: `v1.<iv b64>.<tag b64>.<ciphertext b64>`. The version prefix is
 * there so a future key-rotation scheme can tell old rows from new ones
 * without a migration.
 */

import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

const VERSION = 'v1';
const KDF_SALT = 'thiqty.provider-credentials.v1';
const IV_BYTES = 12;

let cachedKey = null;
let warned = false;

/**
 * The master key is derived, never stored raw.
 *
 * CREDENTIALS_SECRET is the right input because it can be rotated
 * independently. Falling back to JWT_SECRET keeps the feature working on a
 * deployment that has not set it yet — but it couples the two: rotating
 * JWT_SECRET would then make every stored credential undecryptable, which is
 * why production says so loudly.
 */
function masterKey() {
  if (cachedKey) return cachedKey;

  const source = env.CREDENTIALS_SECRET || env.JWT_SECRET;
  if (!source || source.length < 32) {
    throw new Error('CREDENTIALS_SECRET (or JWT_SECRET) must be at least 32 characters');
  }
  if (!env.CREDENTIALS_SECRET && !warned) {
    warned = true;
    logger.warn(
      '[credentials] CREDENTIALS_SECRET is not set — deriving from JWT_SECRET. '
      + 'Rotating JWT_SECRET will make every stored provider credential unreadable.',
    );
  }

  cachedKey = crypto.scryptSync(source, KDF_SALT, 32);
  return cachedKey;
}

/** True when the process can encrypt/decrypt at all. */
export function isCryptoAvailable() {
  try {
    masterKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} plaintext
 * @param {string} aad  The credential key this value belongs to.
 * @returns {string} opaque blob, safe to store
 */
export function encryptSecret(plaintext, aad) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

/**
 * @throws when the blob is malformed, tampered with, or was written under a
 *         different master key. Callers treat a throw as "unreadable", never
 *         as "empty" — silently falling back to the env value would let a
 *         corrupted row quietly re-enable an old key.
 */
export function decryptSecret(blob, aad) {
  const parts = String(blob).split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Unrecognised credential blob format');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

/** The only fragment of a secret that is ever allowed out of this process. */
export function last4(value) {
  const s = String(value ?? '');
  return s.length <= 4 ? '' : s.slice(-4);
}
