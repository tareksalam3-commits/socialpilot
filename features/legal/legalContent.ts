import type { LanguageCode } from '@/i18n/translations';

export type LegalSection = {
  heading: string;
  paragraphs: string[];
  list?: string[];
};

export type LegalDoc = {
  title: string;
  lastUpdated: string;
  intro: string[];
  sections: LegalSection[];
  contactEmail: string;
  contactLabel: string;
};

// NOTE: `contactEmail` is a placeholder. Replace it with a real, monitored
// mailbox before going live — TikTok and other platform reviewers may send
// verification or data-deletion requests to it.
const CONTACT_EMAIL = 'privacy@socialpilot.ai';
const SUPPORT_EMAIL = 'support@socialpilot.ai';
const LAST_UPDATED_AR = '8 أغسطس 2026';
const LAST_UPDATED_EN = 'August 8, 2026';

export const legalContent: Record<LanguageCode, { terms: LegalDoc; privacy: LegalDoc }> = {
  ar: {
    terms: {
      title: 'شروط الخدمة',
      lastUpdated: `آخر تحديث: ${LAST_UPDATED_AR}`,
      intro: [
        'مرحبًا بك في SocialPilot AI ("SocialPilot"، "نحن"، "لنا"). توضح هذه الشروط والأحكام ("الشروط") القواعد التي تحكم استخدامك لتطبيقنا وموقعنا الإلكتروني والخدمات المرتبطة بهما (يُشار إليها مجتمعة بـ "الخدمة").',
        'باستخدامك للخدمة أو إنشائك لحساب لديك، فإنك تقر بأنك قرأت هذه الشروط وفهمتها ووافقت على الالتزام بها. إذا كنت لا توافق على أي جزء من هذه الشروط، يرجى عدم استخدام الخدمة.',
      ],
      sections: [
        {
          heading: '1. وصف الخدمة',
          paragraphs: [
            'تتيح SocialPilot للمستخدمين ربط حسابات التواصل الاجتماعي الخاصة بهم عبر واجهات البرمجة (APIs) الرسمية المعتمدة من كل منصة، وإنشاء محتوى بمساعدة أدوات الذكاء الاصطناعي، وجدولة المنشورات ونشرها، ومتابعة الأداء والتفاعل من خلال لوحة تحكم موحّدة.',
            'تشمل المنصات المدعومة حاليًا، على سبيل المثال لا الحصر: Meta (فيسبوك وإنستغرام)، LinkedIn، X، Threads، وTikTok، ويتم ربط كل منصة حصريًا عبر بروتوكول OAuth الرسمي الخاص بها.',
          ],
        },
        {
          heading: '2. إنشاء الحساب والمسؤولية عنه',
          paragraphs: [
            'يجب أن يكون عمرك 18 عامًا على الأقل، أو السن القانونية لإبرام العقود في بلدك، لإنشاء حساب واستخدام الخدمة.',
            'أنت مسؤول عن الحفاظ على سرية بيانات الدخول إلى حسابك، وعن جميع الأنشطة التي تتم من خلاله. يرجى إبلاغنا فورًا عبر البريد الإلكتروني أدناه في حال الاشتباه بأي استخدام غير مصرح به لحسابك.',
          ],
        },
        {
          heading: '3. ربط حسابات التواصل الاجتماعي عبر واجهات البرمجة الرسمية',
          paragraphs: [
            'عند ربط أي حساب تواصل اجتماعي (بما في ذلك TikTok) بـ SocialPilot، فإنك تمنحنا إذنًا محدودًا للوصول إلى ذلك الحساب فقط ضمن الصلاحيات (Scopes) التي توافق عليها صراحةً أثناء عملية الربط عبر OAuth، وذلك بهدف تنفيذ الوظائف التي تطلبها بنفسك مثل النشر أو الجدولة أو عرض بيانات الأداء.',
            'استخدامك لأي منصة مرتبطة يظل خاضعًا أيضًا لشروط الاستخدام وسياسات المطورين الخاصة بتلك المنصة (مثل شروط مطوري TikTok وسياسة منصة TikTok)، وأنت مسؤول عن الالتزام بها.',
            'يمكنك إلغاء ربط أي حساب في أي وقت من صفحة "الحسابات المتصلة" داخل التطبيق، أو مباشرة من إعدادات التطبيقات الخارجية في حساب المنصة نفسها. عند إلغاء الربط، نتوقف فورًا عن الوصول إلى ذلك الحساب ونحذف رموز الدخول (Access Tokens) المرتبطة به.',
          ],
        },
        {
          heading: '4. المحتوى المُنشأ بالذكاء الاصطناعي ومسؤولية المستخدم',
          paragraphs: [
            'توفر SocialPilot أدوات ذكاء اصطناعي للمساعدة في صياغة واقتراح محتوى نصي وبصري. أنت وحدك المسؤول عن مراجعة أي محتوى يُنشأ بمساعدة الذكاء الاصطناعي قبل نشره، والتأكد من دقته وملاءمته وامتثاله للقوانين المعمول بها ولسياسات كل منصة تنشر عليها.',
            'يُحظر استخدام أدوات الذكاء الاصطناعي في الخدمة لإنشاء محتوى مضلل أو منتحل الهوية أو منتهك لحقوق الملكية الفكرية لطرف ثالث، أو محتوى يخالف إرشادات مجتمع أي منصة (بما في ذلك إرشادات مجتمع TikTok).',
          ],
        },
        {
          heading: '5. الاستخدامات المحظورة',
          paragraphs: ['يُحظر عليك استخدام الخدمة في أي مما يلي:'],
          list: [
            'انتهاك أي قانون أو لائحة معمول بها، أو حقوق أي طرف ثالث.',
            'نشر محتوى يحض على الكراهية أو العنف أو التحرش أو الإباحية أو الاحتيال.',
            'محاولة الوصول غير المصرح به إلى أنظمتنا أو أنظمة أي منصة تواصل اجتماعي متصلة، أو تجاوز حدود معدل الاستخدام (Rate Limits) الخاصة بواجهات برمجتها.',
            'إساءة استخدام واجهات برمجة التطبيقات (APIs) لأي منصة بما يخالف شروط مطوّريها، بما في ذلك جمع بيانات لا صلاحية للوصول إليها أو تخزينها بشكل يخالف تلك الشروط.',
            'انتحال شخصية أي فرد أو جهة، أو تشغيل حسابات وهمية أو آلية (bots) بشكل مخادع.',
          ],
        },
        {
          heading: '6. الاشتراكات والدفع',
          paragraphs: [
            'قد تتطلب بعض ميزات الخدمة اشتراكًا مدفوعًا. يتم عرض تفاصيل الأسعار والباقات داخل التطبيق، وتُحصَّل الرسوم عبر مزود دفع خارجي آمن. يمكنك إلغاء اشتراكك في أي وقت من إعدادات الفوترة داخل حسابك.',
          ],
        },
        {
          heading: '7. الإنهاء وتعليق الحساب',
          paragraphs: [
            'يمكنك إغلاق حسابك في أي وقت من صفحة الإعدادات. نحتفظ بالحق في تعليق أو إنهاء وصولك إلى الخدمة في حال مخالفة هذه الشروط، أو عند طلب ذلك من إحدى المنصات المتصلة نتيجة انتهاك سياساتها.',
          ],
        },
        {
          heading: '8. إخلاء المسؤولية وحدود المسؤولية',
          paragraphs: [
            'تُقدَّم الخدمة "كما هي" دون أي ضمانات صريحة أو ضمنية. لا نضمن استمرارية إتاحة أي واجهة برمجة تطبيقات (API) تابعة لطرف ثالث، ولسنا مسؤولين عن أي تغييرات أو انقطاعات تطرأ عليها من جانب تلك المنصات.',
            'في أقصى الحدود التي يسمح بها القانون، لا تتحمل SocialPilot مسؤولية أي أضرار غير مباشرة أو عرضية أو تبعية ناتجة عن استخدامك للخدمة.',
          ],
        },
        {
          heading: '9. التعديلات على الشروط',
          paragraphs: [
            'قد نقوم بتحديث هذه الشروط من وقت لآخر. سنقوم بإخطارك بأي تغييرات جوهرية عبر التطبيق أو البريد الإلكتروني، ويُعد استمرارك في استخدام الخدمة بعد سريان التعديلات موافقة عليها.',
          ],
        },
        {
          heading: '10. القانون الواجب التطبيق',
          paragraphs: [
            'تخضع هذه الشروط وتُفسَّر وفقًا للقوانين المعمول بها، دون الإخلال بأي حقوق إلزامية قد يتمتع بها المستخدم بموجب قوانين بلد إقامته.',
          ],
        },
      ],
      contactEmail: SUPPORT_EMAIL,
      contactLabel: 'لأي استفسار بخصوص هذه الشروط، يمكنك التواصل معنا عبر:',
    },
    privacy: {
      title: 'سياسة الخصوصية',
      lastUpdated: `آخر تحديث: ${LAST_UPDATED_AR}`,
      intro: [
        'تشرح سياسة الخصوصية هذه كيفية جمع SocialPilot AI ("نحن") لبياناتك واستخدامها ومشاركتها وحمايتها عند استخدامك لتطبيقنا وموقعنا الإلكتروني ("الخدمة")، بما في ذلك عند ربط حسابات التواصل الاجتماعي مثل TikTok عبر واجهات البرمجة الرسمية.',
        'باستخدامك للخدمة فإنك توافق على جمع بياناتك واستخدامها على النحو الموضح في هذه السياسة.',
      ],
      sections: [
        {
          heading: '1. البيانات التي نجمعها',
          paragraphs: ['نجمع الفئات التالية من البيانات فقط بالقدر اللازم لتشغيل الخدمة:'],
          list: [
            'بيانات الحساب: الاسم، البريد الإلكتروني، كلمة المرور المشفّرة، واسم مساحة العمل.',
            'بيانات حسابات التواصل الاجتماعي المرتبطة: عند ربط حساب (مثل TikTok) عبر OAuth، نستقبل رمز دخول (Access Token) ومعلومات الملف العام الأساسية (مثل اسم المستخدم والصورة الرمزية وعدد المتابعين) ومقاييس الأداء العامة للمنشورات التي تُنشر عبر SocialPilot، وذلك حصرًا ضمن الصلاحيات (Scopes) التي وافقت عليها.',
            'المحتوى: النصوص والصور والفيديوهات التي ترفعها أو تُنشئها عبر أدوات الذكاء الاصطناعي، ومواعيد الجدولة، والتعليقات والرسائل التي تديرها عبر صندوق الوارد الموحّد.',
            'بيانات الاستخدام الفنية: عنوان IP، نوع الجهاز والمتصفح، وسجلات الأخطاء والأداء، لأغراض تشغيل الخدمة وتحسينها وحمايتها من إساءة الاستخدام.',
            'بيانات الفوترة: تتم معالجتها بواسطة مزود دفع خارجي معتمد؛ ولا تُخزَّن بيانات بطاقتك الائتمانية الكاملة على خوادمنا.',
          ],
        },
        {
          heading: '2. كيف نستخدم بياناتك',
          paragraphs: ['نستخدم البيانات المذكورة أعلاه للأغراض التالية فقط:'],
          list: [
            'تقديم وظائف الخدمة الأساسية: نشر المحتوى وجدولته وعرض التحليلات نيابةً عنك وبناءً على تعليماتك المباشرة.',
            'تشغيل أدوات الذكاء الاصطناعي لإنشاء واقتراح المحتوى بناءً على طلباتك.',
            'الحفاظ على أمان الحساب واكتشاف الاحتيال أو إساءة الاستخدام.',
            'التواصل معك بشأن الحساب أو التحديثات الجوهرية أو الدعم الفني.',
            'تحسين أداء الخدمة من خلال تحليلات استخدام مجمّعة وغير محدِّدة للهوية قدر الإمكان.',
          ],
        },
        {
          heading: '3. بيانات ومنصة TikTok على وجه التحديد',
          paragraphs: [
            'نستخدم واجهات TikTok الرسمية (مثل Login Kit وContent Posting API) حصريًا، ولا نلجأ إلى أي وسيلة غير رسمية للوصول إلى حسابك على TikTok.',
            'نطلب فقط الصلاحيات (Scopes) اللازمة لتنفيذ الميزات التي تستخدمها فعليًا، مثل تسجيل الدخول والنشر المجدول وعرض إحصاءات الفيديوهات المنشورة عبر SocialPilot.',
            'لا نستخدم بيانات TikTok الخاصة بك لأغراض إعلانية، ولا نبيعها أو نشاركها مع أطراف ثالثة لأغراض تسويقية، ولا نستخدمها لتدريب نماذج ذكاء اصطناعي عامة خارج نطاق تقديم الخدمة لك.',
            'عند إلغاء ربط حساب TikTok من داخل التطبيق، أو عند إلغاء إذن الوصول من إعدادات TikTok نفسها، نقوم بحذف رمز الدخول (Access Token) فورًا، وحذف أي بيانات ملف تعريف أو محتوى مخزّنة مرتبطة بذلك الربط خلال 30 يومًا كحد أقصى، ما لم يقتضِ القانون الاحتفاظ بها لمدة أطول.',
          ],
        },
        {
          heading: '4. مشاركة البيانات مع أطراف ثالثة',
          paragraphs: ['لا نبيع بياناتك الشخصية. نشارك بيانات محدودة فقط مع:'],
          list: [
            'منصات التواصل الاجتماعي التي تربطها بنفسك (مثل Meta وLinkedIn وX وThreads وTikTok)، وذلك فقط لتنفيذ الإجراءات التي تطلبها (كنشر منشور أو جلب إحصاءات).',
            'مزودي البنية التحتية والاستضافة وقواعد البيانات (مثل Supabase) الذين يعالجون البيانات نيابة عنا بموجب اتفاقيات حماية بيانات.',
            'مزودي خدمات الذكاء الاصطناعي المستخدمين لتوليد المحتوى بناءً على طلبك المباشر.',
            'الجهات المختصة عند الضرورة القانونية، أو لحماية حقوقنا وسلامة مستخدمينا.',
          ],
        },
        {
          heading: '5. أمان البيانات',
          paragraphs: [
            'نطبّق ضوابط وصول صارمة على مستوى قاعدة البيانات (Row-Level Security)، وتشفيرًا أثناء النقل والتخزين، ونقيّد الوصول إلى رموز الدخول (Access Tokens) الخاصة بحساباتك على المنصات المرتبطة للأنظمة التي تحتاجها فقط لتنفيذ طلباتك.',
          ],
        },
        {
          heading: '6. الاحتفاظ بالبيانات وحذفها',
          paragraphs: [
            'نحتفظ ببياناتك طوال فترة نشاط حسابك. عند حذف حسابك، أو عند إلغاء ربط منصة معينة، نحذف البيانات المرتبطة أو نجعلها مجهولة الهوية خلال مدة أقصاها 30 يومًا، باستثناء ما يلزم الاحتفاظ به للامتثال لالتزامات قانونية أو محاسبية.',
            'يمكنك طلب حذف حسابك وجميع بياناتك في أي وقت من صفحة الإعدادات داخل التطبيق، أو بمراسلتنا مباشرة على البريد الإلكتروني أدناه.',
          ],
        },
        {
          heading: '7. حقوقك',
          paragraphs: ['بحسب القوانين المعمول بها في بلدك، يحق لك:'],
          list: [
            'الوصول إلى بياناتك الشخصية التي نحتفظ بها، أو طلب نسخة منها.',
            'تصحيح أي بيانات غير دقيقة.',
            'طلب حذف بياناتك أو تقييد معالجتها.',
            'سحب موافقتك على ربط أي حساب تواصل اجتماعي في أي وقت.',
            'تقديم شكوى إلى الجهة الرقابية المختصة بحماية البيانات في بلدك.',
          ],
        },
        {
          heading: '8. خصوصية الأطفال',
          paragraphs: [
            'لا تستهدف الخدمة الأشخاص دون سن 18 عامًا، ولا نجمع عن قصد بيانات من قاصرين. إذا علمنا بجمع بيانات من قاصر دون موافقة ولي الأمر، سنعمل على حذفها فورًا.',
          ],
        },
        {
          heading: '9. ملفات تعريف الارتباط (Cookies)',
          paragraphs: [
            'نستخدم ملفات تعريف ارتباط أساسية للحفاظ على جلسة تسجيل الدخول وتفضيلات اللغة، وملفات تعريف ارتباط تحليلية اختيارية لفهم كيفية استخدام الخدمة وتحسينها.',
          ],
        },
        {
          heading: '10. التغييرات على هذه السياسة',
          paragraphs: [
            'قد نحدّث هذه السياسة من وقت لآخر لتعكس تغييرات في ممارساتنا أو لأسباب قانونية أو تشغيلية. سيتم نشر أي تحديث جوهري على هذه الصفحة مع تحديث تاريخ "آخر تحديث" أعلاه.',
          ],
        },
      ],
      contactEmail: CONTACT_EMAIL,
      contactLabel: 'لأي استفسار بخصوص الخصوصية أو لممارسة حقوقك في بياناتك، تواصل معنا عبر:',
    },
  },
  en: {
    terms: {
      title: 'Terms of Service',
      lastUpdated: `Last updated: ${LAST_UPDATED_EN}`,
      intro: [
        'Welcome to SocialPilot AI ("SocialPilot", "we", "us"). These Terms of Service ("Terms") govern your use of our application, website, and related services (together, the "Service").',
        'By creating an account or using the Service, you confirm that you have read, understood, and agree to be bound by these Terms. If you do not agree, please do not use the Service.',
      ],
      sections: [
        {
          heading: '1. Description of the Service',
          paragraphs: [
            'SocialPilot lets users connect their social media accounts through each platform\u2019s official, approved API, generate content with AI assistance, schedule and publish posts, and track performance from a unified dashboard.',
            'Currently supported platforms include, without limitation, Meta (Facebook and Instagram), LinkedIn, X, Threads, and TikTok. Every connection is made exclusively through that platform\u2019s official OAuth flow.',
          ],
        },
        {
          heading: '2. Accounts and Responsibility',
          paragraphs: [
            'You must be at least 18 years old, or the age of legal majority in your jurisdiction, to create an account and use the Service.',
            'You are responsible for keeping your login credentials confidential and for all activity under your account. Contact us immediately at the email below if you suspect unauthorized use of your account.',
          ],
        },
        {
          heading: '3. Connecting Social Accounts via Official APIs',
          paragraphs: [
            'When you connect a social media account (including TikTok) to SocialPilot, you grant us limited access to that account, restricted to the scopes you explicitly approve during the OAuth authorization flow, solely to perform the actions you request, such as publishing, scheduling, or viewing performance data.',
            'Your use of any connected platform remains subject to that platform\u2019s own terms and developer policies (for example, TikTok\u2019s Developer Terms of Service and Platform Policy), and you are responsible for complying with them.',
            'You may disconnect any account at any time from the "Connected Accounts" page in the app, or directly from that platform\u2019s third-party app settings. Upon disconnection, we immediately stop accessing that account and delete the associated access tokens.',
          ],
        },
        {
          heading: '4. AI-Generated Content and Your Responsibility',
          paragraphs: [
            'SocialPilot provides AI tools to help draft and suggest text and visual content. You are solely responsible for reviewing any AI-assisted content before publishing it, and for ensuring it is accurate, appropriate, and compliant with applicable law and each destination platform\u2019s policies.',
            'You may not use the Service\u2019s AI tools to create misleading, impersonating, or infringing content, or content that violates any platform\u2019s community guidelines (including TikTok\u2019s Community Guidelines).',
          ],
        },
        {
          heading: '5. Prohibited Uses',
          paragraphs: ['You may not use the Service to:'],
          list: [
            'Violate any applicable law, regulation, or third-party right.',
            'Post hateful, violent, harassing, sexually explicit, or fraudulent content.',
            'Attempt unauthorized access to our systems or any connected platform\u2019s systems, or exceed their API rate limits.',
            'Misuse any platform\u2019s API in violation of its developer terms, including collecting or storing data beyond what you are authorized to access.',
            'Impersonate any person or entity, or deceptively operate fake or automated (bot) accounts.',
          ],
        },
        {
          heading: '6. Subscriptions and Payment',
          paragraphs: [
            'Some features require a paid subscription. Pricing and plan details are shown in the app, and payments are processed by a secure third-party payment provider. You may cancel your subscription at any time from your account billing settings.',
          ],
        },
        {
          heading: '7. Termination',
          paragraphs: [
            'You may close your account at any time from the Settings page. We may suspend or terminate your access to the Service if you violate these Terms, or if a connected platform requires us to do so due to a violation of its own policies.',
          ],
        },
        {
          heading: '8. Disclaimers and Limitation of Liability',
          paragraphs: [
            'The Service is provided "as is" without warranties of any kind, express or implied. We do not guarantee the continued availability of any third-party API, and we are not responsible for changes or outages caused by those platforms.',
            'To the maximum extent permitted by law, SocialPilot is not liable for any indirect, incidental, or consequential damages arising from your use of the Service.',
          ],
        },
        {
          heading: '9. Changes to These Terms',
          paragraphs: [
            'We may update these Terms from time to time. We will notify you of material changes through the app or by email. Continued use of the Service after changes take effect constitutes acceptance of the updated Terms.',
          ],
        },
        {
          heading: '10. Governing Law',
          paragraphs: [
            'These Terms are governed by applicable law, without prejudice to any mandatory rights you may have under the laws of your country of residence.',
          ],
        },
      ],
      contactEmail: SUPPORT_EMAIL,
      contactLabel: 'For any question about these Terms, contact us at:',
    },
    privacy: {
      title: 'Privacy Policy',
      lastUpdated: `Last updated: ${LAST_UPDATED_EN}`,
      intro: [
        'This Privacy Policy explains how SocialPilot AI ("we") collects, uses, shares, and protects your data when you use our app and website (the "Service"), including when you connect social accounts such as TikTok through official APIs.',
        'By using the Service, you agree to the collection and use of your data as described in this policy.',
      ],
      sections: [
        {
          heading: '1. Data We Collect',
          paragraphs: ['We collect only the following categories of data, to the extent needed to operate the Service:'],
          list: [
            'Account data: name, email address, encrypted password, and workspace name.',
            'Connected social account data: when you link an account (such as TikTok) via OAuth, we receive an access token and basic public profile information (such as username, avatar, and follower count) and public performance metrics for posts published through SocialPilot, strictly within the scopes you approved.',
            'Content: text, images, and videos you upload or generate with our AI tools, scheduling data, and comments/messages you manage through the unified inbox.',
            'Technical usage data: IP address, device and browser type, and error/performance logs, used to operate, improve, and secure the Service.',
            'Billing data: processed by a certified third-party payment provider; we do not store your full card number on our servers.',
          ],
        },
        {
          heading: '2. How We Use Your Data',
          paragraphs: ['We use the data above only for the following purposes:'],
          list: [
            'Providing core Service functionality: publishing, scheduling, and displaying analytics on your behalf, based on your direct instructions.',
            'Powering AI tools to generate and suggest content based on your requests.',
            'Maintaining account security and detecting fraud or abuse.',
            'Communicating with you about your account, material updates, or support.',
            'Improving Service performance through aggregated, de-identified usage analytics where possible.',
          ],
        },
        {
          heading: '3. TikTok Data Specifically',
          paragraphs: [
            'We use TikTok\u2019s official APIs exclusively (such as Login Kit and the Content Posting API), and never access your TikTok account through unofficial means.',
            'We request only the scopes required for the features you actually use, such as login, scheduled publishing, and viewing metrics for videos posted through SocialPilot.',
            'We do not use your TikTok data for advertising, do not sell it or share it with third parties for marketing purposes, and do not use it to train general-purpose AI models beyond providing the Service to you.',
            'When you disconnect TikTok from within the app, or revoke access from TikTok\u2019s own settings, we immediately delete the access token, and delete any associated profile or content data within 30 days at most, unless a longer retention period is required by law.',
          ],
        },
        {
          heading: '4. Sharing Your Data',
          paragraphs: ['We do not sell your personal data. We share limited data only with:'],
          list: [
            'The social platforms you choose to connect (such as Meta, LinkedIn, X, Threads, and TikTok), only to carry out the actions you request (such as publishing a post or fetching metrics).',
            'Infrastructure, hosting, and database providers (such as Supabase) that process data on our behalf under data-protection agreements.',
            'AI providers used to generate content at your direct request.',
            'Authorities where legally required, or to protect our rights and our users\u2019 safety.',
          ],
        },
        {
          heading: '5. Data Security',
          paragraphs: [
            'We apply strict database-level access controls (Row-Level Security), encryption in transit and at rest, and restrict access to your connected platforms\u2019 access tokens to only the systems that need them to carry out your requests.',
          ],
        },
        {
          heading: '6. Data Retention and Deletion',
          paragraphs: [
            'We retain your data for as long as your account is active. When you delete your account, or disconnect a specific platform, we delete or anonymize the associated data within 30 days, except where retention is required for legal or accounting compliance.',
            'You may request deletion of your account and all associated data at any time from the Settings page, or by emailing us at the address below.',
          ],
        },
        {
          heading: '7. Your Rights',
          paragraphs: ['Depending on the laws of your jurisdiction, you have the right to:'],
          list: [
            'Access the personal data we hold about you, or request a copy of it.',
            'Correct inaccurate data.',
            'Request deletion of your data or restriction of its processing.',
            'Withdraw your consent to connect any social account at any time.',
            'Lodge a complaint with your local data protection authority.',
          ],
        },
        {
          heading: '8. Children\u2019s Privacy',
          paragraphs: [
            'The Service is not directed to individuals under 18. We do not knowingly collect data from minors. If we learn that we have collected data from a minor without parental consent, we will delete it promptly.',
          ],
        },
        {
          heading: '9. Cookies',
          paragraphs: [
            'We use essential cookies to maintain your login session and language preference, and optional analytics cookies to understand and improve how the Service is used.',
          ],
        },
        {
          heading: '10. Changes to This Policy',
          paragraphs: [
            'We may update this policy from time to time to reflect changes in our practices or for legal or operational reasons. Material updates will be posted on this page with a revised "Last updated" date above.',
          ],
        },
      ],
      contactEmail: CONTACT_EMAIL,
      contactLabel: 'For privacy questions or to exercise your data rights, contact us at:',
    },
  },
};
