/**
 * Thin wrapper around the Vibration API so interactive elements can give the
 * same tactile confirmation native apps give on tap/success/error — without
 * every call site needing to feature-detect `navigator.vibrate` itself.
 *
 * Silently no-ops on iOS Safari/PWA and any browser without the API; there is
 * no reliable haptics API for iOS web content, so this is an Android/desktop
 * enhancement layer, not a dependency any flow should require.
 */

type HapticPattern = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  light: 10,
  medium: 20,
  heavy: 35,
  selection: 8,
  success: [10, 40, 15],
  warning: [20, 60, 20],
  error: [30, 50, 30, 50, 30],
};

let supported: boolean | null = null;

function isSupported(): boolean {
  if (supported === null) {
    supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }
  return supported;
}

export function haptic(pattern: HapticPattern = 'light'): void {
  if (!isSupported()) return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Some browsers throw if called outside a user gesture; never let that
    // bubble up and break the interaction it was meant to accompany.
  }
}

export function cancelHaptic(): void {
  if (!isSupported()) return;
  try {
    navigator.vibrate(0);
  } catch {
    // no-op
  }
}
