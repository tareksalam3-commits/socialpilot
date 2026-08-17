import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BrainCircuit, Check, Database, Search, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorBanner, ScreenLoader, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { analyzeLeadQuery, createLeadSearch, getLeadSearchJob, getLeadStats, listLeadSources, listLeads, startLeadSearch } from '../services/leadHunterApi';
import type { Lead, LeadSearchAnalysis, LeadSearchJob, LeadSearchStats, LeadSource } from '../types';
import { LEAD_JOB_STAGE_LABELS } from '../types';
import { freshnessLabel } from '../utils/scoring';

export function LeadHunterScreen({ onBack }: { onBack: () => void }) {
  const { workspace } = useAuth();
  const [rawQuery, setRawQuery] = useState('');
  const [analysis, setAnalysis] = useState<LeadSearchAnalysis | null>(null);
  const [sources, setSources] = useState<LeadSource[]>([]);
  const [job, setJob] = useState<LeadSearchJob | null>(null);
  const [stats, setStats] = useState<LeadSearchStats | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace) return;
    listLeadSources(workspace.id).then(setSources).catch(() => setSources([]));
  }, [workspace]);

  useEffect(() => {
    if (!workspace || !job || !['queued', 'running'].includes(job.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await getLeadSearchJob(workspace.id, job.id);
        setJob(next);
        if (['completed', 'failed', 'cancelled'].includes(next.status)) {
          const [nextStats, nextLeads] = await Promise.all([
            getLeadStats(workspace.id, next.search_request_id),
            listLeads(workspace.id, next.search_request_id),
          ]);
          setStats(nextStats);
          setLeads(nextLeads);
        }
      } catch {
        // Keep the current progress visible; the next poll can recover.
      }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [workspace, job]);

  const enabledSources = sources.filter((source) => source.enabled && source.status !== 'disabled');
  const summary = useMemo(() => analysis?.summary ?? [], [analysis]);

  async function handleAnalyze() {
    if (!workspace || !rawQuery.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await analyzeLeadQuery(workspace.id, rawQuery.trim());
      setAnalysis(result.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحليل الطلب.');
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    if (!workspace || !analysis) return;
    setBusy(true);
    setError(null);
    try {
      const { requestId } = await createLeadSearch({ workspaceId: workspace.id, rawQuery, analysis });
      const nextJob = await startLeadSearch(workspace.id, requestId);
      setJob(nextJob);
      setStats(null);
      setLeads([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر بدء البحث.');
    } finally {
      setBusy(false);
    }
  }

  if (!workspace) return <ScreenLoader />;

  return (
    <div dir="rtl" className="min-h-screen bg-ink-950 px-5 py-5 safe-top pb-8">
      <header className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="w-10 h-10 rounded-xl bg-ink-900 border border-ink-800 text-ink-300 flex items-center justify-center" aria-label="العودة">
          <ArrowRight size={19} />
        </button>
        <div>
          <p className="text-brand-400 text-xs mb-1">Lead Hunter</p>
          <h1 className="text-xl font-bold text-ink-50">مركز العملاء</h1>
        </div>
      </header>

      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}

      {!analysis && !job && (
        <>
          <Card className="mb-4 border-brand-500/20">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-11 h-11 rounded-2xl bg-brand-500/15 flex items-center justify-center"><BrainCircuit className="text-brand-400" size={23} /></div>
              <div>
                <h2 className="text-ink-100 font-semibold">ابحث عن العميل الذي تريده</h2>
                <p className="text-ink-500 text-xs mt-1">اكتب مواصفات الأفراد بالعربية أو بالعربي والإنجليزية.</p>
              </div>
            </div>
            <textarea
              value={rawQuery}
              onChange={(event) => setRawQuery(event.target.value)}
              dir="rtl"
              rows={6}
              placeholder="مثال: عايز 500 شخص في الغربية وخصوصًا طنطا، من 30 إلى 50 سنة، أصحاب مهن حرة ووظائف إدارية، ويكون عندهم وسيلة تواصل متاحة."
              className="w-full resize-none rounded-2xl bg-ink-900 border border-ink-700 px-4 py-3 text-sm leading-7 text-ink-100 placeholder:text-ink-600 focus:outline-none focus:border-brand-500"
            />
            <Button onClick={handleAnalyze} disabled={busy || !rawQuery.trim()} className="w-full mt-3">
              {busy ? <><Spinner size={16} /> جارٍ تحليل الطلب</> : <><Search size={17} /> تحليل الطلب</>}
            </Button>
          </Card>
          <Card className="bg-ink-900/60">
            <div className="flex items-center gap-2 text-ink-300 text-sm"><ShieldCheck size={17} className="text-brand-400" /> البحث يلتزم بالمصادر المصرح بها فقط</div>
            <p className="text-ink-500 text-xs leading-6 mt-2">لن يتم تجاوز تسجيل الدخول أو CAPTCHA أو حدود المنصات، ولن تظهر بيانات وهمية عند عدم تهيئة مصدر.</p>
          </Card>
        </>
      )}

      {analysis && !job && (
        <Card className="border-brand-500/20">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2"><Check size={18} className="text-brand-400" /><h2 className="text-ink-100 font-semibold">فهمت طلبك كالتالي</h2></div>
            <button onClick={() => setAnalysis(null)} className="text-xs text-ink-500">تعديل المعايير</button>
          </div>
          <div className="grid gap-2">
            {summary.length > 0 ? summary.map((item, index) => (
              <div key={`${item.label}-${index}`} className="flex items-center justify-between rounded-xl bg-ink-900 px-3 py-2.5 gap-3">
                <span className="text-ink-500 text-xs">{item.label}</span><span className="text-ink-100 text-sm text-left">{item.value || 'غير معروف'}</span>
              </div>
            )) : <p className="text-ink-500 text-sm">لم يتم استخراج معايير واضحة بعد.</p>}
          </div>
          {(analysis.warnings?.length ?? 0) > 0 && <div className="mt-3 text-warning-400 text-xs leading-6">{analysis.warnings.map((warning) => <p key={warning}>• {warning}</p>)}</div>}
          <div className="mt-4 rounded-xl border border-ink-800 p-3">
            <div className="flex items-center gap-2 text-ink-300 text-sm"><Database size={16} className="text-accent-400" /> مصادر البيانات</div>
            <p className="text-ink-500 text-xs mt-2">{enabledSources.length > 0 ? `${enabledSources.length} مصدر مفعّل وسيتم فحصه.` : 'لا يوجد مصدر بيانات مهيأ حاليًا. سيُسجّل البحث دون اختلاق نتائج.'}</p>
          </div>
          <Button onClick={handleStart} disabled={busy} className="w-full mt-4">
            {busy ? <><Spinner size={16} /> جارٍ بدء البحث</> : <><Search size={17} /> بدء البحث</>}
          </Button>
        </Card>
      )}

      {job && <JobProgress job={job} stats={stats} leads={leads} />}
    </div>
  );
}

function JobProgress({ job, stats, leads }: { job: LeadSearchJob; stats: LeadSearchStats | null; leads: Lead[] }) {
  const stages = ['analyzing', 'selecting_sources', 'searching', 'collecting', 'cleaning', 'deduplicating', 'qualifying', 'scoring'];
  return (
    <div>
      <Card className="mb-4">
        <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><SlidersHorizontal size={17} className="text-brand-400" /><h2 className="text-ink-100 font-semibold">عملية البحث</h2></div><Badge color={job.status === 'failed' ? 'danger' : job.status === 'completed' ? 'brand' : 'accent'}>{LEAD_JOB_STAGE_LABELS[job.status] ?? job.status}</Badge></div>
        <div className="h-2 rounded-full bg-ink-800 overflow-hidden"><div className="h-full bg-brand-500 transition-all" style={{ width: `${job.progress_percent}%` }} /></div>
        <p className="text-ink-500 text-xs mt-2">{LEAD_JOB_STAGE_LABELS[job.progress_stage] ?? 'جارٍ التنفيذ'} — {job.progress_percent}%</p>
        <div className="grid grid-cols-2 gap-2 mt-4">
          {stages.map((stage) => <div key={stage} className="flex items-center gap-1.5 text-xs text-ink-500"><Check size={13} className={job.progress_percent >= 100 || job.progress_stage === stage ? 'text-brand-400' : 'text-ink-700'} />{LEAD_JOB_STAGE_LABELS[stage]}</div>)}
        </div>
        {job.last_error && <p className="text-danger-400 text-xs mt-3">{job.last_error}</p>}
      </Card>

      {stats && <div className="grid grid-cols-2 gap-2 mb-4">{[
        ['تم العثور عليه', stats.totalFound], ['بيانات صالحة', stats.valid], ['تكرار', stats.duplicates], ['غير صالحة', stats.invalid], ['عملاء مؤهلون', stats.qualified],
      ].map(([label, value]) => <Card key={label as string} className="p-3"><p className="text-ink-500 text-xs">{label}</p><p className="text-ink-100 text-xl font-bold mt-1">{value}</p></Card>)}</div>}

      {job.status === 'completed' && leads.length === 0 && <EmptyState icon={<Database size={25} />} title="لا توجد نتائج فعلية بعد" subtitle="المصدر غير مهيأ أو لم يُرجع بيانات مسموحًا باستخدامها. أضف مصدرًا من إعدادات Super Admin ثم أعد البحث." />}
      {leads.length > 0 && <div className="flex flex-col gap-3"><h2 className="text-ink-100 font-semibold">أفضل العملاء</h2>{leads.map((lead) => <LeadCard key={lead.id} lead={lead} />)}</div>}
    </div>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  return <Card>
    <div className="flex items-start justify-between gap-3"><div><h3 className="text-ink-100 font-semibold">{lead.full_name || [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'اسم غير معروف'}</h3><p className="text-ink-400 text-sm mt-1">{lead.job_title || lead.occupation || 'المهنة غير معروفة'}</p><p className="text-ink-500 text-xs mt-1">{[lead.city, lead.governorate].filter(Boolean).join(' – ') || 'الموقع غير معروف'}</p></div><Badge color="brand">{lead.lead_score ?? 'غير معروف'}</Badge></div>
    <div className="flex flex-wrap gap-2 mt-3 text-xs text-ink-400"><span>جودة البيانات: {lead.data_quality_score ?? 'غير معروف'}</span><span>•</span><span>{freshnessLabel(lead.last_verified_at)}</span></div>
    <div className="flex gap-2 mt-4"><Button size="sm" variant="secondary">عرض التفاصيل</Button><Button size="sm" variant="ghost">إضافة للحملة</Button></div>
  </Card>;
}
