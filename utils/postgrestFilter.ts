/**
 * PostgREST's `.or()` / `.filter()` builders take a raw filter-language string,
 * where `,` separates conditions, `.` separates operator segments, and `(` `)`
 * group them. Interpolating unescaped user input into one of these strings lets
 * an attacker inject extra conditions instead of the intended single ilike term
 * (e.g. a comma to add a condition on an unrelated column, or `%`/`*` wildcards
 * to broaden a match far beyond what the UI implies).
 *
 * Escape the characters that are meaningful in that grammar before interpolating
 * any user-supplied value into an `.or()` string.
 */
export function escapePostgrestFilterValue(value: string): string {
  return value.replace(/[%,()*]/g, (c) => `\\${c}`);
}
