/* eslint-disable no-console */
// Large-dataset seed for InterviewAI Arabia — uses mysql2 directly (not Prisma).
// Why: Prisma 5's library engine panics with "timer has gone away" on
// Hostinger's OpenSSL 1.1.x environment. mysql2 is a pure protocol client
// with no native engine dependency, so it Just Works.
// Idempotent: writes a flag row into app_settings so re-runs skip.

import 'dotenv/config';
import bcrypt from 'bcrypt';
import mysql from 'mysql2/promise';

const FLAG_KEY = 'seed_big_completed_v1';

// --------------------------------------------------------------------------
// Bilingual question bank — ~45 questions per category, ~315 total new rows.
// --------------------------------------------------------------------------
const QUESTIONS = {
  1: [ // برمجة — Programming
    ['ما لغة البرمجة المفضلة لديك ولماذا؟', 'What is your favorite programming language and why?', 'easy'],
    ['اشرح الفرق بين المتغير والثابت.', 'Explain variable vs constant.', 'easy'],
    ['ما الفرق بين JavaScript و TypeScript؟', 'JavaScript vs TypeScript?', 'easy'],
    ['عرّف API.', 'Define API.', 'easy'],
    ['ما الفرق بين GET و POST في HTTP؟', 'GET vs POST HTTP methods?', 'easy'],
    ['كيف تصحّح خطأ في كود لم تكتبه أنت؟', 'How do you debug unfamiliar code?', 'easy'],
    ['ما معنى IDE وأهميته؟', 'What is an IDE and why it matters?', 'easy'],
    ['عرّف Stack و Queue بإيجاز.', 'Briefly define Stack and Queue.', 'easy'],
    ['ما أنواع قواعد البيانات التي تعرفها؟', 'Types of databases you know?', 'easy'],
    ['ما الفرق بين Compiler و Interpreter؟', 'Compiler vs Interpreter?', 'easy'],
    ['اشرح مبدأ DRY في البرمجة.', 'Explain the DRY principle.', 'medium'],
    ['ما الفرق بين البرمجة التزامنية وغير التزامنية؟', 'Sync vs async programming?', 'medium'],
    ['اشرح Big-O notation مع مثال.', 'Explain Big-O notation with example.', 'medium'],
    ['ما الفرق بين REST و GraphQL؟', 'REST vs GraphQL?', 'medium'],
    ['كيف تتعامل مع تسريب الذاكرة Memory Leak؟', 'How to handle a memory leak?', 'medium'],
    ['اشرح مفهوم Dependency Injection.', 'Explain Dependency Injection.', 'medium'],
    ['ما الفرق بين Process و Thread؟', 'Process vs Thread?', 'medium'],
    ['كيف تضمن أمان API؟', 'How to secure an API?', 'medium'],
    ['اشرح JWT وكيف يعمل.', 'Explain JWT and how it works.', 'medium'],
    ['ما هو SQL Injection وكيفية الحماية؟', 'What is SQL Injection and how to prevent it?', 'medium'],
    ['ما الفرق بين Monolith و Microservices؟', 'Monolith vs Microservices?', 'medium'],
    ['كيف تُجري Code Review احترافية؟', 'How to conduct a professional code review?', 'medium'],
    ['اشرح CAP Theorem.', 'Explain CAP Theorem.', 'medium'],
    ['ما الفرق بين Indexing و Sharding؟', 'Indexing vs Sharding?', 'medium'],
    ['كيف تصمم قاعدة بيانات لمتجر إلكتروني؟', 'Design a DB for e-commerce store.', 'medium'],
    ['ما الفرق بين Cookies و LocalStorage و SessionStorage؟', 'Cookies vs LocalStorage vs SessionStorage?', 'medium'],
    ['اشرح Event Loop في JavaScript.', 'Explain JavaScript Event Loop.', 'medium'],
    ['ما هي Design Patterns وأيها استخدمت؟', 'What design patterns have you used?', 'medium'],
    ['ما هو Docker وكيف يختلف عن VMs؟', 'Docker vs VMs?', 'medium'],
    ['اشرح CI/CD Pipeline.', 'Explain CI/CD pipeline.', 'medium'],
    ['كيف تتعامل مع N+1 queries؟', 'How to handle N+1 queries?', 'hard'],
    ['صمّم URL shortener يخدم مليار طلب يوميًا.', 'Design a URL shortener for 1B requests/day.', 'hard'],
    ['كيف تضمن اتساق البيانات في نظام موزّع؟', 'Data consistency in distributed system?', 'hard'],
    ['اشرح OAuth 2.0 مراحله الكاملة.', 'Explain full OAuth 2.0 flow.', 'hard'],
    ['صمّم نظام بث فيديو مباشر لملايين المشاهدين.', 'Design live streaming for millions of viewers.', 'hard'],
    ['كيف تُصلح تطبيقًا ببطء متقطع في الإنتاج؟', 'Fix an app with intermittent production slowness.', 'hard'],
    ['اشرح استراتيجية Blue/Green Deployment.', 'Explain Blue/Green Deployment.', 'hard'],
    ['ما الفرق بين Optimistic و Pessimistic Locking؟', 'Optimistic vs Pessimistic Locking?', 'hard'],
    ['كيف تتعامل مع Race Conditions؟', 'Handling race conditions?', 'hard'],
    ['صمّم بنية قاعدة بيانات لشبكة تواصل اجتماعي.', 'Design DB for a social network.', 'hard'],
    ['كيف تنقل قاعدة بيانات حيّة دون توقف الخدمة؟', 'Zero-downtime DB migration?', 'hard'],
    ['اشرح Circuit Breaker Pattern ومتى تستخدمه.', 'Explain Circuit Breaker Pattern.', 'hard'],
    ['ما هي Eventual Consistency ومتى تُقبل؟', 'What is eventual consistency, when acceptable?', 'hard'],
    ['كيف تبني نظام إشعارات لملايين المستخدمين؟', 'Notifications system for millions?', 'hard'],
    ['اشرح Kafka وسيناريو استخدامه.', 'Explain Kafka and use cases.', 'hard'],
  ],
  2: [ // محاسبة — Accounting
    ['ما أدوات المحاسبة التي تجيدها؟', 'Which accounting tools do you master?', 'easy'],
    ['عرّف الأصول والخصوم باختصار.', 'Define assets and liabilities.', 'easy'],
    ['ما الفرق بين الفاتورة الضريبية والعادية؟', 'Tax invoice vs ordinary invoice?', 'easy'],
    ['ما أنواع الحسابات في دليل الحسابات؟', 'Account types in chart of accounts?', 'easy'],
    ['عرّف قيد اليومية المركب.', 'Define compound journal entry.', 'easy'],
    ['ما الفرق بين Capex و Opex؟', 'Capex vs Opex?', 'easy'],
    ['كيف تُجري جرد مخازن بسيط؟', 'How to conduct simple inventory count?', 'easy'],
    ['عرّف معادلة المحاسبة الأساسية.', 'Fundamental accounting equation?', 'easy'],
    ['ما الفرق بين الربح والإيراد؟', 'Profit vs revenue?', 'easy'],
    ['اذكر مراحل الدورة المحاسبية.', 'Accounting cycle stages?', 'easy'],
    ['كيف تتعامل مع المخزون التالف محاسبيًا؟', 'Accounting for damaged inventory?', 'medium'],
    ['اشرح طرق حساب الإهلاك.', 'Methods of calculating depreciation.', 'medium'],
    ['ما الفرق بين LIFO و FIFO؟', 'LIFO vs FIFO?', 'medium'],
    ['كيف تُعد تقرير تدفّق نقدي؟', 'How to prepare a cash flow statement?', 'medium'],
    ['اشرح نسبة السيولة ونسبة الربحية.', 'Liquidity vs profitability ratios.', 'medium'],
    ['ما هو تحليل نقطة التعادل؟', 'What is break-even analysis?', 'medium'],
    ['كيف تعالج خطأ في قيد تم ترحيله؟', 'Correcting a posted journal entry.', 'medium'],
    ['اشرح مبدأ الحيطة والحذر.', 'Explain conservatism principle.', 'medium'],
    ['كيف تحسب COGS؟', 'How to calculate COGS?', 'medium'],
    ['ما دور المحاسب الإداري في اتخاذ القرار؟', 'Management accountant in decision-making?', 'medium'],
    ['اشرح المقارنة الأفقية والرأسية للقوائم المالية.', 'Horizontal vs vertical analysis.', 'medium'],
    ['ما هي ضريبة الدخل وكيف تُحتسب؟', 'What is income tax, how calculated?', 'medium'],
    ['اشرح الفرق بين المحاسبة المالية والإدارية.', 'Financial vs management accounting.', 'medium'],
    ['ما هي IFRS 15 وتطبيقاتها؟', 'What is IFRS 15?', 'medium'],
    ['كيف تتعامل مع العملات الأجنبية في الدفاتر؟', 'Handling foreign currencies in books.', 'medium'],
    ['صف كيف تُعد موازنة تقديرية لقسم جديد.', 'Budget for a new department.', 'medium'],
    ['ما أهمية المراجعة الداخلية للشركة؟', 'Importance of internal audit.', 'medium'],
    ['اشرح نظام ABC (Activity-Based Costing).', 'Explain Activity-Based Costing.', 'medium'],
    ['ما علاقة المحاسب بقسم الـ Compliance؟', 'Accountant and compliance?', 'medium'],
    ['كيف تحسب ROI؟', 'How to calculate ROI?', 'medium'],
    ['صف كيف تكتشف غشًا محاسبيًا.', 'How to detect accounting fraud.', 'hard'],
    ['اشرح المحاسبة عن عقود الإيجار وفق IFRS 16.', 'IFRS 16 lease accounting.', 'hard'],
    ['كيف تضع سياسة تسعير لشركة متعدد المنتجات؟', 'Pricing for multi-product manufacturer.', 'hard'],
    ['صف عملية إدماج مالي (financial merger).', 'Describe a financial merger.', 'hard'],
    ['كيف تعد تقريرًا لمجلس الإدارة عن مخاطر مالية؟', 'Financial risks report to board?', 'hard'],
    ['اشرح deferred tax واحتساباتها.', 'Explain deferred tax.', 'hard'],
    ['كيف تطبق IFRS 9 على الأدوات المالية؟', 'Apply IFRS 9 to financial instruments.', 'hard'],
    ['صف مشروع أتمتة محاسبية نفّذته.', 'Accounting automation project you led.', 'hard'],
    ['ما المعاملات داخل المجموعة (intercompany)؟', 'Intercompany transactions handling.', 'hard'],
    ['كيف تتعامل مع VAT في مشاريع متعددة الدول؟', 'VAT in multi-country projects?', 'hard'],
    ['صف موقفًا كشفت فيه خطأً ماليًا مهمًا قبل إقفال السنة.', 'Caught a significant error before year-end.', 'hard'],
    ['ما هو Transfer Pricing ولماذا يُراقَب؟', 'Transfer pricing and why monitored?', 'hard'],
  ],
  3: [ // تسويق — Marketing
    ['ما الفرق بين التسويق التقليدي والرقمي؟', 'Traditional vs digital marketing?', 'easy'],
    ['عرّف "جمهور مستهدف".', 'Define target audience.', 'easy'],
    ['ما مهام مدير التسويق في شركة ناشئة؟', 'Marketing manager duties at a startup?', 'easy'],
    ['أذكر 5 قنوات تسويقية تستخدمها.', 'Name 5 marketing channels.', 'easy'],
    ['ما معنى Call-to-Action؟', 'What is Call-to-Action?', 'easy'],
    ['ما هي منصات التواصل الأقوى لـ B2C في الشرق الأوسط؟', 'Strongest B2C platforms in MENA?', 'easy'],
    ['ما هو Hashtag ومتى يكون فعّالاً؟', 'What is a hashtag, when effective?', 'easy'],
    ['عرّف Niche و Mass market.', 'Define niche vs mass market.', 'easy'],
    ['ما هو Reach مقابل Impressions؟', 'Reach vs Impressions?', 'easy'],
    ['ما الفرق بين CPC و CPM؟', 'CPC vs CPM?', 'easy'],
    ['اشرح AIDA model.', 'Explain AIDA model.', 'medium'],
    ['كيف تخطط لحملة Facebook Ads بميزانية 5000 ج.م؟', 'Plan FB Ads with 5000 EGP budget.', 'medium'],
    ['ما هو Remarketing؟', 'What is remarketing?', 'medium'],
    ['كيف تقيس نجاح حملة إعلانية؟', 'Measuring campaign success?', 'medium'],
    ['اشرح قمع المبيعات الحديث.', 'Explain the modern sales funnel.', 'medium'],
    ['ما هي رحلة العميل؟', 'What is the customer journey?', 'medium'],
    ['كيف تختار بين Google Ads و Meta Ads؟', 'Google Ads vs Meta Ads choice?', 'medium'],
    ['ما هو Email Marketing؟', 'What is email marketing?', 'medium'],
    ['اشرح On-page و Off-page SEO.', 'On-page vs Off-page SEO.', 'medium'],
    ['كيف تحسّن Conversion Rate؟', 'Improve conversion rate?', 'medium'],
    ['ما KPIs للتسويق الرقمي؟', 'Digital marketing KPIs?', 'medium'],
    ['اشرح الفرق بين Branding و Performance Marketing.', 'Branding vs performance marketing.', 'medium'],
    ['كيف تبني محتوى فيروسي على TikTok؟', 'Viral TikTok content?', 'medium'],
    ['ما هي GA4 وتقاريرها؟', 'What is GA4?', 'medium'],
    ['كيف تبني Lead Magnet فعّال؟', 'Effective lead magnet?', 'medium'],
    ['اشرح Growth Hacking بمثال.', 'Explain growth hacking.', 'medium'],
    ['ما هي UGC؟', 'What is UGC?', 'medium'],
    ['اشرح Attribution Model في الإعلانات.', 'Explain attribution models.', 'medium'],
    ['كيف تحلّل المنافسين؟', 'How to analyze competitors?', 'medium'],
    ['ما الفرق بين Organic و Paid Reach؟', 'Organic vs paid reach.', 'medium'],
    ['صف إطلاق علامة تجارية جديدة في 3 شهور.', 'Launch a brand in 3 months.', 'hard'],
    ['كيف تنقذ علامة تجارية في أزمة؟', 'Save a brand in social media crisis.', 'hard'],
    ['استراتيجيتك لنمو متجر إلكتروني 10x سنويًا؟', 'Strategy to 10x an e-commerce store.', 'hard'],
    ['كيف تبني فريق تسويق من 5 أعضاء؟', 'Build a 5-person marketing team.', 'hard'],
    ['اشرح استراتيجية ABM (Account-Based Marketing).', 'Explain ABM.', 'hard'],
    ['صمّم خطة تسويقية لـ SaaS في الخليج.', 'Marketing plan for SaaS in GCC.', 'hard'],
    ['كيف تقيس Brand Equity؟', 'Measure brand equity?', 'hard'],
    ['صف حملة A/B testing نفّذتها.', 'A/B test you ran.', 'hard'],
    ['كيف توازن قصير وطويل الأمد في خطة تسويقية؟', 'Short vs long term in marketing plan.', 'hard'],
    ['ما هو MMM (Marketing Mix Modeling)؟', 'What is MMM?', 'hard'],
    ['صف قرار تسويقي اتخذته ببيانات خاطئة.', 'Decision made on bad data — what happened.', 'hard'],
  ],
  4: [ // موارد بشرية — HR
    ['ما الذي يحمّسك في مجال الموارد البشرية؟', 'What excites you about HR?', 'easy'],
    ['عرّف Onboarding وأهميته.', 'Define onboarding.', 'easy'],
    ['ما الفرق بين Recruitment و Talent Acquisition؟', 'Recruitment vs TA?', 'easy'],
    ['كيف تكتب وصفًا وظيفيًا فعّالاً؟', 'Write an effective JD.', 'easy'],
    ['ما هي أنواع إجازات الموظف وفق القانون المصري؟', 'Employee leave types in Egypt?', 'easy'],
    ['ما الفرق بين التوظيف الداخلي والخارجي؟', 'Internal vs external hiring?', 'easy'],
    ['اذكر 3 منصّات توظيف تستخدمها.', '3 recruitment platforms?', 'easy'],
    ['عرّف EVP (Employee Value Proposition).', 'Define EVP.', 'easy'],
    ['ما أهداف Exit Interview؟', 'Exit interview goals?', 'easy'],
    ['ما هو CV ATS-friendly؟', 'What is an ATS-friendly CV?', 'easy'],
    ['كيف تُجري تقييم أداء ربع سنوي؟', 'Quarterly performance review?', 'medium'],
    ['كيف تحدد الفجوة بين المهارات؟', 'Identify skill gaps?', 'medium'],
    ['اشرح Career Pathing.', 'Explain career pathing.', 'medium'],
    ['كيف توازن توظيف سريع مع جودة المرشحين؟', 'Speed vs candidate quality?', 'medium'],
    ['ما الفرق بين Hard Skills و Soft Skills؟', 'Hard vs soft skills?', 'medium'],
    ['كيف تبني سياسة Hybrid Work؟', 'Hybrid work policy?', 'medium'],
    ['ما أهمية Employer Branding؟', 'Importance of employer branding?', 'medium'],
    ['اشرح مصفوفة 9-box.', 'Explain 9-box matrix.', 'medium'],
    ['كيف تتعامل مع شكوى تحرّش؟', 'Handle a harassment complaint.', 'medium'],
    ['مراحل إعداد خطة التدريب السنوية؟', 'Annual training plan stages?', 'medium'],
    ['صف برنامج Mentorship فعّال.', 'Effective mentorship program.', 'medium'],
    ['ما معنى Total Rewards؟', 'What is Total Rewards?', 'medium'],
    ['كيف تحلل ارتفاع Turnover في قسم؟', 'Analyze high turnover in a department.', 'medium'],
    ['اشرح إنهاء عقد عمل بشكل قانوني وإنساني.', 'Legal and humane termination.', 'medium'],
    ['ما الفرق بين KPI و KRI و OKR؟', 'KPI vs KRI vs OKR?', 'medium'],
    ['كيف تستخدم Personality Tests في التوظيف؟', 'Personality tests in hiring?', 'medium'],
    ['ما هو Succession Planning؟', 'What is succession planning?', 'medium'],
    ['كيف تبني نظام حوافز عادل؟', 'Fair incentive system?', 'medium'],
    ['اشرح Internal Equity في الرواتب.', 'Explain internal equity.', 'medium'],
    ['كيف تُدير تسريح جماعي؟', 'Manage a mass layoff.', 'medium'],
    ['صمّم نظام أداء لشركة 200 موظف.', 'Perf system for 200-employee company.', 'hard'],
    ['كيف تغيّر ثقافة شركة عمرها 20 سنة؟', 'Change culture of a 20-year-old company.', 'hard'],
    ['استراتيجيتك لبناء DE&I؟', 'Your DE&I strategy?', 'hard'],
    ['صف أصعب قرار توظيف اتخذته.', 'Hardest hiring decision?', 'hard'],
    ['كيف تقيس ROI لأنشطة HR؟', 'Measure HR ROI?', 'hard'],
    ['صمّم نظام 360-degree.', 'Design 360-degree review.', 'hard'],
    ['احتفاظ المواهب التقنية في سوق تنافسي؟', 'Retain tech talent?', 'hard'],
    ['صف إدخال تقنية HR جديدة ضد مقاومة.', 'New HR tech against resistance.', 'hard'],
    ['دور HR Business Partner؟', 'HR Business Partner role?', 'hard'],
    ['تعامل مع سوء سلوك قياديّ دون تسريب؟', 'Senior misconduct without leaks.', 'hard'],
    ['صمّم Workforce Planning لسنتين.', '2-year workforce plan.', 'hard'],
  ],
  5: [ // خدمة عملاء — Customer Service
    ['أهم مهارة في موظف خدمة عملاء؟', 'Most important CS skill?', 'easy'],
    ['كيف ترد على "منتجك سيء"؟', 'Respond to "your product is bad".', 'easy'],
    ['عرّف SLA في خدمة العملاء.', 'Define SLA in CS.', 'easy'],
    ['قنوات خدمة العملاء التي تعرفها؟', 'CS channels you know?', 'easy'],
    ['كيف تحيّي عميلاً على الهاتف؟', 'Greet a customer on the phone.', 'easy'],
    ['متى تُحيل الشكوى للمدير؟', 'When to escalate to manager?', 'easy'],
    ['الفرق بين خدمة ما قبل وبعد البيع؟', 'Pre-sale vs post-sale service?', 'easy'],
    ['ما Tone of Voice في المحادثة؟', 'Tone of voice in conversation?', 'easy'],
    ['عرّف Customer Retention.', 'Define customer retention.', 'easy'],
    ['كيف تسجّل مكالمة بشكل احترافي؟', 'Log a call professionally.', 'easy'],
    ['كيف تتعامل مع عميل يُقاطعك باستمرار؟', 'Handle constant interrupter?', 'medium'],
    ['Empathy vs Sympathy عمليًا؟', 'Empathy vs sympathy in practice?', 'medium'],
    ['اشرح LAST (Listen-Apologize-Solve-Thank).', 'Explain LAST method.', 'medium'],
    ['كيف تسحب منتجًا مُعابًا دون إحراج؟', 'Recall defective product gracefully.', 'medium'],
    ['ما هو CSAT؟', 'What is CSAT?', 'medium'],
    ['ما هو NPS؟', 'What is NPS?', 'medium'],
    ['كيف تتعامل مع طلب خصم غير مسموح؟', 'Handle unauthorized discount request.', 'medium'],
    ['اشرح Call Flow في 5 خطوات.', 'Explain 5-step call flow.', 'medium'],
    ['عميل غاضب عن مشكلة قديمة؟', 'Angry returning customer about old issue?', 'medium'],
    ['ما هي Knowledge Base؟', 'What is a knowledge base?', 'medium'],
    ['تقليل AHT دون المساس بالجودة؟', 'Reduce AHT without quality loss.', 'medium'],
    ['Omnichannel vs Multichannel؟', 'Omnichannel vs Multichannel?', 'medium'],
    ['تدريب موظف جديد على العملاء الصعبين؟', 'Train new agent on tough customers.', 'medium'],
    ['Sentiment Analysis في خدمة العملاء؟', 'Sentiment analysis in CS?', 'medium'],
    ['استخدام البيانات لتحسين التجربة؟', 'Use data to improve CX?', 'medium'],
    ['اشرح FCR (First Contact Resolution).', 'Explain FCR.', 'medium'],
    ['تعامل مع موظف يعاني burnout؟', 'Team member facing burnout.', 'medium'],
    ['تحسين Self-Service لتقليل التذاكر؟', 'Improve self-service to cut tickets.', 'medium'],
    ['Help Desk vs Service Desk؟', 'Help desk vs service desk?', 'medium'],
    ['RACI Matrix في إدارة الخدمة؟', 'RACI matrix in CS?', 'medium'],
    ['عميل غاضب تحوّل إلى مروّج؟', 'Angry customer turned promoter.', 'hard'],
    ['فريق خدمة عملاء من 20 في 3 أشهر؟', 'Build 20-person CS team in 3 months.', 'hard'],
    ['تقليل Churn Rate بنسبة 20%؟', 'Reduce churn by 20%?', 'hard'],
    ['صمّم برنامج Voice of Customer.', 'Design VoC program.', 'hard'],
    ['قياس واستخدام CLV؟', 'Measure and use CLV.', 'hard'],
    ['مرة فشلت فيها مع عميل مهم؟', 'Time you failed a key customer.', 'hard'],
    ['دمج AI chatbot دون فقدان اللمسة الإنسانية؟', 'AI chatbot without losing human touch.', 'hard'],
    ['Service Recovery Paradox؟', 'Service recovery paradox?', 'hard'],
    ['إقناع الإدارة بالاستثمار في CX؟', 'Convince management to invest in CX.', 'hard'],
    ['SLA متدرج لفئات عملاء مختلفة؟', 'Tiered SLA for different segments.', 'hard'],
    ['تحويل خدمة العملاء من تكلفة إلى ربح؟', 'Turn CS from cost to profit center.', 'hard'],
  ],
  6: [ // مبيعات — Sales (premium)
    ['لماذا اخترت مجال المبيعات؟', 'Why did you choose sales?', 'easy'],
    ['فتح مكالمة مع عميل محتمل؟', 'Open a call with a prospect?', 'easy'],
    ['Outbound vs Inbound Sales؟', 'Outbound vs Inbound sales?', 'easy'],
    ['عرّف Sales Pipeline.', 'Define sales pipeline.', 'easy'],
    ['قياس نجاحك الشهري كمندوب؟', 'Measure monthly success as a rep?', 'easy'],
    ['Lead vs Prospect vs Customer؟', 'Lead vs Prospect vs Customer?', 'easy'],
    ['Cross-sell vs Upsell بمثال؟', 'Cross-sell vs upsell examples?', 'easy'],
    ['Elevator Pitch متى تستخدمه؟', 'Elevator pitch — when to use?', 'easy'],
    ['3 أدوات CRM تعرفها؟', '3 CRM tools?', 'easy'],
    ['مراحل عملية البيع الكلاسيكية؟', 'Classic sales process stages?', 'easy'],
    ['تعامل مع "ليس عندي ميزانية"؟', 'Handle "no budget" objection.', 'medium'],
    ['اشرح SPIN Selling.', 'Explain SPIN Selling.', 'medium'],
    ['تقنية BANT في التأهيل؟', 'BANT qualification?', 'medium'],
    ['كيف تبحث عن عملاء على LinkedIn؟', 'LinkedIn prospecting?', 'medium'],
    ['متابعة عميل متردد؟', 'Follow up hesitant prospect.', 'medium'],
    ['Social Selling متى يكون فعّالاً؟', 'Social selling — when works?', 'medium'],
    ['Consultative Selling؟', 'What is consultative selling?', 'medium'],
    ['Storytelling في البيع؟', 'Storytelling in selling?', 'medium'],
    ['تقنية Challenger Sale؟', 'Challenger Sale technique.', 'medium'],
    ['"سأفكر في الموضوع" — كيف تتعامل؟', 'Handle "I\'ll think about it".', 'medium'],
    ['Win-Loss Analysis؟', 'Win-loss analysis.', 'medium'],
    ['سعر العرض المبدئي؟', 'Set initial offer price?', 'medium'],
    ['Door-in-the-Face في التفاوض؟', 'Door-in-the-face technique.', 'medium'],
    ['Hard Close vs Soft Close؟', 'Hard close vs soft close?', 'medium'],
    ['خط أنابيب نموًا شهريًا؟', 'Monthly growing pipeline?', 'medium'],
    ['MEDDIC في B2B؟', 'MEDDIC in B2B?', 'medium'],
    ['علاقات طويلة مع Key Accounts؟', 'Long-term key account relationships.', 'medium'],
    ['Objection Handling Matrix؟', 'Objection handling matrix.', 'medium'],
    ['قراءة Buying Signals في الاجتماع؟', 'Reading buying signals.', 'medium'],
    ['قناة Partners/Resellers؟', 'Partners/resellers sales channel.', 'medium'],
    ['أكبر صفقة أغلقتها؟', 'Biggest deal closed?', 'hard'],
    ['صفقة متوقفة لشهرين؟', 'Deal stalled 2 months?', 'hard'],
    ['فتح سوق في دولة جديدة؟', 'Open a new country market.', 'hard'],
    ['خطة مبيعات ربع سنوية لـ10 مندوبين؟', 'Quarterly plan for 10-rep team.', 'hard'],
    ['منافس يعرض 30% أقل؟', 'Competitor offering 30% less.', 'hard'],
    ['خسارة عميل كبير — الدرس؟', 'Lost a big customer — lesson?', 'hard'],
    ['إقناع CFO شكوكي بقيمة المنتج؟', 'Convince skeptical CFO.', 'hard'],
    ['نظام عمولات يحفّز السلوك الصحيح؟', 'Commission system for right behavior.', 'hard'],
    ['رفع متوسط حجم الصفقة 50%؟', 'Grow average deal size 50%?', 'hard'],
    ['استخدام Data في اختيار مناطق المبيعات؟', 'Data to pick sales focus.', 'hard'],
    ['صراع بين مندوبين على عميل؟', 'Conflict between reps over a customer.', 'hard'],
  ],
  7: [ // تصميم — Design (premium)
    ['الأدوات التي تتقنها (Figma/XD/Sketch)؟', 'Which tools do you master?', 'easy'],
    ['الفرق بين UI و UX؟', 'UI vs UX?', 'easy'],
    ['عرّف User Persona.', 'Define user persona.', 'easy'],
    ['ما هو Wireframe؟', 'What is a wireframe?', 'easy'],
    ['عرّف Design System.', 'Define design system.', 'easy'],
    ['Typography Hierarchy وأحجامها؟', 'Typography hierarchy sizes?', 'easy'],
    ['ما معنى Responsive Design؟', 'What is responsive design?', 'easy'],
    ['3 مبادئ Gestalt؟', '3 Gestalt principles.', 'easy'],
    ['أهمية White Space؟', 'White space importance.', 'easy'],
    ['Color Theory بإيجاز؟', 'Color theory briefly.', 'easy'],
    ['User Interview فعّالة؟', 'Effective user interview?', 'medium'],
    ['Card Sorting متى؟', 'Card sorting — when?', 'medium'],
    ['مراحل Design Thinking؟', 'Design Thinking stages.', 'medium'],
    ['قياس Usability؟', 'Measure usability?', 'medium'],
    ['Heuristic Evaluation؟', 'Heuristic evaluation.', 'medium'],
    ['بناء User Flow من البداية؟', 'Build a user flow.', 'medium'],
    ['Information Architecture؟', 'Explain IA.', 'medium'],
    ['تصميم واجهة عربية RTL؟', 'Design Arabic RTL interface.', 'medium'],
    ['Atomic Design وفلسفته؟', 'Atomic design philosophy?', 'medium'],
    ['WCAG وأهميتها؟', 'WCAG and its importance?', 'medium'],
    ['طلب تعديل غير منطقي من عميل؟', 'Illogical client change request.', 'medium'],
    ['Motion Design في UX؟', 'Motion design in UX.', 'medium'],
    ['Dark Mode principles؟', 'Dark mode design principles?', 'medium'],
    ['Color Palette لتطبيق مصرفي؟', 'Palette for a banking app.', 'medium'],
    ['Skeuomorphism vs Flat vs Neumorphism؟', 'Skeuomorphism vs flat vs neumorphism.', 'medium'],
    ['A/B Test لزر شراء؟', 'A/B test a buy button.', 'medium'],
    ['Micro-interactions أمثلة؟', 'Micro-interactions examples.', 'medium'],
    ['اتساق التصميم في فريق 5؟', 'Consistency in 5-designer team.', 'medium'],
    ['Design Handoff للمطور؟', 'Design handoff to dev.', 'medium'],
    ['بناء Portfolio قوي؟', 'Strong design portfolio.', 'medium'],
    ['تطبيق حجز للعيادات لكبار السن؟', 'Clinic booking for elderly.', 'hard'],
    ['فريق Dev يرفض تطبيق تصميمك؟', 'Devs refuse to implement design.', 'hard'],
    ['إعادة تصميم منتج عمره 10 سنوات؟', 'Redesign 10-year-old product.', 'hard'],
    ['Design System لـ5 منتجات؟', 'Multi-product design system.', 'hard'],
    ['قياس ROI للتصميم؟', 'Measure design ROI.', 'hard'],
    ['أصعب تحدي تصميمي؟', 'Hardest design challenge.', 'hard'],
    ['تضارب متطلبات مستخدم وعميل؟', 'Conflict user vs client needs.', 'hard'],
    ['تصميم onboarding لتطبيق مالي؟', 'Onboarding for fintech.', 'hard'],
    ['دمج AI في التصميم؟', 'Integrate AI in design workflows.', 'hard'],
    ['أكبر خطأ في تصميم مُطلق؟', 'Biggest mistake in shipped design.', 'hard'],
    ['قيادة نقاش تصميمي مع مدراء غير تقنيين؟', 'Design discussion with non-tech managers.', 'hard'],
  ],
};

const ARABIC_NAMES = [
  'أحمد محمد',   'سارة إبراهيم', 'محمد علي',    'فاطمة حسن',    'عمر خالد',
  'نور الدين',    'يوسف أشرف',   'مريم سامي',   'طارق منير',    'هاجر صلاح',
  'كريم فاروق',   'دينا مصطفى',   'هشام رضا',    'ليلى عبدالله',  'باسم سعيد',
  'جميلة أنور',   'سامح زكي',    'رانيا نبيل',   'عادل شريف',    'نجلاء حمدي',
  'شريف لبيب',   'منى وهبة',    'طه جمال',     'هدى إسماعيل',   'مازن رفعت',
  'سمر عطية',    'خالد رمزي',   'أسماء ياسر',   'وليد حافظ',    'نادية فؤاد',
];
const PLANS = ['free', 'free', 'free', 'free', 'premium'];
const LANGS = ['ar', 'ar', 'ar', 'en'];

const STRENGTHS = [
  'إجابة منظمة وواضحة',
  'استخدام مصطلحات مهنية دقيقة',
  'تقديم أمثلة ملموسة من الخبرة',
  'إظهار تفكير منهجي',
  'التواصل بثقة ودون تردد',
  'الربط بين المفهوم والتطبيق العملي',
  'الاعتراف بالقيود بشكل احترافي',
];
const WEAKNESSES = [
  'الإجابة مختصرة جدًا — تحتاج تفصيلاً أكثر',
  'لم يتم ذكر أمثلة محددة من الخبرة الشخصية',
  'بعض المصطلحات استُخدمت بشكل غير دقيق',
  'الترتيب المنطقي للأفكار يحتاج تحسينًا',
  'ضعف في إبراز النتائج القابلة للقياس',
  'الإجابة نظرية أكثر من اللازم',
];
const IMPROVEMENTS = [
  'ابدأ بتلخيص الفكرة في جملة واحدة، ثم فصّل.',
  'استخدم قاعدة STAR (Situation, Task, Action, Result).',
  'اذكر أرقامًا وقياسات كلما أمكن لإثبات أثرك.',
  'حضّر 3-5 قصص نجاح جاهزة قبل المقابلة.',
  'اربط إجابتك بقيم الشركة ومجالها.',
];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[randInt(0, arr.length - 1)]; }
function pickN(arr, n) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length; i++) out.push(copy.splice(randInt(0, copy.length - 1), 1)[0]);
  return out;
}
function fakeFeedback(score) {
  return JSON.stringify({
    score,
    strengths: pickN(STRENGTHS, score >= 8 ? 3 : 2),
    weaknesses: pickN(WEAKNESSES, score >= 8 ? 1 : 2),
    improvement: pick(IMPROVEMENTS),
    model_answer: 'إجابة نموذجية: ابدأ بالسياق، اذكر الإجراء، ثم النتيجة القابلة للقياس.',
    seeded: true,
  });
}

// --------------------------------------------------------------------------
// Build the mysql2 connection from DATABASE_URL. We don't import Prisma.
// --------------------------------------------------------------------------
function parseDatabaseUrl(url) {
  const m = url.match(/^mysql:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/(.+)$/);
  if (!m) throw new Error('DATABASE_URL not in mysql://user:pass@host:port/db form');
  return {
    user: decodeURIComponent(m[1]),
    password: decodeURIComponent(m[2]),
    host: m[3],
    port: Number(m[4]),
    database: m[5],
  };
}

async function main() {
  const cfg = parseDatabaseUrl(process.env.DATABASE_URL);
  const db = await mysql.createConnection({ ...cfg, multipleStatements: false, charset: 'utf8mb4' });

  const [[flag]] = await db.query('SELECT `value` FROM app_settings WHERE `key` = ?', [FLAG_KEY]);
  if (flag) {
    console.log(`Skipping: ${FLAG_KEY} flag already set. Delete the row in app_settings to re-run.`);
    await db.end();
    return;
  }

  console.log('Seeding large dataset via mysql2 (bypassing Prisma)...');

  // -------- questions --------
  let qCount = 0;
  for (const [categoryId, rows] of Object.entries(QUESTIONS)) {
    const values = rows.map(([ar, en, diff]) => [Number(categoryId), ar, en, diff, 1]);
    const [r] = await db.query(
      'INSERT INTO questions (category_id, question_ar, question_en, difficulty, is_active) VALUES ?',
      [values]
    );
    qCount += r.affectedRows;
  }
  console.log(`  + ${qCount} questions`);

  // -------- users --------
  const pwd = await bcrypt.hash('TestUser@2025', 10);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const userValues = ARABIC_NAMES.map((name, i) => [
    `user${i + 1}@example.com`,
    pwd,
    name,
    pick(LANGS),
    pick(PLANS),
    randInt(0, 4),
    today,
    0,
  ]);
  const [uRes] = await db.query(
    'INSERT IGNORE INTO users (email, password_hash, name, language, plan, daily_questions_used, last_reset_date, is_disabled) VALUES ?',
    [userValues]
  );
  console.log(`  + ${uRes.affectedRows} users`);

  // -------- sessions + answers --------
  const [users] = await db.query('SELECT id, plan FROM users WHERE email LIKE "user%@example.com"');
  const [categories] = await db.query('SELECT id, is_premium FROM categories');
  let sCount = 0, aCount = 0;
  for (const user of users) {
    const n = randInt(1, 7);
    for (let i = 0; i < n; i++) {
      const cat = pick(categories);
      if (cat.is_premium && user.plan !== 'premium') continue;
      const [qs] = await db.query(
        'SELECT id FROM questions WHERE category_id = ? AND is_active = 1 ORDER BY usage_count ASC LIMIT ?',
        [cat.id, randInt(3, 6)]
      );
      if (!qs.length) continue;
      const startedAt = new Date(Date.now() - randInt(0, 60) * 86400_000 - randInt(0, 86400_000));
      const endedAt = new Date(startedAt.getTime() + randInt(5, 30) * 60_000);
      const scores = qs.map(() => randInt(3, 10));
      const total = scores.reduce((a, b) => a + b, 0);

      const [sr] = await db.query(
        'INSERT INTO sessions (user_id, category_id, total_score, started_at, ended_at) VALUES (?, ?, ?, ?, ?)',
        [user.id, cat.id, total, startedAt, endedAt]
      );
      const sessionId = sr.insertId;

      const answerRows = qs.map((q, idx) => [
        sessionId,
        q.id,
        'إجابة تجريبية للتدريب على منصة InterviewAI Arabia.',
        scores[idx],
        fakeFeedback(scores[idx]),
        randInt(200, 800),
        new Date(startedAt.getTime() + (idx + 1) * 3 * 60_000),
      ]);
      const [ar] = await db.query(
        'INSERT INTO answers (session_id, question_id, user_answer, ai_score, ai_feedback, tokens_used, created_at) VALUES ?',
        [answerRows]
      );
      sCount++;
      aCount += ar.affectedRows;
    }
  }
  console.log(`  + ${sCount} sessions, ${aCount} answers`);

  // -------- subscriptions --------
  const [premium] = await db.query('SELECT id FROM users WHERE plan = "premium"');
  let subCount = 0;
  for (const u of premium) {
    const isYearly = Math.random() < 0.3;
    await db.query(
      `INSERT IGNORE INTO subscriptions (user_id, google_purchase_token, product_id, status, started_at, expires_at, raw_payload)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      [
        u.id,
        `seed-${u.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        isYearly ? 'interviewai_yearly' : 'interviewai_monthly',
        new Date(Date.now() - randInt(1, 20) * 86400_000),
        new Date(Date.now() + (isYearly ? 365 : 30) * 86400_000),
        JSON.stringify({ seeded: true }),
      ]
    );
    subCount++;
  }
  console.log(`  + ${subCount} subscriptions`);

  // -------- mark complete --------
  await db.query(
    'INSERT INTO app_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
    [FLAG_KEY, JSON.stringify({ at: new Date().toISOString(), q: qCount, u: uRes.affectedRows, s: sCount, a: aCount })]
  );

  await db.end();
  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
