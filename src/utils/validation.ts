export type ValidationResult = { valid: boolean; error?: string };

export function validateEmail(email: string): ValidationResult {
  if (!email.trim()) return { valid: false, error: 'Email is required' };
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!re.test(email)) return { valid: false, error: 'Enter a valid email address' };
  return { valid: true };
}

export function validatePassword(password: string): ValidationResult {
  if (!password) return { valid: false, error: 'Password is required' };
  if (password.length < 6) return { valid: false, error: 'Password must be at least 6 characters' };
  return { valid: true };
}

export function validateRequired(value: string, label: string): ValidationResult {
  if (!value.trim()) return { valid: false, error: `${label} is required` };
  return { valid: true };
}

export function validateMatch(a: string, b: string, label: string): ValidationResult {
  if (a !== b) return { valid: false, error: `${label} do not match` };
  return { valid: true };
}
