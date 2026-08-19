/**
 * Lead Hunter — Export Builders
 * =============================
 *
 * Single source of truth for turning raw `leads` rows (as returned by the
 * `export_leads` action in the `lead-hunter` edge function) into the three
 * downloadable formats: CSV, XLSX (professional, via the existing `xlsx`
 * package — no new dependency), and PDF (via the browser's native
 * print-to-PDF, since generating a real Arabic-shaped PDF client-side would
 * require a new library such as jsPDF/html2canvas that isn't installed).
 *
 * Every column here maps to a REAL field already collected by the pipeline
 * (see `leads` table / Lead type). Nothing is invented. Where the source
 * data has two possible contact fields (business vs public phone/email) we
 * show whichever is actually present — never a fabricated value.
 */

import type { Lead } from '../types';

export type ExportRow = Lead & { do_not_contact?: boolean };

export type ExportColumn = {
  key: string;
  header: string;
  width: number; // characters, used for XLSX column width
  get: (row: ExportRow) => string;
};

const STATUS_LABELS_AR: Record<string, string> = {
  new: 'جديد',
  qualified: 'مؤهّل',
  contacted: 'تم التواصل',
  converted: 'محوّل لعميل',
  suppressed: 'موقوف عن التواصل',
  invalid: 'غير صالح',
  archived: 'مؤرشف',
};

function s(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function primaryPhone(row: ExportRow): string {
  return s(row.business_phone || row.public_contact_phone);
}

function primaryEmail(row: ExportRow): string {
  return s(row.business_email || row.public_email);
}

/** The canonical, ordered column list used by both XLSX and PDF exports. */
export const EXPORT_COLUMNS: ExportColumn[] = [
  { key: 'full_name', header: 'الاسم', width: 22, get: (r) => s(r.full_name) },
  { key: 'phone', header: 'رقم الهاتف', width: 16, get: primaryPhone },
  { key: 'email', header: 'البريد الإلكتروني', width: 22, get: primaryEmail },
  { key: 'governorate', header: 'المحافظة', width: 14, get: (r) => s(r.governorate) },
  { key: 'city', header: 'المدينة', width: 14, get: (r) => s(r.city) },
  { key: 'district', header: 'المنطقة', width: 14, get: (r) => s(r.district) },
  { key: 'occupation', header: 'المهنة', width: 16, get: (r) => s(r.occupation) },
  { key: 'job_title', header: 'الوظيفة', width: 16, get: (r) => s(r.job_title) },
  { key: 'industry', header: 'المجال', width: 16, get: (r) => s(r.industry) },
  { key: 'employer', header: 'جهة العمل', width: 18, get: (r) => s(r.employer) },
  { key: 'source_type', header: 'مصدر البيانات', width: 14, get: (r) => s(r.source_type) },
  { key: 'source_url', header: 'رابط المصدر', width: 24, get: (r) => s(r.source_url) },
  { key: 'collected_at', header: 'تاريخ جمع البيانات', width: 14, get: (r) => formatDate(r.collected_at) },
  { key: 'last_verified_at', header: 'آخر تحقق', width: 14, get: (r) => formatDate(r.last_verified_at) },
  { key: 'data_quality_score', header: 'Data Quality', width: 10, get: (r) => s(r.data_quality_score ?? '') },
  { key: 'lead_score', header: 'Lead Score', width: 10, get: (r) => s(r.lead_score ?? '') },
  { key: 'status', header: 'Lead Status', width: 14, get: (r) => STATUS_LABELS_AR[r.status] ?? s(r.status) },
  { key: 'contact_status', header: 'Contact Status', width: 14, get: (r) => (r.do_not_contact ? 'ممنوع التواصل' : 'متاح للتواصل') },
  { key: 'notes', header: 'ملاحظات', width: 28, get: (r) => s(r.notes) },
];

/** Rows are always sorted by Lead Score (desc) before export, per spec §13. */
export function sortForExport(rows: ExportRow[]): ExportRow[] {
  return [...rows].sort((a, b) => (b.lead_score ?? -1) - (a.lead_score ?? -1));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export function buildCsv(rows: ExportRow[]): string {
  const sorted = sortForExport(rows);
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const header = EXPORT_COLUMNS.map((c) => escape(c.header)).join(',');
  const body = sorted.map((row) => EXPORT_COLUMNS.map((c) => escape(c.get(row))).join(',')).join('\n');
  return [header, body].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// XLSX — professional workbook via the existing `xlsx` package.
// ---------------------------------------------------------------------------

export async function buildWorkbookBlob(rows: ExportRow[]): Promise<Blob> {
  const XLSX = await import('xlsx');
  const sorted = sortForExport(rows);

  const header = EXPORT_COLUMNS.map((c) => c.header);
  const phoneColIndex = EXPORT_COLUMNS.findIndex((c) => c.key === 'phone');
  const aoa: string[][] = [header, ...sorted.map((row) => EXPORT_COLUMNS.map((c) => c.get(row)))];

  const worksheet = XLSX.utils.aoa_to_sheet(aoa);

  // Force the phone column to be read as text (never a number), so leading
  // zeros / "+20..." are preserved exactly as collected — spec §13.
  if (phoneColIndex >= 0) {
    for (let r = 1; r < aoa.length; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: phoneColIndex });
      const cell = worksheet[addr];
      if (cell) cell.t = 's';
    }
  }

  worksheet['!cols'] = EXPORT_COLUMNS.map((c) => ({ wch: c.width }));
  worksheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }) };
  // Freeze the header row so it stays visible while scrolling.
  (worksheet as unknown as { '!freeze': unknown })['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };

  const workbook = XLSX.utils.book_new();
  // Right-to-left workbook view so Arabic content and column order read naturally in Excel.
  (workbook as unknown as { Workbook: { Views: Array<{ RTL: boolean }> } }).Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(workbook, worksheet, 'العملاء المحتملون');

  const arrayBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---------------------------------------------------------------------------
// PDF — printable Arabic/RTL HTML report, generated via the browser's own
// print-to-PDF (the browser's text engine shapes Arabic correctly, which a
// hand-rolled PDF writer or an unavailable font-embedding library cannot
// guarantee). Works the same on desktop and mobile ("Save as PDF").
// ---------------------------------------------------------------------------

export type ExportReportMeta = {
  filterSummary?: string[];
};

function average(values: Array<number | null | undefined>): string {
  const nums = values.filter((v): v is number => typeof v === 'number');
  if (nums.length === 0) return '—';
  return (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1);
}

export function buildPrintableReportHtml(rows: ExportRow[], meta: ExportReportMeta = {}): string {
  const sorted = sortForExport(rows);
  const reportDate = new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  const avgScore = average(sorted.map((r) => r.lead_score));
  const avgQuality = average(sorted.map((r) => r.data_quality_score));
  const filters = meta.filterSummary && meta.filterSummary.length > 0 ? meta.filterSummary.join(' • ') : 'بدون فلاتر (كل النتائج المحددة)';

  const tableCols = ['#', 'الاسم', 'الهاتف', 'المحافظة', 'المدينة', 'المهنة', 'Lead Score', 'Quality', 'Status'];
  const rowsHtml = sorted
    .map((row, index) => {
      const cells = [
        String(index + 1),
        s(row.full_name) || '—',
        primaryPhone(row) || '—',
        s(row.governorate) || '—',
        s(row.city) || '—',
        s(row.job_title || row.occupation) || '—',
        s(row.lead_score ?? '—'),
        s(row.data_quality_score ?? '—'),
        STATUS_LABELS_AR[row.status] ?? s(row.status),
      ];
      return `<tr>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>Lead Hunter — تقرير العملاء المحتملين</title>
<style>
  @page { size: A4; margin: 14mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; color: #111; margin: 0; }
  header.report-header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #0f766e; padding-bottom: 10px; margin-bottom: 14px; }
  header.report-header h1 { font-size: 18px; margin: 0; color: #0f766e; }
  header.report-header .date { font-size: 11px; color: #555; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 16px; }
  .summary .card { border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; text-align: center; }
  .summary .card .label { font-size: 10px; color: #666; }
  .summary .card .value { font-size: 16px; font-weight: 700; margin-top: 2px; }
  .filters { font-size: 11px; color: #444; background: #f5f7f7; border: 1px solid #e2e6e6; border-radius: 6px; padding: 8px 10px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  thead { display: table-header-group; } /* repeat header on every printed page */
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: 5px 6px; text-align: right; }
  th { background: #0f766e; color: #fff; font-weight: 600; }
  tbody tr:nth-child(even) { background: #f7f9f9; }
  footer.report-footer { position: fixed; bottom: 0; left: 0; right: 0; font-size: 9px; color: #888; text-align: center; }
  @media print {
    .no-print { display: none; }
  }
</style>
</head>
<body>
  <header class="report-header">
    <h1>Lead Hunter — تقرير العملاء المحتملين</h1>
    <span class="date">تاريخ التقرير: ${escapeHtml(reportDate)}</span>
  </header>

  <div class="summary">
    <div class="card"><div class="label">عدد النتائج</div><div class="value">${sorted.length}</div></div>
    <div class="card"><div class="label">متوسط Lead Score</div><div class="value">${avgScore}</div></div>
    <div class="card"><div class="label">متوسط Data Quality</div><div class="value">${avgQuality}</div></div>
    <div class="card"><div class="label">تاريخ الإنشاء</div><div class="value">${escapeHtml(reportDate)}</div></div>
  </div>

  <div class="filters"><strong>معايير البحث / الفلترة:</strong> ${escapeHtml(filters)}</div>

  <table>
    <thead><tr>${tableCols.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Opens the printable report in a new tab and triggers the browser's print dialog (Save as PDF). */
export function openPrintableReport(html: string): void {
  const win = window.open('', '_blank');
  if (!win) return; // popup blocked — caller should surface a message
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.onload = () => {
    win.focus();
    win.print();
  };
}
