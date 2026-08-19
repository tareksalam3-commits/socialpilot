import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, Database, Pause, Play, RefreshCw, ShieldAlert, Trash2, XCircle } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, ScreenLoader, Select } from '@/components/ui';
import { leadHunterAdmin } from '../services/leadHunterAdminApi';

type Tab = 'overview' | 'sources' | 'searches' | 'jobs' | 'leads' | 'ai' | 'scoring' | 'quality' | 'campaigns' | 'exports' | 'suppression' | 'users' | 'workspaces' | 'usage' | 'limits' | 'settings' | 'logs' | 'errors' | 'health';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'نظرة عامة' }, { id: 'sources', label: 'مصادر البيانات' }, { id: 'searches', label: 'عمليات البحث' },
  { id: 'jobs', label: 'الـJobs' }, { id: 'leads', label: 'العملاء' }, { id: 'ai', label: 'الذكاء الاصطناعي' },
  { id: 'scoring', label: 'التقييم' }, { id: 'quality', label: 'جودة البيانات' }, { id: 'campaigns', label: 'الحملات' },
  { id: 'exports', label: 'التصدير' }, { id: 'suppression', label: 'قائمة عدم التواصل' }, { id: 'users', label: 'المستخدمون' },
  { id: 'workspaces', label: 'مساحات العمل' }, { id: 'usage', label: 'الاستخدام' }, { id: 'limits', label: 'الحدود' },
  { id: 'settings', label: 'الإعدادات' }, { id: 'logs', label: 'السجلات' }, { id: 'errors', label: 'الأخطاء' }, { id: 'health', label: 'صحة النظام' },
];

const STATUS_LABELS: Record<string, string> = { healthy: 'يعمل', warning: 'تحذير', error: 'خطأ', not_configured: 'غير مهيأ', disabled: 'معطّل', completed: 'اكتمل', queued: 'في الانتظار', running: 'جارٍ', paused: 'متوقف مؤقتًا', failed: 'فشل', cancelled: 'تم الإلغاء' };
const STAGE_LABELS: Record<string, string> = { not_configured: 'لا توجد مصادر بحث خارجي مهيأة بعد', no_source_configured: 'لم يتم تفعيل أي مصدر بيانات' };

export function LeadHunterAdminPanel({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [sourceDraft, setSourceDraft] = useState({ workspace_id: '', name: '', connector_key: '', source_type: 'official_api', priority: '100', api_key: '' });

  async function loadTab(nextTab: Tab) {
    setLoading(true);
    setError(null);
    try {
      let result: Record<string, unknown>;
      if (nextTab === 'overview') result = await leadHunterAdmin.overview();
      else if (nextTab === 'health') result = await leadHunterAdmin.health();
      else if (nextTab === 'settings' || nextTab === 'scoring') result = await leadHunterAdmin.settings();
      else if (nextTab === 'sources') result = await leadHunterAdmin.sources();
      else if (nextTab === 'searches' || nextTab === 'jobs') result = await leadHunterAdmin.jobs();
      else if (nextTab === 'leads') result = await leadHunterAdmin.leads();
      else if (nextTab === 'suppression') result = await leadHunterAdmin.suppression();
      else if (nextTab === 'campaigns') result = await leadHunterAdmin.campaigns();
      else if (nextTab === 'exports') result = await leadHunterAdmin.exports();
      else if (nextTab === 'usage') result = await leadHunterAdmin.usage();
      else if (nextTab === 'logs') result = await leadHunterAdmin.logs();
      else if (nextTab === 'errors') result = await leadHunterAdmin.errors();
      else if (nextTab === 'ai') result = await leadHunterAdmin.prompts();
      else if (nextTab === 'users') result = await leadHunterAdmin.permissions();
      else if (nextTab === 'workspaces') result = await leadHunterAdmin.workspaces();
      else result = await leadHunterAdmin.limits();
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل بيانات Lead Hunter Admin.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadTab(tab); }, [tab]);

  async function refresh() { await loadTab(tab); }

  async function mutate(action: () => Promise<unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true); setError(null);
    try { await action(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تنفيذ العملية.'); } finally { setBusy(false); }
  }

  const overview = (data.overview ?? {}) as Record<string, number | null>;
  const sources = (data.sources ?? []) as Array<Record<string, unknown>>;
  const jobs = (data.jobs ?? []) as Array<Record<string, unknown>>;
  const leads = (data.leads ?? []) as Array<Record<string, unknown>>;

  return (
    <div dir="rtl" className="min-h-screen bg-ink-950 px-5 py-5 safe-top pb-24">
      <header className="flex items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2"><button onClick={onBack} className="text-ink-400"><ArrowRight size={22} /></button><div><p className="text-brand-400 text-xs">Super Admin</p><h1 className="text-lg font-bold text-ink-50">🎯 Lead Hunter</h1></div></div>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></Button>
      </header>
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3 mb-4">{TABS.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`shrink-0 rounded-xl px-3 py-2 text-xs ${tab === item.id ? 'bg-brand-500 text-ink-950 font-semibold' : 'bg-ink-900 text-ink-400 border border-ink-800'}`}>{item.label}</button>)}</div>
      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
      {loading ? <ScreenLoader label="جارٍ تحميل بيانات الإدارة..." /> : <AdminContent tab={tab} data={data} overview={overview} sources={sources} jobs={jobs} leads={leads} sourceDraft={sourceDraft} setSourceDraft={setSourceDraft} busy={busy} mutate={mutate} />}
    </div>
  );
}

function AdminContent({ tab, data, overview, sources, jobs, leads, sourceDraft, setSourceDraft, busy, mutate }: {
  tab: Tab; data: Record<string, unknown>; overview: Record<string, number | null>; sources: Array<Record<string, unknown>>; jobs: Array<Record<string, unknown>>; leads: Array<Record<string, unknown>>;
  sourceDraft: { workspace_id: string; name: string; connector_key: string; source_type: string; priority: string; api_key: string };
  setSourceDraft: (draft: { workspace_id: string; name: string; connector_key: string; source_type: string; priority: string; api_key: string }) => void;
  busy: boolean; mutate: (action: () => Promise<unknown>, confirmText?: string) => Promise<void>;
}) {
  if (tab === 'overview') return <Overview overview={overview} />;
  if (tab === 'sources') return <Sources sources={sources} draft={sourceDraft} setDraft={setSourceDraft} busy={busy} mutate={mutate} />;
  if (tab === 'jobs' || tab === 'searches') return <Jobs jobs={jobs} mutate={mutate} />;
  if (tab === 'leads') return <Leads leads={leads} mutate={mutate} />;
  if (tab === 'health') return <Health data={data} />;
  if (tab === 'settings') return <Settings data={data} mutate={mutate} />;
  if (tab === 'scoring' || tab === 'quality') return <Scoring data={data} mutate={mutate} quality={tab === 'quality'} />;
  if (tab === 'ai') return <Prompts data={data} mutate={mutate} />;
  if (tab === 'errors') return <Errors data={data} mutate={mutate} />;
  const key = tab === 'suppression' ? 'suppression' : tab;
  const rows = (data[key] ?? []) as Array<Record<string, unknown>>;
  return <Rows title={TABS.find((item) => item.id === tab)?.label ?? tab} rows={rows} />;
}

function Overview({ overview }: { overview: Record<string, number | null> }) {
  const cards = [['إجمالي العملاء', overview.total], ['العملاء الجدد', overview.newer], ['العملاء المؤهلون', overview.qualified], ['أولوية عالية', overview.high], ['عمليات البحث اليوم', overview.searchesToday], ['عمليات البحث النشطة', overview.activeJobs], ['مصادر نشطة', overview.activeSources], ['مصادر بها أخطاء', overview.sourceErrors], ['متوسط جودة البيانات', overview.averageQuality], ['متوسط Lead Score', overview.averageLeadScore]];
  return <div><div className="grid grid-cols-2 gap-2">{cards.map(([label, value]) => <Card key={label} className="p-3"><p className="text-ink-500 text-xs">{label}</p><p className="text-ink-50 text-xl font-bold mt-1">{value ?? 'غير معروف'}</p></Card>)}</div><Card className="mt-4"><div className="flex items-center gap-2 text-ink-200 text-sm"><Database size={17} className="text-brand-400" /> النشاط الحقيقي</div><p className="text-ink-500 text-xs leading-6 mt-2">الإحصاءات المعروضة مأخوذة من جداول Lead Hunter الحالية. عدم وجود بيانات يظهر كصفر أو «غير معروف» ولا يتم توليد أرقام تجريبية.</p></Card></div>;
}

function Sources({ sources, draft, setDraft, busy, mutate }: { sources: Array<Record<string, unknown>>; draft: { workspace_id: string; name: string; connector_key: string; source_type: string; priority: string; api_key: string }; setDraft: (draft: { workspace_id: string; name: string; connector_key: string; source_type: string; priority: string; api_key: string }) => void; busy: boolean; mutate: (action: () => Promise<unknown>, confirmText?: string) => Promise<void>; }) {
  return <div><Card className="mb-4"><h2 className="text-ink-100 font-semibold mb-3">إضافة أو تحديث مصدر</h2><div className="grid gap-2"><Input value={draft.workspace_id} onChange={(v) => setDraft({ ...draft, workspace_id: v })} placeholder="Workspace UUID" /><Input value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="اسم المصدر" /><Input value={draft.connector_key} onChange={(v) => setDraft({ ...draft, connector_key: v })} placeholder="Connector key" /><Select value={draft.source_type} onChange={(v) => setDraft({ ...draft, source_type: v })} options={[{ value: 'official_api', label: 'Official API' }, { value: 'public_directory', label: 'دليل عام مسموح' }, { value: 'professional_source', label: 'مصدر مهني عام' }, { value: 'owned_source', label: 'مصدر يملكه المستخدم' }, { value: 'lead_form', label: 'Lead Form' }]} /><Input value={draft.priority} onChange={(v) => setDraft({ ...draft, priority: v })} placeholder="الأولوية" type="text" /><Input value={draft.api_key} onChange={(v) => setDraft({ ...draft, api_key: v })} placeholder="API Key — لا تُعرض بعد الحفظ" type="password" /></div><Button className="mt-3" disabled={busy || !draft.workspace_id || !draft.name || !draft.connector_key} onClick={() => mutate(() => leadHunterAdmin.saveSource({ workspace_id: draft.workspace_id, name: draft.name, connector_key: draft.connector_key, source_type: draft.source_type, priority: Number(draft.priority) || 100, enabled: false }, draft.api_key))}>حفظ المصدر بشكل آمن</Button><p className="text-ink-600 text-[11px] mt-2">المفتاح لا يُعاد إلى الواجهة ولا يُكتب في Audit Logs.</p></Card><div className="flex flex-col gap-2">{sources.length === 0 && <EmptyState icon={<Database size={25} />} title="لا توجد مصادر حقيقية" subtitle="أضف Connector مصرحًا به من النموذج أعلاه." />}{sources.map((source) => <Card key={String(source.id)}><div className="flex items-start justify-between gap-2"><div><p className="text-ink-100 font-medium">{String(source.name)}</p><p className="text-ink-500 text-xs mt-1" dir="ltr">{String(source.connector_key)}</p></div><Badge color={source.status === 'error' ? 'danger' : source.enabled ? 'brand' : 'neutral'}>{STATUS_LABELS[String(source.status)] ?? String(source.status)}</Badge></div><div className="grid grid-cols-2 gap-2 text-xs text-ink-400 mt-3"><span>الأولوية: {String(source.priority)}</span><span>النتائج: {String(source.records_found ?? 0)}</span><span>آخر صحة: {source.last_health_at ? String(source.last_health_at) : 'غير معروف'}</span><span>المعدل: {String(source.rate_limit_per_minute ?? 'غير معروف')}</span></div><div className="flex flex-wrap gap-2 mt-3"><Button size="sm" variant="secondary" disabled={busy} onClick={() => mutate(() => leadHunterAdmin.toggleSource(String(source.id), !source.enabled), source.enabled ? 'تعطيل هذا المصدر؟' : undefined)}>{source.enabled ? <><Pause size={14} /> إيقاف</> : <><Play size={14} /> تشغيل</>}</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => mutate(() => leadHunterAdmin.testSource(String(source.id)))}>اختبار</Button><Button size="sm" variant="danger" disabled={busy} onClick={() => mutate(() => leadHunterAdmin.deleteSource(String(source.id)), 'حذف المصدر؟ سيتم الاحتفاظ بسجل العملاء لكن قد تُفقد سجلات المصدر.') }><Trash2 size={14} /> حذف</Button></div></Card>)}</div></div>;
}

function Jobs({ jobs, mutate }: { jobs: Array<Record<string, unknown>>; mutate: (action: () => Promise<unknown>, confirmText?: string) => Promise<void> }) { return <div className="flex flex-col gap-2">{jobs.length === 0 && <EmptyState icon={<RefreshCw size={25} />} title="لا توجد عمليات بحث" subtitle="ستظهر الـJobs الحقيقية هنا عند بدء بحث." />}{jobs.map((job) => { const stage = String(job.progress_stage ?? ''); const isNoSource = job.status === 'completed' && STAGE_LABELS[stage]; return <Card key={String(job.id)}><div className="flex items-center justify-between gap-2"><div><p className="text-ink-100 text-sm font-medium">{String((job.lead_search_requests as Record<string, unknown> | null)?.raw_query ?? 'بحث بدون نص')}</p><p className="text-ink-500 text-xs mt-1">{String(job.created_at ?? '')}</p></div><Badge color={job.status === 'failed' ? 'danger' : isNoSource ? 'warning' : job.status === 'completed' ? 'brand' : 'accent'}>{isNoSource ? STAGE_LABELS[stage] : (STATUS_LABELS[String(job.status)] ?? String(job.status))}</Badge></div><div className="h-2 rounded-full bg-ink-800 mt-3"><div className="h-full bg-brand-500 rounded-full" style={{ width: `${Number(job.progress_percent ?? 0)}%` }} /></div><div className="flex gap-2 mt-3"><Button size="sm" variant="secondary" onClick={() => mutate(() => leadHunterAdmin.jobAction(String(job.id), job.status === 'paused' ? 'resume' : 'pause'))}>{job.status === 'paused' ? 'استئناف' : 'إيقاف مؤقت'}</Button><Button size="sm" variant="danger" onClick={() => mutate(() => leadHunterAdmin.jobAction(String(job.id), 'cancel'), 'إلغاء عملية البحث؟')}>إلغاء</Button><Button size="sm" variant="ghost" onClick={() => mutate(() => leadHunterAdmin.jobAction(String(job.id), 'retry'), 'إعادة تشغيل الـJob؟')}>إعادة المحاولة</Button></div></Card>; })}</div>; }

function Leads({ leads, mutate }: { leads: Array<Record<string, unknown>>; mutate: (action: () => Promise<unknown>, confirmText?: string) => Promise<void> }) { return <div className="flex flex-col gap-2">{leads.length === 0 && <EmptyState icon={<Database size={25} />} title="لا توجد Leads فعلية" subtitle="لن تظهر بيانات ما لم تُرجعها مصادر مهيأة." />}{leads.map((lead) => <Card key={String(lead.id)}><div className="flex items-start justify-between"><div><p className="text-ink-100 font-medium">{String(lead.full_name ?? 'اسم غير معروف')}</p><p className="text-ink-500 text-xs mt-1">{String(lead.city ?? 'موقع غير معروف')} — {String(lead.occupation ?? 'مهنة غير معروفة')}</p></div><Badge color="brand">{String(lead.lead_score ?? 'غير معروف')}</Badge></div><p className="text-ink-500 text-xs mt-2">الجودة: {String(lead.data_quality_score ?? 'غير معروف')} — الحالة: {String(lead.status ?? 'غير معروف')}</p><div className="flex gap-2 mt-3"><Button size="sm" variant="secondary" onClick={() => mutate(() => leadHunterAdmin.leadAction(String(lead.id), lead.do_not_contact ? 'restore' : 'suppress', String(lead.workspace_id)), lead.do_not_contact ? undefined : 'إضافة العميل إلى قائمة عدم التواصل؟')}>{lead.do_not_contact ? 'استعادة' : 'استبعاد'}</Button><Button size="sm" variant="danger" onClick={() => mutate(() => leadHunterAdmin.leadAction(String(lead.id), 'delete', String(lead.workspace_id)), 'حذف العميل نهائيًا؟')}>حذف</Button></div></Card>)}</div>; }

function Health({ data }: { data: Record<string, unknown> }) { const services = (data.services ?? []) as Array<Record<string, unknown>>; return <div className="flex flex-col gap-2">{services.length === 0 && <EmptyState icon={<ShieldAlert size={25} />} title="لا تتوفر بيانات صحة النظام" />}{services.map((service) => <Card key={String(service.key)}><div className="flex items-center justify-between"><div className="flex items-center gap-2">{service.status === 'healthy' ? <CheckCircle2 className="text-brand-400" size={18} /> : service.status === 'warning' ? <ShieldAlert className="text-warning-400" size={18} /> : <XCircle className="text-danger-400" size={18} />}<span className="text-ink-100 text-sm">{String(service.label)}</span></div><Badge color={service.status === 'healthy' ? 'brand' : service.status === 'warning' ? 'warning' : 'danger'}>{STATUS_LABELS[String(service.status)] ?? String(service.status)}</Badge></div><p className="text-ink-500 text-xs mt-2">{String(service.detail ?? '')}</p></Card>)}</div>; }

function Settings({ data, mutate }: { data: Record<string, unknown>; mutate: (action: () => Promise<unknown>, confirmText?: string) => Promise<void> }) { const settings = (data.settings ?? {}) as Record<string, unknown>; const flags = ['lead_hunter_enabled','lead_search_enabled','lead_ai_enabled','lead_scoring_enabled','lead_export_enabled','lead_campaigns_enabled','lead_social_sources_enabled']; return <div className="flex flex-col gap-3"><Card><h2 className="text-ink-100 font-semibold mb-3">Feature Flags وKill Switch</h2>{[...flags, 'kill_switch'].map((key) => <button key={key} onClick={() => mutate(() => leadHunterAdmin.updateSettings({ [key]: !settings[key] }), key === 'kill_switch' ? 'تغيير Kill Switch؟ سيمنع عمليات البحث الجديدة.' : undefined)} className="w-full flex items-center justify-between py-3 border-b border-ink-800 last:border-0"><span className="text-ink-300 text-sm" dir="ltr">{key}</span><Badge color={settings[key] ? key === 'kill_switch' ? 'danger' : 'brand' : 'neutral'}>{settings[key] ? 'مفعّل' : 'معطّل'}</Badge></button>)}</Card><Card><h2 className="text-ink-100 font-semibold mb-2">القيم الافتراضية</h2><div className="grid grid-cols-2 gap-2 text-xs text-ink-400"><span>حد البحث: {String(settings.default_search_limit ?? 'غير معروف')}</span><span>أقصى تشغيل: {String(settings.max_runtime_seconds ?? 'غير معروف')} ثانية</span><span>المصادر: {String(settings.max_sources ?? 'غير معروف')}</span><span>الاحتفاظ: {String(settings.default_retention_days ?? 'غير معروف')} يوم</span></div></Card></div>; }

function Scoring({ data, mutate, quality }: { data: Record<string, unknown>; mutate: (action: () => Promise<unknown>, confirmText?: string) => Promise<void>; quality: boolean }) { const scoring = (data.scoring ?? {}) as Record<string, unknown>; const value = quality ? scoring.quality_weights : scoring.lead_score_weights; const [text, setText] = useState(JSON.stringify(value ?? {}, null, 2)); const [message, setMessage] = useState<string | null>(null); return <Card><h2 className="text-ink-100 font-semibold">{quality ? 'إدارة جودة البيانات' : 'إعدادات Lead Score'}</h2><p className="text-ink-500 text-xs leading-6 mt-2">عدّل JSON للأوزان فقط. في Lead Score يجب أن يساوي المجموع 100%.</p><textarea value={text} onChange={(e) => setText(e.target.value)} dir="ltr" rows={10} className="w-full mt-3 rounded-xl bg-ink-900 border border-ink-700 p-3 text-xs text-ink-100 font-mono focus:outline-none focus:border-brand-500" />{message && <p className="text-warning-400 text-xs mt-2">{message}</p>}<Button className="mt-3" onClick={() => { try { const parsed = JSON.parse(text); setMessage(null); void mutate(() => leadHunterAdmin.updateScoring(quality ? { quality_weights: parsed } : { lead_score_weights: parsed })); } catch { setMessage('صيغة JSON غير صحيحة.'); } }}>حفظ الإعدادات</Button></Card>; }

function Prompts({ data, mutate }: { data: Record<string, unknown>; mutate: (action: () => Promise<unknown>, confirmText?: string) => Promise<void> }) { const prompts = (data.prompts ?? []) as Array<Record<string, unknown>>; const [task, setTask] = useState('understand_lead_query'); const [prompt, setPrompt] = useState(''); return <div><Card className="mb-3"><h2 className="text-ink-100 font-semibold mb-3">نسخة Prompt جديدة</h2><Select value={task} onChange={setTask} options={['understand_lead_query','occupation_classification','lead_scoring','entity_resolution','data_cleaning','ranking','score_explanation'].map((item) => ({ value: item, label: item }))} /><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} placeholder="اكتب Prompt جديدًا — النسخة القديمة ستبقى محفوظة" className="w-full mt-2 rounded-xl bg-ink-900 border border-ink-700 p-3 text-xs text-ink-100" /><Button className="mt-2" disabled={!prompt.trim()} onClick={() => mutate(() => leadHunterAdmin.savePrompt({ task, version: Math.max(0, ...prompts.filter((p) => p.task === task).map((p) => Number(p.version) || 0)) + 1, prompt, enabled: true }))}>حفظ نسخة جديدة</Button></Card><Rows title="إصدارات Prompts" rows={prompts} /></div>; }

function Errors({ data, mutate }: { data: Record<string, unknown>; mutate: (action: () => Promise<unknown>, confirmText?: string) => Promise<void> }) { const errors = (data.errors ?? []) as Array<Record<string, unknown>>; return <div className="flex flex-col gap-2">{errors.length === 0 && <EmptyState icon={<CheckCircle2 size={25} />} title="لا توجد أخطاء مسجلة" />}{errors.map((item) => <Card key={String(item.id)}><div className="flex justify-between gap-2"><div><p className="text-ink-100 text-sm">{String(item.message)}</p><p className="text-ink-500 text-xs mt-1">{String(item.error_type)} — {String(item.last_occurred_at)}</p></div><Badge color={item.severity === 'critical' ? 'danger' : item.severity === 'warning' ? 'warning' : 'neutral'}>{String(item.severity)}</Badge></div><div className="flex gap-2 mt-3"><Button size="sm" variant="secondary" onClick={() => mutate(() => leadHunterAdmin.resolveError(String(item.id), 'resolved'))}>تم الحل</Button><Button size="sm" variant="ghost" onClick={() => mutate(() => leadHunterAdmin.resolveError(String(item.id), 'ignored'))}>تجاهل</Button></div></Card>)}</div>; }

function Rows({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) { const keys = useMemo(() => Array.from(new Set(rows.flatMap((row) => Object.keys(row).filter((key) => !['id','metadata','detail','payload'].includes(key))))).slice(0, 6), [rows]); return <div><h2 className="text-ink-100 font-semibold mb-3">{title}</h2>{rows.length === 0 ? <EmptyState icon={<Database size={25} />} title="لا توجد بيانات فعلية" subtitle="ستظهر البيانات هنا بعد تنفيذ عمليات حقيقية." /> : <div className="flex flex-col gap-2">{rows.map((row, index) => <Card key={String(row.id ?? index)}><div className="grid grid-cols-2 gap-2 text-xs">{keys.map((key) => <div key={key}><p className="text-ink-600">{key}</p><p className="text-ink-200 break-words mt-0.5">{typeof row[key] === 'object' ? JSON.stringify(row[key]) : String(row[key] ?? 'غير معروف')}</p></div>)}</div></Card>)}</div>}</div>; }
