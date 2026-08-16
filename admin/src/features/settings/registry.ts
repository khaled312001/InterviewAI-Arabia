/**
 * The static settings registry.
 *
 * The page renders THIS, not whatever GET /admin/settings happens to return.
 * That is the fix for two failures of the old page: on an unseeded database it
 * could only render keys that already existed, so it sat on "جاري التحميل..."
 * forever with no way to add one; and every key was an unlabelled raw string.
 *
 * `effect` is the honesty flag. `live` means backend/src/services/appSettings.js
 * reads the key at runtime. `not-wired` means the value is persisted and
 * nothing consumes it — the page says so on the row instead of showing
 * "تم الحفظ" for a change with no effect. The live list is also returned by the
 * API (`wired`), and the page trusts the server over this file, so the two
 * cannot drift.
 */

export type SettingType = 'int' | 'text' | 'multiline';

export interface SettingDef {
  key: string;
  labelAr: string;
  help: string;
  type: SettingType;
  /** Shown as the field's placeholder when no row exists yet. */
  defaultValue: string;
  effect: 'live' | 'not-wired';
  /** For `not-wired`: what actually controls this today. */
  effectNote?: string;
  min?: number;
  max?: number;
}

export interface SettingGroup {
  id: string;
  labelAr: string;
  description: string;
  settings: SettingDef[];
}

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: 'trial',
    labelAr: 'التجربة المجانية',
    description: 'ما يحصل عليه الحساب الجديد مجانًا، مرة واحدة.',
    settings: [
      {
        key: 'free_trial_seconds',
        labelAr: 'مدة التجربة المجانية (بالثواني)',
        help: 'تُمنح مرة واحدة لكل حساب، عند أول قراءة للرصيد أو أول مقابلة — لا عند التسجيل. ٦٠٠ ثانية = ١٠ دقائق. اضبطها على صفر لإيقاف التجربة فورًا: هذا هو مفتاح الإيقاف الوحيد إذا بدأ استغلال الحسابات الجديدة، ولا يحتاج نشر إصدار جديد.',
        type: 'int',
        defaultValue: '600',
        effect: 'live',
        min: 0,
        max: 86400,
      },
    ],
  },
  {
    id: 'metering',
    labelAr: 'حساب وقت المقابلة',
    description:
      'كيف يُحتسب وقت المقابلة على رصيد المستخدم. كل القيم بالثواني — الرصيد نفسه مخزَّن بالثواني، والدقائق وحدة عرض فقط.',
    settings: [
      {
        key: 'meeting_tick_seconds',
        labelAr: 'فاصل نبضة العدّاد',
        help: 'كل كم ثانية يبلّغ التطبيق الخادم بأن المقابلة ما زالت جارية. تقليله يزيد دقة الاحتساب ويزيد عدد الطلبات.',
        type: 'int',
        defaultValue: '15',
        effect: 'live',
        min: 5,
        max: 120,
      },
      {
        key: 'meeting_max_gap_seconds',
        labelAr: 'أقصى فجوة تُحتسب',
        help: 'أي انقطاع بين نبضتين أطول من هذه المدة لا يُحتسب على المستخدم إطلاقًا (وليس مقصوصًا عندها). المنطق: إذا لم تصل نبضة فلم يصل سؤال أيضًا، فلم نُنفق شيئًا — واحتساب صمتنا على العميل هو أسرع طريق لفقدان ثقته.',
        type: 'int',
        defaultValue: '40',
        effect: 'live',
        min: 20,
        max: 600,
      },
      {
        key: 'meeting_turn_gap_seconds',
        labelAr: 'أقصى فجوة تُحتسب بين سؤالين (عملاء بلا نبضات)',
        help: 'يخصّ النسخ القديمة من التطبيق التي لا ترسل نبضات. قاعدة «أقصى فجوة» أعلاه لا تصلح لها: عميل لم يَعِد بنبضة أصلًا لا يدل غيابها على أنه صامت، وتصفير كل فجوة جعل مقابلة مدتها ٣٠ دقيقة تُحتسب كخمسة عشر حدًّا أدنى فقط. المدة بين سؤالين تُحتسب هنا بحدّ أقصى — لأن التوقف الطويل بين تبادلين ليس تكلفة علينا.',
        type: 'int',
        defaultValue: '120',
        effect: 'live',
        min: 30,
        max: 900,
      },
      {
        key: 'meeting_min_turn_seconds',
        labelAr: 'الحد الأدنى لكل سؤال',
        help: 'أقل مدة تُحتسب لكل تبادل مع المُحاور. لا تؤثر على مستخدم يرسل النبضات بشكل طبيعي — وجودها يمنع التحايل بإيقاف النبضات واعتبار كل فترة «فجوة» غير محسوبة.',
        type: 'int',
        defaultValue: '30',
        effect: 'live',
        min: 0,
        max: 300,
      },
      {
        key: 'meeting_min_start_seconds',
        labelAr: 'أقل رصيد لبدء مقابلة',
        help: 'يُرفض بدء المقابلة إذا كان المتاح أقل من هذا. مقابلة تنقطع بعد ثوانٍ أسوأ من مقابلة لم تبدأ.',
        type: 'int',
        defaultValue: '60',
        effect: 'live',
        min: 0,
        max: 3600,
      },
      {
        key: 'meeting_low_water_seconds',
        labelAr: 'حد التنبيه قبل النفاد',
        help: 'عند هبوط الرصيد تحت هذا الحد يظهر تنبيه دائم داخل المقابلة مع زر شراء، دون قطع المكالمة.',
        type: 'int',
        defaultValue: '120',
        effect: 'live',
        min: 0,
        max: 3600,
      },
      {
        key: 'meeting_hold_seconds',
        labelAr: 'حجم الحجز لكل مقابلة',
        help: 'الرصيد المحجوز مؤقتًا عند بدء المقابلة. الحجز ليس خصمًا — يمنع جهازين من إنفاق نفس الدقيقة مرتين، ويُسوّى عند انتهاء المقابلة.',
        type: 'int',
        defaultValue: '300',
        effect: 'live',
        min: 60,
        max: 3600,
      },
      {
        key: 'meeting_abandon_seconds',
        labelAr: 'مهلة اعتبار المقابلة مهجورة',
        help: 'مقابلة جارية لم تصل منها نبضة خلال هذه المدة تُغلق تلقائيًا: يُحتسب ما مضى فقط، ويُفرج عن الحجز. بدون هذا يظل رصيد المستخدم محجوزًا بعد إغلاق التطبيق.',
        type: 'int',
        defaultValue: '120',
        effect: 'live',
        min: 30,
        max: 3600,
      },
    ],
  },
  {
    id: 'flat-charges',
    labelAr: 'الرسوم الثابتة',
    description: 'خصومات ثابتة لا علاقة لها بمدة المقابلة. المشتركون معفَون منها.',
    settings: [
      {
        key: 'cv_prepare_seconds',
        labelAr: 'تحليل السيرة الذاتية',
        help: 'يُخصم قبل استدعاء النموذج، وهو أغلى طلب منفرد في المنتج.',
        type: 'int',
        defaultValue: '60',
        effect: 'live',
        min: 0,
        max: 3600,
      },
      {
        key: 'practice_answer_seconds',
        labelAr: 'إجابة تدريب مُقيَّمة',
        help: 'يُخصم عن كل إجابة تدريب تُقيَّم بالذكاء الاصطناعي. صفر يجعل التدريب مجانيًا بلا حد لكل حساب مسجَّل.',
        type: 'int',
        defaultValue: '30',
        effect: 'live',
        min: 0,
        max: 3600,
      },
      {
        key: 'subscription_cycle_seconds',
        labelAr: 'رصيد دورة الاشتراك',
        help: 'ما يُمنح للمشترك كل ٣٠ يومًا. ١٨٠٠٠ ثانية = ٣٠٠ دقيقة. لا يُرحَّل المتبقي إلى الدورة التالية. رفع الرقم عرض ترويجي، وخفضه سبب لإلغاء الاشتراك — فابدأ منخفضًا.',
        type: 'int',
        defaultValue: '18000',
        effect: 'live',
        min: 0,
        max: 1000000,
      },
    ],
  },
  {
    id: 'quota',
    labelAr: 'الحد اليومي القديم',
    description: 'أُلغي هذا النظام واستُبدل برصيد الدقائق. يظهر هنا للاطّلاع فقط.',
    settings: [
      {
        key: 'free_daily_question_limit',
        labelAr: 'الحد اليومي المجاني (عدد الأسئلة)',
        help: 'كان يحدد عدد الأسئلة المسموحة يوميًا للمستخدم المجاني. لم يعد أي جزء من الخادم يقرأه بعد استبدال الحصة اليومية برصيد الدقائق.',
        type: 'int',
        defaultValue: '0',
        effect: 'not-wired',
        effectNote:
          'متوقف: حلّ محلّه «مدة التجربة المجانية» ورصيد الدقائق. تغيير هذه القيمة لا يؤثر على أي شيء.',
        min: 0,
        max: 1000,
      },
    ],
  },
  {
    id: 'pricing',
    labelAr: 'التسعير',
    description: 'قيمة معروضة فقط — الأسعار الفعلية في كتالوج الباقات.',
    settings: [
      {
        key: 'subscription_monthly_price_egp',
        labelAr: 'سعر الاشتراك الشهري (جنيه)',
        help: 'قيمة معروضة فقط.',
        type: 'int',
        defaultValue: '150',
        effect: 'not-wired',
        effectNote:
          'السعر الفعلي للدفع محدد في backend/src/services/payments/plans.js ويظهر في بطاقة «الباقات والأسعار» في صفحتَي الاشتراكات والمدفوعات — تغييره هنا لا يغيّر ما يُحصَّل من العميل.',
      },
      // `subscription_yearly_price_egp` was here. The yearly plan is retired, so
      // the field described a price for a product that cannot be bought. If a
      // row for it still exists in app_settings it now surfaces read-only under
      // "مفاتيح غير معروفة", which is the honest place for a value nothing owns.
    ],
  },
  {
    id: 'messaging',
    labelAr: 'الرسائل',
    description: 'نصوص تُستخدم في إشعارات الترحيب.',
    settings: [
      {
        key: 'push_welcome_ar',
        labelAr: 'رسالة ترحيب (عربي)',
        help: 'نص الإشعار الترحيبي للمستخدم الجديد.',
        type: 'multiline',
        defaultValue: 'أهلًا بك في ثقتي! ابدأ أول مقابلة تدريبية الآن.',
        effect: 'not-wired',
        effectNote: 'لا يوجد مُرسِل إشعارات في الخادم بعد، فلا جهة تقرأ هذا النص.',
      },
      {
        key: 'push_welcome_en',
        labelAr: 'رسالة ترحيب (إنجليزي)',
        help: 'The welcome notification for a new user.',
        type: 'multiline',
        defaultValue: 'Welcome to Thiqty! Start your first practice interview.',
        effect: 'not-wired',
        effectNote: 'لا يوجد مُرسِل إشعارات في الخادم بعد، فلا جهة تقرأ هذا النص.',
      },
    ],
  },
];

export const ALL_SETTINGS: SettingDef[] = SETTING_GROUPS.flatMap((g) => g.settings);

const KNOWN = new Set(ALL_SETTINGS.map((s) => s.key));

export function isKnownSetting(key: string): boolean {
  return KNOWN.has(key);
}

/**
 * Validates one value against its definition.
 * @returns an Arabic error string, or null when the value is acceptable.
 */
export function validateSetting(def: SettingDef, value: string): string | null {
  const v = value.trim();
  if (!v) return 'لا يمكن ترك الحقل فارغًا';

  if (def.type === 'int') {
    if (!/^\d+$/.test(v)) return 'يجب إدخال رقم صحيح';
    const n = Number(v);
    if (def.min !== undefined && n < def.min) return `أقل قيمة مسموحة ${def.min}`;
    if (def.max !== undefined && n > def.max) return `أكبر قيمة مسموحة ${def.max}`;
  }

  if (v.length > 5000) return 'النص طويل جدًا';
  return null;
}
