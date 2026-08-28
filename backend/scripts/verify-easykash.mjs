/**
 * Work out how EasyKash signs its callbacks, from one real callback.
 *
 *   npm run verify:easykash -- --payload saved-webhook.json
 *
 * Why this exists
 *   EasyKash publishes its API reference inside the merchant dashboard, not on
 *   the web, so the signature recipe — which fields, in which order, under
 *   which hash — is not knowable until you hold an account. services/payments/
 *   easykash.js therefore keeps the recipe in configuration
 *   (EASYKASH_SIGNATURE_FIELDS / _ALGO) rather than hardcoding a guess.
 *
 *   That leaves one question that has to be answered once, correctly, before
 *   live payments are switched on: what do those settings need to be? Guessing
 *   is dangerous in a quiet way. A WRONG recipe does not break checkout — money
 *   still arrives — it makes every callback fail verification, and the failure
 *   looks exactly like an attack. The temptation at that point is to relax the
 *   check, which is how a payment webhook ends up unauthenticated.
 *
 * What it does
 *   Given one genuine callback body and the shared secret, it searches for the
 *   recipe that reproduces the signature that callback arrived with, then
 *   prints the exact settings to store. If a recipe is already configured it
 *   verifies that one first and tells you plainly whether it matches.
 *
 * Safety
 *   Reads only. Contacts nothing. The secret is taken from the environment or
 *   the command line, is never written anywhere, and is never printed — only a
 *   short fingerprint, so you can tell two secrets apart without exposing one.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ *
 * Arguments
 * ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}
const has = (name) => argv.includes(`--${name}`);

if (has('help') || !arg('payload')) {
  console.log(`
Confirm the EasyKash webhook signature recipe against one real callback.

  npm run verify:easykash -- --payload <saved-webhook.json> [options]

  --payload   <file>   REQUIRED. The callback body as JSON, exactly as received.
  --secret    <value>  Shared secret. Defaults to $EASYKASH_WEBHOOK_SECRET.
  --signature <value>  The signature that arrived. Defaults to whatever looks
                       like one inside the payload (see --signature-field).
  --signature-field <p>  Dotted path to the signature inside the payload.
  --fields    <a,b,c>  Verify THIS ordering instead of searching for one.
  --algo      <name>   Hash for --fields mode (default sha256).
  --max-fields <n>     Longest field combination to try when searching (default 4).

Nothing is sent anywhere and nothing is written. The secret is never printed.
`);
  process.exit(arg('payload') ? 0 : 1);
}

const payloadPath = path.resolve(arg('payload'));
if (!fs.existsSync(payloadPath)) {
  console.error(`No such file: ${payloadPath}`);
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
} catch (err) {
  console.error(`${payloadPath} is not valid JSON — save the callback body verbatim.\n  ${err.message}`);
  process.exit(1);
}

const secret = arg('secret') || process.env.EASYKASH_WEBHOOK_SECRET || '';
if (!secret) {
  console.error('No secret. Pass --secret, or set EASYKASH_WEBHOOK_SECRET in the environment.');
  process.exit(1);
}
// Enough to distinguish two secrets, far too little to reconstruct either.
const secretFp = crypto.createHash('sha256').update(secret).digest('hex').slice(0, 8);

/* ------------------------------------------------------------------ *
 * The payload, flattened
 * ------------------------------------------------------------------ */

/** Every scalar leaf as [dotted.path, stringValue]. Arrays are left alone. */
function leaves(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) leaves(v, key, out);
    else if (v !== undefined && !Array.isArray(v)) out.push([key, v === null ? '' : String(v)]);
  }
  return out;
}

const flat = leaves(payload);
const byPath = new Map(flat);

/** Anything that looks like a hex digest is a signature candidate, not input. */
const SIGNATURE_NAMES = /^(signature|sign|hash|hmac|checksum|x-signature|securityhash)$/i;
const looksLikeDigest = (v) => /^[a-f0-9]{32,128}$/i.test(String(v).trim());

let signature = arg('signature');
let signatureField = arg('signature-field');

if (!signature && signatureField) signature = byPath.get(signatureField);

if (!signature) {
  const named = flat.find(([k, v]) => SIGNATURE_NAMES.test(k.split('.').pop()) && looksLikeDigest(v));
  const anyDigest = named || flat.find(([, v]) => looksLikeDigest(v));
  if (anyDigest) { [signatureField, signature] = anyDigest; }
}

console.log(`\npayload   ${path.relative(process.cwd(), payloadPath)}  (${flat.length} scalar fields)`);
console.log(`secret    fingerprint ${secretFp}  (value not shown)`);

if (!signature) {
  console.error('\nCould not find a signature in the payload, and none was given.');
  console.error('Pass --signature <value> or --signature-field <dotted.path>.');
  console.error(`Fields present: ${flat.map(([k]) => k).join(', ')}`);
  process.exit(1);
}
console.log(`signature ${signatureField ? `${signatureField} = ` : ''}${String(signature).slice(0, 16)}…`);

const target = String(signature).toLowerCase().trim();

/* ------------------------------------------------------------------ *
 * Candidates
 * ------------------------------------------------------------------ */

const ALGOS = ['sha256', 'sha512', 'sha1', 'md5'];
// EasyKash's own docs use bare concatenation, but sibling gateways in the
// region use each of these, and trying them costs microseconds.
const JOINERS = ['', '|', ':', ',', '&', '-'];

/** The signature field itself can never be part of its own input. */
const inputs = flat.filter(([k]) => k !== signatureField && !SIGNATURE_NAMES.test(k.split('.').pop()));

function hmac(algo, data) {
  return crypto.createHmac(algo, secret).update(data).digest('hex');
}
function plain(algo, data) {
  return crypto.createHash(algo).update(data).digest('hex');
}

/** Report a match and print the settings that reproduce it. */
function report({ algo, fields, joiner, mode, signed }) {
  console.log('\n  ✅ MATCH');
  console.log(`     algorithm     ${algo}   (${mode})`);
  console.log(`     fields        ${fields.join(', ')}`);
  if (joiner) console.log(`     joined with   ${JSON.stringify(joiner)}`);
  console.log(`     signed string ${signed.length > 120 ? `${signed.slice(0, 120)}…` : signed}`);
  console.log('\n  Store these:');
  console.log(`     EASYKASH_SIGNATURE_FIELDS = ${fields.join(',')}`);
  console.log(`     EASYKASH_SIGNATURE_ALGO   = ${algo}`);
  if (joiner) {
    console.log(`\n  NOTE: this recipe joins fields with ${JSON.stringify(joiner)}. easykash.js`);
    console.log('  concatenates with no separator, so it needs a small change to match.');
  }
  if (mode !== 'hmac') {
    console.log(`\n  NOTE: this is a plain ${algo} of secret+data, not an HMAC. easykash.js`);
    console.log('  uses createHmac, so it needs a small change to match.');
  }
}

/* ------------------------------------------------------------------ *
 * Mode 1 — verify a recipe that is already known
 * ------------------------------------------------------------------ */

const givenFields = arg('fields');
if (givenFields) {
  const fields = givenFields.split(',').map((s) => s.trim()).filter(Boolean);
  const algo = arg('algo', 'sha256');
  const signed = fields.map((f) => byPath.get(f) ?? '').join('');
  const got = hmac(algo, signed);
  console.log(`\nverifying the given recipe (${algo} over ${fields.length} fields)`);
  console.log(`  signed string  ${signed}`);
  console.log(`  computed       ${got.slice(0, 24)}…`);
  console.log(`  provided       ${target.slice(0, 24)}…`);
  if (got === target) {
    report({ algo, fields, joiner: '', mode: 'hmac', signed });
    process.exit(0);
  }
  console.log('\n  ❌ does not match — searching for a recipe that does…');
}

/* ------------------------------------------------------------------ *
 * Mode 2 — search
 * ------------------------------------------------------------------ */

const MAX_FIELDS = Math.max(1, Math.min(6, Number(arg('max-fields', '4'))));
console.log(`\nsearching: ${inputs.length} fields, combinations up to ${MAX_FIELDS} long`);

let tried = 0;

/** Whole-payload conventions, tried first because they are the common case. */
function wholePayloadShapes() {
  const keysInOrder = inputs.map(([k]) => k);
  const sorted = [...inputs].sort((a, b) => a[0].localeCompare(b[0]));
  return [
    { label: 'all fields, payload order', fields: keysInOrder, values: inputs.map(([, v]) => v) },
    { label: 'all fields, sorted by name', fields: sorted.map(([k]) => k), values: sorted.map(([, v]) => v) },
  ];
}

for (const shape of wholePayloadShapes()) {
  for (const joiner of JOINERS) {
    const signed = shape.values.join(joiner);
    for (const algo of ALGOS) {
      tried += 2;
      if (hmac(algo, signed) === target) {
        report({ algo, fields: shape.fields, joiner, mode: 'hmac', signed });
        process.exit(0);
      }
      if (plain(algo, secret + signed) === target || plain(algo, signed + secret) === target) {
        report({ algo, fields: shape.fields, joiner, mode: `plain hash, secret ${plain(algo, secret + signed) === target ? 'prefixed' : 'appended'}`, signed });
        process.exit(0);
      }
    }
  }
}

/** Ordered selections of `k` fields — order matters, so permutations. */
function* permutations(items, k, prefix = []) {
  if (prefix.length === k) { yield prefix; return; }
  for (let i = 0; i < items.length; i += 1) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    yield* permutations(rest, k, [...prefix, items[i]]);
  }
}

for (let k = 1; k <= MAX_FIELDS; k += 1) {
  for (const combo of permutations(inputs, k)) {
    const values = combo.map(([, v]) => v);
    for (const joiner of JOINERS) {
      const signed = values.join(joiner);
      for (const algo of ALGOS) {
        tried += 1;
        if (hmac(algo, signed) === target) {
          report({ algo, fields: combo.map(([f]) => f), joiner, mode: 'hmac', signed });
          console.log(`\n  (found after ${tried.toLocaleString()} attempts)`);
          process.exit(0);
        }
      }
    }
  }
}

console.log(`\n  ❌ no recipe found after ${tried.toLocaleString()} attempts.`);
console.log('\n  That usually means one of:');
console.log('    - the secret is not the one this callback was signed with');
console.log('    - the signature covers a raw request BODY string, not selected fields');
console.log('      (in that case the exact bytes matter — whitespace and key order included)');
console.log('    - more than 4 fields are involved; retry with --max-fields 5');
console.log('    - the payload was edited after it arrived (re-save it verbatim)');
console.log('\n  Do NOT disable verification to work around this. An unverified payment');
console.log('  webhook is an endpoint that grants premium to anyone who can POST to it.');
process.exit(2);
