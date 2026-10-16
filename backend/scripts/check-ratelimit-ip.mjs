// node scripts/check-ratelimit-ip.mjs — asserts the rate limiter's address keying.
import assert from 'node:assert/strict';
import { normaliseIp } from '../src/middleware/rateLimit.js';

const cases = [
  ['1.2.3.4', '1.2.3.4'],
  ['1.2.3.4:5678', '1.2.3.4'],
  ['::ffff:1.2.3.4', '1.2.3.4'],
  ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
  ['2001:db8::1', '2001:db8:0:0::/64'],
  ['2001:db8::2', '2001:db8:0:0::/64'],          // same /64 as above — the old code split them
  ['2001:0db8:0000:0000:0000:0000:0000:0001', '2001:db8:0:0::/64'],
  ['[2001:db8:a:b::1]:443', '2001:db8:a:b::/64'],
  ['fe80::1%eth0', 'fe80:0:0:0::/64'],
  ['::1', '0:0:0:0::/64'],
  ['64:ff9b::1.2.3.4', '64:ff9b:0:0::/64'],
  ['', 'unknown'],
  [null, 'unknown'],
  ['not-an-ip', 'not-an-ip'],
  ['1::2::3', '1::2::3'],
];
for (const [input, expected] of cases) assert.equal(normaliseIp(input), expected, String(input));
console.log(`rate limit keying: ${cases.length} checks passed`);
