/**
 * Lead Intake Pipeline (Edge Function mirror)
 * ============================================
 * MIRRORS: src/modules/lead-hunter/pipeline/leadIntakePipeline.ts
 * and src/modules/lead-hunter/utils/scoring.ts
 *
 * Supabase Edge Functions are deployed one self-contained directory at a
 * time, so this Deno-side copy cannot import the React app's src/ modules
 * directly. The logic here MUST stay identical to the client mirror —
 * if you change normalization/validation/dedup/scoring rules, change both
 * files in the same commit.
 *
 * INPUT → NORMALIZE → VALIDATE → DEDUPLICATE → DATA QUALITY → SCORE
 * SAVE is done by the caller (index.ts) using a real Supabase client, since
 * this file has no DB access of its own — duplicate candidates are passed
 * in already fetched.
 */

export const EGYPT_GOVERNORATES = [
  'القاهرة', 'الجيزة', 'الإسكندرية', 'الدقهلية', 'البحر الأحمر', 'البحيرة', 'الفيوم',
  'الغربية', 'الإسماعيلية', 'المنوفية', 'المنيا', 'القليوبية', 'الوادي الجديد',
  'السويس', 'أسوان', 'أسيوط', 'بني سويف', 'بورسعيد', 'دمياط', 'شرم الشيخ',
  'سوهاج', 'شمال سيناء', 'قنا', 'كفر الشيخ', 'مطروح', 'الأقصر', 'جنوب سيناء',
];

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const EASTERN_ARABIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function toAsciiDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(EASTERN_ARABIC_DIGITS.indexOf(digit)));
}

export function normalizeEgyptianPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = toAsciiDigits(value).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0020')) return `+${digits.slice(2)}`;
  if (digits.startsWith('20') && digits.length === 12) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+20${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('1')) return `+20${digits}`;
  return null;
}

export type LeadRecord = Record<string, unknown>;

const DATA_QUALITY_FACTORS: Array<{ weight: number; present: (lead: LeadRecord) => boolean; labelPresent: string; labelMissing: string }> = [
  { weight: 15, present: (l) => Boolean(l.full_name || l.first_name), labelPresent: 'الاسم متوفر', labelMissing: 'الاسم غير متوفر' },
  { weight: 15, present: (l) => Boolean(l.country || l.governorate || l.city), labelPresent: 'بيانات الموقع متوفرة', labelMissing: 'بيانات الموقع ناقصة' },
  { weight: 10, present: (l) => Boolean(l.occupation || l.job_title || l.industry), labelPresent: 'المهنة أو الوظيفة متوفرة', labelMissing: 'المهنة أو الوظيفة غير متوفرة' },
  { weight: 20, present: (l) => Boolean(l.business_phone || l.public_contact_phone), labelPresent: 'يوجد رقم هاتف', labelMissing: 'لا يوجد رقم هاتف' },
  { weight: 10, present: (l) => Boolean(l.business_email || l.public_email), labelPresent: 'يوجد بريد إلكتروني', labelMissing: 'لا يوجد بريد إلكتروني' },
  { weight: 10, present: (l) => Boolean(l.source_url || l.professional_url || l.social_url), labelPresent: 'المصدر موثّق برابط', labelMissing: 'لا يوجد رابط مصدر موثّق' },
  { weight: 10, present: (l) => Boolean(l.last_verified_at), labelPresent: 'تم التحقق من البيانات', labelMissing: 'لم يتم التحقق من البيانات بعد' },
  {
    weight: 10,
    present: (l) => {
      const at = (l.last_verified_at || l.collected_at) as string | undefined;
      if (!at) return false;
      return Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000) <= 90;
    },
    labelPresent: 'البيانات حديثة (خلال 90 يومًا)',
    labelMissing: 'البيانات قديمة أو غير مؤرّخة',
  },
];

export function dataQualityAssessment(lead: LeadRecord): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  for (const factor of DATA_QUALITY_FACTORS) {
    const present = factor.present(lead);
    if (present) score += factor.weight;
    reasons.push(present ? factor.labelPresent : factor.labelMissing);
  }
  return { score: Math.min(100, score), reasons };
}

export type LeadPriority = 'top' | 'high' | 'suitable' | 'low' | 'weak';

export function leadPriority(score: number): LeadPriority {
  if (score >= 90) return 'top';
  if (score >= 75) return 'high';
  if (score >= 60) return 'suitable';
  if (score >= 40) return 'low';
  return 'weak';
}

export type LeadScoringContext = { ageMatch?: boolean | null; evidenceStrength?: number | null };

export function scoreLeadIntake(lead: LeadRecord, context: LeadScoringContext = {}): { score: number; priority: LeadPriority; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (lead.governorate || lead.city) { score += 20; reasons.push('بيانات الموقع متوفرة'); }
  if (lead.occupation || lead.job_title) { score += 20; reasons.push('المهنة أو الوظيفة متوفرة'); }
  if (context.ageMatch === true) { score += 5; reasons.push('العمر يطابق النطاق المطلوب'); }
  if (context.ageMatch === false) reasons.push('العمر خارج النطاق أو غير مطابق');
  if (lead.business_phone || lead.public_contact_phone || lead.business_email || lead.public_email) { score += 25; reasons.push('توجد وسيلة تواصل فعلية'); }
  if (Number(context.evidenceStrength ?? 0) >= 75) { score += 5; reasons.push('Evidence متعددة وقوية'); }
  else if (Number(context.evidenceStrength ?? 0) > 0) reasons.push('Evidence موجودة لكنها محدودة');
  const quality = (lead.data_quality_score as number | undefined) ?? dataQualityAssessment(lead).score;
  const qualityContribution = Math.round((quality / 100) * 20);
  if (qualityContribution > 0) { score += qualityContribution; reasons.push('جودة البيانات تدعم الدرجة'); }
  const freshAt = (lead.last_verified_at || lead.collected_at) as string | undefined;
  if (freshAt) {
    const ageDays = Math.floor((Date.now() - new Date(freshAt).getTime()) / 86_400_000);
    if (ageDays <= 30) { score += 15; reasons.push('بيانات حديثة (خلال 30 يومًا)'); }
    else if (ageDays <= 180) { score += 8; reasons.push('بيانات متوسطة الحداثة'); }
  }
  const capped = Math.min(100, score);
  return { score: capped, priority: leadPriority(capped), reasons };
}

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

export type LeadIntakeSourceType = 'manual' | 'csv' | 'excel' | 'api' | 'existing_crm' | 'test' | 'search_engine';

export interface LeadIntakeMeta {
  sourceType: LeadIntakeSourceType;
  sourceId?: string | null;
  sourceUrl?: string | null;
  collectedAt?: string | null;
}

export interface RawLeadInput {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  age?: number | string | null;
  gender?: string | null;
  occupation?: string | null;
  job_title?: string | null;
  industry?: string | null;
  employer?: string | null;
  country?: string | null;
  governorate?: string | null;
  city?: string | null;
  district?: string | null;
  business_phone?: string | null;
  public_contact_phone?: string | null;
  business_email?: string | null;
  public_email?: string | null;
  professional_url?: string | null;
  social_url?: string | null;
  notes?: string | null;
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const collapsed = collapseSpaces(value);
  return collapsed.length > 0 ? collapsed : null;
}

function normalizeName(raw: RawLeadInput) {
  const full = cleanOrNull(raw.full_name);
  let first = cleanOrNull(raw.first_name);
  let last = cleanOrNull(raw.last_name);
  if (!first && !last && full) {
    const parts = full.split(' ');
    if (parts.length >= 2) { first = parts[0]; last = parts.slice(1).join(' '); } else { first = full; }
  }
  const full_name = full ?? ([first, last].filter(Boolean).join(' ').trim() || null);
  return { full_name: full_name || null, first_name: first, last_name: last };
}

function normalizeAge(raw: RawLeadInput['age']): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const numeric = typeof raw === 'number' ? raw : Number.parseInt(toAsciiDigits(String(raw)).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(numeric) ? numeric : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw: string | null | undefined): { value: string | null; valid: boolean } {
  const trimmed = raw ? raw.trim().toLowerCase() : '';
  if (!trimmed) return { value: null, valid: true };
  return { value: trimmed, valid: EMAIL_RE.test(trimmed) };
}

function normalizePhone(raw: string | null | undefined, country: string | null): { value: string | null; valid: boolean } {
  if (!raw || !raw.trim()) return { value: null, valid: true };
  const isEgypt = !country || /^(مصر|egypt)$/i.test(country);
  if (isEgypt) {
    const egyptian = normalizeEgyptianPhone(raw);
    if (egyptian) return { value: egyptian, valid: true };
  }
  const digitsOnly = toAsciiDigits(raw).replace(/[^\d+]/g, '');
  const digitCount = digitsOnly.replace(/\D/g, '').length;
  if (digitCount < 8 || digitCount > 15) return { value: raw.trim(), valid: false };
  const value = digitsOnly.startsWith('+') ? digitsOnly : `+${digitsOnly}`;
  return { value, valid: true };
}

function normalizeLocation(raw: RawLeadInput) {
  const rawCountry = cleanOrNull(raw.country);
  const country = rawCountry && /^(مصر|egypt)$/i.test(rawCountry) ? 'مصر' : rawCountry;
  let governorate = cleanOrNull(raw.governorate);
  if (governorate) {
    const strip = (v: string) => v.replace(/^ال/, '');
    const match = EGYPT_GOVERNORATES.find((g) => g === governorate || strip(g) === strip(governorate as string));
    if (match) governorate = match;
  }
  return { country, governorate, city: cleanOrNull(raw.city), district: cleanOrNull(raw.district) };
}

export function normalizeLead(raw: RawLeadInput, meta: LeadIntakeMeta): { normalized: LeadRecord; formatIssues: { businessPhone: boolean; publicPhone: boolean; businessEmail: boolean; publicEmail: boolean } } {
  const name = normalizeName(raw);
  const location = normalizeLocation(raw);
  const businessEmail = normalizeEmail(raw.business_email);
  const publicEmail = normalizeEmail(raw.public_email);
  const businessPhone = normalizePhone(raw.business_phone, location.country);
  const publicPhone = normalizePhone(raw.public_contact_phone, location.country);

  const normalized: LeadRecord = {
    full_name: name.full_name,
    first_name: name.first_name,
    last_name: name.last_name,
    age: normalizeAge(raw.age),
    gender: cleanOrNull(raw.gender),
    occupation: cleanOrNull(raw.occupation),
    job_title: cleanOrNull(raw.job_title),
    industry: cleanOrNull(raw.industry),
    employer: cleanOrNull(raw.employer),
    country: location.country,
    governorate: location.governorate,
    city: location.city,
    district: location.district,
    business_phone: businessPhone.value,
    public_contact_phone: publicPhone.value,
    business_email: businessEmail.value,
    public_email: publicEmail.value,
    professional_url: cleanOrNull(raw.professional_url),
    social_url: cleanOrNull(raw.social_url),
    notes: cleanOrNull(raw.notes ?? null),
    source_id: meta.sourceId ?? null,
    source_url: meta.sourceUrl ?? cleanOrNull(raw.professional_url),
    source_type: meta.sourceType,
    collected_at: meta.collectedAt ?? new Date().toISOString(),
  };

  return {
    normalized,
    formatIssues: {
      businessPhone: !businessPhone.valid,
      publicPhone: !publicPhone.valid,
      businessEmail: !businessEmail.valid,
      publicEmail: !publicEmail.valid,
    },
  };
}

export function validateLead(normalized: LeadRecord, formatIssues: { businessPhone: boolean; publicPhone: boolean; businessEmail: boolean; publicEmail: boolean }): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!normalized.full_name) errors.push('الاسم مطلوب.');
  if (formatIssues.businessPhone) errors.push('رقم الهاتف الرسمي غير صالح.');
  if (formatIssues.publicPhone) errors.push('رقم الهاتف العام غير صالح.');
  if (formatIssues.businessEmail) errors.push('البريد الإلكتروني الرسمي غير صالح.');
  if (formatIssues.publicEmail) errors.push('البريد الإلكتروني العام غير صالح.');
  const age = normalized.age as number | null;
  if (age !== null && age !== undefined && (age < 0 || age > 130)) errors.push('العمر خارج النطاق المسموح به.');
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Deduplicate
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[] = new Array(rows * cols);
  for (let i = 0; i < rows; i++) dp[i * cols] = i;
  for (let j = 0; j < cols; j++) dp[j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i * cols + j] = Math.min(dp[(i - 1) * cols + j] + 1, dp[i * cols + (j - 1)] + 1, dp[(i - 1) * cols + (j - 1)] + cost);
    }
  }
  return dp[rows * cols - 1];
}

function nameSimilarity(a: string, b: string): number {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return 0;
  if (x === y) return 1;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}

export interface DuplicateCandidate {
  id: string;
  full_name: string | null;
  governorate: string | null;
  city: string | null;
  business_phone: string | null;
  public_contact_phone: string | null;
  business_email: string | null;
  public_email: string | null;
  professional_url: string | null;
  social_url: string | null;
}

export type DuplicateMatchType = 'business_phone' | 'public_contact_phone' | 'business_email' | 'public_email' | 'professional_url' | 'social_url' | 'fuzzy_name_location';
export interface DuplicateMatch { leadId: string; matchType: DuplicateMatchType; confidence: 'confirmed' | 'probable' | 'possible'; }

const FUZZY_PROBABLE_THRESHOLD = 0.92;
const FUZZY_POSSIBLE_THRESHOLD = 0.85;

export function findDuplicateMatch(candidate: LeadRecord, existing: DuplicateCandidate[]): DuplicateMatch | null {
  const eq = (a: string | null | undefined, b: string | null) => Boolean(a && b && a === b);
  const eqLoose = (a: string | null | undefined, b: string | null) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
  const bp = candidate.business_phone as string | null;
  const pp = candidate.public_contact_phone as string | null;
  const be = candidate.business_email as string | null;
  const pe = candidate.public_email as string | null;
  const purl = candidate.professional_url as string | null;
  const surl = candidate.social_url as string | null;
  const fname = candidate.full_name as string | null;
  const gov = candidate.governorate as string | null;
  const city = candidate.city as string | null;

  for (const c of existing) {
    if (eq(bp, c.business_phone)) return { leadId: c.id, matchType: 'business_phone', confidence: 'confirmed' };
    if (eq(pp, c.public_contact_phone)) return { leadId: c.id, matchType: 'public_contact_phone', confidence: 'confirmed' };
    if (eq(bp, c.public_contact_phone)) return { leadId: c.id, matchType: 'public_contact_phone', confidence: 'confirmed' };
    if (eq(pp, c.business_phone)) return { leadId: c.id, matchType: 'business_phone', confidence: 'confirmed' };
  }
  for (const c of existing) {
    if (eq(be, c.business_email)) return { leadId: c.id, matchType: 'business_email', confidence: 'confirmed' };
    if (eq(pe, c.public_email)) return { leadId: c.id, matchType: 'public_email', confidence: 'confirmed' };
    if (eq(be, c.public_email)) return { leadId: c.id, matchType: 'public_email', confidence: 'confirmed' };
    if (eq(pe, c.business_email)) return { leadId: c.id, matchType: 'business_email', confidence: 'confirmed' };
  }
  for (const c of existing) { if (eqLoose(purl, c.professional_url)) return { leadId: c.id, matchType: 'professional_url', confidence: 'confirmed' }; }
  for (const c of existing) { if (eqLoose(surl, c.social_url)) return { leadId: c.id, matchType: 'social_url', confidence: 'confirmed' }; }
  if (fname) {
    for (const c of existing) {
      if (!c.full_name) continue;
      const sameLocation = eqLoose(gov, c.governorate) || eqLoose(city, c.city);
      if (!sameLocation) continue;
      const similarity = nameSimilarity(fname, c.full_name);
      if (similarity >= FUZZY_PROBABLE_THRESHOLD) return { leadId: c.id, matchType: 'fuzzy_name_location', confidence: 'probable' };
      if (similarity >= FUZZY_POSSIBLE_THRESHOLD) return { leadId: c.id, matchType: 'fuzzy_name_location', confidence: 'possible' };
    }
  }
  return null;
}

const MERGE_FIELDS = [
  'first_name', 'last_name', 'full_name', 'age', 'gender', 'occupation', 'job_title',
  'industry', 'employer', 'country', 'governorate', 'city', 'district',
  'business_phone', 'public_contact_phone', 'business_email', 'public_email',
  'professional_url', 'social_url', 'notes',
];

export function mergeLeadUpdates(existing: LeadRecord, incoming: LeadRecord): LeadRecord {
  const merged: LeadRecord = {};
  for (const field of MERGE_FIELDS) {
    const existingValue = existing[field];
    const incomingValue = incoming[field];
    const existingEmpty = existingValue === null || existingValue === undefined || existingValue === '';
    if (existingEmpty && incomingValue !== null && incomingValue !== undefined && incomingValue !== '') {
      merged[field] = incomingValue;
    }
  }
  if (incoming.collected_at) merged.last_verified_at = incoming.collected_at;
  return merged;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type LeadIntakeResult =
  | { status: 'rejected'; raw: RawLeadInput; errors: string[] }
  | { status: 'duplicate'; lead: LeadRecord; duplicate: DuplicateMatch }
  | { status: 'accepted'; lead: LeadRecord; dataQuality: { score: number; reasons: string[] }; score: { score: number; priority: LeadPriority; reasons: string[] } };

export async function processLeadIntake(
  raw: RawLeadInput,
  meta: LeadIntakeMeta,
  findDuplicateCandidates: (normalized: LeadRecord) => Promise<DuplicateCandidate[]>,
): Promise<LeadIntakeResult> {
  const { normalized, formatIssues } = normalizeLead(raw, meta);
  const validation = validateLead(normalized, formatIssues);
  if (!validation.valid) return { status: 'rejected', raw, errors: validation.errors };

  const candidates = await findDuplicateCandidates(normalized);
  const duplicate = findDuplicateMatch(normalized, candidates);
  if (duplicate) return { status: 'duplicate', lead: normalized, duplicate };

  const dataQuality = dataQualityAssessment(normalized);
  const leadWithQuality: LeadRecord = { ...normalized, data_quality_score: dataQuality.score };
  const score = scoreLeadIntake(leadWithQuality);
  return { status: 'accepted', lead: { ...leadWithQuality, lead_score: score.score }, dataQuality, score };
}
