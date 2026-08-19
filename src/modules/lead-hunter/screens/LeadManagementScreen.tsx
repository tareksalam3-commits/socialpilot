import { useEffect, useState } from 'react';
import { ArrowRight, Ban, Download, FileUp, Filter, Megaphone, Plus, Search, Tag, Users, X } from 'lucide-react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, Select, ScreenLoader, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import type { LeadExportFormat } from '../services/leadHunterApi';
import {
  addLead, addLeadsToCampaign, addLeadTag, createCampaign, downloadExport, exportLeads,
  importLeads, listAllLeads, listCampaignMembers, listCampaigns, listTags, removeLeadFromCampaign,
  suppressLead, unsuppressLead, updateCampaignMemberStatus, updateLead, updateLeadStatus,
} from '../services/leadHunterApi';
import type { Lead, LeadCampaign, LeadCampaignMember, LeadIntakeRawInput, LeadListFilters, LeadSortBy, LeadTag } from '../types';
import { EGYPT_GOVERNORATES, freshnessLabel } from '../utils/scoring';

const SORT_OPTIONS: Array<{ value: LeadSortBy; label: string }> = [
  { value: 'updated_at', label: 'الأحدث تحديثًا' },
  { value: 'lead_score', label: 'Lead Score (الأعلى أولًا)' },
  { value: 'data_quality_score', label: 'جودة البيانات (الأعلى أولًا)' },
];

const STATUS_LABELS: Record<Lead['status'], string> = {
  new: 'جديد', qualified: 'مؤهّل', contacted: 'تم التواصل', converted: 'محوّل لعميل',
  suppressed: 'موقوف عن التواصل', invalid: 'غير صالح', archived: 'مؤرشف',
};

const CSV_FIELD_ALIASES: Record<string, keyof LeadIntakeRawInput> = {
  full_name: 'full_name', name: 'full_name', 'الاسم': 'full_name',
  phone: 'business_phone', business_phone: 'business_phone', mobile: 'business_phone', 'الهاتف': 'business_phone',
  public_contact_phone: 'public_contact_phone',
  email: 'business_email', business_email: 'business_email', 'البريد': 'business_email',
  occupation: 'occupation', job_title: 'job_title', industry: 'industry', employer: 'employer',
  country: 'country', governorate: 'governorate', 'المحافظة': 'governorate', city: 'city', 'المدينة': 'city', district: 'district',
  professional_url: 'professional_url', social_url: 'social_url', notes: 'notes', age: 'age', gender: 'gender',
};

function parseCsv(text: string): LeadIntakeRawInput[] {
  const rows = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (rows.length === 0) return [];
  const splitLine = (line: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') { inQuotes = !inQuotes; continue; }
      if (char === ',' && !inQuotes) { cells.push(current); current = ''; continue; }
      current += char;
    }
    cells.push(current);
    return cells.map((c) => c.trim());
  };
  const headers = splitLine(rows[0]).map((h) => h.toLowerCase());
  return rows.slice(1).map((line) => {
    const cells = splitLine(line);
    const record: LeadIntakeRawInput = {};
    headers.forEach((header, index) => {
      const field = CSV_FIELD_ALIASES[header];
      if (field && cells[index]) (record as Record<string, unknown>)[field] = cells[index];
    });
    return record;
  });
}

export function LeadManagementScreen({ onBack }: { onBack: () => void }) {
  const { workspace } = useAuth();
  const [tab, setTab] = useState<'leads' | 'campaigns'>('leads');
  if (!workspace) return <ScreenLoader />;
  return (
    <div dir="rtl" className="min-h-screen bg-ink-950 px-5 py-5 safe-top pb-8">
      <header className="flex items-center gap-3 mb-5">
        <button onClick={onBack} className="w-10 h-10 rounded-xl bg-ink-900 border border-ink-800 text-ink-300 flex items-center justify-center" aria-label="العودة">
          <ArrowRight size={19} />
        </button>
        <div>
          <p className="text-brand-400 text-xs mb-1">Lead Hunter</p>
          <h1 className="text-xl font-bold text-ink-50">إدارة العملاء</h1>
        </div>
      </header>

      <div className="flex gap-2 mb-5 bg-ink-900 rounded-xl p-1">
        <button onClick={() => setTab('leads')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${tab === 'leads' ? 'bg-brand-500 text-ink-950' : 'text-ink-400'}`}>كل العملاء</button>
        <button onClick={() => setTab('campaigns')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${tab === 'campaigns' ? 'bg-brand-500 text-ink-950' : 'text-ink-400'}`}>الحملات</button>
      </div>

      {tab === 'leads' ? <LeadsTab workspaceId={workspace.id} /> : <CampaignsTab workspaceId={workspace.id} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leads tab
// ---------------------------------------------------------------------------

function LeadsTab({ workspaceId }: { workspaceId: string }) {
  const [filters, setFilters] = useState<LeadListFilters>({});
  const [sortBy, setSortBy] = useState<LeadSortBy>('updated_at');
  const [page, setPage] = useState(0);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [tags, setTags] = useState<LeadTag[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<LeadCampaign[]>([]);
  const [campaignToAdd, setCampaignToAdd] = useState('');
  const [exportBusy, setExportBusy] = useState<LeadExportFormat | null>(null);

  useEffect(() => { listCampaigns(workspaceId).then(setCampaigns).catch(() => setCampaigns([])); }, [workspaceId]);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await listAllLeads(workspaceId, filters, page, sortBy);
      setLeads(result.leads);
      setTotal(result.total);
      setPageSize(result.pageSize);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحميل العملاء.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workspaceId, filters, page, sortBy]);
  useEffect(() => { listTags(workspaceId).then(setTags).catch(() => setTags([])); }, [workspaceId]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function describeFilters(): string[] {
    const parts: string[] = [];
    if (filters.status) parts.push(`الحالة: ${STATUS_LABELS[filters.status]}`);
    if (filters.governorate) parts.push(`المحافظة: ${filters.governorate}`);
    if (filters.city) parts.push(`المدينة: ${filters.city}`);
    if (filters.minScore) parts.push(`Lead Score ≥ ${filters.minScore}`);
    if (filters.minQuality) parts.push(`Data Quality ≥ ${filters.minQuality}`);
    if (filters.search) parts.push(`بحث: ${filters.search}`);
    return parts;
  }

  // Selected rows export exactly those leads. Otherwise export exports EVERY
  // lead matching the current filters (server-side), not just the leads
  // visible on the current page — fixes a real bug where "Export" used to
  // silently only include the current page.
  async function handleExport(format: LeadExportFormat) {
    setExportBusy(format);
    try {
      const result = selected.size > 0
        ? await exportLeads(workspaceId, { kind: 'selected', leadIds: Array.from(selected) }, format)
        : await exportLeads(workspaceId, { kind: 'filtered', filters }, format);
      if (result.rows.length === 0) { setNotice('لا توجد بيانات مطابقة للتصدير.'); return; }
      await downloadExport(result.rows, format, 'leads', describeFilters());
      setNotice(result.suppressedCount > 0 ? `تم التصدير (${result.count} عميل). استُبعد ${result.suppressedCount} عميل بسبب Do Not Contact.` : `تم التصدير بنجاح (${result.count} عميل).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر التصدير.');
    } finally {
      setExportBusy(null);
    }
  }

  async function handleAddToCampaign() {
    if (!campaignToAdd || selected.size === 0) return;
    try {
      const result = await addLeadsToCampaign(workspaceId, campaignToAdd, Array.from(selected));
      setNotice(result.skippedDoNotContact > 0 ? `أُضيف ${result.added} عميل. استُبعد ${result.skippedDoNotContact} بسبب Do Not Contact.` : `أُضيف ${result.added} عميل إلى الحملة.`);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر الإضافة إلى الحملة.');
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
      {notice && <div className="mb-4 rounded-xl bg-brand-500/10 border border-brand-500/30 px-4 py-3 text-sm text-brand-300 flex items-center justify-between"><span>{notice}</span><button onClick={() => setNotice(null)}><X size={15} /></button></div>}

      <div className="flex gap-2 mb-3">
        <div className="flex-1 relative">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-600" />
          <input
            value={filters.search ?? ''}
            onChange={(e) => { setPage(0); setFilters((f) => ({ ...f, search: e.target.value })); }}
            placeholder="ابحث بالاسم أو المهنة"
            dir="rtl"
            className="w-full rounded-xl bg-ink-900 border border-ink-700 pr-9 pl-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-600 focus:outline-none focus:border-brand-500"
          />
        </div>
        <button onClick={() => setShowFilters((v) => !v)} className="w-10 h-10 rounded-xl bg-ink-900 border border-ink-800 text-ink-300 flex items-center justify-center shrink-0"><Filter size={16} /></button>
      </div>

      {showFilters && (
        <Card className="mb-3">
          <div className="grid grid-cols-2 gap-2">
            <Select value={filters.status ?? ''} onChange={(v) => { setPage(0); setFilters((f) => ({ ...f, status: (v || undefined) as Lead['status'] | undefined })); }}
              options={[{ value: '', label: 'كل الحالات' }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))]} />
            <Select value={filters.governorate ?? ''} onChange={(v) => { setPage(0); setFilters((f) => ({ ...f, governorate: v || undefined })); }}
              options={[{ value: '', label: 'كل المحافظات' }, ...EGYPT_GOVERNORATES.map((g) => ({ value: g, label: g }))]} />
            <Input value={filters.city ?? ''} onChange={(v) => { setPage(0); setFilters((f) => ({ ...f, city: v || undefined })); }} placeholder="المدينة" />
            <Select value={String(filters.tagId ?? '')} onChange={(v) => { setPage(0); setFilters((f) => ({ ...f, tagId: v || undefined })); }}
              options={[{ value: '', label: 'كل الوسوم' }, ...tags.map((t) => ({ value: t.id, label: t.name }))]} />
            <Input value={filters.minScore ? String(filters.minScore) : ''} onChange={(v) => { setPage(0); const n = Number(v); setFilters((f) => ({ ...f, minScore: v && Number.isFinite(n) ? n : undefined })); }} placeholder="أقل Lead Score" />
            <Input value={filters.minQuality ? String(filters.minQuality) : ''} onChange={(v) => { setPage(0); const n = Number(v); setFilters((f) => ({ ...f, minQuality: v && Number.isFinite(n) ? n : undefined })); }} placeholder="أقل Data Quality" />
          </div>
          <div className="mt-3">
            <p className="text-ink-500 text-xs mb-1.5">الترتيب</p>
            <Select value={sortBy} onChange={(v) => { setPage(0); setSortBy(v as LeadSortBy); }} options={SORT_OPTIONS} />
          </div>
          <label className="flex items-center gap-2 mt-3 text-xs text-ink-400">
            <input type="checkbox" checked={Boolean(filters.includeDoNotContact)} onChange={(e) => { setPage(0); setFilters((f) => ({ ...f, includeDoNotContact: e.target.checked })); }} />
            عرض العملاء الموقوفين عن التواصل أيضًا
          </label>
        </Card>
      )}

      <div className="flex gap-2 mb-4">
        <Button size="sm" onClick={() => setShowAddForm((v) => !v)} className="flex-1"><Plus size={15} /> إضافة عميل</Button>
        <Button size="sm" variant="secondary" onClick={() => setShowImport((v) => !v)} className="flex-1"><FileUp size={15} /> استيراد CSV</Button>
      </div>

      {showAddForm && <AddLeadForm workspaceId={workspaceId} onDone={() => { setShowAddForm(false); refresh(); }} />}
      {showImport && <ImportLeadsForm workspaceId={workspaceId} onDone={(msg) => { setShowImport(false); setNotice(msg); refresh(); }} />}

      <div className="flex items-center justify-between mb-1.5">
        <p className="text-ink-500 text-xs">{total} عميل{selected.size > 0 ? ` — ${selected.size} محدد` : ''}</p>
      </div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <p className="text-ink-600 text-[11px]">التصدير سيشمل: {selected.size > 0 ? `${selected.size} عميل محدد` : 'كل النتائج المطابقة للفلاتر الحالية'}</p>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="ghost" onClick={() => handleExport('csv')} disabled={exportBusy !== null}>{exportBusy === 'csv' ? <Spinner size={13} /> : <Download size={14} />} CSV</Button>
          <Button size="sm" variant="ghost" onClick={() => handleExport('xlsx')} disabled={exportBusy !== null}>{exportBusy === 'xlsx' ? <Spinner size={13} /> : <Download size={14} />} Excel</Button>
          <Button size="sm" variant="ghost" onClick={() => handleExport('json')} disabled={exportBusy !== null}>{exportBusy === 'json' ? <Spinner size={13} /> : <Download size={14} />} JSON</Button>
          <Button size="sm" variant="ghost" onClick={() => handleExport('pdf')} disabled={exportBusy !== null}>{exportBusy === 'pdf' ? <Spinner size={13} /> : <Download size={14} />} PDF</Button>
        </div>
      </div>

      {selected.size > 0 && campaigns.length > 0 && (
        <div className="flex gap-2 mb-4">
          <Select value={campaignToAdd} onChange={setCampaignToAdd} options={[{ value: '', label: 'اختر حملة' }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]} />
          <Button size="sm" onClick={handleAddToCampaign} disabled={!campaignToAdd}><Megaphone size={14} /> إضافة للحملة</Button>
        </div>
      )}

      {loading ? <ScreenLoader /> : leads.length === 0 ? (
        <EmptyState icon={<Users size={25} />} title="لا يوجد عملاء بعد" subtitle="أضف عميلًا يدويًا أو استورد ملف CSV." />
      ) : (
        <div className="flex flex-col gap-3">
          {leads.map((lead) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              workspaceId={workspaceId}
              tags={tags}
              selected={selected.has(lead.id)}
              expanded={expandedId === lead.id}
              onToggleSelect={() => toggleSelect(lead.id)}
              onToggleExpand={() => setExpandedId((id) => (id === lead.id ? null : lead.id))}
              onChanged={refresh}
              onTagsChanged={() => listTags(workspaceId).then(setTags).catch(() => {})}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>السابق</Button>
          <span className="text-ink-500 text-xs">صفحة {page + 1} من {totalPages}</span>
          <Button size="sm" variant="secondary" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>التالي</Button>
        </div>
      )}
    </div>
  );
}

function AddLeadForm({ workspaceId, onDone }: { workspaceId: string; onDone: () => void }) {
  const [form, setForm] = useState<LeadIntakeRawInput>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await addLead(workspaceId, form);
      if (result.status === 'rejected') { setError(result.errors.join(' ')); return; }
      if (result.status === 'duplicate') { setError('هذا العميل مكرر — تم تحديث بياناته في السجل الموجود.'); onDone(); return; }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إضافة العميل.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}
      <div className="grid grid-cols-2 gap-2">
        <Input value={form.full_name ?? ''} onChange={(v) => setForm((f) => ({ ...f, full_name: v }))} placeholder="الاسم الكامل" />
        <Input value={form.business_phone ?? ''} onChange={(v) => setForm((f) => ({ ...f, business_phone: v }))} placeholder="رقم الهاتف" />
        <Input value={form.business_email ?? ''} onChange={(v) => setForm((f) => ({ ...f, business_email: v }))} placeholder="البريد الإلكتروني" />
        <Input value={form.occupation ?? ''} onChange={(v) => setForm((f) => ({ ...f, occupation: v }))} placeholder="المهنة" />
        <Select value={form.governorate ?? ''} onChange={(v) => setForm((f) => ({ ...f, governorate: v, country: 'مصر' }))} options={[{ value: '', label: 'المحافظة' }, ...EGYPT_GOVERNORATES.map((g) => ({ value: g, label: g }))]} />
        <Input value={form.city ?? ''} onChange={(v) => setForm((f) => ({ ...f, city: v }))} placeholder="المدينة" />
      </div>
      <Button onClick={submit} disabled={busy || !form.full_name?.trim()} className="w-full mt-3">{busy ? <Spinner size={16} /> : 'حفظ العميل'}</Button>
    </Card>
  );
}

function ImportLeadsForm({ workspaceId, onDone }: { workspaceId: string; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) { setError('لم يتم العثور على بيانات صالحة في الملف. تأكد من وجود صف عناوين (full_name, phone, email, ...).'); return; }
      const summary = await importLeads(workspaceId, rows, 'csv', file.name);
      onDone(`تم الاستيراد: ${summary.accepted} مقبول، ${summary.duplicates} مكرر، ${summary.rejected} مرفوض من أصل ${summary.totalFound}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر استيراد الملف.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4">
      {error && <div className="mb-3"><ErrorBanner message={error} /></div>}
      <p className="text-ink-500 text-xs mb-3 leading-6">ملف CSV بصف عناوين في أول سطر: full_name, phone, email, occupation, governorate, city ...</p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFile(file); }}
        disabled={busy}
        className="w-full text-sm text-ink-300 file:ml-3 file:rounded-lg file:border-0 file:bg-brand-500 file:text-ink-950 file:px-3 file:py-2 file:text-sm file:font-semibold"
      />
      {busy && <div className="flex items-center gap-2 mt-3 text-ink-400 text-xs"><Spinner size={14} /> جارٍ الاستيراد...</div>}
    </Card>
  );
}

function LeadRow({
  lead, workspaceId, tags, selected, expanded, onToggleSelect, onToggleExpand, onChanged, onTagsChanged,
}: {
  lead: Lead; workspaceId: string; tags: LeadTag[]; selected: boolean; expanded: boolean;
  onToggleSelect: () => void; onToggleExpand: () => void; onChanged: () => void; onTagsChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notesDraft, setNotesDraft] = useState(lead.notes ?? '');
  const [newTag, setNewTag] = useState('');

  async function changeStatus(status: Lead['status']) {
    setBusy(true);
    try { await updateLeadStatus(workspaceId, lead.id, status); onChanged(); } finally { setBusy(false); }
  }

  async function saveNotes() {
    setBusy(true);
    try { await updateLead(workspaceId, lead.id, { notes: notesDraft }); onChanged(); } finally { setBusy(false); }
  }

  async function handleSuppress() {
    setBusy(true);
    try { await suppressLead(workspaceId, lead.id, 'إيقاف تواصل يدوي من فريق المبيعات.'); onChanged(); } finally { setBusy(false); }
  }

  async function handleUnsuppress() {
    setBusy(true);
    try { await unsuppressLead(workspaceId, lead.id); onChanged(); } finally { setBusy(false); }
  }

  async function handleAddTag() {
    if (!newTag.trim()) return;
    setBusy(true);
    try { await addLeadTag(workspaceId, lead.id, newTag.trim()); setNewTag(''); onTagsChanged(); onChanged(); } finally { setBusy(false); }
  }

  return (
    <Card>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1.5 shrink-0" />
        <div className="flex-1 cursor-pointer" onClick={onToggleExpand}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-ink-100 font-semibold">{lead.full_name || 'اسم غير معروف'}</h3>
              <p className="text-ink-400 text-sm mt-0.5">{lead.job_title || lead.occupation || 'المهنة غير معروفة'}</p>
              <p className="text-ink-500 text-xs mt-0.5">{[lead.city, lead.governorate].filter(Boolean).join(' – ') || 'الموقع غير معروف'}</p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge color="brand">{lead.lead_score ?? '—'}</Badge>
              <Badge color={lead.do_not_contact ? 'danger' : 'neutral'}>{STATUS_LABELS[lead.status]}</Badge>
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-ink-800 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="text-ink-500">الهاتف: <span className="text-ink-200" dir="ltr">{lead.business_phone || lead.public_contact_phone || '—'}</span></div>
            <div className="text-ink-500">البريد: <span className="text-ink-200" dir="ltr">{lead.business_email || lead.public_email || '—'}</span></div>
            <div className="text-ink-500">جودة البيانات: <span className="text-ink-200">{lead.data_quality_score ?? '—'}</span></div>
            <div className="text-ink-500">آخر تحديث: <span className="text-ink-200">{freshnessLabel(lead.last_verified_at)}</span></div>
          </div>

          <Select value={lead.status} onChange={(v) => changeStatus(v as Lead['status'])}
            options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))} />

          <div>
            <p className="text-ink-500 text-xs mb-1.5">ملاحظات</p>
            <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} dir="rtl" rows={2}
              className="w-full resize-none rounded-xl bg-ink-900 border border-ink-700 px-3 py-2 text-sm text-ink-100 focus:outline-none focus:border-brand-500" />
            <Button size="sm" variant="secondary" onClick={saveNotes} disabled={busy} className="mt-2">حفظ الملاحظة</Button>
          </div>

          <div>
            <p className="text-ink-500 text-xs mb-1.5 flex items-center gap-1"><Tag size={12} /> وسوم</p>
            <div className="flex gap-2">
              <Input value={newTag} onChange={setNewTag} placeholder="اسم الوسم" />
              <Button size="sm" onClick={handleAddTag} disabled={busy || !newTag.trim()}>إضافة</Button>
            </div>
            {tags.length > 0 && <div className="flex flex-wrap gap-1.5 mt-2">{tags.map((t) => <button key={t.id} onClick={() => setNewTag(t.name)} className="text-xs px-2 py-1 rounded-full bg-ink-800 text-ink-300">{t.name}</button>)}</div>}
          </div>

          <div className="flex gap-2">
            {lead.do_not_contact
              ? <Button size="sm" variant="secondary" onClick={handleUnsuppress} disabled={busy} className="flex-1">إلغاء الإيقاف</Button>
              : <Button size="sm" variant="danger" onClick={handleSuppress} disabled={busy} className="flex-1"><Ban size={14} /> إيقاف التواصل</Button>}
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Campaigns tab
// ---------------------------------------------------------------------------

function CampaignsTab({ workspaceId }: { workspaceId: string }) {
  const [campaigns, setCampaigns] = useState<LeadCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCampaign, setActiveCampaign] = useState<LeadCampaign | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try { setCampaigns(await listCampaigns(workspaceId)); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل الحملات.'); } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [workspaceId]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setBusy(true);
    try { await createCampaign(workspaceId, { name: newName.trim() }); setNewName(''); setShowCreate(false); refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر إنشاء الحملة.'); } finally { setBusy(false); }
  }

  if (activeCampaign) return <CampaignDetail workspaceId={workspaceId} campaign={activeCampaign} onBack={() => { setActiveCampaign(null); refresh(); }} />;

  return (
    <div>
      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
      <Button onClick={() => setShowCreate((v) => !v)} className="w-full mb-4"><Plus size={15} /> حملة جديدة</Button>
      {showCreate && (
        <Card className="mb-4">
          <Input value={newName} onChange={setNewName} placeholder="اسم الحملة" />
          <Button onClick={handleCreate} disabled={busy || !newName.trim()} className="w-full mt-3">{busy ? <Spinner size={16} /> : 'إنشاء'}</Button>
        </Card>
      )}
      {loading ? <ScreenLoader /> : campaigns.length === 0 ? (
        <EmptyState icon={<Megaphone size={25} />} title="لا توجد حملات بعد" subtitle="أنشئ حملة وأضف إليها عملاء من قائمة كل العملاء." />
      ) : (
        <div className="flex flex-col gap-3">
          {campaigns.map((c) => (
            <Card key={c.id} onClick={() => setActiveCampaign(c)}>
              <div className="flex items-center justify-between">
                <div><h3 className="text-ink-100 font-semibold">{c.name}</h3><p className="text-ink-500 text-xs mt-1">{c.member_count ?? 0} عميل</p></div>
                <Badge color="brand">{c.status}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CampaignDetail({ workspaceId, campaign, onBack }: { workspaceId: string; campaign: LeadCampaign; onBack: () => void }) {
  const [members, setMembers] = useState<LeadCampaignMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportBusy, setExportBusy] = useState<LeadExportFormat | null>(null);

  async function refresh() {
    setLoading(true);
    try { setMembers(await listCampaignMembers(workspaceId, campaign.id)); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر تحميل عملاء الحملة.'); } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [campaign.id]);

  async function handleExport(format: LeadExportFormat) {
    const ids = members.map((m) => m.lead_id);
    if (ids.length === 0) return;
    setExportBusy(format);
    try {
      const result = await exportLeads(workspaceId, { kind: 'selected', leadIds: ids }, format, { campaignId: campaign.id });
      await downloadExport(result.rows, format, campaign.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر التصدير.');
    } finally {
      setExportBusy(null);
    }
  }

  return (
    <div>
      <button onClick={onBack} className="text-ink-400 text-sm mb-3 flex items-center gap-1"><ArrowRight size={14} /> رجوع للحملات</button>
      <h2 className="text-ink-100 font-semibold mb-3">{campaign.name}</h2>
      {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
      <div className="flex gap-2 mb-4 flex-wrap">
        <Button size="sm" variant="secondary" onClick={() => handleExport('csv')} disabled={exportBusy !== null}>{exportBusy === 'csv' ? <Spinner size={13} /> : <Download size={14} />} CSV</Button>
        <Button size="sm" variant="secondary" onClick={() => handleExport('xlsx')} disabled={exportBusy !== null}>{exportBusy === 'xlsx' ? <Spinner size={13} /> : <Download size={14} />} Excel</Button>
        <Button size="sm" variant="secondary" onClick={() => handleExport('pdf')} disabled={exportBusy !== null}>{exportBusy === 'pdf' ? <Spinner size={13} /> : <Download size={14} />} PDF</Button>
      </div>
      {loading ? <ScreenLoader /> : members.length === 0 ? (
        <EmptyState icon={<Users size={25} />} title="لا يوجد عملاء في هذه الحملة" subtitle="أضف عملاء من شاشة كل العملاء." />
      ) : (
        <div className="flex flex-col gap-3">
          {members.map((m) => (
            <Card key={m.id}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-ink-100 font-semibold">{m.lead?.full_name ?? 'عميل'}</h3>
                  <p className="text-ink-500 text-xs mt-1">{m.lead?.job_title || m.lead?.occupation || ''}</p>
                </div>
                <Select value={m.status} onChange={(v) => updateCampaignMemberStatus(workspaceId, campaign.id, m.lead_id, v as LeadCampaignMember['status']).then(refresh)}
                  options={[
                    { value: 'pending', label: 'قيد الانتظار' }, { value: 'contacted', label: 'تم التواصل' },
                    { value: 'qualified', label: 'مؤهّل' }, { value: 'converted', label: 'محوّل' }, { value: 'excluded', label: 'مستبعد' },
                  ]} className="w-32" />
              </div>
              <Button size="sm" variant="ghost" onClick={() => removeLeadFromCampaign(workspaceId, campaign.id, m.lead_id).then(refresh)} className="mt-2">إزالة من الحملة</Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
