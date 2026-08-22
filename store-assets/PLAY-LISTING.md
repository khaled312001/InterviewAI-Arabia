# Google Play Console — listing pack: Interprova

**Package:** `com.interprova.app` · **versionName** 1.0.0 · **versionCode** 1
**Default store listing language:** Arabic (ar) · **Second language:** English (United Kingdom / en-GB)
**Developer:** Barmagly · Cairo, Egypt · info@barmagly.tech

---

## This is a NEW app entry, not an update

`com.thiqty.app` and `com.interprova.app` are different applications to Google Play. The
package id is permanent from the first upload, so the rename means **Create app** in Play
Console — a new listing, a new review, a new set of assets — and the old ثقتي entry is left
alone (or unpublished once this one is live). Nothing carries over: not the review history,
not the testers, not the install base, not the versionCode. Hence versionCode 1.

The upload key is the same keystore (`interviewai-upload.jks`), which is fine — one key may
sign many apps.

---

## Why the previous submission was rejected, and what changed

> **Metadata policy** — *"your store listing can't contain claims about store performance,
> ranking, or awards (for example: 'Best,' '#1,' 'Top,' 'App of the Year')"*.
> Cited evidence: **Feature graphic (ar)**.

The feature graphic read **«ثقتي — أول مدرّب مقابلات عربي بالذكاء الاصطناعي»**. "أول" (*first*)
is a ranking claim, and it was not only on the graphic: the same sentence was the HTML
`<title>`, the OG tags, the sitemap image title, the web manifest description and the landing
footer. Fixing the picture alone would have been rejected again from the description.

Every one of them now reads a description instead of a claim:

| Where | Now |
|---|---|
| Feature graphic | `Interprova` + «تدريب على مقابلات العمل بالذكاء الاصطناعي — بالعربية والإنجليزية» |
| App title | `Interprova — تدريب المقابلات` |
| Short + full description | below — no superlative, no rank, no outcome promise |
| Landing `<title>` / OG / sitemap / manifest | same descriptive line |

**Rule for anyone editing this listing later:** no *أول / الأفضل / الأقوى / الوحيد / رقم ١*,
no *first / best / top / #1 / leading*, and no promise of an outcome ("تتوظّف", "get hired") —
an outcome you do not control is a misleading claim even when no ranking word appears. The
repository is swept for these strings; keep it that way.

---

# 1. Store listing — Arabic (ar) · DEFAULT

## 1.1 App name (max 30 characters)

> **`Interprova — تدريب المقابلات`** — 28 characters.

Counted as Unicode code points, which is how Play counts. `Interprova — تدريب مقابلات العمل`
reads better and carries the searched phrase "مقابلات العمل", but it is **32** and will be
rejected. `Interprova — مقابلات العمل` (26) is the fallback if you would rather keep "العمل"
than "تدريب".

## 1.2 Short description (max 80 characters)

> **`مقابلة عمل تدريبية بالفيديو مع محاوِر ذكاء اصطناعي، وتقييم فوري لكل إجابة.`** — 74 characters.

## 1.3 Full description (max 4000 characters)

```text
تدرّب على مقابلة العمل قبل أن تدخلها.

Interprova تطبيق تدريب على مقابلات العمل بالعربية والإنجليزية. تدخل مقابلة فيديو مباشرة مع محاوِر ذكاء اصطناعي يسألك بصوته، يستمع إلى إجابتك، ويكمل معك الحوار كما يفعل مسؤول التوظيف — ثم يعطيك تقييماً مكتوباً يشرح لك أين كنت قوياً وأين خسرت نقاطاً.

كيف تعمل المقابلة

١. اختر لغة المقابلة: العربية أو الإنجليزية. اللغة تحدّد الأسئلة وصوت المحاور والتقييم.
٢. اختر من يقابلك — سارة أو أحمد — ومجال الوظيفة.
٣. أضف اسم الشركة والمسمى الوظيفي ووصف الوظيفة إن أردت أسئلة أقرب لإعلان التوظيف. يمكنك رفع سيرتك الذاتية ليبني المحاور أسئلته على خبرتك الفعلية.
٤. ابدأ المكالمة. تتكلّم بصوتك، ويظهر كلامك نصاً أسفل الشاشة، وتُرسل إجابتك تلقائياً بعد لحظات من الصمت.
٥. أنهِ المقابلة واستلم تقييمك.

ما الذي تحصل عليه بعد المقابلة

— درجة من ١٠ مع سبب واضح لكل نقطة
— نقاط قوتك التي يجب أن تكرّرها في المقابلة الحقيقية
— المواضع التي أضعفت إجابتك، مكتوبة بصراحة
— اقتراحات عملية لصياغة أفضل للمرة القادمة
— نصائح لحظية أثناء المكالمة نفسها، تظهر قبل إجابتك التالية

المجالات

برمجة · محاسبة · تسويق · موارد بشرية · خدمة عملاء · مبيعات · تصميم

الوقت والرصيد

الحساب الجديد يبدأ بـ ١٠ دقائق مجانية، مرة واحدة. بعدها تشتري باقة دقائق أو تشترك شهرياً. الرصيد يُحسب بالثانية لا بالدقيقة، ولا يُخصم منك وقت لم تستخدمه، ورصيد الباقات لا ينتهي بتاريخ. شاشة "كشف حساب الدقائق" داخل التطبيق تعرض كل إضافة وكل خصم بالثانية، مع الرصيد بعد كل حركة، حتى تراجع الحساب بنفسك.

تسجيل الجلسة

يمكنك تسجيل المقابلة لمراجعتها لاحقاً. على أندرويد التسجيل بالفيديو فقط بدون صوت، لأن الميكروفون مشغول بالتعرّف على كلامك أثناء المكالمة، والملف يُسلَّم لك مباشرة عبر قائمة المشاركة.

عربي أولاً

واجهة عربية كاملة من اليمين إلى اليسار، وأسئلة وتقييمات مكتوبة بلغة مهنية سليمة، وصوت محاور بلهجة مصرية. تفضّل الإنجليزية؟ بدّل اللغة وقت ما تشاء.

خصوصيتك

لا إعلانات. لا أدوات تتبّع. لا نبيع بياناتك ولا نشاركها للتسويق. إجاباتك تُرسل إلى مزوّدي الذكاء الاصطناعي لغرض واحد هو إدارة المقابلة وتقييمها، وهذا موضّح بالتفصيل في سياسة الخصوصية. يمكنك حذف حسابك وبياناتك من داخل التطبيق في أي وقت.

للدعم أو الاستفسار: info@barmagly.tech
```

---

# 2. Store listing — English (en-GB)

## 2.1 App name (max 30 characters)

> **`Interprova: Interview Practice`** — 30 characters exactly.

## 2.2 Short description (max 80 characters)

> **`A live video mock interview with an AI interviewer, and instant feedback.`** — 73 characters.

## 2.3 Full description (max 4000 characters)

```text
Practise the interview before you sit it.

Interprova is job-interview practice in Arabic and English. You join a live video call with an AI interviewer who asks the questions out loud, listens to your answer, and follows up the way a real hiring manager does — then gives you written feedback explaining where you were strong and where you lost points.

How an interview works

1. Pick the language — Arabic or English. It sets the questions, the interviewer's voice, the speech recognition and the written evaluation.
2. Pick your interviewer, Sara or Ahmed, and your field.
3. Add the company, the job title and the job advert if you want questions closer to the real role. Upload your CV and the interviewer will build questions around your actual experience.
4. Start the call. You speak, your words appear as captions, and your answer is sent automatically after a moment of silence.
5. End the interview and collect your evaluation.

What you get afterwards

— A score out of 10, with the reasoning behind it
— The strengths worth repeating in the real interview
— Where your answer lost ground, said plainly
— Concrete suggestions for phrasing it better next time
— Live tips during the call itself, before your next answer

Fields

Programming · Accounting · Marketing · Human resources · Customer service · Sales · Design

Time and balance

A new account starts with 10 free minutes, once. After that you buy a minute pack or subscribe monthly. Time is metered in seconds rather than rounded-up minutes, you are never charged for time you did not use, and pack minutes do not expire. The in-app minute statement shows every credit and debit to the second, with the running balance, so you can audit it yourself.

Session recording

You can record the interview to review later. On Android the recording is video only, without audio, because the microphone is held by the speech recogniser for the whole call; the file is handed to you through the share sheet.

Arabic first

A complete right-to-left Arabic interface, questions and evaluations written in proper professional language, and an Egyptian Arabic interviewer voice. Prefer English? Switch language whenever you like.

Your privacy

No adverts. No trackers. We do not sell or share your data for marketing. Your answers go to AI providers for one purpose — running and grading the interview — and that is set out in the privacy policy. You can delete your account and your data from inside the app at any time.

Support: info@barmagly.tech
```

---

# 3. Graphics

| Asset | File | Spec |
|---|---|---|
| App icon | `mobile/assets/play-store-icon.png` | 512×512, 32-bit PNG, **no alpha** |
| Feature graphic | `store-assets/feature-graphic.png` | 1024×500, no ranking claim |
| Phone screenshots | `store-assets/phone/` | ≥ 4, 1080×1920 |

Screenshots must be retaken after the rename — the old set shows the ثقتي wordmark and the
old interviewer avatar, and a screenshot that disagrees with the icon is itself a metadata
problem. `scripts/capture-app-shots.mjs` drives the real build and writes them.

---

# 4. Everything else

The Data safety questionnaire, IARC answers, App access (reviewer sign-in), Ads declaration
and the payments position are unchanged by the rename and are documented in
[`release/PLAY-1.1.0.md`](../release/PLAY-1.1.0.md). Two of them decide the review:

- **Data safety → Device or other IDs.** The app generates a random install id on first run
  and sends it as `X-Install-Id` so the ten free trial minutes cannot be claimed twice.
  Declare it: *collected*, purpose **fraud prevention / security**, **not shared**, **not
  ephemeral**, and **not** an advertising id. Leaving it undeclared is the classic Data-safety
  rejection.
- **Payments.** There is no purchase flow inside the Android build. Keep *In-app purchases =
  No* and do not add any sentence to the listing that reads as a route around Play billing.
