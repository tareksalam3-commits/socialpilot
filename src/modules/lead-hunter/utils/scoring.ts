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

export function dataQualityScore(lead: Partial<Lead>): number {
  const weights: Array<[boolean, number]> = [
    [Boolean(lead.full_name || lead.first_name), 20],
    [Boolean(lead.country || lead.governorate || lead.city), 15],
    [Boolean(lead.occupation || lead.job_title || lead.industry), 15],
    [Boolean(lead.business_phone || lead.public_contact_phone), 20],
    [Boolean(lead.business_email || lead.public_email), 10],
    [Boolean(lead.source_url || lead.professional_url || lead.social_url), 10],
    [Boolean(lead.last_verified_at || lead.collected_at), 10],
  ];
  return weights.reduce((sum, [present, weight]) => sum + (present ? weight : 0), 0);
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
