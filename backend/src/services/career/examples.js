/**
 * Example CVs — a filled-in starting point for someone facing a blank page.
 *
 * Deterministic and free: no model call. The person picks a role (or asks for
 * a random one), gets a complete CV in the builder, and replaces the example
 * details with their own. Every example is plainly an example — invented
 * people at invented companies — and the app says so above the form, so
 * nobody sends one out as theirs by accident.
 */

import { sanitizeCv } from './cv.js';

const NAMES = {
  en: ['Emma Carter', 'James Walker', 'Sophie Martin', 'Lucas Bennett', 'Olivia Hayes', 'Daniel Brooks', 'Chloe Anderson', 'Ethan Clarke', 'Mia Thompson', 'Noah Fischer'],
  ar: ['إيما كارتر', 'جيمس ووكر', 'صوفي مارتن', 'لوكاس بينيت', 'أوليفيا هايز', 'دانيال بروكس', 'كلوي أندرسون', 'إيثان كلارك', 'ميا طومسون', 'نوح فيشر'],
};
const CITIES = {
  en: ['Dubai, UAE', 'Riyadh, Saudi Arabia', 'Doha, Qatar', 'London, UK', 'Berlin, Germany', 'Amman, Jordan', 'Toronto, Canada', 'Casablanca, Morocco'],
  ar: ['دبي، الإمارات', 'الرياض، السعودية', 'الدوحة، قطر', 'لندن، المملكة المتحدة', 'برلين، ألمانيا', 'عمّان، الأردن', 'تورونتو، كندا', 'الدار البيضاء، المغرب'],
};

/**
 * One entry per role: [headline, summary, [job1, job2], [degree, field, school], skills, certs, languages].
 * A job is [title, company, bullets[]]. Companies are invented.
 */
const ROLES = {
  software_engineer: {
    labelEn: 'Software engineer', labelAr: 'مهندس برمجيات',
    en: ['Software Engineer — Backend & Cloud',
      'Software engineer with 6+ years building reliable web services and APIs. Comfortable across Node.js, Python and cloud infrastructure, with a habit of measuring before optimising and shipping in small, safe steps.',
      [['Senior Software Engineer', 'Northwind Digital', [
        'Led the move of a monolith to 12 services on AWS, cutting release time from weekly to daily.',
        'Reduced p95 API latency by 43% by profiling hot paths and adding a Redis cache layer.',
        'Mentored 4 junior engineers and introduced code review guidelines adopted by 3 teams.']],
      ['Software Engineer', 'Bluebird Systems', [
        'Built a payments reconciliation service processing 1.2M transactions a month.',
        'Raised automated test coverage from 38% to 81% across the core API.',
        'Cut cloud spend by 22% by right-sizing instances and scheduling non-production environments.']]],
      ['BSc', 'Computer Science', 'University of Technology'],
      ['Node.js', 'TypeScript', 'Python', 'PostgreSQL', 'Redis', 'AWS', 'Docker', 'Kubernetes', 'REST APIs', 'CI/CD', 'System design'],
      [['AWS Certified Developer – Associate', 'Amazon Web Services']]],
    ar: ['مهندس برمجيات — الأنظمة الخلفية والسحابة',
      'مهندس برمجيات بخبرة تتجاوز ٦ سنوات في بناء خدمات وواجهات برمجية موثوقة. أعمل بـ Node.js و Python والبنية السحابية، وأقيس قبل أن أحسّن، وأطلق التغييرات بخطوات صغيرة وآمنة.',
      [['مهندس برمجيات أول', 'نورث ويند ديجيتال', [
        'قدت نقل نظام موحّد إلى ١٢ خدمة على AWS، فانخفض زمن الإطلاق من أسبوعي إلى يومي.',
        'خفّضت زمن استجابة الواجهة بنسبة ٤٣٪ بتحليل المسارات الأكثر استخدامًا وإضافة طبقة Redis.',
        'درّبت ٤ مهندسين جدد ووضعت إرشادات لمراجعة الكود اعتمدتها ٣ فرق.']],
      ['مهندس برمجيات', 'بلوبيرد سيستمز', [
        'بنيت خدمة لمطابقة المدفوعات تعالج ١٫٢ مليون عملية شهريًا.',
        'رفعت تغطية الاختبارات الآلية من ٣٨٪ إلى ٨١٪ في الواجهة الأساسية.',
        'خفّضت تكلفة السحابة ٢٢٪ بضبط أحجام الخوادم وجدولة بيئات الاختبار.']]],
      ['بكالوريوس', 'علوم الحاسب', 'جامعة التكنولوجيا'],
      ['Node.js', 'TypeScript', 'Python', 'PostgreSQL', 'Redis', 'AWS', 'Docker', 'Kubernetes', 'واجهات REST', 'CI/CD', 'تصميم الأنظمة'],
      [['AWS Certified Developer – Associate', 'Amazon Web Services']]],
  },
  accountant: {
    labelEn: 'Accountant', labelAr: 'محاسب',
    en: ['Senior Accountant',
      'Chartered accountant with 7 years in month-end close, IFRS reporting and audit preparation for multi-entity groups. Known for clean reconciliations, fast closes and controls that hold up under audit.',
      [['Senior Accountant', 'Crescent Trading Group', [
        'Shortened the month-end close from 9 to 5 working days across 4 entities.',
        'Prepared IFRS statements and led the external audit with zero material findings two years running.',
        'Automated bank reconciliations in Excel Power Query, saving about 30 hours a month.']],
      ['Accountant', 'Oasis Retail Co.', [
        'Managed accounts payable for 300+ suppliers and cut late-payment penalties by 90%.',
        'Implemented VAT reporting and filed quarterly returns on time for every period.',
        'Built a fixed-asset register for 2,400 assets and reconciled it to the ledger.']]],
      ['BCom', 'Accounting', 'Gulf Business University'],
      ['IFRS', 'Month-end close', 'Reconciliations', 'VAT', 'SAP', 'Oracle NetSuite', 'Excel (Power Query, pivot tables)', 'Audit preparation', 'Budgeting'],
      [['ACCA', 'Association of Chartered Certified Accountants']]],
    ar: ['محاسب أول',
      'محاسب قانوني بخبرة ٧ سنوات في إقفال نهاية الشهر وإعداد تقارير IFRS والتحضير للتدقيق في مجموعات متعددة الكيانات. معروف بالمطابقات الدقيقة والإقفال السريع وضوابط تصمد أمام التدقيق.',
      [['محاسب أول', 'مجموعة الهلال التجارية', [
        'اختصرت إقفال نهاية الشهر من ٩ أيام عمل إلى ٥ في ٤ كيانات.',
        'أعددت القوائم المالية وفق IFRS وقدت التدقيق الخارجي دون ملاحظات جوهرية لعامين متتاليين.',
        'أتمتت المطابقات البنكية بـ Power Query فوفّرت نحو ٣٠ ساعة شهريًا.']],
      ['محاسب', 'شركة الواحة للتجزئة', [
        'أدرت حسابات الدائنين لأكثر من ٣٠٠ مورد وخفّضت غرامات التأخير بنسبة ٩٠٪.',
        'طبّقت تقارير ضريبة القيمة المضافة وقدّمت الإقرارات الربع سنوية في مواعيدها دائمًا.',
        'أنشأت سجلًا للأصول الثابتة يضم ٢٤٠٠ أصل وطابقته مع الدفاتر.']]],
      ['بكالوريوس تجارة', 'المحاسبة', 'جامعة الخليج للأعمال'],
      ['IFRS', 'إقفال نهاية الشهر', 'المطابقات', 'ضريبة القيمة المضافة', 'SAP', 'Oracle NetSuite', 'Excel', 'التحضير للتدقيق', 'إعداد الموازنات'],
      [['ACCA', 'جمعية المحاسبين القانونيين المعتمدين']]],
  },
  marketing: {
    labelEn: 'Digital marketing specialist', labelAr: 'أخصائي تسويق رقمي',
    en: ['Digital Marketing Specialist',
      'Performance marketer with 5 years running paid social, search and lifecycle campaigns in English and Arabic markets. I plan from the numbers, test constantly and report what actually moved revenue.',
      [['Digital Marketing Specialist', 'Sahara Commerce', [
        'Grew online revenue 64% year on year with Meta and Google campaigns on a fixed budget.',
        'Lowered cost per acquisition by 31% through weekly creative and audience testing.',
        'Launched an email lifecycle program that now drives 18% of monthly orders.']],
      ['Marketing Coordinator', 'Lumen Agency', [
        'Managed social channels for 6 clients, growing combined followers from 40K to 210K.',
        'Produced monthly performance reports that became the agency template.',
        'Coordinated 12 influencer campaigns end to end, on time and on budget.']]],
      ['BA', 'Marketing', 'American University of the Region'],
      ['Google Ads', 'Meta Ads', 'SEO', 'Google Analytics 4', 'Email marketing', 'A/B testing', 'Content strategy', 'HubSpot', 'Arabic & English copywriting'],
      [['Google Ads Search Certification', 'Google']]],
    ar: ['أخصائي تسويق رقمي',
      'مسوّق أداء بخبرة ٥ سنوات في إدارة حملات التواصل الاجتماعي والبحث والتسويق عبر البريد في الأسواق العربية والإنجليزية. أخطط من الأرقام، وأختبر باستمرار، وأقيس ما يحرّك الإيرادات فعلًا.',
      [['أخصائي تسويق رقمي', 'صحارى للتجارة', [
        'رفعت الإيرادات الإلكترونية ٦٤٪ سنويًا بحملات Meta و Google بميزانية ثابتة.',
        'خفّضت تكلفة الاكتساب ٣١٪ باختبارات أسبوعية للمحتوى والجمهور.',
        'أطلقت برنامج رسائل بريدية يحقق الآن ١٨٪ من الطلبات الشهرية.']],
      ['منسّق تسويق', 'وكالة لومن', [
        'أدرت حسابات التواصل لـ ٦ عملاء ورفعت المتابعين من ٤٠ ألفًا إلى ٢١٠ آلاف.',
        'أعددت تقارير أداء شهرية أصبحت النموذج المعتمد في الوكالة.',
        'نسّقت ١٢ حملة مع المؤثرين من البداية للنهاية في الوقت والميزانية.']]],
      ['بكالوريوس', 'التسويق', 'الجامعة الأمريكية الإقليمية'],
      ['Google Ads', 'Meta Ads', 'تحسين محركات البحث', 'Google Analytics 4', 'التسويق بالبريد', 'اختبارات A/B', 'استراتيجية المحتوى', 'HubSpot', 'كتابة إعلانية بالعربية والإنجليزية'],
      [['شهادة Google Ads للبحث', 'Google']]],
  },
  project_manager: {
    labelEn: 'Project manager', labelAr: 'مدير مشروع',
    en: ['Project Manager — PMP',
      'PMP-certified project manager with 8 years delivering construction and IT projects worth up to $25M. I keep scope, cost and people aligned, and I tell stakeholders early when something is slipping.',
      [['Project Manager', 'Atlas Infrastructure', [
        'Delivered a $25M hospital fit-out 3 weeks early and 4% under budget.',
        'Ran weekly risk reviews that cut change-order costs by 18% versus the previous program.',
        'Coordinated 9 subcontractors and a 60-person site team with zero lost-time incidents.']],
      ['Assistant Project Manager', 'Meridian Projects', [
        'Built the master schedule in Primavera P6 for 3 parallel commercial towers.',
        'Introduced a digital RFI log that halved average response time to 4 days.',
        'Prepared monthly client reports covering progress, cost and forecast.']]],
      ['BEng', 'Civil Engineering', 'National University'],
      ['Project planning', 'Primavera P6', 'MS Project', 'Risk management', 'Budget control', 'Stakeholder management', 'Agile & Scrum', 'Contract administration'],
      [['Project Management Professional (PMP)', 'PMI']]],
    ar: ['مدير مشروع — PMP',
      'مدير مشاريع معتمد PMP بخبرة ٨ سنوات في تسليم مشاريع إنشائية وتقنية تصل قيمتها إلى ٢٥ مليون دولار. أحافظ على توازن النطاق والتكلفة والفريق، وأبلّغ أصحاب المصلحة مبكرًا عند أي تأخير.',
      [['مدير مشروع', 'أطلس للبنية التحتية', [
        'سلّمت تجهيز مستشفى بقيمة ٢٥ مليون دولار قبل موعده بـ ٣ أسابيع وبأقل من الميزانية بـ ٤٪.',
        'أدرت مراجعات أسبوعية للمخاطر خفّضت تكلفة أوامر التغيير ١٨٪ مقارنة بالبرنامج السابق.',
        'نسّقت ٩ مقاولين من الباطن وفريق موقع من ٦٠ شخصًا دون أي إصابات عمل.']],
      ['مساعد مدير مشروع', 'ميريديان للمشاريع', [
        'أعددت الجدول الزمني الرئيسي على Primavera P6 لثلاثة أبراج تجارية متوازية.',
        'أطلقت سجلًا رقميًا لطلبات المعلومات خفّض متوسط زمن الرد إلى النصف (٤ أيام).',
        'أعددت تقارير شهرية للعميل تغطي التقدم والتكلفة والتوقعات.']]],
      ['بكالوريوس هندسة', 'الهندسة المدنية', 'الجامعة الوطنية'],
      ['تخطيط المشاريع', 'Primavera P6', 'MS Project', 'إدارة المخاطر', 'ضبط الميزانية', 'إدارة أصحاب المصلحة', 'Agile و Scrum', 'إدارة العقود'],
      [['Project Management Professional (PMP)', 'PMI']]],
  },
  data_analyst: {
    labelEn: 'Data analyst', labelAr: 'محلل بيانات',
    en: ['Data Analyst — SQL, Python, Power BI',
      'Data analyst with 4 years turning messy operational data into dashboards and decisions. Strong in SQL and Python, and in explaining what a number means to people who do not live in spreadsheets.',
      [['Data Analyst', 'Falcon Logistics', [
        'Built a Power BI delivery dashboard used daily by 120 managers across 5 countries.',
        'Found route inefficiencies with SQL analysis that saved $410K a year in fuel.',
        'Automated 14 weekly reports in Python, freeing two analyst days a week.']],
      ['Junior Data Analyst', 'Cedar Telecom', [
        'Modelled customer churn and helped design a retention offer that cut churn 9%.',
        'Cleaned and merged 3 legacy CRM databases into one reporting warehouse.',
        'Ran A/B test analysis for pricing pages and presented results to leadership.']]],
      ['BSc', 'Statistics', 'State University'],
      ['SQL', 'Python (pandas)', 'Power BI', 'Tableau', 'Excel', 'Data cleaning', 'A/B testing', 'Statistics', 'Data storytelling'],
      [['Microsoft Certified: Power BI Data Analyst Associate', 'Microsoft']]],
    ar: ['محلل بيانات — SQL و Python و Power BI',
      'محلل بيانات بخبرة ٤ سنوات في تحويل البيانات التشغيلية غير المرتبة إلى لوحات وقرارات. متمكن من SQL و Python، ومن شرح معنى الرقم لمن لا يعيش بين الجداول.',
      [['محلل بيانات', 'فالكون للخدمات اللوجستية', [
        'بنيت لوحة Power BI للتوصيل يستخدمها ١٢٠ مديرًا يوميًا في ٥ دول.',
        'اكتشفت بتحليل SQL مسارات غير فعّالة ووفّرت ٤١٠ آلاف دولار سنويًا في الوقود.',
        'أتمتت ١٤ تقريرًا أسبوعيًا بـ Python فوفّرت يومي عمل أسبوعيًا.']],
      ['محلل بيانات مبتدئ', 'سيدار للاتصالات', [
        'بنيت نموذجًا لتسرّب العملاء وساهمت في عرض احتفاظ خفّض التسرّب ٩٪.',
        'نظّفت ودمجت ٣ قواعد CRM قديمة في مستودع تقارير واحد.',
        'حلّلت اختبارات A/B لصفحات الأسعار وعرضت النتائج على الإدارة.']]],
      ['بكالوريوس', 'الإحصاء', 'الجامعة الحكومية'],
      ['SQL', 'Python (pandas)', 'Power BI', 'Tableau', 'Excel', 'تنظيف البيانات', 'اختبارات A/B', 'الإحصاء', 'عرض البيانات'],
      [['Microsoft Certified: Power BI Data Analyst Associate', 'Microsoft']]],
  },
  designer: {
    labelEn: 'Graphic / UI designer', labelAr: 'مصمم جرافيك وواجهات',
    en: ['Product & Graphic Designer',
      'Designer with 6 years across brand identity and product UI. I sketch fast, test with real users and hand developers files they can build without guessing.',
      [['Product Designer', 'Pixelcraft Studio', [
        'Redesigned a banking app onboarding flow, lifting completion from 52% to 78%.',
        'Built a Figma design system of 140 components used by 3 product teams.',
        'Ran 20+ usability sessions and turned findings into prioritised fixes.']],
      ['Graphic Designer', 'Nile Creative', [
        'Created brand identities for 25 clients, from logo to full guidelines.',
        'Designed bilingual Arabic/English campaigns for retail and hospitality brands.',
        'Prepared print-ready files for packaging, signage and exhibitions.']]],
      ['BFA', 'Graphic Design', 'Academy of Arts'],
      ['Figma', 'Adobe Illustrator', 'Photoshop', 'InDesign', 'UI design', 'Design systems', 'Prototyping', 'Usability testing', 'Arabic typography'],
      [['Google UX Design Certificate', 'Google']]],
    ar: ['مصمم منتجات وجرافيك',
      'مصمم بخبرة ٦ سنوات في الهوية البصرية وواجهات المنتجات الرقمية. أرسم بسرعة، وأختبر مع مستخدمين حقيقيين، وأسلّم المطورين ملفات يبنون منها دون تخمين.',
      [['مصمم منتجات', 'استوديو بيكسل كرافت', [
        'أعدت تصميم خطوات التسجيل في تطبيق بنكي فارتفع الإكمال من ٥٢٪ إلى ٧٨٪.',
        'بنيت نظام تصميم على Figma من ١٤٠ مكوّنًا تستخدمه ٣ فرق.',
        'أدرت أكثر من ٢٠ جلسة اختبار استخدام وحوّلت النتائج إلى إصلاحات مرتبة.']],
      ['مصمم جرافيك', 'النيل للإبداع', [
        'صمّمت هويات بصرية لـ ٢٥ عميلًا من الشعار حتى الدليل الكامل.',
        'صمّمت حملات ثنائية اللغة لعلامات التجزئة والضيافة.',
        'جهّزت ملفات طباعة للتغليف واللافتات والمعارض.']]],
      ['بكالوريوس فنون', 'التصميم الجرافيكي', 'أكاديمية الفنون'],
      ['Figma', 'Adobe Illustrator', 'Photoshop', 'InDesign', 'تصميم الواجهات', 'أنظمة التصميم', 'النماذج التفاعلية', 'اختبار الاستخدام', 'الخط العربي'],
      [['شهادة Google لتصميم تجربة المستخدم', 'Google']]],
  },
  nurse: {
    labelEn: 'Registered nurse', labelAr: 'ممرض مسجّل',
    en: ['Registered Nurse — ICU',
      'Registered nurse with 6 years in intensive care and emergency units. Calm under pressure, precise with medication and documentation, and focused on clear communication with patients and families.',
      [['ICU Staff Nurse', 'City General Hospital', [
        'Cared for up to 2 critically ill ventilated patients per shift in a 24-bed ICU.',
        'Trained 15 new nurses on sepsis bundles, lifting protocol compliance to 96%.',
        'Took part in the unit team that cut central-line infections by 40% in a year.']],
      ['Emergency Nurse', 'Al Noor Medical Center', [
        'Triaged 40+ patients per shift using the Manchester Triage System.',
        'Assisted in resuscitation and stabilisation of trauma and cardiac cases.',
        'Kept medication administration records with zero reportable errors.']]],
      ['BSc', 'Nursing', 'College of Health Sciences'],
      ['Critical care', 'Patient assessment', 'Ventilator management', 'Medication administration', 'Infection control', 'Triage', 'Electronic health records', 'Patient education'],
      [['Basic Life Support (BLS)', 'American Heart Association'], ['Advanced Cardiac Life Support (ACLS)', 'American Heart Association']]],
    ar: ['ممرض مسجّل — العناية المركزة',
      'ممرض مسجّل بخبرة ٦ سنوات في العناية المركزة والطوارئ. هادئ تحت الضغط، دقيق في الأدوية والتوثيق، ويهتم بالتواصل الواضح مع المرضى وذويهم.',
      [['ممرض عناية مركزة', 'مستشفى المدينة العام', [
        'رعيت حتى مريضين حرجين على أجهزة التنفس في كل وردية بوحدة من ٢٤ سريرًا.',
        'درّبت ١٥ ممرضًا جديدًا على بروتوكولات تعفّن الدم فارتفع الالتزام إلى ٩٦٪.',
        'شاركت في فريق خفّض عدوى القسطرة المركزية ٤٠٪ خلال عام.']],
      ['ممرض طوارئ', 'مركز النور الطبي', [
        'فرزت أكثر من ٤٠ مريضًا في الوردية بنظام مانشستر للفرز.',
        'ساعدت في إنعاش وتثبيت حالات الحوادث والقلب.',
        'حافظت على سجلات إعطاء الأدوية دون أي أخطاء مُبلّغ عنها.']]],
      ['بكالوريوس', 'التمريض', 'كلية العلوم الصحية'],
      ['العناية الحرجة', 'تقييم المرضى', 'أجهزة التنفس', 'إعطاء الأدوية', 'مكافحة العدوى', 'الفرز', 'السجلات الصحية الإلكترونية', 'تثقيف المرضى'],
      [['دعم الحياة الأساسي (BLS)', 'جمعية القلب الأمريكية'], ['دعم الحياة القلبي المتقدم (ACLS)', 'جمعية القلب الأمريكية']]],
  },
  sales: {
    labelEn: 'Sales executive', labelAr: 'مسؤول مبيعات',
    en: ['B2B Sales Executive',
      'B2B sales executive with 5 years selling software and services to mid-size companies. I build pipeline consistently, run honest discovery and close without discounting the value away.',
      [['Sales Executive', 'Vertex Software', [
        'Closed $1.8M in new annual contract value, 132% of target.',
        'Built a pipeline of 90+ qualified accounts through outbound and partner referrals.',
        'Shortened the average sales cycle from 74 to 51 days with a structured demo process.']],
      ['Account Manager', 'Prime Office Solutions', [
        'Managed 60 accounts with 95% renewal rate over two years.',
        'Upsold service plans that grew account revenue by 27%.',
        'Ranked top-3 of 18 reps in customer satisfaction scores.']]],
      ['BBA', 'Business Administration', 'Business School of the Gulf'],
      ['B2B sales', 'Pipeline management', 'Salesforce', 'Negotiation', 'Consultative selling', 'Account management', 'Presentations', 'Forecasting'],
      []],
    ar: ['مسؤول مبيعات للشركات',
      'مسؤول مبيعات بخبرة ٥ سنوات في بيع البرمجيات والخدمات للشركات المتوسطة. أبني فرص البيع باستمرار، وأفهم احتياج العميل بصدق، وأغلق الصفقات دون التفريط في قيمتها.',
      [['مسؤول مبيعات', 'فيرتكس للبرمجيات', [
        'أغلقت عقودًا جديدة بقيمة ١٫٨ مليون دولار سنويًا بنسبة ١٣٢٪ من المستهدف.',
        'بنيت قائمة من أكثر من ٩٠ عميلًا مؤهلًا عبر التواصل المباشر وإحالات الشركاء.',
        'اختصرت دورة البيع من ٧٤ إلى ٥١ يومًا بعرض توضيحي منظم.']],
      ['مدير حسابات', 'برايم لحلول المكاتب', [
        'أدرت ٦٠ حسابًا بنسبة تجديد ٩٥٪ على مدى عامين.',
        'بعت خطط خدمات إضافية رفعت إيرادات الحسابات ٢٧٪.',
        'كنت ضمن أفضل ٣ من ١٨ مندوبًا في رضا العملاء.']]],
      ['بكالوريوس', 'إدارة الأعمال', 'كلية الخليج للأعمال'],
      ['مبيعات الشركات', 'إدارة فرص البيع', 'Salesforce', 'التفاوض', 'البيع الاستشاري', 'إدارة الحسابات', 'العروض التقديمية', 'التوقعات'],
      []],
  },
  hr: {
    labelEn: 'HR specialist', labelAr: 'أخصائي موارد بشرية',
    en: ['HR Specialist — Talent Acquisition',
      'HR specialist with 5 years in recruitment, onboarding and employee relations for fast-growing teams. I fill roles quickly without lowering the bar, and keep the candidate experience human.',
      [['HR Specialist', 'Horizon Group', [
        'Hired 140 people in 12 months with an average time-to-fill of 28 days.',
        'Redesigned onboarding, raising 90-day retention from 81% to 93%.',
        'Rolled out an HRIS (BambooHR) for 600 employees and trained all managers on it.']],
      ['Recruitment Coordinator', 'TalentBridge', [
        'Screened 2,000+ applications a quarter for tech and finance roles.',
        'Built structured interview guides used by 30 hiring managers.',
        'Organised 8 university hiring events that brought in 45 graduates.']]],
      ['BA', 'Human Resource Management', 'University of Commerce'],
      ['Recruitment', 'Onboarding', 'Employee relations', 'HRIS (BambooHR)', 'Labour law basics', 'Structured interviewing', 'Employer branding', 'LinkedIn Recruiter'],
      [['SHRM Certified Professional (SHRM-CP)', 'SHRM']]],
    ar: ['أخصائي موارد بشرية — استقطاب المواهب',
      'أخصائي موارد بشرية بخبرة ٥ سنوات في التوظيف والتهيئة وعلاقات الموظفين لفرق سريعة النمو. أشغل الوظائف بسرعة دون التنازل عن المعايير، وأحافظ على تجربة إنسانية للمرشحين.',
      [['أخصائي موارد بشرية', 'مجموعة الأفق', [
        'وظّفت ١٤٠ شخصًا خلال ١٢ شهرًا بمتوسط ٢٨ يومًا لشغل الوظيفة.',
        'أعدت تصميم برنامج التهيئة فارتفع الاحتفاظ بعد ٩٠ يومًا من ٨١٪ إلى ٩٣٪.',
        'طبّقت نظام BambooHR لـ ٦٠٠ موظف ودرّبت جميع المديرين عليه.']],
      ['منسّق توظيف', 'تالنت بريدج', [
        'فرزت أكثر من ٢٠٠٠ طلب كل ربع سنة لوظائف التقنية والمالية.',
        'أعددت أدلة مقابلات منظمة يستخدمها ٣٠ مدير توظيف.',
        'نظّمت ٨ فعاليات توظيف جامعية استقطبت ٤٥ خريجًا.']]],
      ['بكالوريوس', 'إدارة الموارد البشرية', 'جامعة التجارة'],
      ['التوظيف', 'التهيئة', 'علاقات الموظفين', 'BambooHR', 'أساسيات قانون العمل', 'المقابلات المنظمة', 'العلامة التوظيفية', 'LinkedIn Recruiter'],
      [['SHRM-CP', 'SHRM']]],
  },
  customer_service: {
    labelEn: 'Customer service', labelAr: 'خدمة العملاء',
    en: ['Customer Service Team Lead',
      'Customer service lead with 5 years in contact centres for e-commerce and telecom. Bilingual Arabic/English, patient with upset customers, and focused on solving the problem the first time.',
      [['Customer Service Team Lead', 'Swift Commerce', [
        'Led a team of 12 agents handling 1,500 chats and calls a day.',
        'Raised CSAT from 82% to 94% by rewriting macros and coaching weekly.',
        'Cut average handling time by 20% without lowering first-contact resolution.']],
      ['Customer Service Agent', 'Delta Telecom', [
        'Resolved 60+ customer cases a day across billing and technical issues.',
        'Named agent of the month 4 times for quality scores.',
        'Wrote 30 knowledge-base articles that reduced repeat contacts.']]],
      ['Diploma', 'Business Administration', 'Technical College'],
      ['Customer support', 'Zendesk', 'Freshdesk', 'Conflict resolution', 'Team coaching', 'Arabic & English', 'CSAT & KPIs', 'Knowledge base writing'],
      []],
    ar: ['قائد فريق خدمة العملاء',
      'قائد فريق خدمة عملاء بخبرة ٥ سنوات في مراكز الاتصال للتجارة الإلكترونية والاتصالات. أتحدث العربية والإنجليزية، صبور مع العملاء الغاضبين، وأركّز على حل المشكلة من أول مرة.',
      [['قائد فريق خدمة العملاء', 'سويفت للتجارة', [
        'قدت فريقًا من ١٢ موظفًا يتعامل مع ١٥٠٠ محادثة ومكالمة يوميًا.',
        'رفعت رضا العملاء من ٨٢٪ إلى ٩٤٪ بإعادة كتابة الردود الجاهزة والتدريب الأسبوعي.',
        'خفّضت متوسط زمن المعالجة ٢٠٪ دون التأثير على الحل من أول تواصل.']],
      ['موظف خدمة عملاء', 'دلتا للاتصالات', [
        'حللت أكثر من ٦٠ حالة يوميًا في الفواتير والمشكلات التقنية.',
        'حصلت على لقب موظف الشهر ٤ مرات لدرجات الجودة.',
        'كتبت ٣٠ مقالًا في قاعدة المعرفة خفّضت التواصل المتكرر.']]],
      ['دبلوم', 'إدارة الأعمال', 'الكلية التقنية'],
      ['دعم العملاء', 'Zendesk', 'Freshdesk', 'حل النزاعات', 'تدريب الفرق', 'العربية والإنجليزية', 'مؤشرات الأداء', 'كتابة قاعدة المعرفة'],
      []],
  },
};

export const EXAMPLE_ROLES = Object.keys(ROLES);

export function exampleRoleList() {
  return EXAMPLE_ROLES.map((id) => ({ id, labelEn: ROLES[id].labelEn, labelAr: ROLES[id].labelAr }));
}

const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

/**
 * @param {{ role?: string, lang?: 'en'|'ar', seed?: number }} opts
 *   role: one of EXAMPLE_ROLES, or omitted / 'random' for a random one;
 *   seed: picks the invented name and city (random when omitted).
 */
export function exampleCv({ role, lang = 'en', seed } = {}) {
  const s = Number.isFinite(seed) ? seed : Math.floor(Math.random() * 1e6);
  const id = ROLES[role] ? role : pick(EXAMPLE_ROLES, s);
  const L = lang === 'ar' ? 'ar' : 'en';
  const [headline, summary, jobs, edu, skills, certs] = ROLES[id][L];
  const name = pick(NAMES[L], s >> 3);
  const location = pick(CITIES[L], s >> 5);
  const handle = pick(NAMES.en, s >> 3).toLowerCase().replace(/\s+/g, '.');
  const year = new Date().getFullYear();
  const cv = {
    basics: {
      name,
      headline,
      email: `${handle}@example.com`,
      phone: '+000 00 000 0000',
      location,
      links: [{ label: 'LinkedIn', url: `https://www.linkedin.com/in/${handle.replace('.', '-')}-example` }],
      summary,
    },
    experience: jobs.map(([title, company, bullets], i) => ({
      title,
      company,
      location,
      start: i === 0 ? `${year - 3}-03` : `${year - 7}-06`,
      end: i === 0 ? '' : `${year - 3}-02`,
      current: i === 0,
      bullets,
    })),
    education: [{ degree: edu[0], field: edu[1], school: edu[2], location, start: `${year - 11}-09`, end: `${year - 7}-06`, details: '' }],
    skills,
    languages: L === 'ar'
      ? [{ name: 'العربية', level: 'اللغة الأم' }, { name: 'الإنجليزية', level: 'متقدم' }]
      : [{ name: 'English', level: 'Fluent' }, { name: 'Arabic', level: 'Native' }],
    certifications: certs.map(([n, issuer]) => ({ name: n, issuer, date: `${year - 2}-05` })),
    projects: [],
  };
  return { role: id, labelEn: ROLES[id].labelEn, labelAr: ROLES[id].labelAr, cv: sanitizeCv(cv) };
}
