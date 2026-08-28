/**
 * Email bodies.
 *
 * Every message goes out bilingual with Arabic first, because the account's
 * language preference is a setting the person may never have touched and a
 * reset email is the one message that must not need a translation to act on.
 *
 * Table-based layout and inline styles are not carelessness: mail clients strip
 * <style> blocks, and Outlook still lays out with a Word engine that ignores
 * flexbox entirely. `dir="rtl"` on the wrapper carries the Arabic direction to
 * clients that honour it, and the Latin URL stays LTR inside its own element.
 */

const BRAND = '#1A56E8';
const BRAND_DEEP = '#0A1A4A';
const INK = '#0F172A';
const MUTED = '#475569';
const FAINT = '#94A3B8';
const BORDER = '#E2E8F0';
const GOLD = '#FEAF04';

/**
 * The logo, as an absolute URL on a PINNED path.
 *
 * Not a hashed filename, and not a data URI. Gmail and Outlook.com both
 * rewrite and re-host remote images through their own proxies, and several
 * clients — Outlook desktop most notably — refuse `data:` image sources
 * outright, which would leave a blank box where the brand should be. A stable
 * https URL is the only form every client renders, and it must stay stable
 * because a message sent last year is still opened this year:
 * scripts/fingerprint-assets.mjs pins these names for exactly that reason.
 */
const LOGO_URL = 'https://interprova.com/logo-mark-ondark.png';
const SITE_URL = 'https://interprova.com';

/**
 * The masthead.
 *
 * Every design decision here is a workaround for a mail client, not a
 * preference:
 *
 *   - The logo sits on a DARK band. The mark's own artwork is white-and-gold,
 *     so on the white card body it would be invisible — and "invisible when
 *     images load" is worse than no logo.
 *   - `background-color` on the <td> as well as the gradient, because Outlook's
 *     Word engine ignores CSS gradients entirely and would otherwise paint a
 *     white band with white artwork on it.
 *   - Explicit width/height on the <img>, so a client that has not yet
 *     downloaded it reserves the right space instead of reflowing the whole
 *     message when it arrives.
 *   - Real `alt` text. With remote images blocked — the DEFAULT in Outlook and
 *     for any unknown sender in Gmail — this line is the entire brand
 *     identity of the message, so it reads as a wordmark, not "logo.png".
 */
function masthead() {
  return `<tr><td align="center" bgcolor="${BRAND_DEEP}"
      style="background-color:${BRAND_DEEP};
             background-image:linear-gradient(135deg,${BRAND} 0%,${BRAND_DEEP} 100%);
             padding:26px 28px">
    <a href="${SITE_URL}" style="text-decoration:none;color:#fff">
      <img src="${LOGO_URL}" width="44" height="44" alt="Interprova"
           style="display:inline-block;vertical-align:middle;border:0;width:44px;height:44px">
      <span style="display:inline-block;vertical-align:middle;padding-inline-start:12px;
                   font-size:23px;font-weight:800;letter-spacing:-.4px;color:#ffffff">Interprova</span>
    </a>
    <div style="height:3px;width:54px;background:${GOLD};border-radius:99px;margin:14px auto 0"></div>
  </td></tr>`;
}

function shell(innerHtml) {
  return `<!doctype html>
<html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only"></head>
<body style="margin:0;padding:24px 12px;background:#F1F5FB;
             font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:${INK}">
  <!-- Preheader: the grey line a client prints next to the subject in the
       inbox list. Left empty it shows the first words of the body, which for a
       reset email is boilerplate. Hidden in the message itself. -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Interprova — ${SITE_URL}</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="background:#F1F5FB">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560"
             style="width:100%;max-width:560px;background:#ffffff;border:1px solid ${BORDER};
                    border-radius:16px;overflow:hidden">
        ${masthead()}
        <tr><td style="padding:30px 30px 26px">${innerHtml}</td></tr>
        <tr><td style="padding:20px 30px;background:#F7F9FC;border-top:1px solid ${BORDER};
                       font-size:12.5px;color:${MUTED};line-height:1.8">
          <strong style="color:${INK}">Interprova</strong> — تدريب على مقابلات العمل بالذكاء الاصطناعي، بالعربية والإنجليزية.<br>
          <a href="${SITE_URL}" style="color:${BRAND};text-decoration:none" dir="ltr">interprova.com</a>
          <br><br>
          <!-- Text links, not icons: a client with remote images blocked would
               render an icon row as a line of empty boxes. -->
          <a href="mailto:info@interprova.com" style="color:${BRAND};text-decoration:none">info@interprova.com</a>
          &nbsp;·&nbsp;
          <a href="https://www.facebook.com/profile.php?id=61593602555146" style="color:${BRAND};text-decoration:none">Facebook</a>
          &nbsp;·&nbsp;
          <a href="https://www.linkedin.com/company/interprova" style="color:${BRAND};text-decoration:none">LinkedIn</a>
          &nbsp;·&nbsp;
          <a href="https://www.instagram.com/interprova.10541" style="color:${BRAND};text-decoration:none">Instagram</a>
          <br><br>
          <span style="color:${FAINT}">
            Interprova منتج من
            <a href="https://barmagly.tech" style="color:${FAINT};text-decoration:underline">شركة برمجلي</a>
            — القاهرة، مصر.
          </span>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * A call-to-action button.
 *
 * Built from a table with the colour on the <td>, because Outlook drops
 * `background` from an <a> and would render an invisible link. `mso-padding-alt`
 * gives the Word engine the padding it also drops.
 */
function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
    <tr><td align="center" bgcolor="${BRAND}"
            style="background-color:${BRAND};border-radius:10px;mso-padding-alt:14px 30px">
      <a href="${href}" style="display:inline-block;padding:14px 30px;font-size:15.5px;font-weight:700;
         color:#ffffff;text-decoration:none;border-radius:10px">${label}</a>
    </td></tr></table>`;
}

/** A boxed aside — used for the "didn't ask for this?" reassurance. */
function note(inner) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
    style="width:100%;background:#F7F9FC;border:1px solid ${BORDER};border-radius:10px;margin:4px 0 0">
    <tr><td style="padding:14px 16px;font-size:13.5px;line-height:1.8;color:${MUTED}">${inner}</td></tr>
  </table>`;
}

/**
 * @param {object} o
 * @param {string} o.url      one-time reset link
 * @param {number} o.minutes  how long it stays valid
 */
export function passwordResetEmail({ url, minutes }) {
  const subject = 'إعادة تعيين كلمة المرور — Interprova / Reset your password';

  const html = shell(`
    <h1 style="font-size:21px;margin:14px 0 10px">إعادة تعيين كلمة المرور</h1>
    <p style="font-size:15px;line-height:1.85;color:${MUTED};margin:0">
      وصلنا طلب لإعادة تعيين كلمة مرور حسابك. اضغط الزر أدناه لاختيار كلمة مرور جديدة.
      الرابط صالح لمدة <strong>${minutes} دقيقة</strong> ويُستخدم مرة واحدة.
    </p>
    ${button(url, 'اختيار كلمة مرور جديدة')}
    <p style="font-size:13.5px;line-height:1.8;color:${MUTED};margin:0 0 18px">
      إن لم تطلب ذلك، تجاهل هذه الرسالة — لن يتغيّر شيء في حسابك، ولن يعرف أحد أنك تلقّيتها.
    </p>
    <hr style="border:0;border-top:1px solid ${BORDER};margin:22px 0">
    <div dir="ltr" style="text-align:left;unicode-bidi:isolate">
      <h2 style="font-size:17px;margin:0 0 8px">Reset your password</h2>
      <p style="font-size:14px;line-height:1.75;color:${MUTED};margin:0">
        We received a request to reset your Interprova password. The link above is valid
        for ${minutes} minutes and can be used once. If you didn't ask for this, ignore
        this email — nothing about your account changes.
      </p>
      <p style="font-size:12px;color:${MUTED};word-break:break-all;margin:14px 0 0">${url}</p>
    </div>`);

  const text = [
    'إعادة تعيين كلمة المرور — Interprova',
    '',
    `افتح هذا الرابط لاختيار كلمة مرور جديدة (صالح ${minutes} دقيقة، ويُستخدم مرة واحدة):`,
    url,
    '',
    'إن لم تطلب ذلك، تجاهل هذه الرسالة.',
    '',
    '--',
    'Reset your Interprova password. The link is valid for ' + minutes + ' minutes and can be used once.',
    'If you did not request it, ignore this email.',
  ].join('\n');

  return { subject, html, text };
}

/* ------------------------------------------------------------------ *
 * Contact form
 * ------------------------------------------------------------------ */

/** Escape for interpolation into an HTML body. Visitor text is untrusted. */
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Topic codes are an API contract; these are what a human should read. */
const TOPIC_AR = {
  support: 'مشكلة تقنية',
  billing: 'الاشتراكات والدفع',
  feature: 'اقتراح ميزة',
  business: 'تعاون تجاري',
  other: 'أخرى',
};
const TOPIC_EN = {
  support: 'Technical problem',
  billing: 'Billing',
  feature: 'Feature request',
  business: 'Business',
  other: 'Other',
};

/**
 * The message, as it arrives in our own inbox.
 *
 * Was assembled inline in routes/contact.js with no masthead, no footer and no
 * shell — so the one email we receive most often was the only unbranded thing
 * the system sent, and it looked like a scraper had mailed us. Moved here so
 * every outbound message shares one design and one place to change it.
 *
 * The visitor's address goes in `replyTo`, never `from` — see routes/contact.js.
 * Hitting Reply in the mail client answers them directly.
 */
export function contactNotificationEmail({ name, email, topic, message }) {
  const label = TOPIC_AR[topic] || TOPIC_AR.other;
  const subject = `[Interprova · ${TOPIC_EN[topic] || 'Other'}] ${name}`;

  const row = (k, v) => `
    <tr>
      <td style="padding:7px 0;font-size:13.5px;color:${MUTED};white-space:nowrap;vertical-align:top">${k}</td>
      <td style="padding:7px 0 7px 14px;font-size:14.5px;color:${INK};font-weight:600">${v}</td>
    </tr>`;

  const html = shell(`
    <div style="display:inline-block;padding:5px 12px;border-radius:999px;
                background:#EFF5FF;color:${BRAND};font-size:12.5px;font-weight:700">${esc(label)}</div>
    <h1 style="font-size:20px;margin:12px 0 16px">رسالة جديدة من نموذج التواصل</h1>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%">
      ${row('الاسم', esc(name))}
      ${row('البريد', `<a href="mailto:${esc(email)}" style="color:${BRAND};text-decoration:none" dir="ltr">${esc(email)}</a>`)}
    </table>

    <div style="margin:18px 0 0;padding:16px 18px;background:#F7F9FC;
                border:1px solid ${BORDER};border-inline-start:3px solid ${BRAND};
                border-radius:10px;font-size:15px;line-height:1.85;color:${INK};
                white-space:pre-wrap">${esc(message)}</div>

    ${note('اضغط <strong>ردّ</strong> للردّ على المُرسِل مباشرة — عنوانه مضبوط في حقل Reply-To.')}
  `);

  const text = [
    `الموضوع : ${label}`,
    `الاسم   : ${name}`,
    `البريد  : ${email}`,
    '',
    message,
  ].join('\n');

  return { subject, html, text };
}

/**
 * The acknowledgement the visitor gets back.
 *
 * New. Without it, sending a message into a form is an act of faith: the page
 * says "we got it" and then nothing ever arrives, which is indistinguishable
 * from the form being broken — and this form is the channel people reach for
 * precisely when something else has already failed them.
 *
 * It quotes their own message back. That is the part that proves it arrived
 * intact, and it gives them a copy they can find later by searching their own
 * sent-to address.
 *
 * Sent to an address NOBODY HAS VERIFIED, so it must stay unattractive to
 * abuse: no links back into the account, nothing actionable, and the rate
 * limiter on the endpoint bounds it to five per hour per IP.
 */
export function contactAckEmail({ name, topic, message }) {
  const label = TOPIC_AR[topic] || TOPIC_AR.other;
  const subject = 'وصلتنا رسالتك — Interprova / We received your message';

  const html = shell(`
    <h1 style="font-size:21px;margin:14px 0 10px">وصلتنا رسالتك</h1>
    <p style="font-size:15px;line-height:1.85;color:${MUTED};margin:0">
      شكرًا ${esc(name)} — استلمنا رسالتك بخصوص <strong>${esc(label)}</strong>،
      وسنردّ على هذا البريد خلال يوم عمل واحد عادةً.
    </p>

    <div style="margin:20px 0 0;padding:16px 18px;background:#F7F9FC;
                border:1px solid ${BORDER};border-inline-start:3px solid ${BRAND};
                border-radius:10px;font-size:14.5px;line-height:1.85;color:${MUTED};
                white-space:pre-wrap">${esc(message)}</div>

    ${note('لا حاجة للردّ على هذه الرسالة — هي فقط تأكيد بأن رسالتك وصلت.')}

    <hr style="border:0;border-top:1px solid ${BORDER};margin:22px 0">
    <div dir="ltr" style="text-align:left;unicode-bidi:isolate">
      <h2 style="font-size:17px;margin:0 0 8px">We received your message</h2>
      <p style="font-size:14px;line-height:1.75;color:${MUTED};margin:0">
        Thanks ${esc(name)} — your message about <strong>${esc(TOPIC_EN[topic] || 'Other')}</strong>
        reached us, and we normally reply to this address within one business day.
        No need to reply to this email; it is only a confirmation.
      </p>
    </div>`);

  const text = [
    'وصلتنا رسالتك — Interprova',
    '',
    `شكرًا ${name}. استلمنا رسالتك بخصوص "${label}" وسنردّ خلال يوم عمل واحد عادةً.`,
    '',
    'نصّ رسالتك:',
    message,
    '',
    '--',
    'We received your message and will reply within one business day. No reply needed.',
  ].join('\n');

  return { subject, html, text };
}
