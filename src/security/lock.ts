// Pure decision for the app lock, so the timing rules are tested without a phone.
export const TIMEOUTS = { immediately: 0, '1 minute': 60_000, '5 minutes': 300_000 } as const;

/** Lock when returning to the app if it was in the background at least `timeoutMs` (0 = every time). */
export function shouldLockOnReturn(enabled: boolean, backgroundedAt: number | null, now: number, timeoutMs: number): boolean {
  if (!enabled) return false;
  if (backgroundedAt == null) return false; // never left the app
  return now - backgroundedAt >= timeoutMs;
}
