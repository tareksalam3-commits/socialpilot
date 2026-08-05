export function formatDate(date: string | Date, locale = 'en-US'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(date: string | Date, locale = 'en-US'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function timeAgo(
  date: string | Date,
  t?: (key: string, params?: Record<string, string | number>) => string,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return t ? t('time.justNow') : 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t ? t('time.minutesAgo', { count: minutes }) : `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t ? t('time.hoursAgo', { count: hours }) : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return t ? t('time.daysAgo', { count: days }) : `${days}d ago`;
  return formatDate(d);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '??';
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
