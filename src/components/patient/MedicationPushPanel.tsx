import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellOff,
  BellRing,
  Check,
  Clock,
  Send,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { apiFetch } from '../../types/api';
import {
  type DueMedicationAlert,
  evaluateDueMedicationAlerts,
  formatPushNotificationMessage,
  type PushNotificationPreferences,
  type SchedulableDoseLog,
} from '../../lib/pushNotifications';
import type { DoseStatus } from '../../lib/adherence';

interface MedicationPushPanelProps {
  todayLogs: SchedulableDoseLog[];
  preferences: PushNotificationPreferences;
  isCaregiver: boolean;
  updatingId: string | null;
  onLogDose: (logId: string, status: DoseStatus) => Promise<void>;
  onPreferencesChange: (next: PushNotificationPreferences) => void;
}

function playGentleChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.setValueAtTime(880, now + 0.14);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.44);
    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    // Audio playback blocked or unavailable; ignore cleanly
  }
}

export const MedicationPushPanel: React.FC<MedicationPushPanelProps> = ({
  todayLogs,
  preferences,
  isCaregiver,
  updatingId,
  onLogDose,
  onPreferencesChange,
}) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [snoozedUntilMap, setSnoozedUntilMap] = useState<Record<string, number>>({});
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [testAlert, setTestAlert] = useState<DueMedicationAlert | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [savingPref, setSavingPref] = useState(false);

  const supportsBrowserPush = typeof window !== 'undefined' && 'Notification' in window;
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    supportsBrowserPush ? window.Notification.permission : 'unsupported'
  );

  const dispatchedKeysRef = useRef<Set<string>>(new Set());

  // Live 15-second clock ticker to catch scheduled medication times accurately
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 15_000);
    return () => window.clearInterval(id);
  }, []);

  const dueAlerts = useMemo(() => {
    if (!preferences.pushEnabled) return [];
    return evaluateDueMedicationAlerts(todayLogs, nowMs, {
      leadMinutes: preferences.leadMinutes,
      overdueGraceMinutes: preferences.overdueGraceMinutes,
      snoozedUntilMap,
      dismissedIds,
    });
  }, [
    todayLogs,
    nowMs,
    preferences.pushEnabled,
    preferences.leadMinutes,
    preferences.overdueGraceMinutes,
    snoozedUntilMap,
    dismissedIds,
  ]);

  // Dispatch Web Push (Browser Notification API) when a pending dose enters an alert window
  useEffect(() => {
    if (isCaregiver || !preferences.pushEnabled) return;

    let newlyTriggered = false;
    for (const alert of dueAlerts) {
      const dispatchKey = `${alert.logId}:${alert.urgency}`;
      if (dispatchedKeysRef.current.has(dispatchKey)) continue;
      dispatchedKeysRef.current.add(dispatchKey);
      newlyTriggered = true;

      if (supportsBrowserPush && permission === 'granted') {
        try {
          const payload = formatPushNotificationMessage(alert);
          new window.Notification(payload.title, {
            body: payload.body,
            tag: payload.tag,
            requireInteraction: alert.urgency === 'due_now',
          });
        } catch {
          // Ignore browser Notification runtime restrictions inside frames
        }
      }
    }

    if (newlyTriggered && preferences.soundEnabled) {
      playGentleChime();
    }
  }, [dueAlerts, isCaregiver, permission, preferences.pushEnabled, preferences.soundEnabled, supportsBrowserPush]);

  async function savePreferences(partial: Partial<PushNotificationPreferences>) {
    const next = { ...preferences, ...partial };
    onPreferencesChange(next);
    setSavingPref(true);
    try {
      const res = await apiFetch<{ preferences: PushNotificationPreferences }>(
        '/notifications/preferences',
        {
          method: 'PATCH',
          body: JSON.stringify(partial),
        }
      );
      onPreferencesChange(res.preferences);
    } catch {
      // Keep UI responsive; transient error doesn't break local reminder watcher
    } finally {
      setSavingPref(false);
    }
  }

  async function handleEnableBrowserPush() {
    if (!supportsBrowserPush) {
      setStatusMessage('Browser notifications are unavailable in this view; live in-app push alerts remain active.');
      return;
    }
    try {
      const result = await window.Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') {
        await savePreferences({ browserPush: true, pushEnabled: true });
        setStatusMessage('Browser push alerts enabled for scheduled medication reminders.');
      } else {
        await savePreferences({ browserPush: false });
        setStatusMessage('Browser permission was not granted; live in-app medication banners stay active.');
      }
    } catch {
      setStatusMessage('In-app medication push alerts active.');
    }
  }

  function handleTriggerTestAlert() {
    const sampleLog =
      todayLogs.find((l) => l.status === 'pending') ??
      todayLogs[0] ?? {
        id: 'test-dose',
        schedule_id: 'sched-test',
        medication_name: 'Metformin (Glycomet) 500 mg',
        scheduled_at: new Date().toISOString(),
        status: 'pending',
      };

    const preview: DueMedicationAlert = {
      logId: sampleLog.id,
      scheduleId: sampleLog.schedule_id,
      medicationName: sampleLog.medication_name,
      scheduledAt: sampleLog.scheduled_at,
      scheduledTimeLabel: `${sampleLog.scheduled_at.slice(11, 16)} UTC`,
      urgency: 'due_now',
      timingLabel: 'Test Push Alert · Due now',
      minutesDeltaFromDue: 0,
    };

    setTestAlert(preview);

    if (supportsBrowserPush && permission === 'granted') {
      try {
        const msg = formatPushNotificationMessage(preview);
        new window.Notification(msg.title, {
          body: msg.body,
          tag: 'veromed-dose-test',
        });
      } catch {
        // Fallback banner is already shown
      }
    }

    if (preferences.soundEnabled) {
      playGentleChime();
    }

    setStatusMessage(
      permission === 'granted'
        ? 'Push alert dispatched to browser Notification Center and live dashboard banner.'
        : 'Live medication push alert triggered inside dashboard banner.'
    );
  }

  function handleSnooze(logId: string) {
    const snoozeUntil = Date.now() + 10 * 60_000;
    setSnoozedUntilMap((prev) => ({ ...prev, [logId]: snoozeUntil }));
    dispatchedKeysRef.current.delete(`${logId}:due_now`);
    dispatchedKeysRef.current.delete(`${logId}:overdue`);
    dispatchedKeysRef.current.delete(`${logId}:upcoming`);
    if (testAlert?.logId === logId) {
      setTestAlert(null);
    }
    setStatusMessage('Medication reminder snoozed for 10 minutes.');
  }

  function handleDismiss(logId: string) {
    setDismissedIds((prev) => (prev.includes(logId) ? prev : [...prev, logId]));
    if (testAlert?.logId === logId) {
      setTestAlert(null);
    }
  }

  // Merge active due alerts + optional on-demand test alert without duplicates
  const visibleAlerts: DueMedicationAlert[] = useMemo(() => {
    if (!testAlert) return dueAlerts;
    const alreadyPresent = dueAlerts.some((a) => a.logId === testAlert.logId);
    return alreadyPresent ? dueAlerts : [testAlert, ...dueAlerts];
  }, [dueAlerts, testAlert]);

  const permissionLabel =
    permission === 'granted'
      ? 'Browser Push Connected'
      : permission === 'denied'
      ? 'Browser Push Blocked · In-App Banner Active'
      : permission === 'unsupported'
      ? 'In-App Push Banner Active'
      : 'Browser Push Not Yet Requested';

  return (
    <div className="space-y-4">
      {/* Patient Push Configuration & Live Monitor Strip */}
      {!isCaregiver && (
        <section
          aria-label="Medication Push Notification Settings"
          className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <span
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                preferences.pushEnabled
                  ? 'bg-teal-50 text-teal-700'
                  : 'bg-slate-100 text-slate-500'
              }`}
            >
              {preferences.pushEnabled ? (
                <BellRing className="w-4 h-4" />
              ) : (
                <BellOff className="w-4 h-4" />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                <h2 className="font-display text-sm font-bold text-slate-900">
                  Medication Schedule Push Alerts
                </h2>
                <span className="text-xs font-medium text-teal-700">
                  {preferences.pushEnabled ? 'Monitoring Active' : 'Paused'}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                {permissionLabel} · Alerts {preferences.leadMinutes === 0 ? 'at scheduled dose time' : `${preferences.leadMinutes} min before due time`} and while overdue.
              </p>
              {statusMessage && (
                <p role="status" className="text-xs font-medium text-teal-800 mt-1">
                  {statusMessage}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <label htmlFor="push-lead-select" className="sr-only">
              Reminder lead time
            </label>
            <select
              id="push-lead-select"
              value={preferences.leadMinutes}
              disabled={savingPref}
              onChange={(e) => void savePreferences({ leadMinutes: Number(e.target.value) })}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600 cursor-pointer"
            >
              <option value={0}>At due time (0 min)</option>
              <option value={5}>5 min before</option>
              <option value={15}>15 min before</option>
              <option value={30}>30 min before</option>
            </select>

            <button
              type="button"
              onClick={() => void savePreferences({ soundEnabled: !preferences.soundEnabled })}
              aria-pressed={preferences.soundEnabled}
              title={preferences.soundEnabled ? 'Mute reminder chime' : 'Enable reminder chime'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {preferences.soundEnabled ? (
                <Volume2 className="w-3.5 h-3.5 text-teal-700" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>{preferences.soundEnabled ? 'Chime On' : 'Muted'}</span>
            </button>

            <button
              type="button"
              onClick={() => void savePreferences({ pushEnabled: !preferences.pushEnabled })}
              aria-pressed={preferences.pushEnabled}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                preferences.pushEnabled
                  ? 'bg-teal-50 text-teal-800 border-teal-300 hover:bg-teal-100'
                  : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
              }`}
            >
              <Bell className="w-3.5 h-3.5" />
              <span>{preferences.pushEnabled ? 'Push On' : 'Push Off'}</span>
            </button>

            {supportsBrowserPush && permission === 'default' && (
              <button
                type="button"
                onClick={() => void handleEnableBrowserPush()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <BellRing className="w-3.5 h-3.5" />
                <span>Enable Browser Push</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleTriggerTestAlert}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5 text-teal-700" />
              <span>Test Push Alert</span>
            </button>
          </div>
        </section>
      )}

      {/* Live Medication Push Notification Alert Stack */}
      {visibleAlerts.length > 0 && (
        <section
          role="region"
          aria-live="polite"
          aria-label="Scheduled Medication Push Alerts"
          className="space-y-2.5"
        >
          {visibleAlerts.map((alert) => {
            const isOverdue = alert.urgency === 'overdue';
            const isDueNow = alert.urgency === 'due_now';
            const cardClasses = isOverdue
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : isDueNow
              ? 'bg-teal-50 border-teal-300 text-teal-950'
              : 'bg-white border-teal-200 text-slate-900';

            const iconClasses = isOverdue ? 'text-amber-700' : 'text-teal-700';

            return (
              <div
                key={`push-${alert.logId}`}
                data-testid="medication-push-alert"
                className={`border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${cardClasses}`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <BellRing className={`w-5 h-5 shrink-0 mt-0.5 ${iconClasses}`} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-mono tabular-nums">
                      <span className="font-semibold uppercase tracking-wide">
                        {isOverdue ? 'Dose Overdue' : isDueNow ? 'Scheduled Dose Due' : 'Upcoming Dose'}
                      </span>
                      <span aria-hidden="true" className="opacity-40">·</span>
                      <span>{alert.scheduledTimeLabel}</span>
                      <span aria-hidden="true" className="opacity-40">·</span>
                      <span className="font-semibold">{alert.timingLabel}</span>
                    </div>
                    <p className="font-display text-sm font-bold mt-0.5 truncate">
                      Time to take {alert.medicationName}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {alert.logId !== 'test-dose' && (
                    <button
                      type="button"
                      disabled={updatingId === alert.logId}
                      onClick={() => void onLogDose(alert.logId, 'taken')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Mark Taken</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleSnooze(alert.logId)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Snooze 10m</span>
                  </button>

                  <button
                    type="button"
                    aria-label={`Dismiss reminder for ${alert.medicationName}`}
                    onClick={() => handleDismiss(alert.logId)}
                    className="p-1.5 text-slate-500 hover:text-slate-800 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
};
