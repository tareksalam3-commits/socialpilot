import { useEffect } from 'react';
import { useLanguage } from '@/providers/LanguageProvider';
import { LegalLayout } from '@/layouts/LegalLayout';
import { legalContent } from './legalContent';

export function TermsOfServicePage() {
  const { language } = useLanguage();
  const doc = legalContent[language].terms;

  useEffect(() => {
    document.title = `${doc.title} · SocialPilot AI`;
  }, [doc.title]);

  return (
    <LegalLayout>
      <article className="prose-legal">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{doc.title}</h1>
        <p className="mt-2 text-sm text-slate-400 dark:text-slate-500">{doc.lastUpdated}</p>

        <div className="mt-6 space-y-3 text-slate-600 dark:text-slate-300">
          {doc.intro.map((p, i) => (
            <p key={i} className="leading-relaxed">
              {p}
            </p>
          ))}
        </div>

        <div className="mt-8 space-y-8">
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{section.heading}</h2>
              <div className="mt-2 space-y-3 text-slate-600 dark:text-slate-300">
                {section.paragraphs.map((p, i) => (
                  <p key={i} className="leading-relaxed">
                    {p}
                  </p>
                ))}
                {section.list && (
                  <ul className="list-disc space-y-1.5 ps-5 marker:text-slate-400">
                    {section.list.map((item, i) => (
                      <li key={i} className="leading-relaxed">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {doc.contactLabel}{' '}
            <a href={`mailto:${doc.contactEmail}`} className="font-medium text-slate-900 underline dark:text-white">
              {doc.contactEmail}
            </a>
          </p>
        </div>
      </article>
    </LegalLayout>
  );
}
