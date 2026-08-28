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
const INK = '#0F172A';
const MUTED = '#475569';
const BORDER = '#E2E8F0';

function shell(innerHtml) {
  return `<!doctype html>
<html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#F7F9FC;
             font-family:'Segoe UI',Tahoma,Arial,sans-serif;color:${INK}">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"
         style="max-width:560px;margin:0 auto;background:#fff;border:1px solid ${BORDER};
                border-radius:14px;overflow:hidden">
    <tr><td style="padding:28px 28px 8px">
      <div style="font-size:20px;font-weight:800;color:${BRAND};letter-spacing:-.3px">Interprova</div>
    </td></tr>
    <tr><td style="padding:0 28px 28px">${innerHtml}</td></tr>
    <tr><td style="padding:16px 28px;background:#F7F9FC;border-top:1px solid ${BORDER};
                   font-size:12px;color:${MUTED};line-height:1.7">
      أُرسلت هذه الرسالة من <strong>Interprova</strong> — تدريب على المقابلات الوظيفية بالذكاء الاصطناعي.<br>
      <span dir="ltr" style="unicode-bidi:isolate">https://interprova.com</span>
    </td></tr>
  </table>
</body></html>`;
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0">
    <tr><td style="border-radius:10px;background:${BRAND}">
      <a href="${href}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:700;
         color:#fff;text-decoration:none;border-radius:10px">${label}</a>
    </td></tr></table>`;
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
