import { Users } from 'lucide-react';
import { Card, EmptyState } from '@/ui';

export function AudiencePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Audience</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Insights about your followers across connected accounts.
        </p>
      </div>
      <Card>
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title="No audience data yet"
          description="Connect a social account to start tracking follower growth, demographics, and engagement. This feature arrives in a future phase."
        />
      </Card>
    </div>
  );
}
