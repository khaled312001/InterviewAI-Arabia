import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORIES = [
  { id: 1, nameAr: 'برمجة',         nameEn: 'Programming',       icon: 'code',         isPremium: false, sortOrder: 10 },
  { id: 2, nameAr: 'محاسبة',        nameEn: 'Accounting',        icon: 'calculator',   isPremium: false, sortOrder: 20 },
  { id: 3, nameAr: 'تسويق',         nameEn: 'Marketing',         icon: 'megaphone',    isPremium: false, sortOrder: 30 },
  { id: 4, nameAr: 'موارد بشرية',   nameEn: 'Human Resources',   icon: 'users',        isPremium: false, sortOrder: 40 },
  { id: 5, nameAr: 'خدمة عملاء',    nameEn: 'Customer Service',  icon: 'headphones',   isPremium: false, sortOrder: 50 },
  { id: 6, nameAr: 'مبيعات',        nameEn: 'Sales',             icon: 'trending-up',  isPremium: true,  sortOrder: 60 },
  { id: 7, nameAr: 'تصميم',         nameEn: 'Design',            icon: 'palette',      isPremium: true,  sortOrder: 70 },
];

// 10 curated Arabic/English questions per category to seed the starter experience.
// Admin can bulk-import more via the dashboard.
const QUESTIONS = {
  1: [ // Programming
    ['عرّف نفسك باختصار واذكر أهم مشروع برمجي عملت عليه.', 'Introduce yourself briefly and describe the most significant software project you worked on.', 'easy'],
    ['ما الفرق بين SQL و NoSQL ومتى تختار كلاً منهما؟', 'Explain SQL vs NoSQL and when you would choose each.', 'medium'],
    ['اشرح مبادئ SOLID مع مثال على أحدها.', 'Explain SOLID principles and give an example of one.', 'medium'],
    ['كيف تتعامل مع تضارب عمليات الدمج في Git؟', 'How do you handle merge conflicts in Git?', 'easy'],
    ['ما هي مراحل دورة حياة تطوير البرمجيات التي تتبعها في فريقك؟', 'What SDLC stages does your team follow?', 'easy'],
    ['اشرح كيف يعمل HTTPS في جملتين.', 'Explain how HTTPS works in two sentences.', 'medium'],
    ['كيف تكتب اختبار وحدة Unit Test جيد؟', 'How do you write a good unit test?', 'medium'],
    ['ما الفرق بين Promise و async/await في JavaScript؟', 'Difference between Promise and async/await in JavaScript?', 'medium'],
    ['صف موقفًا استلمت فيه كودًا سيئًا وكيف تعاملت معه.', 'Describe a time you inherited bad code and how you dealt with it.', 'hard'],
    ['كيف تصمم API يتحمل آلاف الطلبات في الثانية؟', 'How would you design an API to handle thousands of requests/sec?', 'hard'],
  ],
  2: [ // Accounting
    ['ما الفرق بين الميزانية العمومية وقائمة الدخل؟', 'Difference between balance sheet and income statement?', 'easy'],
    ['عرّف المعادلة المحاسبية الأساسية.', 'Define the basic accounting equation.', 'easy'],
    ['ما هي قيود اليومية وما أنواعها؟', 'What are journal entries and their types?', 'medium'],
    ['اشرح مبدأ الاستحقاق في المحاسبة.', 'Explain the accrual principle in accounting.', 'medium'],
    ['ما الفرق بين الإهلاك والاستهلاك؟', 'Difference between depreciation and amortization?', 'medium'],
    ['كيف تراجع ميزانية شركة صغيرة للمرة الأولى؟', 'How would you audit a small company balance sheet for the first time?', 'hard'],
    ['صف كيف يؤثر ضريبة القيمة المضافة على القيود اليومية.', 'How does VAT affect journal entries?', 'medium'],
    ['ما المقصود بالتدفق النقدي الحر؟', 'What is free cash flow?', 'medium'],
    ['كيف تكشف الاحتيال المحاسبي؟', 'How do you detect accounting fraud?', 'hard'],
    ['اذكر IFRS و GAAP وأهم فرق بينهما.', 'Name IFRS and GAAP and the main difference between them.', 'medium'],
  ],
  3: [ // Marketing
    ['ما الفرق بين التسويق والمبيعات؟', 'Difference between marketing and sales?', 'easy'],
    ['اشرح قمع التحويل Marketing Funnel.', 'Explain the marketing funnel.', 'medium'],
    ['كيف تقيس عائد الاستثمار التسويقي ROI؟', 'How do you measure marketing ROI?', 'medium'],
    ['صف حملة إعلانية ناجحة شاركت فيها.', 'Describe a successful ad campaign you worked on.', 'medium'],
    ['ما الفرق بين B2B و B2C في الاستراتيجية؟', 'B2B vs B2C marketing strategy?', 'medium'],
    ['كيف تبني Buyer Persona؟', 'How do you build a buyer persona?', 'easy'],
    ['ما أهمية SEO في الخطة التسويقية الحديثة؟', 'Role of SEO in modern marketing strategy?', 'medium'],
    ['صف فرق A/B testing وأهميته.', 'Describe A/B testing and its importance.', 'medium'],
    ['كيف تتعامل مع أزمة علامة تجارية على وسائل التواصل؟', 'How do you handle a brand crisis on social media?', 'hard'],
    ['كيف تختار المؤثرين Influencers لحملتك؟', 'How do you select influencers for a campaign?', 'medium'],
  ],
  4: [ // HR
    ['عرّف نفسك واشرح لماذا اخترت مجال الموارد البشرية.', 'Introduce yourself and explain why you chose HR.', 'easy'],
    ['كيف تجري مقابلة توظيف فعّالة؟', 'How do you conduct an effective interview?', 'medium'],
    ['ما الفرق بين KPI و OKR؟', 'Difference between KPI and OKR?', 'medium'],
    ['كيف تعالج نزاعًا بين موظفَين؟', 'How do you resolve a conflict between two employees?', 'medium'],
    ['ما أهم عناصر خطة الاستقطاب؟', 'Key components of a recruitment plan?', 'medium'],
    ['صف نظام تقييم أداء فعّال.', 'Describe an effective performance review system.', 'medium'],
    ['كيف تحسب معدل دوران الموظفين ولماذا يهم؟', 'How do you calculate employee turnover and why it matters?', 'medium'],
    ['كيف تبني ثقافة شركة إيجابية؟', 'How do you build a positive company culture?', 'hard'],
    ['كيف تطبّق قانون العمل عند إنهاء خدمة موظف؟', 'How do you apply labor law when terminating an employee?', 'hard'],
    ['ما استراتيجيتك للاحتفاظ بالمواهب؟', 'Your strategy to retain talent?', 'hard'],
  ],
  5: [ // Customer Service
    ['صف موقفًا تعاملت فيه مع عميل غاضب.', 'Describe a time you handled an angry customer.', 'easy'],
    ['ما معنى FCR (First Contact Resolution) ولماذا يهم؟', 'What is FCR and why does it matter?', 'medium'],
    ['كيف تحافظ على هدوئك تحت الضغط؟', 'How do you stay calm under pressure?', 'easy'],
    ['كيف ترفض طلب عميل دون أن تخسره؟', 'How do you say no to a customer without losing them?', 'medium'],
    ['ما الفرق بين تعاطف Empathy و sympathy؟', 'Empathy vs sympathy in customer service?', 'medium'],
    ['اشرح مؤشرات NPS و CSAT.', 'Explain NPS and CSAT metrics.', 'medium'],
    ['كيف توثّق شكوى عميل بشكل احترافي؟', 'How do you document a customer complaint professionally?', 'easy'],
    ['كيف تتعامل مع عميل متعدد القنوات (هاتف + بريد + واتساب)؟', 'How do you handle a multi-channel customer?', 'medium'],
    ['صف مرة تحولت فيها شكوى إلى فرصة بيع.', 'A time you turned a complaint into a sales opportunity?', 'hard'],
    ['ما العلاقة بين تجربة الموظف وتجربة العميل؟', 'Relationship between employee experience and customer experience?', 'hard'],
  ],
  6: [ // Sales (premium)
    ['صف دورة البيع التي تتبعها.', 'Describe your sales cycle.', 'medium'],
    ['كيف تتعامل مع اعتراض "السعر مرتفع"؟', 'How do you handle the "price is too high" objection?', 'medium'],
    ['ما هو SPIN Selling؟', 'What is SPIN Selling?', 'medium'],
    ['كيف تبني خط أنابيب Pipeline قوي؟', 'How do you build a strong sales pipeline?', 'medium'],
    ['صف مرة خسرت فيها صفقة كبيرة — ماذا تعلمت؟', 'A time you lost a major deal — what did you learn?', 'hard'],
    ['ما الفرق بين البيع التبادلي والبيع التصاعدي؟', 'Cross-sell vs upsell?', 'easy'],
    ['كيف تؤهّل العميل المحتمل (Qualification)؟', 'How do you qualify a lead?', 'medium'],
    ['ما هو BANT framework؟', 'What is the BANT framework?', 'medium'],
    ['كيف تتعامل مع صفقة متوقفة لأكثر من شهر؟', 'How do you handle a deal stalled for over a month?', 'hard'],
    ['كيف تستخدم LinkedIn للبحث عن عملاء B2B؟', 'How do you use LinkedIn for B2B prospecting?', 'medium'],
  ],
  7: [ // Design (premium)
    ['ما الفرق بين UX و UI؟', 'Difference between UX and UI?', 'easy'],
    ['صف عملية تصميم Design Thinking.', 'Describe the Design Thinking process.', 'medium'],
    ['كيف تتعامل مع تغذية راجعة صعبة من العميل؟', 'How do you handle tough client feedback?', 'medium'],
    ['ما أهمية الـ Design System؟', 'Importance of a design system?', 'medium'],
    ['كيف تبني رحلة مستخدم User Journey؟', 'How do you build a user journey?', 'medium'],
    ['ما معنى Accessibility ولماذا يهم؟', 'What is accessibility and why it matters?', 'medium'],
    ['صف فرق Wireframe و Prototype و Mockup.', 'Wireframe vs prototype vs mockup?', 'easy'],
    ['كيف تختبر تصميمًا قبل إطلاقه؟', 'How do you test a design before launch?', 'medium'],
    ['اشرح الـ Gestalt Principles بأمثلة.', 'Explain Gestalt principles with examples.', 'hard'],
    ['كيف تتعاون مع المطورين لضمان جودة التطبيق النهائي؟', 'How do you collaborate with developers to ensure quality?', 'medium'],
  ],
};

async function seedCategories() {
  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { id: c.id },
      create: c,
      update: { nameAr: c.nameAr, nameEn: c.nameEn, icon: c.icon, isPremium: c.isPremium, sortOrder: c.sortOrder },
    });
  }
  console.log(`✓ categories: ${CATEGORIES.length}`);
}

async function seedQuestions() {
  let total = 0;
  for (const [categoryId, rows] of Object.entries(QUESTIONS)) {
    const existing = await prisma.question.count({ where: { categoryId: Number(categoryId) } });
    if (existing >= rows.length) continue;
    const toInsert = rows.map(([ar, en, difficulty]) => ({
      categoryId: Number(categoryId),
      questionAr: ar,
      questionEn: en,
      difficulty,
    }));
    const created = await prisma.question.createMany({ data: toInsert });
    total += created.count;
  }
  console.log(`✓ questions: +${total}`);
}

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL || 'admin@barmagly.tech';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMeImmediately!';
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`✓ admin exists: ${email}`);
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.adminUser.create({
    data: { email, passwordHash, name: 'Super Admin', role: 'super_admin' },
  });
  console.log(`✓ admin created: ${email}  (change password immediately)`);
}

async function seedSettings() {
  const defaults = {
    free_daily_question_limit: '5',
    subscription_monthly_price_egp: '29',
    subscription_yearly_price_egp: '249',
    push_welcome_ar: 'أهلاً بك في InterviewAI Arabia! جاهز للتدريب؟',
    push_welcome_en: 'Welcome to InterviewAI Arabia! Ready to practice?',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: {} });
  }
  console.log(`✓ settings: ${Object.keys(defaults).length}`);
}

async function main() {
  console.log('Seeding InterviewAI Arabia DB...');
  await seedCategories();
  await seedQuestions();
  await seedAdmin();
  await seedSettings();
  console.log('Done.');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
