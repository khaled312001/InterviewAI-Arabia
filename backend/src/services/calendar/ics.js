/**
 * A minimal, standards-compliant iCalendar (RFC 5545) builder for one event.
 *
 * It exists so a person WITHOUT a Google connection — Outlook, Apple Calendar,
 * anything that opens a .ics — can still put an interview in their calendar.
 * Pure: no env, no DB, so it can be unit-tested in isolation.
 *
 * The three rules that most hand-written .ics files break, and that real
 * clients enforce:
 *   • TEXT values escape `\`, `;`, `,` and newlines (§3.3.11).
 *   • Lines end in CRLF, not LF (§3.1).
 *   • Lines longer than 75 OCTETS are folded with CRLF + one space (§3.1) —
 *     octets, not characters, and never in the middle of a UTF-8 sequence,
 *     which matters for Arabic titles where one character is two bytes.
 *
 * Times are written in UTC (`...Z`), so no VTIMEZONE block is needed and every
 * client shows the event at the right instant in its own zone.
 */

const CRLF = '\r\n';

/** Escape a TEXT property value. */
export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Fold one content line to at most 75 octets per physical line.
 * Continuation lines start with a single space, which counts toward their 75.
 */
export function foldLine(line) {
  const bytes = Buffer.byteLength(line, 'utf8');
  if (bytes <= 75) return line;

  const out = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  // Iterate by code point so a surrogate pair or a multi-byte character is
  // never split across two physical lines.
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    if (currentBytes + size > limit) {
      out.push(current);
      current = ch;
      currentBytes = size;
      limit = 74; // the leading space on continuation lines takes one octet
    } else {
      current += ch;
      currentBytes += size;
    }
  }
  if (current) out.push(current);
  return out.join(`${CRLF} `);
}

/** `20261016T143000Z` */
export function formatUtc(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid date');
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * @param {object} ev
 * @param {string} ev.uid          Globally unique id (e.g. `<random>@interprova.com`).
 * @param {Date|string} ev.start
 * @param {Date|string} ev.end
 * @param {string} ev.summary
 * @param {string} [ev.description]
 * @param {string} [ev.location]
 * @param {string} [ev.url]
 * @param {number[]} [ev.alarmsMinutes]  Minutes before start for DISPLAY alarms.
 * @param {Date} [ev.now]          DTSTAMP; injectable for tests.
 * @returns {string} the whole calendar, CRLF-terminated
 */
export function buildIcs(ev) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Interprova//Interview Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeText(ev.uid)}`,
    `DTSTAMP:${formatUtc(ev.now || new Date())}`,
    `DTSTART:${formatUtc(ev.start)}`,
    `DTEND:${formatUtc(ev.end)}`,
    `SUMMARY:${escapeText(ev.summary)}`,
  ];
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
  // URL is a URI value, not TEXT — escaping its commas would corrupt it.
  // Only a well-formed http(s) URL with no line breaks is written at all.
  if (ev.url && /^https?:\/\/[^\s]+$/i.test(ev.url)) lines.push(`URL:${ev.url}`);
  lines.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE');

  for (const minutes of ev.alarmsMinutes || []) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    const trigger = m % 1440 === 0 && m > 0 ? `-P${m / 1440}D` : `-PT${m}M`;
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeText(ev.summary)}`,
      `TRIGGER:${trigger}`,
      'END:VALARM',
    );
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}
