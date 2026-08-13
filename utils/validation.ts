export type ValidationResult = { valid: boolean; error?: string };

type TFunction = (key: string, params?: Record<string, string | number>) => string;

export function validateEmail(email: string, t: TFunction): ValidationResult {
  if (!email.trim()) return { valid: false, error: t('validation.email.required') };
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(email)) return { valid: false, error: t('validation.email.invalid') };
  return { valid: true };
}

export function validatePassword(password: string, t: TFunction): ValidationResult {
  if (!password) return { valid: false, error: t('validation.password.required') };
  if (password.length < 6) return { valid: false, error: t('validation.password.minLength', { count: 6 }) };
  return { valid: true };
}

export function validateRequired(value: string, label: string, t: TFunction): ValidationResult {
  if (!value.trim()) return { valid: false, error: t('validation.field.required', { field: label }) };
  return { valid: true };
}

export function validateMatch(a: string, b: string, label: string, t: TFunction): ValidationResult {
  if (a !== b) return { valid: false, error: t('validation.field.noMatch', { field: label }) };
  return { valid: true };
}
