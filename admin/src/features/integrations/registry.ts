/**
 * Arabic copy for each credential, and how the two integration pages are laid
 * out. The backend owns the authoritative list, types and secrecy
 * (backend/src/services/secrets/registry.js); this file only describes them.
 *
 * A key the backend returns but this file does not describe still renders —
 * with its raw name — rather than disappearing. A credential silently missing
 * from an admin page is how a live payment key goes unnoticed.
 *
 * EASYKASH_MOCK is absent from both registries and must stay absent: it makes
 * the app simulate successful payments and grant premium for free, so it is an
 * env-file switch that no admin session can flip.
 */

import type { CredentialGroup } from './api';

export interface CredentialCopy {
  labelAr: string;
  help: string;
  /** Extra warning shown inside the edit drawer. */
  caution?: string;
  /** Where to obtain the value. */
  whereAr?: string;
}

export const CREDENTIAL_COPY: Record<string, CredentialCopy> = {
  /* ----------------------------- EasyKash ----------------------------- */
  EASYKASH_ENABLED: {
    labelAr: 'تفعيل بوابة الدفع',
    help: 'عند الإيقاف يرفض الخادم إنشاء أي عملية دفع جديدة.',
  },
  EASYKASH_BASE_URL: {
    labelAr: 'رابط الخادم الأساسي',
    help: 'عنوان واجهة EasyKash. القيمة المعتادة https://back.easykash.net — لا يقبل الخادم إلا نطاق easykash.net عبر https.',
    // The restriction is enforced on the server (secrets/registry.js); this
    // says why, so a rejected value reads as a rule and not as a bug.
    caution:
      'مفتاح الواجهة يُرسَل إلى هذا العنوان مع كل عملية دفع، لذلك يرفض الخادم أي نطاق آخر — وإلا لأمكن توجيه المفتاح إلى جهة خارجية.',
  },
  EASYKASH_PAY_PATH: {
    labelAr: 'مسار إنشاء الدفع',
    help: 'المسار الذي يُنشئ صفحة الدفع. القيمة المعتادة /api/directpayv1/pay',
  },
  EASYKASH_API_KEY: {
    labelAr: 'مفتاح الواجهة (API Key)',
    help: 'يُرسل في ترويسة Authorization عند إنشاء كل عملية دفع.',
    whereAr: 'لوحة تاجر EasyKash ← الإعدادات ← مفاتيح الواجهة',
    caution: 'تغيير هذا المفتاح يؤثر فورًا على كل عمليات الدفع الجديدة.',
  },
  EASYKASH_WEBHOOK_SECRET: {
    labelAr: 'سرّ التحقق من الإشعارات (Webhook)',
    help: 'يُستخدم للتحقق من توقيع الإشعارات الواردة. بدونه يرفض الخادم كل إشعار في وضع الإنتاج.',
    whereAr: 'لوحة تاجر EasyKash ← إعدادات الـ Webhook',
    caution: 'لا يمكن التحقق من هذا السر تلقائيًا — يظهر أثره على أول إشعار حقيقي.',
  },
  EASYKASH_SIGNATURE_HEADER: {
    labelAr: 'ترويسة التوقيع',
    help: 'اسم الترويسة التي يحمل فيها الإشعار توقيعه. إن تُركت، يُبحث عن التوقيع داخل جسم الطلب.',
  },
  EASYKASH_SIGNATURE_ALGO: {
    labelAr: 'خوارزمية التوقيع',
    help: 'الخوارزمية المستخدمة في حساب HMAC للتحقق من الإشعارات.',
  },
  EASYKASH_SIGNATURE_FIELDS: {
    labelAr: 'حقول التوقيع (بالترتيب)',
    help: 'أسماء الحقول التي تُدمج بالترتيب لبناء نص التوقيع، مفصولة بفواصل. الترتيب مهم.',
  },
  EASYKASH_PAYMENT_OPTIONS: {
    labelAr: 'وسائل الدفع المعروضة',
    help: 'الوسائل التي تظهر للعميل على صفحة الدفع، مفصولة بفواصل. مثال: CARD,FAWRY,WALLET',
  },

  /* -------------------------------- AI -------------------------------- */
  AI_ENABLED: {
    labelAr: 'تفعيل الذكاء الاصطناعي',
    help: 'عند الإيقاف يفشل تقييم الإجابات والمقابلات بدلًا من إعطاء درجة غير حقيقية.',
  },
  AI_PROVIDER: {
    labelAr: 'المزوّد المفضّل',
    help: 'المزوّد الذي يُجرَّب أولًا. إن لم يكن مهيّأً ينتقل الخادم تلقائيًا لأي مزوّد آخر مهيّأ.',
  },
  CLAUDE_MODEL: {
    labelAr: 'نموذج Claude',
    help: 'النموذج المستخدم عند اختيار Claude. يؤثر مباشرة على التكلفة وجودة التقييم بالعربية.',
  },
  AI_MODEL: {
    labelAr: 'نموذج Gemini / Groq',
    help: 'النموذج المستخدم مع Gemini أو Groq. إن تُرك فارغًا يُستخدم النموذج الافتراضي لكل مزوّد.',
  },
  ANTHROPIC_API_KEY: {
    labelAr: 'مفتاح Anthropic',
    help: 'مفتاح Claude — المزوّد الأساسي لتقييم الإجابات، وعقل المقابلة الصوتية. '
      + 'بدونه تعمل المقابلة المكتوبة عبر مزوّد احتياطي، أما المقابلة الصوتية فلا تعمل إطلاقًا.',
    whereAr: 'console.anthropic.com ← API Keys',
  },
  DEEPGRAM_API_KEY: {
    labelAr: 'مفتاح Deepgram',
    help: 'يشغّل المقابلة الصوتية الحيّة: يسمع المتحدّث ويدير دوره في الحوار. '
      + 'بدونه تعمل المقابلة المكتوبة كالمعتاد ولا يُعرض الصوت أصلًا.',
    whereAr: 'console.deepgram.com ← API Keys',
  },
  VOICE_LLM_MODEL: {
    labelAr: 'نموذج المقابلة الصوتية',
    help: 'نموذج Claude المستخدم في الحوار المنطوق وحده. هذا الرقم هو الصمت الذي يسمعه '
      + 'المرشّح بعد كل إجابة: claude-haiku-5-5 يصل لأول كلمة في 1.27 ثانية، و claude-opus-5-5 '
      + 'في 2.28. إن تُرك فارغًا يُستخدم «نموذج Claude» نفسه.',
  },
  VOICE_SPEAK_MODEL: {
    labelAr: 'صوت المقابلة الإنجليزية',
    help: 'صوت Deepgram المستخدم في المقابلات بالإنجليزية. إن تُرك فارغًا يُستخدم flux-kit-en. '
      + 'لا يمسّ العربية: صوتها مجاني ويأتي من الخادم نفسه، فلا شيء هنا يضبطه.',
  },
  JOBS_INGEST_ENABLED: {
    labelAr: 'تحديث الوظائف تلقائيًا',
    help: 'عند التشغيل يجلب الخادم الوظائف الجديدة من كل المصادر كل بضع دقائق. الإيقاف يجمّد الفهرس كما هو.',
  },
  JSEARCH_API_KEY: {
    labelAr: 'مفتاح JSearch (Google for Jobs)',
    help: 'يضيف للبحث وظائف LinkedIn و Indeed و Glassdoor ومواقع الشركات في كل الدول، عبر Google for Jobs بطريقة قانونية. يُستخدم عند البحث فقط لأنه مدفوع بالطلب.',
    whereAr: 'rapidapi.com ← JSearch (OpenWeb Ninja) ← Subscribe ← X-RapidAPI-Key',
  },
  JSEARCH_API_HOST: {
    labelAr: 'عنوان خادم JSearch',
    help: 'اتركه فارغًا ليُستخدم jsearch.p.rapidapi.com.',
  },
  ADZUNA_APP_ID: {
    labelAr: 'Adzuna — App ID',
    help: 'يضيف وظائف 19 دولة منها بريطانيا وألمانيا وسويسرا وأمريكا والهند وسنغافورة، مع بيانات الرواتب.',
    whereAr: 'developer.adzuna.com ← Register ← Dashboard',
  },
  ADZUNA_APP_KEY: {
    labelAr: 'Adzuna — App Key',
    help: 'المفتاح المرافق لـ App ID.',
    whereAr: 'developer.adzuna.com ← Dashboard',
  },
  JOOBLE_API_KEY: {
    labelAr: 'مفتاح Jooble',
    help: 'محرك بحث وظائف في نحو 70 دولة منها الخليج ومصر وشمال أفريقيا. يُسأل لحظيًا عند كل بحث. المفتاح مجاني.',
    whereAr: 'jooble.org/api/about ← Get API key',
  },
  GOOGLE_OAUTH_CLIENT_ID: {
    labelAr: 'Google OAuth — Client ID',
    help: 'معرّف عميل OAuth من نوع «Web application» المستخدم لربط تقويم Google ومهامه. '
      + 'اتركه فارغًا ليُستخدم معرّف تسجيل الدخول بجوجل للويب نفسه.',
    whereAr: 'console.cloud.google.com ← APIs & Services ← Credentials ← OAuth 2.0 Client IDs',
  },
  GOOGLE_OAUTH_CLIENT_SECRET: {
    labelAr: 'Google OAuth — Client Secret',
    help: 'السرّ المرافق للمعرّف أعلاه. بدونه يبقى ربط التقويم مخفيًا في التطبيق.',
    whereAr: 'console.cloud.google.com ← Credentials ← العميل نفسه ← Client secrets',
    caution: 'يجب أن يحتوي العميل على عنوان التحويل https://interprova.com/api/calendar/google/callback '
      + 'ضمن Authorized redirect URIs، وإلا ترفض Google الربط.',
  },
  GEMINI_API_KEY: {
    labelAr: 'مفتاح Google Gemini',
    help: 'مزوّد احتياطي يُستخدم عند تعذّر المزوّد المفضّل.',
    whereAr: 'aistudio.google.com ← API Keys',
  },
  GROQ_API_KEY: {
    labelAr: 'مفتاح Groq',
    help: 'مزوّد احتياطي سريع ومنخفض التكلفة.',
    whereAr: 'console.groq.com ← API Keys',
  },

  /* ---------------------------- الإشعارات ---------------------------- */
  FIREBASE_SERVICE_ACCOUNT_B64: {
    labelAr: 'حساب خدمة Firebase (ملف JSON بصيغة Base64)',
    help:
      'به يوقّع الخادم طلباته إلى Firebase Cloud Messaging. بدونه لا يصل أي إشعار إلى أي جهاز — '
      + 'لا البث اليدوي ولا الإشعارات التلقائية، وهذه الأخيرة تفشل بصمت لأن أحدًا لم يطلبها ليلاحظ غيابها.',
    whereAr:
      'Firebase Console ← اعدادات المشروع ← حسابات الخدمة ← إنشاء مفتاح خاص جديد، ثم حوّل ملف JSON إلى Base64 والصق الناتج هنا',
    caution:
      'هذا المفتاح يسمح بإرسال إشعار إلى كل جهاز مثبّت عليه التطبيق، وما يُرسَل لا يمكن سحبه. لا ترسله في '
      + 'محادثة ولا تضعه في مستودع كود؛ وإن تسرّب فألغِ المفتاح من Firebase فورًا ثم اضبط مفتاحًا جديدًا هنا.',
  },
  PUSH_ENABLED: {
    labelAr: 'تفعيل الإشعارات',
    help:
      'عند الإيقاف يرفض الخادم كل إرسال — البث اليدوي والإشعارات التلقائية معًا (انخفاض الرصيد، '
      + 'جاهزية التقييم، التذكير بالتجربة). تبقى الأجهزة مسجّلة ويعود الإرسال فور إعادة التفعيل.',
    caution:
      'هذا إيقاف عام وليس إيقافًا لنوع واحد. لإسكات إشعار تلقائي بعينه استخدم مفتاحه في صفحة الإعدادات '
      + 'بدلًا من إيقاف الإشعارات كلّها.',
  },
};

export interface CredentialSection {
  id: string;
  labelAr: string;
  description: string;
  keys: string[];
}

export interface IntegrationPageSpec {
  /** Sourced from api.ts so a group added on the server cannot be typed here
   *  as a string the credential list will never match. */
  group: CredentialGroup;
  titleAr: string;
  descriptionAr: string;
  sections: CredentialSection[];
  /** Shown once at the top of the page. */
  noteAr?: string;
}

export const PAYMENTS_PAGE: IntegrationPageSpec = {
  group: 'payments',
  titleAr: 'تكامل الدفع — EasyKash',
  descriptionAr: 'بيانات اعتماد بوابة الدفع والإعدادات التي يقرأها الخادم عند كل عملية.',
  noteAr:
    'الأسرار تُخزَّن مشفّرة ولا تُعاد أبدًا من الخادم. ما تراه هنا هو آخر أربعة أحرف فقط، وهو ما يكفي للتأكد من المفتاح المُثبَّت.',
  sections: [
    {
      id: 'credentials',
      labelAr: 'بيانات الاعتماد',
      description: 'قيم سرّية. تُكتب ولا تُقرأ.',
      keys: ['EASYKASH_API_KEY', 'EASYKASH_WEBHOOK_SECRET'],
    },
    {
      id: 'connection',
      labelAr: 'الاتصال',
      description: 'عناوين الواجهة وحالة التفعيل.',
      keys: ['EASYKASH_ENABLED', 'EASYKASH_BASE_URL', 'EASYKASH_PAY_PATH', 'EASYKASH_PAYMENT_OPTIONS'],
    },
    {
      id: 'signature',
      labelAr: 'التحقق من الإشعارات',
      description: 'كيف يتحقق الخادم من أن الإشعار قادم فعلًا من EasyKash.',
      keys: ['EASYKASH_SIGNATURE_HEADER', 'EASYKASH_SIGNATURE_ALGO', 'EASYKASH_SIGNATURE_FIELDS'],
    },
  ],
};

export const AI_PAGE: IntegrationPageSpec = {
  group: 'ai',
  titleAr: 'تكامل الذكاء الاصطناعي',
  descriptionAr: 'مفاتيح المزوّدين والنماذج المستخدمة في تقييم الإجابات والمقابلات.',
  noteAr:
    'الأسرار تُخزَّن مشفّرة ولا تُعاد أبدًا من الخادم. يمكن اختبار كل مفتاح قبل حفظه دون أن يظهر في أي رد.',
  sections: [
    {
      id: 'keys',
      labelAr: 'مفاتيح المزوّدين',
      description: 'مفتاح واحد على الأقل مطلوب لتشغيل التقييم.',
      keys: ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY'],
    },
    {
      id: 'routing',
      labelAr: 'الاختيار والنماذج',
      description: 'أي مزوّد يُجرَّب أولًا، وبأي نموذج.',
      keys: ['AI_ENABLED', 'AI_PROVIDER', 'CLAUDE_MODEL', 'AI_MODEL'],
    },
    {
      id: 'voice',
      labelAr: 'المقابلة الصوتية',
      description:
        'المقابلة المنطوقة تحتاج مفتاحين: Deepgram ليسمع، و Anthropic أعلاه ليفكّر. '
        + 'الصوت العربي مجاني ولا يحتاج شيئًا. وبدون أيٍّ منهما ترجع المقابلة مكتوبة بدل أن تتعطّل.',
      keys: ['DEEPGRAM_API_KEY', 'VOICE_LLM_MODEL', 'VOICE_SPEAK_MODEL'],
    },
    {
      id: 'jobs',
      labelAr: 'مصادر الوظائف',
      description:
        'كل بحث يُرسَل لحظيًا إلى Himalayas و Jobicy و Remote OK دون مفاتيح، مع فهرس لوحات الشركات الذي يتحدّث كل بضع دقائق. '
        + 'مفتاح JSearch يضيف وظائف LinkedIn و Indeed و Glassdoor عبر Google for Jobs، و Adzuna يضيف 19 دولة، و Jooble يضيف الخليج ومصر و70 دولة.',
      keys: ['JOBS_INGEST_ENABLED', 'JSEARCH_API_KEY', 'JSEARCH_API_HOST', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'JOOBLE_API_KEY'],
    },
    {
      id: 'calendar',
      labelAr: 'تقويم Google و Meet والمهام',
      description:
        'يتيح للمستخدم ربط تقويم Google لعرض مقابلاته وجدولة مقابلة برابط Meet وإضافة مهام التحضير. '
        + 'ملف ‎.ics يعمل دائمًا بدون أي مفتاح.',
      keys: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET'],
    },
  ],
};

export const PUSH_PAGE: IntegrationPageSpec = {
  group: 'push',
  titleAr: 'تكامل الإشعارات — Firebase',
  descriptionAr: 'مفتاح إرسال الإشعارات إلى الأجهزة، ومفتاح إيقاف الإرسال كلّه.',
  noteAr:
    'الأسرار تُخزَّن مشفّرة ولا تُعاد أبدًا من الخادم. ما يُضبط هنا يسري على الإشعارات اليدوية '
    + 'والتلقائية معًا؛ ولمتابعة ما أُرسل فعليًا وإلى كم جهاز، افتح صفحة «الإشعارات».',
  sections: [
    {
      id: 'credentials',
      labelAr: 'بيانات الاعتماد',
      description: 'قيمة سرّية. تُكتب ولا تُقرأ.',
      keys: ['FIREBASE_SERVICE_ACCOUNT_B64'],
    },
    {
      id: 'delivery',
      labelAr: 'الإرسال',
      description: 'مفتاح إيقاف عام يسبق أي إرسال.',
      keys: ['PUSH_ENABLED'],
    },
  ],
};

export function copyFor(key: string): CredentialCopy {
  return CREDENTIAL_COPY[key] ?? { labelAr: key, help: 'مفتاح غير موصوف في هذه اللوحة.' };
}
