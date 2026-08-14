// ============================================================================
// Workspace Country → Arabic Dialect Resolution
//
// When a workspace's Content Language is Arabic, the dialect used for every
// generated/rewritten post is resolved automatically from the workspace's
// Country (never asked as a separate, second choice). Egyptian Arabic is the
// system's quality reference (see EGYPTIAN_ARABIC_WRITING_RULES history) —
// every other dialect is held to the exact same bar for grammatical
// correctness, natural sentence construction, and freedom from machine-
// translation artifacts; only the vocabulary/register differs.
//
// Non-Arabic-speaking countries (and any country not covered below) default
// to Egyptian — the same default already used for every workspace created
// before this field existed.
// ============================================================================

export type DialectCode = 'egyptian' | 'gulf' | 'levantine' | 'maghrebi' | 'iraqi' | 'yemeni' | 'sudanese';

export const DEFAULT_DIALECT: DialectCode = 'egyptian';
export const DEFAULT_COUNTRY = 'EG';

export type DialectMeta = {
  code: DialectCode;
  /** Arabic display name of the dialect, e.g. "المصرية". */
  name: string;
  /** Arabic adjective describing a person writing in this dialect, e.g. "مصري". */
  demonym: string;
  /** A few (formal Arabic → natural dialect) example pairs used only to steer
   * the model's register — illustrative, not an exhaustive or closed list. */
  examples: [string, string][];
};

export const DIALECTS: Record<DialectCode, DialectMeta> = {
  egyptian: {
    code: 'egyptian',
    name: 'المصرية',
    demonym: 'مصري',
    examples: [
      ['كيف يمكنك تحفيز فريقك على تحقيق الأهداف المطلوبة؟', 'إزاي تقدر تحفّز فريقك وتخليه يحقق أهدافه؟'],
      ['تعتمد إدارة فريق المبيعات على مهارات قوية في القيادة والتحفيز.', 'إدارة فريق المبيعات محتاجة قيادة كويسة وقدرة حقيقية على التحفيز.'],
      ['هل فكرت يومًا في التأمين على الحياة كوسيلة لحماية دخلك؟', 'عمرك فكرت في التأمين على الحياة كوسيلة تحمي بيها دخلك؟'],
    ],
  },
  gulf: {
    code: 'gulf',
    name: 'الخليجية',
    demonym: 'خليجي',
    examples: [
      ['كيف يمكنك تحفيز فريقك على تحقيق الأهداف المطلوبة؟', 'كيف تقدر تحفّز فريقك عشان يحقق أهدافه؟'],
      ['تعتمد إدارة فريق المبيعات على مهارات قوية في القيادة والتحفيز.', 'إدارة فريق المبيعات تحتاج مهارات قوية في القيادة والتحفيز.'],
      ['هل فكرت يومًا في التأمين على الحياة كوسيلة لحماية دخلك؟', 'فكرت أبد في التأمين على الحياة عشان تحمي فيه دخلك؟'],
    ],
  },
  levantine: {
    code: 'levantine',
    name: 'الشامية',
    demonym: 'شامي',
    examples: [
      ['كيف يمكنك تحفيز فريقك على تحقيق الأهداف المطلوبة؟', 'كيف فيك تحفّز فريقك يحقق الأهداف يلي بدّه ياها؟'],
      ['تعتمد إدارة فريق المبيعات على مهارات قوية في القيادة والتحفيز.', 'إدارة فريق المبيعات بتحتاج مهارات قوية بالقيادة والتحفيز.'],
      ['هل فكرت يومًا في التأمين على الحياة كوسيلة لحماية دخلك؟', 'فكرت يومًا بالتأمين على الحياة كوسيلة تحمي فيها دخلك؟'],
    ],
  },
  maghrebi: {
    code: 'maghrebi',
    name: 'المغاربية',
    demonym: 'مغربي',
    examples: [
      ['كيف يمكنك تحفيز فريقك على تحقيق الأهداف المطلوبة؟', 'كيفاش تقدر تحفّز فريقك باش يحقق الأهداف؟'],
      ['تعتمد إدارة فريق المبيعات على مهارات قوية في القيادة والتحفيز.', 'تسيير فريق المبيعات كيتطلب مهارات قوية فالقيادة والتحفيز.'],
      ['هل فكرت يومًا في التأمين على الحياة كوسيلة لحماية دخلك؟', 'واش فكرتي يوما فالتأمين على الحياة باش تحمي بيه دخلك؟'],
    ],
  },
  iraqi: {
    code: 'iraqi',
    name: 'العراقية',
    demonym: 'عراقي',
    examples: [
      ['كيف يمكنك تحفيز فريقك على تحقيق الأهداف المطلوبة؟', 'شلون تكدر تحفّز فريكك يحقق الأهداف المطلوبة؟'],
      ['تعتمد إدارة فريق المبيعات على مهارات قوية في القيادة والتحفيز.', 'إدارة فريق المبيعات تحتاج مهارات قوية بالقيادة والتحفيز.'],
      ['هل فكرت يومًا في التأمين على الحياة كوسيلة لحماية دخلك؟', 'فكرت يوم بالتأمين على الحياة كوسيلة تحمي فيها دخلك؟'],
    ],
  },
  yemeni: {
    code: 'yemeni',
    name: 'اليمنية',
    demonym: 'يمني',
    examples: [
      ['كيف يمكنك تحفيز فريقك على تحقيق الأهداف المطلوبة؟', 'كيف تقدر تحفّز فريقك حتى يحقق الأهداف؟'],
      ['تعتمد إدارة فريق المبيعات على مهارات قوية في القيادة والتحفيز.', 'إدارة فريق المبيعات تحتاج مهارات قوية في القيادة والتحفيز.'],
      ['هل فكرت يومًا في التأمين على الحياة كوسيلة لحماية دخلك؟', 'فكرت يومًا في التأمين على الحياة عشان تحمي دخلك؟'],
    ],
  },
  sudanese: {
    code: 'sudanese',
    name: 'السودانية',
    demonym: 'سوداني',
    examples: [
      ['كيف يمكنك تحفيز فريقك على تحقيق الأهداف المطلوبة؟', 'كيف تقدر تحفّز فريقك عشان يحقق الأهداف؟'],
      ['تعتمد إدارة فريق المبيعات على مهارات قوية في القيادة والتحفيز.', 'إدارة فريق المبيعات محتاجة مهارات قوية في القيادة والتحفيز.'],
      ['هل فكرت يومًا في التأمين على الحياة كوسيلة لحماية دخلك؟', 'داير تفكر في التأمين على الحياة عشان يحمي ليك دخلك؟'],
    ],
  },
};

export type CountryOption = {
  /** ISO 3166-1 alpha-2 code. */
  code: string;
  nativeLabel: string;
  label: string;
  dialect: DialectCode;
};

// Grouped exactly per the simple groups the workspace Country field must
// resolve dialect from: مصر → مصري، الخليج → خليجي، الشام → شامي،
// المغرب العربي → مغاربي، العراق → عراقي، اليمن → يمني، السودان → سوداني.
export const COUNTRIES: CountryOption[] = [
  { code: 'EG', nativeLabel: 'مصر', label: 'Egypt', dialect: 'egyptian' },

  // Gulf
  { code: 'SA', nativeLabel: 'السعودية', label: 'Saudi Arabia', dialect: 'gulf' },
  { code: 'AE', nativeLabel: 'الإمارات', label: 'United Arab Emirates', dialect: 'gulf' },
  { code: 'KW', nativeLabel: 'الكويت', label: 'Kuwait', dialect: 'gulf' },
  { code: 'QA', nativeLabel: 'قطر', label: 'Qatar', dialect: 'gulf' },
  { code: 'BH', nativeLabel: 'البحرين', label: 'Bahrain', dialect: 'gulf' },
  { code: 'OM', nativeLabel: 'عُمان', label: 'Oman', dialect: 'gulf' },

  // Levant
  { code: 'SY', nativeLabel: 'سوريا', label: 'Syria', dialect: 'levantine' },
  { code: 'LB', nativeLabel: 'لبنان', label: 'Lebanon', dialect: 'levantine' },
  { code: 'JO', nativeLabel: 'الأردن', label: 'Jordan', dialect: 'levantine' },
  { code: 'PS', nativeLabel: 'فلسطين', label: 'Palestine', dialect: 'levantine' },

  // Maghreb
  { code: 'MA', nativeLabel: 'المغرب', label: 'Morocco', dialect: 'maghrebi' },
  { code: 'DZ', nativeLabel: 'الجزائر', label: 'Algeria', dialect: 'maghrebi' },
  { code: 'TN', nativeLabel: 'تونس', label: 'Tunisia', dialect: 'maghrebi' },
  { code: 'LY', nativeLabel: 'ليبيا', label: 'Libya', dialect: 'maghrebi' },
  { code: 'MR', nativeLabel: 'موريتانيا', label: 'Mauritania', dialect: 'maghrebi' },

  { code: 'IQ', nativeLabel: 'العراق', label: 'Iraq', dialect: 'iraqi' },
  { code: 'YE', nativeLabel: 'اليمن', label: 'Yemen', dialect: 'yemeni' },
  { code: 'SD', nativeLabel: 'السودان', label: 'Sudan', dialect: 'sudanese' },

  // Non-Arabic-speaking countries — dialect is irrelevant while Content
  // Language ≠ Arabic, and falls back to the Egyptian reference bar if the
  // workspace ever switches Content Language to Arabic anyway.
  { code: 'US', nativeLabel: 'الولايات المتحدة', label: 'United States', dialect: 'egyptian' },
  { code: 'GB', nativeLabel: 'المملكة المتحدة', label: 'United Kingdom', dialect: 'egyptian' },
  { code: 'FR', nativeLabel: 'فرنسا', label: 'France', dialect: 'egyptian' },
  { code: 'DE', nativeLabel: 'ألمانيا', label: 'Germany', dialect: 'egyptian' },
  { code: 'ES', nativeLabel: 'إسبانيا', label: 'Spain', dialect: 'egyptian' },
  { code: 'IN', nativeLabel: 'الهند', label: 'India', dialect: 'egyptian' },
  { code: 'OTHER', nativeLabel: 'دولة أخرى', label: 'Other', dialect: 'egyptian' },
];

const COUNTRY_TO_DIALECT: Record<string, DialectCode> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c.dialect]),
);

/** Resolves the dialect for a workspace Country code. Unknown/missing codes
 * fall back to Egyptian — the system's default and quality reference,
 * matching the default every pre-existing workspace is migrated to. */
export function resolveDialect(countryCode: string | null | undefined): DialectCode {
  if (!countryCode) return DEFAULT_DIALECT;
  return COUNTRY_TO_DIALECT[countryCode.toUpperCase()] ?? DEFAULT_DIALECT;
}

/** The single entry point every content-authoring surface should use: only
 * Arabic content goes through dialect resolution at all — for any other
 * Content Language the dialect concept doesn't apply, so this returns the
 * Egyptian reference rules by convention without affecting non-Arabic output. */
export function resolveWorkspaceDialect(workspace: { language?: string | null; country?: string | null } | null | undefined): DialectCode {
  if (!workspace || workspace.language !== 'ar') return DEFAULT_DIALECT;
  return resolveDialect(workspace.country);
}
