/**
 * Job-market profiles — what an interviewer in each country actually knows.
 *
 * Why this file exists
 *   The product shipped one interviewer: an Egyptian HR manager speaking
 *   simplified MSA, and an evaluator whose idea of a good answer was formed in
 *   Cairo. For a candidate in Riyadh or Dubai that is wrong in ways that are
 *   small individually and disqualifying together — the interviewer asks about
 *   a two-month notice period that does not exist there, talks about a Sunday
 *   start to a week that begins on Monday, quotes salaries in the wrong
 *   currency, never asks the iqama/visa question that opens every real Gulf
 *   interview, and speaks a register no Gulf HR manager uses on a call.
 *
 *   None of that is fixable with "be aware of Gulf culture" bolted onto a
 *   prompt. It needs facts, per country, that the model can be held to.
 *
 * What belongs here
 *   Only things that change the INTERVIEW. Currency, working week, the local
 *   employment rules a candidate is genuinely asked about, the sectors that
 *   actually hire, and how the language is spoken in a professional setting.
 *   Not tourism, not history, not anything the model already knows well enough.
 *
 * What deliberately does NOT belong here
 *   Nationality preferences, sponsorship politics, or any signal that could
 *   turn into "candidates from X should score lower". The evaluator is told
 *   explicitly, below, that market context informs the QUESTIONS and never the
 *   SCORE.
 *
 * Accuracy note: the UAE moved to a Monday–Friday working week in January
 * 2022. Getting that wrong is the single most obvious tell that a product was
 * written for one market and shipped to another.
 */

/**
 * @typedef {object} Market
 * @property {string} code        ISO-3166 alpha-2, and the client-facing id.
 * @property {string} nameAr
 * @property {string} nameEn
 * @property {string} currency    ISO-4217, for any salary discussion.
 * @property {string} currencyAr
 * @property {string} week        Working week, in plain words.
 * @property {string} dialectAr   How the interviewer should SPEAK. The most
 *                                load-bearing field in the table.
 * @property {string[]} normsAr   Employment facts a real interviewer would use.
 * @property {string[]} normsEn
 * @property {string[]} sectorsAr Sectors that dominate hiring locally.
 */

/** @type {Record<string, Market>} */
export const MARKETS = {
  EG: {
    code: 'EG',
    nameAr: 'مصر', nameEn: 'Egypt',
    currency: 'EGP', currencyAr: 'جنيه مصري',
    week: 'الأحد إلى الخميس',
    dialectAr:
      'تحدّثي بالعامية المصرية المهنية — وهي لغة المقابلات الفعلية في القاهرة: '
      + 'مفردات يومية مع نبرة رسمية، لا فصحى خطابية ولا عامية مبتذلة. '
      + 'استخدمي «إزيك» و«حضرتك» و«ممكن تحكي لي» بدل «كيف حالك» و«هلا تخبرني».',
    normsAr: [
      'مدة الإخطار المعتادة قبل ترك الوظيفة شهر إلى شهرين، والسؤال عنها طبيعي.',
      'التأمينات الاجتماعية والتأمين الصحي من أهم ما يسأل عنه المرشح، وذكرها في العرض أمر متوقّع.',
      'الرواتب تُناقش صافيةً بالشهر بالجنيه المصري، لا سنويًا.',
      'العمل الهجين والعن بُعد شائعان في الشركات التقنية، ونادران خارجها.',
      'كثير من المرشحين يعملون فريلانس بجانب وظيفتهم؛ السؤال عن ذلك عادي وليس اتهامًا.',
    ],
    normsEn: [
      'A one-to-two month notice period is standard and normal to ask about.',
      'Social insurance and medical cover are among the first things candidates ask about.',
      'Salaries are discussed as a NET MONTHLY figure in Egyptian pounds, never annually.',
      'Hybrid and remote work are common in tech, rare elsewhere.',
    ],
    sectorsAr: ['البرمجيات والاتصالات', 'الخدمات المصرفية', 'التصنيع', 'السياحة', 'خدمات الأعمال والاستعانة الخارجية'],
  },

  SA: {
    code: 'SA',
    nameAr: 'السعودية', nameEn: 'Saudi Arabia',
    currency: 'SAR', currencyAr: 'ريال سعودي',
    week: 'الأحد إلى الخميس',
    dialectAr:
      'تحدّثي بلهجة خليجية سعودية مهنية مفهومة — «كيف حالك»، «وش خبرتك في»، «ممكن تعطيني مثال»، '
      + '«يعطيك العافية». اخلطيها بالفصحى المبسطة كما يفعل مسؤولو الموارد البشرية فعلًا في الرياض، '
      + 'ولا تستخدمي مفردات مصرية مثل «إزيك» أو «عايز» أو «دلوقتي».',
    normsAr: [
      'السعودة (نطاقات) عامل حاسم: من الطبيعي تمامًا السؤال عن الجنسية من ناحية تصنيف الوظيفة، لكن دون أي تفضيل أو حكم على المرشح.',
      'للمقيمين: نقل الكفالة ومدة الإقامة وموافقة صاحب العمل الحالي أسئلة روتينية في أول مقابلة.',
      'الراتب يُذكر شهريًا بالريال، وغالبًا كحزمة: الأساسي + بدل السكن (عادة ٢٥٪) + بدل المواصلات.',
      'التأمينات الاجتماعية (GOSI) للسعوديين، والتأمين الطبي إلزامي للجميع.',
      'رؤية ٢٠٣٠ غيّرت سوق العمل فعليًا: مشاريع كبرى في السياحة والترفيه والتقنية واللوجستيات.',
      'مكافأة نهاية الخدمة حق نظامي والسؤال عنها متوقّع.',
    ],
    normsEn: [
      'Saudization (Nitaqat) shapes hiring; role classification questions are routine.',
      'For expatriates, iqama transfer and current-sponsor release are standard first-interview questions.',
      'Salary is monthly in SAR and usually quoted as a package: basic + housing (often 25%) + transport.',
      'End-of-service gratuity is a statutory right and normal to ask about.',
      'Vision 2030 has genuinely reshaped hiring toward tourism, entertainment, tech and logistics.',
    ],
    sectorsAr: ['النفط والطاقة', 'التقنية والاتصالات', 'البناء والمشاريع الكبرى', 'التجزئة', 'الخدمات المالية', 'السياحة والترفيه'],
  },

  AE: {
    code: 'AE',
    nameAr: 'الإمارات', nameEn: 'United Arab Emirates',
    currency: 'AED', currencyAr: 'درهم إماراتي',
    // Changed in January 2022. The most common factual error about this market.
    week: 'الإثنين إلى الجمعة (تغيّر الأسبوع الرسمي في ٢٠٢٢)',
    dialectAr:
      'تحدّثي بلهجة خليجية إماراتية مهنية مخففة، أو فصحى مبسطة إن كان المرشح غير خليجي — '
      + 'سوق العمل هنا شديد التنوّع والإنجليزية شائعة في الشركات. '
      + 'تجنّبي المفردات المصرية الصرفة.',
    normsAr: [
      'أغلب الوظائف تتطلب تأشيرة عمل برعاية الشركة؛ السؤال عن الوضع الحالي للتأشيرة روتيني.',
      'الفرق بين المناطق الحرة والبر الرئيسي يؤثر على العقد والتأشيرة، وقد يسأل المرشح عنه.',
      'الراتب يُناقش كحزمة شهرية شاملة بالدرهم: الأساسي + السكن + المواصلات، وأحيانًا تذاكر سفر سنوية.',
      'مكافأة نهاية الخدمة تُحسب على الراتب الأساسي فقط — نقطة يخطئ فيها كثيرون.',
      'الأسبوع الرسمي من الإثنين إلى الجمعة منذ ٢٠٢٢، ويوم الجمعة نصف يوم في الجهات الحكومية.',
      'التوطين مطلوب بنسب محددة في شركات القطاع الخاص الكبيرة.',
    ],
    normsEn: [
      'Most roles require company-sponsored work visas; current visa status is a routine question.',
      'Free zone versus mainland changes the contract and the visa, and candidates do ask.',
      'Salary is an all-inclusive monthly package in AED: basic + housing + transport, sometimes annual flights.',
      'End-of-service gratuity is calculated on BASIC salary only — a very common misunderstanding.',
      'The working week has been Monday to Friday since 2022.',
    ],
    sectorsAr: ['الطيران والسياحة', 'العقارات والإنشاءات', 'الخدمات المالية', 'التقنية والشركات الناشئة', 'اللوجستيات والتجارة'],
  },

  KW: {
    code: 'KW',
    nameAr: 'الكويت', nameEn: 'Kuwait',
    currency: 'KWD', currencyAr: 'دينار كويتي',
    week: 'الأحد إلى الخميس',
    dialectAr:
      'تحدّثي بلهجة كويتية خليجية مهنية — «شلونك»، «وش تخصصك»، «عطني مثال». '
      + 'اخلطيها بالفصحى المبسطة، وتجنّبي المفردات المصرية.',
    normsAr: [
      'الدينار الكويتي عملة عالية القيمة: الرواتب أرقام صغيرة نسبيًا، فلا تستغربي رقمًا مثل ٨٠٠ أو ١٢٠٠.',
      'للمقيمين: نوع الإقامة (المادة ١٨ للقطاع الخاص) وإمكانية التحويل من أول ما يُسأل عنه.',
      'التكويت يزيد أفضلية المرشح الكويتي في بعض القطاعات، خصوصًا الحكومي والمصرفي.',
      'القطاع النفطي والحكومي هما الأكثر جذبًا، والقطاع الخاص أصغر نسبيًا.',
    ],
    normsEn: [
      'The Kuwaiti dinar is high-value: monthly salaries are small numbers (800, 1200) and that is normal.',
      'For expatriates, residency type (Article 18) and transferability are asked early.',
      'Kuwaitisation favours nationals in parts of the public and banking sectors.',
    ],
    sectorsAr: ['النفط والغاز', 'القطاع المصرفي', 'المقاولات', 'التجزئة', 'القطاع الحكومي'],
  },

  QA: {
    code: 'QA',
    nameAr: 'قطر', nameEn: 'Qatar',
    currency: 'QAR', currencyAr: 'ريال قطري',
    week: 'الأحد إلى الخميس',
    dialectAr:
      'تحدّثي بلهجة خليجية قطرية مهنية مخففة أو فصحى مبسطة — بيئة العمل شديدة التنوّع. '
      + 'تجنّبي المفردات المصرية الصرفة.',
    normsAr: [
      'أُلغي نظام الكفالة التقليدي وصار بإمكان الموظف تغيير العمل بشروط — معلومة يسأل عنها المرشحون كثيرًا.',
      'هناك حد أدنى للأجور مطبّق على جميع العاملين.',
      'الراتب حزمة شهرية بالريال القطري تشمل السكن والمواصلات غالبًا.',
      'مشاريع البنية التحتية والطاقة والرياضة هي المحرّك الأكبر للتوظيف.',
    ],
    normsEn: [
      'The traditional kafala system has been reformed; changing employer is possible under conditions.',
      'A statutory minimum wage applies to all workers.',
      'Salary is a monthly QAR package usually including housing and transport.',
    ],
    sectorsAr: ['الطاقة والغاز', 'البنية التحتية', 'الضيافة والرياضة', 'الخدمات المالية', 'التعليم'],
  },

  BH: {
    code: 'BH',
    nameAr: 'البحرين', nameEn: 'Bahrain',
    currency: 'BHD', currencyAr: 'دينار بحريني',
    week: 'الأحد إلى الخميس',
    dialectAr: 'تحدّثي بلهجة خليجية بحرينية مهنية أو فصحى مبسطة. تجنّبي المفردات المصرية.',
    normsAr: [
      'الدينار البحريني عملة عالية القيمة، فالرواتب أرقام صغيرة نسبيًا.',
      'هيئة تنظيم سوق العمل (LMRA) تنظّم تصاريح العمل، وتغيير صاحب العمل ممكن.',
      'البحرنة مطلوبة بنسب في القطاع الخاص.',
      'القطاع المالي والمصرفي هو الأبرز، والبحرين مركز مالي إقليمي.',
    ],
    normsEn: [
      'The dinar is high-value, so monthly salary figures are small numbers.',
      'LMRA governs work permits and employer transfer is possible.',
      'Bahrainisation quotas apply in the private sector.',
    ],
    sectorsAr: ['الخدمات المالية والمصرفية', 'الصناعة', 'اللوجستيات', 'التقنية'],
  },

  OM: {
    code: 'OM',
    nameAr: 'عُمان', nameEn: 'Oman',
    currency: 'OMR', currencyAr: 'ريال عُماني',
    week: 'الأحد إلى الخميس',
    dialectAr: 'تحدّثي بلهجة عُمانية خليجية مهنية أو فصحى مبسطة. تجنّبي المفردات المصرية.',
    normsAr: [
      'التعمين سياسة أساسية، ونسب التوظيف المحلي محددة في كثير من القطاعات.',
      'الريال العُماني عملة عالية القيمة، فالرواتب أرقام صغيرة نسبيًا.',
      'رؤية عُمان ٢٠٤٠ توجّه التوظيف نحو اللوجستيات والسياحة والتصنيع.',
    ],
    normsEn: [
      'Omanisation sets local-hiring quotas across many sectors.',
      'The rial is high-value, so salary figures are small numbers.',
    ],
    sectorsAr: ['النفط والغاز', 'اللوجستيات والموانئ', 'السياحة', 'التعدين', 'القطاع الحكومي'],
  },

  JO: {
    code: 'JO',
    nameAr: 'الأردن', nameEn: 'Jordan',
    currency: 'JOD', currencyAr: 'دينار أردني',
    week: 'الأحد إلى الخميس',
    dialectAr:
      'تحدّثي باللهجة الشامية الأردنية المهنية — «كيفك»، «شو خبرتك»، «بتقدر تحكيلي». '
      + 'تجنّبي المفردات المصرية والخليجية.',
    normsAr: [
      'الأردن مصدّر كبير للكفاءات التقنية للخليج، وكثير من المرشحين يستهدفون فرصًا خارجية.',
      'الراتب شهري بالدينار الأردني، والضمان الاجتماعي إلزامي.',
      'قطاع تقنية المعلومات والخدمات الطبية من أقوى القطاعات.',
    ],
    normsEn: [
      'Jordan exports a lot of technical talent to the Gulf; many candidates target roles abroad.',
      'Salary is monthly in JOD and social security is mandatory.',
    ],
    sectorsAr: ['تقنية المعلومات', 'الخدمات الطبية', 'التعليم', 'الصيدلة', 'الخدمات المالية'],
  },
};

/** Shown to the client so the picker never drifts from the table. */
export const MARKET_CODES = Object.keys(MARKETS);

/** The market assumed when the client sends nothing. */
export const DEFAULT_MARKET = 'EG';

/** @returns {Market|null} */
export function market(code) {
  if (!code) return null;
  return MARKETS[String(code).toUpperCase()] || null;
}

/**
 * The interviewer's speaking instruction for a market.
 *
 * Separate from the norms block because it belongs in the PERSONA half of the
 * meeting prompt — how she talks is stable for the whole call, where the norms
 * are reference material she draws on when relevant.
 */
export function dialectDirective(code, language = 'ar') {
  const m = market(code);
  if (language !== 'ar') {
    // In English the register is the same everywhere; only the market facts
    // differ, and those are carried by the norms block.
    return m
      ? `The candidate is interviewing in the ${m.nameEn} market. Use neutral professional English.`
      : '';
  }
  if (!m) return '';
  return `اللهجة: ${m.dialectAr}`;
}

/**
 * Compact market briefing for a prompt.
 *
 * Deliberately short. A long block would push the transcript out of the
 * context window on a 30-minute interview, and the model needs the facts it
 * would actually use in a question, not an encyclopaedia entry.
 *
 * @param {string} code
 * @param {'ar'|'en'} language
 * @param {{norms?: boolean, sectors?: boolean}} [opts]
 */
export function marketBlock(code, language = 'ar', opts = {}) {
  const m = market(code);
  if (!m) return '';
  const { norms = true, sectors = true } = opts;
  const ar = language === 'ar';

  const lines = [];
  if (ar) {
    lines.push(`سوق العمل: ${m.nameAr}. العملة: ${m.currencyAr} (${m.currency}). أسبوع العمل: ${m.week}.`);
    if (norms && m.normsAr.length) {
      lines.push('حقائق عن هذا السوق تستخدمينها عند الحاجة فقط:');
      lines.push(...m.normsAr.map((n) => `- ${n}`));
    }
    if (sectors && m.sectorsAr.length) {
      lines.push(`القطاعات الأكثر توظيفًا: ${m.sectorsAr.join('، ')}.`);
    }
  } else {
    lines.push(`Job market: ${m.nameEn}. Currency: ${m.currency}. Working week: ${m.week}.`);
    if (norms && m.normsEn.length) {
      lines.push('Facts about this market, to use only where relevant:');
      lines.push(...m.normsEn.map((n) => `- ${n}`));
    }
  }
  return lines.join('\n');
}

/**
 * The fairness rule that must travel with every market block.
 *
 * Market context exists to make the QUESTIONS realistic. The moment it starts
 * informing the SCORE, the product is penalising people for where they live —
 * so this is stated explicitly rather than left to the model's judgement.
 */
export function marketFairnessRule(language = 'ar') {
  return language === 'ar'
    ? 'سياق السوق يُستخدم لجعل الأسئلة واقعية فقط. لا تبنِ عليه أي حكم على المرشح: '
      + 'لا تفضّلي جنسية على أخرى، ولا تخفضي درجة أحد بسبب بلده أو لهجته أو وضع إقامته.'
    : 'Market context is for making the QUESTIONS realistic only. Never let it influence the score: '
      + 'do not favour any nationality, and never mark a candidate down for their country, dialect, or residency status.';
}
