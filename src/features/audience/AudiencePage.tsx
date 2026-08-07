import { Users } from 'lucide-react';
import { Card, EmptyState } from '@/ui';
import { useLanguage } from '@/providers/LanguageProvider';

export function AudiencePage() {
  const { t } = useLanguage();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('audience.title')}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {t('audience.subtitle')}
        </p>
      </div>
      <Card>
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title={t('audience.empty.title')}
          description={t('audience.empty.description')}
        />
      </Card>
    </div>
  );
}
