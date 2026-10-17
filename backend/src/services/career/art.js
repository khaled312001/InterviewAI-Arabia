/**
 * The artwork layer of the CV templates: SVG patterns, line illustrations and
 * small charts.
 *
 * Everything here is decoration or a picture of facts already in the CV. The
 * charts are drawn from real dates (how long each role lasted) and the levels
 * the person wrote for their languages — never from invented "skill: 80%"
 * numbers. Year labels are the only text the charts add, so a parser reading
 * the PDF sees a few years, not a second copy of the CV.
 *
 * Colours come in as hex (SVG presentation attributes do not take CSS
 * variables); a piece can ask for 'acc', 'acc2', 'dark', 'tint', 'paper' or a
 * literal colour.
 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

let uid = 0;
const nextId = (p) => `${p}${(uid = (uid + 1) % 1e6)}`;
const r2 = (n) => Math.round(n * 100) / 100;

/* ------------------------------------------------------------ patterns */

/** Tiles for <pattern>. Each returns [width, height, inner svg]. */
const TILES = {
  dots: (c) => [16, 16, `<circle cx="8" cy="8" r="1.6" fill="${c}"/>`],
  bigdots: (c) => [26, 26, `<circle cx="13" cy="13" r="3.4" fill="${c}"/>`],
  grid: (c) => [18, 18, `<path d="M18 0H0V18" fill="none" stroke="${c}" stroke-width=".8"/>`],
  blueprint: (c) => [60, 60, `<path d="M60 0H0V60" fill="none" stroke="${c}" stroke-width="1.2"/><path d="M15 0V60M30 0V60M45 0V60M0 15H60M0 30H60M0 45H60" fill="none" stroke="${c}" stroke-width=".4"/>`],
  diag: (c) => [10, 10, `<path d="M-2 2l4-4M0 10L10 0M8 12l4-4" stroke="${c}" stroke-width="1.4"/>`],
  waves: (c) => [40, 16, `<path d="M0 8 Q10 0 20 8 T40 8" fill="none" stroke="${c}" stroke-width="1.3"/>`],
  chevron: (c) => [24, 14, `<path d="M0 12 L12 2 L24 12" fill="none" stroke="${c}" stroke-width="1.4"/>`],
  cross: (c) => [22, 22, `<path d="M11 7v8M7 11h8" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`],
  hex: (c) => [28, 48.5, `<path d="M14 0l14 8.1v16.2L14 32.4 0 24.3V8.1zM14 32.4V48.5" fill="none" stroke="${c}" stroke-width="1"/>`],
  // An eight-pointed star tile (two squares, the khatam) with the links of a girih net.
  arabesque: (c) => [48, 48, `<g fill="none" stroke="${c}" stroke-width="1.1"><rect x="14" y="14" width="20" height="20"/><rect x="14" y="14" width="20" height="20" transform="rotate(45 24 24)"/><circle cx="24" cy="24" r="4"/><path d="M0 0l9.9 9.9M48 0l-9.9 9.9M0 48l9.9-9.9M48 48l-9.9-9.9M24 0v9.9M24 48v-9.9M0 24h9.9M48 24h-9.9"/></g>`],
  scales: (c) => [24, 12, `<path d="M0 12a12 12 0 0 1 24 0M-12 0a12 12 0 0 1 24 0M12 0a12 12 0 0 1 24 0" fill="none" stroke="${c}" stroke-width="1"/>`],
  memphis: (c, c2, c3) => [150, 150, `
    <path d="M18 30 l14 -22 l14 22z" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round"/>
    <circle cx="112" cy="26" r="7" fill="${c2}"/>
    <path d="M70 70 q6 -10 12 0 t12 0 t12 0" fill="none" stroke="${c3}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M28 104 h14 M35 97 v14" stroke="${c2}" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M118 112 a14 14 0 0 1 28 0z" fill="${c}"/>
    <circle cx="64" cy="132" r="5" fill="none" stroke="${c3}" stroke-width="2.4"/>
    <path d="M128 64 l10 10 M138 64 l-10 10" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/>
    <g fill="${c3}"><circle cx="6" cy="70" r="1.8"/><circle cx="14" cy="70" r="1.8"/><circle cx="22" cy="70" r="1.8"/></g>`],
  terrazzo: (c, c2, c3) => [120, 120, `
    <path d="M12 18 l10 -4 l4 9 l-9 5z" fill="${c}"/><path d="M70 12 l7 2 l-2 7 l-8 -3z" fill="${c2}"/>
    <path d="M98 50 l12 3 l-5 10 l-9 -4z" fill="${c3}"/><path d="M40 60 l6 -6 l6 7 l-7 4z" fill="${c2}"/>
    <path d="M16 92 l9 1 l-1 8 l-9 -2z" fill="${c3}"/><path d="M78 96 l11 -3 l3 9 l-10 4z" fill="${c}"/>
    <circle cx="56" cy="30" r="2" fill="${c3}"/><circle cx="104" cy="104" r="2.4" fill="${c2}"/><circle cx="30" cy="48" r="1.6" fill="${c}"/>`],
};

function pattern(name, colors, { opacity = 1, scale = 1, rotate = 0 } = {}) {
  const tile = TILES[name];
  if (!tile) return '';
  const [w, h, inner] = tile(...colors);
  const id = nextId('p');
  const tf = [scale !== 1 ? `scale(${scale})` : '', rotate ? `rotate(${rotate})` : ''].filter(Boolean).join(' ');
  return `<svg class="art-svg" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true" style="opacity:${opacity}"><defs><pattern id="${id}" width="${w}" height="${h}" patternUnits="userSpaceOnUse"${tf ? ` patternTransform="${tf}"` : ''}>${inner}</pattern></defs><rect width="100%" height="100%" fill="url(#${id})"/></svg>`;
}

/* -------------------------------------------------------- illustrations */

const BLOBS = [
  'M45,-62C58,-52,67,-38,71,-22C75,-6,73,11,66,27C59,43,46,57,30,65C14,73,-5,75,-23,70C-41,65,-58,53,-67,37C-76,21,-77,1,-71,-16C-65,-33,-52,-48,-37,-58C-22,-68,-5,-73,11,-73C27,-73,32,-72,45,-62Z',
  'M38.5,-49.9C50.9,-41.3,62.6,-30.6,67.4,-17C72.2,-3.4,70.1,13.1,62.7,26.4C55.3,39.7,42.6,49.8,28.4,57.4C14.2,65,-1.5,70.1,-17.9,67.9C-34.3,65.7,-51.3,56.2,-61.4,41.7C-71.5,27.2,-74.6,7.7,-70.6,-9.6C-66.6,-26.9,-55.5,-42,-41.6,-50.4C-27.7,-58.8,-13.9,-60.5,0.3,-60.9C14.5,-61.3,26.1,-58.5,38.5,-49.9Z',
  'M52.1,-58.6C66.4,-47.5,76,-30.4,78.4,-12.4C80.8,5.6,76,24.5,64.9,37.8C53.8,51.1,36.4,58.8,18.3,64.4C0.2,70,-18.6,73.5,-33.6,67C-48.6,60.5,-59.8,44,-66.3,26.1C-72.8,8.2,-74.6,-11.1,-67.7,-26.4C-60.8,-41.7,-45.2,-53,-29.5,-63.6C-13.8,-74.2,2,-84.1,17.6,-81.8C33.2,-79.5,37.8,-69.7,52.1,-58.6Z',
];

const LEAF = 'M0 0 C 8 -9 22 -9 32 0 C 22 9 8 9 0 0 Z';

/** Leaves along a cubic stem from p0 to p3; alternating sides, smaller toward the tip. */
function branchSvg(p0, p1, p2, p3, { n = 8, size = 1, line, fill, op = 1, stemW = 1.6 }) {
  const at = (t) => {
    const u = 1 - t;
    return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
  };
  const tan = (t) => {
    const u = 1 - t;
    return [0, 1].map((k) => 3 * u * u * (p1[k] - p0[k]) + 6 * u * t * (p2[k] - p1[k]) + 3 * t * t * (p3[k] - p2[k]));
  };
  let out = `<path d="M${p0} C${p1} ${p2} ${p3}" fill="none" stroke="${line}" stroke-width="${stemW}" stroke-linecap="round"/>`;
  for (let i = 0; i < n; i++) {
    const t = 0.12 + (i / n) * 0.84;
    const [x, y] = at(t);
    const [dx, dy] = tan(t);
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI + (i % 2 ? 48 : -48);
    const s = size * (1.05 - t * 0.45);
    out += `<g transform="translate(${r2(x)} ${r2(y)}) rotate(${r2(ang)}) scale(${r2(s)})"><path d="${LEAF}" fill="${fill}" fill-opacity="${op}" stroke="${line}" stroke-width="${r2(1.1 / s)}"/><path d="M2 0 H28" stroke="${line}" stroke-width="${r2(0.8 / s)}"/></g>`;
  }
  const [tx, ty] = p3;
  const [dx, dy] = tan(1);
  out += `<g transform="translate(${tx} ${ty}) rotate(${r2((Math.atan2(dy, dx) * 180) / Math.PI)}) scale(${r2(size * 0.55)})"><path d="${LEAF}" fill="${fill}" fill-opacity="${op}" stroke="${line}" stroke-width="2"/></g>`;
  return out;
}

const ILLUSTRATIONS = {
  /** A leafy sprig rising from the bottom corner. */
  leaves: ({ c, c2 }) => ['0 0 200 240', `
    ${branchSvg([30, 240], [40, 170], [110, 120], [150, 30], { n: 9, size: 1.1, line: c, fill: c2, op: 0.55 })}
    ${branchSvg([60, 240], [80, 200], [150, 190], [196, 120], { n: 6, size: 0.85, line: c, fill: c2, op: 0.35 })}
    ${branchSvg([10, 240], [0, 200], [10, 150], [40, 110], { n: 5, size: 0.7, line: c, fill: 'none', op: 1 })}`],
  /** A laurel wreath, for under a centred name. */
  laurel: ({ c }) => ['0 0 240 70', `
    ${branchSvg([112, 64], [70, 66], [26, 46], [10, 8], { n: 8, size: 0.62, line: c, fill: c, op: 0.18, stemW: 1.2 })}
    ${branchSvg([128, 64], [170, 66], [214, 46], [230, 8], { n: 8, size: 0.62, line: c, fill: c, op: 0.18, stemW: 1.2 })}
    <circle cx="120" cy="64" r="3" fill="${c}"/>`],
  blobs: ({ c, c2 }) => ['0 0 200 200', `
    <path d="${BLOBS[0]}" transform="translate(110 92) scale(1.15)" fill="${c}"/>
    <path d="${BLOBS[1]}" transform="translate(52 150) scale(.62)" fill="${c2}" fill-opacity=".9"/>
    <path d="${BLOBS[2]}" transform="translate(160 170) scale(.32)" fill="none" stroke="${c}" stroke-width="5"/>`],
  /** Contour lines, as on a relief map. */
  topo: ({ c }) => ['0 0 220 220', [...Array(11)].map((_, i) => {
    const s = 0.22 + i * 0.13;
    return `<path d="${BLOBS[i % 2 ? 2 : 0]}" transform="translate(${110 + i * 2} ${110 - i * 1.5}) scale(${r2(s)}) rotate(${i * 7})" fill="none" stroke="${c}" stroke-width="${r2(1.1 / s)}"/>`;
  }).join('')],
  /** Concentric circles with a few dashed orbits and planets. */
  orbit: ({ c, c2 }) => ['0 0 240 240', `
    ${[30, 52, 74, 96, 118].map((r, i) => `<circle cx="120" cy="120" r="${r}" fill="none" stroke="${c}" stroke-width="${i % 2 ? 1 : 1.6}"${i % 2 ? ' stroke-dasharray="3 6"' : ''}/>`).join('')}
    <circle cx="120" cy="120" r="10" fill="${c2}"/><circle cx="172" cy="69" r="6" fill="${c2}"/><circle cx="46" cy="148" r="4" fill="${c}"/><circle cx="208" cy="152" r="5" fill="none" stroke="${c2}" stroke-width="2"/>`],
  /** A halftone fade: dots that shrink away from the corner. */
  halftone: ({ c }) => {
    let dots = '';
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(15 - x, y) / Math.hypot(15, 11);
        const r = 5.2 * (1 - d);
        if (r > 0.5) dots += `<circle cx="${x * 14 + 7}" cy="${y * 14 + 7}" r="${r2(r)}"/>`;
      }
    }
    return ['0 0 224 168', `<g fill="${c}">${dots}</g>`];
  },
  /** Layered hills. */
  mountains: ({ c, c2 }) => ['0 0 400 120', `
    <path d="M0 120 L0 70 L60 30 L120 72 L180 20 L250 80 L310 44 L400 92 L400 120Z" fill="${c2}" fill-opacity=".55"/>
    <path d="M0 120 L0 90 L80 54 L150 96 L230 46 L320 100 L400 70 L400 120Z" fill="${c}" fill-opacity=".75"/>
    <path d="M0 120 L0 108 L100 82 L200 112 L300 86 L400 106 L400 120Z" fill="${c}"/>
    <circle cx="330" cy="26" r="12" fill="${c2}"/>`],
  /** Four-pointed sparkles. */
  sparkles: ({ c, c2 }) => {
    const star = 'M0 -10 C1 -2 2 -1 10 0 C2 1 1 2 0 10 C-1 2 -2 1 -10 0 C-2 -1 -1 -2 0 -10Z';
    const at = [[40, 40, 2.2, c], [120, 24, 1.1, c2], [90, 90, 1.5, c2], [170, 60, 0.8, c], [30, 130, 1, c2], [150, 140, 1.8, c]];
    return ['0 0 200 170', at.map(([x, y, s, col]) => `<path d="${star}" transform="translate(${x} ${y}) scale(${s})" fill="${col}"/>`).join('')];
  },
  /** A painted brush stroke, for behind a name. */
  brush: ({ c }) => ['0 0 400 80', `
    <path d="M8 24 C60 12 140 16 210 13 C280 10 340 8 392 19 C397 31 389 45 395 59 C330 71 250 66 180 71 C110 75 50 70 6 63 C1 49 11 37 8 24Z" fill="${c}"/>
    <path d="M20 16 C120 8 250 9 360 7" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity=".6"/>
    <path d="M40 73 C150 78 270 76 380 68" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>`],
  /** Sun rays fanning out of a corner. */
  rays: ({ c }) => ['0 0 200 200', [...Array(12)].map((_, i) => {
    const a = (i * 7.5 * Math.PI) / 180;
    const a2 = a + (3.6 * Math.PI) / 180;
    return `<path d="M200 0 L${r2(200 - 290 * Math.cos(a))} ${r2(290 * Math.sin(a))} L${r2(200 - 290 * Math.cos(a2))} ${r2(290 * Math.sin(a2))}Z" fill="${c}"/>`;
  }).join('')],
  /** A wave of parallel lines. */
  flow: ({ c }) => ['0 0 400 160', [...Array(9)].map((_, i) => `<path d="M-10 ${40 + i * 10} C 90 ${-10 + i * 14}, 210 ${150 - i * 6}, 410 ${30 + i * 12}" fill="none" stroke="${c}" stroke-width="1.2" opacity="${r2(1 - i * 0.08)}"/>`).join('')],
  /** Bold circles and a half disc, Bauhaus style. */
  bauhaus: ({ c, c2, c3 }) => ['0 0 200 200', `
    <circle cx="140" cy="60" r="56" fill="${c}"/><path d="M20 200 A80 80 0 0 1 180 200Z" fill="${c2}"/>
    <rect x="18" y="40" width="44" height="44" fill="${c3}"/><circle cx="140" cy="60" r="18" fill="${c3}"/>`],
};

/**
 * One art piece placed in a slot.
 *   { slot, kind: 'pattern'|'ill', name, pos, w, h, color, color2, color3, op, scale, rotate, flip }
 * pos: 'full' fills the slot; 'tl' 'tr' 'bl' 'br' 'top' 'bottom' are corners/edges
 * (start/end follow the writing direction, so Arabic mirrors them).
 */
export function renderArt(list, slot, pal, rtl) {
  if (!list?.length) return '';
  const col = (k, dflt) => {
    const key = k || dflt;
    return pal[key] || key;
  };
  return list.filter((a) => (a.slot || 'page') === slot).map((a) => {
    const c = col(a.color, 'acc');
    const c2 = col(a.color2, 'acc2');
    const c3 = col(a.color3, 'dark');
    const pos = a.pos || 'full';
    const side = (p) => (rtl ? { l: 'right', r: 'left' }[p] : { l: 'left', r: 'right' }[p]);
    const place = {
      full: 'inset:0;',
      tl: `top:${a.y ?? 0}mm;${side('l')}:${a.x ?? 0}mm;`,
      tr: `top:${a.y ?? 0}mm;${side('r')}:${a.x ?? 0}mm;`,
      bl: `bottom:${a.y ?? 0}mm;${side('l')}:${a.x ?? 0}mm;`,
      br: `bottom:${a.y ?? 0}mm;${side('r')}:${a.x ?? 0}mm;`,
      top: `top:${a.y ?? 0}mm;left:0;right:0;`,
      bottom: `bottom:${a.y ?? 0}mm;left:0;right:0;`,
      center: 'top:50%;left:50%;transform:translate(-50%,-50%);',
      inline: '',
    }[pos];
    const size = pos === 'full' ? 'width:100%;height:100%;' : `${a.w ? `width:${a.w}mm;` : ''}${a.h ? `height:${a.h}mm;` : ''}`;
    // Mirror a corner piece drawn for the top-right (or bottom-left) when it sits elsewhere.
    const flipX = a.flip === 'x' || (rtl && a.kind === 'ill' && !['full', 'center', 'inline'].includes(pos) && a.mirror !== false);
    const tf = [flipX ? 'scaleX(-1)' : '', a.flip === 'y' ? 'scaleY(-1)' : '', a.rot ? `rotate(${a.rot}deg)` : ''].filter(Boolean).join(' ');
    const style = `${place}${size}opacity:${a.op ?? 1};${tf && pos !== 'center' ? `transform:${tf};` : ''}`;
    let inner;
    if (a.kind === 'pattern') inner = pattern(a.name, [c, c2, c3], { scale: a.scale, rotate: a.rotate });
    else {
      const ill = ILLUSTRATIONS[a.name];
      if (!ill) return '';
      const [vb, body] = ill({ c, c2, c3 });
      inner = `<svg class="art-svg" viewBox="${vb}" width="100%" height="100%" preserveAspectRatio="${a.fit || 'xMidYMid meet'}" aria-hidden="true">${body}</svg>`;
    }
    return `<div class="art art-${a.name} art-${slot}${pos === 'inline' ? ' art-inline' : ''}" style="${style}">${inner}</div>`;
  }).join('');
}

/* ------------------------------------------------------------- charts */

const monthOf = (d) => {
  if (!d) return null;
  const [y, m] = d.split('-').map(Number);
  return y ? y * 12 + (m || 1) - 1 : null;
};

function spans(cv) {
  const now = new Date();
  const nowM = now.getUTCFullYear() * 12 + now.getUTCMonth();
  return cv.experience.map((e) => {
    const s = monthOf(e.start);
    if (s == null) return null;
    const end = e.current || !e.end ? nowM : monthOf(e.end);
    return { label: e.company || e.title, title: e.title, s, e: Math.max(end ?? s + 1, s + 1) };
  }).filter(Boolean);
}

/** Career timeline: one bar per role on a shared years axis. Needs two dated roles. */
export function ganttHtml(cv) {
  const rows = spans(cv).slice(0, 8);
  if (rows.length < 2) return '';
  const min = Math.floor(Math.min(...rows.map((r) => r.s)) / 12) * 12;
  const max = Math.ceil((Math.max(...rows.map((r) => r.e)) + 1) / 12) * 12;
  const span = max - min;
  const years = span / 12;
  const step = years > 14 ? 4 : years > 8 ? 2 : 1;
  const pct = (m) => r2(((m - min) / span) * 100);
  const ticks = [];
  for (let y = min / 12; y <= max / 12; y += step) ticks.push(`<b style="inset-inline-start:${pct(y * 12)}%">${y}</b>`);
  return `<div class="gantt">${rows.map((r, i) => `
    <div class="g-row"><span class="g-lab">${esc(r.label)}</span><span class="g-track"><i class="g-bar g${i % 4}" style="inset-inline-start:${pct(r.s)}%;width:${r2(Math.max(pct(r.e) - pct(r.s), 1.5))}%"></i></span></div>`).join('')}
    <div class="g-row g-axis"><span class="g-lab"></span><span class="g-track">${ticks.join('')}</span></div></div>`;
}

/** Share of the career spent in each role, as a donut with a legend. */
export function donutHtml(cv, pal, h) {
  const rows = spans(cv).map((r) => ({ ...r, m: r.e - r.s })).filter((r) => r.m > 0);
  if (rows.length < 2) return '';
  const top = rows.slice(0, 4);
  const rest = rows.slice(4).reduce((n, r) => n + r.m, 0);
  if (rest) top.push({ label: '…', m: rest });
  const total = top.reduce((n, r) => n + r.m, 0);
  const shades = [1, 0.72, 0.5, 0.34, 0.2];
  let offset = 25;
  const segs = top.map((r, i) => {
    const p = (r.m / total) * 100;
    const gap = top.length > 1 ? 1.2 : 0;
    const seg = `<circle cx="21" cy="21" r="15.915" fill="none" stroke="${pal.acc}" stroke-opacity="${shades[i]}" stroke-width="6" stroke-dasharray="${r2(Math.max(p - gap, 0.5))} ${r2(100 - Math.max(p - gap, 0.5))}" stroke-dashoffset="${r2(offset)}"/>`;
    offset -= p;
    return seg;
  }).join('');
  const yrs = Math.round(total / 12);
  const fmt = (m) => (m >= 12 ? `${r2(Math.round((m / 12) * 10) / 10)} ${h.yrs}` : `${m} ${h.mos}`);
  return `<div class="donut"><div class="d-ring"><svg viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="15.915" fill="none" stroke="${pal.tint}" stroke-width="6"/>${segs}</svg><div class="d-mid"><b>${yrs}</b><span>${esc(h.yrs)}</span></div></div>
    <ul class="d-legend">${top.map((r, i) => `<li><i style="background:${pal.acc};opacity:${shades[i]}"></i><span class="dl">${esc(r.label)}</span><span class="dv">${esc(fmt(r.m))}</span></li>`).join('')}</ul></div>`;
}
