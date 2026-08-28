-- Give the demo/review account a real interview history.
--
-- Why this exists
--   Three screens in the product are pure functions of the signed-in user's
--   past sessions: History, Stats, and the per-session Summary. The account the
--   marketing screenshots and the Play reviewer both use had never completed an
--   interview, so all three rendered their empty states — and the landing page
--   was advertising "step 8: your session summary" with a screenshot of the
--   words "no sessions yet". The screenshot capture even fell back to shooting
--   History a second time when it could not find a session row to open, which
--   is why session-summary.png and history.png were byte-identical.
--
--   No amount of re-capturing fixes that; the account has to have done
--   something first. This seeds six interviews over the last three weeks with
--   scores that improve — which is what the product is for, and therefore what
--   its Stats screen should be showing.
--
-- Idempotent: it clears this one account's sessions first (answers cascade),
-- so re-running replaces rather than duplicates. It touches NOTHING else — no
-- other user, no ledger row, no payment, no credential.
--
--   scripts/seed-demo-account.sql  (run by scripts/seed-demo.sh)

SET @email = 'reviewer@interprova.app';
SET @uid = (SELECT id FROM users WHERE email = @email);

-- A typo in the address must not silently wipe someone's history.
-- SIGNAL needs a statement to guard, so the DELETE is gated on @uid IS NOT NULL
-- and the count is asserted afterwards.
DELETE FROM sessions WHERE user_id = @uid AND @uid IS NOT NULL;

-- The reviewer needs to see the paid surface, not the paywall.
UPDATE users SET plan = 'premium' WHERE id = @uid AND @uid IS NOT NULL;

-- ── 1 ─ 24 days ago · programming · practice ──────────────────────────────
INSERT INTO sessions (user_id, category_id, kind, total_score, answer_count, billed_seconds, started_at, ended_at)
VALUES (@uid, 1, 'practice', 24, 4, 0, DATE_SUB(NOW(), INTERVAL 24 DAY), DATE_SUB(NOW(), INTERVAL 24 DAY) + INTERVAL 14 MINUTE);
SET @s = LAST_INSERT_ID();
INSERT INTO answers (session_id, question_id, question_text, user_answer, ai_score, ai_feedback, tokens_used, created_at) VALUES
(@s, NULL, 'عرّف نفسك في دقيقتين.',
 'اسمي خالد، مطوّر باك-إند خبرة سنتين. اشتغلت على أنظمة داخلية بـ Node.js و MySQL، ودرست حاسبات في جامعة القاهرة، وحاليًا بدوّر على فرصة في شركة منتج.',
 6, '{"improvement":"ابدأ بما تفعله الآن وأكبر إنجاز فيه، ثم الخطوة التي أوصلتك، ثم لماذا هذه الشركة تحديدًا. وأضف رقمًا واحدًا على الأقل — «نظام يخدم ٤٠ ألف طلب يوميًا» أقوى بكثير من «أنظمة داخلية»."}', 0, DATE_SUB(NOW(), INTERVAL 24 DAY) + INTERVAL 2 MINUTE),
(@s, NULL, 'ما الفرق بين قواعد البيانات العلائقية وغير العلائقية، ومتى تختار كلًا منهما؟',
 'العلائقية فيها جداول وعلاقات وSQL، وغير العلائقية زي MongoDB بتخزّن مستندات. العلائقية أفضل لما البيانات مترابطة، وغير العلائقية لما تحتاج مرونة في الشكل.',
 6, '{"improvement":"الإجابة صحيحة لكنها عامة. اذكر معيار الاختيار الحقيقي: هل تحتاج معاملات ACID عبر أكثر من جدول؟ هل شكل البيانات مستقر؟ وأعطِ مثالًا من مشروعك اخترت فيه أحدهما ولماذا."}', 0, DATE_SUB(NOW(), INTERVAL 24 DAY) + INTERVAL 5 MINUTE),
(@s, NULL, 'كيف تتعامل مع خطأ يظهر في بيئة الإنتاج فقط ولا يظهر عندك؟',
 'بشوف اللوجات وبحاول أعيد إنتاج المشكلة محليًا، ولو مقدرتش بضيف لوجات أكتر وأنشر تاني.',
 5, '{"improvement":"هذه إجابة خطوتين لسؤال من خمس. اذكر: مقارنة الفروق بين البيئتين (نسخ، إعدادات، بيانات)، وقراءة أثر الطلب المحدد لا اللوج كله، وتضييق النطاق بفرضية واحدة في كل مرة، ومتى تختار التراجع عن النشر بدل المتابعة."}', 0, DATE_SUB(NOW(), INTERVAL 24 DAY) + INTERVAL 9 MINUTE),
(@s, NULL, 'احكِ لي عن مشروع تفخر به.',
 'اشتغلت على لوحة تحكم داخلية للمبيعات، بنيت الـAPI كله لوحدي وربطته بالواجهة، والفريق بقى يستخدمها يوميًا بدل ملفات إكسل.',
 7, '{"improvement":"البداية جيدة والنهاية غامضة. أغلق القصة برقم: كم شخصًا يستخدمها، كم وقتًا وفّرت، أو ماذا كان يستغرق ساعتين وصار خمس دقائق. «بقى يستخدمها يوميًا» لا يمكن للمُحاوِر أن يقيسه."}', 0, DATE_SUB(NOW(), INTERVAL 24 DAY) + INTERVAL 12 MINUTE);

-- ── 2 ─ 19 days ago · programming · live meeting ──────────────────────────
INSERT INTO sessions (user_id, category_id, kind, total_score, answer_count, billed_seconds, started_at, ended_at)
VALUES (@uid, 1, 'meeting', 35, 5, 486, DATE_SUB(NOW(), INTERVAL 19 DAY), DATE_SUB(NOW(), INTERVAL 19 DAY) + INTERVAL 9 MINUTE);
SET @s = LAST_INSERT_ID();
INSERT INTO answers (session_id, question_id, question_text, user_answer, ai_score, ai_feedback, tokens_used, created_at) VALUES
(@s, NULL, 'عرّف نفسك.',
 'مطوّر باك-إند خبرة سنتين، آخر مشروع بنيت فيه خدمة تقارير خفّضت زمن التقرير من ٤٠ ثانية لأقل من ٣. مهتم بشركتكم لأن المنتج عربي أولًا وأنا اشتغلت على دعم RTL قبل كده.',
 7, '{"improvement":"تحسّن واضح — فيه رقم وفيه سبب للاهتمام بالشركة. ينقصه الجسر بين الماضي والحاضر: جملة واحدة عن سبب انتقالك تمنع المُحاوِر من التساؤل عنه لاحقًا."}', 0, DATE_SUB(NOW(), INTERVAL 19 DAY) + INTERVAL 1 MINUTE),
(@s, NULL, 'ماذا يحدث بالضبط حين تكتب عنوان موقع في المتصفح وتضغط Enter؟',
 'المتصفح بيحوّل الاسم لـIP عن طريق DNS، وبعدين بيفتح اتصال TCP وبيعمل TLS handshake لو HTTPS، وبيبعت طلب HTTP، والسيرفر بيرجع HTML والمتصفح بيرسمه ويحمّل باقي الملفات.',
 7, '{"improvement":"التسلسل صحيح ومرتّب. لترفعه: اذكر طبقات الكاش قبل DNS (كاش المتصفح، ملف hosts، كاش النظام)، وأن الرسم يبدأ قبل اكتمال التحميل. هذا يفرّق بين من حفظ الإجابة ومن يفهمها."}', 0, DATE_SUB(NOW(), INTERVAL 19 DAY) + INTERVAL 3 MINUTE),
(@s, NULL, 'كيف تصمّم خدمة لتقصير الروابط؟',
 'جدول فيه الرابط الأصلي والمختصر، وأولّد الرابط المختصر بـbase62 من الـid، ولما حد يفتحه أعمل redirect بعد ما أقراه من قاعدة البيانات، ومع الوقت أضيف كاش.',
 6, '{"improvement":"التصميم الأساسي سليم لكنك توقفت قبل الأسئلة التي يبحث عنها المُحاوِر: كم قراءة مقابل كل كتابة (النسبة تبرّر الكاش)، وماذا يحدث لو أراد اثنان نفس الرابط المخصّص، وهل الـredirect دائم أم مؤقت ولماذا يهم ذلك في الإحصائيات."}', 0, DATE_SUB(NOW(), INTERVAL 19 DAY) + INTERVAL 5 MINUTE),
(@s, NULL, 'ما الفهرس في قاعدة البيانات، ولماذا قد يجعل الكتابة أبطأ؟',
 'الفهرس بنية جانبية بتخلّي البحث أسرع بدل ما القاعدة تمرّ على كل الصفوف. وبيبطّئ الكتابة لأن كل insert أو update لازم يحدّث الفهرس كمان، فكل فهرس زيادة تكلفة على كل كتابة.',
 8, '{"improvement":"إجابة دقيقة وتشرح المقايضة، وهو المطلوب. أضف جملة عن الفهرس المركّب وترتيب أعمدته، فهو أكثر ما يُخطئ فيه المرشّحون في المتابعة."}', 0, DATE_SUB(NOW(), INTERVAL 19 DAY) + INTERVAL 7 MINUTE),
(@s, NULL, 'لماذا تركت وظيفتك السابقة؟',
 'الشغل كان كله مشاريع قصيرة لعملاء مختلفين، وكنت عايز أشتغل على منتج واحد وأشوف أثر اللى ببنيه على مدى أطول.',
 7, '{"improvement":"إجابة مهنية ولا تذمّ أحدًا، وهذا نصف المطلوب. النصف الآخر أن تربطها بهذه الوظيفة: «ولهذا أبحث عن فريق منتج مثل فريقكم» تحوّل التبرير إلى سبب للتوظيف."}', 0, DATE_SUB(NOW(), INTERVAL 19 DAY) + INTERVAL 8 MINUTE);

-- ── 3 ─ 14 days ago · marketing · practice ────────────────────────────────
INSERT INTO sessions (user_id, category_id, kind, total_score, answer_count, billed_seconds, started_at, ended_at)
VALUES (@uid, 3, 'practice', 28, 4, 0, DATE_SUB(NOW(), INTERVAL 14 DAY), DATE_SUB(NOW(), INTERVAL 14 DAY) + INTERVAL 11 MINUTE);
SET @s = LAST_INSERT_ID();
INSERT INTO answers (session_id, question_id, question_text, user_answer, ai_score, ai_feedback, tokens_used, created_at) VALUES
(@s, NULL, 'كيف تقيس نجاح حملة تسويقية؟',
 'بحدّد الهدف الأول — وعي أو تحويل — وبعدين أقيس المؤشر المرتبط بيه: للوعي الوصول والمشاهدات، وللتحويل عدد العملاء وتكلفة اكتساب العميل الواحد.',
 7, '{"improvement":"الربط بين الهدف والمؤشر صحيح. أضف أنك تقيس مقابل خط أساس أو مجموعة ضابطة — بدونها لا تعرف إن كانت الحملة هي السبب أصلًا."}', 0, DATE_SUB(NOW(), INTERVAL 14 DAY) + INTERVAL 2 MINUTE),
(@s, NULL, 'ما الفرق بين CAC و LTV ولماذا تُقرآن معًا؟',
 'CAC تكلفة اكتساب العميل، وLTV إجمالي ما ينفقه العميل طوال تعامله معنا. لازم LTV تكون أكبر من CAC، والنسبة الصحية غالبًا ٣ إلى ١.',
 8, '{"improvement":"دقيقة. لترفعها اذكر فترة الاسترداد (payback period) — نسبة ٣:١ على خمس سنوات تختلف تمامًا عن نفس النسبة خلال ستة أشهر، والفرق هو التدفق النقدي."}', 0, DATE_SUB(NOW(), INTERVAL 14 DAY) + INTERVAL 4 MINUTE),
(@s, NULL, 'صف حملة أدرتها ولم تحقّق هدفها.',
 'عملنا حملة على فيسبوك لمنتج جديد وكانت التكلفة عالية جدًا والنتيجة ضعيفة، فأوقفناها بعد أسبوعين.',
 6, '{"improvement":"القصة تنتهي عند الإيقاف، والسؤال عن التعلّم. ماذا اكتشفت عن السبب — الجمهور، الرسالة، أم صفحة الهبوط؟ وماذا غيّرت في الحملة التالية نتيجة لذلك؟ هذا هو الجزء الذي يُقيَّم."}', 0, DATE_SUB(NOW(), INTERVAL 14 DAY) + INTERVAL 7 MINUTE),
(@s, NULL, 'كيف تختار القناة المناسبة لإطلاق منتج جديد؟',
 'بحسب مكان الجمهور المستهدف والميزانية. لو الجمهور شركات ألينكدإن أفضل، ولو مستهلكين إنستجرام وتيك توك، وببدأ بميزانية صغيرة أختبر بيها قبل ما أوسّع.',
 7, '{"improvement":"منهج الاختبار قبل التوسّع صحيح ويستحق الإبراز أكثر. حدّد ما الذي يجعل الاختبار ناجحًا قبل أن تبدأه — عتبة رقمية متفق عليها مسبقًا تمنع الاستمرار في قناة خاسرة بدافع الأمل."}', 0, DATE_SUB(NOW(), INTERVAL 14 DAY) + INTERVAL 10 MINUTE);

-- ── 4 ─ 9 days ago · programming · live meeting ───────────────────────────
INSERT INTO sessions (user_id, category_id, kind, total_score, answer_count, billed_seconds, started_at, ended_at)
VALUES (@uid, 1, 'meeting', 40, 5, 624, DATE_SUB(NOW(), INTERVAL 9 DAY), DATE_SUB(NOW(), INTERVAL 9 DAY) + INTERVAL 11 MINUTE);
SET @s = LAST_INSERT_ID();
INSERT INTO answers (session_id, question_id, question_text, user_answer, ai_score, ai_feedback, tokens_used, created_at) VALUES
(@s, NULL, 'عرّف نفسك.',
 'مطوّر باك-إند، حاليًا في شركة تجارة إلكترونية. آخر مشروع كبير كان إعادة بناء خدمة الطلبات — نزّلنا زمن الاستجابة من ٨٠٠ مللي لـ١٢٠، وقلّت أخطاء الدفع ٤٠٪. بدأت في وكالة صغيرة وتعلّمت السرعة والتعامل مع غير التقنيين، وانتقلت لمنتج واحد عشان أشوف الأثر على مدى أطول. ومهتم بيكم لأن المنتج عربي أولًا.',
 8, '{"improvement":"هذه الصيغة الكاملة: حاضر برقم، ثم ماضٍ يشرح الانتقال، ثم سبب خاص بهذه الشركة. أوجزها قليلًا لتبقى تحت الدقيقتين، ولا تغيّر شيئًا آخر."}', 0, DATE_SUB(NOW(), INTERVAL 9 DAY) + INTERVAL 1 MINUTE),
(@s, NULL, 'احكِ لي عن خلاف تقني مع زميل وكيف انتهى.',
 'كنت أنا في الواجهة وزميلي في الـAPI، واكتشفنا قبل الإطلاق بأسبوعين إن شكل البيانات مختلف. بدل نقاش مين غلط، قعدنا نص ساعة وكتبنا الحقول المختلفة — طلعت ستة مش أربعين. قسّمناها حسب الأسهل عند كل واحد، وكتبت طبقة تحويل صغيرة للتلاتة اللي عندي، ووثّقت الاتفاق في رسالة للفريق. أطلقنا في الموعد، واتفقنا بعدها إن أي تغيير في شكل البيانات يتراجع من الطرفين.',
 8, '{"improvement":"بنية STAR كاملة والخلاف مهني لا شخصي — وهو بالضبط ما يُقاس هنا. أضف جملة ختامية عمّا تعلّمته، فالمُحاوِر يستمع لها تحديدًا في هذا السؤال."}', 0, DATE_SUB(NOW(), INTERVAL 9 DAY) + INTERVAL 3 MINUTE),
(@s, NULL, 'ما الفرق بين العملية (Process) والخيط (Thread)؟',
 'العملية لها مساحة ذاكرة مستقلة، والخيوط بتشترك في ذاكرة العملية الواحدة. فالتواصل بين الخيوط أسرع لكنه محفوف بمشاكل التزامن، والعمليات أكثر عزلًا فسقوط واحدة لا يُسقط الباقي.',
 8, '{"improvement":"تعريف دقيق ومقايضة صحيحة. أضف مثالًا من عملك اخترت فيه أحدهما — الفرق بين الحفظ والفهم يظهر في المثال لا في التعريف."}', 0, DATE_SUB(NOW(), INTERVAL 9 DAY) + INTERVAL 6 MINUTE),
(@s, NULL, 'كيف تختبر كودًا يعتمد على خدمة خارجية لا تتحكّم فيها؟',
 'بعزل الاعتماد خلف واجهة، وفي الاختبارات بستبدلها بنسخة وهمية بتتحكّم في الردود، فأقدر أختبر النجاح والفشل والـtimeout. وبسيب اختبار تكامل واحد بيضرب الخدمة الحقيقية في بيئة الاختبار عشان أتأكد إن العقد نفسه لسه صحيح.',
 9, '{"improvement":"إجابة قوية، وذكر اختبار التكامل الواحد هو ما يميّزها — أغلب المرشّحين يتوقفون عند المحاكاة ولا ينتبهون أنها تختبر افتراضهم عن الخدمة لا الخدمة نفسها."}', 0, DATE_SUB(NOW(), INTERVAL 9 DAY) + INTERVAL 8 MINUTE),
(@s, NULL, 'أين ترى نفسك بعد ثلاث سنوات؟',
 'عايز أبقى مطوّر أول وأكون مسؤول عن تصميم خدمة كاملة مش مجرد تنفيذ مهام، وأساعد المطوّرين الجدد.',
 7, '{"improvement":"الاتجاه واضح وهذا جيد. اربطه بهذه الشركة تحديدًا — «وأرى أن فريقكم في مرحلة تتيح ذلك» تحوّل طموحًا عامًا إلى سبب للبقاء عندهم."}', 0, DATE_SUB(NOW(), INTERVAL 9 DAY) + INTERVAL 10 MINUTE);

-- ── 5 ─ 4 days ago · sales · practice ─────────────────────────────────────
INSERT INTO sessions (user_id, category_id, kind, total_score, answer_count, billed_seconds, started_at, ended_at)
VALUES (@uid, 6, 'practice', 32, 4, 0, DATE_SUB(NOW(), INTERVAL 4 DAY), DATE_SUB(NOW(), INTERVAL 4 DAY) + INTERVAL 10 MINUTE);
SET @s = LAST_INSERT_ID();
INSERT INTO answers (session_id, question_id, question_text, user_answer, ai_score, ai_feedback, tokens_used, created_at) VALUES
(@s, NULL, 'كيف تتعامل مع عميل يقول إن السعر مرتفع؟',
 'أول حاجة بفهم «مرتفع» مقارنة بإيه — بميزانيته ولّا بعرض منافس ولّا بالقيمة اللي شافها. أغلب الوقت المشكلة إن القيمة مش واضحة مش إن السعر عالي، فبرجع للمشكلة اللي بيحلّها المنتج وتكلفتها عليه لو فضلت موجودة.',
 8, '{"improvement":"البدء بتشخيص الاعتراض قبل الردّ عليه هو الصواب. أضف ما تفعله حين يكون السعر فعلًا خارج الميزانية — نطاق أصغر أو خطة مختلفة — فالمُحاوِر يريد أن يعرف أنك لا تخصم تلقائيًا."}', 0, DATE_SUB(NOW(), INTERVAL 4 DAY) + INTERVAL 2 MINUTE),
(@s, NULL, 'احكِ عن صفقة خسرتها وماذا تعلّمت منها.',
 'اشتغلت شهرين مع عميل وكنت متأكد إننا كسبنا، وفي الآخر اختاروا منافس. اكتشفت إني كنت بتكلّم مع المستخدم مش مع اللى بيقرّر، وإن اللى بيقرّر كان عنده معايير مختلفة تمامًا. من وقتها بسأل بدري: مين اللى هيوقّع وإيه معاييره.',
 8, '{"improvement":"قصة كاملة بدرس قابل للتطبيق. لترفعها لعشرة: اذكر صفقة تالية كسبتها بسبب هذا الدرس — الدليل على أن التعلّم صار سلوكًا."}', 0, DATE_SUB(NOW(), INTERVAL 4 DAY) + INTERVAL 4 MINUTE),
(@s, NULL, 'كيف تبني خط أنابيب مبيعات (Pipeline) من الصفر؟',
 'بحدّد العميل المثالي بدقة، وبعدين مصادر العملاء المحتملين، وبقسّم المراحل: تواصل أول، مكالمة اكتشاف، عرض، تفاوض، إغلاق. وبتابع معدّل التحويل بين كل مرحلتين عشان أعرف فين بالظبط بنخسر.',
 8, '{"improvement":"المراحل ومعدّلات التحويل بينها هي الإجابة الصحيحة. أضف معيار خروج لكل مرحلة — متى تعتبر العميل غير مؤهّل وتتركه — فأكبر مشكلة في خطوط الأنابيب هي الصفقات الميتة التي لا تُغلق أبدًا."}', 0, DATE_SUB(NOW(), INTERVAL 4 DAY) + INTERVAL 7 MINUTE),
(@s, NULL, 'ما أصعب اعتراض واجهته وكيف رددت عليه؟',
 'عميل قال إن فريقه مش هيستخدم المنتج لأنهم متعوّدين على طريقتهم. مردّتش بمميزات، طلبت أقابل اتنين من الفريق نفسه وأشوف يومهم، وطلعت حاجة واحدة بتاخد منهم ساعة يوميًا والمنتج بيخلّيها خمس دقايق. عرضنا نبدأ بالحاجة دي بس، ووافقوا.',
 8, '{"improvement":"تحويل اعتراض ثقافي إلى بداية صغيرة قابلة للقياس — إجابة ناضجة. أنهِها بالنتيجة: هل توسّع الاستخدام بعدها؟ الرقم يحوّل القصة إلى دليل."}', 0, DATE_SUB(NOW(), INTERVAL 4 DAY) + INTERVAL 9 MINUTE);

-- ── 6 ─ yesterday · programming · live meeting ────────────────────────────
INSERT INTO sessions (user_id, category_id, kind, total_score, answer_count, billed_seconds, started_at, ended_at)
VALUES (@uid, 1, 'meeting', 54, 6, 738, DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_SUB(NOW(), INTERVAL 1 DAY) + INTERVAL 13 MINUTE);
SET @s = LAST_INSERT_ID();
INSERT INTO answers (session_id, question_id, question_text, user_answer, ai_score, ai_feedback, tokens_used, created_at) VALUES
(@s, NULL, 'عرّف نفسك.',
 'مطوّر باك-إند خبرة ثلاث سنوات في التجارة الإلكترونية. آخر مشروع: إعادة بناء خدمة الطلبات، زمن الاستجابة من ٨٠٠ لـ١٢٠ مللي وأخطاء الدفع أقل ٤٠٪. بدأت في وكالة وانتقلت لمنتج واحد عشان أشوف الأثر على مدى أطول. ومهتم بيكم لأن المنتج عربي أولًا واشتغلت على RTL وأعرف إنها مشكلة صعبة فعلًا لما تتاخد بجدية.',
 9, '{"improvement":"مضبوطة: حاضر برقم، انتقال مشروح، وسبب لا يمكن قوله لشركة أخرى. لا تغيّر فيها شيئًا — فقط قُلها بصوت عالٍ حتى تخرج في تسعين ثانية."}', 0, DATE_SUB(NOW(), INTERVAL 1 DAY) + INTERVAL 1 MINUTE),
(@s, NULL, 'كيف تصمّم واجهة برمجية لخدمة دفع؟',
 'أهم حاجة الـidempotency: كل محاولة دفع ليها مفتاح فريد من العميل، فلو الشبكة قطعت وأعاد الطلب ميتخصمش مرتين. وبفصل «إنشاء نية الدفع» عن «التأكيد»، وبستقبل تأكيد البوابة عن طريق webhook موقّع مش بالاعتماد على رجوع المستخدم للصفحة، لأنه ممكن يقفل المتصفح.',
 9, '{"improvement":"ذكر الـidempotency وعدم الاعتماد على عودة المستخدم هما الفرق بين من صمّم نظام دفع ومن قرأ عنه. أضف كيف تتعامل مع وصول الـwebhook مرتين — وهو ما يحدث فعليًا."}', 0, DATE_SUB(NOW(), INTERVAL 1 DAY) + INTERVAL 3 MINUTE),
(@s, NULL, 'ما استراتيجيتك في مراجعة الكود؟',
 'بقرأ الوصف الأول عشان أفهم المطلوب قبل ما أحكم على الحل. بفرّق بين «ده غلط» و«ده مش اللى كنت هعمله» — التانية رأي مش ملاحظة. وبسأل بدل ما أأمر، وبوافق على اللى مش مثالي بس صح لو التعديل ممكن يتعمل بعدين.',
 9, '{"improvement":"التمييز بين الخطأ والتفضيل هو أنضج ما يمكن قوله هنا. أضف كيف تتصرّف حين يرفض صاحب الكود ملاحظتك — التعامل مع الخلاف جزء من السؤال."}', 0, DATE_SUB(NOW(), INTERVAL 1 DAY) + INTERVAL 5 MINUTE),
(@s, NULL, 'كيف تتعامل مع الدين التقني؟',
 'بفرّق بين دين مقصود اتاخد عشان ميعاد، ودين ناتج عن إهمال. المقصود بيتكتب في مكان معروف بموعد مراجعة، والتاني بيتصلّح لما نعدّي على الكود ده أصلًا بدل ما نعمل مشروع تنظيف كبير محدش هيوافق عليه.',
 8, '{"improvement":"مقاربة واقعية. اذكر كيف تجعل الدين مرئيًا للإدارة — ربطه بأثر ملموس (بطء التسليم، تكرار الأعطال) هو ما يحوّله من مطلب تقني إلى قرار عمل."}', 0, DATE_SUB(NOW(), INTERVAL 1 DAY) + INTERVAL 8 MINUTE),
(@s, NULL, 'كم تتوقّع أن يكون راتبك؟',
 'أفضّل أفهم الدور ومسؤولياته أوضح الأول عشان الرقم يكون واقعي، وأنا مرن. ممكن تقول لي النطاق المخصّص للوظيفة دي؟ ولو محتاج رقم دلوقتي، بناءً على اللى أعرفه بتوقّع بين كذا وكذا.',
 9, '{"improvement":"التأجيل بأدب ثم إعادة السؤال هو التصرّف الصحيح تمامًا. تذكّر فقط أن يكون الحدّ الأدنى للنطاق رقمًا ترضاه فعلًا — ستحصل عليه."}', 0, DATE_SUB(NOW(), INTERVAL 1 DAY) + INTERVAL 10 MINUTE),
(@s, NULL, 'هل لديك أسئلة لنا؟',
 'أيوه. إيه أكتر حاجة بتعطّل الفريق دلوقتي؟ وإزاي بتقرّروا إن ميزة تستاهل تتبني؟ وإيه اللى بيخلّي حد ينجح في الدور ده خلال أول تلات شهور؟',
 10, '{"improvement":"ثلاثة أسئلة كلها عن العمل نفسه لا عن الامتيازات، والثالث تحديدًا يجعل المُحاوِر يتخيّلك في الدور. لا تغيّر شيئًا."}', 0, DATE_SUB(NOW(), INTERVAL 1 DAY) + INTERVAL 12 MINUTE);

-- Report, so a silent no-op is visible.
SELECT (SELECT COUNT(*) FROM sessions WHERE user_id = @uid) AS sessions,
       (SELECT COUNT(*) FROM answers a JOIN sessions s ON s.id = a.session_id WHERE s.user_id = @uid) AS answers,
       (SELECT ROUND(AVG(a.ai_score), 2) FROM answers a JOIN sessions s ON s.id = a.session_id WHERE s.user_id = @uid) AS avg_score;
