import type { Lead, LeadPriority, LeadSearchQuery } from '../types';

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

export function freshnessLabel(lastVerifiedAt: string | null): string {
  if (!lastVerifiedAt) return 'غير معروف';
  const ageDays = Math.floor((Date.now() - new Date(lastVerifiedAt).getTime()) / 86_400_000);
  if (ageDays <= 30) return 'حديثة';
  if (ageDays <= 90) return 'تم التحقق منها';
  if (ageDays <= 365) return 'قديمة';
  return 'قديمة جدًا';
}

/**
 * Data Quality factors and weights. Kept as the single source of truth for
 * "جودة البيانات" — every caller (intake pipeline, admin panel, exports)
 * must go through dataQualityAssessment/dataQualityScore instead of
 * re-deriving quality logic elsewhere.
 */
const DATA_QUALITY_FACTORS: Array<{
  key: string;
  weight: number;
  present: (lead: Partial<Lead>) => boolean;
  labelPresent: string;
  labelMissing: string;
}> = [
  {
    key: 'completeness_name',
    weight: 15,
    present: (l) => Boolean(l.full_name || l.first_name),
    labelPresent: 'الاسم متوفر',
    labelMissing: 'الاسم غير متوفر',
  },
  {
    key: 'location',
    weight: 15,
    present: (l) => Boolean(l.country || l.governorate || l.city),
    labelPresent: 'بيانات الموقع متوفرة',
    labelMissing: 'بيانات الموقع ناقصة',
  },
  {
    key: 'occupation',
    weight: 10,
    present: (l) => Boolean(l.occupation || l.job_title || l.industry),
    labelPresent: 'المهنة أو الوظيفة متوفرة',
    labelMissing: 'المهنة أو الوظيفة غير متوفرة',
  },
  {
    key: 'contact_phone',
    weight: 20,
    present: (l) => Boolean(l.business_phone || l.public_contact_phone),
    labelPresent: 'يوجد رقم هاتف',
    labelMissing: 'لا يوجد رقم هاتف',
  },
  {
    key: 'contact_email',
    weight: 10,
    present: (l) => Boolean(l.business_email || l.public_email),
    labelPresent: 'يوجد بريد إلكتروني',
    labelMissing: 'لا يوجد بريد إلكتروني',
  },
  {
    key: 'source_quality',
    weight: 10,
    present: (l) => Boolean(l.source_url || l.professional_url || l.social_url),
    labelPresent: 'المصدر موثّق برابط',
    labelMissing: 'لا يوجد رابط مصدر موثّق',
  },
  {
    key: 'verification',
    weight: 10,
    present: (l) => Boolean(l.last_verified_at),
    labelPresent: 'تم التحقق من البيانات',
    labelMissing: 'لم يتم التحقق من البيانات بعد',
  },
  {
    key: 'freshness',
    weight: 10,
    present: (l) => {
      const at = l.last_verified_at || l.collected_at;
      if (!at) return false;
      const ageDays = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
      return ageDays <= 90;
    },
    labelPresent: 'البيانات حديثة (خلال 90 يومًا)',
    labelMissing: 'البيانات قديمة أو غير مؤرّخة',
  },
];

export function dataQualityAssessment(lead: Partial<Lead>): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  for (const factor of DATA_QUALITY_FACTORS) {
    const isPresent = factor.present(lead);
    if (isPresent) score += factor.weight;
    reasons.push(isPresent ? factor.labelPresent : factor.labelMissing);
  }
  return { score: Math.min(100, score), reasons };
}

export function dataQualityScore(lead: Partial<Lead>): number {
  return dataQualityAssessment(lead).score;
}

/**
 * Context-free lead score used at intake time (manual/CSV/API/CRM import,
 * or before any search request exists). This does NOT replace scoreLead()
 * below, which scores a lead against a specific search query's criteria —
 * it is the base CRM score used in Lead Management, exports, and campaigns
 * for leads that were never attached to a search request.
 */
export type LeadScoringContext = { ageMatch?: boolean | null; evidenceStrength?: number | null };

export function scoreLeadIntake(lead: Partial<Lead>, context: LeadScoringContext = {}): { score: number; priority: LeadPriority; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (lead.governorate || lead.city) {
    score += 20;
    reasons.push('بيانات الموقع متوفرة');
  }
  if (lead.occupation || lead.job_title) {
    score += 20;
    reasons.push('المهنة أو الوظيفة متوفرة');
  }
  if (context.ageMatch === true) { score += 5; reasons.push('العمر يطابق النطاق المطلوب'); }
  if (context.ageMatch === false) reasons.push('العمر خارج النطاق أو غير مطابق');
  const evidenceStrength = Number(context.evidenceStrength ?? 0);
  if (evidenceStrength >= 75) { score += 5; reasons.push('Evidence متعددة وقوية'); }
  else if (evidenceStrength > 0) reasons.push('Evidence موجودة لكنها محدودة');
  const hasContact = Boolean(lead.business_phone || lead.public_contact_phone || lead.business_email || lead.public_email);
  if (hasContact) {
    score += 25;
    reasons.push('توجد وسيلة تواصل فعلية');
  }
  const quality = lead.data_quality_score ?? dataQualityScore(lead);
  const qualityContribution = Math.round((quality / 100) * 20);
  if (qualityContribution > 0) {
    score += qualityContribution;
    reasons.push('جودة البيانات تدعم الدرجة');
  }
  const freshAt = lead.last_verified_at || lead.collected_at;
  if (freshAt) {
    const ageDays = Math.floor((Date.now() - new Date(freshAt).getTime()) / 86_400_000);
    if (ageDays <= 30) {
      score += 15;
      reasons.push('بيانات حديثة (خلال 30 يومًا)');
    } else if (ageDays <= 180) {
      score += 8;
      reasons.push('بيانات متوسطة الحداثة');
    }
  }

  const capped = Math.min(100, score);
  return { score: capped, priority: leadPriority(capped), reasons };
}

export function leadPriority(score: number): LeadPriority {
  if (score >= 90) return 'top';
  if (score >= 75) return 'high';
  if (score >= 60) return 'suitable';
  if (score >= 40) return 'low';
  return 'weak';
}

export function scoreLead(lead: Partial<Lead>, query: LeadSearchQuery): { score: number; priority: LeadPriority; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const locationMatches = [query.location?.governorate && lead.governorate === query.location.governorate, query.location?.city && lead.city === query.location.city].filter(Boolean).length;
  if (locationMatches > 0) {
    score += locationMatches === 2 ? 30 : 18;
    reasons.push('الموقع مطابق لمعايير البحث');
  }
  if (query.age?.min !== undefined || query.age?.max !== undefined) {
    const ageMatches = lead.age !== null && lead.age !== undefined && (query.age.min === undefined || lead.age >= query.age.min) && (query.age.max === undefined || lead.age <= query.age.max);
    if (ageMatches) {
      score += 20;
      reasons.push('العمر داخل النطاق المطلوب');
    }
  }
  if (query.occupations?.length && (lead.occupation || lead.job_title)) {
    const haystack = `${lead.occupation ?? ''} ${lead.job_title ?? ''}`.toLowerCase();
    if (query.occupations.some((item) => haystack.includes(item.toLowerCase()))) {
      score += 20;
      reasons.push('المهنة أو الوظيفة مطابقة');
    }
  }
  if (lead.business_phone || lead.public_contact_phone || lead.business_email || lead.public_email) {
    score += 20;
    reasons.push('توجد وسيلة تواصل عامة أو مهنية');
  }
  return { score: Math.min(100, score), priority: leadPriority(Math.min(100, score)), reasons };
}
