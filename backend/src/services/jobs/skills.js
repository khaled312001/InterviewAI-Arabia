/**
 * Skills vocabulary — the shared language between a CV and a job posting.
 *
 * Matching and the ATS check both need to know that "JS", "JavaScript" and
 * "ECMAScript" are one skill, and that "Go" in "go-to-market" is not the
 * language. A fixed vocabulary does that deterministically, costs nothing per
 * job, and gives the same answer every time — which matters for a score the
 * person will try to improve.
 *
 * Each entry: canonical key, display label, aliases (lower-case). An alias is
 * matched on word boundaries that treat + # . as part of a word, so "c++" and
 * "c#" and ".net" survive and "c" never matches inside "c-level".
 */

const RAW = [
  // ---------------------------------------------------------- software
  ['javascript', 'JavaScript', ['javascript', 'js', 'ecmascript', 'es6']],
  ['typescript', 'TypeScript', ['typescript', 'ts']],
  ['python', 'Python', ['python', 'python3']],
  ['java', 'Java', ['java', 'jvm']],
  ['kotlin', 'Kotlin', ['kotlin']],
  ['swift', 'Swift', ['swift', 'swiftui']],
  ['objective-c', 'Objective-C', ['objective-c', 'objc']],
  ['csharp', 'C#', ['c#', 'csharp']],
  ['cpp', 'C++', ['c++', 'cpp']],
  ['c', 'C', ['c programming', 'ansi c', 'embedded c']],
  ['go', 'Go', ['golang', 'go lang', 'go (golang)']],
  ['rust', 'Rust', ['rust']],
  ['ruby', 'Ruby', ['ruby']],
  ['php', 'PHP', ['php']],
  ['scala', 'Scala', ['scala']],
  ['elixir', 'Elixir', ['elixir']],
  ['dart', 'Dart', ['dart']],
  ['r', 'R', ['r programming', 'rstudio', 'r language']],
  ['matlab', 'MATLAB', ['matlab']],
  ['sql', 'SQL', ['sql', 't-sql', 'pl/sql', 'plsql']],
  ['bash', 'Bash / Shell', ['bash', 'shell scripting', 'shell', 'zsh']],
  ['powershell', 'PowerShell', ['powershell']],
  ['html', 'HTML', ['html', 'html5']],
  ['css', 'CSS', ['css', 'css3', 'sass', 'scss', 'less']],
  ['tailwind', 'Tailwind CSS', ['tailwind', 'tailwindcss', 'tailwind css']],
  ['react', 'React', ['react', 'react.js', 'reactjs']],
  ['react-native', 'React Native', ['react native', 'react-native']],
  ['nextjs', 'Next.js', ['next.js', 'nextjs']],
  ['vue', 'Vue.js', ['vue', 'vue.js', 'vuejs', 'nuxt', 'nuxt.js']],
  ['angular', 'Angular', ['angular', 'angularjs']],
  ['svelte', 'Svelte', ['svelte', 'sveltekit']],
  ['nodejs', 'Node.js', ['node.js', 'nodejs', 'node']],
  ['express', 'Express', ['express.js', 'expressjs']],
  ['nestjs', 'NestJS', ['nestjs', 'nest.js']],
  ['django', 'Django', ['django']],
  ['flask', 'Flask', ['flask']],
  ['fastapi', 'FastAPI', ['fastapi']],
  ['spring', 'Spring', ['spring', 'spring boot', 'springboot']],
  ['dotnet', '.NET', ['.net', 'dotnet', 'asp.net', '.net core']],
  ['rails', 'Ruby on Rails', ['rails', 'ruby on rails', 'ror']],
  ['laravel', 'Laravel', ['laravel']],
  ['flutter', 'Flutter', ['flutter']],
  ['android', 'Android', ['android']],
  ['ios', 'iOS', ['ios']],
  ['graphql', 'GraphQL', ['graphql']],
  ['rest', 'REST APIs', ['rest', 'restful', 'rest api', 'rest apis']],
  ['grpc', 'gRPC', ['grpc']],
  ['microservices', 'Microservices', ['microservices', 'micro-services']],
  ['postgresql', 'PostgreSQL', ['postgresql', 'postgres']],
  ['mysql', 'MySQL', ['mysql', 'mariadb']],
  ['mongodb', 'MongoDB', ['mongodb', 'mongo']],
  ['redis', 'Redis', ['redis']],
  ['elasticsearch', 'Elasticsearch', ['elasticsearch', 'elastic search', 'opensearch']],
  ['kafka', 'Kafka', ['kafka']],
  ['rabbitmq', 'RabbitMQ', ['rabbitmq']],
  ['aws', 'AWS', ['aws', 'amazon web services', 'ec2', 's3', 'lambda']],
  ['gcp', 'Google Cloud', ['gcp', 'google cloud', 'google cloud platform', 'bigquery']],
  ['azure', 'Azure', ['azure', 'microsoft azure']],
  ['docker', 'Docker', ['docker', 'containers']],
  ['kubernetes', 'Kubernetes', ['kubernetes', 'k8s', 'eks', 'gke', 'aks']],
  ['terraform', 'Terraform', ['terraform', 'infrastructure as code', 'iac']],
  ['ansible', 'Ansible', ['ansible']],
  ['ci-cd', 'CI/CD', ['ci/cd', 'ci cd', 'continuous integration', 'continuous delivery', 'github actions', 'gitlab ci', 'jenkins', 'circleci']],
  ['linux', 'Linux', ['linux', 'unix']],
  ['git', 'Git', ['git', 'github', 'gitlab', 'bitbucket']],
  ['testing', 'Automated testing', ['unit testing', 'test automation', 'automated testing', 'jest', 'pytest', 'cypress', 'playwright', 'selenium', 'junit', 'tdd']],
  ['security', 'Cybersecurity', ['cybersecurity', 'cyber security', 'information security', 'infosec', 'application security', 'appsec', 'penetration testing', 'soc', 'siem', 'iam']],
  ['networking', 'Networking', ['networking', 'tcp/ip', 'dns', 'cisco', 'ccna']],
  ['machine-learning', 'Machine learning', ['machine learning', 'ml', 'deep learning', 'scikit-learn', 'sklearn']],
  ['llm', 'LLMs / Generative AI', ['llm', 'llms', 'large language models', 'generative ai', 'genai', 'gen ai', 'prompt engineering', 'rag', 'langchain']],
  ['pytorch', 'PyTorch', ['pytorch']],
  ['tensorflow', 'TensorFlow', ['tensorflow', 'keras']],
  ['nlp', 'NLP', ['nlp', 'natural language processing']],
  ['computer-vision', 'Computer vision', ['computer vision', 'opencv']],
  ['data-analysis', 'Data analysis', ['data analysis', 'data analytics', 'analytics', 'تحليل البيانات']],
  ['data-engineering', 'Data engineering', ['data engineering', 'etl', 'elt', 'data pipelines', 'airflow', 'dbt']],
  ['spark', 'Spark', ['spark', 'pyspark', 'apache spark', 'databricks']],
  ['snowflake', 'Snowflake', ['snowflake']],
  ['pandas', 'pandas', ['pandas', 'numpy']],
  ['statistics', 'Statistics', ['statistics', 'statistical analysis', 'a/b testing', 'ab testing', 'experimentation']],
  ['power-bi', 'Power BI', ['power bi', 'powerbi']],
  ['tableau', 'Tableau', ['tableau']],
  ['looker', 'Looker', ['looker', 'looker studio']],
  ['excel', 'Excel', ['excel', 'microsoft excel', 'ms excel', 'spreadsheets', 'vlookup', 'pivot tables', 'إكسل', 'اكسل']],
  ['figma', 'Figma', ['figma']],
  ['ux', 'UX design', ['ux', 'user experience', 'ux design', 'user research', 'usability testing', 'wireframing', 'prototyping']],
  ['ui', 'UI design', ['ui', 'ui design', 'user interface', 'visual design', 'interaction design']],
  ['product-management', 'Product management', ['product management', 'product manager', 'product roadmap', 'product strategy', 'roadmap']],
  ['agile', 'Agile / Scrum', ['agile', 'scrum', 'kanban', 'sprint planning']],
  ['jira', 'Jira', ['jira', 'confluence']],
  ['system-design', 'System design', ['system design', 'distributed systems', 'scalability', 'high availability']],
  ['sre', 'SRE / Observability', ['sre', 'site reliability', 'observability', 'monitoring', 'prometheus', 'grafana', 'datadog', 'new relic']],
  ['blockchain', 'Blockchain', ['blockchain', 'web3', 'solidity', 'smart contracts', 'ethereum']],
  ['salesforce', 'Salesforce', ['salesforce', 'sfdc']],
  ['sap', 'SAP', ['sap', 's/4hana', 'sap erp']],
  ['erp', 'ERP', ['erp', 'oracle erp', 'netsuite', 'odoo', 'dynamics 365']],
  ['wordpress', 'WordPress', ['wordpress']],
  ['shopify', 'Shopify', ['shopify']],
  ['unity', 'Unity', ['unity', 'unity3d']],
  ['unreal', 'Unreal Engine', ['unreal', 'unreal engine']],
  ['embedded', 'Embedded systems', ['embedded systems', 'firmware', 'rtos', 'microcontrollers']],
  ['qa', 'Quality assurance', ['quality assurance', 'qa', 'manual testing', 'test cases']],
  // --------------------------------------------------- business & ops
  ['project-management', 'Project management', ['project management', 'pmp', 'prince2', 'project planning', 'إدارة المشاريع', 'ادارة المشاريع']],
  ['program-management', 'Program management', ['program management', 'programme management']],
  ['stakeholder-management', 'Stakeholder management', ['stakeholder management', 'stakeholder engagement']],
  ['operations', 'Operations', ['operations management', 'business operations', 'process improvement', 'lean', 'six sigma']],
  ['supply-chain', 'Supply chain', ['supply chain', 'logistics', 'procurement', 'inventory management', 'سلاسل الإمداد', 'المشتريات']],
  ['strategy', 'Strategy', ['business strategy', 'strategic planning', 'corporate strategy', 'management consulting']],
  ['business-analysis', 'Business analysis', ['business analysis', 'business analyst', 'requirements gathering', 'bpmn']],
  ['sales', 'Sales', ['sales', 'b2b sales', 'business development', 'account executive', 'lead generation', 'cold calling', 'المبيعات', 'مبيعات']],
  ['account-management', 'Account management', ['account management', 'key account management', 'client relationship']],
  ['customer-success', 'Customer success', ['customer success', 'customer onboarding', 'churn']],
  ['customer-service', 'Customer service', ['customer service', 'customer support', 'call center', 'help desk', 'zendesk', 'خدمة العملاء']],
  ['crm', 'CRM', ['crm', 'hubspot', 'pipedrive']],
  ['marketing', 'Marketing', ['marketing', 'digital marketing', 'growth marketing', 'التسويق', 'تسويق']],
  ['seo', 'SEO', ['seo', 'search engine optimization', 'sem']],
  ['ppc', 'Paid ads', ['ppc', 'google ads', 'paid search', 'paid social', 'meta ads', 'facebook ads', 'performance marketing']],
  ['content', 'Content', ['content marketing', 'content strategy', 'copywriting', 'content writing', 'editing', 'كتابة المحتوى']],
  ['social-media', 'Social media', ['social media', 'social media marketing', 'community management']],
  ['brand', 'Brand', ['brand management', 'branding', 'brand strategy']],
  ['email-marketing', 'Email marketing', ['email marketing', 'marketing automation', 'mailchimp', 'klaviyo']],
  ['pr', 'Public relations', ['public relations', 'pr', 'communications', 'media relations']],
  ['finance', 'Finance', ['finance', 'financial analysis', 'fp&a', 'financial planning', 'budgeting', 'forecasting', 'المالية']],
  ['accounting', 'Accounting', ['accounting', 'bookkeeping', 'accounts payable', 'accounts receivable', 'general ledger', 'gaap', 'ifrs', 'المحاسبة', 'محاسبة']],
  ['audit', 'Audit', ['audit', 'internal audit', 'external audit', 'sox']],
  ['tax', 'Tax', ['tax', 'taxation', 'vat', 'الضرائب']],
  ['financial-modeling', 'Financial modelling', ['financial modeling', 'financial modelling', 'valuation', 'dcf']],
  ['cfa', 'CFA', ['cfa']],
  ['acca', 'ACCA / CPA', ['acca', 'cpa', 'cma']],
  ['risk', 'Risk & compliance', ['risk management', 'compliance', 'aml', 'kyc', 'regulatory']],
  ['legal', 'Legal', ['legal', 'contract law', 'contracts', 'litigation', 'corporate law', 'paralegal']],
  ['hr', 'Human resources', ['human resources', 'hr', 'hrbp', 'employee relations', 'الموارد البشرية']],
  ['recruiting', 'Recruiting', ['recruiting', 'recruitment', 'talent acquisition', 'sourcing', 'التوظيف']],
  ['payroll', 'Payroll', ['payroll', 'compensation and benefits', 'c&b']],
  ['training', 'Training & development', ['training', 'learning and development', 'l&d', 'coaching']],
  ['teaching', 'Teaching', ['teaching', 'curriculum', 'lesson planning', 'tutoring', 'التدريس']],
  ['healthcare', 'Healthcare', ['healthcare', 'patient care', 'clinical', 'nursing', 'ehr', 'emr']],
  ['pharma', 'Pharma', ['pharmaceutical', 'pharmacovigilance', 'clinical trials', 'gmp']],
  ['engineering-civil', 'Civil engineering', ['civil engineering', 'autocad', 'revit', 'structural engineering', 'construction management']],
  ['engineering-mechanical', 'Mechanical engineering', ['mechanical engineering', 'solidworks', 'cad', 'hvac']],
  ['engineering-electrical', 'Electrical engineering', ['electrical engineering', 'plc', 'scada', 'power systems']],
  ['hospitality', 'Hospitality', ['hospitality', 'hotel management', 'food and beverage', 'f&b']],
  ['retail', 'Retail', ['retail', 'merchandising', 'store management', 'visual merchandising']],
  ['real-estate', 'Real estate', ['real estate', 'property management']],
  ['translation', 'Translation', ['translation', 'localization', 'localisation', 'interpreting', 'الترجمة']],
  ['video', 'Video & motion', ['video editing', 'premiere pro', 'after effects', 'motion graphics', 'final cut']],
  ['graphic-design', 'Graphic design', ['graphic design', 'photoshop', 'illustrator', 'indesign', 'adobe creative suite', 'canva']],
  // ------------------------------------------------------ transferable
  ['leadership', 'Leadership', ['leadership', 'team leadership', 'people management', 'team management', 'managing teams', 'القيادة']],
  ['communication', 'Communication', ['communication skills', 'written communication', 'verbal communication', 'presentation skills', 'public speaking', 'التواصل']],
  ['problem-solving', 'Problem solving', ['problem solving', 'problem-solving', 'analytical skills', 'critical thinking']],
  ['negotiation', 'Negotiation', ['negotiation', 'negotiating', 'التفاوض']],
  ['english', 'English', ['english', 'fluent english', 'الإنجليزية', 'اللغة الإنجليزية']],
  ['arabic', 'Arabic', ['arabic', 'العربية', 'اللغة العربية']],
  ['french', 'French', ['french', 'français', 'الفرنسية']],
  ['german', 'German', ['german', 'deutsch', 'الألمانية']],
  ['spanish', 'Spanish', ['spanish', 'español']],
];

/** @type {Map<string, {key:string,label:string,aliases:string[]}>} */
export const SKILLS = new Map(RAW.map(([key, label, aliases]) => [key, { key, label, aliases }]));

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * One alternation per skill. Boundaries treat letters, digits, + and # as part
 * of a word so "c++" does not match inside "c+++" and "java" does not match in
 * "javascript"; a dot is part of a word only when a letter follows it, so the
 * full stop after "Python." still ends the word.
 */
const MATCHERS = RAW.map(([key, , aliases]) => {
  const alts = aliases
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((a) => escape(a).replace(/\\ /g, '\\s+').replace(/ /g, '\\s+'));
  return {
    key,
    re: new RegExp(`(?<![\\p{L}\\p{N}+#.])(?:${alts.join('|')})(?![\\p{L}\\p{N}+#]|\\.[\\p{L}])`, 'giu'),
  };
});

/**
 * Words that are skills only when written a certain way. "Go" is the language
 * only as "Golang"/"Go (Golang)", which the alias list already requires; these
 * short aliases are dropped unless they appear in their exact original case.
 */
const CASE_SENSITIVE = new Map([
  ['ts', /(?<![\p{L}\p{N}])TS(?![\p{L}\p{N}])/u],
  ['ml', /(?<![\p{L}\p{N}])ML(?![\p{L}\p{N}])/u],
  ['ui', /(?<![\p{L}\p{N}])UI(?![\p{L}\p{N}])/u],
  ['ux', /(?<![\p{L}\p{N}])UX(?![\p{L}\p{N}])/u],
  ['pr', /(?<![\p{L}\p{N}])PR(?![\p{L}\p{N}])/u],
  ['hr', /(?<![\p{L}\p{N}])HR(?![\p{L}\p{N}])/u],
  ['qa', /(?<![\p{L}\p{N}])QA(?![\p{L}\p{N}])/u],
  ['soc', /(?<![\p{L}\p{N}])SOC(?![\p{L}\p{N}])/u],
  ['iam', /(?<![\p{L}\p{N}])IAM(?![\p{L}\p{N}])/u],
  ['sem', /(?<![\p{L}\p{N}])SEM(?![\p{L}\p{N}])/u],
  ['rag', /(?<![\p{L}\p{N}])RAG(?![\p{L}\p{N}])/u],
  ['ror', /(?<![\p{L}\p{N}])RoR(?![\p{L}\p{N}])/u],
  ['sap', /(?<![\p{L}\p{N}])SAP(?![\p{L}\p{N}])/u],
  ['us', /(?<![\p{L}\p{N}])US(?![\p{L}\p{N}])/u],
  ['node', /(?<![\p{L}\p{N}])Node(?![\p{L}\p{N}])/u],
  ['shell', /(?<![\p{L}\p{N}])[Ss]hell scripting|(?<![\p{L}\p{N}])Shell(?![\p{L}\p{N}])/u],
  ['spark', /(?<![\p{L}\p{N}])(?:Spark|PySpark)(?![\p{L}\p{N}])/u],
  ['unity', /(?<![\p{L}\p{N}])Unity(?:3D)?(?![\p{L}\p{N}])/u],
  ['swift', /(?<![\p{L}\p{N}])Swift(?:UI)?(?![\p{L}\p{N}])/u],
  ['rust', /(?<![\p{L}\p{N}])Rust(?![\p{L}\p{N}])/u],
  ['dart', /(?<![\p{L}\p{N}])Dart(?![\p{L}\p{N}])/u],
  ['flask', /(?<![\p{L}\p{N}])Flask(?![\p{L}\p{N}])/u],
  ['express.js', null],
  ['lean', /(?<![\p{L}\p{N}])Lean(?: Six Sigma| manufacturing| methodology)/u],
  ['tax', /(?<![\p{L}\p{N}])[Tt]ax(?:ation)?(?![\p{L}\p{N}])/u],
  ['editing', /(?<![\p{L}\p{N}])[Ee]diting(?![\p{L}\p{N}])/u],
  ['containers', /(?<![\p{L}\p{N}])containers(?![\p{L}\p{N}])/u],
  ['shopify', /(?<![\p{L}\p{N}])Shopify(?![\p{L}\p{N}])/u],
  ['canva', /(?<![\p{L}\p{N}])Canva(?![\p{L}\p{N}])/u],
  ['lambda', /(?<![\p{L}\p{N}])(?:AWS )?Lambda(?![\p{L}\p{N}])/u],
  ['monitoring', /(?<![\p{L}\p{N}])monitoring(?![\p{L}\p{N}])/iu],
  ['training', /(?<![\p{L}\p{N}])[Tt]raining(?: and development| programs?)/u],
  ['english', /(?<![\p{L}\p{N}])(?:English|الإنجليزية)(?![\p{L}\p{N}])/u],
  ['german', /(?<![\p{L}\p{N}])(?:German|Deutsch|الألمانية)(?![\p{L}\p{N}])/u],
  ['french', /(?<![\p{L}\p{N}])(?:French|Français|الفرنسية)(?![\p{L}\p{N}])/u],
  ['spanish', /(?<![\p{L}\p{N}])(?:Spanish|Español)(?![\p{L}\p{N}])/u],
  ['arabic', /(?<![\p{L}\p{N}])(?:Arabic|العربية)(?![\p{L}\p{N}])/u],
]);

/** Aliases that are too generic alone to count unless their case/phrase rule passes. */
function aliasAllowed(alias, text) {
  if (!CASE_SENSITIVE.has(alias)) return true;
  const re = CASE_SENSITIVE.get(alias);
  return re ? re.test(text) : true;
}

/**
 * Canonical skill keys found in a text, most-mentioned first.
 * @param {string} text
 * @param {{ limit?: number }} [opts]
 * @returns {string[]}
 */
export function extractSkills(text, { limit = 40 } = {}) {
  const src = String(text || '');
  if (!src) return [];
  const counts = new Map();
  for (const { key, re } of MATCHERS) {
    re.lastIndex = 0;
    let n = 0;
    for (const m of src.matchAll(re)) {
      const alias = m[0].toLowerCase().replace(/\s+/g, ' ');
      if (!aliasAllowed(alias, src)) continue;
      n += 1;
    }
    if (n) counts.set(key, n);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

/** Map free-form skill names (from a CV form) to canonical keys, keeping unknown ones as-is. */
export function canonicalSkills(list) {
  const out = new Set();
  for (const raw of list || []) {
    const s = String(raw || '').trim();
    if (!s) continue;
    const hits = extractSkills(s, { limit: 3 });
    if (hits.length) hits.forEach((h) => out.add(h));
    else out.add(s.toLowerCase().slice(0, 60));
  }
  return [...out];
}

export function skillLabel(key) {
  return SKILLS.get(key)?.label || key;
}
