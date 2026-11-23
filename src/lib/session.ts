export const SESSION_DURATION_DAYS = 30;
export const SESSION_DURATION_HOURS = SESSION_DURATION_DAYS * 24;
export const SESSION_DURATION_MS = 1000 * 60 * 60 * SESSION_DURATION_HOURS;

export const SHORT_SESSION_HOURS = 24;
export const SHORT_SESSION_MS = 1000 * 60 * 60 * SHORT_SESSION_HOURS;

export function getSessionDurationMs(rememberMe: boolean): number {
  return rememberMe ? SESSION_DURATION_MS : SHORT_SESSION_MS;
}

export function getSessionDurationHours(rememberMe: boolean): number {
  return rememberMe ? SESSION_DURATION_HOURS : SHORT_SESSION_HOURS;
}

export function computeSessionExpiry(
  nowMs: number = Date.now(),
  rememberMe: boolean = true
): string {
  return new Date(nowMs + getSessionDurationMs(rememberMe)).toISOString();
}

export function isSessionExpired(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!expiresAt) return true;
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed)) return true;
  return parsed <= nowMs;
}

export function getSessionRemainingHours(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now()
): number {
  if (!expiresAt) return 0;
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed) || parsed <= nowMs) return 0;
  return Math.max(1, Math.ceil((parsed - nowMs) / (1000 * 60 * 60)));
}

export function getSessionRemainingDays(
  expiresAt: string | null | undefined,
  nowMs: number = Date.now()
): number {
  if (!expiresAt) return 0;
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed) || parsed <= nowMs) return 0;
  return Math.max(1, Math.ceil((parsed - nowMs) / (1000 * 60 * 60 * 24)));
}

export function formatSessionBadge(
  expiresAt: string | null | undefined,
  rememberMe: boolean = true,
  nowMs: number = Date.now()
): string {
  if (!expiresAt || isSessionExpired(expiresAt, nowMs)) {
    return 'Session expired';
  }
  const datePart = expiresAt.slice(0, 10);
  if (rememberMe) {
    return `30d session · Resets ${datePart} (${getSessionRemainingDays(expiresAt, nowMs)}d left)`;
  }
  return `24h session · Expires ${datePart} (${getSessionRemainingHours(expiresAt, nowMs)}h left)`;
}
