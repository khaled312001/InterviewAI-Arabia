/**
 * Search terms in Arabic → the English words job postings are written in.
 *
 * Almost every indexed and live posting is in English (or German), so a search
 * for «محاسب» would match nothing even with hundreds of accountant jobs open.
 * Known job words and phrases are swapped for their English form, longest
 * phrase first; an Arabic word with no entry is dropped rather than searched,
 * because a required word no posting can contain empties the result.
 */

const normAr = (s) => String(s || '')
  .replace(/[ً-ْـ]/g, '')
  .replace(/[أإآ]/g, 'ا')
  .replace(/ة/g, 'ه')
  .replace(/ى/g, 'ي');

const RAW = {
  'مهندس برمجيات': 'software engineer',
  'مطور برمجيات': 'software developer',
  'مطور ويب': 'web developer',
  'مطور واجهات اماميه': 'frontend developer',
  'واجهات اماميه': 'frontend',
  'مطور خلفيه': 'backend developer',
  'مطور تطبيقات': 'mobile developer',
  'تطبيقات موبايل': 'mobile',
  'تطبيقات جوال': 'mobile',
  'مطور': 'developer',
  'مبرمج': 'developer',
  'برمجه': 'software',
  'برمجيات': 'software',
  'مهندس مدني': 'civil engineer',
  'مهندس ميكانيكا': 'mechanical engineer',
  'مهندس ميكانيكي': 'mechanical engineer',
  'مهندس كهرباء': 'electrical engineer',
  'مهندس كهربائي': 'electrical engineer',
  'مهندس': 'engineer',
  'هندسه': 'engineering',
  'معماري': 'architect',
  'محاسب': 'accountant',
  'محاسبه': 'accounting',
  'مراجع حسابات': 'auditor',
  'مدقق حسابات': 'auditor',
  'مدقق': 'auditor',
  'محلل مالي': 'financial analyst',
  'مدير مالي': 'finance manager',
  'ماليه': 'finance',
  'مدير مشروع': 'project manager',
  'مدير مشاريع': 'project manager',
  'مدير منتج': 'product manager',
  'مدير حسابات': 'account manager',
  'مدير': 'manager',
  'مشرف': 'supervisor',
  'محلل اعمال': 'business analyst',
  'محلل بيانات': 'data analyst',
  'عالم بيانات': 'data scientist',
  'علم البيانات': 'data science',
  'بيانات': 'data',
  'ذكاء اصطناعي': 'ai',
  'تعلم الاله': 'machine learning',
  'امن سيبراني': 'security',
  'امن معلومات': 'security',
  'شبكات': 'network',
  'سحابه': 'cloud',
  'ديف اوبس': 'devops',
  'اختبار برمجيات': 'qa',
  'مختبر برمجيات': 'qa',
  'دعم فني': 'support',
  'مصمم جرافيك': 'graphic designer',
  'مصمم': 'designer',
  'تصميم': 'design',
  'تسويق رقمي': 'digital marketing',
  'تسويق': 'marketing',
  'مندوب مبيعات': 'sales representative',
  'مبيعات': 'sales',
  'خدمه عملاء': 'customer service',
  'موارد بشريه': 'hr',
  'توظيف': 'recruiter',
  'مساعد اداري': 'administrative assistant',
  'سكرتير': 'secretary',
  'سكرتيره': 'secretary',
  'استقبال': 'receptionist',
  'كاتب محتوي': 'content writer',
  'كاتب': 'writer',
  'مترجم': 'translator',
  'ترجمه': 'translation',
  'معلم': 'teacher',
  'مدرس': 'teacher',
  'مدرب': 'trainer',
  'ممرض': 'nurse',
  'ممرضه': 'nurse',
  'طبيب': 'doctor',
  'صيدلي': 'pharmacist',
  'محامي': 'lawyer',
  'قانوني': 'legal',
  'مستشار': 'consultant',
  'لوجستيات': 'logistics',
  'سلاسل الامداد': 'supply chain',
  'مشتريات': 'procurement',
  'سائق': 'driver',
  'فني': 'technician',
  'كهربائي': 'electrician',
  'شيف': 'chef',
  'طاهي': 'chef',
  'ضيافه': 'hospitality',
  'فندق': 'hotel',
  'تجزئه': 'retail',
  'متدرب': 'intern',
  'تدريب': 'internship',
  'دوام جزئي': 'part time',
  'بايثون': 'python',
  'جافا سكريبت': 'javascript',
  'جافا': 'java',
  'رياكت': 'react',
  'اندرويد': 'android',
};

/** Places typed into the query become the country filter, not a search word. */
const PLACES_RAW = {
  'دبي': 'AE', 'ابوظبي': 'AE', 'ابو ظبي': 'AE', 'الشارقه': 'AE', 'الامارات': 'AE',
  'الرياض': 'SA', 'جده': 'SA', 'الدمام': 'SA', 'الخبر': 'SA', 'السعوديه': 'SA',
  'القاهره': 'EG', 'الاسكندريه': 'EG', 'الجيزه': 'EG', 'مصر': 'EG',
  'الدوحه': 'QA', 'قطر': 'QA', 'الكويت': 'KW', 'المنامه': 'BH', 'البحرين': 'BH',
  'مسقط': 'OM', 'سلطنه عمان': 'OM', 'الاردن': 'JO', 'بيروت': 'LB', 'لبنان': 'LB',
  'المغرب': 'MA', 'الدار البيضاء': 'MA', 'تونس': 'TN', 'الجزائر': 'DZ', 'العراق': 'IQ',
  'لندن': 'GB', 'بريطانيا': 'GB', 'المانيا': 'DE', 'برلين': 'DE', 'فرنسا': 'FR', 'باريس': 'FR',
  'هولندا': 'NL', 'امستردام': 'NL', 'اسبانيا': 'ES', 'ايطاليا': 'IT', 'كندا': 'CA', 'امريكا': 'US',
  'الولايات المتحده': 'US', 'استراليا': 'AU', 'الهند': 'IN', 'سنغافوره': 'SG', 'تركيا': 'TR', 'اسطنبول': 'TR',
};
const PLACES = Object.entries(PLACES_RAW).map(([ar, cc]) => [normAr(ar), cc]).sort((a, b) => b[0].length - a[0].length);
const REMOTE = [normAr('عن بعد'), normAr('من المنزل'), normAr('ريموت')];

const PHRASES = Object.entries(RAW)
  .map(([ar, en]) => [normAr(ar), en])
  .sort((a, b) => b[0].length - a[0].length);

const ARABIC = /[؀-ۿ]/;
const DROP = new Set(['في', 'وظيفه', 'وظايف', 'وظائف', 'عمل', 'شغل', 'مطلوب', 'ال']);

/**
 * @param {string} q
 * @returns {{ q: string, translated: boolean, country?: string, remote?: boolean }}
 *   the query to search with, plus a country or "remote" the words named
 */
export function englishQuery(q) {
  const raw = String(q || '').trim();
  if (!ARABIC.test(raw)) return { q: raw, translated: false };
  let rest = ` ${normAr(raw).replace(/\s+/g, ' ')} `;
  const out = [];
  let country;
  let remote = false;
  for (const [ar, cc] of PLACES) {
    for (const n of [` ${ar} `, ` في${ar} `, ` ب${ar} `]) {
      if (rest.includes(n)) {
        country = country || cc;
        rest = rest.split(n).join(' ');
      }
    }
  }
  for (const r of REMOTE) {
    if (rest.includes(` ${r} `)) {
      remote = true;
      rest = rest.split(` ${r} `).join(' ');
    }
  }
  for (const [ar, en] of PHRASES) {
    const needle = ` ${ar} `;
    // Also catch the definite article: «المحاسب» is «محاسب».
    for (const n of [needle, ` ال${ar} `]) {
      while (rest.includes(n)) {
        out.push(en);
        rest = rest.replace(n, ' ');
      }
    }
  }
  // Latin words typed alongside the Arabic ("مطور React") are kept as they are.
  for (const w of rest.split(' ')) {
    if (w && !ARABIC.test(w) && !DROP.has(w)) out.push(w);
  }
  const english = [...new Set(out.join(' ').split(' ').filter(Boolean))].join(' ');
  const extra = { ...(country ? { country } : {}), ...(remote ? { remote } : {}) };
  if (english) return { q: english, translated: true, ...extra };
  return country || remote ? { q: '', translated: true, ...extra } : { q: raw, translated: false };
}
