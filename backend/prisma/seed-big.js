/* eslint-disable no-console */
// Large-dataset seed for InterviewAI Arabia.
// Idempotent: writes a flag row to app_settings so re-runs skip the heavy work.
// Run: node prisma/seed-big.js

import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FLAG_KEY = 'seed_big_completed_v1';

// --------------------------------------------------------------------------
// Bilingual question bank — ~50 questions per category, total ~350 new rows.
// Ordered easy → medium → hard within each category.
// --------------------------------------------------------------------------
const QUESTIONS = {
  1: [ // برمجة — Programming
    ['ما لغة البرمجة المفضلة لديك ولماذا؟', 'What is your favorite programming language and why?', 'easy'],
    ['اشرح الفرق بين المتغير والثابت.', 'Explain the difference between variable and constant.', 'easy'],
    ['ما الفرق بين JavaScript و TypeScript؟', 'Difference between JavaScript and TypeScript?', 'easy'],
    ['عرّف مصطلح API.', 'Define the term API.', 'easy'],
    ['ما الفرق بين GET و POST في HTTP؟', 'Difference between GET and POST HTTP methods?', 'easy'],
    ['كيف تصحّح خطأ في كود لم تكتبه أنت؟', 'How do you debug code you did not write?', 'easy'],
    ['ما معنى IDE وما أهميته؟', 'What is an IDE and why is it important?', 'easy'],
    ['عرّف Stack و Queue بإيجاز.', 'Briefly define Stack and Queue.', 'easy'],
    ['ما أنواع قواعد البيانات التي تعرفها؟', 'What types of databases do you know?', 'easy'],
    ['ما الفرق بين Compiler و Interpreter؟', 'Compiler vs Interpreter?', 'easy'],
    ['اشرح مبدأ DRY في البرمجة.', 'Explain the DRY principle in programming.', 'medium'],
    ['ما الفرق بين البرمجة التزامنية والبرمجة غير التزامنية؟', 'Synchronous vs asynchronous programming?', 'medium'],
    ['اشرح Big-O notation مع مثال.', 'Explain Big-O notation with an example.', 'medium'],
    ['ما الفرق بين REST و GraphQL؟', 'REST vs GraphQL?', 'medium'],
    ['كيف تتعامل مع مشكلة تسريب الذاكرة Memory Leak؟', 'How do you handle a memory leak?', 'medium'],
    ['اشرح مفهوم Dependency Injection.', 'Explain Dependency Injection.', 'medium'],
    ['ما الفرق بين Process و Thread؟', 'Process vs Thread?', 'medium'],
    ['كيف تضمن أمان API الذي تطوّره؟', 'How do you secure an API you develop?', 'medium'],
    ['اشرح JWT وكيف يعمل.', 'Explain JWT and how it works.', 'medium'],
    ['ما الفرق بين SQL Injection وحمايته؟', 'What is SQL Injection and how to prevent it?', 'medium'],
    ['ما الفرق بين Monolith و Microservices؟', 'Monolith vs Microservices?', 'medium'],
    ['كيف تُجري Code Review احترافية؟', 'How do you conduct a professional code review?', 'medium'],
    ['اشرح CAP Theorem.', 'Explain CAP Theorem.', 'medium'],
    ['ما الفرق بين Indexing و Sharding في قواعد البيانات؟', 'Indexing vs Sharding in databases?', 'medium'],
    ['كيف تصمم قاعدة بيانات لمتجر إلكتروني؟', 'How would you design a database for an e-commerce store?', 'medium'],
    ['ما الفرق بين Cookies و LocalStorage و SessionStorage؟', 'Cookies vs LocalStorage vs SessionStorage?', 'medium'],
    ['اشرح Event Loop في JavaScript.', 'Explain the JavaScript Event Loop.', 'medium'],
    ['ما هي Design Patterns وأيها استخدمت؟', 'What are design patterns and which have you used?', 'medium'],
    ['ما هو Docker وكيف يختلف عن VMs؟', 'What is Docker and how does it differ from VMs?', 'medium'],
    ['اشرح CI/CD Pipeline.', 'Explain CI/CD pipeline.', 'medium'],
    ['كيف تتعامل مع مشكلة N+1 queries؟', 'How do you handle the N+1 queries problem?', 'hard'],
    ['صمّم نظامًا لقصر رابط (URL shortener) يخدم مليار طلب يوميًا.', 'Design a URL shortener handling 1B requests/day.', 'hard'],
    ['كيف تضمن اتساق البيانات في نظام موزّع؟', 'How do you ensure data consistency in a distributed system?', 'hard'],
    ['اشرح OAuth 2.0 مراحله الكاملة.', 'Explain the full OAuth 2.0 flow.', 'hard'],
    ['صمّم نظامًا لبث فيديو مباشر لملايين المشاهدين.', 'Design a live streaming system for millions of viewers.', 'hard'],
    ['كيف تُصلح تطبيقًا يعاني من بطء متقطع في الإنتاج؟', 'How do you fix an app with intermittent production slowness?', 'hard'],
    ['اشرح استراتيجية Blue/Green Deployment.', 'Explain Blue/Green Deployment strategy.', 'hard'],
    ['ما الفرق بين Optimistic و Pessimistic Locking؟', 'Optimistic vs Pessimistic Locking?', 'hard'],
    ['كيف تتعامل مع Race Conditions في تطبيق متعدد المستخدمين؟', 'How do you handle race conditions in a multi-user app?', 'hard'],
    ['صمّم بنية قاعدة بيانات لشبكة تواصل اجتماعي.', 'Design a database architecture for a social network.', 'hard'],
    ['كيف تنقل قاعدة بيانات حيّة دون توقف الخدمة (zero-downtime migration)؟', 'How do you migrate a live DB with zero downtime?', 'hard'],
    ['اشرح Circuit Breaker Pattern ومتى تستخدمه.', 'Explain Circuit Breaker Pattern and when to use it.', 'hard'],
    ['ما هي Eventual Consistency ومتى تُقبل؟', 'What is eventual consistency and when is it acceptable?', 'hard'],
    ['كيف تبني نظام إشعارات (notifications) يخدم ملايين المستخدمين؟', 'How do you build a notifications system for millions of users?', 'hard'],
    ['اشرح Kafka وسيناريو استخدامه.', 'Explain Kafka and its use cases.', 'hard'],
  ],
  2: [ // محاسبة — Accounting
    ['ما هي أدوات المحاسبة التي تجيدها (Excel, QuickBooks, SAP)؟', 'Which accounting tools do you master (Excel, QuickBooks, SAP)?', 'easy'],
    ['عرّف الأصول والخصوم باختصار.', 'Briefly define assets and liabilities.', 'easy'],
    ['ما الفرق بين الفاتورة الضريبية والفاتورة العادية؟', 'Tax invoice vs ordinary invoice?', 'easy'],
    ['ما أنواع الحسابات في دليل الحسابات؟', 'Types of accounts in a chart of accounts?', 'easy'],
    ['عرّف قيد اليومية المركب.', 'Define a compound journal entry.', 'easy'],
    ['ما الفرق بين المصروف الرأسمالي والمصروف التشغيلي؟', 'Capital expenditure vs operating expenditure?', 'easy'],
    ['كيف تُجري جرد مخازن بسيط؟', 'How do you conduct a simple inventory count?', 'easy'],
    ['عرّف معادلة المحاسبة الأساسية.', 'Define the fundamental accounting equation.', 'easy'],
    ['ما الفرق بين الربح والإيراد؟', 'Profit vs revenue?', 'easy'],
    ['اذكر مراحل الدورة المحاسبية.', 'List the stages of the accounting cycle.', 'easy'],
    ['كيف تتعامل مع المخزون التالف محاسبيًا؟', 'How do you account for damaged inventory?', 'medium'],
    ['اشرح طرق حساب الإهلاك.', 'Explain methods of calculating depreciation.', 'medium'],
    ['ما الفرق بين LIFO و FIFO؟', 'LIFO vs FIFO?', 'medium'],
    ['كيف تُعد تقرير تدفّق نقدي؟', 'How do you prepare a cash flow statement?', 'medium'],
    ['اشرح نسبة السيولة ونسبة الربحية.', 'Explain liquidity and profitability ratios.', 'medium'],
    ['ما هو تحليل نقطة التعادل (Break-even)؟', 'What is break-even analysis?', 'medium'],
    ['كيف تعالج خطأ في قيد تم ترحيله؟', 'How do you correct a posted journal entry error?', 'medium'],
    ['اشرح مبدأ الحيطة والحذر.', 'Explain the conservatism principle.', 'medium'],
    ['كيف تحسب تكلفة البضاعة المباعة (COGS)؟', 'How do you calculate COGS?', 'medium'],
    ['ما دور المحاسب الإداري في اتخاذ القرار؟', 'Role of the management accountant in decision-making?', 'medium'],
    ['اشرح المقارنة الأفقية والرأسية للقوائم المالية.', 'Horizontal vs vertical analysis of financial statements?', 'medium'],
    ['ما هي ضريبة الدخل وكيف تُحتسب على الشركات؟', 'What is income tax and how is it calculated for companies?', 'medium'],
    ['اشرح الفرق بين المحاسبة المالية والإدارية.', 'Financial vs management accounting?', 'medium'],
    ['ما هي IFRS 15 وتطبيقاتها؟', 'What is IFRS 15 and its applications?', 'medium'],
    ['كيف تتعامل مع العملات الأجنبية في الدفاتر؟', 'How do you handle foreign currencies in the books?', 'medium'],
    ['صف كيف تُعد موازنة تقديرية لقسم جديد.', 'How do you prepare a budget for a new department?', 'medium'],
    ['ما أهمية المراجعة الداخلية للشركة؟', 'Importance of internal audit for a company?', 'medium'],
    ['اشرح نظام ABC (Activity-Based Costing).', 'Explain Activity-Based Costing (ABC).', 'medium'],
    ['ما علاقة المحاسب بقسم الـ Compliance؟', 'Relationship between accountant and compliance?', 'medium'],
    ['كيف تحسب Return on Investment (ROI)؟', 'How do you calculate ROI?', 'medium'],
    ['صف كيف تكتشف غشًا محاسبيًا مموّهًا بعناية.', 'How do you detect carefully disguised accounting fraud?', 'hard'],
    ['اشرح المحاسبة عن عقود الإيجار وفق IFRS 16.', 'Accounting for leases under IFRS 16?', 'hard'],
    ['كيف تضع سياسة تسعير لشركة تصنيع متعدد المنتجات؟', 'How do you set pricing for a multi-product manufacturer?', 'hard'],
    ['صف عملية إدماج مالي (financial merger) من منظور محاسب.', 'Describe a financial merger from an accountant\'s perspective.', 'hard'],
    ['كيف تعد تقريرًا لمجلس الإدارة عن مخاطر مالية؟', 'How do you prepare a financial risks report for the board?', 'hard'],
    ['اشرح deferred tax واحتساباتها.', 'Explain deferred tax and its calculations.', 'hard'],
    ['كيف تطبق معايير IFRS 9 على الأدوات المالية؟', 'How to apply IFRS 9 to financial instruments?', 'hard'],
    ['صف مشروع أتمتة محاسبية نفّذته.', 'Describe an accounting automation project you delivered.', 'hard'],
    ['ما هي المعاملات داخل المجموعة (intercompany) وكيف تُعالج؟', 'What are intercompany transactions and how to handle them?', 'hard'],
    ['كيف تتعامل مع ضريبة القيمة المضافة في مشاريع متعددة الدول؟', 'How to handle VAT in multi-country projects?', 'hard'],
    ['صف موقفًا كشفت فيه خطأً ماليًا مهمًا قبل إقفال السنة.', 'Describe a time you caught a significant error before year-end close.', 'hard'],
    ['ما هو Transfer Pricing ولماذا يُراقَب؟', 'What is transfer pricing and why is it monitored?', 'hard'],
  ],
  3: [ // تسويق — Marketing
    ['ما الفرق بين التسويق التقليدي والرقمي؟', 'Traditional vs digital marketing?', 'easy'],
    ['عرّف "جمهور مستهدف".', 'Define "target audience".', 'easy'],
    ['ما مهام مدير التسويق في شركة ناشئة؟', 'Marketing manager duties at a startup?', 'easy'],
    ['أذكر 5 قنوات تسويقية تستخدمها.', 'Name 5 marketing channels you use.', 'easy'],
    ['ما معنى Call-to-Action؟', 'What is a Call-to-Action?', 'easy'],
    ['ما هي منصات التواصل الأقوى لـ B2C في الشرق الأوسط؟', 'Strongest B2C social platforms in the Middle East?', 'easy'],
    ['ما هو الـ Hashtag ومتى يكون فعّالاً؟', 'What is a hashtag and when is it effective?', 'easy'],
    ['عرّف السوق المستهدف (Niche) وعامّته (Mass market).', 'Define niche vs mass market.', 'easy'],
    ['ما هو الـ Reach مقابل الـ Impressions؟', 'Reach vs Impressions?', 'easy'],
    ['ما الفرق بين CPC و CPM؟', 'CPC vs CPM?', 'easy'],
    ['اشرح AIDA model في التسويق.', 'Explain the AIDA model in marketing.', 'medium'],
    ['كيف تخطط لحملة Facebook Ads بميزانية 5000 ج.م؟', 'How do you plan a Facebook Ads campaign on a 5000 EGP budget?', 'medium'],
    ['ما هو Remarketing وكيف تستخدمه؟', 'What is remarketing and how to use it?', 'medium'],
    ['كيف تقيس نجاح حملة إعلانية؟', 'How do you measure campaign success?', 'medium'],
    ['اشرح قمع المبيعات الحديث.', 'Explain the modern sales funnel.', 'medium'],
    ['ما هي رحلة العميل (Customer Journey)؟', 'What is the customer journey?', 'medium'],
    ['كيف تختار بين Google Ads و Meta Ads لمنتج معين؟', 'How do you choose between Google Ads and Meta Ads?', 'medium'],
    ['ما هو Email Marketing وكيف تزيد معدل الفتح؟', 'Email marketing — how to boost open rate?', 'medium'],
    ['اشرح محركات البحث SEO (On-page و Off-page).', 'Explain SEO (on-page and off-page).', 'medium'],
    ['كيف تحسّن Conversion Rate على موقع ويب؟', 'How do you improve website conversion rate?', 'medium'],
    ['ما هي مقاييس KPIs للتسويق الرقمي؟', 'Digital marketing KPIs?', 'medium'],
    ['اشرح الفرق بين Branding و Performance Marketing.', 'Branding vs performance marketing?', 'medium'],
    ['كيف تبني محتوى فيروسي على TikTok؟', 'How do you create viral TikTok content?', 'medium'],
    ['ما هي Google Analytics 4 وأهم تقاريرها؟', 'What is GA4 and its key reports?', 'medium'],
    ['كيف تبني Lead Magnet فعّال؟', 'How to build an effective lead magnet?', 'medium'],
    ['اشرح Growth Hacking بمثال.', 'Explain growth hacking with an example.', 'medium'],
    ['ما هي UGC وكيف تحفّز إنتاجها؟', 'What is UGC and how to encourage it?', 'medium'],
    ['اشرح Attribution Model في الإعلانات الرقمية.', 'Explain attribution models in digital ads.', 'medium'],
    ['كيف تحلّل المنافسين؟', 'How do you analyze competitors?', 'medium'],
    ['ما الفرق بين Organic و Paid Reach؟', 'Organic vs paid reach?', 'medium'],
    ['صف إطلاق علامة تجارية جديدة من الصفر في 3 شهور.', 'Describe launching a new brand from scratch in 3 months.', 'hard'],
    ['كيف تنقذ علامة تجارية تعرّضت لأزمة على وسائل التواصل؟', 'How to save a brand facing a social media crisis?', 'hard'],
    ['ما استراتيجيتك لنمو متجر إلكتروني صغير لـ 10x خلال سنة؟', 'Your strategy to 10x a small e-commerce store in a year?', 'hard'],
    ['كيف تبني فريق تسويق متكامل من 5 أعضاء؟', 'How to build a 5-person marketing team?', 'hard'],
    ['اشرح استراتيجية ABM (Account-Based Marketing).', 'Explain Account-Based Marketing (ABM).', 'hard'],
    ['صمّم خطة تسويقية لمنتج SaaS موجّه للشركات في الخليج.', 'Design a marketing plan for a SaaS product targeting GCC businesses.', 'hard'],
    ['كيف تقيس Brand Equity؟', 'How do you measure brand equity?', 'hard'],
    ['صف حملة A/B testing نفّذتها وما تعلّمته.', 'Describe an A/B test you ran and what you learned.', 'hard'],
    ['كيف توازن بين المدى القصير والطويل في خطة تسويقية؟', 'How to balance short-term and long-term in a marketing plan?', 'hard'],
    ['ما هو Marketing Mix Modeling (MMM) ومتى تستخدمه؟', 'What is MMM and when to use it?', 'hard'],
    ['صف قرار تسويقي اتخذته بناءً على بيانات خاطئة وماذا فعلت.', 'Describe a marketing decision you made on bad data — what did you do?', 'hard'],
  ],
  4: [ // موارد بشرية — HR
    ['ما الذي يحمّسك في مجال الموارد البشرية؟', 'What excites you about HR?', 'easy'],
    ['عرّف Onboarding وأهميته.', 'Define onboarding and its importance.', 'easy'],
    ['ما الفرق بين Recruitment و Talent Acquisition؟', 'Recruitment vs talent acquisition?', 'easy'],
    ['كيف تكتب وصفًا وظيفيًا فعّالاً؟', 'How to write an effective job description?', 'easy'],
    ['ما هي أنواع إجازات الموظف وفق القانون المصري؟', 'Types of employee leave under Egyptian law?', 'easy'],
    ['ما الفرق بين التوظيف الداخلي والخارجي؟', 'Internal vs external hiring?', 'easy'],
    ['اذكر 3 منصّات توظيف تستخدمها.', 'Name 3 recruitment platforms you use.', 'easy'],
    ['عرّف Employee Value Proposition (EVP).', 'Define Employee Value Proposition (EVP).', 'easy'],
    ['ما هي أهداف Exit Interview؟', 'Goals of an exit interview?', 'easy'],
    ['ما هو CV ATS-friendly؟', 'What is an ATS-friendly CV?', 'easy'],
    ['كيف تُجري تقييم أداء ربع سنوي؟', 'How do you run a quarterly performance review?', 'medium'],
    ['كيف تحدد الفجوة بين المهارات الحالية والمطلوبة؟', 'How do you identify skill gaps?', 'medium'],
    ['اشرح خطوات التخطيط الوظيفي (Career Pathing).', 'Explain career pathing steps.', 'medium'],
    ['كيف توازن بين الاحتياج الفوري للتوظيف وجودة المرشحين؟', 'How to balance urgent hiring with candidate quality?', 'medium'],
    ['ما الفرق بين Hard Skills و Soft Skills؟', 'Hard skills vs soft skills?', 'medium'],
    ['كيف تبني سياسة عمل مرن Hybrid Work؟', 'How to build a hybrid work policy?', 'medium'],
    ['ما أهمية Employer Branding في جذب الكفاءات؟', 'Role of employer branding in attracting talent?', 'medium'],
    ['اشرح مصفوفة 9-box في تقييم المواهب.', 'Explain the 9-box matrix for talent review.', 'medium'],
    ['كيف تتعامل مع شكوى تحرّش بين موظفَين؟', 'How do you handle a harassment complaint between employees?', 'medium'],
    ['ما هي مراحل إعداد خطة التدريب السنوية؟', 'Stages of preparing an annual training plan?', 'medium'],
    ['صف برنامج Mentorship فعّال.', 'Describe an effective mentorship program.', 'medium'],
    ['ما معنى Total Rewards وما مكوناته؟', 'What is Total Rewards and its components?', 'medium'],
    ['كيف تحلل أسباب ارتفاع معدل الدوران في قسم معين؟', 'How to analyze high turnover in a specific department?', 'medium'],
    ['اشرح مراحل إنهاء عقد عمل بشكل قانوني وإنساني.', 'Stages of legal and humane termination?', 'medium'],
    ['ما الفرق بين KPI و KRI و OKR؟', 'KPI vs KRI vs OKR?', 'medium'],
    ['كيف تستخدم Personality Tests في التوظيف؟', 'How do you use personality tests in hiring?', 'medium'],
    ['ما هو Succession Planning وأهميته؟', 'What is succession planning and why is it important?', 'medium'],
    ['كيف تبني نظام حوافز عادل لفريق مبيعات؟', 'How to build a fair incentive system for a sales team?', 'medium'],
    ['اشرح مبدأ Internal Equity في الرواتب.', 'Explain internal equity in compensation.', 'medium'],
    ['كيف تُدير أزمة تسريح جماعي؟', 'How do you manage a mass layoff crisis?', 'medium'],
    ['صمّم نظام أداء مربوط بالنتائج لشركة 200 موظف.', 'Design a performance system linked to outcomes for a 200-employee company.', 'hard'],
    ['كيف تغيّر ثقافة شركة عمرها 20 سنة؟', 'How do you change the culture of a 20-year-old company?', 'hard'],
    ['ما استراتيجيتك لبناء DE&I (Diversity, Equity, Inclusion)؟', 'Your strategy for building DE&I?', 'hard'],
    ['صف أصعب قرار توظيف اتخذته وكيف؟', 'Describe the hardest hiring decision you made.', 'hard'],
    ['كيف تقيس ROI لأنشطة الموارد البشرية؟', 'How do you measure HR ROI?', 'hard'],
    ['صمّم نظام تقييم 360 درجة ناجح.', 'Design a successful 360-degree review system.', 'hard'],
    ['ما استراتيجيتك لاحتفاظ المواهب التقنية في سوق تنافسي؟', 'Your strategy to retain tech talent in a competitive market?', 'hard'],
    ['صف كيف أدخلت تقنية HR جديدة ضد مقاومة التغيير.', 'How you introduced new HR tech against resistance to change?', 'hard'],
    ['ما دور HR Business Partner؟', 'Role of an HR Business Partner?', 'hard'],
    ['كيف تتعامل مع سوء سلوك قياديّ كبير دون تسريب الخبر؟', 'How to handle senior executive misconduct without leaks?', 'hard'],
    ['صمّم استراتيجية Workforce Planning لسنتين قادمتين.', 'Design a 2-year workforce planning strategy.', 'hard'],
  ],
  5: [ // خدمة عملاء — Customer Service
    ['ما هي أهم مهارة يجب توفرها في موظف خدمة عملاء؟', 'Most important skill for a CS agent?', 'easy'],
    ['كيف ترد على عميل يقول "منتجك سيء"؟', 'How do you respond to "your product is bad"?', 'easy'],
    ['عرّف SLA في خدمة العملاء.', 'Define SLA in customer service.', 'easy'],
    ['ما هي قنوات خدمة العملاء التي تعرفها؟', 'Which CS channels do you know?', 'easy'],
    ['كيف تحيّي عميلاً على الهاتف؟', 'How do you greet a customer on the phone?', 'easy'],
    ['متى تُحيل الشكوى للمدير؟', 'When do you escalate a complaint to the manager?', 'easy'],
    ['ما الفرق بين خدمة ما قبل وبعد البيع؟', 'Pre-sale vs post-sale service?', 'easy'],
    ['ما هو Tone of Voice في المحادثة مع عميل؟', 'Tone of voice in a customer conversation?', 'easy'],
    ['عرّف Customer Retention.', 'Define customer retention.', 'easy'],
    ['كيف تسجّل مكالمة بشكل احترافي؟', 'How do you log a call professionally?', 'easy'],
    ['كيف تتعامل مع عميل يُقاطعك باستمرار؟', 'How do you handle a constantly interrupting customer?', 'medium'],
    ['ما الفرق بين Empathy و Sympathy عمليًا؟', 'Empathy vs sympathy — practically?', 'medium'],
    ['اشرح خطوات LAST (Listen-Apologize-Solve-Thank).', 'Explain LAST steps (Listen-Apologize-Solve-Thank).', 'medium'],
    ['كيف تسحب منتجًا مُعابًا من عميل دون إحراج؟', 'How do you recall a defective product without embarrassing the customer?', 'medium'],
    ['ما هو CSAT وكيف يُحسب؟', 'What is CSAT and how to measure it?', 'medium'],
    ['ما هو NPS وما دلالاته؟', 'What is NPS and what does it indicate?', 'medium'],
    ['كيف تتعامل مع عميل يطلب خصمًا غير مسموح؟', 'How do you handle a discount request not allowed?', 'medium'],
    ['اشرح Call Flow المثالي في 5 خطوات.', 'Explain the ideal 5-step call flow.', 'medium'],
    ['كيف تتعامل مع عميل سابق غاضب بسبب مشكلة قديمة؟', 'How do you handle a returning customer angry about an old issue?', 'medium'],
    ['ما هي Knowledge Base وأهميتها في فريقك؟', 'What is a knowledge base and its importance?', 'medium'],
    ['كيف تخفض AHT (Average Handling Time) دون المساس بالجودة؟', 'How to reduce AHT without sacrificing quality?', 'medium'],
    ['اشرح Omnichannel vs Multichannel.', 'Explain Omnichannel vs Multichannel.', 'medium'],
    ['كيف تدرّب موظفًا جديدًا على التعامل مع العملاء الصعبين؟', 'How do you train a new agent to handle tough customers?', 'medium'],
    ['ما دور Sentiment Analysis في فريق خدمة العملاء؟', 'Role of sentiment analysis in CS?', 'medium'],
    ['كيف تستخدم البيانات لتحسين تجربة العميل؟', 'How to use data to improve customer experience?', 'medium'],
    ['اشرح FCR (First Contact Resolution) بالتفصيل.', 'Explain First Contact Resolution in detail.', 'medium'],
    ['كيف تتعامل مع موظف في فريقك يواجه استهلاكًا عاطفيًا (burnout)؟', 'How do you handle a team member facing burnout?', 'medium'],
    ['كيف تحسّن Self-Service للعملاء لتقليل التذاكر؟', 'How to improve self-service to reduce tickets?', 'medium'],
    ['ما الفرق بين Help Desk و Service Desk؟', 'Help desk vs service desk?', 'medium'],
    ['اشرح RACI Matrix في إدارة خدمة العملاء.', 'Explain RACI matrix in CS management.', 'medium'],
    ['صف موقفًا تحوّل فيه عميل شديد الغضب إلى مروّج للعلامة.', 'Describe turning a furious customer into a brand promoter.', 'hard'],
    ['كيف تبني فريق خدمة عملاء من 20 شخصًا في 3 أشهر؟', 'How to build a 20-person CS team in 3 months?', 'hard'],
    ['ما استراتيجيتك لتقليل Churn Rate بنسبة 20%؟', 'Your strategy to reduce churn by 20%?', 'hard'],
    ['صمّم برنامج Voice of Customer شاملًا.', 'Design a comprehensive Voice of Customer program.', 'hard'],
    ['كيف تقيس Customer Lifetime Value وتستخدمه؟', 'How do you measure and use CLV?', 'hard'],
    ['صف مرة فشلت فيها في إرضاء عميل مهم وماذا تعلّمت.', 'A time you failed to satisfy a key customer — lesson learned?', 'hard'],
    ['كيف تدمج AI chatbot دون فقدان اللمسة الإنسانية؟', 'How to integrate an AI chatbot without losing the human touch?', 'hard'],
    ['ما هو Service Recovery Paradox؟', 'What is the service recovery paradox?', 'hard'],
    ['كيف تُقنع الإدارة بالاستثمار في CX؟', 'How to convince management to invest in CX?', 'hard'],
    ['صمّم SLA متدرج لفئات عملاء مختلفة.', 'Design tiered SLA for different customer segments.', 'hard'],
    ['كيف تحوّل فريق خدمة عملاء من مركز تكلفة إلى مركز ربح؟', 'How to turn CS from a cost center into a profit center?', 'hard'],
  ],
  6: [ // مبيعات — Sales (Premium)
    ['لماذا اخترت مجال المبيعات؟', 'Why did you choose sales?', 'easy'],
    ['كيف تفتح مكالمة مع عميل محتمل لأول مرة؟', 'How do you open a call with a first-time prospect?', 'easy'],
    ['ما الفرق بين Outbound و Inbound Sales؟', 'Outbound vs Inbound sales?', 'easy'],
    ['عرّف Sales Pipeline.', 'Define sales pipeline.', 'easy'],
    ['كيف تقيس نجاحك الشهري كمندوب مبيعات؟', 'How do you measure your monthly success as a sales rep?', 'easy'],
    ['ما الفرق بين Lead و Prospect و Customer؟', 'Lead vs Prospect vs Customer?', 'easy'],
    ['عرّف Cross-sell و Upsell بمثال.', 'Define cross-sell and upsell with examples.', 'easy'],
    ['ما هو Elevator Pitch ومتى تستخدمه؟', 'What is an elevator pitch and when do you use it?', 'easy'],
    ['اذكر 3 أدوات CRM تعرفها.', 'Name 3 CRM tools you know.', 'easy'],
    ['ما هي مراحل عملية البيع الكلاسيكية؟', 'Stages of the classic sales process?', 'easy'],
    ['كيف تتعامل مع "ليس عندي ميزانية"؟', 'How do you handle "I don\'t have a budget"?', 'medium'],
    ['اشرح تقنية SPIN Selling.', 'Explain SPIN Selling technique.', 'medium'],
    ['ما هي تقنية BANT في تأهيل العملاء؟', 'What is the BANT qualification technique?', 'medium'],
    ['كيف تبحث عن عملاء محتملين على LinkedIn؟', 'How do you prospect on LinkedIn?', 'medium'],
    ['ما أفضل طريقة لمتابعة عميل متردد؟', 'Best way to follow up with a hesitant prospect?', 'medium'],
    ['اشرح Social Selling ومتى يكون فعّالاً.', 'Explain social selling and when it works.', 'medium'],
    ['ما هو Consultative Selling؟', 'What is consultative selling?', 'medium'],
    ['كيف تستخدم Storytelling في البيع؟', 'How to use storytelling in selling?', 'medium'],
    ['اشرح تقنية Challenger Sale.', 'Explain the Challenger Sale technique.', 'medium'],
    ['كيف تتعامل مع اعتراض "سأفكر في الموضوع"؟', 'How do you handle "I need to think about it"?', 'medium'],
    ['ما هو Win-Loss Analysis وكيف يفيدك؟', 'What is win-loss analysis and how does it help?', 'medium'],
    ['كيف تحدد السعر المناسب لعرض مبدئي؟', 'How to set the right price for an initial offer?', 'medium'],
    ['اشرح تقنية Door-in-the-Face في التفاوض.', 'Explain Door-in-the-Face negotiation technique.', 'medium'],
    ['ما الفرق بين Hard Close و Soft Close؟', 'Hard close vs soft close?', 'medium'],
    ['كيف تصنع خط أنابيب نموًا شهريًا؟', 'How to build a growing monthly pipeline?', 'medium'],
    ['اشرح MEDDIC في تأهيل صفقات B2B.', 'Explain MEDDIC for B2B deal qualification.', 'medium'],
    ['كيف تبني علاقات طويلة الأمد مع عملاء رئيسيين (Key Accounts)؟', 'How to build long-term relationships with key accounts?', 'medium'],
    ['ما هي Objection Handling Matrix؟', 'What is the objection handling matrix?', 'medium'],
    ['كيف تقرأ Buying Signals أثناء الاجتماع؟', 'How to read buying signals during a meeting?', 'medium'],
    ['اشرح قناة Partners/Resellers كذراع مبيعات.', 'Explain the partners/resellers sales channel.', 'medium'],
    ['صف أكبر صفقة أغلقتها وكيف.', 'Describe the biggest deal you closed and how.', 'hard'],
    ['كيف تتعامل مع صفقة توقفت لشهرين بعد موافقة مبدئية؟', 'How to handle a deal stalled 2 months after initial agreement?', 'hard'],
    ['ما استراتيجيتك لفتح سوق جديد في دولة لم تبع فيها من قبل؟', 'Your strategy to open a new country market?', 'hard'],
    ['صمّم خطة مبيعات ربع سنوية لفريق من 10 مندوبين.', 'Design a quarterly sales plan for a 10-rep team.', 'hard'],
    ['كيف تتعامل مع منافس يعرض سعرًا أقل بنسبة 30%؟', 'How to handle a competitor offering 30% lower price?', 'hard'],
    ['صف مرة خسرت فيها عميل كبير — ماذا تعلّمت؟', 'A time you lost a big customer — lesson?', 'hard'],
    ['كيف تقنع CFO شكوكي بقيمة منتجك؟', 'How to convince a skeptical CFO of your product\'s value?', 'hard'],
    ['صمّم نظام عمولات يحفّز السلوك الصحيح لا فقط الأرقام.', 'Design a commission system that rewards right behavior, not just numbers.', 'hard'],
    ['ما استراتيجيتك لرفع متوسط حجم الصفقة 50%؟', 'Your strategy to grow average deal size by 50%?', 'hard'],
    ['كيف تستخدم Data لاختيار مناطق التركيز في المبيعات؟', 'How to use data to pick sales focus areas?', 'hard'],
    ['صف كيف تتعامل مع صراع بين مندوبين على نفس العميل.', 'How to handle a conflict between reps over the same customer.', 'hard'],
  ],
  7: [ // تصميم — Design (Premium)
    ['ما الأدوات التي تتقنها (Figma, Adobe XD, Sketch)؟', 'Which tools do you master (Figma, Adobe XD, Sketch)?', 'easy'],
    ['ما الفرق بين UI و UX؟', 'Difference between UI and UX?', 'easy'],
    ['عرّف User Persona.', 'Define user persona.', 'easy'],
    ['ما هو Wireframe ومتى تستخدمه؟', 'What is a wireframe and when to use it?', 'easy'],
    ['عرّف Design System.', 'Define design system.', 'easy'],
    ['ما الفرق بين Typography Hierarchy ومعنى كل حجم؟', 'Typography hierarchy and meaning of each size?', 'easy'],
    ['ما معنى Responsive Design؟', 'What is responsive design?', 'easy'],
    ['اذكر 3 مبادئ من مبادئ Gestalt.', 'Name 3 Gestalt principles.', 'easy'],
    ['ما أهمية White Space في التصميم؟', 'Importance of white space in design?', 'easy'],
    ['عرّف Color Theory بإيجاز.', 'Define color theory briefly.', 'easy'],
    ['كيف تُجري User Interview فعّالة؟', 'How to run an effective user interview?', 'medium'],
    ['ما هو Card Sorting ومتى تستخدمه؟', 'What is card sorting and when to use it?', 'medium'],
    ['اشرح مراحل Design Thinking بالتفصيل.', 'Explain Design Thinking stages in detail.', 'medium'],
    ['كيف تقيس قابلية الاستخدام (Usability)؟', 'How do you measure usability?', 'medium'],
    ['ما هو Heuristic Evaluation؟', 'What is heuristic evaluation?', 'medium'],
    ['كيف تبني User Flow من البداية؟', 'How do you build a user flow from scratch?', 'medium'],
    ['اشرح مفهوم Information Architecture.', 'Explain Information Architecture.', 'medium'],
    ['كيف تصمم لواجهة عربية RTL؟', 'How do you design for an Arabic RTL interface?', 'medium'],
    ['ما هو Atomic Design وفلسفته؟', 'What is atomic design and its philosophy?', 'medium'],
    ['اشرح WCAG وأهميتها.', 'Explain WCAG and its importance.', 'medium'],
    ['كيف تتعامل مع طلب تعديل غير منطقي من العميل؟', 'How do you handle an illogical client change request?', 'medium'],
    ['ما دور Motion Design في تحسين تجربة المستخدم؟', 'Role of motion design in UX?', 'medium'],
    ['اشرح Dark Mode ومبادئ تصميمه.', 'Explain dark mode design principles.', 'medium'],
    ['كيف تختار Color Palette لتطبيق مصرفي؟', 'How to choose a color palette for a banking app?', 'medium'],
    ['ما الفرق بين Skeuomorphism و Flat Design و Neumorphism؟', 'Skeuomorphism vs flat vs neumorphism?', 'medium'],
    ['كيف تُجري اختبار A/B لتصميم زر شراء؟', 'How to A/B test a "Buy" button design?', 'medium'],
    ['ما هي Micro-interactions وأمثلة ناجحة؟', 'What are micro-interactions and successful examples?', 'medium'],
    ['كيف تحافظ على اتساق التصميم في فريق من 5 مصممين؟', 'How to maintain design consistency in a team of 5?', 'medium'],
    ['اشرح كيف تُسلم Design Handoff للمطور.', 'How to deliver a design handoff to developers.', 'medium'],
    ['كيف تبني Design Portfolio قوي؟', 'How to build a strong design portfolio?', 'medium'],
    ['صمّم تطبيقًا لحجز العيادات يستهدف كبار السن.', 'Design a clinic booking app for elderly users.', 'hard'],
    ['كيف تتعامل مع فريق Dev يرفض تطبيق تصميمك؟', 'How to handle devs refusing to implement your design?', 'hard'],
    ['صف كيف تعيد تصميم منتج عمره 10 سنوات دون إزعاج مستخدميه الحاليين.', 'Redesigning a 10-year-old product without upsetting current users.', 'hard'],
    ['ما استراتيجيتك لبناء Design System لشركة تعمل على 5 منتجات؟', 'Your strategy for a multi-product design system?', 'hard'],
    ['كيف تقيس ROI للتصميم وتقدمه للإدارة؟', 'How to measure and present design ROI?', 'hard'],
    ['صف أصعب تحدي تصميمي واجهته.', 'Describe your hardest design challenge.', 'hard'],
    ['كيف تحل تضاربًا بين متطلبات المستخدم والعميل؟', 'How to resolve conflict between user and client needs?', 'hard'],
    ['صمّم تجربة onboarding مُبتكرة لتطبيق مالي.', 'Design an innovative onboarding for a fintech app.', 'hard'],
    ['كيف تدمج AI في تدفقات التصميم؟', 'How to integrate AI in design workflows?', 'hard'],
    ['ما أكبر خطأ ارتكبته في تصميم أُطلق للسوق؟', 'Your biggest mistake in a shipped design?', 'hard'],
    ['كيف تقود نقاشًا تصميميًا في اجتماع به مدراء غير تقنيين؟', 'How to lead a design discussion with non-technical managers?', 'hard'],
  ],
};

// --------------------------------------------------------------------------
// Fake users — 30 Egyptian/Arab professionals across plan tiers.
// --------------------------------------------------------------------------
const ARABIC_NAMES = [
  'أحمد محمد',   'سارة إبراهيم', 'محمد علي',    'فاطمة حسن',    'عمر خالد',
  'نور الدين',    'يوسف أشرف',   'مريم سامي',   'طارق منير',    'هاجر صلاح',
  'كريم فاروق',   'دينا مصطفى',   'هشام رضا',    'ليلى عبدالله',  'باسم سعيد',
  'جميلة أنور',   'سامح زكي',    'رانيا نبيل',   'عادل شريف',    'نجلاء حمدي',
  'شريف لبيب',   'منى وهبة',    'طه جمال',     'هدى إسماعيل',   'مازن رفعت',
  'سمر عطية',    'خالد رمزي',   'أسماء ياسر',   'وليد حافظ',    'نادية فؤاد',
];

const PLANS = ['free', 'free', 'free', 'free', 'premium']; // ~20% premium
const LANGS = ['ar', 'ar', 'ar', 'en']; // 75% ar

// --------------------------------------------------------------------------
// Fake feedback generator — realistic JSON shaped like real Claude output.
// --------------------------------------------------------------------------
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
  'استخدم قاعدة STAR (Situation, Task, Action, Result) للإجابات السلوكية.',
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
  const strengthsCount = score >= 8 ? 3 : score >= 5 ? 2 : 1;
  const weaknessesCount = score >= 8 ? 1 : score >= 5 ? 2 : 3;
  return {
    score,
    strengths: pickN(STRENGTHS, strengthsCount),
    weaknesses: pickN(WEAKNESSES, weaknessesCount),
    improvement: pick(IMPROVEMENTS),
    model_answer: 'إجابة نموذجية مختصرة: ابدأ بالسياق، اذكر الإجراء الذي اتخذته، ثم النتيجة القابلة للقياس.',
    seeded: true,
  };
}

// --------------------------------------------------------------------------
// Main seed flow.
// --------------------------------------------------------------------------
async function alreadyRan() {
  const row = await prisma.appSetting.findUnique({ where: { key: FLAG_KEY } });
  return !!row;
}

async function markDone(count) {
  await prisma.appSetting.upsert({
    where: { key: FLAG_KEY },
    create: { key: FLAG_KEY, value: JSON.stringify({ at: new Date().toISOString(), count }) },
    update: { value: JSON.stringify({ at: new Date().toISOString(), count }) },
  });
}

async function seedQuestions() {
  let total = 0;
  for (const [categoryId, rows] of Object.entries(QUESTIONS)) {
    const batch = rows.map(([ar, en, difficulty]) => ({
      categoryId: Number(categoryId),
      questionAr: ar,
      questionEn: en,
      difficulty,
    }));
    const r = await prisma.question.createMany({ data: batch });
    total += r.count;
    console.log(`  + ${r.count} questions for category ${categoryId}`);
  }
  return total;
}

async function seedUsers() {
  const password = await bcrypt.hash('TestUser@2025', 10);
  const users = [];
  for (let i = 0; i < ARABIC_NAMES.length; i++) {
    users.push({
      email: `user${i + 1}@example.com`,
      passwordHash: password,
      name: ARABIC_NAMES[i],
      language: pick(LANGS),
      plan: pick(PLANS),
      dailyQuestionsUsed: randInt(0, 5),
      lastResetDate: new Date(),
    });
  }
  const r = await prisma.user.createMany({ data: users, skipDuplicates: true });
  console.log(`  + ${r.count} users`);
  return r.count;
}

async function seedSessions() {
  const users = await prisma.user.findMany({ take: 30 });
  const categories = await prisma.category.findMany();
  let sessionCount = 0, answerCount = 0;

  for (const user of users) {
    const numSessions = randInt(1, 8);
    for (let s = 0; s < numSessions; s++) {
      const category = pick(categories);
      if (category.isPremium && user.plan !== 'premium') continue;

      const startedAt = new Date(Date.now() - randInt(0, 60) * 86400_000 - randInt(0, 86_400_000));
      const endedAt = new Date(startedAt.getTime() + randInt(5 * 60_000, 30 * 60_000));
      const questions = await prisma.question.findMany({
        where: { categoryId: category.id, isActive: true },
        take: randInt(3, 7),
        orderBy: { usageCount: 'asc' },
      });
      if (!questions.length) continue;

      const answers = questions.map((q, idx) => {
        const score = randInt(3, 10);
        const createdAt = new Date(startedAt.getTime() + (idx + 1) * 3 * 60_000);
        return {
          questionId: q.id,
          userAnswer: 'إجابة تجريبية للتدريب على منصة InterviewAI Arabia. هذه بيانات seed تهدف لعرض تجربة الاستخدام الكاملة.',
          aiScore: score,
          aiFeedback: JSON.stringify(fakeFeedback(score)),
          tokensUsed: randInt(200, 800),
          createdAt,
        };
      });
      const totalScore = answers.reduce((a, x) => a + (x.aiScore || 0), 0);

      await prisma.session.create({
        data: {
          userId: user.id,
          categoryId: category.id,
          totalScore,
          startedAt,
          endedAt,
          answers: { create: answers },
        },
      });
      sessionCount++;
      answerCount += answers.length;
    }
  }
  console.log(`  + ${sessionCount} sessions, ${answerCount} answers`);
  return { sessionCount, answerCount };
}

async function seedSubscriptions() {
  const premiumUsers = await prisma.user.findMany({ where: { plan: 'premium' } });
  let count = 0;
  for (const u of premiumUsers) {
    const isYearly = Math.random() < 0.3;
    await prisma.subscription.create({
      data: {
        userId: u.id,
        googlePurchaseToken: `seed-${u.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        productId: isYearly ? 'interviewai_yearly' : 'interviewai_monthly',
        status: 'active',
        startedAt: new Date(Date.now() - randInt(1, 20) * 86400_000),
        expiresAt: new Date(Date.now() + (isYearly ? 365 : 30) * 86400_000),
        rawPayload: JSON.stringify({ seeded: true }),
      },
    });
    count++;
  }
  console.log(`  + ${count} subscriptions`);
  return count;
}

async function main() {
  if (await alreadyRan()) {
    console.log(`Skipping: ${FLAG_KEY} flag already set. Delete the row to re-run.`);
    return;
  }
  console.log('Seeding large dataset...');
  const q = await seedQuestions();
  const u = await seedUsers();
  const { sessionCount, answerCount } = await seedSessions();
  const subs = await seedSubscriptions();
  await markDone({ questions: q, users: u, sessions: sessionCount, answers: answerCount, subscriptions: subs });
  console.log('\nDone.');
  console.log(`  questions:     +${q}`);
  console.log(`  users:         +${u}`);
  console.log(`  sessions:      +${sessionCount}`);
  console.log(`  answers:       +${answerCount}`);
  console.log(`  subscriptions: +${subs}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
