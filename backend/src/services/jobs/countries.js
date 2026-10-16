/**
 * Location text → ISO 3166-1 alpha-2.
 *
 * Feeds describe places as free text — "Berlin", "Remote (Canada)", "New York,
 * NY (HQ)", "USA, Canada, Ireland or UK only", "EMEA". Search needs a country
 * code, so this module reads the text the way a person would: a country name or
 * a well-known alias first, then a US/Canadian region, then a large city.
 *
 * Display names are NOT stored here. The clients render a code with
 * Intl.DisplayNames in the reader's own language, which covers every country in
 * Arabic and English without a translation table to maintain.
 */

/** code → names and aliases, lower-case. The first entry is the canonical English name. */
const COUNTRIES = {
  AF: ['afghanistan'], AL: ['albania'], DZ: ['algeria', 'algérie'], AD: ['andorra'], AO: ['angola'],
  AR: ['argentina'], AM: ['armenia'], AU: ['australia'], AT: ['austria', 'österreich', 'osterreich'],
  AZ: ['azerbaijan'], BH: ['bahrain'], BD: ['bangladesh'], BY: ['belarus'], BE: ['belgium', 'belgique', 'belgië'],
  BJ: ['benin'], BO: ['bolivia'], BA: ['bosnia and herzegovina', 'bosnia'], BW: ['botswana'],
  BR: ['brazil', 'brasil'], BG: ['bulgaria'], KH: ['cambodia'], CM: ['cameroon'], CA: ['canada'],
  CL: ['chile'], CN: ['china', "people's republic of china", 'prc'], CO: ['colombia'], CR: ['costa rica'],
  HR: ['croatia', 'hrvatska'], CU: ['cuba'], CY: ['cyprus'], CZ: ['czech republic', 'czechia', 'česko'],
  DK: ['denmark', 'danmark'], DO: ['dominican republic'], EC: ['ecuador'], EG: ['egypt', 'misr'],
  SV: ['el salvador'], EE: ['estonia', 'eesti'], ET: ['ethiopia'], FI: ['finland', 'suomi'],
  FR: ['france'], GE: ['georgia (country)', 'republic of georgia'], DE: ['germany', 'deutschland'],
  GH: ['ghana'], GR: ['greece', 'hellas'], GT: ['guatemala'], HN: ['honduras'], HK: ['hong kong', 'hong kong sar'],
  HU: ['hungary', 'magyarország'], IS: ['iceland'], IN: ['india'], ID: ['indonesia'], IR: ['iran'],
  IQ: ['iraq'], IE: ['ireland', 'éire', 'republic of ireland'], IL: ['israel'], IT: ['italy', 'italia'],
  CI: ["côte d'ivoire", 'ivory coast', "cote d'ivoire"], JM: ['jamaica'], JP: ['japan'], JO: ['jordan'],
  KZ: ['kazakhstan'], KE: ['kenya'], KW: ['kuwait'], KG: ['kyrgyzstan'], LV: ['latvia'], LB: ['lebanon'],
  LY: ['libya'], LI: ['liechtenstein'], LT: ['lithuania'], LU: ['luxembourg'], MO: ['macau', 'macao'],
  MY: ['malaysia'], MV: ['maldives'], MT: ['malta'], MU: ['mauritius'], MX: ['mexico', 'méxico'],
  MD: ['moldova'], MC: ['monaco'], MN: ['mongolia'], ME: ['montenegro'], MA: ['morocco', 'maroc'],
  MZ: ['mozambique'], MM: ['myanmar'], NA: ['namibia'], NP: ['nepal'], NL: ['netherlands', 'the netherlands', 'holland', 'nederland'],
  NZ: ['new zealand'], NI: ['nicaragua'], NG: ['nigeria'], MK: ['north macedonia', 'macedonia'],
  NO: ['norway', 'norge'], OM: ['oman'], PK: ['pakistan'], PS: ['palestine'], PA: ['panama'],
  PY: ['paraguay'], PE: ['peru', 'perú'], PH: ['philippines'], PL: ['poland', 'polska'],
  PT: ['portugal'], PR: ['puerto rico'], QA: ['qatar'], RO: ['romania', 'românia'], RU: ['russia', 'russian federation'],
  RW: ['rwanda'], SA: ['saudi arabia', 'ksa', 'kingdom of saudi arabia'], SN: ['senegal'], RS: ['serbia'],
  SG: ['singapore'], SK: ['slovakia', 'slovensko'], SI: ['slovenia'], ZA: ['south africa'],
  KR: ['south korea', 'korea', 'republic of korea'], ES: ['spain', 'españa', 'espana'], LK: ['sri lanka'],
  SD: ['sudan'], SE: ['sweden', 'sverige'], CH: ['switzerland', 'schweiz', 'suisse', 'svizzera'],
  SY: ['syria'], TW: ['taiwan'], TZ: ['tanzania'], TH: ['thailand'], TN: ['tunisia', 'tunisie'],
  TR: ['turkey', 'türkiye', 'turkiye'], UG: ['uganda'], UA: ['ukraine'],
  AE: ['united arab emirates', 'uae', 'u.a.e.', 'emirates'],
  GB: ['united kingdom', 'uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland'],
  US: ['united states', 'usa', 'u.s.', 'u.s.a.', 'united states of america', 'us', 'america'],
  UY: ['uruguay'], UZ: ['uzbekistan'], VE: ['venezuela'], VN: ['vietnam', 'viet nam'], YE: ['yemen'],
  ZM: ['zambia'], ZW: ['zimbabwe'], ER: ['eritrea'], SO: ['somalia'], MR: ['mauritania'], DJ: ['djibouti'],
  BT: ['bhutan'], BN: ['brunei'], FJ: ['fiji'], GY: ['guyana'], HT: ['haiti'], TT: ['trinidad and tobago'],
  BB: ['barbados'], BS: ['bahamas'], BZ: ['belize'], ML: ['mali'], NE: ['niger'], TD: ['chad'],
  BF: ['burkina faso'], GN: ['guinea'], SL: ['sierra leone'], LR: ['liberia'], TG: ['togo'],
  GA: ['gabon'], CG: ['congo'], CD: ['democratic republic of the congo', 'dr congo', 'drc'],
  MG: ['madagascar'], MW: ['malawi'], LS: ['lesotho'], SZ: ['eswatini', 'swaziland'], CV: ['cape verde'],
  TJ: ['tajikistan'], TM: ['turkmenistan'], LA: ['laos'], KP: ['north korea'], XK: ['kosovo'],
};

/** Places that are routinely written alone, mapped to their country. */
const CITIES = {
  // North America
  'new york': 'US', 'nyc': 'US', 'san francisco': 'US', 'sf bay area': 'US', 'bay area': 'US', 'los angeles': 'US',
  'seattle': 'US', 'boston': 'US', 'chicago': 'US', 'austin': 'US', 'denver': 'US', 'atlanta': 'US',
  'washington, dc': 'US', 'washington dc': 'US', 'miami': 'US', 'dallas': 'US', 'houston': 'US',
  'san diego': 'US', 'san jose': 'US', 'palo alto': 'US', 'mountain view': 'US', 'menlo park': 'US',
  'sunnyvale': 'US', 'philadelphia': 'US', 'pittsburgh': 'US', 'phoenix': 'US', 'portland': 'US',
  'salt lake city': 'US', 'minneapolis': 'US', 'detroit': 'US', 'raleigh': 'US', 'nashville': 'US',
  'toronto': 'CA', 'vancouver': 'CA', 'montreal': 'CA', 'montréal': 'CA', 'ottawa': 'CA', 'calgary': 'CA', 'waterloo': 'CA',
  'mexico city': 'MX', 'ciudad de méxico': 'MX', 'guadalajara': 'MX', 'monterrey': 'MX',
  // Europe
  'london': 'GB', 'manchester': 'GB', 'edinburgh': 'GB', 'cambridge, uk': 'GB', 'bristol': 'GB', 'leeds': 'GB',
  'dublin': 'IE', 'cork': 'IE', 'paris': 'FR', 'lyon': 'FR', 'toulouse': 'FR', 'marseille': 'FR', 'nantes': 'FR',
  'berlin': 'DE', 'munich': 'DE', 'münchen': 'DE', 'hamburg': 'DE', 'frankfurt': 'DE', 'cologne': 'DE', 'köln': 'DE',
  'düsseldorf': 'DE', 'dusseldorf': 'DE', 'stuttgart': 'DE', 'leipzig': 'DE', 'hannover': 'DE', 'nürnberg': 'DE', 'nuremberg': 'DE',
  'amsterdam': 'NL', 'rotterdam': 'NL', 'utrecht': 'NL', 'eindhoven': 'NL', 'the hague': 'NL',
  'brussels': 'BE', 'antwerp': 'BE', 'zurich': 'CH', 'zürich': 'CH', 'geneva': 'CH', 'genève': 'CH', 'basel': 'CH',
  'bern': 'CH', 'lausanne': 'CH', 'lugano': 'CH', 'zug': 'CH', 'vienna': 'AT', 'wien': 'AT', 'graz': 'AT',
  'madrid': 'ES', 'barcelona': 'ES', 'valencia': 'ES', 'málaga': 'ES', 'malaga': 'ES', 'lisbon': 'PT', 'lisboa': 'PT', 'porto': 'PT',
  'milan': 'IT', 'milano': 'IT', 'rome': 'IT', 'roma': 'IT', 'turin': 'IT', 'stockholm': 'SE', 'gothenburg': 'SE', 'malmö': 'SE',
  'copenhagen': 'DK', 'oslo': 'NO', 'helsinki': 'FI', 'warsaw': 'PL', 'krakow': 'PL', 'kraków': 'PL', 'wroclaw': 'PL', 'wrocław': 'PL',
  'gdansk': 'PL', 'prague': 'CZ', 'praha': 'CZ', 'brno': 'CZ', 'budapest': 'HU', 'bucharest': 'RO', 'cluj-napoca': 'RO',
  'sofia': 'BG', 'athens': 'GR', 'tallinn': 'EE', 'riga': 'LV', 'vilnius': 'LT', 'belgrade': 'RS', 'zagreb': 'HR',
  'ljubljana': 'SI', 'bratislava': 'SK', 'kyiv': 'UA', 'kiev': 'UA', 'lviv': 'UA', 'istanbul': 'TR', 'ankara': 'TR',
  'luxembourg city': 'LU', 'valletta': 'MT', 'limassol': 'CY', 'nicosia': 'CY', 'reykjavik': 'IS',
  // Middle East & Africa
  'dubai': 'AE', 'abu dhabi': 'AE', 'sharjah': 'AE', 'riyadh': 'SA', 'jeddah': 'SA', 'dammam': 'SA', 'khobar': 'SA',
  'doha': 'QA', 'kuwait city': 'KW', 'manama': 'BH', 'muscat': 'OM', 'amman': 'JO', 'beirut': 'LB',
  'cairo': 'EG', 'giza': 'EG', 'alexandria': 'EG', 'new cairo': 'EG', '6th of october': 'EG',
  'casablanca': 'MA', 'rabat': 'MA', 'tunis': 'TN', 'algiers': 'DZ', 'tel aviv': 'IL', 'jerusalem': 'IL', 'haifa': 'IL',
  'lagos': 'NG', 'abuja': 'NG', 'nairobi': 'KE', 'cape town': 'ZA', 'johannesburg': 'ZA', 'durban': 'ZA',
  'accra': 'GH', 'kigali': 'RW', 'addis ababa': 'ET', 'kampala': 'UG', 'dar es salaam': 'TZ',
  // Asia-Pacific
  'singapore': 'SG', 'hong kong': 'HK', 'tokyo': 'JP', 'osaka': 'JP', 'seoul': 'KR', 'beijing': 'CN', 'shanghai': 'CN',
  'shenzhen': 'CN', 'hangzhou': 'CN', 'taipei': 'TW', 'bangalore': 'IN', 'bengaluru': 'IN', 'mumbai': 'IN',
  'delhi': 'IN', 'new delhi': 'IN', 'gurgaon': 'IN', 'gurugram': 'IN', 'noida': 'IN', 'hyderabad': 'IN', 'pune': 'IN',
  'chennai': 'IN', 'kolkata': 'IN', 'jakarta': 'ID', 'bali': 'ID', 'kuala lumpur': 'MY', 'bangkok': 'TH',
  'manila': 'PH', 'ho chi minh city': 'VN', 'hanoi': 'VN', 'karachi': 'PK', 'lahore': 'PK', 'islamabad': 'PK',
  'dhaka': 'BD', 'colombo': 'LK', 'sydney': 'AU', 'melbourne': 'AU', 'brisbane': 'AU', 'perth': 'AU', 'adelaide': 'AU',
  'canberra': 'AU', 'auckland': 'NZ', 'wellington': 'NZ',
  // Latin America
  'são paulo': 'BR', 'sao paulo': 'BR', 'rio de janeiro': 'BR', 'belo horizonte': 'BR', 'buenos aires': 'AR',
  'santiago': 'CL', 'bogotá': 'CO', 'bogota': 'CO', 'medellín': 'CO', 'medellin': 'CO', 'lima': 'PE', 'montevideo': 'UY',
  'san josé, costa rica': 'CR', 'quito': 'EC',
};

/** US states and Canadian provinces, by name and by postal abbreviation. */
const US_STATE_NAMES = new Set(['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado', 'connecticut', 'delaware', 'florida', 'georgia', 'washington', 'hawaii', 'idaho', 'illinois', 'indiana', 'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan', 'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire', 'new jersey', 'new mexico', 'north carolina', 'north dakota', 'ohio', 'oklahoma', 'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee', 'texas', 'utah', 'vermont', 'virginia', 'west virginia', 'wisconsin', 'wyoming']);
const US_STATE_ABBR = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
const CA_PROVINCES = new Set(['ontario', 'quebec', 'québec', 'british columbia', 'alberta', 'manitoba', 'saskatchewan', 'nova scotia', 'new brunswick', 'newfoundland']);
const CA_ABBR = new Set(['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE']);

/* -------------------------------------------------------------- index */

const ALIAS = new Map();
for (const [code, names] of Object.entries(COUNTRIES)) {
  for (const n of names) ALIAS.set(n, code);
  ALIAS.set(code.toLowerCase(), code);
}
// Three-letter codes feeds actually use.
for (const [k, v] of Object.entries({ usa: 'US', gbr: 'GB', deu: 'DE', fra: 'FR', can: 'CA', aus: 'AU', ind: 'IN', bra: 'BR', esp: 'ES', nld: 'NL', che: 'CH', are: 'AE', sau: 'SA', egy: 'EG', irl: 'IE', pol: 'PL', prt: 'PT', ita: 'IT', swe: 'SE', mex: 'MX' })) {
  ALIAS.set(k, v);
}
// Two-letter codes that are also ordinary words or US states must not be read
// as a country from free text ("IN" is Indiana, "CA" California, "DE" Delaware).
const AMBIGUOUS_CODES = new Set(['in', 'ca', 'de', 'co', 'me', 'ma', 'pa', 'ga', 'al', 'ar', 'id', 'il', 'mn', 'mo', 'mt', 'ne', 'ok', 'or', 'sc', 'sd', 'tn', 'va', 'wa', 'it', 'is', 'no', 'at', 'be', 'us', 'la', 'md', 'ms', 'nc', 'nd', 'ky', 'ks', 'ia', 'hi', 'ct']);

export const COUNTRY_CODES = Object.keys(COUNTRIES);

export function isCountryCode(code) {
  return typeof code === 'string' && Object.hasOwn(COUNTRIES, code.toUpperCase());
}

export function countryName(code) {
  const names = COUNTRIES[String(code || '').toUpperCase()];
  if (!names) return null;
  return names[0].replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Regions that mean "several countries" — a posting open to a region has no single country. */
const REGIONS = /\b(worldwide|anywhere|global|emea|apac|latam|europe|eu|north america|americas|asia|africa|middle east|mena|gcc)\b/i;

function cleanPiece(s) {
  return s
    .toLowerCase()
    .replace(/\((?:hq|headquarters|office|onsite|on-site|hybrid|remote)\)/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best single country for a location string, plus the city when one is named.
 *
 * @param {string} text
 * @param {{ hint?: string }} [opts]  A country the feed itself stated, if any.
 * @returns {{ country: string|null, city: string|null, multi: boolean }}
 */
export function parseLocation(text, opts = {}) {
  const raw = String(text || '').trim();
  const hint = opts.hint && isCountryCode(opts.hint) ? opts.hint.toUpperCase() : null;
  if (!raw) return { country: hint, city: null, multi: false };

  const found = [];
  let city = null;

  // Parenthesised country first: "Remote (Canada)".
  for (const m of raw.matchAll(/\(([^)]+)\)/g)) {
    const c = ALIAS.get(cleanPiece(m[1]));
    if (c) found.push(c);
  }

  const pieces = raw
    .replace(/\([^)]*\)/g, ' ')
    .split(/[,;/|•·]| - | or | and | \+ /i)
    .map(cleanPiece)
    .filter(Boolean);

  for (const p of pieces) {
    // "Austin, TX", "Toronto, ON": after a city, two letters are a US state or
    // a Canadian province far more often than a country code.
    if (/^[a-z]{2}$/.test(p) && pieces.length > 1) {
      const up = p.toUpperCase();
      if (US_STATE_ABBR.has(up)) { found.push('US'); continue; }
      if (CA_ABBR.has(up)) { found.push('CA'); continue; }
    }
    if (ALIAS.has(p)) {
      found.push(ALIAS.get(p));
      continue;
    }
    if (CITIES[p]) {
      found.push(CITIES[p]);
      if (!city) city = titleCase(p);
      continue;
    }
    if (US_STATE_NAMES.has(p)) { found.push('US'); continue; }
    if (CA_PROVINCES.has(p)) { found.push('CA'); continue; }
    // A city we do not know, but its first word might still be a country: "Germany - Berlin".
    const words = p.split(' ');
    for (let n = Math.min(4, words.length); n >= 1; n -= 1) {
      const head = words.slice(0, n).join(' ');
      const tail = words.slice(-n).join(' ');
      const hit = (!AMBIGUOUS_CODES.has(head) && ALIAS.get(head)) || (!AMBIGUOUS_CODES.has(tail) && ALIAS.get(tail)) || CITIES[head] || CITIES[tail];
      if (hit) { found.push(hit); break; }
    }
    if (!city && pieces.length > 1 && p === pieces[0] && !REGIONS.test(p) && p.length <= 40) {
      city = titleCase(p);
    }
  }

  const unique = [...new Set(found)];
  if (unique.length === 1) return { country: unique[0], city, multi: false };
  if (unique.length > 1) {
    // Several countries named: keep the feed's own hint if it is one of them.
    return { country: hint && unique.includes(hint) ? hint : unique[0], city, multi: true };
  }
  return { country: hint, city: REGIONS.test(raw) ? null : city, multi: REGIONS.test(raw) };
}

function titleCase(s) {
  return s.replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

/** Every country a location string names — for "USA, Canada, Ireland or UK only". */
export function countriesIn(text) {
  const out = new Set();
  for (const piece of String(text || '').split(/[,;/|]| or | and /i).map(cleanPiece)) {
    const c = ALIAS.get(piece) || CITIES[piece];
    if (c && !(AMBIGUOUS_CODES.has(piece) && piece.length === 2)) out.add(c);
  }
  return [...out];
}
