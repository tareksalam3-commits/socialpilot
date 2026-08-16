import type { AiIntent } from './types';

export type ParsedIntent = {
  intent: AiIntent;
  postCount: number;
  platforms: string[];
  startDate: string | null;
  endDate: string | null;
  frequency: 'once' | 'daily' | 'weekly' | 'custom';
  schedule: { dates: string[]; time: string | null };
  contentGoal: string | null;
  contentType: string | null;
};

export const DEFAULT_SCHEDULE_HOUR = 9; // single source of truth for the default publish hour

const PLATFORM_ALIASES: Record<string, string> = {
  facebook: 'facebook', فيسبوك: 'facebook',
  instagram: 'instagram', انستجرام: 'instagram', إنستجرام: 'instagram',
  linkedin: 'linkedin', لينكدإن: 'linkedin', لينكدان: 'linkedin', لينكد_إن: 'linkedin',
  x: 'x', تويتر: 'x', twitter: 'x',
  telegram: 'telegram', تيليجرام: 'telegram',
};

// Spelled-out Arabic numbers commonly used in requests ("خمس بوستات", "عشرة بوستات")
const ARABIC_NUMBER_WORDS: Record<string, number> = {
  واحدة: 1,
  اثنين: 2, اثنان: 2, ثنين: 2,
  ثلاثة: 3, تلاتة: 3, ثلاث: 3,
  أربعة: 4, اربعة: 4, أربع: 4, اربع: 4,
  خمسة: 5, خمس: 5,
  ستة: 6, ست: 6,
  سبعة: 7, سبع: 7,
  ثمانية: 8, ثمان: 8,
  تسعة: 9, تسع: 9,
  عشرة: 10, عشر: 10,
};

const GOAL_KEYWORDS: Record<string, string> = {
  'وعي|awareness|تعريف': 'brand_awareness',
  'مبيعات|بيع|sales|عرض': 'sales',
  'تفاعل|engagement': 'engagement',
  'تعليم|تثقيف|educational|معلومة': 'education',
  'إطلاق|اطلاق|launch': 'launch',
};

const TYPE_KEYWORDS: Record<string, string> = {
  'فيديو|video|ريلز|reel': 'video',
  'صورة|image|كاروسيل|carousel': 'image',
  'نص|text|مقال': 'text',
  'قصة|story|ستوري': 'story',
};

function numberFromArabic(value: string): number | null {
  const normalized = value.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractNumber(text: string): number | null {
  const digitMatch = text.match(/([0-9٠-٩]+)\s*(?:بوست|بوستات|منشور|منشورات|posts?)/i);
  if (digitMatch) return numberFromArabic(digitMatch[1]);

  for (const [word, value] of Object.entries(ARABIC_NUMBER_WORDS)) {
    const re = new RegExp(`${word}\\s*(?:بوست|بوستات|منشور|منشورات)`);
    if (re.test(text)) return value;
  }
  return null;
}

function matchKeyword(text: string, table: Record<string, string>): string | null {
  for (const [pattern, value] of Object.entries(table)) {
    if (new RegExp(pattern).test(text)) return value;
  }
  return null;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Spread `count` posts evenly across `spanDays` days (extra posts stack on later days). */
function spreadDates(start: Date, count: number, spanDays: number): string[] {
  const days = Math.max(1, spanDays);
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const dayOffset = Math.floor((i * days) / count);
    dates.push(isoDate(addDays(start, dayOffset)));
  }
  return dates;
}

export function parseIntent(message: string, now = new Date()): ParsedIntent {
  const text = message.toLowerCase();

  const platforms = Object.entries(PLATFORM_ALIASES)
    .filter(([alias]) => text.includes(alias))
    .map(([, platform]) => platform)
    .filter((value, index, values) => values.indexOf(value) === index);

  const daily = /كل يوم|يوميًا|يوميا|daily/.test(text);
  const week = /أسبوع|اسبوع|week/.test(text);
  const month = /شهر|month/.test(text);
  const durationMatch = text.match(/(?:خلال|لمدة|for)\s*([0-9٠-٩]+)\s*(?:يوم|أيام|day|days|أسبوع|أسابيع|week|weeks)?/i);
  const duration = durationMatch ? numberFromArabic(durationMatch[1]) : null;
  const durationIsWeeks = durationMatch ? /أسبوع|أسابيع|week/.test(durationMatch[0]) : false;
  const distributed = /وزع|وزّع|distribute|spread/.test(text);
  const hasScheduleSignal = daily || week || month || durationMatch !== null || distributed || /خطة|plan|جدول|schedule/.test(text);

  // post_count: explicit number > 1 wins; otherwise defaults to 1 (adjusted below for "daily" phrasing).
  const explicitCount = extractNumber(text);
  const postCount = explicitCount ?? 1;
  const isMultiPost = postCount > 1 || (daily && hasScheduleSignal);

  let intent: AiIntent = 'general_advice';
  if (/أداء|تحليل|analyze|performance|حلل/.test(text)) intent = 'analyze_performance';
  else if (/أفكار|اقترح|ideas|suggest/.test(text)) intent = 'suggest_ideas';
  else if (/بوست|منشور|اكتب|محتوى|post|write|content/.test(text)) {
    intent = isMultiPost || hasScheduleSignal ? 'create_content_plan' : 'create_content';
  } else if (hasScheduleSignal) intent = 'create_content_plan';

  // --- Scheduling window -----------------------------------------------
  const start = new Date(now);
  let spanDays: number;
  let count: number;

  if (daily && !explicitCount) {
    // "بوست كل يوم لمدة أسبوع" -> N posts, one per day, N = duration/week/month
    spanDays = duration ? duration * (durationIsWeeks ? 7 : 1) : week ? 7 : month ? 30 : 7;
    count = spanDays;
  } else if (duration) {
    // "5 بوستات خلال 5 أيام"
    spanDays = duration * (durationIsWeeks ? 7 : 1);
    count = postCount;
  } else if (week || month) {
    // "10 بوستات ووزعهم على الأسبوع"
    spanDays = week ? 7 : 30;
    count = postCount;
  } else {
    // No explicit window: one post per day starting today.
    spanDays = Math.max(postCount, 1);
    count = postCount;
  }

  const dates = intent === 'create_content_plan' ? spreadDates(start, count, spanDays) : [];
  const endDate = dates[dates.length - 1] ?? null;

  return {
    intent,
    postCount: intent === 'create_content_plan' ? count : 1,
    platforms,
    startDate: dates[0] ?? null,
    endDate,
    frequency: daily ? 'daily' : durationMatch || week || month ? 'custom' : 'once',
    schedule: { dates, time: null },
    contentGoal: matchKeyword(text, GOAL_KEYWORDS),
    contentType: matchKeyword(text, TYPE_KEYWORDS),
  };
}

export function classifyIntent(message: string): AiIntent {
  return parseIntent(message).intent;
}

/** Assigns one date to each of `count` posts, cycling the parsed schedule if needed. */
export function scheduleDates(parsed: ParsedIntent, count: number): string[] {
  if (parsed.schedule.dates.length === 0) return [];
  return Array.from({ length: count }, (_, index) => parsed.schedule.dates[Math.min(index, parsed.schedule.dates.length - 1)]);
}
