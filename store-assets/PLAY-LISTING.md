# Google Play Console — listing pack: ثقتي / Thiqty

**Package:** `com.thiqty.app` · **versionName** 1.0.0 · **versionCode** 1
**Default store listing language:** Arabic (ar) · **Second language:** English (United Kingdom / en-GB)
**Developer:** Barmagly · Cairo, Egypt · info@barmagly.tech
**Generated:** 2026-08-16 — from a source audit of this repository.

---

## ⚠️ Read this before you paste anything

Every word below is written to be **true of the Android build as it will ship**, not of the
web app. Four things in this pack are conditional on fixes that must land first. If you
publish without them, the listing becomes a false statement and that is its own policy
violation (Deceptive Behavior), on top of the original one.

| # | Blocker | Where it bites this listing |
|---|---------|------------------------------|
| B1 | Android build must be **consumption-only** — no prices, no Subscribe button, no EasyKash link, no payment-method FAQ inside the app | Sets *Ads = No*, *In-app purchases = No*, IARC "digital purchases = No", and Data safety "phone number / payment info = not collected" |
| B2 | `DELETE /api/user/me` must exist and SettingsScreen must call it (currently a `mailto:`) | The full description says data can be deleted in-app. Also required for Data safety "users can request deletion" |
| B3 | `https://interview.khaledahmed.net/privacy` and `/delete-account` must return 200 (they are 404 today; `landing/` has no `privacy.html`) | Privacy policy URL field and the Data deletion URL field |
| B4 | targetSdk must be **36**, not 34 | Upload is rejected before review; the listing never gets seen |

Also fix before upload, because the listing and the app must agree:
- `SubscriptionScreen.tsx` — the fabricated `4.8 ★ / 8,000+ / 120,000+` proof block and the
  "منة ع." testimonial must go. versionCode is 1; the true numbers are zero.
- `FeedbackScreen.tsx:164` — the report button shows a success tick and transmits nothing.
- The paywall comparison table claims free users get "آخر ٥ جلسات" history and "الدرجة فقط"
  feedback. **Neither is enforced** — `backend/src/routes/sessions.js` paginates full history
  for everyone and returns the complete `ai_feedback` blob to everyone. The only real
  premium gates are the daily quota and `category.isPremium` (Sales, Design). The copy below
  is written to the truth; fix the in-app table to match.

---

# 1. Store listing — Arabic (ar) · DEFAULT

## 1.1 App name (max 30 characters)

| # | Candidate | Chars | Verdict |
|---|-----------|-------|---------|
| A1 | `ثقتي — تدريب مقابلات العمل` | **26** | ✅ **RECOMMENDED** — brand + the exact thing people search for ("مقابلات العمل"), no filler |
| A2 | `ثقتي: تدرّب على مقابلات العمل` | 29 | ✅ verb-led, but 3 chars from the ceiling and truncates earlier in narrow list views |
| A3 | `ثقتي — مدرّب المقابلات الذكي` | 28 | ⚠️ "الذكي" is vaguer than saying what it does |
| A4 | `ثقتي — تدريب المقابلات` | 22 | ✅ shortest, safest; loses "العمل" which is the searched word |
| A5 | `ثقتي: تدريب مقابلات بالعربية` | 28 | ⚠️ "بالعربية" is redundant in an Arabic-locale listing |

> **Use A1: `ثقتي — تدريب مقابلات العمل`** (26 characters)

## 1.2 Short description (max 80 characters)

| # | Candidate | Chars |
|---|-----------|-------|
| S1 | `أسئلة مقابلات واقعية بالعربية، وتقييم فوري لكل إجابة مع إجابة نموذجية.` | **70** ✅ **RECOMMENDED** |
| S2 | `تدرّب على مقابلات العمل بالعربية، واعرف درجتك وسبب كل درجة فورًا.` | 65 |
| S3 | `مقابلات تدريبية بالعربية، تقييم فوري بالذكاء الاصطناعي، وتقدّم تتابعه.` | 70 |

> **Use S1** — it names the three things that make someone install: real questions, an
> instant score, and a model answer.

## 1.3 Full description (max 4000 characters) — **1,863 characters**

```text
ادخل مقابلتك القادمة وأنت تعرف بالضبط ماذا ستقول.

"ثقتي" تطبيق عربي للتدريب على مقابلات العمل. تختار مجالك، تجاوب على أسئلة حقيقية من النوع الذي يسأله أصحاب العمل فعلًا، وتحصل على تقييم فوري يشرح لك درجتك وكيف ترفعها — قبل أن تجلس أمام لجنة حقيقية.

كيف يعمل

١. اختر مجالك وابدأ جلسة تدريب.
٢. اقرأ السؤال، واكتب إجابتك كما ستقولها في المقابلة.
٣. احصل خلال ثوانٍ على درجة من ١٠٠، ونقاط قوتك، ومواضع الضعف، وإجابة نموذجية.
٤. أعِد المحاولة، وتابع تحسّنك جلسة بعد جلسة.

المجالات المتاحة

• برمجة
• محاسبة
• تسويق
• موارد بشرية
• خدمة عملاء
• مبيعات وتصميم — ضمن الاشتراك المميّز

تقييم يشرح نفسه

لن تخرج بعبارة "إجابة جيدة" وكفى. كل إجابة تُقرأ وتُقيَّم، وتحصل على:

— درجة رقمية واضحة تعرف بها موقعك
— نقاط القوة التي يجب أن تكرّرها في المقابلة الحقيقية
— المواضع التي أضعفت إجابتك، مكتوبة بصراحة
— إجابة نموذجية لنفس السؤال تتعلّم منها الصياغة والترتيب

تقدّمك بالأرقام

شاشة الإحصائيات تعرض متوسط درجاتك، وعدد جلساتك، واتجاه تحسّنك. وسجلّ الجلسات يحتفظ بكل سؤال وإجابة وتقييم، لتراجعها في الليلة التي تسبق المقابلة.

عربي أولًا، لا ترجمة آلية

واجهة عربية كاملة من اليمين إلى اليسار، وأسئلة وتقييمات مكتوبة بلغة مهنية سليمة. تفضّل الإنجليزية؟ بدّل اللغة من الإعدادات في أي وقت، والتقييم يأتيك بها.

ابدأ مجانًا

خمسة أسئلة تدريبية كل يوم، مجانًا وبدون إعلانات، بكل مزايا التقييم والسجل والإحصائيات. الاشتراك المميّز يفتح أسئلة غير محدودة وكل المجالات المتخصصة.

خصوصيتك

لا إعلانات. لا أدوات تتبّع. لا نبيع بياناتك ولا نشاركها للتسويق. إجاباتك تُرسل إلى مزوّدي الذكاء الاصطناعي لغرض واحد هو تقييمها، وهذا موضّح بالتفصيل في سياسة الخصوصية. يمكنك حذف حسابك وبياناتك من داخل التطبيق في أي وقت.

ملاحظة

المقابلة المباشرة بالفيديو وتحليل السيرة الذاتية تعملان حاليًا في نسخة المتصفح على interview.khaledahmed.net فقط، لأنهما تحتاجان إلى كاميرا وميكروفون وتعرّف على الكلام داخل المتصفح. نعمل على إتاحتهما في تطبيق أندرويد.

للدعم أو الاستفسار: info@barmagly.tech
```

**Conditional sentences — check before you paste:**
- `يمكنك حذف حسابك وبياناتك من داخل التطبيق في أي وقت` → only true once **B2** ships. If you
  publish without the DELETE endpoint, delete this sentence (and you will fail review anyway).
- `الاشتراك المميّز يفتح أسئلة غير محدودة وكل المجالات المتخصصة` → factual, no price, no
  purchase link. Do **not** add "اشترك من الموقع" — the listing must not read as a workaround
  for Play billing.
- The "ملاحظة" paragraph is deliberately there. A reviewer who sees the web app's video
  interview in your marketing and cannot find it on Android will reject; naming the limitation
  up front converts better than an angry 1-star review.

---

# 2. Store listing — English (en-GB)

## 2.1 App name (max 30 characters)

| # | Candidate | Chars | Verdict |
|---|-----------|-------|---------|
| E1 | `Thiqty: AI Interview Practice` | **29** | ✅ **RECOMMENDED** — "interview practice" is the high-volume search term |
| E2 | `Thiqty — Interview Coach` | 24 | ✅ safest length, softer intent |
| E3 | `Thiqty: Job Interview Trainer` | 29 | ✅ close second; "job" adds intent, drops "AI" |
| E4 | `Thiqty: Arabic Interview Prep` | 29 | ⚠️ narrows the audience in an English listing |

> **Use E1: `Thiqty: AI Interview Practice`** (29 characters)

## 2.2 Short description (max 80 characters)

| # | Candidate | Chars |
|---|-----------|-------|
| S1 | `Realistic Arabic job-interview questions with instant AI feedback on answers.` | **77** ✅ **RECOMMENDED** |
| S2 | `Practice job interviews in Arabic. Get a score and a model answer instantly.` | 76 |
| S3 | `Arabic interview practice with instant AI scoring, feedback and model answers.` | 78 |

> **Use S1.**

## 2.3 Full description (max 4000 characters) — **2,380 characters**

```text
Walk into your next interview knowing exactly what you are going to say.

Thiqty is an Arabic-first job interview trainer. Pick your field, answer the kind of questions employers actually ask, and get an instant evaluation that explains your score and how to raise it — before you sit in front of a real panel.

How it works

1. Choose your field and start a practice session.
2. Read the question and type your answer the way you would say it out loud.
3. In seconds, get a score out of 100, your strengths, your weak spots, and a model answer.
4. Try again, and watch yourself improve session after session.

Fields available

• Programming
• Accounting
• Marketing
• Human Resources
• Customer Service
• Sales and Design — included with Premium

Feedback that explains itself

You will not be told "good answer" and left there. Every answer is read and graded, and you get:

— A clear numeric score so you know where you stand
— The strengths worth repeating in the real interview
— The specific things that weakened your answer, stated plainly
— A model answer to the same question, so you can learn the phrasing and the structure

Your progress, in numbers

The stats screen shows your average score, how many sessions you have run, and which way your results are trending. Your history keeps every question, answer and evaluation, so you can review them the night before the interview.

Arabic first, not machine-translated

A complete right-to-left Arabic interface, with questions and feedback written in correct professional Arabic. Prefer English? Switch languages in Settings at any time and your feedback follows.

Start for free

Five practice questions every day, free and with no ads, including full feedback, history and stats. Premium unlocks unlimited questions and every specialist field.

Your privacy

No ads. No trackers. We do not sell your data or share it for marketing. Your answers are sent to AI providers for one purpose — to evaluate them — and the privacy policy sets out exactly how. You can delete your account and your data from inside the app at any time.

Please note

The live video interview and the CV analysis currently run only in the browser version at interview.khaledahmed.net, because they need camera, microphone and speech recognition inside a browser. We are working on bringing them to the Android app.

Support: info@barmagly.tech
```

Same two conditional sentences as the Arabic version (deletion, premium wording).

---

# 3. Category, tags and contact details

## 3.1 Category

| Field | Value | Why |
|-------|-------|-----|
| **App or game** | App | |
| **Category** | **Education** | The product teaches a skill through practice and graded feedback. `Business` is the alternative and is defensible, but Education is where interview-prep and skills apps sit, and it is the closer match to the content-rating answers below. |
| Second choice | Business | Pick this only if you later add employer-side or job-board features. |
| **Do NOT pick** | Productivity, Lifestyle, Social | Miscategorisation is a listing-quality flag. |

## 3.2 Tags (Play lets you pick up to 5)

Choose from Play's fixed tag list — you cannot invent tags.

1. **Test Preparation** — closest match to graded practice sessions
2. **Career Development** *(under Education / Business tags)*
3. **Language Learning** — only if you keep the bilingual AR/EN framing; drop it if it dilutes
4. **Study Tools**
5. **Self-Improvement**

> If a tag above is not offered in your Console's list for the Education category, leave the
> slot empty rather than picking a loose one. Irrelevant tags hurt conversion and can be
> flagged as an attempt to game discovery.

## 3.3 Contact details (Store settings → Store listing contact details)

```text
Email address (required, shown publicly):   info@barmagly.tech
Phone number (optional, shown publicly):    — leave blank —
Website (optional, shown publicly):         https://interview.khaledahmed.net
```

```text
Privacy policy URL (App content → required):
https://interview.khaledahmed.net/privacy

Terms of service URL (used in-app, not a Console field):
https://interview.khaledahmed.net/terms

Account / data deletion URL (Data safety → required):
https://interview.khaledahmed.net/delete-account
```

⚠️ All three URLs currently return **404**. `backend/src/app.js:209-215` registers the routes
but only serves the files "when present", and `landing/` contains no `privacy.html`,
`terms.html` or `delete-account.html`. The footer of `landing/index.html:820-822` already
links to them. Write the three pages before you touch the Console. Also update
`mobile/src/screens/SettingsScreen.tsx:30-31`, which currently points `PRIVACY_URL` and
`TERMS_URL` at `https://barmagly.tech/privacy` — that page is the privacy policy for
**Barmagly POS**, a restaurant point-of-sale product. A reviewer who opens it will reject.

## 3.4 Developer details (account-level, Play Console → Developer account)

```text
Developer name (public):     Barmagly
Country:                     Egypt
Address:                     Cairo, Egypt  (full street address required and shown publicly
                             for individual accounts; enter the registered business address)
Developer email (public):    info@barmagly.tech
Developer website:           https://barmagly.tech
Developer phone:             required by Play, verified, not shown publicly
```

---

# 4. App content → App access

**Answer: `All or some functionality is restricted`.**

Every meaningful screen is behind `requireUser`. `POST /api/auth/register` and
`POST /api/auth/login` are the only unauthenticated app-facing routes, so a reviewer who
cannot log in sees an onboarding carousel and nothing else. Play will reject that.

Add **one** access instruction covering the whole app:

```text
Name of instruction:
Full app access (all screens)

Any other information:
The entire app requires an account. Sign in with the reviewer account below on the
sign-in screen; no email verification, no OTP and no phone number are required.

The app opens on a three-slide onboarding carousel. Tap "لديّ حساب بالفعل" / "I already
have an account" at the bottom to reach the sign-in screen.

To change the interface language to English: sign in, open the "حسابي" / Profile tab
(fourth tab), then Settings, then Language, then English.

This reviewer account has an active Premium entitlement, so the daily free limit of five
questions does not apply and all practice fields are unlocked. No purchase is needed and
the app contains no purchase flow.

To exercise the core feature: Home tab → choose any field (e.g. "برمجة" / Programming)
→ start a session → type any answer in the text box → submit. An AI evaluation with a
score, strengths, weaknesses and a model answer appears within a few seconds. The
"السجل" / History and "إحصائياتي" / Stats tabs then show the session.

Note: the live video interview shown on our website is a browser-only feature. On Android
the app displays an explanatory screen instead. This is stated in the store listing.
```

**Credentials block:**

```text
Username:  play.review@barmagly.tech
Password:  <set at creation — paste the real value here>
```

⚠️ **This account does not exist yet.** No demo user is seeded — `backend/prisma/seed.js`
seeds categories, questions and one *admin* user only. Create it against the production API
the shipped binary talks to (`mobile/app.json` → `extra.apiBaseUrl` =
`https://interview.khaledahmed.net/api`), then grant premium so the quota never blocks the
reviewer:

```bash
# 1. create the account
curl -X POST https://interview.khaledahmed.net/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"play.review@barmagly.tech","password":"<20+ char password>","name":"Play Review","language":"ar"}'

# 2. grant premium (admin JWT required)
#    PATCH /api/admin/users/:id  { "plan": "premium", "premiumUntil": "2027-12-31T00:00:00Z" }
```

Requirements Play enforces on this account: it must stay working for the life of the app,
must not expire, must not be rate-limited out, and must not require 2FA or an OTP. Put a
calendar reminder to re-test it before every release. Also confirm `AI_ENABLED=true` and a
valid `ANTHROPIC_API_KEY` are set in production — while `AI_ENABLED=false` every AI route
returns 503 and the reviewer sees the core feature fail, which is a Minimum Functionality
rejection.

---

# 5. App content → Ads

**Answer: `No, my app does not contain ads`.**

Verified: a case-insensitive grep across `mobile/src`, `mobile/package.json`,
`mobile/app.json`, `backend/src`, `admin/src` and `landing/index.html` for admob, facebook,
appsflyer, adjust, firebase, sentry, amplitude, mixpanel, gtag, googletagmanager, posthog,
segment, hotjar, clarity, plausible and umami returns **zero matches**. There is no
advertising SDK, no `AD_ID` permission, and no ad unit anywhere in the product.

Consequence: the store listing will **not** carry the "Contains ads" badge. Keep it that way —
adding any ad SDK later requires flipping this answer before the release goes live.

---

# 6. App content → Content rating (IARC questionnaire)

**Email address for the rating certificate:** `info@barmagly.tech`
**Category answer (first question):** `Reference, News, or Educational`
*(If you prefer the safest generic bucket, `Utility, Productivity, Communication, or Other`
gives the same answers and the same rating. Do NOT pick a Games category.)*

| # | Question Play/IARC asks | Answer | One-line justification |
|---|--------------------------|--------|------------------------|
| **Violence** | | | |
| V1 | Does the app contain any depictions of violence? | **No** | The app is text questions, typed answers and score cards. No imagery of any kind beyond icons. |
| V2 | Does it contain realistic or graphic violence, or violence toward a person or animal? | **No** | Same. |
| V3 | Does it contain depictions of self-harm or suicide? | **No** | Not present in the question bank (`backend/prisma/seed.js`) or the AI prompts (`backend/src/services/ai/prompts.js`). |
| **Sexuality** | | | |
| S1 | Does the app contain sexual or suggestive material, or nudity? | **No** | Job-interview content only; the interviewer persona prompt is a professional HR role. |
| S2 | Does it contain references to sexual violence? | **No** | Same. |
| **Language** | | | |
| L1 | Does the app contain profanity, crude humour or vulgar language? | **No** | Questions and feedback are generated under prompts that enforce professional register. |
| **Controlled substances** | | | |
| C1 | Does the app reference or depict alcohol, tobacco or drugs? | **No** | No such content in the seeded question bank or prompts. |
| **Miscellaneous** | | | |
| M1 | Does the app allow users to interact or communicate with each other? | **No** | There is no messaging, no comments, no profiles and no shared content. Every session is private to one account; verified — no user-to-user endpoint exists in `backend/src/routes/`. |
| M2 | Does the app allow users to share user-generated content with other users? | **No** | Answers are stored against the author's own `user_id` and returned only to that user. |
| M3 | Does the app share the user's current location with other users? | **No** | No location permission is requested and no location code exists. |
| M4 | Does the app allow users to purchase digital goods? | **No** *(consumption-only Android build — see B1)* | With the paywall gated to web there is no purchase flow, no Play Billing library and no checkout link inside the Android app. **If you later add Google Play Billing, change this to Yes and re-take the questionnaire.** |
| M5 | Does the app contain gambling or simulated gambling? | **No** | No chance mechanics, no wagering, no loot mechanics. |
| M6 | Does the app include a browser or allow unrestricted access to the internet? | **No** | No WebView, no in-app browser. The only outbound links are the privacy/terms/support links, opened in the system browser. |
| M7 | Does the app collect or transmit the user's personal information? | **Yes** | Name and email at registration; answers and AI feedback stored server-side. Declared in full in the Data safety section below. |
| M8 | Does the app enable the purchase of physical goods? | **No** | Nothing physical is sold. |
| M9 | Does the app contain content generated by AI (text) shown to the user? | **Yes** | Questions, scores, feedback and model answers are produced by Claude / Gemini / Groq. See §11 for the separate GenAI declaration. |
| M10 | Is the app designed primarily for children? | **No** | It is a job-interview trainer for working-age adults. |

**Expected outcome:** ESRB **Everyone**, PEGI **3**, USK **0**, IARC Generic **3+**, and the
Play-wide rating **Rated for 3+**. That is fine and does not conflict with the 18+ target
audience in §7 — the content rating measures content, the target audience measures intent.

**Re-take the questionnaire whenever:** you add Play Billing (M4), add any user-to-user
feature (M1/M2), or add a WebView (M6). A stale rating is itself a policy violation.

---

# 7. App content → Target audience and content

| Console question | Answer | Justification |
|------------------|--------|---------------|
| **Target age groups** (multi-select: 5 & under, 6–8, 9–12, 13–15, 16–17, 18+) | **18 and over — only** | The product is job-interview preparation. Every user creates an account, free-text answers routinely contain employment and salary history, and that text is transmitted to third-party AI providers. Selecting 16–17 would pull the app into Play's Families requirements and require a children-appropriate ads/analytics posture and a families-compliant AI-content review. Do not select it for v1. |
| **Does your app appeal to children?** / "Store presence" follow-up | **No** | The visual identity is a corporate blue professional style, the copy addresses job seekers, and there are no cartoon characters, games, rewards or child-directed themes. |
| **Are you sure your app should not be available to children?** (confirmation) | Confirm **No** | Same reasoning. |
| **Designed for Families programme** | **Not opted in** | Ineligible and undesirable at 18+. |
| **Does your app include ads?** (repeated here) | **No** | See §5. |
| **Google Play's Families Policy applies?** | **No** | Follows from 18+ only. |

Set the **Play Console "Content guidelines" acknowledgement** and, in the store listing, keep
all screenshots free of anything that would read as child-directed.

---

# 8. App content → Data safety

Answers below are for the **Android build as recommended in §B1** — consumption-only, so the
Android app never triggers an EasyKash checkout and therefore never collects a phone number
or transmits a name/email to the payment gateway. `EASYKASH_ENABLED` defaults to `false`
(`backend/src/config/env.js:59-72`) and payments are switched off pending credentials.
**If you enable in-app purchase, re-open this form** — the deltas are marked ⚑.

## 8.1 Top-level questions

| Question | Answer |
|----------|--------|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** — HTTPS everywhere; HSTS `max-age=31536000; includeSubDomains` in production (`backend/src/app.js:65`); every client base URL is `https://` (`mobile/src/api/client.ts:16-17`). |
| Do you provide a way for users to request that their data be deleted? | **Yes** ⚠️ *only true after blocker B2 ships.* Both an in-app delete and the web form at `https://interview.khaledahmed.net/delete-account`. |
| Data deletion URL | `https://interview.khaledahmed.net/delete-account` |
| Has your app been independently validated against a global security standard? | **No** |

## 8.2 Full data-type table

Purposes use Play's fixed vocabulary. "Ephemeral" = processed in memory and never persisted —
Play lets you exclude such processing from "collected", and each exclusion is justified below.

### Location
| Data type | Collected | Shared | Required/Optional | Purpose | In transit | Deletable | Source of truth |
|---|---|---|---|---|---|---|---|
| Approximate location | **No** | No | — | — | — | — | No location permission in `mobile/app.json`; no geolocation code anywhere |
| Precise location | **No** | No | — | — | — | — | Same |

### Personal info
| Data type | Collected | Shared | Required/Optional | Purpose | In transit | Deletable | Source of truth |
|---|---|---|---|---|---|---|---|
| **Name** | **Yes** | No ⚑ | Required | App functionality; Account management | Encrypted | Yes | `users.name` VARCHAR(120), `schema.prisma:79`; set at `auth.js:52-59`. ⚑ Shared with EasyKash if checkout is enabled (`easykash.js:91`) |
| **Email address** | **Yes** | No ⚑ | Required | App functionality; Account management | Encrypted | Yes | `users.email` UNIQUE, `schema.prisma:77`; login identity. ⚑ Sent to EasyKash on checkout (`easykash.js:92`) |
| **User IDs** | **Yes** | No | Required | App functionality; Account management | Encrypted | Partially — see note | Numeric `users.id`, carried as the JWT `sub` (`middleware/auth.js:6-20`). ⚠️ `claude_api_logs.user_id` is a bare BigInt with **no foreign key** (`schema.prisma:365`), so those rows survive account deletion. Either null them in the delete path or declare this honestly in the policy. |
| Phone number | **No** ⚑ | No ⚑ | — | — | — | — | `users.phone` is nullable and written **only** at payment checkout (`payments.js:56-64`). With the Android paywall gated to web, the app never asks for it. ⚑ Becomes Collected + Shared (Optional, App functionality) the moment in-app checkout ships. |
| Physical address | No | No | — | — | — | — | No such column or field |
| Race and ethnicity | No | No | — | — | — | — | Never asked |
| Political or religious beliefs | No | No | — | — | — | — | Never asked |
| Sexual orientation | No | No | — | — | — | — | Never asked |
| Other personal info | **No** | No | — | — | — | — | Language preference (`users.language`) is a UI setting, not personal info; declare under App interactions if your Console flow asks |

### Financial info
| Data type | Collected | Shared | Required/Optional | Purpose | In transit | Deletable | Source of truth |
|---|---|---|---|---|---|---|---|
| User payment info | **No** | No | — | — | — | — | Card data never touches this system — EasyKash hosts the checkout page. Only `payments.raw_payload` stores the gateway's echoed metadata, and only for web purchases |
| **Purchase history** | **Yes** | No | Optional (only for users who buy) | App functionality; Account management | Encrypted | Yes | `payments` + `subscriptions` tables (`schema.prisma:192-251`); the app reads `GET /api/subscriptions/history` to show plan status. Purchases originate on the web but the Android app displays them |
| Credit score | No | No | — | — | — | — | Not collected |
| Other financial info | No | No | — | — | — | — | Not collected |

### Health and fitness
| Data type | Collected | Shared | Required/Optional | Purpose | In transit | Deletable |
|---|---|---|---|---|---|---|
| Health info | **No** | No | — | — | — | — |
| Fitness info | **No** | No | — | — | — | — |

### Messages
| Data type | Collected | Shared | Required/Optional | Purpose | In transit | Deletable |
|---|---|---|---|---|---|---|
| Emails | **No** | No | — | — | — | — |
| SMS or MMS | **No** | No | — | — | — | — |
| Other in-app messages | **No** | No | — | — | — | — |

*(No messaging feature exists. Interview answers are declared under App activity → Other user-generated content, which is where Play wants them.)*

### Photos and videos
| Data type | Collected | Shared | Required/Optional | Purpose | In transit | Deletable | Source of truth |
|---|---|---|---|---|---|---|---|
| Photos | **No** | No | — | — | — | — | No photo picker, no camera capture on Android |
| Videos | **No** | No | — | — | — | — | The live-interview recording is **web-only and device-only** — a `MediaRecorder` Blob turned into an object URL the user downloads (`MeetingScreen.tsx:1229-1241`). It is never uploaded; the only two `api.post` calls in that file send JSON transcripts. There is no video endpoint in the API |

### Audio files
| Data type | Collected | Shared | Required/Optional | Purpose | In transit | Deletable | Source of truth |
|---|---|---|---|---|---|---|---|
| Voice or sound recordings | **No** | No | — | — | — | — | The Android build never opens the microphone — `MeetingScreen.tsx:1734` renders a web-only wall on non-web. On the **web** build, speech is transcribed by the browser's own `webkitSpeechRecognition`; only the resulting **text** reaches our API. Disclose the browser vendor's processing in the privacy policy (Chrome streams the audio to Google), but it is not data *your app* collects on Android |
| Music files | No | No | — | — | — | — | — |
| Other audio files | No | No | — | — | — | — | — |

### Files and docs
| Data type | Collected | Shared | Required/Optional | Purpose | In transit | Deletable | Source of truth |
|---|---|---|---|---|---|---|---|
| Files and docs | **No** on Android ⚑ | No ⚑ | — | — | — | — | CV upload (`POST /api/meeting/prepare`) is reachable only from the web meeting flow. Server-side it uses multer `memoryStorage`, 4 MB, PDF/TXT/MD only, and the buffer is discarded when the request ends — nothing is written to disk or MySQL (`meeting.js:41-52, 101-135`). ⚑ If you ship the native meeting flow, this becomes **Collected: Yes / Shared: Yes** (the extracted text goes to Anthropic/Gemini/Groq), Optional, purpose App functionality |

### Calendar / Contacts
| Data type | Collected | Shared |
|---|---|---|
| Calendar events | **No** | No |
| Contacts | **No** | No |

### App activity
| Data type | Collected | Shared | Required/Optional | Purpose | In transit | Deletable | Source of truth |
|---|---|---|---|---|---|---|---|
| **App interactions** | **Yes** | No | Required | App functionality; Analytics | Encrypted | Yes | `sessions` rows (category, kind, score, counts, timestamps — `schema.prisma:147-165`) and the daily quota counters (`users.daily_questions_used`). Powers History, Stats and the admin dashboard (`admin.js:223-266`). First-party only; no third-party analytics SDK exists |
| In-app search history | **No** | No | — | — | — | — | No search feature |
| Installed apps | **No** | No | — | — | — | — | No package-visibility query |
| **Other user-generated content** | **Yes** | **Yes** | Required | App functionality | Encrypted | Yes | **This is the important row.** `answers.user_answer` (TEXT) and `answers.question_text` are stored verbatim and sent verbatim to the AI provider for grading — Anthropic Claude by default, falling back to Google Gemini then Groq (`sessions.js:136-147`; `services/ai/index.js:145-154`; `prompts.js:124-126`). `answers.ai_feedback` (LONGTEXT JSON) stores the returned evaluation. Free-text answers routinely contain the user's employment history and employer names |
| Other actions | **No** | No | — | — | — | — | Nothing beyond the above |

### Web browsing
| Data type | Collected | Shared |
|---|---|---|
| Web browsing history | **No** | No — no browser, no WebView, no URL tracking |

### App info and performance
| Data type | Collected | Shared | Required/Optional | Purpose | In transit | Deletable | Source of truth |
|---|---|---|---|---|---|---|---|
| Crash logs | **No** | No | — | — | — | — | No crash-reporting SDK (no Firebase, no Sentry) |
| Diagnostics | **Yes** | No | Required | App functionality; Analytics | Encrypted | ⚠️ see note | `claude_api_logs` records provider, model, feature, token counts, cost, latency, success and the provider's error string per AI call, keyed to `user_id` (`services/ai/index.js:74-99`). It stores **no prompt or answer content**. ⚠️ It has no foreign key, so it currently outlives account deletion — fix this in the delete path or say so in the policy |
| Other app performance data | **No** | No | — | — | — | — | Winston logs to stdout only (`utils/logger.js:11-17`) |

### Device or other IDs
| Data type | Collected | Shared | Required/Optional | Purpose | In transit | Deletable | Source of truth |
|---|---|---|---|---|---|---|---|
| Device or other IDs | **No** | No | — | — | — | — | No advertising ID (no `AD_ID` permission), no device fingerprint, no push token (`expo-notifications` is not a dependency — the notification toggles in Settings are local booleans in AsyncStorage). IP address is used transiently for rate limiting in an in-process store and appears in stdout access logs, but is never persisted to the database — the `refresh_tokens.ip` / `user_agent` and `admin_audit_logs.ip` columns exist in the schema and **are never written**. Play does not require declaring transient IP used solely for security/rate limiting; disclose it in the privacy policy regardless |

## 8.3 Third-party recipients to name in the privacy policy

Play's Data safety form has no field for naming processors, but the linked privacy policy must
name them, and a reviewer will compare the two.

| Recipient | What it receives | Where |
|---|---|---|
| **Anthropic (Claude)** — primary | Question text, the full free-text answer, the whole live transcript, full extracted CV text (≤18,000 chars), target company / job title / job description. No email, name, phone or user ID is in the prompt body | `services/ai/claude.js:94` |
| **Google (Gemini)** — fallback | Same content when Claude is unavailable | `services/ai/gemini.js:111` |
| **Groq** — second fallback | Same content | `services/ai/groq.js:69` |
| **Google Translate TTS** (unofficial endpoint) | The interviewer's reply text, when no neural browser voice exists. Server-side call, so the user's IP is not exposed | `routes/tts.js:62-84`. ⚠️ Unofficial endpoint called with a spoofed User-Agent and Referer — replace with a contracted provider (Azure Speech ar-EG) |
| **Google (Chrome Web Speech)** — indirect | The candidate's **microphone audio**, streamed by the browser itself for transcription. Web only; the app never receives the audio | `MeetingScreen.tsx:173-174` |
| **Microsoft** — indirect | Text sent for "Online (Natural)" neural voice synthesis by the browser | `speech/webSpeech.ts:73` |
| **EasyKash** ⚑ | Name, email, mobile, amount, plan label, our reference. **Currently disabled**, web-only when enabled | `services/payments/easykash.js:84-98` |
| **Hostinger / Vercel** | Hosting and the MySQL database holding every table above; stdout request logs | `app.js:87-97` |
| **Google Fonts** | The **landing page only** loads the Cairo webfont from Google, exposing each visitor's IP and UA. Not the app | `landing/index.html:45-49` — self-host the font to remove it |

## 8.4 Retention — what the privacy policy must say

Do **not** write "we keep your data only as long as necessary". It would be false. There is no
TTL, no anonymisation and no purge job anywhere. The only two `deleteMany()` calls in the
backend (`services/maintenance.js:66-76`) target `refresh_tokens` and `password_resets`, and
no code path ever writes a row to either table, so they delete zero rows every run.

Write the truth instead: practice answers, AI feedback, session records and billing records
are retained until the account is deleted; deleting the account removes them; payment records
may be retained where required as financial records; AI usage telemetry is keyed to a numeric
ID with no content and is retained for cost accounting.

---

# 9. App content → Government apps, financial features, health

| Declaration | Answer | Justification |
|---|---|---|
| **Government apps** — "Is your app a government app?" | **No** | Thiqty is developed and published by Barmagly, a private company in Cairo. It is not developed by, for, or on behalf of any government body, does not deliver government services, and does not display any government branding or seal. |
| **Financial features** — "Does your app provide financial features?" | **`My app doesn't provide any financial features`** | Select that option and none of: personal loans, lending, debt management, insurance, investments, crypto exchange or wallet, funds transfer, money management, tax. The app sells a subscription to its own content — that is a purchase, not a financial service. Card data never touches this system; EasyKash hosts the checkout, and in the recommended Android build there is no in-app checkout at all. |
| **Financial features → follow-ups** (licence numbers, country availability, regulator registration) | **N/A** | Not shown once "no financial features" is selected. |
| **Health apps** — the Health declaration / health-data questions | **Not a health app** | The app is in the Education category, does not measure, record, infer or display any health, medical, fitness, wellness, mental-health or clinical data, uses no Health Connect API, requests no `BODY_SENSORS` or `ACTIVITY_RECOGNITION` permission, and makes no medical claim in any copy. If a "Health apps" section appears in your Console, answer "My app is not a health app" and skip the sub-form. |
| **Health Connect / Health data permissions** | **Not used** | Not a dependency; not in the manifest. |
| **News apps** | **No** | Not a news publisher. |
| **COVID-19 contact tracing and status apps** | **No** | Unrelated. |
| **Data safety → "Is your app a financial or health app?"** if surfaced | **No** to both | Same reasoning. |

---

# 10. Permissions justification — CAMERA and RECORD_AUDIO

## 10.1 What you should actually do for v1: remove them

There is **no dedicated Play Console declaration form** for `CAMERA` or `RECORD_AUDIO` (those
forms exist for all-files access, SMS/Call Log, exact alarms, package visibility, accessibility
and health data). Instead these permissions surface three ways: the Play review team asks you
to justify them, they force entries in the Data safety form, and they show on the store listing
under "App permissions". A reviewer who compares declared permissions against app behaviour
will find **no camera or microphone use at all** in the Android build:

- `MeetingScreen.tsx:1734` — `if (!isWeb) return (<web-only wall/>)`. The camera/mic path
  never runs on Android.
- `getUserMedia` and `MediaRecorder` appear only in `MeetingScreen.tsx` and
  `speech/webSpeech.ts`, both behind `Platform.OS === 'web'`.
- `expo-camera`, `expo-av`, `expo-media-library`, `expo-speech` and `expo-file-system` are
  listed in `mobile/package.json` but **imported nowhere** in `mobile/src`.

Play policy: permissions may only be requested for features "currently implemented" in the app.
Requesting camera and microphone for an unimplemented feature is a direct violation.

**Fix in `mobile/app.json` → `expo.android`:**

```jsonc
"permissions": [
  "INTERNET",
  "ACCESS_NETWORK_STATE",
  "VIBRATE"
],
"blockedPermissions": [
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.MODIFY_AUDIO_SETTINGS",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.USE_BIOMETRIC",
  "android.permission.USE_FINGERPRINT"
]
```

`blockedPermissions` is required as well as removal from `permissions`, because library
manifests merge them back in — `SYSTEM_ALERT_WINDOW` (React Native dev support) and
`USE_BIOMETRIC` / `USE_FINGERPRINT` (`expo-secure-store`) appear in the built AAB despite never
being listed in `app.json`. **Verify the merged result in the artifact, not the config:**

```bash
aapt2 dump permissions release/thiqty-v1.0.0.apk
aapt2 dump badging   release/thiqty-v1.0.0.apk | grep -E '^package|targetSdk'
```

## 10.2 Justification text — for the release that actually ships the native live interview

Use these only when `expo-av` recording plus a server STT endpoint are genuinely wired up.
Submitting them for v1 would be a false statement to Play.

**CAMERA — Play review reply / Data safety rationale (English):**

```text
Thiqty requests CAMERA solely to power the "Live mock interview" feature, in which the user
practises a face-to-face job interview with an AI interviewer. The camera preview is shown to
the user so they can rehearse their own posture, eye contact and delivery, exactly as they
would appear on a real video call.

The camera is opened only after the user explicitly taps "Start live interview" and grants the
runtime permission, and it is never opened anywhere else in the app. Camera tracks are stopped
in the same code path that ends the interview, so the camera indicator never outlives the call.

No video frame is ever transmitted to our servers or to any third party. The recording is
assembled on the device and offered back to the user as a file they may save locally; it is
discarded if they do not. Our API has no video upload endpoint. The app does not use the camera
for scanning, identification, biometrics, background capture or advertising.
```

**CAMERA — Arabic runtime rationale (the in-app string shown before the system prompt):**

```text
نحتاج إذن الكاميرا لعرض صورتك أثناء المقابلة التدريبية المباشرة، حتى تتدرّب على حضورك أمام
الكاميرا كما في مقابلة فيديو حقيقية. لا يُرسل الفيديو إلى خوادمنا ولا إلى أي جهة أخرى، ويبقى
التسجيل على جهازك وحده.
```

**RECORD_AUDIO — Play review reply / Data safety rationale (English):**

```text
Thiqty requests RECORD_AUDIO solely to capture the user's spoken answers during the "Live mock
interview" feature. Speech is converted to text so the AI interviewer can respond and so the
answer can be graded — the app is a spoken-interview trainer, and without microphone input the
feature cannot function.

The microphone is activated only after the user taps "Start live interview" and grants the
runtime permission, and is released as soon as the interview ends. There is no background
recording, no always-on listening and no wake-word detection.

Only the resulting transcript text is transmitted, to our own API and from there to our AI
evaluation providers. Audio is not stored on our servers and is not shared with advertisers or
data brokers.
```

**RECORD_AUDIO — Arabic runtime rationale:**

```text
نحتاج إذن الميكروفون لتسجيل إجاباتك المنطوقة أثناء المقابلة التدريبية المباشرة وتحويلها إلى نص
حتى يتمكن المُقابِل الذكي من الرد وتقييم إجابتك. لا يعمل الميكروفون إلا أثناء المقابلة، ويتوقف
فور انتهائها.
```

The current `mobile/app.json` iOS strings (`NSMicrophoneUsageDescription`,
`NSCameraUsageDescription`) already say roughly this — they too describe a feature the native
build does not ship. Keep them aligned with whatever you actually release.

---

# 11. App content → AI-generated content declaration

Not requested in the brief, but Play now asks and this app is squarely in scope: the interviewer
is a conversational AI and every question, score, and piece of feedback is model-generated.

| Question | Answer | Note |
|---|---|---|
| Does your app contain AI-generated content? | **Yes** | Text generated by Anthropic Claude, with Google Gemini and Groq as fallbacks |
| What type? | **Text** | No image, audio or video generation. (The TTS fallback synthesises speech from model text — mention it if the form offers an audio option.) |
| Is the AI-generated content user-facing? | **Yes** | It is the core of the product |
| Can users report or flag offensive AI-generated content in the app? | **Yes** ⚠️ | **Only true after you fix `FeedbackScreen.tsx:164`**, where `submit` currently just calls `setSent(true)` and transmits nothing. Add `POST /api/answers/:id/report` writing an `AnswerReport` row — the admin half (`GET /api/admin/reports`, resolve) already exists — and show the success state only on a 2xx. Play's AI-Generated Content policy **requires** in-app reporting |
| Have you tested the model against generating restricted content? | **Yes** — document it | Keep a short written record of red-teaming the interviewer prompt in `backend/src/services/ai/prompts.js`; Play asks for it if the app is flagged |

---

# 12. Graphic assets Play requires — exact specs

| Asset | Required? | Exact dimensions | Format | Max size | Status in `store-assets/` |
|---|---|---|---|---|---|
| **App icon** | ✅ Required | **512 × 512 px** | 32-bit PNG **with alpha** | 1 MB | ❌ **Missing.** `logo-stacked.png` is 673 × 1024 — wrong shape. Export a square 512×512 from `mobile/assets/icon.png`. Do not include rounded corners or a drop shadow; Play masks the icon itself |
| **Feature graphic** | ✅ Required | **1024 × 500 px** | PNG or JPEG, **no alpha channel** | 15 MB | ✅ `feature-graphic.png` is 1024 × 500. Verify it has no alpha (`identify -format '%[channels]'`) and that no text sits within 100 px of the edges — Play crops it for some surfaces |
| **Phone screenshots** | ✅ Required, **min 2, max 8** | Each side **320–3840 px**; 16:9 or 9:16. Use **1080 × 1920** | PNG or JPEG (24-bit PNG, no alpha) | 8 MB each | ⚠️ **Broken — regenerate.** 25 files exist at the right size but only ~6 are unique images; `46e60b30…` is duplicated 10 times and `f083e301…` 7 times. They also show the **web** live-interview screens, which do not exist on Android |
| **7-inch tablet screenshots** | Optional but strongly recommended | Each side 320–3840 px | PNG or JPEG | 8 MB each | ❌ Missing. Without them Play may show "not designed for tablets" on tablet devices and you lose tablet-quality eligibility (`ios.supportsTablet` is true, so the app is tablet-capable) |
| **10-inch tablet screenshots** | Optional but strongly recommended | Each side 1080–7680 px | PNG or JPEG | 8 MB each | ❌ Missing |
| **Promo video** | Optional | — | **YouTube URL only** (no file upload); must not be age-restricted, must not autoplay ads | — | ❌ None. Skip for v1 |
| **Wear OS / Android TV / Auto assets** | N/A | — | — | — | Not a Wear/TV/Auto app |
| **Adaptive launcher icon** (in the APK, not the Console) | ✅ Required by Android | 108 × 108 dp; 432 × 432 px source, safe zone 66 dp centre | PNG | — | ✅ Configured in `mobile/app.json` — `adaptiveIcon.foregroundImage` + `monochromeImage`, background `#2D73FD` |

**Store-listing promotion eligibility (worth hitting):** supply **at least 4** phone
screenshots, each with a minimum edge of **1080 px** and a 16:9 or 9:16 ratio. Below that,
Play excludes the app from some promotional surfaces.

## 12.1 The 8 screenshots to ship, in order

Each must be captured from the **Android** build with the reviewer account signed in, Arabic UI,
and real data. Add a short Arabic caption band at the top of each — captioned screenshots
convert measurably better than raw frames.

| # | Screen | Caption (Arabic) |
|---|--------|------------------|
| 1 | Home with fields grid | تدرّب على مقابلات مجالك |
| 2 | Category detail / session start | أسئلة حقيقية يسألها أصحاب العمل |
| 3 | Interview question with the answer box filled | اكتب إجابتك كما ستقولها |
| 4 | Evaluation card — score + strengths + weaknesses | درجة فورية تشرح نفسها |
| 5 | Evaluation card scrolled to the model answer | وإجابة نموذجية تتعلّم منها |
| 6 | Session summary | راجع الجلسة كاملة قبل المقابلة |
| 7 | Stats screen with a real trend | تابع تحسّنك بالأرقام |
| 8 | History list | كل جلساتك محفوظة |

Drop every existing frame named `*meeting*` — `04-meeting-joining`, `05-meeting-live`,
`06-meeting-recording`, `07-meeting-controls`, `08-meeting-end-confirm`. Showing the live video
interview in the Android listing advertises a feature the Android app does not have. Also drop
`13-premium.png` if it displays the fabricated `4.8 ★ / 8,000+ / 120,000+` proof block.

`scripts/capture-app-shots.mjs` is producing duplicates — fix the wait/navigation step before
re-running, and diff the output hashes before uploading.

---

# 13. Pre-publish checklist, in order

Do not skip ahead. Items 1–6 are upload blockers; nothing else matters until they are done.

### Phase 1 — make the app publishable (blockers)

- [ ] **1. targetSdk 36.** Upgrade Expo SDK 51 → 54+ (SDK 51 pins compile/targetSdk 34 and cannot be forced), `expo prebuild --clean`, re-apply the signing config. Verify from the **artifact**: `aapt2 dump badging release/thiqty-v1.0.0.apk | grep targetSdk`. API 34 is rejected at upload, not at review.
- [ ] **2. Remove the in-app paywall on Android.** Gate `SubscriptionScreen` on `Platform.OS === 'web'`. On Android show current plan and expiry only — no prices, no Subscribe button, no `Linking.openURL` to EasyKash, and delete the `subscription.faq.payment` strings from `mobile/src/i18n/ar.ts` and `en.ts` ("عن طريق إيزي كاش…"). Confirm `EASYKASH_ENABLED` is never true for traffic from `com.thiqty.app`. **This is the highest suspension risk in the product.**
- [ ] **3. Ship `DELETE /api/user/me`** (re-authenticated with the current password), cascading the user row and additionally clearing `claude_api_logs.user_id` and the user's `webhook_events`. Add an `onDelete` rule to `answer_reports.reporter` (currently defaults to Restrict and would block the delete). Wire `SettingsScreen.tsx:222-237` to it and remove the `mailto:` fallback. Either honour the "within 48 hours" promise in `ar.ts:713` / `en.ts:651` or change the copy.
- [ ] **4. Publish the three web pages** so `https://interview.khaledahmed.net/privacy`, `/terms` and `/delete-account` return 200. Write `privacy.html`, `terms.html` and `delete-account.html` into `landing/`. The privacy policy must be Thiqty-specific and name Anthropic, Gemini, Groq, the Google TTS endpoint, EasyKash and the retention reality from §8.4.
- [ ] **5. Repoint `SettingsScreen.tsx:30-31`** — `PRIVACY_URL` and `TERMS_URL` currently open the **Barmagly POS** policy, a restaurant point-of-sale product. Point them at the new URLs.
- [ ] **6. Strip the unused permissions** per §10.1 and verify the **merged** manifest in the AAB, not `app.json`.

### Phase 2 — make the app honest (rejection risks)

- [ ] **7. Delete the fabricated social proof** from `SubscriptionScreen.tsx` — the `4.8 ★`, `8,000+`, `120,000+` block and the "منة ع." testimonial. The developer's own comment marks them as placeholders and versionCode is 1.
- [ ] **8. Make the AI-content report button work.** `FeedbackScreen.tsx:164` shows a success tick and sends nothing. Add `POST /api/answers/:id/report`; the admin side already exists. Required by the AI-Generated Content policy and by §11.
- [ ] **9. Fix the premium comparison table** to match enforcement: the only real gates are the daily quota and premium categories. History and full feedback are **not** limited for free users.
- [ ] **10. Remove the `live` and `cv` premium benefits** from the native build's `BENEFIT_KEYS`, or implement them natively. Do not advertise a benefit whose only fulfilment is a link to your website.
- [ ] **11. Rewrite the cancellation FAQ** — there is no cancellation endpoint, `autoRenew` defaults to false, and every charge is one-off. Say "a one-off prepaid period that does not renew" and publish a refund policy.
- [ ] **12. Add prominent disclosure + consent** at CV upload and at first interview start: answers and CV text are processed by external AI providers. Plain Arabic, in-flow, explicit Continue/Cancel, no pre-ticked box, consent recorded server-side.
- [ ] **13. Fix the package identity mismatch.** `mobile/android/app/build.gradle` says `tech.barmagly.interviewai`; `app.json` and the shipped AAB say `com.thiqty.app`. Delete the stale `mobile/android/` from version control or regenerate it. Verify with `aapt2 dump badging … | grep ^package` before every upload — the package name is permanent once published.
- [ ] **14. Replace the unofficial Google TTS endpoint** (`routes/tts.js`) with a contracted provider, or disclose it as a third-party recipient and drop the spoofed User-Agent/Referer.

### Phase 3 — make it work for the reviewer

- [ ] **15. Set `AI_ENABLED=true` and a valid `ANTHROPIC_API_KEY` in production.** While it is false every AI route returns 503 and the core feature is dead — an automatic Minimum Functionality rejection.
- [ ] **16. Wire SMTP into `POST /api/auth/forgot-password`.** It currently returns `{ok:true}` and sends nothing, so a locked-out user has no recovery path.
- [ ] **17. Create and test `play.review@barmagly.tech`** against the **production** API the release binary talks to. Grant premium with a far-future expiry. Install the signed release APK on a clean device, sign in, run a full practice session end to end, and confirm the evaluation renders.
- [ ] **18. Smoke-test on a real Android device**, not an emulator: onboarding → sign-in → session → evaluation → history → stats → settings → language switch → delete account.

### Phase 4 — assets and listing

- [ ] **19. Export the 512 × 512 app icon** (32-bit PNG with alpha) into `store-assets/`.
- [ ] **20. Verify the feature graphic** is 1024 × 500 with no alpha and no text near the edges.
- [ ] **21. Re-capture 8 unique Android phone screenshots** per §12.1 and diff their hashes. Delete every `*meeting*` frame and the premium frame if it shows fake stats.
- [ ] **22. Capture 7-inch and 10-inch tablet screenshots** (optional but avoids the "not designed for tablets" notice).
- [ ] **23. Paste the Arabic listing** (name A1, short S1, full description) as the default language.
- [ ] **24. Add the English (en-GB) listing** (name E1, short S1, full description).
- [ ] **25. Set category = Education**, add tags, fill the contact details block from §3.3.

### Phase 5 — App content declarations

- [ ] **26. Privacy policy URL** — paste `https://interview.khaledahmed.net/privacy` and open it in an incognito window to confirm 200.
- [ ] **27. App access** — "restricted", paste the instruction block and the real credentials from §4.
- [ ] **28. Ads** — No.
- [ ] **29. Content rating** — complete the IARC questionnaire per §6; expect Rated for 3+.
- [ ] **30. Target audience** — 18 and over only; confirm "does not appeal to children".
- [ ] **31. Data safety** — enter the table in §8 and the deletion URL; re-read every ⚑ row if payments are enabled.
- [ ] **32. Government apps** — No. **Financial features** — "doesn't provide any financial features". **Health** — not a health app. **News** — No.
- [ ] **33. AI-generated content declaration** per §11 (only answer "yes" to in-app reporting after item 8 ships).

### Phase 6 — release

- [ ] **34. Upload the AAB to Internal testing first**, never straight to production. Confirm the upload key fingerprint matches what Play expects.
- [ ] **35. Install from the internal track on a real device** and repeat the smoke test — Play App Signing re-signs the artifact, and this is the first time you see the binary users will get.
- [ ] **36. Write release notes** (max 500 characters per language, Arabic and English). For v1: `الإصدار الأول من ثقتي — تدريب على مقابلات العمل بالعربية مع تقييم فوري لكل إجابة.`
- [ ] **37. Set countries** — Egypt first, then the wider MENA region. Rolling out narrowly limits the blast radius of anything you missed.
- [ ] **38. Set pricing** — Free.
- [ ] **39. Promote to Closed testing** with 12+ testers for 14 days if this is a personal developer account (Play requires it before production access).
- [ ] **40. Submit for review.** Expect 3–7 days for a first submission. Keep the reviewer account alive and `AI_ENABLED=true` for the whole window.

---

## Appendix — character counts at a glance

| Field | Language | Chosen value | Chars | Limit |
|---|---|---|---|---|
| App name | ar | `ثقتي — تدريب مقابلات العمل` | 26 | 30 |
| App name | en-GB | `Thiqty: AI Interview Practice` | 29 | 30 |
| Short description | ar | `أسئلة مقابلات واقعية بالعربية، وتقييم فوري لكل إجابة مع إجابة نموذجية.` | 70 | 80 |
| Short description | en-GB | `Realistic Arabic job-interview questions with instant AI feedback on answers.` | 77 | 80 |
| Full description | ar | see §1.3 | 1,863 | 4,000 |
| Full description | en-GB | see §2.3 | 2,380 | 4,000 |

Counts are Unicode code points, measured with `[...str].length`. Play counts the same way.
Arabic diacritics (the shadda in `تدرّب`, the tanwin in `فورًا`) each count as one character —
they are included above.
