import { useEffect, useState } from 'react';
import { Settings, Brain, Link2, LogOut, Shield, TrendingUp, ChevronLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { Card, Button, Badge } from '@/components/ui';
import { PLATFORMS, PLATFORM_META } from '@/lib/constants';
import type { SocialAccount, SocialPlatform, BrandDna } from '@/lib/types';

export function MoreScreen() {
  const { workspace, signOut } = useAuth();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [brandDna, setBrandDna] = useState<BrandDna | null>(null);
  const [showAccounts, setShowAccounts] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    (async () => {
      const [accs, dna] = await Promise.all([
        supabase.from('social_accounts').select('*').eq('workspace_id', workspace.id),
        supabase.from('brand_dna').select('*').eq('workspace_id', workspace.id).maybeSingle(),
      ]);
      setAccounts((accs.data as SocialAccount[]) ?? []);
      setBrandDna(dna.data as BrandDna | null);
    })();
  }, [workspace]);

  async function togglePlatform(platform: SocialPlatform) {
    if (!workspace) return;
    const existing = accounts.find((a) => a.platform === platform);
    if (existing) {
      await supabase.from('social_accounts').delete().eq('id', existing.id);
      setAccounts(accounts.filter((a) => a.id !== existing.id));
    } else {
      const { data } = await supabase
        .from('social_accounts')
        .insert({
          workspace_id: workspace.id,
          platform,
          status: 'disconnected',
          display_name: PLATFORM_META[platform].label,
        })
        .select()
        .single();
      if (data) setAccounts([...accounts, data as SocialAccount]);
    }
  }

  return (
    <div className="px-5 py-6 safe-top">
      <h1 className="text-lg font-bold text-ink-50 mb-6">المزيد</h1>

      {/* Brand Brain status */}
      <div className="mb-4">
        <p className="text-ink-500 text-xs mb-2">عقل البراند</p>
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-500/15 flex items-center justify-center">
                <Brain size={20} className="text-brand-400" />
              </div>
              <div>
                <p className="text-ink-100 text-sm font-medium">Brand DNA</p>
                <p className="text-ink-500 text-xs mt-0.5">
                  {brandDna?.status === 'confirmed' ? 'مؤكدة وجاهزة' : 'تحتاج إكمال'}
                </p>
              </div>
            </div>
            <Badge color={brandDna?.status === 'confirmed' ? 'brand' : 'warning'}>
              {brandDna?.status === 'confirmed' ? 'نشط' : 'مسودة'}
            </Badge>
          </div>
        </Card>
      </div>

      {/* Social Accounts */}
      <div className="mb-4">
        <button
          onClick={() => setShowAccounts(!showAccounts)}
          className="w-full"
        >
          <Card onClick={() => setShowAccounts(!showAccounts)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-accent-500/15 flex items-center justify-center">
                  <Link2 size={20} className="text-accent-400" />
                </div>
                <div>
                  <p className="text-ink-100 text-sm font-medium">الحسابات</p>
                  <p className="text-ink-500 text-xs mt-0.5">
                    {accounts.filter((a) => a.status === 'connected').length} مربوط
                  </p>
                </div>
              </div>
              <ChevronLeft
                size={18}
                className={`text-ink-500 transition-transform ${showAccounts ? '-rotate-90' : ''}`}
              />
            </div>
          </Card>
        </button>

        {showAccounts && (
          <div className="mt-2 flex flex-col gap-2 animate-slide-up">
            {PLATFORMS.map((platform) => {
              const meta = PLATFORM_META[platform];
              const Icon = meta.icon;
              const acc = accounts.find((a) => a.platform === platform);
              return (
                <Card key={platform}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Icon size={20} style={{ color: meta.color }} />
                      <span className="text-ink-200 text-sm">{meta.label}</span>
                      {acc && (
                        <Badge color={acc.status === 'connected' ? 'brand' : 'neutral'}>
                          {acc.status === 'connected' ? 'مربوط' : 'غير مربوط'}
                        </Badge>
                      )}
                    </div>
                    <Button
                      variant={acc ? 'danger' : 'secondary'}
                      size="sm"
                      onClick={() => togglePlatform(platform)}
                    >
                      {acc ? 'إزالة' : 'ربط'}
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* System info */}
      <div className="mb-4">
        <p className="text-ink-500 text-xs mb-2">النظام</p>
        <div className="flex flex-col gap-2">
          <Card>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-ink-800 flex items-center justify-center">
                <TrendingUp size={20} className="text-ink-400" />
              </div>
              <div>
                <p className="text-ink-100 text-sm font-medium">AI Usage</p>
                <p className="text-ink-500 text-xs mt-0.5">استهلاك وتكلفة الذكاء الاصطناعي</p>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-ink-800 flex items-center justify-center">
                <Shield size={20} className="text-ink-400" />
              </div>
              <div>
                <p className="text-ink-100 text-sm font-medium">Super Admin</p>
                <p className="text-ink-500 text-xs mt-0.5">إدارة النظام (للمشرفين)</p>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-ink-800 flex items-center justify-center">
                <Settings size={20} className="text-ink-400" />
              </div>
              <div>
                <p className="text-ink-100 text-sm font-medium">الإعدادات</p>
                <p className="text-ink-500 text-xs mt-0.5">إعدادات المساحة</p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Button variant="ghost" size="lg" onClick={signOut} className="w-full text-danger-400">
        <span className="flex items-center justify-center gap-2">
          <LogOut size={18} /> تسجيل الخروج
        </span>
      </Button>
    </div>
  );
}
