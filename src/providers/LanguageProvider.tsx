import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_LANGUAGE, LANGUAGES, translations, type LanguageCode } from '@/i18n/translations';

type LanguageContextValue = {
  language: LanguageCode;
  dir: 'rtl' | 'ltr';
  setLanguage: (lang: LanguageCode) => void;
  t: (key: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

const STORAGE_KEY = 'language';

function getInitialLanguage(): LanguageCode {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  const stored = localStorage.getItem(STORAGE_KEY) as LanguageCode | null;
  if (stored && LANGUAGES.some((l) => l.code === stored)) return stored;
  return DEFAULT_LANGUAGE;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(getInitialLanguage);

  const dir = LANGUAGES.find((l) => l.code === language)?.dir ?? 'ltr';

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = dir;
  }, [language, dir]);

  const setLanguage = (lang: LanguageCode) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  };

  const t = (key: string): string => {
    return translations[language]?.[key] ?? translations[DEFAULT_LANGUAGE]?.[key] ?? key;
  };

  return (
    <LanguageContext.Provider value={{ language, dir, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
}
