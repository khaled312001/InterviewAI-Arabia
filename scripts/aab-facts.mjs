/**
 * Print the facts Google Play will judge an .aab by — BEFORE uploading it.
 *
 *   node scripts/aab-facts.mjs release/interprova-app-release.aab
 *   node scripts/aab-facts.mjs release/foo.aab --libs    # + native lib alignment
 *
 * Why this exists
 *   An AAB's manifest is protobuf, not binary XML, so `aapt2 dump badging` and
 *   `aapt2 dump xmltree` both refuse it outright ("could not identify format of
 *   APK") — the tools everyone reaches for only read APKs. So the one artifact
 *   that actually gets uploaded is the one nothing checks, and the first thing
 *   to read its manifest is the Play console, after a 70 MB upload:
 *
 *     "Version code 3 has already been used. Try another version code."
 *
 *   which is what happened on 2026-08-29. Everything below is decoded straight
 *   out of base/manifest/AndroidManifest.xml, so it is what Play will see.
 *
 * The decoder is a partial implementation of aapt.pb (XmlNode/XmlElement/
 * XmlAttribute/Item/Primitive) — enough for the manifest and nothing more.
 */

import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const [, , aabArg, ...flags] = process.argv;
if (!aabArg) {
  console.error('usage: node scripts/aab-facts.mjs <file.aab> [--libs]');
  process.exit(2);
}
statSync(aabArg); // throws a clear ENOENT rather than a confusing unzip error
const WANT_LIBS = flags.includes('--libs');

const unzip = (entry) =>
  execFileSync('unzip', ['-p', aabArg, entry], { maxBuffer: 1 << 30 });

/* ── protobuf: just enough ─────────────────────────────────────────────── */

function varint(buf, pos) {
  let result = 0n, shift = 0n;
  for (;;) {
    const byte = buf[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return [result, pos];
}

/** fieldNumber -> array of values (Buffer for length-delimited, BigInt for varint). */
function decode(buf, start = 0, end = buf.length) {
  const fields = new Map();
  let pos = start;
  while (pos < end) {
    let key;
    [key, pos] = varint(buf, pos);
    const field = Number(key >> 3n), wire = Number(key & 7n);
    let value;
    if (wire === 0) { [value, pos] = varint(buf, pos); }
    else if (wire === 2) {
      let len; [len, pos] = varint(buf, pos);
      value = buf.subarray(pos, pos + Number(len)); pos += Number(len);
    } else if (wire === 5) { value = BigInt(buf.readUInt32LE(pos)); pos += 4; }
    else if (wire === 1) { value = buf.readBigUInt64LE(pos); pos += 8; }
    else throw new Error(`unsupported wire type ${wire} at ${pos}`);
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push(value);
  }
  return fields;
}

const one = (fields, n) => (fields.get(n) || [])[0];
const str = (fields, n) => {
  const v = one(fields, n);
  return v === undefined ? undefined : v.toString('utf8');
};

/** XmlAttribute -> {name, value} where value is a string, number, or boolean. */
function attribute(buf) {
  const attr = decode(buf);
  const name = str(attr, 2);
  const raw = str(attr, 3);
  const compiled = one(attr, 6);              // Item
  let value = raw;
  if (compiled) {
    const item = decode(compiled);
    const prim = one(item, 7);                // Primitive
    if (prim) {
      const p = decode(prim);
      if (p.has(6)) value = Number(BigInt.asIntN(32, p.get(6)[0]));   // int_decimal
      else if (p.has(7)) value = Number(p.get(7)[0]);                 // int_hexadecimal
      else if (p.has(8)) value = p.get(8)[0] !== 0n;                  // boolean
    }
    const ref = one(item, 1);                 // Reference — keep its name if any
    if (ref && (value === undefined || value === '')) value = str(decode(ref), 2);
  }
  return { name, value };
}

/** Depth-first walk yielding {name, attrs} for every element. */
function* elements(nodeBuf) {
  const node = decode(nodeBuf);
  const el = one(node, 1);          // XmlNode.element = 1 (XmlNode.text = 2)
  if (!el) return;
  const element = decode(el);
  const attrs = new Map();
  for (const a of element.get(4) || []) {
    const { name, value } = attribute(a);
    attrs.set(name, value);
  }
  yield { name: str(element, 3), attrs };
  for (const child of element.get(5) || []) yield* elements(child);
}

/* ── the facts ─────────────────────────────────────────────────────────── */

const manifestBuf = unzip('base/manifest/AndroidManifest.xml');
const all = [...elements(manifestBuf)];
const manifest = all.find((e) => e.name === 'manifest');
const usesSdk = all.find((e) => e.name === 'uses-sdk');
const application = all.find((e) => e.name === 'application');

const size = statSync(aabArg).size;
console.log(`file          ${aabArg}  (${(size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`package       ${manifest?.attrs.get('package')}`);
console.log(`versionCode   ${manifest?.attrs.get('versionCode')}`);
console.log(`versionName   ${manifest?.attrs.get('versionName')}`);
console.log(`minSdk        ${usesSdk?.attrs.get('minSdkVersion')}`);
console.log(`targetSdk     ${usesSdk?.attrs.get('targetSdkVersion')}`);
console.log(`compileSdk    ${manifest?.attrs.get('compileSdkVersion')}`);
console.log(`allowBackup   ${application?.attrs.get('allowBackup')}`);

const perms = all
  .filter((e) => e.name === 'uses-permission')
  .map((e) => String(e.attrs.get('name')).replace('android.permission.', ''));
console.log(`permissions   ${perms.sort().join(', ') || '(none)'}`);

// Play turns every <uses-feature required="true"> into a distribution filter, so
// a stray `true` here silently removes devices from the store listing.
for (const f of all.filter((e) => e.name === 'uses-feature')) {
  console.log(`uses-feature  ${f.attrs.get('name')}  required=${f.attrs.get('required')}`);
}

/* ── signature ─────────────────────────────────────────────────────────── */
// apksigner cannot read an AAB (it is a plain jar, not an APK); jarsigner can.
try {
  const javaHome = process.env.JAVA_HOME || 'f:/android-toolchain/jdk-17.0.13+11';
  const out = execFileSync(`${javaHome}/bin/jarsigner`, ['-verify', aabArg], { encoding: 'utf8' });
  console.log(`signature     ${/jar verified/i.test(out) ? 'verified' : out.trim().split('\n')[0]}`);
} catch (e) {
  console.log(`signature     COULD NOT VERIFY — ${String(e.message).split('\n')[0]}`);
}

/* ── native library alignment (opt-in: it extracts every .so) ──────────── */
if (WANT_LIBS) {
  // A device with 16 KB pages refuses to load a PT_LOAD segment aligned to 4 KB,
  // and the app dies right after the splash with nothing in the Java log.
  // p_align is fixed at LINK time inside each prebuilt .so, so this can only be
  // read out of the shipped artifact.
  const listing = execFileSync('unzip', ['-l', aabArg], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const libs = listing.split('\n').map((l) => (l.match(/\S+\.so$/) || [])[0]).filter(Boolean);
  const perAbi = new Map();
  for (const lib of libs) {
    const abi = lib.split('/')[2] || '?';
    const bucket = perAbi.get(abi) || { ok: 0, bad: 0, worst: null };
    perAbi.set(abi, bucket);
    const so = unzip(lib);
    if (so.readUInt32BE(0) !== 0x7f454c46) continue;
    if (so[4] !== 2) { bucket.ok++; continue; }   // 32-bit ABIs have no 16 KB rule
    const phoff = Number(so.readBigUInt64LE(0x20));
    const phentsize = so.readUInt16LE(0x36), phnum = so.readUInt16LE(0x38);
    let minAlign = Infinity;
    for (let i = 0; i < phnum; i++) {
      const off = phoff + i * phentsize;
      if (so.readUInt32LE(off) !== 1) continue;            // PT_LOAD only
      minAlign = Math.min(minAlign, Number(so.readBigUInt64LE(off + 48)));
    }
    if (minAlign >= 16384) bucket.ok++;
    else { bucket.bad++; if (bucket.worst === null || minAlign < bucket.worst) bucket.worst = minAlign; }
  }
  for (const [abi, b] of [...perAbi].sort()) {
    const total = b.ok + b.bad;
    const warn = b.bad ? `  ** ${b.bad} at ${b.worst} — 16 KB devices will refuse these **` : '';
    console.log(`libs ${abi.padEnd(12)} ${b.ok}/${total} at p_align>=16384${warn}`);
  }
}
