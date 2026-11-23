export type AlertUrgency = 'due_now' | 'overdue' | 'upcoming';

export interface SchedulableDoseLog {
  id: string;
  schedule_id: string;
  medication_name: string;
  scheduled_at: string;
  status: string;
}

export interface DueMedicationAlert {
  logId: string;
  scheduleId: string;
  medicationName: string;
  scheduledAt: string;
  scheduledTimeLabel: string;
  urgency: AlertUrgency;
  timingLabel: string;
  minutesDeltaFromDue: number;
}

export interface PushNotificationPreferences {
  pushEnabled: boolean;
  browserPush: boolean;
  leadMinutes: number;
  overdueGraceMinutes: number;
  soundEnabled: boolean;
  inApp?: boolean;
  email?: boolean;
  quietStart?: string;
  quietEnd?: string;
}

export const DEFAULT_PUSH_PREFERENCES: PushNotificationPreferences = {
  pushEnabled: true,
  browserPush: true,
  leadMinutes: 15,
  overdueGraceMinutes: 720,
  soundEnabled: true,
  inApp: true,
  email: true,
  quietStart: '22:30',
  quietEnd: '06:30',
};

export function normalizeNotificationPreferences(
  raw: unknown
): PushNotificationPreferences {
  const obj =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const lead = Number(obj.leadMinutes);
  const grace = Number(obj.overdueGraceMinutes);

  return {
    pushEnabled: typeof obj.pushEnabled === 'boolean' ? obj.pushEnabled : DEFAULT_PUSH_PREFERENCES.pushEnabled,
    browserPush: typeof obj.browserPush === 'boolean' ? obj.browserPush : DEFAULT_PUSH_PREFERENCES.browserPush,
    leadMinutes: Number.isFinite(lead) && lead >= 0 && lead <= 120 ? lead : DEFAULT_PUSH_PREFERENCES.leadMinutes,
    overdueGraceMinutes:
      Number.isFinite(grace) && grace >= 15 && grace <= 1440
        ? grace
        : DEFAULT_PUSH_PREFERENCES.overdueGraceMinutes,
    soundEnabled: typeof obj.soundEnabled === 'boolean' ? obj.soundEnabled : DEFAULT_PUSH_PREFERENCES.soundEnabled,
    inApp: typeof obj.inApp === 'boolean' ? obj.inApp : DEFAULT_PUSH_PREFERENCES.inApp,
    email: typeof obj.email === 'boolean' ? obj.email : DEFAULT_PUSH_PREFERENCES.email,
    quietStart: typeof obj.quietStart === 'string' ? obj.quietStart : DEFAULT_PUSH_PREFERENCES.quietStart,
    quietEnd: typeof obj.quietEnd === 'string' ? obj.quietEnd : DEFAULT_PUSH_PREFERENCES.quietEnd,
  };
}

export function evaluateDueMedicationAlerts(
  logs: SchedulableDoseLog[],
  nowMs: number,
  options?: {
    leadMinutes?: number;
    overdueGraceMinutes?: number;
    snoozedUntilMap?: Record<string, number>;
    dismissedIds?: string[];
  }
): DueMedicationAlert[] {
  const leadMinutes = options?.leadMinutes ?? DEFAULT_PUSH_PREFERENCES.leadMinutes;
  const overdueGraceMinutes =
    options?.overdueGraceMinutes ?? DEFAULT_PUSH_PREFERENCES.overdueGraceMinutes;
  const snoozedUntilMap = options?.snoozedUntilMap ?? {};
  const dismissedSet = new Set(options?.dismissedIds ?? []);

  const alerts: DueMedicationAlert[] = [];

  for (const log of logs) {
    if (log.status !== 'pending') continue;
    if (dismissedSet.has(log.id)) continue;

    const snoozedUntil = snoozedUntilMap[log.id];
    if (typeof snoozedUntil === 'number' && snoozedUntil > nowMs) {
      continue;
    }

    const scheduledMs = Date.parse(log.scheduled_at);
    if (!Number.isFinite(scheduledMs)) continue;

    const msPastDue = nowMs - scheduledMs;
    const msUntilDue = scheduledMs - nowMs;

    let urgency: AlertUrgency | null = null;
    let timingLabel = '';

    if (msUntilDue > 0 && msUntilDue <= leadMinutes * 60_000) {
      const minsUntil = Math.max(1, Math.ceil(msUntilDue / 60_000));
      urgency = 'upcoming';
      timingLabel = minsUntil <= 1 ? 'Due in 1 min' : `Due in ${minsUntil} min`;
    } else if (msPastDue >= 0 && msPastDue <= 15 * 60_000) {
      const minsPast = Math.floor(msPastDue / 60_000);
      urgency = 'due_now';
      timingLabel = minsPast <= 1 ? 'Due now' : `Due ${minsPast} min ago`;
    } else if (msPastDue > 15 * 60_000 && msPastDue <= overdueGraceMinutes * 60_000) {
      const minsPast = Math.floor(msPastDue / 60_000);
      urgency = 'overdue';
      if (minsPast >= 60) {
        const hrs = Math.floor(minsPast / 60);
        const rem = minsPast % 60;
        timingLabel = rem > 0 ? `Overdue by ${hrs}h ${rem}m` : `Overdue by ${hrs}h`;
      } else {
        timingLabel = `Overdue by ${minsPast} min`;
      }
    }

    if (!urgency) continue;

    alerts.push({
      logId: log.id,
      scheduleId: log.schedule_id,
      medicationName: log.medication_name,
      scheduledAt: log.scheduled_at,
      scheduledTimeLabel: `${log.scheduled_at.slice(11, 16)} UTC`,
      urgency,
      timingLabel,
      minutesDeltaFromDue: Math.round(msPastDue / 60_000),
    });
  }

  const rank: Record<AlertUrgency, number> = {
    due_now: 0,
    overdue: 1,
    upcoming: 2,
  };

  return alerts.sort((a, b) => {
    if (rank[a.urgency] !== rank[b.urgency]) {
      return rank[a.urgency] - rank[b.urgency];
    }
    return a.scheduledAt.localeCompare(b.scheduledAt);
  });
}

export function formatPushNotificationMessage(alert: DueMedicationAlert): {
  title: string;
  body: string;
  tag: string;
} {
  const prefix =
    alert.urgency === 'overdue'
      ? 'Medication Overdue'
      : alert.urgency === 'due_now'
      ? 'Medication Time Now'
      : 'Upcoming Medication Dose';

  return {
    title: `${prefix}: ${alert.medicationName}`,
    body: `Scheduled at ${alert.scheduledTimeLabel} (${alert.timingLabel}). Confirm your dose in VeroMed Care.`,
    tag: `veromed-dose-${alert.logId}`,
  };
}
