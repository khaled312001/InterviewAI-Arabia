/**
 * ATS check — what an applicant-tracking system and a recruiter's six-second
 * scan will make of a CV, and what to change.
 *
 * Deterministic on purpose: the free public checker on the website runs this
 * with no account and no model call, and a score that moves when nothing
 * changed is a score nobody trusts. Every finding carries its own Arabic and
 * English text so the website and the app say exactly the same thing.
 */

import { extractSkills, skillLabel } from '../jobs/skills.js';
import { cvToText, sanitizeCv } from './cv.js';
import { titleSimilarity } from './match.js';

const VERBS_EN = new Set(('achieved accelerated administered advised analysed analyzed architected automated boosted built '
  + 'championed coached collaborated completed conceived consolidated coordinated created cut decreased defined delivered '
  + 'designed developed devised directed doubled drove eliminated enabled engineered established evaluated exceeded '
  + 'expanded facilitated founded generated grew guided headed identified implemented improved increased initiated '
  + 'introduced launched led maintained managed mentored migrated modernised modernized negotiated optimised optimized '
  + 'orchestrated organised organized oversaw owned partnered pioneered planned prepared produced programmed '
  + 'raised rebuilt redesigned reduced refactored resolved restructured revamped saved scaled secured shipped simplified '
  + 'spearheaded standardised standardized streamlined strengthened supervised supported taught tested trained '
  + 'transformed tripled upgraded won wrote').split(' '));

const VERBS_AR = ['قدت', 'قمت', 'أدرت', 'طورت', 'صممت', 'أنشأت', 'حققت', 'خفضت', 'زدت', 'رفعت', 'نفذت', 'أطلقت', 'بنيت',
  'حسنت', 'أشرفت', 'درّبت', 'دربت', 'نظمت', 'أعددت', 'وضعت', 'أسست', 'تفاوضت', 'حللت', 'قلّلت', 'قللت', 'ضاعفت', 'إدارة', 'تطوير', 'تصميم', 'قيادة', 'تحسين', 'تنفيذ', 'بناء', 'إطلاق'];

const HEADINGS = {
  summary: /^(summary|professional summary|profile|about( me)?|objective|career objective|personal statement|الملخص|ملخص|نبذة|نبذة عني|الهدف الوظيفي|profil|zusammenfassung|résumé|perfil)\b/im,
  experience: /^(experience|work experience|professional experience|employment( history)?|work history|career history|الخبرات|الخبرة|الخبرة العملية|الخبرات العملية|berufserfahrung|expérience|experiencia)\b/im,
  education: /^(education|academic background|qualifications|التعليم|المؤهلات|المؤهل العلمي|ausbildung|bildung|formation|educación)\b/im,
  skills: /^(skills|technical skills|core skills|key skills|competencies|core competencies|expertise|المهارات|مهارات|kenntnisse|fähigkeiten|compétences|habilidades)\b/im,
};

const msg = (en, ar) => ({ en, ar });

function words(text) {
  return String(text || '').split(/\s+/).filter(Boolean);
}

/** Bullet lines of a plain-text CV: lines that start with a bullet glyph or dash. */
function bulletLines(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^([•●▪◦‣\-*–]|\d+[.)])\s+/.test(l))
    .map((l) => l.replace(/^([•●▪◦‣\-*–]|\d+[.)])\s+/, ''));
}

function startsWithVerb(line) {
  const first = line.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z؀-ۿ]/g, '') || '';
  if (VERBS_EN.has(first)) return true;
  return VERBS_AR.some((v) => line.startsWith(v));
}

const quantified = (line) => /\d|%|\$|€|£|٪|[٠-٩]/.test(line);

/** Frequent meaningful words of a job description — the terms a recruiter searches for. */
function keyTerms(jd, limit = 12) {
  const STOP = new Set(('the and for with you your our will are have has this that from into who what when where which their they them '
    + 'about able across also among an any as at be been being both but by can could do does each etc ever every few get '
    + 'good great help how if in is it its just like make many may more most must new no not of on one or other out over '
    + 'own per plus role team teams work working well within would years year experience strong skills ability using use '
    + 'including such than then there these those through to up us very we what while why work world company job position '
    + 'opportunity candidate candidates looking join apply benefits salary please based required preferred requirements '
    + 'responsibilities qualifications knowledge understanding environment across closely ensure support provide day '
    + 'time based office remote hybrid full part '
    // Verbs and filler every posting uses — never what a recruiter filters on.
    + 'believe build building built maintain maintaining create creating develop developing drive driving deliver '
    + 'delivering manage managing grow growing learn learning want need needs value values love enjoy making helping '
    + 'take taking find know think solve solving write writing improve improving ensuring collaborate collaborating '
    + 'partner partners others people someone anyone everyone things thing something ways part level high highly best '
    + 'better fast first global largest leading mission culture diverse diversity equal employer inclusive inclusion '
    + 'background backgrounds gender race religion disability veteran national origin sexual orientation identity '
    + 'applicants application hiring process interview offer compensation equity health insurance paid leave vacation '
    + 'flexible stock annual range location locations relocation visa sponsorship users customers clients products '
    + 'services tools issues problems running world-class impact passionate excited exciting fast-paced '
    + 'responsible responsibility opportunities want across including').split(' '));
  const counts = new Map();
  for (const w of String(jd || '').toLowerCase().match(/[a-z][a-z+#.-]{3,}/g) || []) {
    const t = w.replace(/[.-]+$/, '');
    if (STOP.has(t) || t.length < 4) continue;
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

/**
 * @param {object} input
 * @param {string} [input.cvText]  pasted or extracted text
 * @param {object} [input.cv]      structured CV (preferred — more precise checks)
 * @param {string} [input.jobDescription]
 * @param {string} [input.jobTitle]
 */
export function analyzeAts({ cvText, cv, jobDescription, jobTitle }) {
  const structured = cv ? sanitizeCv(cv) : null;
  const text = structured ? cvToText(structured) : String(cvText || '').slice(0, 40000);
  const lower = text.toLowerCase();
  const wc = words(text).length;

  const checks = [];
  const add = (id, weight, ok, severity, message, tip) => checks.push({ id, weight, ok: Boolean(ok), severity, message, tip: ok ? null : tip });

  // ---------------------------------------------------------- contact
  const email = structured ? structured.basics.email : (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0];
  add('email', 8, email && /@/.test(email), 'high',
    msg('Email address', 'البريد الإلكتروني'),
    msg('Add a professional email address at the top — recruiters cannot contact you without it.', 'أضف بريدًا إلكترونيًا مهنيًا في أعلى السيرة؛ بدونه لا يستطيع مسؤول التوظيف التواصل معك.'));
  const phone = structured ? structured.basics.phone : (text.match(/(\+?\d[\d\s().-]{7,}\d)/) || [])[0];
  add('phone', 6, phone && phone.replace(/\D/g, '').length >= 8, 'high',
    msg('Phone number', 'رقم الهاتف'),
    msg('Add a phone number with the country code (e.g. +971…).', 'أضف رقم هاتف مع مفتاح الدولة (مثل ‎+971…).'));
  const hasLink = structured ? structured.basics.links.length > 0 : /linkedin\.com|github\.com|behance\.net|portfolio|https?:\/\//i.test(text);
  add('links', 3, hasLink, 'low',
    msg('LinkedIn or portfolio link', 'رابط LinkedIn أو معرض أعمال'),
    msg('Add your LinkedIn profile (and GitHub/portfolio if relevant).', 'أضف رابط ملفك على LinkedIn (وGitHub أو معرض أعمالك إن وُجد).'));
  const hasLocation = structured ? Boolean(structured.basics.location) : true;
  add('location', 3, hasLocation, 'medium',
    msg('City and country', 'المدينة والدولة'),
    msg('State your city and country — many ATS filters search by location.', 'اذكر مدينتك ودولتك؛ كثير من أنظمة الفرز تبحث حسب الموقع.'));

  // --------------------------------------------------------- sections
  const summaryText = structured ? structured.basics.summary : '';
  const hasSummary = structured ? summaryText.length >= 80 : HEADINGS.summary.test(text);
  add('summary', 7, hasSummary, 'medium',
    msg('Professional summary', 'ملخص مهني'),
    msg('Open with a 2–4 line summary: your role, years of experience, and two strongest results.', 'ابدأ بملخص من 2 إلى 4 أسطر: مسماك، سنوات خبرتك، وأقوى إنجازين لك.'));
  const hasExperience = structured ? structured.experience.length > 0 : HEADINGS.experience.test(text);
  add('experience', 10, hasExperience, 'high',
    msg('Work experience section', 'قسم الخبرات العملية'),
    msg('Add a section titled "Experience" — ATS parsers look for that exact heading.', 'أضف قسمًا بعنوان "الخبرات" أو "Experience" — أنظمة الفرز تبحث عن هذا العنوان تحديدًا.'));
  const hasEducation = structured ? structured.education.length > 0 : HEADINGS.education.test(text);
  add('education', 5, hasEducation, 'medium',
    msg('Education section', 'قسم التعليم'),
    msg('Add an "Education" section, even if short.', 'أضف قسم "التعليم" حتى لو كان قصيرًا.'));
  const skillKeys = extractSkills(text, { limit: 60 });
  const listedSkills = structured ? structured.skills.length : (HEADINGS.skills.test(text) ? Math.max(skillKeys.length, 6) : 0);
  add('skills', 8, listedSkills >= 6, 'high',
    msg('Skills section with 6+ skills', 'قسم مهارات يضم 6 مهارات أو أكثر'),
    msg('List at least 6–12 concrete skills (tools, methods, languages) in a "Skills" section.', 'اذكر 6 إلى 12 مهارة محددة على الأقل (أدوات، أساليب، لغات) في قسم "المهارات".'));

  // ---------------------------------------------------------- content
  const bullets = structured
    ? structured.experience.flatMap((e) => e.bullets)
    : bulletLines(text);
  const roles = structured ? structured.experience.length : Math.max(1, (text.match(/\b(19|20)\d{2}\b/g) || []).length / 2);
  const perRole = roles ? bullets.length / roles : 0;
  add('bullets', 7, bullets.length >= 3 && perRole >= 2, 'medium',
    msg('Achievements written as bullet points', 'الإنجازات مكتوبة كنقاط'),
    msg('Describe each role in 3–6 bullet points rather than a paragraph.', 'صف كل وظيفة في 3 إلى 6 نقاط بدلًا من فقرة طويلة.'));
  const qShare = bullets.length ? bullets.filter(quantified).length / bullets.length : 0;
  add('numbers', 9, qShare >= 0.3, 'high',
    msg(`Quantified results (${Math.round(qShare * 100)}% of bullets)`, `نتائج بالأرقام (${Math.round(qShare * 100)}٪ من النقاط)`),
    msg('Put a number in at least a third of your bullets: %, time saved, revenue, team size, users.', 'ضع رقمًا في ثلث النقاط على الأقل: نسبة، وقت موفَّر، إيرادات، حجم فريق، عدد مستخدمين.'));
  const vShare = bullets.length ? bullets.filter(startsWithVerb).length / bullets.length : 0;
  add('verbs', 6, vShare >= 0.5, 'medium',
    msg(`Bullets start with action verbs (${Math.round(vShare * 100)}%)`, `النقاط تبدأ بأفعال إنجاز (${Math.round(vShare * 100)}٪)`),
    msg('Start bullets with a strong verb: Led, Built, Reduced, Increased, Launched…', 'ابدأ كل نقطة بفعل قوي: قدتُ، بنيتُ، خفّضتُ، رفعتُ، أطلقتُ…'));
  const datesOk = structured
    ? structured.experience.every((e) => e.start)
    : (text.match(/\b(19|20)\d{2}\b/g) || []).length >= 2;
  add('dates', 6, datesOk, 'medium',
    msg('Dates for every role', 'تواريخ لكل وظيفة'),
    msg('Give a start and end month/year for every role (e.g. 03/2021 – 06/2024).', 'اذكر شهر وسنة البداية والنهاية لكل وظيفة (مثل 03/2021 – 06/2024).'));
  const pronouns = (lower.match(/(^|[\s,.;])(i|my|me)(?=[\s,.;])/g) || []).length;
  add('pronouns', 3, pronouns <= 2, 'low',
    msg('No first-person pronouns', 'بدون ضمائر المتكلم'),
    msg('Drop "I", "my" and "me" — write "Led a team of 6", not "I led my team".', 'احذف "I" و"my" — اكتب "Led a team of 6" وليس "I led my team".'));
  const lengthOk = wc >= 250 && wc <= 1100;
  add('length', 5, lengthOk, 'medium',
    msg(`Length: ${wc} words`, `الطول: ${wc} كلمة`),
    wc < 250
      ? msg('Too short — aim for 400–800 words (one page early-career, two pages when experienced).', 'قصيرة جدًا — استهدف 400 إلى 800 كلمة (صفحة واحدة لبداية المسار، وصفحتان للخبرات الأطول).')
      : msg('Too long — cut to the last 10–15 years and the bullets that support your target role.', 'طويلة جدًا — اكتفِ بآخر 10 إلى 15 سنة وبالنقاط التي تدعم الوظيفة المستهدفة.'));
  const columns = !structured && /(\|.*){3,}|\t.*\t/.test(text);
  add('layout', 4, !columns, 'low',
    msg('Single-column, parser-friendly layout', 'تصميم عمود واحد سهل القراءة آليًا'),
    msg('Tables and multi-column layouts often scramble in ATS parsers. Use one column with plain headings.', 'الجداول والأعمدة المتعددة تُربك أنظمة الفرز غالبًا. استخدم عمودًا واحدًا بعناوين واضحة.'));

  const structureWeight = checks.reduce((n, c) => n + c.weight, 0);
  const structureScore = checks.reduce((n, c) => n + (c.ok ? c.weight : 0), 0) / structureWeight;

  // --------------------------------------------------- job description
  let keywords = null;
  let score = structureScore * 100;
  if (jobDescription && jobDescription.trim().length > 80) {
    const jdSkills = extractSkills(`${jobTitle || ''}\n${jobDescription}`, { limit: 25 })
      .filter((k) => !['communication', 'problem-solving'].includes(k));
    const mine = new Set(skillKeys);
    const matched = jdSkills.filter((k) => mine.has(k));
    const missing = jdSkills.filter((k) => !mine.has(k));
    const terms = keyTerms(jobDescription).filter((t) => !jdSkills.some((k) => skillLabel(k).toLowerCase() === t));
    const termsFound = terms.filter((t) => lower.includes(t));
    const termsMissing = terms.filter((t) => !lower.includes(t));
    const skillCov = jdSkills.length ? matched.length / jdSkills.length : 1;
    const termCov = terms.length ? termsFound.length / terms.length : 1;
    const head = structured ? `${structured.basics.headline} ${structured.experience[0]?.title || ''}` : text.slice(0, 300);
    const titleFit = jobTitle ? titleSimilarity(head, jobTitle) : 1;

    keywords = {
      coverage: Math.round((0.75 * skillCov + 0.25 * termCov) * 100),
      matched: matched.map((k) => ({ key: k, label: skillLabel(k) })),
      missing: missing.map((k) => ({ key: k, label: skillLabel(k) })),
      termsFound,
      termsMissing,
      titleMatch: Math.round(titleFit * 100),
    };
    checks.push({
      id: 'title', weight: 0, ok: titleFit >= 0.5, severity: 'medium',
      message: msg('Your headline matches the job title', 'عنوانك المهني يطابق مسمى الوظيفة'),
      tip: titleFit >= 0.5 ? null : msg(
        `Use the job's own title${jobTitle ? ` ("${jobTitle}")` : ''} in your headline or summary, if it truthfully describes you.`,
        `استخدم مسمى الوظيفة نفسه${jobTitle ? ` ("${jobTitle}")` : ''} في عنوانك أو ملخصك، إن كان يصفك فعلًا.`,
      ),
    });
    if (missing.length) {
      checks.push({
        id: 'keywords', weight: 0, ok: false, severity: 'high',
        message: msg(`${matched.length} of ${jdSkills.length} required skills found`, `وُجدت ${matched.length} من ${jdSkills.length} مهارات مطلوبة`),
        tip: msg(
          `Missing: ${missing.slice(0, 8).map(skillLabel).join(', ')}. Add the ones you genuinely have, in the words the posting uses.`,
          `غير موجودة: ${missing.slice(0, 8).map(skillLabel).join('، ')}. أضف ما تملكه منها فعلًا، وبنفس كلمات الإعلان.`,
        ),
      });
    }
    score = 100 * (0.5 * (keywords.coverage / 100) + 0.1 * titleFit + 0.4 * structureScore);
  }

  const final = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: final,
    grade: final >= 80 ? 'strong' : final >= 60 ? 'fair' : 'weak',
    structureScore: Math.round(structureScore * 100),
    keywords,
    skillsFound: skillKeys.slice(0, 30).map((k) => ({ key: k, label: skillLabel(k) })),
    wordCount: wc,
    checks: checks
      .map(({ weight, ...c }) => c)
      .sort((a, b) => Number(a.ok) - Number(b.ok) || ['high', 'medium', 'low'].indexOf(a.severity) - ['high', 'medium', 'low'].indexOf(b.severity)),
  };
}
