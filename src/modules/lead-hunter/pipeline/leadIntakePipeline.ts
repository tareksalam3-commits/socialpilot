/**
 * Lead Intake Pipeline
 * ====================
 *
 * INPUT → NORMALIZE → VALIDATE → DEDUPLICATE → DATA QUALITY → SCORE → (caller saves)
 *
 * This module is the single, shared entry point for getting ANY lead into
 * Lead Hunter, regardless of where it came from. It intentionally does not
 * touch the database itself — DB access (looking up duplicate candidates,
 * and the actual insert/update into `leads`/`lead_contacts`) is injected by
 * the caller via `LeadIntakeDependencies`. That keeps this module pure and
 * unit-testable, and — critically — reusable by anything that produces
 * `RawLeadInput[]` in the future.
 *
 * Today the only producers are: manual entry, CSV/Excel import, API import,
 * existing-CRM import, and test records used during development.
 *
 * THE EXTERNAL SEARCH ENGINE IS INTENTIONALLY NOT IMPLEMENTED HERE.
 * When it is built (separate task), it only needs to produce
 * `RawLeadInput[]` + `LeadIntakeMeta` and call `processLeadIntake` /
 * `processLeadIntakeBatch` exactly like every other source does today —
 * see "Future Search Contract" at the bottom of this file.
 *
 * No field in this pipeline is ever invented. Anything the source didn't
 * provide stays `null`.
 */

import type { Lead, LeadPriority } from '../types';
import { EGYPT_GOVERNORATES, toAsciiDigits, normalizeEgyptianPhone, dataQualityAssessment, scoreLeadIntake } from '../utils/scoring';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Where a lead entering the pipeline came from. */
export type LeadIntakeSourceType =
  | 'manual'
  | 'csv'
  | 'excel'
  | 'api'
  | 'existing_crm'
  | 'test'
  | 'search_engine'; // reserved for the future connector — unused today

export interface LeadIntakeMeta {
  sourceType: LeadIntakeSourceType;
  /** FK into lead_sources, when the record came through a configured source. */
  sourceId?: string | null;
  sourceUrl?: string | null;
  /** ISO timestamp; defaults to "now" if omitted. */
  collectedAt?: string | null;
}

/**
 * Loose, source-agnostic shape. A CSV row, an Excel row, a manual form, or a
 * future search-engine result all map into this before anything else runs.
 */
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
  tags?: string[] | null;
}

export type NormalizedLead = Partial<Lead> & { full_name: string | null };

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

export type DuplicateMatchType =
  | 'business_phone'
  | 'public_contact_phone'
  | 'business_email'
  | 'public_email'
  | 'professional_url'
  | 'social_url'
  | 'fuzzy_name_location';

export interface DuplicateMatch {
  leadId: string;
  matchType: DuplicateMatchType;
  confidence: 'confirmed' | 'probable' | 'possible';
}

export interface LeadIntakeAcceptedResult {
  status: 'accepted';
  lead: NormalizedLead;
  dataQuality: { score: number; reasons: string[] };
  score: { score: number; priority: LeadPriority; reasons: string[] };
}

export interface LeadIntakeDuplicateResult {
  status: 'duplicate';
  /** Normalized version of the incoming record, for merging into the existing lead. */
  lead: NormalizedLead;
  duplicate: DuplicateMatch;
}

export interface LeadIntakeRejectedResult {
  status: 'rejected';
  raw: RawLeadInput;
  errors: string[];
}

export type LeadIntakeResult = LeadIntakeAcceptedResult | LeadIntakeDuplicateResult | LeadIntakeRejectedResult;

export interface LeadIntakeDependencies {
  /**
   * Caller-supplied DB lookup: given a normalized candidate, return existing
   * leads in the same workspace that could plausibly be the same person.
   * Callers should pre-filter server-side by phone/email/urls OR by
   * governorate/city (for the fuzzy-name pass) to keep this cheap — this
   * pipeline does the actual matching, not the fetching.
   */
  findDuplicateCandidates: (normalized: NormalizedLead) => Promise<DuplicateCandidate[]>;
}

export interface LeadIntakeBatchSummary {
  totalFound: number;
  accepted: LeadIntakeAcceptedResult[];
  duplicates: LeadIntakeDuplicateResult[];
  rejected: LeadIntakeRejectedResult[];
}

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function cleanOrNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const collapsed = collapseSpaces(value);
  return collapsed.length > 0 ? collapsed : null;
}

function normalizeName(raw: RawLeadInput): { full_name: string | null; first_name: string | null; last_name: string | null } {
  const full = cleanOrNull(raw.full_name);
  let first = cleanOrNull(raw.first_name);
  let last = cleanOrNull(raw.last_name);
  if (!first && !last && full) {
    const parts = full.split(' ');
    if (parts.length >= 2) {
      first = parts[0];
      last = parts.slice(1).join(' ');
    } else {
      first = full;
    }
  }
  const full_name = full ?? [first, last].filter(Boolean).join(' ').trim() ?? null;
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

/** Egypt uses the project's canonical +20 format; other countries get a light E.164-style check only — nothing is invented. */
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

function normalizeLocation(raw: RawLeadInput): { country: string | null; governorate: string | null; city: string | null; district: string | null } {
  const rawCountry = cleanOrNull(raw.country);
  const country = rawCountry && /^(مصر|egypt)$/i.test(rawCountry) ? 'مصر' : rawCountry;
  let governorate = cleanOrNull(raw.governorate);
  if (governorate) {
    const strip = (v: string) => v.replace(/^ال/, '');
    const match = EGYPT_GOVERNORATES.find((g) => g === governorate || strip(g) === strip(governorate!));
    if (match) governorate = match;
  }
  return { country, governorate, city: cleanOrNull(raw.city), district: cleanOrNull(raw.district) };
}

/**
 * Step 1 — NORMALIZE. Pure transform, no rejection here (validation is a
 * separate, explicit step so callers can see exactly why a record failed).
 */
export function normalizeLead(raw: RawLeadInput, meta: LeadIntakeMeta): {
  normalized: NormalizedLead;
  formatIssues: { businessPhone: boolean; publicPhone: boolean; businessEmail: boolean; publicEmail: boolean };
} {
  const name = normalizeName(raw);
  const location = normalizeLocation(raw);
  const businessEmail = normalizeEmail(raw.business_email);
  const publicEmail = normalizeEmail(raw.public_email);
  const businessPhone = normalizePhone(raw.business_phone, location.country);
  const publicPhone = normalizePhone(raw.public_contact_phone, location.country);

  const normalized: NormalizedLead = {
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

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/** Step 2 — VALIDATE. Every rejection carries a human-readable reason (Arabic, matches the rest of the product). */
export function validateLead(
  normalized: NormalizedLead,
  formatIssues: { businessPhone: boolean; publicPhone: boolean; businessEmail: boolean; publicEmail: boolean },
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!normalized.full_name) errors.push('الاسم مطلوب.');
  if (formatIssues.businessPhone) errors.push('رقم الهاتف الرسمي غير صالح.');
  if (formatIssues.publicPhone) errors.push('رقم الهاتف العام غير صالح.');
  if (formatIssues.businessEmail) errors.push('البريد الإلكتروني الرسمي غير صالح.');
  if (formatIssues.publicEmail) errors.push('البريد الإلكتروني العام غير صالح.');
  if (normalized.age !== null && normalized.age !== undefined && (normalized.age < 0 || normalized.age > 130)) {
    errors.push('العمر خارج النطاق المسموح به.');
  }
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
      dp[i * cols + j] = Math.min(
        dp[(i - 1) * cols + j] + 1,
        dp[i * cols + (j - 1)] + 1,
        dp[(i - 1) * cols + (j - 1)] + cost,
      );
    }
  }
  return dp[rows * cols - 1];
}

function nameSimilarity(a: string, b: string): number {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return 0;
  if (x === y) return 1;
  const distance = levenshtein(x, y);
  return 1 - distance / Math.max(x.length, y.length);
}

const FUZZY_PROBABLE_THRESHOLD = 0.92;
const FUZZY_POSSIBLE_THRESHOLD = 0.85;

/**
 * Step 3 — DEDUPLICATE. Priority: phone → email → professional_url →
 * social_url → fuzzy name+location. Pure comparison over a candidate list
 * the caller already fetched from the DB (see LeadIntakeDependencies).
 */
export function findDuplicateMatch(candidate: NormalizedLead, existing: DuplicateCandidate[]): DuplicateMatch | null {
  const eq = (a: string | null, b: string | null) => Boolean(a && b && a === b);
  const eqLoose = (a: string | null, b: string | null) => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

  for (const c of existing) {
    if (eq(candidate.business_phone ?? null, c.business_phone)) return { leadId: c.id, matchType: 'business_phone', confidence: 'confirmed' };
    if (eq(candidate.public_contact_phone ?? null, c.public_contact_phone)) return { leadId: c.id, matchType: 'public_contact_phone', confidence: 'confirmed' };
    if (eq(candidate.business_phone ?? null, c.public_contact_phone)) return { leadId: c.id, matchType: 'public_contact_phone', confidence: 'confirmed' };
    if (eq(candidate.public_contact_phone ?? null, c.business_phone)) return { leadId: c.id, matchType: 'business_phone', confidence: 'confirmed' };
  }
  for (const c of existing) {
    if (eq(candidate.business_email ?? null, c.business_email)) return { leadId: c.id, matchType: 'business_email', confidence: 'confirmed' };
    if (eq(candidate.public_email ?? null, c.public_email)) return { leadId: c.id, matchType: 'public_email', confidence: 'confirmed' };
    if (eq(candidate.business_email ?? null, c.public_email)) return { leadId: c.id, matchType: 'public_email', confidence: 'confirmed' };
    if (eq(candidate.public_email ?? null, c.business_email)) return { leadId: c.id, matchType: 'business_email', confidence: 'confirmed' };
  }
  for (const c of existing) {
    if (eqLoose(candidate.professional_url ?? null, c.professional_url)) return { leadId: c.id, matchType: 'professional_url', confidence: 'confirmed' };
  }
  for (const c of existing) {
    if (eqLoose(candidate.social_url ?? null, c.social_url)) return { leadId: c.id, matchType: 'social_url', confidence: 'confirmed' };
  }
  if (candidate.full_name) {
    for (const c of existing) {
      if (!c.full_name) continue;
      const sameLocation =
        eqLoose(candidate.governorate ?? null, c.governorate) || eqLoose(candidate.city ?? null, c.city);
      if (!sameLocation) continue;
      const similarity = nameSimilarity(candidate.full_name, c.full_name);
      if (similarity >= FUZZY_PROBABLE_THRESHOLD) return { leadId: c.id, matchType: 'fuzzy_name_location', confidence: 'probable' };
      if (similarity >= FUZZY_POSSIBLE_THRESHOLD) return { leadId: c.id, matchType: 'fuzzy_name_location', confidence: 'possible' };
    }
  }
  return null;
}

/**
 * When a duplicate is found, fill in only what the existing lead is
 * missing — never overwrite an existing non-empty value with a different
 * incoming one. This is "update useful data" (#6 in the brief), not a
 * blind overwrite.
 */
export function mergeLeadUpdates(existing: Partial<Lead>, incoming: NormalizedLead): Partial<Lead> {
  const fields: Array<keyof Lead> = [
    'first_name', 'last_name', 'full_name', 'age', 'gender', 'occupation', 'job_title',
    'industry', 'employer', 'country', 'governorate', 'city', 'district',
    'business_phone', 'public_contact_phone', 'business_email', 'public_email',
    'professional_url', 'social_url', 'notes',
  ];
  const merged: Partial<Lead> = {};
  for (const field of fields) {
    const existingValue = existing[field];
    const incomingValue = (incoming as Record<string, unknown>)[field];
    const existingEmpty = existingValue === null || existingValue === undefined || existingValue === '';
    if (existingEmpty && incomingValue !== null && incomingValue !== undefined && incomingValue !== '') {
      (merged as Record<string, unknown>)[field] = incomingValue;
    }
  }
  if (incoming.collected_at) merged.last_verified_at = incoming.collected_at;
  return merged;
}

// ---------------------------------------------------------------------------
// Orchestration — DATA QUALITY + SCORE happen after a record clears
// validation and dedup; SAVE is left entirely to the caller.
// ---------------------------------------------------------------------------

/** Runs one raw record through the full INPUT→NORMALIZE→VALIDATE→DEDUPLICATE→QUALITY→SCORE pipeline. */
export async function processLeadIntake(
  raw: RawLeadInput,
  meta: LeadIntakeMeta,
  deps: LeadIntakeDependencies,
): Promise<LeadIntakeResult> {
  const { normalized, formatIssues } = normalizeLead(raw, meta);
  const validation = validateLead(normalized, formatIssues);
  if (!validation.valid) {
    return { status: 'rejected', raw, errors: validation.errors };
  }

  const candidates = await deps.findDuplicateCandidates(normalized);
  const duplicate = findDuplicateMatch(normalized, candidates);
  if (duplicate) {
    return { status: 'duplicate', lead: normalized, duplicate };
  }

  const dataQuality = dataQualityAssessment(normalized);
  const leadWithQuality: NormalizedLead = { ...normalized, data_quality_score: dataQuality.score };
  const score = scoreLeadIntake(leadWithQuality);

  return { status: 'accepted', lead: { ...leadWithQuality, lead_score: score.score }, dataQuality, score };
}

/** Convenience wrapper for CSV/Excel/API/CRM batch imports — same guarantees, one record at a time, in order. */
export async function processLeadIntakeBatch(
  rows: RawLeadInput[],
  meta: LeadIntakeMeta,
  deps: LeadIntakeDependencies,
): Promise<LeadIntakeBatchSummary> {
  const accepted: LeadIntakeAcceptedResult[] = [];
  const duplicates: LeadIntakeDuplicateResult[] = [];
  const rejected: LeadIntakeRejectedResult[] = [];

  for (const row of rows) {
    const result = await processLeadIntake(row, meta, deps);
    if (result.status === 'accepted') accepted.push(result);
    else if (result.status === 'duplicate') duplicates.push(result);
    else rejected.push(result);
  }

  return { totalFound: rows.length, accepted, duplicates, rejected };
}

// ---------------------------------------------------------------------------
// Future Search Contract (do not implement the connector here)
// ---------------------------------------------------------------------------
//
// When the external Search Engine ships, it plugs in exactly like this:
//
//   const rawLeads: RawLeadInput[] = searchEngineResults.map(toRawLeadInput);
//   const summary = await processLeadIntakeBatch(
//     rawLeads,
//     { sourceType: 'search_engine', sourceId: source.id, sourceUrl: result.url },
//     { findDuplicateCandidates: fetchCandidatesFromSupabase },
//   );
//
// No changes to this file, to `leads`, or to Lead Hunter's UI are required
// for that connector to work — it only needs to produce RawLeadInput[].
