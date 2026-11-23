import crypto from 'node:crypto';
import { db } from './db';
import { buildReminderDedupeKey, generateOccurrencesForDate } from '../src/lib/adherence';
import { classifyExpiryWindow, isLowStock } from '../src/lib/inventoryRules';

export interface SchedulerRunSummary {
  ranAt: string;
  medRemindersCreated: number;
  apptRemindersCreated: number;
  personalExpiryAlertsCreated: number;
  pharmacyExpiryAlertsCreated: number;
  lowStockAlertsCreated: number;
  duplicatesSuppressed: number;
}

function insertNotificationIdempotent(params: {
  userId: string;
  kind: 'med_reminder' | 'appt_reminder' | 'expiry_alert' | 'low_stock' | 'caregiver_alert';
  title: string;
  body: string;
  scheduledAt: string;
  dedupeKey: string;
}): boolean {
  const existing = db
    .prepare('SELECT id FROM notifications WHERE dedupe_key = ?')
    .get(params.dedupeKey);
  if (existing) return false;

  db.prepare(
    `INSERT INTO notifications (id, user_id, kind, title, body, scheduled_at, channel, status, attempts, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'in_app', 'sent', 1, ?, ?)`
  ).run(
    `notif-${crypto.randomUUID()}`,
    params.userId,
    params.kind,
    params.title,
    params.body,
    params.scheduledAt,
    params.dedupeKey,
    new Date().toISOString()
  );
  return true;
}

export function runBackgroundScheduler(): SchedulerRunSummary {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  let medRemindersCreated = 0;
  let apptRemindersCreated = 0;
  let personalExpiryAlertsCreated = 0;
  let pharmacyExpiryAlertsCreated = 0;
  let lowStockAlertsCreated = 0;
  let duplicatesSuppressed = 0;

  // 1. Medication schedule reminders & pending dose log generation for today
  const activeSchedules = db
    .prepare(
      `SELECT s.*, m.medicine_name, m.strength, m.status as med_status
       FROM medication_schedules s
       JOIN patient_medications m ON m.id = s.medication_id
       WHERE s.enabled = 1 AND m.status = 'active'`
    )
    .all() as Array<{
    id: string;
    medication_id: string;
    patient_id: string;
    schedule_type: 'once_daily' | 'multiple_daily' | 'interval_based' | 'weekly' | 'custom';
    times_json: string;
    interval_hours: number | null;
    days_of_week_json: string | null;
    timezone: string;
    start_date: string;
    end_date: string | null;
    enabled: number;
    medicine_name: string;
    strength: string;
  }>;

  for (const sched of activeSchedules) {
    const occs = generateOccurrencesForDate(
      {
        id: sched.id,
        medicationId: sched.medication_id,
        scheduleType: sched.schedule_type,
        times: JSON.parse(sched.times_json),
        intervalHours: sched.interval_hours ?? undefined,
        daysOfWeek: sched.days_of_week_json ? JSON.parse(sched.days_of_week_json) : undefined,
        timezone: sched.timezone,
        startDate: sched.start_date,
        endDate: sched.end_date,
        enabled: sched.enabled === 1,
      },
      todayStr
    );

    for (const scheduledAt of occs) {
      const logKey = `${sched.id}:${scheduledAt}`;
      const existingLog = db
        .prepare('SELECT id FROM medication_logs WHERE idempotency_key = ? OR (schedule_id = ? AND scheduled_at = ?)')
        .get(logKey, sched.id, scheduledAt);
      if (!existingLog) {
        db.prepare(
          `INSERT INTO medication_logs (id, schedule_id, patient_id, medication_name, scheduled_at, status, idempotency_key)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`
        ).run(
          `log-${crypto.randomUUID()}`,
          sched.id,
          sched.patient_id,
          `${sched.medicine_name} ${sched.strength}`.trim(),
          scheduledAt,
          logKey
        );
      }

      const dedupeKey = buildReminderDedupeKey(sched.patient_id, 'med', sched.id, scheduledAt);
      const inserted = insertNotificationIdempotent({
        userId: sched.patient_id,
        kind: 'med_reminder',
        title: 'Scheduled Dose Reminder',
        body: `Scheduled medication time at ${scheduledAt.slice(11, 16)} UTC. Open VeroMed to log your dose.`,
        scheduledAt,
        dedupeKey,
      });
      if (inserted) medRemindersCreated += 1;
      else duplicatesSuppressed += 1;
    }
  }

  // 2. Appointment reminders (24h & 2h offsets for non-cancelled appointments)
  const appointments = db
    .prepare(
      `SELECT id, patient_id, provider, facility, start_at, reminder_offsets_json, status
       FROM appointments
       WHERE status IN ('scheduled', 'rescheduled')`
    )
    .all() as Array<{
    id: string;
    patient_id: string;
    provider: string;
    facility: string;
    start_at: string;
    reminder_offsets_json: string;
    status: string;
  }>;

  for (const appt of appointments) {
    const startMs = Date.parse(appt.start_at);
    if (!Number.isFinite(startMs) || startMs < now.getTime()) continue;
    const offsets = JSON.parse(appt.reminder_offsets_json) as number[];
    for (const mins of offsets) {
      const triggerAt = new Date(startMs - mins * 60 * 1000).toISOString();
      const dedupeKey = buildReminderDedupeKey(appt.patient_id, 'appt', appt.id, `${mins}:${appt.start_at}`);
      const inserted = insertNotificationIdempotent({
        userId: appt.patient_id,
        kind: 'appt_reminder',
        title: `Upcoming Appointment (${mins >= 60 ? `${Math.round(mins / 60)}h` : `${mins}m`} notice)`,
        body: `Visit with ${appt.provider} at ${appt.facility} on ${appt.start_at.slice(0, 10)}.`,
        scheduledAt: triggerAt,
        dedupeKey,
      });
      if (inserted) apptRemindersCreated += 1;
      else duplicatesSuppressed += 1;
    }
  }

  // 3. Personal medicine expiry alerts (180, 90, 60, 30, 7, expired)
  const personalItems = db
    .prepare('SELECT id, patient_id, medicine_name, expiry_date FROM personal_inventory')
    .all() as Array<{ id: string; patient_id: string; medicine_name: string; expiry_date: string }>;

  for (const p of personalItems) {
    const cls = classifyExpiryWindow(p.expiry_date, todayStr);
    if (cls.window !== 'healthy') {
      const dedupeKey = buildReminderDedupeKey(p.patient_id, 'expiry', p.id, `${cls.window}:${todayStr}`);
      const inserted = insertNotificationIdempotent({
        userId: p.patient_id,
        kind: 'expiry_alert',
        title: `Personal Stock ${cls.label}`,
        body: `${p.medicine_name} (expiry ${p.expiry_date}) — ${cls.window === 'expired' ? 'Expired: remove from cabinet and do not use.' : `Expires in ${cls.daysRemaining} day(s).`}`,
        scheduledAt: now.toISOString(),
        dedupeKey,
      });
      if (inserted) personalExpiryAlertsCreated += 1;
      else duplicatesSuppressed += 1;
    }
  }

  // 4. Pharmacy batch expiry & low-stock alerts (notifies lead pharmacist members)
  const pharmacyMembers = db
    .prepare(`SELECT pharmacy_id, user_id FROM pharmacy_members WHERE status = 'active'`)
    .all() as Array<{ pharmacy_id: string; user_id: string }>;

  const batches = db
    .prepare(
      `SELECT b.id, b.pharmacy_id, b.batch_number, b.expiry_date, b.quantity, i.medicine_name
       FROM inventory_batches b
       JOIN inventory_items i ON i.id = b.item_id
       WHERE b.quantity > 0`
    )
    .all() as Array<{
    id: string;
    pharmacy_id: string;
    batch_number: string;
    expiry_date: string;
    quantity: number;
    medicine_name: string;
  }>;

  for (const b of batches) {
    const cls = classifyExpiryWindow(b.expiry_date, todayStr);
    if (cls.window !== 'healthy') {
      const targets = pharmacyMembers.filter((m) => m.pharmacy_id === b.pharmacy_id);
      for (const m of targets) {
        const dedupeKey = buildReminderDedupeKey(m.user_id, 'expiry', b.id, `${cls.window}:${todayStr}`);
        const inserted = insertNotificationIdempotent({
          userId: m.user_id,
          kind: 'expiry_alert',
          title: `Batch Expiry: ${b.medicine_name}`,
          body: `Batch ${b.batch_number} (${b.quantity} units) — ${cls.label} (${b.expiry_date}).`,
          scheduledAt: now.toISOString(),
          dedupeKey,
        });
        if (inserted) pharmacyExpiryAlertsCreated += 1;
        else duplicatesSuppressed += 1;
      }
    }
  }

  const stockItems = db
    .prepare(
      `SELECT i.id, i.pharmacy_id, i.medicine_name, i.min_threshold,
              COALESCE(SUM(CASE WHEN b.expiry_date > ? THEN b.quantity ELSE 0 END), 0) as eligible_qty
       FROM inventory_items i
       LEFT JOIN inventory_batches b ON b.item_id = i.id
       GROUP BY i.id`
    )
    .all(todayStr) as Array<{
    id: string;
    pharmacy_id: string;
    medicine_name: string;
    min_threshold: number;
    eligible_qty: number;
  }>;

  for (const item of stockItems) {
    if (isLowStock(item.eligible_qty, item.min_threshold)) {
      const targets = pharmacyMembers.filter((m) => m.pharmacy_id === item.pharmacy_id);
      for (const m of targets) {
        const dedupeKey = buildReminderDedupeKey(m.user_id, 'low_stock', item.id, todayStr);
        const inserted = insertNotificationIdempotent({
          userId: m.user_id,
          kind: 'low_stock',
          title: `Low Stock Alert: ${item.medicine_name}`,
          body: `Eligible non-expired stock (${item.eligible_qty}) is at or below threshold (${item.min_threshold}).`,
          scheduledAt: now.toISOString(),
          dedupeKey,
        });
        if (inserted) lowStockAlertsCreated += 1;
        else duplicatesSuppressed += 1;
      }
    }
  }

  return {
    ranAt: now.toISOString(),
    medRemindersCreated,
    apptRemindersCreated,
    personalExpiryAlertsCreated,
    pharmacyExpiryAlertsCreated,
    lowStockAlertsCreated,
    duplicatesSuppressed,
  };
}
