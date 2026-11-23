export type DoseStatus =
  | 'taken'
  | 'missed'
  | 'skipped'
  | 'delayed'
  | 'pending'
  | 'unconfirmed';

export type ScheduleType =
  | 'once_daily'
  | 'multiple_daily'
  | 'interval_based'
  | 'weekly'
  | 'custom';

export interface MedicationScheduleRule {
  id: string;
  medicationId: string;
  scheduleType: ScheduleType;
  times: string[]; // HH:MM in 24h format
  intervalHours?: number;
  daysOfWeek?: number[]; // 0 (Sun) - 6 (Sat)
  timezone: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string | null;
  enabled: boolean;
}

export interface DoseLogRecord {
  id: string;
  scheduleId: string;
  scheduledAt: string; // ISO UTC timestamp
  status: DoseStatus;
  recordedAt?: string | null;
  note?: string | null;
}

export interface AdherenceSummary {
  totalScheduled: number;
  eligibleCount: number;
  takenCount: number;
  missedCount: number;
  skippedCount: number;
  delayedCount: number;
  pendingCount: number;
  unconfirmedCount: number;
  recordedAdherenceRate: number; // 0..100, (taken / eligible) * 100
  formulaDescription: string;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function validateScheduleRule(rule: Partial<MedicationScheduleRule>): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!rule.scheduleType) {
    errors.push('Schedule type is required.');
  }

  if (!rule.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(rule.startDate)) {
    errors.push('Valid start date (YYYY-MM-DD) is required.');
  }

  if (rule.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(rule.endDate)) {
    errors.push('End date must be in YYYY-MM-DD format.');
  }

  if (rule.startDate && rule.endDate && rule.endDate < rule.startDate) {
    errors.push('End date cannot be earlier than start date.');
  }

  if (!rule.times || rule.times.length === 0) {
    errors.push('At least one clock time (HH:MM) is required.');
  } else {
    for (const t of rule.times) {
      if (!TIME_PATTERN.test(t)) {
        errors.push(`Invalid clock time "${t}". Use 24-hour HH:MM format.`);
      }
    }
  }

  if (rule.scheduleType === 'interval_based') {
    if (!rule.intervalHours || rule.intervalHours < 1 || rule.intervalHours > 72) {
      errors.push('Interval hours must be between 1 and 72.');
    }
  }

  if (rule.scheduleType === 'weekly') {
    if (!rule.daysOfWeek || rule.daysOfWeek.length === 0) {
      errors.push('Select at least one day of the week for a weekly schedule.');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generates deterministic scheduled ISO timestamps for a target YYYY-MM-DD date.
 */
export function generateOccurrencesForDate(
  rule: MedicationScheduleRule,
  dateStr: string
): string[] {
  if (!rule.enabled) return [];
  if (dateStr < rule.startDate) return [];
  if (rule.endDate && dateStr > rule.endDate) return [];

  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return [];

  const dayDate = new Date(Date.UTC(year, month - 1, day));
  const weekday = dayDate.getUTCDay();

  if (rule.scheduleType === 'weekly') {
    const allowed = rule.daysOfWeek ?? [];
    if (!allowed.includes(weekday)) return [];
  }

  if (rule.scheduleType === 'interval_based' && rule.intervalHours && rule.times[0]) {
    const [startH, startM] = rule.times[0].split(':').map(Number);
    const occurrences: string[] = [];
    let currentMinutes = startH * 60 + startM;
    const stepMinutes = rule.intervalHours * 60;
    while (currentMinutes < 24 * 60) {
      const hh = String(Math.floor(currentMinutes / 60)).padStart(2, '0');
      const mm = String(currentMinutes % 60).padStart(2, '0');
      occurrences.push(`${dateStr}T${hh}:${mm}:00.000Z`);
      currentMinutes += stepMinutes;
    }
    return occurrences;
  }

  const uniqueTimes = Array.from(new Set(rule.times)).sort();
  return uniqueTimes.map((t) => `${dateStr}T${t}:00.000Z`);
}

/**
 * Computes recorded adherence strictly per PRD Module 3 & 10:
 * - Taken + Delayed count as taken? Wait: PRD lists Taken, Missed, Skipped, Delayed, Pending, Unconfirmed.
 *   "Confirmed taken doses / eligible scheduled doses; clearly labelled as recorded adherence."
 *   "Unconfirmed is not automatically treated as proof of missed dose."
 *   Eligible scheduled doses = taken + missed + skipped + delayed (excludes pending & unconfirmed).
 */
export function calculateAdherence(logs: DoseLogRecord[]): AdherenceSummary {
  let takenCount = 0;
  let missedCount = 0;
  let skippedCount = 0;
  let delayedCount = 0;
  let pendingCount = 0;
  let unconfirmedCount = 0;

  for (const log of logs) {
    switch (log.status) {
      case 'taken':
        takenCount += 1;
        break;
      case 'missed':
        missedCount += 1;
        break;
      case 'skipped':
        skippedCount += 1;
        break;
      case 'delayed':
        delayedCount += 1;
        break;
      case 'pending':
        pendingCount += 1;
        break;
      case 'unconfirmed':
        unconfirmedCount += 1;
        break;
    }
  }

  const eligibleCount = takenCount + missedCount + skippedCount + delayedCount;
  const recordedAdherenceRate =
    eligibleCount === 0 ? 0 : Math.round((takenCount / eligibleCount) * 1000) / 10;

  return {
    totalScheduled: logs.length,
    eligibleCount,
    takenCount,
    missedCount,
    skippedCount,
    delayedCount,
    pendingCount,
    unconfirmedCount,
    recordedAdherenceRate,
    formulaDescription:
      'Recorded adherence = Confirmed Taken doses / Eligible resolved doses (Taken + Missed + Skipped + Delayed). Pending and Unconfirmed doses are excluded from the denominator and not assumed missed.',
  };
}

export function buildReminderDedupeKey(
  userId: string,
  kind: 'med' | 'appt' | 'expiry' | 'low_stock',
  resourceId: string,
  scheduledAtIso: string
): string {
  return `${userId}:${kind}:${resourceId}:${scheduledAtIso}`;
}

export function computeRetryBackoffMs(
  attempt: number,
  baseMs = 5000,
  maxMs = 300000
): number {
  const safeAttempt = Math.max(0, attempt);
  return Math.min(baseMs * Math.pow(2, safeAttempt), maxMs);
}
