#!/usr/bin/env node
/**
 * CI guard for RTL §2.4: once stylis-plugin-rtl is active it rewrites physical
 * properties in the emitted CSS, so hand-written physical CSS double-flips.
 * Logical properties survive any direction and are the only allowed form.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(fileURLToPath(new URL('../src', import.meta.url)));

const RULES = [
  [/\bml:\s/, 'ml: → marginInlineStart'],
  [/\bmr:\s/, 'mr: → marginInlineEnd'],
  [/\bpl:\s/, 'pl: → paddingInlineStart'],
  [/\bpr:\s/, 'pr: → paddingInlineEnd'],
  [/\bmarginLeft\b/, 'marginLeft → marginInlineStart'],
  [/\bmarginRight\b/, 'marginRight → marginInlineEnd'],
  [/\bpaddingLeft\b/, 'paddingLeft → paddingInlineStart'],
  [/\bpaddingRight\b/, 'paddingRight → paddingInlineEnd'],
  [/\bborderLeft\w*\b/, 'borderLeft* → borderInlineStart*'],
  [/\bborderRight\w*\b/, 'borderRight* → borderInlineEnd*'],
  [/\bborderTopLeftRadius\b|\bborderTopRightRadius\b|\bborderBottomLeftRadius\b|\bborderBottomRightRadius\b/,
    'physical radius → borderStartStartRadius / borderStartEndRadius / borderEndStartRadius / borderEndEndRadius'],
  [/textAlign:\s*'(left|right)'/, "textAlign 'left'|'right' → 'start'|'end'"],
  [/\bfloat:\s*'(left|right)'/, 'float is banned — use flex/grid'],
  [/anchor="right"/, 'anchor="right" → anchor="left" (MUI mirrors it in RTL)'],
];

// The two documented exemptions: MUI's own physical margin resets (which exist
// precisely to neutralise them) and DataGrid align, set once in lib/columns.
const EXEMPT = new Set(['theme/components.ts']);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

let failures = 0;
for (const file of walk(SRC)) {
  if (!/\.(ts|tsx|css)$/.test(file)) continue;
  const rel = relative(SRC, file).replace(/\\/g, '/');
  if (EXEMPT.has(rel)) continue;

  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const [re, message] of RULES) {
        if (re.test(line)) {
          console.error(`${rel}:${i + 1}  ${message}\n    ${line.trim()}`);
          failures += 1;
        }
      }
    });
}

if (failures > 0) {
  console.error(`\nlint:rtl failed with ${failures} physical-property violation(s).`);
  process.exit(1);
}
console.log('lint:rtl clean — no physical direction properties in admin/src.');
