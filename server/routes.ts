import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import {
  db,
  hashPassword,
  UPLOADS_DIR,
  verifyPassword,
} from './db';
import {
  authenticateRequest,
  type AuthedRequest,
  createSession,
  logAudit,
  rateLimit,
  requireRole,
  resolveAuthorizedPatientId,
  revokeSession,
  type UserRole,
} from './auth';
import { askHealthcareAssistant, extractPrescriptionWithGemini } from './ai';
import { runBackgroundScheduler } from './scheduler';
import {
  calculateAdherence,
  type DoseLogRecord,
  type DoseStatus,
  validateScheduleRule,
} from '../src/lib/adherence';
import {
  classifyExpiryWindow,
  isLowStock,
  type TransactionType,
  validateAndApplyStockTransaction,
} from '../src/lib/inventoryRules';
import {
  type ForecastModelName,
  generateInventoryForecast,
} from '../src/lib/forecasting';
import { normalizeNotificationPreferences } from '../src/lib/pushNotifications';
import {
  enrichPharmacyWithMapMetadata,
  filterAndSortNearbyPharmacies,
} from '../src/lib/pharmacyLocator';
import {
  matchMedicinesToPharmacies,
  type PharmacyInventoryStockRow,
  type PharmacyMedicineSuggestion,
} from '../src/lib/medicineAvailability';
import {
  getSessionRemainingDays,
  getSessionRemainingHours,
  SESSION_DURATION_DAYS,
  SHORT_SESSION_HOURS,
} from '../src/lib/session';
import {
  checkMedicationInteractions,
  VERIFIED_INTERACTION_SOURCES,
} from '../src/lib/interactions';
import {
  evaluatePrescriptionSupply,
  type SupplyMedicationInput,
  type SupplyScheduleInput,
} from '../src/lib/refillSupply';

const ALLOWED_UPLOAD_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
  'image/svg+xml',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_UPLOAD_MIMES.has(file.mimetype)) {
      cb(new Error('Unsupported file type. Allowed: JPG, PNG, WEBP, PDF, TXT, SVG.'));
      return;
    }
    cb(null, true);
  },
});

function saveUploadedBuffer(buffer: Buffer, extHint: string): string {
  const safeExt = extHint.replace(/[^a-z0-9.]/gi, '').slice(0, 10) || '.bin';
  const fileKey = `${crypto.randomUUID()}${safeExt.startsWith('.') ? safeExt : `.${safeExt}`}`;
  const resolved = path.resolve(UPLOADS_DIR, fileKey);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error('Invalid upload storage path.');
  }
  fs.writeFileSync(resolved, buffer);
  return fileKey;
}

function readUploadedBuffer(fileKey: string): Buffer | null {
  if (fileKey.startsWith('sample-') || fileKey.startsWith('seed-')) {
    return null;
  }
  const safeKey = path.basename(fileKey);
  const resolved = path.resolve(UPLOADS_DIR, safeKey);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep)) {
    return null;
  }
  if (!fs.existsSync(resolved)) return null;
  return fs.readFileSync(resolved);
}

function getTodayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildPharmacySuggestionsForMedicines(
  patientId: string,
  medicines: Array<{ medicineName: string; strength?: string }>
): { suggestions: PharmacyMedicineSuggestion[]; preferredPharmacyId: string | null } {
  const todayStr = getTodayStr();
  const prefRow = db
    .prepare('SELECT preferred_pharmacy_id FROM patient_profiles WHERE user_id = ?')
    .get(patientId) as { preferred_pharmacy_id?: string | null } | undefined;

  const rawPharmacies = db
    .prepare(
      `SELECT id, tenant_name, license_number, address
       FROM pharmacies
       WHERE status = 'active'
       ORDER BY tenant_name ASC`
    )
    .all() as Array<{ id: string; tenant_name: string; license_number: string; address: string }>;

  const stockRows = db
    .prepare(
      `SELECT i.pharmacy_id,
              i.medicine_name,
              COALESCE(SUM(CASE WHEN b.expiry_date > ? THEN b.quantity ELSE 0 END), 0) as available_quantity,
              i.unit,
              i.unit_sell_price,
              MIN(CASE WHEN b.expiry_date > ? AND b.quantity > 0 THEN b.expiry_date ELSE NULL END) as earliest_expiry
       FROM inventory_items i
       JOIN inventory_batches b ON b.item_id = i.id
       GROUP BY i.id`
    )
    .all(todayStr, todayStr) as PharmacyInventoryStockRow[];

  const preferredPharmacyId = prefRow?.preferred_pharmacy_id || rawPharmacies[0]?.id || null;
  const enrichedPharmacies = rawPharmacies.map(enrichPharmacyWithMapMetadata);

  return {
    suggestions: matchMedicinesToPharmacies({
      medicines,
      pharmacies: enrichedPharmacies,
      stockRows,
      preferredPharmacyId,
    }),
    preferredPharmacyId,
  };
}

export function createApiRouter(): express.Router {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ---------------------------------------------------------------------------
  // MODULE 1: Authentication & User Management
  // ---------------------------------------------------------------------------
  router.post('/auth/register', rateLimit('auth_reg', 20, 60_000), (req, res) => {
    const { email, password, fullName, role, pharmacyName, termsAccepted, rememberMe } = req.body as {
      email?: string;
      password?: string;
      fullName?: string;
      role?: UserRole;
      pharmacyName?: string;
      termsAccepted?: boolean;
      rememberMe?: boolean;
    };

    if (!email || !password || !fullName || password.length < 8) {
      res.status(400).json({
        error: 'Valid email, full name, and password (minimum 8 characters) are required.',
      });
      return;
    }

    if (termsAccepted !== true) {
      res.status(400).json({
        error: 'Please review and accept the Terms & Conditions before creating an account.',
      });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const targetRole: UserRole =
      role === 'pharmacist' || role === 'caregiver' ? role : 'patient';

    const existing = db
      .prepare('SELECT id FROM users WHERE email = ?')
      .get(normalizedEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const userId = `usr-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    let pharmacyId: string | null = null;

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
      ).run(userId, normalizedEmail, hashPassword(password), fullName.trim(), targetRole, now, now);

      if (targetRole === 'patient') {
        db.prepare(
          `INSERT INTO patient_profiles (user_id, display_name, timezone, notification_prefs_json)
           VALUES (?, ?, 'UTC', ?)`
        ).run(
          userId,
          fullName.trim(),
          JSON.stringify({ inApp: true, email: true, browserPush: false, quietStart: '22:30', quietEnd: '06:30' })
        );
      } else if (targetRole === 'pharmacist') {
        pharmacyId = `pharm-${crypto.randomUUID()}`;
        db.prepare(
          `INSERT INTO pharmacies (id, tenant_name, license_number, address, timezone, status)
           VALUES (?, ?, ?, 'Pending Verification', 'UTC', 'active')`
        ).run(pharmacyId, (pharmacyName || `${fullName.trim()} Pharmacy`).trim(), `LIC-${Date.now().toString().slice(-6)}`);
        db.prepare(
          `INSERT INTO pharmacy_members (pharmacy_id, user_id, member_role, status)
           VALUES (?, ?, 'lead_pharmacist', 'active')`
        ).run(pharmacyId, userId);
      }
    });
    tx();

    const session = createSession(userId, Boolean(rememberMe));
    logAudit({ id: userId, email: normalizedEmail, role: targetRole }, 'auth.register', `user:${userId}`, 'success', {
      termsAccepted: true,
      rememberMe: session.rememberMe,
      durationHours: session.durationHours,
    });
    res.status(201).json({
      token: session.token,
      expiresAt: session.expiresAt,
      rememberMe: session.rememberMe,
      sessionDurationDays: session.durationDays,
      sessionDurationHours: session.durationHours,
      user: {
        id: userId,
        email: normalizedEmail,
        fullName: fullName.trim(),
        role: targetRole,
        pharmacyId,
      },
    });
  });

  router.post('/auth/login', rateLimit('auth_login', 30, 60_000), (req, res) => {
    const { email, password, rememberMe } = req.body as {
      email?: string;
      password?: string;
      rememberMe?: boolean;
    };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const row = db
      .prepare(
        `SELECT u.id, u.email, u.password_hash, u.full_name, u.role, u.status, pm.pharmacy_id
         FROM users u
         LEFT JOIN pharmacy_members pm ON pm.user_id = u.id AND pm.status = 'active'
         WHERE u.email = ?`
      )
      .get(normalizedEmail) as
      | {
          id: string;
          email: string;
          password_hash: string;
          full_name: string;
          role: UserRole;
          status: string;
          pharmacy_id: string | null;
        }
      | undefined;

    if (!row || row.status !== 'active' || !verifyPassword(password, row.password_hash)) {
      logAudit({ email: normalizedEmail }, 'auth.login', 'session', 'denied');
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const session = createSession(row.id, Boolean(rememberMe));
    logAudit(
      { id: row.id, email: row.email, role: row.role },
      'auth.login',
      'session',
      'success',
      {
        rememberMe: session.rememberMe,
        durationHours: session.durationHours,
      }
    );
    res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      rememberMe: session.rememberMe,
      sessionDurationDays: session.durationDays,
      sessionDurationHours: session.durationHours,
      user: {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        role: row.role,
        pharmacyId: row.pharmacy_id,
      },
    });
  });

  router.post('/auth/verify-credentials', rateLimit('auth_verify', 120, 60_000), (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password || password.length < 8) {
      res.json({ valid: false });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const row = db
      .prepare(
        `SELECT full_name, password_hash, role, status
         FROM users
         WHERE email = ?`
      )
      .get(normalizedEmail) as
      | {
          full_name: string;
          password_hash: string;
          role: UserRole;
          status: string;
        }
      | undefined;

    if (!row || row.status !== 'active' || !verifyPassword(password, row.password_hash)) {
      res.json({ valid: false });
      return;
    }

    res.json({
      valid: true,
      fullName: row.full_name,
      role: row.role,
    });
  });

  router.post('/auth/logout', authenticateRequest, (req: AuthedRequest, res) => {
    const token = req.headers.authorization?.slice(7).trim();
    if (token) revokeSession(token);
    logAudit(req.user ?? null, 'auth.logout', 'session', 'success');
    res.json({ ok: true });
  });

  router.get('/auth/me', authenticateRequest, (req: AuthedRequest, res) => {
    const expiresAt = req.session?.expiresAt ?? '';
    const rememberMe = req.session?.rememberMe ?? false;
    res.json({
      user: req.user,
      session: {
        expiresAt,
        createdAt: req.session?.createdAt ?? '',
        rememberMe,
        durationDays: req.session?.durationDays ?? (rememberMe ? SESSION_DURATION_DAYS : 1),
        durationHours: req.session?.durationHours ?? (rememberMe ? SESSION_DURATION_DAYS * 24 : SHORT_SESSION_HOURS),
        remainingDays: getSessionRemainingDays(expiresAt),
        remainingHours: getSessionRemainingHours(expiresAt),
      },
    });
  });

  // Password reset never discloses whether an account exists (AC-01)
  router.post('/auth/forgot-password', rateLimit('auth_reset', 10, 60_000), (req, res) => {
    const { email } = req.body as { email?: string };
    logAudit({ email: email ?? 'unknown' }, 'auth.forgot_password', 'user', 'success');
    res.json({
      message:
        'If an active account matches that email address, password reset instructions have been queued.',
    });
  });

  // ---------------------------------------------------------------------------
  // MODULE 10 & PROFILE: Patient Profile, Dashboard, Timeline, Export
  // ---------------------------------------------------------------------------
  router.get('/patients/me', authenticateRequest, (req: AuthedRequest, res) => {
    const access = resolveAuthorizedPatientId(
      req.user!,
      req.query.patientId as string | undefined,
      'emergency_info'
    );
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const profile = db
      .prepare('SELECT * FROM patient_profiles WHERE user_id = ?')
      .get(access.patientId) as Record<string, unknown> | undefined;

    const linkedPatients =
      req.user!.role === 'caregiver'
        ? db
            .prepare(
              `SELECT cr.*, pp.display_name as patient_name
               FROM caregiver_relationships cr
               JOIN patient_profiles pp ON pp.user_id = cr.patient_id
               WHERE cr.caregiver_user_id = ? AND cr.consent_status = 'active'`
            )
            .all(req.user!.id)
        : [];

    res.json({ profile, linkedPatients, isCaregiverView: access.isCaregiver });
  });

  router.patch('/patients/me', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const {
      displayName,
      dob,
      timezone,
      bloodGroup,
      emergencyContactName,
      emergencyContactPhone,
    } = req.body as Record<string, string | undefined>;

    db.prepare(
      `UPDATE patient_profiles
       SET display_name = COALESCE(?, display_name),
           dob = COALESCE(?, dob),
           timezone = COALESCE(?, timezone),
           blood_group = COALESCE(?, blood_group),
           emergency_contact_name = COALESCE(?, emergency_contact_name),
           emergency_contact_phone = COALESCE(?, emergency_contact_phone)
       WHERE user_id = ?`
    ).run(
      displayName ?? null,
      dob ?? null,
      timezone ?? null,
      bloodGroup ?? null,
      emergencyContactName ?? null,
      emergencyContactPhone ?? null,
      req.user!.id
    );

    logAudit(req.user!, 'patient.profile_update', `patient:${req.user!.id}`, 'success');
    const updated = db
      .prepare('SELECT * FROM patient_profiles WHERE user_id = ?')
      .get(req.user!.id);
    res.json({ profile: updated });
  });

  router.get('/patients/:id/dashboard', authenticateRequest, (req: AuthedRequest, res) => {
    const requestedId = req.params.id;
    const access = resolveAuthorizedPatientId(req.user!, requestedId, 'schedules');
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const patientId = access.patientId;
    const todayStr = getTodayStr();

    const activeMedicationsRaw = db
      .prepare(
        `SELECT * FROM patient_medications WHERE patient_id = ? AND status = 'active' ORDER BY created_at DESC`
      )
      .all(patientId) as Array<SupplyMedicationInput & Record<string, unknown>>;

    const medicationSchedules = db
      .prepare(
        `SELECT medication_id, schedule_type, times_json, interval_hours, days_of_week_json, enabled
         FROM medication_schedules WHERE patient_id = ?`
      )
      .all(patientId) as SupplyScheduleInput[];

    const todayLogs = db
      .prepare(
        `SELECT * FROM medication_logs WHERE patient_id = ? AND substr(scheduled_at, 1, 10) = ? ORDER BY scheduled_at ASC`
      )
      .all(patientId, todayStr) as Array<Record<string, unknown>>;

    const allLogsRaw = db
      .prepare(
        `SELECT id, schedule_id as scheduleId, scheduled_at as scheduledAt, status, recorded_at as recordedAt, note
         FROM medication_logs WHERE patient_id = ? ORDER BY scheduled_at DESC`
      )
      .all(patientId) as DoseLogRecord[];

    const adherence = calculateAdherence(allLogsRaw);

    const appointments = db
      .prepare(
        `SELECT * FROM appointments WHERE patient_id = ? AND status IN ('scheduled', 'rescheduled') AND start_at >= ? ORDER BY start_at ASC LIMIT 5`
      )
      .all(patientId, new Date().toISOString());

    const personalStock = db
      .prepare('SELECT * FROM personal_inventory WHERE patient_id = ? ORDER BY expiry_date ASC')
      .all(patientId) as Array<{
      id: string;
      medicine_name: string;
      quantity: number;
      unit: string;
      min_threshold: number;
      expiry_date: string;
    }>;

    const activeMedications = activeMedicationsRaw.map((med) => {
      const sched = medicationSchedules.find((s) => s.medication_id === med.id) ?? null;
      const supply = evaluatePrescriptionSupply({
        medication: med,
        schedule: sched,
        personalInventory: personalStock,
        todayDate: todayStr,
      });
      return {
        ...med,
        supply,
      };
    });

    const refillDueCount = activeMedications.filter((m) => m.supply.isRefillDue).length;

    const personalAlerts = personalStock
      .map((item) => {
        const exp = classifyExpiryWindow(item.expiry_date, todayStr);
        const low = isLowStock(item.quantity, item.min_threshold);
        return {
          ...item,
          expiryWindow: exp.window,
          expiryLabel: exp.label,
          daysRemaining: exp.daysRemaining,
          isLowStock: low,
        };
      })
      .filter((a) => a.expiryWindow !== 'healthy' || a.isLowStock);

    const pendingDraftsCount = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM prescriptions WHERE patient_id = ? AND ocr_status = 'draft_ready'`
        )
        .get(patientId) as { c: number }
    ).c;

    const unreadNotificationsCount = (
      db
        .prepare(
          `SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND status != 'read'`
        )
        .get(req.user!.id) as { c: number }
    ).c;

    const profileRow = db
      .prepare('SELECT notification_prefs_json, preferred_pharmacy_id FROM patient_profiles WHERE user_id = ?')
      .get(patientId) as
      | { notification_prefs_json?: string; preferred_pharmacy_id?: string | null }
      | undefined;

    let parsedPrefs: unknown = {};
    try {
      parsedPrefs = profileRow?.notification_prefs_json
        ? JSON.parse(profileRow.notification_prefs_json)
        : {};
    } catch {
      parsedPrefs = {};
    }
    const notificationPreferences = normalizeNotificationPreferences(parsedPrefs);

    const refillRequests = db
      .prepare(
        `SELECT * FROM refill_requests WHERE patient_id = ? ORDER BY requested_at DESC LIMIT 20`
      )
      .all(patientId);

    const pharmacies = db
      .prepare(
        `SELECT id, tenant_name, license_number, address FROM pharmacies WHERE status = 'active' ORDER BY tenant_name ASC`
      )
      .all() as Array<{ id: string; tenant_name: string; license_number: string; address: string }>;

    const preferredPharmacyId = profileRow?.preferred_pharmacy_id || pharmacies[0]?.id || null;

    res.json({
      todayDate: todayStr,
      activeMedications,
      refillDueCount,
      todayLogs,
      adherence,
      upcomingAppointments: appointments,
      personalAlerts,
      pendingDraftsCount,
      unreadNotificationsCount,
      notificationPreferences,
      refillRequests,
      pharmacies,
      preferredPharmacyId,
    });
  });

  router.get('/patients/:id/timeline', authenticateRequest, (req: AuthedRequest, res) => {
    const access = resolveAuthorizedPatientId(req.user!, req.params.id, 'medical_history');
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const patientId = access.patientId;
    const docs = db
      .prepare('SELECT * FROM medical_documents WHERE patient_id = ?')
      .all(patientId) as Array<Record<string, unknown>>;
    const conditions = db
      .prepare('SELECT * FROM medical_conditions WHERE patient_id = ?')
      .all(patientId) as Array<Record<string, unknown>>;
    const appointments = db
      .prepare('SELECT * FROM appointments WHERE patient_id = ?')
      .all(patientId) as Array<Record<string, unknown>>;
    const prescriptions = db
      .prepare('SELECT * FROM prescriptions WHERE patient_id = ?')
      .all(patientId) as Array<Record<string, unknown>>;

    const timeline = [
      ...docs.map((d) => ({
        id: d.id,
        kind: 'document',
        date: (d.document_date as string) || (d.uploaded_at as string).slice(0, 10),
        title: d.title as string,
        subtitle: `${d.category} · ${d.provider || 'Self-uploaded'}`,
        detail: (d.ocr_text as string).slice(0, 180),
      })),
      ...conditions.map((c) => ({
        id: c.id,
        kind: 'condition',
        date: (c.onset_date as string) || 'Undated',
        title: c.condition_name as string,
        subtitle: `Condition (${c.status})`,
        detail: (c.notes as string) || '',
      })),
      ...appointments.map((a) => ({
        id: a.id,
        kind: 'appointment',
        date: (a.start_at as string).slice(0, 10),
        title: `${a.provider} — ${a.appointment_type}`,
        subtitle: `${a.facility} (${a.status})`,
        detail: (a.notes as string) || '',
      })),
      ...prescriptions.map((p) => ({
        id: p.id,
        kind: 'prescription',
        date: (p.document_date as string) || (p.upload_date as string),
        title: `Prescription: ${p.file_name}`,
        subtitle: `${p.doctor_name || 'Unknown Prescriber'} · Status: ${p.ocr_status}`,
        detail: (p.raw_text as string) || '',
      })),
    ].sort((a, b) => {
      if (a.date === 'Undated') return 1;
      if (b.date === 'Undated') return -1;
      return b.date.localeCompare(a.date);
    });

    res.json({ timeline });
  });

  // ---------------------------------------------------------------------------
  // MODULE 2: Medicine Catalogue & Patient Medications + Schedules
  // ---------------------------------------------------------------------------
  router.get('/medicines', authenticateRequest, (req, res) => {
    const q = ((req.query.q as string) || '').trim().toLowerCase();
    const rows = q
      ? db
          .prepare(
            `SELECT * FROM medicine_catalog
             WHERE LOWER(generic_name) LIKE ? OR LOWER(brand_name) LIKE ? OR LOWER(active_ingredients) LIKE ?
             ORDER BY generic_name ASC`
          )
          .all(`%${q}%`, `%${q}%`, `%${q}%`)
      : db.prepare('SELECT * FROM medicine_catalog ORDER BY generic_name ASC').all();
    res.json({ medicines: rows });
  });

  router.post('/medicines', authenticateRequest, (req: AuthedRequest, res) => {
    const { genericName, brandName, activeIngredients, strength, form, category } = req.body as Record<
      string,
      string | undefined
    >;
    if (!genericName || !strength || !form) {
      res.status(400).json({ error: 'genericName, strength, and form are required.' });
      return;
    }
    const id = `cat-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO medicine_catalog (id, generic_name, brand_name, active_ingredients, strength, form, category, source, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'user_custom', ?)`
    ).run(
      id,
      genericName.trim(),
      (brandName || genericName).trim(),
      (activeIngredients || genericName).trim(),
      strength.trim(),
      form.trim(),
      (category || 'Custom').trim(),
      req.user!.id
    );
    res.status(201).json({
      medicine: db.prepare('SELECT * FROM medicine_catalog WHERE id = ?').get(id),
    });
  });

  router.get('/patient-medications', authenticateRequest, (req: AuthedRequest, res) => {
    const access = resolveAuthorizedPatientId(
      req.user!,
      req.query.patientId as string | undefined,
      'schedules'
    );
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const meds = db
      .prepare('SELECT * FROM patient_medications WHERE patient_id = ? ORDER BY created_at DESC')
      .all(access.patientId) as Array<Record<string, unknown>>;

    const schedules = db
      .prepare('SELECT * FROM medication_schedules WHERE patient_id = ?')
      .all(access.patientId) as Array<Record<string, unknown>>;

    res.json({
      medications: meds.map((m) => ({
        ...m,
        schedules: schedules.filter((s) => s.medication_id === m.id),
      })),
    });
  });

  router.post('/patient-medications', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const {
      medicineId,
      medicineName,
      strength,
      prescribedDose,
      route,
      frequencyLabel,
      startDate,
      endDate,
      prescriber,
      instructions,
      patientNotes,
      scheduleType,
      times,
      intervalHours,
      daysOfWeek,
      timezone,
    } = req.body as {
      medicineId?: string;
      medicineName?: string;
      strength?: string;
      prescribedDose?: string;
      route?: string;
      frequencyLabel?: string;
      startDate?: string;
      endDate?: string;
      prescriber?: string;
      instructions?: string;
      patientNotes?: string;
      scheduleType?: 'once_daily' | 'multiple_daily' | 'interval_based' | 'weekly' | 'custom';
      times?: string[];
      intervalHours?: number;
      daysOfWeek?: number[];
      timezone?: string;
    };

    if (!medicineName || !strength || !prescribedDose || !startDate) {
      res.status(400).json({
        error: 'medicineName, strength, prescribedDose, and startDate are required.',
      });
      return;
    }

    const schedValidation = validateScheduleRule({
      scheduleType: scheduleType ?? 'once_daily',
      startDate,
      endDate: endDate || null,
      times: times && times.length > 0 ? times : ['08:00'],
      intervalHours,
      daysOfWeek,
    });

    if (!schedValidation.valid) {
      res.status(400).json({ error: schedValidation.errors.join(' ') });
      return;
    }

    const medId = `pmed-${crypto.randomUUID()}`;
    const schedId = `sched-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare(
        `INSERT INTO patient_medications (id, patient_id, medicine_id, medicine_name, strength, prescribed_dose, route, frequency_label, start_date, end_date, prescriber, instructions, patient_notes, status, source_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'manual', ?, ?)`
      ).run(
        medId,
        req.user!.id,
        medicineId ?? null,
        medicineName.trim(),
        strength.trim(),
        prescribedDose.trim(),
        (route || 'Oral').trim(),
        (frequencyLabel || 'Scheduled').trim(),
        startDate,
        endDate || null,
        prescriber?.trim() || null,
        instructions?.trim() || null,
        patientNotes?.trim() || null,
        now,
        now
      );

      db.prepare(
        `INSERT INTO medication_schedules (id, medication_id, patient_id, schedule_type, times_json, interval_hours, days_of_week_json, timezone, start_date, end_date, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`
      ).run(
        schedId,
        medId,
        req.user!.id,
        scheduleType ?? 'once_daily',
        JSON.stringify(times && times.length > 0 ? times : ['08:00']),
        intervalHours ?? null,
        daysOfWeek ? JSON.stringify(daysOfWeek) : null,
        timezone || 'UTC',
        startDate,
        endDate || null,
        now
      );
    })();

    runBackgroundScheduler();
    logAudit(req.user!, 'medication.create', `patient_medication:${medId}`, 'success');
    res.status(201).json({
      medication: db.prepare('SELECT * FROM patient_medications WHERE id = ?').get(medId),
      schedule: db.prepare('SELECT * FROM medication_schedules WHERE id = ?').get(schedId),
    });
  });

  router.patch('/patient-medications/:id', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const existing = db
      .prepare('SELECT * FROM patient_medications WHERE id = ? AND patient_id = ?')
      .get(req.params.id, req.user!.id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Medication record not found.' });
      return;
    }

    const { status, prescribedDose, instructions, patientNotes } = req.body as {
      status?: 'active' | 'paused' | 'completed' | 'discontinued';
      prescribedDose?: string;
      instructions?: string;
      patientNotes?: string;
    };

    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `UPDATE patient_medications
         SET status = COALESCE(?, status),
             prescribed_dose = COALESCE(?, prescribed_dose),
             instructions = COALESCE(?, instructions),
             patient_notes = COALESCE(?, patient_notes),
             updated_at = ?
         WHERE id = ?`
      ).run(
        status ?? null,
        prescribedDose ?? null,
        instructions ?? null,
        patientNotes ?? null,
        now,
        req.params.id
      );

      if (status && status !== 'active') {
        db.prepare('UPDATE medication_schedules SET enabled = 0 WHERE medication_id = ?').run(
          req.params.id
        );
      } else if (status === 'active') {
        db.prepare('UPDATE medication_schedules SET enabled = 1 WHERE medication_id = ?').run(
          req.params.id
        );
      }
    })();

    logAudit(req.user!, 'medication.update', `patient_medication:${req.params.id}`, 'success', {
      status,
    });
    res.json({
      medication: db.prepare('SELECT * FROM patient_medications WHERE id = ?').get(req.params.id),
    });
  });

  // ---------------------------------------------------------------------------
  // MODULE 3: Medication Dose Logs & Adherence
  // ---------------------------------------------------------------------------
  router.get('/medication-logs', authenticateRequest, (req: AuthedRequest, res) => {
    const access = resolveAuthorizedPatientId(
      req.user!,
      req.query.patientId as string | undefined,
      'dose_history'
    );
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const logs = db
      .prepare('SELECT * FROM medication_logs WHERE patient_id = ? ORDER BY scheduled_at DESC LIMIT 200')
      .all(access.patientId);

    res.json({ logs });
  });

  router.post('/medication-logs', authenticateRequest, (req: AuthedRequest, res) => {
    const { patientId: reqPatientId, scheduleId, scheduledAt, status, note } = req.body as {
      patientId?: string;
      scheduleId?: string;
      scheduledAt?: string;
      status?: DoseStatus;
      note?: string;
    };

    const access = resolveAuthorizedPatientId(req.user!, reqPatientId, 'dose_history');
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    if (!scheduleId || !scheduledAt || !status) {
      res.status(400).json({ error: 'scheduleId, scheduledAt, and status are required.' });
      return;
    }

    const sched = db
      .prepare(
        `SELECT s.id, m.medicine_name, m.strength
         FROM medication_schedules s
         JOIN patient_medications m ON m.id = s.medication_id
         WHERE s.id = ? AND s.patient_id = ?`
      )
      .get(scheduleId, access.patientId) as
      | { id: string; medicine_name: string; strength: string }
      | undefined;

    if (!sched) {
      res.status(404).json({ error: 'Medication schedule not found.' });
      return;
    }

    const idempotencyKey = `${scheduleId}:${scheduledAt}`;
    const existing = db
      .prepare('SELECT id FROM medication_logs WHERE idempotency_key = ?')
      .get(idempotencyKey) as { id: string } | undefined;

    const now = new Date().toISOString();
    if (existing) {
      db.prepare(
        `UPDATE medication_logs SET status = ?, recorded_at = ?, recorded_by = ?, note = COALESCE(?, note) WHERE id = ?`
      ).run(
        status,
        status === 'pending' || status === 'unconfirmed' ? null : now,
        req.user!.id,
        note ?? null,
        existing.id
      );
      logAudit(req.user!, 'dose_log.update', `medication_log:${existing.id}`, 'success', { status });
      res.json({
        log: db.prepare('SELECT * FROM medication_logs WHERE id = ?').get(existing.id),
      });
      return;
    }

    const id = `log-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO medication_logs (id, schedule_id, patient_id, medication_name, scheduled_at, status, recorded_at, recorded_by, note, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      scheduleId,
      access.patientId,
      `${sched.medicine_name} ${sched.strength}`.trim(),
      scheduledAt,
      status,
      status === 'pending' || status === 'unconfirmed' ? null : now,
      req.user!.id,
      note ?? null,
      idempotencyKey
    );

    logAudit(req.user!, 'dose_log.create', `medication_log:${id}`, 'success', { status });
    res.status(201).json({
      log: db.prepare('SELECT * FROM medication_logs WHERE id = ?').get(id),
    });
  });

  router.patch('/medication-logs/:id', authenticateRequest, (req: AuthedRequest, res) => {
    const row = db
      .prepare('SELECT * FROM medication_logs WHERE id = ?')
      .get(req.params.id) as { id: string; patient_id: string } | undefined;

    if (!row) {
      res.status(404).json({ error: 'Dose log not found.' });
      return;
    }

    const access = resolveAuthorizedPatientId(req.user!, row.patient_id, 'dose_history');
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const { status, note } = req.body as { status?: DoseStatus; note?: string };
    if (!status) {
      res.status(400).json({ error: 'status is required.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE medication_logs SET status = ?, recorded_at = ?, recorded_by = ?, note = COALESCE(?, note) WHERE id = ?`
    ).run(
      status,
      status === 'pending' || status === 'unconfirmed' ? null : now,
      req.user!.id,
      note ?? null,
      req.params.id
    );

    logAudit(req.user!, 'dose_log.update', `medication_log:${req.params.id}`, 'success', {
      status,
      recordedByRole: req.user!.role,
    });
    res.json({
      log: db.prepare('SELECT * FROM medication_logs WHERE id = ?').get(req.params.id),
    });
  });

  router.get('/medication-logs/adherence', authenticateRequest, (req: AuthedRequest, res) => {
    const access = resolveAuthorizedPatientId(
      req.user!,
      req.query.patientId as string | undefined,
      'dose_history'
    );
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const days = Number(req.query.days ?? 30);
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - (Number.isFinite(days) && days > 0 ? days : 30));

    const logs = db
      .prepare(
        `SELECT id, schedule_id as scheduleId, scheduled_at as scheduledAt, status, recorded_at as recordedAt, note, medication_name as medicationName
         FROM medication_logs WHERE patient_id = ? AND scheduled_at >= ? ORDER BY scheduled_at ASC`
      )
      .all(access.patientId, cutoff.toISOString()) as Array<
      DoseLogRecord & { medicationName: string }
    >;

    const summary = calculateAdherence(logs);

    // Group by date for daily trend chart
    const byDate = new Map<string, DoseLogRecord[]>();
    const byMed = new Map<string, DoseLogRecord[]>();
    for (const l of logs) {
      const dateKey = l.scheduledAt.slice(0, 10);
      byDate.set(dateKey, [...(byDate.get(dateKey) ?? []), l]);
      byMed.set(l.medicationName, [...(byMed.get(l.medicationName) ?? []), l]);
    }

    const dailySeries = Array.from(byDate.entries()).map(([date, dayLogs]) => {
      const s = calculateAdherence(dayLogs);
      return {
        date,
        adherenceRate: s.recordedAdherenceRate,
        taken: s.takenCount,
        missed: s.missedCount,
        eligible: s.eligibleCount,
      };
    });

    const medicationBreakdown = Array.from(byMed.entries()).map(([medicine, medLogs]) => ({
      medicine,
      ...calculateAdherence(medLogs),
    }));

    res.json({ summary, dailySeries, medicationBreakdown });
  });

  // ---------------------------------------------------------------------------
  // MODULE 5: Personal Medicine Inventory & Expiry
  // ---------------------------------------------------------------------------
  router.get('/personal-inventory', authenticateRequest, (req: AuthedRequest, res) => {
    const access = resolveAuthorizedPatientId(
      req.user!,
      req.query.patientId as string | undefined,
      'schedules'
    );
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const todayStr = getTodayStr();
    const rows = db
      .prepare('SELECT * FROM personal_inventory WHERE patient_id = ? ORDER BY expiry_date ASC')
      .all(access.patientId) as Array<Record<string, unknown>>;

    res.json({
      items: rows.map((r) => {
        const exp = classifyExpiryWindow(r.expiry_date as string, todayStr);
        return {
          ...r,
          expiryWindow: exp.window,
          expiryLabel: exp.label,
          daysRemaining: exp.daysRemaining,
          isLowStock: isLowStock(r.quantity as number, r.min_threshold as number),
        };
      }),
    });
  });

  router.post('/personal-inventory', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const {
      medicineName,
      batchNumber,
      quantity,
      unit,
      minThreshold,
      purchaseDate,
      expiryDate,
      storageNotes,
      source,
    } = req.body as Record<string, string | number | undefined>;

    if (!medicineName || quantity === undefined || !unit || !expiryDate) {
      res.status(400).json({ error: 'medicineName, quantity, unit, and expiryDate are required.' });
      return;
    }

    const id = `pinv-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO personal_inventory (id, patient_id, medicine_name, batch_number, quantity, unit, min_threshold, purchase_date, expiry_date, storage_notes, source, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.user!.id,
      String(medicineName).trim(),
      batchNumber ? String(batchNumber).trim() : null,
      Math.max(0, Number(quantity)),
      String(unit).trim(),
      Math.max(0, Number(minThreshold ?? 5)),
      purchaseDate ? String(purchaseDate) : null,
      String(expiryDate),
      storageNotes ? String(storageNotes).trim() : null,
      source ? String(source).trim() : 'Personal Cabinet',
      now
    );
    runBackgroundScheduler();
    res.status(201).json({
      item: db.prepare('SELECT * FROM personal_inventory WHERE id = ?').get(id),
    });
  });

  router.patch('/personal-inventory/:id', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const { quantity } = req.body as { quantity?: number };
    if (quantity === undefined || quantity < 0) {
      res.status(400).json({ error: 'Valid non-negative quantity is required.' });
      return;
    }
    const existing = db
      .prepare('SELECT id FROM personal_inventory WHERE id = ? AND patient_id = ?')
      .get(req.params.id, req.user!.id);
    if (!existing) {
      res.status(404).json({ error: 'Personal inventory item not found.' });
      return;
    }
    db.prepare('UPDATE personal_inventory SET quantity = ?, updated_at = ? WHERE id = ?').run(
      Math.floor(quantity),
      new Date().toISOString(),
      req.params.id
    );
    logAudit(req.user!, 'personal_inventory.adjust', `personal_inventory:${req.params.id}`, 'success', {
      quantity,
    });
    res.json({
      item: db.prepare('SELECT * FROM personal_inventory WHERE id = ?').get(req.params.id),
    });
  });

  router.delete('/personal-inventory/:id', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    db.prepare('DELETE FROM personal_inventory WHERE id = ? AND patient_id = ?').run(
      req.params.id,
      req.user!.id
    );
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // MODULE 4: Prescription OCR & Digitisation (with Human Verification Gate)
  // ---------------------------------------------------------------------------
  router.get('/prescriptions', authenticateRequest, (req: AuthedRequest, res) => {
    const access = resolveAuthorizedPatientId(
      req.user!,
      req.query.patientId as string | undefined,
      'documents'
    );
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const prescriptions = db
      .prepare('SELECT * FROM prescriptions WHERE patient_id = ? ORDER BY upload_date DESC, id DESC')
      .all(access.patientId) as Array<Record<string, unknown>>;

    const items = db
      .prepare(
        `SELECT pi.* FROM prescription_items pi
         JOIN prescriptions p ON p.id = pi.prescription_id
         WHERE p.patient_id = ?`
      )
      .all(access.patientId) as Array<Record<string, unknown>>;

    res.json({
      prescriptions: prescriptions.map((p) => ({
        ...p,
        items: items
          .filter((i) => i.prescription_id === p.id)
          .map((i) => ({ ...i, confidence: JSON.parse(i.confidence_json as string) })),
      })),
    });
  });

  router.post(
    '/prescriptions/upload',
    authenticateRequest,
    requireRole('patient'),
    rateLimit('rx_upload', 15, 60_000),
    upload.single('file'),
    async (req: AuthedRequest, res) => {
      try {
        if (!req.file) {
          res.status(400).json({ error: 'Please select a prescription file (JPG, PNG, WEBP, PDF, or TXT).' });
          return;
        }

        const ext = path.extname(req.file.originalname) || '.png';
        const fileKey = saveUploadedBuffer(req.file.buffer, ext);
        const rxId = `rx-${crypto.randomUUID()}`;
        const now = new Date().toISOString();

        db.prepare(
          `INSERT INTO prescriptions (id, patient_id, file_name, file_key, mime_type, upload_date, ocr_status)
           VALUES (?, ?, ?, ?, ?, ?, 'uploaded')`
        ).run(
          rxId,
          req.user!.id,
          req.file.originalname,
          fileKey,
          req.file.mimetype,
          now.slice(0, 10)
        );

        // Run Gemini OCR immediately and save as unverified draft (AC-08 & AC-09)
        const ocr = await extractPrescriptionWithGemini({
          fileBuffer: req.file.buffer,
          mimeType: req.file.mimetype,
          fileName: req.file.originalname,
        });

        db.transaction(() => {
          db.prepare(
            `UPDATE prescriptions
             SET document_date = ?, doctor_name = ?, ocr_status = 'draft_ready', raw_text = ?, engine_version = ?, processing_ms = ?
             WHERE id = ?`
          ).run(
            ocr.prescriptionDate,
            ocr.doctorName,
            ocr.rawText,
            ocr.engineVersion,
            ocr.processingMs,
            rxId
          );

          const insertItem = db.prepare(
            `INSERT INTO prescription_items (id, prescription_id, medicine_name, strength, dosage, frequency, duration_days, instructions, confidence_json, verification_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
          );

          for (const item of ocr.items) {
            insertItem.run(
              `rxi-${crypto.randomUUID()}`,
              rxId,
              item.medicineName,
              item.strength,
              item.dosage,
              item.frequency,
              item.durationDays || 30,
              item.instructions || '',
              JSON.stringify(item.confidence)
            );
          }
        })();

        logAudit(req.user!, 'prescription.ocr_extract', `prescription:${rxId}`, 'success', {
          itemCount: ocr.items.length,
        });

        const savedRx = db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(rxId) as Record<string, unknown>;
        const savedItems = db
          .prepare('SELECT * FROM prescription_items WHERE prescription_id = ?')
          .all(rxId) as Array<Record<string, unknown>>;

        const { suggestions: pharmacySuggestions } = buildPharmacySuggestionsForMedicines(
          req.user!.id,
          ocr.items.map((item) => ({
            medicineName: item.medicineName,
            strength: item.strength,
          }))
        );

        res.status(201).json({
          prescription: {
            ...savedRx,
            items: savedItems.map((i) => ({
              ...i,
              confidence: JSON.parse(i.confidence_json as string),
            })),
          },
          pharmacySuggestions,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'OCR processing failed.';
        res.status(502).json({ error: message });
      }
    }
  );

  router.post('/prescriptions/pharmacy-suggestions', authenticateRequest, (req: AuthedRequest, res) => {
    const { medicines, patientId: requestedPatientId } = req.body as {
      medicines?: Array<{ medicineName?: string; strength?: string }>;
      patientId?: string;
    };

    const access = resolveAuthorizedPatientId(req.user!, requestedPatientId, 'documents');
    const targetPatientId = access.ok ? access.patientId : req.user!.id;

    if (!Array.isArray(medicines)) {
      res.status(400).json({ error: 'medicines array is required.' });
      return;
    }

    const sanitized = medicines
      .filter((m) => typeof m?.medicineName === 'string' && m.medicineName.trim().length > 0)
      .map((m) => ({
        medicineName: String(m.medicineName).trim(),
        strength: typeof m.strength === 'string' ? m.strength.trim() : undefined,
      }));

    const { suggestions, preferredPharmacyId } = buildPharmacySuggestionsForMedicines(targetPatientId, sanitized);
    res.json({ suggestions, preferredPharmacyId });
  });

  router.get('/prescriptions/:id/file', authenticateRequest, (req: AuthedRequest, res) => {
    const rx = db
      .prepare('SELECT * FROM prescriptions WHERE id = ?')
      .get(req.params.id) as
      | { id: string; patient_id: string; file_key: string; mime_type: string; file_name: string }
      | undefined;

    if (!rx) {
      res.status(404).json({ error: 'Prescription not found.' });
      return;
    }

    const access = resolveAuthorizedPatientId(req.user!, rx.patient_id, 'documents');
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const buf = readUploadedBuffer(rx.file_key);
    if (buf) {
      res.setHeader('Content-Type', rx.mime_type);
      res.send(buf);
      return;
    }

    // Serve crisp SVG visual preview for synthetic seeded prescriptions
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="420" viewBox="0 0 680 420">
      <rect width="680" height="420" fill="#ffffff" stroke="#cbd5e1" stroke-width="2"/>
      <rect x="0" y="0" width="680" height="64" fill="#0f766e"/>
      <text x="28" y="40" fill="#ffffff" font-family="sans-serif" font-size="20" font-weight="bold">CLINICAL PRESCRIPTION RECORD</text>
      <text x="28" y="102" fill="#0f172a" font-family="sans-serif" font-size="14" font-weight="bold">File: ${rx.file_name}</text>
      <text x="28" y="130" fill="#475569" font-family="sans-serif" font-size="13">Patient: Aarav Sharma · Ref ID: ${rx.id}</text>
      <line x1="28" y1="150" x2="652" y2="150" stroke="#e2e8f0" stroke-width="1"/>
      <text x="28" y="190" fill="#0f172a" font-family="monospace" font-size="15">Rx 1: Tab. Ecosprin (Aspirin) 75 mg — 1 tab OD after lunch x 30d</text>
      <text x="28" y="230" fill="#0f172a" font-family="monospace" font-size="15">Rx 2: Tab. Norvasc (Amlodipine) 5 mg — 1 tab OD morning x 30d</text>
      <text x="28" y="360" fill="#64748b" font-family="sans-serif" font-size="12">Synthetic Verification Sample · Human review required before activation</text>
    </svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(svg);
  });

  router.post('/prescriptions/:id/confirm', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const rx = db
      .prepare('SELECT * FROM prescriptions WHERE id = ? AND patient_id = ?')
      .get(req.params.id, req.user!.id) as
      | { id: string; doctor_name: string | null; document_date: string | null }
      | undefined;

    if (!rx) {
      res.status(404).json({ error: 'Prescription draft not found.' });
      return;
    }

    const { items } = req.body as {
      items?: Array<{
        id: string;
        medicineName: string;
        strength: string;
        dosage: string;
        frequency: string;
        durationDays: number;
        instructions: string;
        defaultTime?: string;
        approved?: boolean;
      }>;
    };

    if (!items || items.length === 0) {
      res.status(400).json({ error: 'Reviewed prescription items are required for confirmation.' });
      return;
    }

    const now = new Date().toISOString();
    const todayStr = getTodayStr();
    const createdMedIds: string[] = [];

    db.transaction(() => {
      db.prepare(`UPDATE prescriptions SET ocr_status = 'confirmed' WHERE id = ?`).run(rx.id);

      for (const item of items) {
        if (item.approved === false) {
          db.prepare(
            `UPDATE prescription_items SET verification_status = 'rejected' WHERE id = ? AND prescription_id = ?`
          ).run(item.id, rx.id);
          continue;
        }

        db.prepare(
          `UPDATE prescription_items
           SET medicine_name = ?, strength = ?, dosage = ?, frequency = ?, duration_days = ?, instructions = ?, verification_status = 'approved'
           WHERE id = ? AND prescription_id = ?`
        ).run(
          item.medicineName.trim(),
          item.strength.trim(),
          item.dosage.trim(),
          item.frequency.trim(),
          Math.max(1, Number(item.durationDays || 30)),
          item.instructions?.trim() || '',
          item.id,
          rx.id
        );

        const medId = `pmed-${crypto.randomUUID()}`;
        const schedId = `sched-${crypto.randomUUID()}`;
        const startDate = todayStr;
        const end = new Date();
        end.setUTCDate(end.getUTCDate() + Math.max(1, Number(item.durationDays || 30)));
        const endDate = end.toISOString().slice(0, 10);

        const freqLower = item.frequency.toLowerCase();
        const times =
          freqLower.includes('twice') || freqLower.includes('bd')
            ? ['08:00', '20:00']
            : freqLower.includes('thrice') || freqLower.includes('tds')
            ? ['08:00', '14:00', '20:00']
            : [item.defaultTime || '08:30'];

        db.prepare(
          `INSERT INTO patient_medications (id, patient_id, medicine_name, strength, prescribed_dose, route, frequency_label, start_date, end_date, prescriber, instructions, status, source_type, prescription_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'Oral', ?, ?, ?, ?, ?, 'active', 'verified_prescription', ?, ?, ?)`
        ).run(
          medId,
          req.user!.id,
          item.medicineName.trim(),
          item.strength.trim(),
          item.dosage.trim(),
          item.frequency.trim(),
          startDate,
          endDate,
          rx.doctor_name || 'Verified Prescription',
          item.instructions?.trim() || null,
          rx.id,
          now,
          now
        );

        db.prepare(
          `INSERT INTO medication_schedules (id, medication_id, patient_id, schedule_type, times_json, timezone, start_date, end_date, enabled, created_at)
           VALUES (?, ?, ?, ?, ?, 'UTC', ?, ?, 1, ?)`
        ).run(
          schedId,
          medId,
          req.user!.id,
          times.length > 1 ? 'multiple_daily' : 'once_daily',
          JSON.stringify(times),
          startDate,
          endDate,
          now
        );

        createdMedIds.push(medId);
      }
    })();

    runBackgroundScheduler();
    logAudit(req.user!, 'prescription.confirm', `prescription:${rx.id}`, 'success', {
      activatedMedications: createdMedIds.length,
    });
    res.json({ ok: true, activatedMedications: createdMedIds });
  });

  router.post('/prescriptions/:id/reject', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    db.prepare(`UPDATE prescriptions SET ocr_status = 'rejected' WHERE id = ? AND patient_id = ?`).run(
      req.params.id,
      req.user!.id
    );
    db.prepare(`UPDATE prescription_items SET verification_status = 'rejected' WHERE prescription_id = ?`).run(
      req.params.id
    );
    logAudit(req.user!, 'prescription.reject', `prescription:${req.params.id}`, 'success');
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // MODULE 6: Medical History & Document Organisation
  // ---------------------------------------------------------------------------
  router.get('/medical-documents', authenticateRequest, (req: AuthedRequest, res) => {
    const access = resolveAuthorizedPatientId(
      req.user!,
      req.query.patientId as string | undefined,
      'documents'
    );
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const q = ((req.query.q as string) || '').trim().toLowerCase();
    const category = ((req.query.category as string) || '').trim();

    let sql = 'SELECT * FROM medical_documents WHERE patient_id = ?';
    const params: unknown[] = [access.patientId];

    if (category && category !== 'all') {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (q) {
      sql +=
        ' AND (LOWER(title) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(provider) LIKE ? OR LOWER(ocr_text) LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY COALESCE(document_date, uploaded_at) DESC';

    const documents = db.prepare(sql).all(...params);
    res.json({ documents });
  });

  router.post(
    '/medical-documents',
    authenticateRequest,
    requireRole('patient'),
    upload.single('file'),
    (req: AuthedRequest, res) => {
      const { title, category, tags, documentDate, provider, notes } = req.body as Record<
        string,
        string | undefined
      >;

      if (!title || !category) {
        res.status(400).json({ error: 'title and category are required.' });
        return;
      }

      const fileName = req.file?.originalname || `${title.replace(/\s+/g, '_')}.txt`;
      const mimeType = req.file?.mimetype || 'text/plain';
      const buffer = req.file?.buffer || Buffer.from(notes || title, 'utf8');
      const fileKey = saveUploadedBuffer(buffer, path.extname(fileName) || '.txt');
      const extractedText =
        mimeType === 'text/plain' ? buffer.toString('utf8') : `${notes || ''}`.trim();

      const id = `doc-${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      db.prepare(
        `INSERT INTO medical_documents (id, patient_id, title, file_name, file_key, mime_type, category, tags, document_date, provider, ocr_text, source, version, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'patient_upload', 1, ?)`
      ).run(
        id,
        req.user!.id,
        title.trim(),
        fileName,
        fileKey,
        mimeType,
        category,
        (tags || '').trim(),
        documentDate || now.slice(0, 10),
        (provider || '').trim(),
        extractedText,
        now
      );

      logAudit(req.user!, 'medical_document.upload', `document:${id}`, 'success');
      res.status(201).json({
        document: db.prepare('SELECT * FROM medical_documents WHERE id = ?').get(id),
      });
    }
  );

  router.get('/medical-documents/:id/download', authenticateRequest, (req: AuthedRequest, res) => {
    const doc = db
      .prepare('SELECT * FROM medical_documents WHERE id = ?')
      .get(req.params.id) as
      | {
          id: string;
          patient_id: string;
          file_name: string;
          file_key: string;
          mime_type: string;
          ocr_text: string;
        }
      | undefined;

    if (!doc) {
      res.status(404).json({ error: 'Medical document not found.' });
      return;
    }

    const access = resolveAuthorizedPatientId(req.user!, doc.patient_id, 'documents');
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const buf = readUploadedBuffer(doc.file_key);
    res.setHeader('Content-Type', doc.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${doc.file_name.replace(/"/g, '')}"`);
    res.send(buf ?? Buffer.from(doc.ocr_text, 'utf8'));
  });

  router.get('/medical-conditions', authenticateRequest, (req: AuthedRequest, res) => {
    const access = resolveAuthorizedPatientId(
      req.user!,
      req.query.patientId as string | undefined,
      'medical_history'
    );
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const conditions = db
      .prepare('SELECT * FROM medical_conditions WHERE patient_id = ?')
      .all(access.patientId);
    const allergies = db
      .prepare('SELECT * FROM allergies WHERE patient_id = ?')
      .all(access.patientId);
    res.json({ conditions, allergies });
  });

  router.post('/medical-conditions', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const { conditionName, onsetDate, status, notes } = req.body as Record<string, string | undefined>;
    if (!conditionName) {
      res.status(400).json({ error: 'conditionName is required.' });
      return;
    }
    const id = `cond-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO medical_conditions (id, patient_id, condition_name, onset_date, status, source, notes)
       VALUES (?, ?, ?, ?, ?, 'patient_entered', ?)`
    ).run(id, req.user!.id, conditionName.trim(), onsetDate || null, status || 'active', notes || null);
    res.status(201).json({
      condition: db.prepare('SELECT * FROM medical_conditions WHERE id = ?').get(id),
    });
  });

  router.post('/allergies', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const { substance, reaction, severity } = req.body as Record<string, string | undefined>;
    if (!substance || !reaction) {
      res.status(400).json({ error: 'substance and reaction are required.' });
      return;
    }
    const id = `alg-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO allergies (id, patient_id, substance, reaction, severity, source, verification_status)
       VALUES (?, ?, ?, ?, ?, 'patient_entered', 'patient_reported')`
    ).run(id, req.user!.id, substance.trim(), reaction.trim(), severity || 'Moderate');
    res.status(201).json({
      allergy: db.prepare('SELECT * FROM allergies WHERE id = ?').get(id),
    });
  });

  // ---------------------------------------------------------------------------
  // MODULE 8: Appointment Scheduling
  // ---------------------------------------------------------------------------
  router.get('/appointments', authenticateRequest, (req: AuthedRequest, res) => {
    const access = resolveAuthorizedPatientId(
      req.user!,
      req.query.patientId as string | undefined,
      'appointments'
    );
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const appointments = db
      .prepare('SELECT * FROM appointments WHERE patient_id = ? ORDER BY start_at ASC')
      .all(access.patientId);
    res.json({ appointments });
  });

  router.post('/appointments', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const {
      provider,
      facility,
      department,
      appointmentType,
      startAt,
      timezone,
      location,
      contact,
      notes,
      reminderOffsets,
    } = req.body as {
      provider?: string;
      facility?: string;
      department?: string;
      appointmentType?: string;
      startAt?: string;
      timezone?: string;
      location?: string;
      contact?: string;
      notes?: string;
      reminderOffsets?: number[];
    };

    if (!provider || !facility || !startAt) {
      res.status(400).json({ error: 'provider, facility, and startAt are required.' });
      return;
    }

    const id = `appt-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO appointments (id, patient_id, provider, facility, department, appointment_type, start_at, timezone, location, contact, notes, reminder_offsets_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)`
    ).run(
      id,
      req.user!.id,
      provider.trim(),
      facility.trim(),
      department?.trim() || null,
      appointmentType || 'consultation',
      startAt,
      timezone || 'UTC',
      location?.trim() || null,
      contact?.trim() || null,
      notes?.trim() || null,
      JSON.stringify(reminderOffsets ?? [1440, 120]),
      now
    );

    runBackgroundScheduler();
    logAudit(req.user!, 'appointment.create', `appointment:${id}`, 'success');
    res.status(201).json({
      appointment: db.prepare('SELECT * FROM appointments WHERE id = ?').get(id),
    });
  });

  router.patch('/appointments/:id', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const existing = db
      .prepare('SELECT * FROM appointments WHERE id = ? AND patient_id = ?')
      .get(req.params.id, req.user!.id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Appointment not found.' });
      return;
    }

    const { status, startAt, notes } = req.body as {
      status?: 'scheduled' | 'rescheduled' | 'completed' | 'cancelled';
      startAt?: string;
      notes?: string;
    };

    db.transaction(() => {
      db.prepare(
        `UPDATE appointments
         SET status = COALESCE(?, status),
             start_at = COALESCE(?, start_at),
             notes = COALESCE(?, notes)
         WHERE id = ?`
      ).run(status ?? null, startAt ?? null, notes ?? null, req.params.id);

      // Clear old appointment reminders if rescheduled or cancelled (AC-11)
      if (status === 'cancelled' || startAt) {
        db.prepare(
          `DELETE FROM notifications WHERE user_id = ? AND kind = 'appt_reminder' AND dedupe_key LIKE ?`
        ).run(req.user!.id, `%:appt:${req.params.id}:%`);
      }
    })();

    runBackgroundScheduler();
    logAudit(req.user!, 'appointment.update', `appointment:${req.params.id}`, 'success', { status, startAt });
    res.json({
      appointment: db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id),
    });
  });

  // ---------------------------------------------------------------------------
  // MODULE 9: Caregiver & Shared Care (Granular Consent & Instant Revocation)
  // ---------------------------------------------------------------------------
  router.get('/caregivers', authenticateRequest, (req: AuthedRequest, res) => {
    if (req.user!.role === 'patient') {
      const caregivers = db
        .prepare('SELECT * FROM caregiver_relationships WHERE patient_id = ? ORDER BY created_at DESC')
        .all(req.user!.id) as Array<Record<string, unknown>>;
      res.json({
        caregivers: caregivers.map((c) => ({
          ...c,
          permissions: JSON.parse(c.permissions_json as string),
        })),
      });
      return;
    }

    if (req.user!.role === 'caregiver') {
      const patients = db
        .prepare(
          `SELECT cr.*, pp.display_name as patient_name
           FROM caregiver_relationships cr
           JOIN patient_profiles pp ON pp.user_id = cr.patient_id
           WHERE cr.caregiver_user_id = ?`
        )
        .all(req.user!.id) as Array<Record<string, unknown>>;
      res.json({
        caregivers: patients.map((c) => ({
          ...c,
          permissions: JSON.parse(c.permissions_json as string),
        })),
      });
      return;
    }

    res.status(403).json({ error: 'Only patients and caregivers can access shared care links.' });
  });

  router.post('/caregivers/invite', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const { caregiverEmail, caregiverName, relationshipLabel, permissions } = req.body as {
      caregiverEmail?: string;
      caregiverName?: string;
      relationshipLabel?: string;
      permissions?: Record<string, boolean>;
    };

    if (!caregiverEmail || !caregiverName) {
      res.status(400).json({ error: 'caregiverEmail and caregiverName are required.' });
      return;
    }

    const email = caregiverEmail.trim().toLowerCase();
    let cgUser = db
      .prepare('SELECT id, full_name FROM users WHERE email = ?')
      .get(email) as { id: string; full_name: string } | undefined;

    const now = new Date().toISOString();
    if (!cgUser) {
      const newId = `usr-${crypto.randomUUID()}`;
      db.prepare(
        `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'caregiver', 'active', ?, ?)`
      ).run(newId, email, hashPassword(crypto.randomBytes(16).toString('hex')), caregiverName.trim(), now, now);
      cgUser = { id: newId, full_name: caregiverName.trim() };
    }

    const id = `cg-${crypto.randomUUID()}`;
    const defaultPerms = {
      schedules: true,
      dose_history: true,
      appointments: true,
      documents: false,
      medical_history: false,
      emergency_info: true,
      ...(permissions ?? {}),
    };

    db.prepare(
      `INSERT INTO caregiver_relationships (id, patient_id, caregiver_user_id, caregiver_email, caregiver_name, relationship_label, consent_status, permissions_json, granted_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      id,
      req.user!.id,
      cgUser.id,
      email,
      caregiverName.trim(),
      (relationshipLabel || 'Family Caregiver').trim(),
      JSON.stringify(defaultPerms),
      now,
      now
    );

    logAudit(req.user!, 'caregiver.grant', `caregiver_relationship:${id}`, 'success', defaultPerms);
    const created = db.prepare('SELECT * FROM caregiver_relationships WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    res.status(201).json({
      caregiver: { ...created, permissions: defaultPerms },
    });
  });

  router.patch('/caregivers/:id/permissions', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const rel = db
      .prepare('SELECT * FROM caregiver_relationships WHERE id = ? AND patient_id = ?')
      .get(req.params.id, req.user!.id) as Record<string, unknown> | undefined;
    if (!rel) {
      res.status(404).json({ error: 'Caregiver link not found.' });
      return;
    }

    const { permissions, consentStatus } = req.body as {
      permissions?: Record<string, boolean>;
      consentStatus?: 'active' | 'revoked';
    };

    const nextPerms = permissions
      ? { ...JSON.parse(rel.permissions_json as string), ...permissions }
      : JSON.parse(rel.permissions_json as string);
    const nextStatus = consentStatus || (rel.consent_status as string);
    const now = new Date().toISOString();

    db.prepare(
      `UPDATE caregiver_relationships
       SET permissions_json = ?,
           consent_status = ?,
           revoked_at = CASE WHEN ? = 'revoked' THEN ? ELSE revoked_at END,
           granted_at = CASE WHEN ? = 'active' THEN ? ELSE granted_at END
       WHERE id = ?`
    ).run(JSON.stringify(nextPerms), nextStatus, nextStatus, now, nextStatus, now, req.params.id);

    logAudit(req.user!, 'caregiver.permissions_update', `caregiver_relationship:${req.params.id}`, 'success', {
      consentStatus: nextStatus,
      permissions: nextPerms,
    });

    const updated = db.prepare('SELECT * FROM caregiver_relationships WHERE id = ?').get(req.params.id) as Record<
      string,
      unknown
    >;
    res.json({ caregiver: { ...updated, permissions: nextPerms } });
  });

  router.delete('/caregivers/:id', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE caregiver_relationships SET consent_status = 'revoked', revoked_at = ? WHERE id = ? AND patient_id = ?`
    ).run(now, req.params.id, req.user!.id);

    logAudit(req.user!, 'caregiver.revoke', `caregiver_relationship:${req.params.id}`, 'success');
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // MODULE 7: Medication Interaction Information (Verified Reference)
  // ---------------------------------------------------------------------------
  router.get('/interactions/sources', authenticateRequest, (_req, res) => {
    res.json({ sources: VERIFIED_INTERACTION_SOURCES });
  });

  router.post('/interactions/check', authenticateRequest, rateLimit('interactions', 30, 60_000), (req: AuthedRequest, res) => {
    const { medicines } = req.body as { medicines?: string[] };
    if (!Array.isArray(medicines) || medicines.length < 2) {
      res.status(400).json({ error: 'Provide at least two medicines to check interactions.' });
      return;
    }

    const report = checkMedicationInteractions(medicines);
    logAudit(req.user!, 'interactions.check', 'reference_db', 'success', {
      count: medicines.length,
    });
    res.json({ report });
  });

  // ---------------------------------------------------------------------------
  // MODULE 13: Notifications & Preferences
  // ---------------------------------------------------------------------------
  router.get('/notifications', authenticateRequest, (req: AuthedRequest, res) => {
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 60')
      .all(req.user!.id);
    res.json({ notifications: rows });
  });

  router.post('/notifications/:id/read', authenticateRequest, (req: AuthedRequest, res) => {
    db.prepare(`UPDATE notifications SET status = 'read' WHERE id = ? AND user_id = ?`).run(
      req.params.id,
      req.user!.id
    );
    res.json({ ok: true });
  });

  router.patch('/notifications/preferences', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const incoming = req.body as Record<string, unknown>;
    const existingRow = db
      .prepare('SELECT notification_prefs_json FROM patient_profiles WHERE user_id = ?')
      .get(req.user!.id) as { notification_prefs_json?: string } | undefined;

    let existingObj: Record<string, unknown> = {};
    try {
      existingObj = existingRow?.notification_prefs_json
        ? (JSON.parse(existingRow.notification_prefs_json) as Record<string, unknown>)
        : {};
    } catch {
      existingObj = {};
    }

    const normalized = normalizeNotificationPreferences({
      ...existingObj,
      ...incoming,
    });

    db.prepare('UPDATE patient_profiles SET notification_prefs_json = ? WHERE user_id = ?').run(
      JSON.stringify(normalized),
      req.user!.id
    );
    logAudit(req.user!, 'notifications.preferences_update', `patient:${req.user!.id}`, 'success');
    res.json({ preferences: normalized });
  });

  router.post('/notifications/run-scheduler', authenticateRequest, (_req, res) => {
    const summary = runBackgroundScheduler();
    res.json({ summary });
  });

  // ---------------------------------------------------------------------------
  // MODULE 14: Grounded Healthcare Assistant & Intelligent Search
  // ---------------------------------------------------------------------------
  router.post('/assistant/query', authenticateRequest, rateLimit('assistant', 20, 60_000), async (req: AuthedRequest, res) => {
    const { question, patientId: reqPatientId } = req.body as {
      question?: string;
      patientId?: string;
    };
    if (!question || !question.trim()) {
      res.status(400).json({ error: 'Question is required.' });
      return;
    }

    const access = resolveAuthorizedPatientId(req.user!, reqPatientId, 'schedules');
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const patientId = access.patientId;
    // Permission-filtered record retrieval BEFORE sending to Gemini (AC / Section 7.2 & 7.3)
    const meds = db
      .prepare('SELECT id, medicine_name, strength, prescribed_dose, frequency_label, status, instructions FROM patient_medications WHERE patient_id = ?')
      .all(patientId);
    const appts = db
      .prepare('SELECT id, provider, facility, appointment_type, start_at, status, notes FROM appointments WHERE patient_id = ?')
      .all(patientId);

    const canSeeDocs =
      !access.isCaregiver ||
      resolveAuthorizedPatientId(req.user!, patientId, 'documents').ok;
    const canSeeHistory =
      !access.isCaregiver ||
      resolveAuthorizedPatientId(req.user!, patientId, 'medical_history').ok;

    const docs = canSeeDocs
      ? db
          .prepare('SELECT id, title, category, document_date, provider, ocr_text FROM medical_documents WHERE patient_id = ?')
          .all(patientId)
      : [];
    const conditions = canSeeHistory
      ? db
          .prepare('SELECT id, condition_name, status, notes FROM medical_conditions WHERE patient_id = ?')
          .all(patientId)
      : [];
    const allergies = canSeeHistory
      ? db
          .prepare('SELECT id, substance, reaction, severity FROM allergies WHERE patient_id = ?')
          .all(patientId)
      : [];

    try {
      const reply = await askHealthcareAssistant({
        authorizedRecordsJson: JSON.stringify({
          medications: meds,
          appointments: appts,
          medicalDocuments: docs,
          conditions,
          allergies,
        }),
        question: question.trim(),
      });
      logAudit(req.user!, 'assistant.query', `patient:${patientId}`, 'success');
      res.json(reply);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Assistant request failed.';
      res.status(502).json({ error: msg });
    }
  });

  // ---------------------------------------------------------------------------
  // MODULE 11 & 12: Pharmacy Inventory, Batches, Atomic Ledger & ML Forecasting
  // ---------------------------------------------------------------------------
  router.get('/inventory/items', authenticateRequest, requireRole('pharmacist', 'admin'), (req: AuthedRequest, res) => {
    const pharmacyId =
      req.user!.role === 'admin' && req.query.pharmacyId
        ? String(req.query.pharmacyId)
        : req.user!.pharmacyId;

    if (!pharmacyId) {
      res.status(403).json({ error: 'No pharmacy tenant assigned to this account.' });
      return;
    }

    const todayStr = getTodayStr();
    const pharmacy = db.prepare('SELECT * FROM pharmacies WHERE id = ?').get(pharmacyId);
    const items = db
      .prepare('SELECT * FROM inventory_items WHERE pharmacy_id = ? ORDER BY medicine_name ASC')
      .all(pharmacyId) as Array<Record<string, unknown>>;
    const batches = db
      .prepare(
        `SELECT b.*, s.name as supplier_name
         FROM inventory_batches b
         LEFT JOIN suppliers s ON s.id = b.supplier_id
         WHERE b.pharmacy_id = ?
         ORDER BY b.expiry_date ASC`
      )
      .all(pharmacyId) as Array<{
      id: string;
      item_id: string;
      pharmacy_id: string;
      batch_number: string;
      expiry_date: string;
      quantity: number;
      supplier_id: string | null;
      purchase_price: number;
      received_at: string;
      supplier_name: string | null;
    }>;

    const enriched = items.map((item) => {
      const itemBatches = batches
        .filter((b) => b.item_id === item.id)
        .map((b) => {
          const cls = classifyExpiryWindow(b.expiry_date, todayStr);
          return {
            ...b,
            expiryWindow: cls.window,
            expiryLabel: cls.label,
            daysRemaining: cls.daysRemaining,
            dispensable: cls.window !== 'expired' && b.quantity > 0,
          };
        });

      const totalQuantity = itemBatches.reduce((sum, b) => sum + b.quantity, 0);
      const eligibleQuantity = itemBatches
        .filter((b) => b.expiryWindow !== 'expired')
        .reduce((sum, b) => sum + b.quantity, 0);
      const expiredQuantity = totalQuantity - eligibleQuantity;

      return {
        ...item,
        totalQuantity,
        eligibleQuantity,
        expiredQuantity,
        isLowStock: isLowStock(eligibleQuantity, item.min_threshold as number),
        batches: itemBatches,
      };
    });

    res.json({ pharmacy, items: enriched });
  });

  router.post('/inventory/items', authenticateRequest, requireRole('pharmacist'), (req: AuthedRequest, res) => {
    if (!req.user!.pharmacyId) {
      res.status(403).json({ error: 'Pharmacy membership required.' });
      return;
    }

    const { sku, medicineName, category, unit, minThreshold, unitSellPrice, locationBin } =
      req.body as Record<string, string | number | undefined>;

    if (!sku || !medicineName || !unit) {
      res.status(400).json({ error: 'sku, medicineName, and unit are required.' });
      return;
    }

    const id = `item-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO inventory_items (id, pharmacy_id, sku, medicine_name, category, unit, min_threshold, unit_sell_price, location_bin, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      req.user!.pharmacyId,
      String(sku).trim(),
      String(medicineName).trim(),
      String(category || 'General').trim(),
      String(unit).trim(),
      Math.max(0, Number(minThreshold ?? 20)),
      Math.max(0, Number(unitSellPrice ?? 0)),
      String(locationBin || 'Rack A-01').trim(),
      new Date().toISOString()
    );

    logAudit(req.user!, 'inventory.item_create', `inventory_item:${id}`, 'success');
    res.status(201).json({
      item: db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(id),
    });
  });

  router.post('/inventory/batches', authenticateRequest, requireRole('pharmacist'), (req: AuthedRequest, res) => {
    if (!req.user!.pharmacyId) {
      res.status(403).json({ error: 'Pharmacy membership required.' });
      return;
    }

    const { itemId, batchNumber, expiryDate, quantity, supplierId, purchasePrice } = req.body as {
      itemId?: string;
      batchNumber?: string;
      expiryDate?: string;
      quantity?: number;
      supplierId?: string;
      purchasePrice?: number;
    };

    if (!itemId || !batchNumber || !expiryDate || !quantity || quantity <= 0) {
      res.status(400).json({
        error: 'itemId, batchNumber, expiryDate, and positive quantity are required.',
      });
      return;
    }

    // Tenant boundary check (AC-02)
    const item = db
      .prepare('SELECT id FROM inventory_items WHERE id = ? AND pharmacy_id = ?')
      .get(itemId, req.user!.pharmacyId);
    if (!item) {
      res.status(403).json({ error: 'Item does not belong to your assigned pharmacy.' });
      return;
    }

    const batchId = `batch-${crypto.randomUUID()}`;
    const txId = `tx-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare(
        `INSERT INTO inventory_batches (id, item_id, pharmacy_id, batch_number, expiry_date, quantity, supplier_id, purchase_price, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        batchId,
        itemId,
        req.user!.pharmacyId!,
        batchNumber.trim(),
        expiryDate,
        Math.floor(quantity),
        supplierId || null,
        Number(purchasePrice ?? 0),
        now.slice(0, 10)
      );

      db.prepare(
        `INSERT INTO inventory_transactions (id, pharmacy_id, item_id, batch_id, transaction_type, quantity, signed_delta, actor_id, reference_code, notes, created_at)
         VALUES (?, ?, ?, ?, 'stock_in', ?, ?, ?, ?, 'New batch intake', ?)`
      ).run(
        txId,
        req.user!.pharmacyId!,
        itemId,
        batchId,
        Math.floor(quantity),
        Math.floor(quantity),
        req.user!.id,
        `GRN-${batchNumber.trim()}`,
        now
      );
    })();

    runBackgroundScheduler();
    logAudit(req.user!, 'inventory.batch_receive', `inventory_batch:${batchId}`, 'success', {
      quantity,
      batchNumber,
    });
    res.status(201).json({
      batch: db.prepare('SELECT * FROM inventory_batches WHERE id = ?').get(batchId),
    });
  });

  router.post('/inventory/transactions', authenticateRequest, requireRole('pharmacist'), (req: AuthedRequest, res) => {
    if (!req.user!.pharmacyId) {
      res.status(403).json({ error: 'Pharmacy membership required.' });
      return;
    }

    const { batchId, transactionType, quantity, referenceCode, notes } = req.body as {
      batchId?: string;
      transactionType?: TransactionType;
      quantity?: number;
      referenceCode?: string;
      notes?: string;
    };

    if (!batchId || !transactionType || quantity === undefined || quantity === 0) {
      res.status(400).json({ error: 'batchId, transactionType, and non-zero quantity are required.' });
      return;
    }

    const todayStr = getTodayStr();

    try {
      const result = db.transaction(() => {
        const batch = db
          .prepare('SELECT * FROM inventory_batches WHERE id = ?')
          .get(batchId) as
          | {
              id: string;
              item_id: string;
              pharmacy_id: string;
              batch_number: string;
              expiry_date: string;
              quantity: number;
            }
          | undefined;

        if (!batch) {
          throw new Error('NOT_FOUND:Batch not found.');
        }

        // Cross-pharmacy tenant protection (AC-02)
        if (batch.pharmacy_id !== req.user!.pharmacyId) {
          logAudit(req.user!, 'inventory.transaction', `inventory_batch:${batchId}`, 'denied', {
            reason: 'cross_pharmacy_tenant',
          });
          throw new Error('FORBIDDEN:Cross-pharmacy inventory access is denied.');
        }

        const { nextQuantity, delta } = validateAndApplyStockTransaction(
          {
            id: batch.id,
            batchNumber: batch.batch_number,
            expiryDate: batch.expiry_date,
            quantity: batch.quantity,
          },
          transactionType,
          Number(quantity),
          todayStr
        );

        db.prepare('UPDATE inventory_batches SET quantity = ? WHERE id = ?').run(
          nextQuantity,
          batch.id
        );

        const txId = `tx-${crypto.randomUUID()}`;
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO inventory_transactions (id, pharmacy_id, item_id, batch_id, transaction_type, quantity, signed_delta, actor_id, reference_code, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          txId,
          batch.pharmacy_id,
          batch.item_id,
          batch.id,
          transactionType,
          Math.abs(Number(quantity)),
          delta,
          req.user!.id,
          referenceCode?.trim() || `TX-${Date.now().toString().slice(-6)}`,
          notes?.trim() || null,
          now
        );

        return { txId, nextQuantity, delta, itemId: batch.item_id };
      })();

      runBackgroundScheduler();
      logAudit(req.user!, 'inventory.transaction', `inventory_transaction:${result.txId}`, 'success', {
        transactionType,
        delta: result.delta,
      });

      res.status(201).json({
        transaction: db
          .prepare('SELECT * FROM inventory_transactions WHERE id = ?')
          .get(result.txId),
        newBatchQuantity: result.nextQuantity,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Stock transaction failed.';
      if (msg.startsWith('NOT_FOUND:')) {
        res.status(404).json({ error: msg.replace('NOT_FOUND:', '') });
        return;
      }
      if (msg.startsWith('FORBIDDEN:')) {
        res.status(403).json({ error: msg.replace('FORBIDDEN:', '') });
        return;
      }
      res.status(400).json({ error: msg });
    }
  });

  router.get('/inventory/transactions', authenticateRequest, requireRole('pharmacist', 'admin'), (req: AuthedRequest, res) => {
    const pharmacyId =
      req.user!.role === 'admin' && req.query.pharmacyId
        ? String(req.query.pharmacyId)
        : req.user!.pharmacyId;
    if (!pharmacyId) {
      res.status(403).json({ error: 'Pharmacy membership required.' });
      return;
    }

    const transactions = db
      .prepare(
        `SELECT t.*, i.medicine_name, i.sku, b.batch_number, u.full_name as actor_name
         FROM inventory_transactions t
         JOIN inventory_items i ON i.id = t.item_id
         JOIN inventory_batches b ON b.id = t.batch_id
         JOIN users u ON u.id = t.actor_id
         WHERE t.pharmacy_id = ?
         ORDER BY t.created_at DESC
         LIMIT 150`
      )
      .all(pharmacyId);

    res.json({ transactions });
  });

  router.get('/suppliers', authenticateRequest, requireRole('pharmacist', 'admin'), (req: AuthedRequest, res) => {
    const pharmacyId = req.user!.pharmacyId;
    if (!pharmacyId) {
      res.status(403).json({ error: 'Pharmacy membership required.' });
      return;
    }
    const suppliers = db
      .prepare('SELECT * FROM suppliers WHERE pharmacy_id = ? ORDER BY name ASC')
      .all(pharmacyId);
    res.json({ suppliers });
  });

  router.post('/suppliers', authenticateRequest, requireRole('pharmacist'), (req: AuthedRequest, res) => {
    if (!req.user!.pharmacyId) {
      res.status(403).json({ error: 'Pharmacy membership required.' });
      return;
    }
    const { name, contactPerson, email, phone, leadTimeDays, terms } = req.body as Record<
      string,
      string | number | undefined
    >;
    if (!name || !contactPerson || !email) {
      res.status(400).json({ error: 'name, contactPerson, and email are required.' });
      return;
    }
    const id = `sup-${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO suppliers (id, pharmacy_id, name, contact_person, email, phone, lead_time_days, terms, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`
    ).run(
      id,
      req.user!.pharmacyId,
      String(name).trim(),
      String(contactPerson).trim(),
      String(email).trim(),
      String(phone || '').trim(),
      Math.max(1, Number(leadTimeDays ?? 5)),
      String(terms || 'Net 30').trim()
    );
    res.status(201).json({
      supplier: db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id),
    });
  });

  router.get('/inventory/analytics', authenticateRequest, requireRole('pharmacist', 'admin'), (req: AuthedRequest, res) => {
    const pharmacyId =
      req.user!.role === 'admin' && req.query.pharmacyId
        ? String(req.query.pharmacyId)
        : req.user!.pharmacyId;
    if (!pharmacyId) {
      res.status(403).json({ error: 'Pharmacy membership required.' });
      return;
    }

    const todayStr = getTodayStr();
    const batches = db
      .prepare(
        `SELECT b.*, i.medicine_name, i.category, i.unit_sell_price, i.min_threshold
         FROM inventory_batches b
         JOIN inventory_items i ON i.id = b.item_id
         WHERE b.pharmacy_id = ?`
      )
      .all(pharmacyId) as Array<{
      id: string;
      item_id: string;
      quantity: number;
      expiry_date: string;
      purchase_price: number;
      medicine_name: string;
      category: string;
      unit_sell_price: number;
      min_threshold: number;
    }>;

    let totalUnits = 0;
    let eligibleUnits = 0;
    let expiredUnits = 0;
    let expiring30dUnits = 0;
    let totalPurchaseValuation = 0;
    let totalRetailValuation = 0;

    const categoryMap = new Map<string, { category: string; units: number; valuation: number }>();

    for (const b of batches) {
      const cls = classifyExpiryWindow(b.expiry_date, todayStr);
      totalUnits += b.quantity;
      if (cls.window === 'expired') {
        expiredUnits += b.quantity;
      } else {
        eligibleUnits += b.quantity;
        totalPurchaseValuation += b.quantity * b.purchase_price;
        totalRetailValuation += b.quantity * b.unit_sell_price;
        if (cls.window === 'critical_7d' || cls.window === 'warning_30d') {
          expiring30dUnits += b.quantity;
        }
      }

      const prev = categoryMap.get(b.category) ?? {
        category: b.category,
        units: 0,
        valuation: 0,
      };
      prev.units += b.quantity;
      prev.valuation += Math.round(b.quantity * b.unit_sell_price);
      categoryMap.set(b.category, prev);
    }

    // Fast / slow movers & daily movement series from transaction ledger
    const itemVelocity = db
      .prepare(
        `SELECT i.id, i.medicine_name, i.sku, i.min_threshold,
                COALESCE(SUM(CASE WHEN t.transaction_type IN ('sale', 'stock_out') THEN t.quantity ELSE 0 END), 0) as total_sold,
                COALESCE(SUM(CASE WHEN t.transaction_type = 'stock_in' THEN t.quantity ELSE 0 END), 0) as total_in
         FROM inventory_items i
         LEFT JOIN inventory_transactions t ON t.item_id = i.id
         WHERE i.pharmacy_id = ?
         GROUP BY i.id
         ORDER BY total_sold DESC`
      )
      .all(pharmacyId);

    const dailyMovement = db
      .prepare(
        `SELECT substr(created_at, 1, 10) as date,
                SUM(CASE WHEN transaction_type IN ('sale', 'stock_out') THEN quantity ELSE 0 END) as units_out,
                SUM(CASE WHEN transaction_type = 'stock_in' THEN quantity ELSE 0 END) as units_in
         FROM inventory_transactions
         WHERE pharmacy_id = ?
         GROUP BY substr(created_at, 1, 10)
         ORDER BY date ASC
         LIMIT 45`
      )
      .all(pharmacyId);

    res.json({
      kpis: {
        totalUnits,
        eligibleUnits,
        expiredUnits,
        expiring30dUnits,
        totalPurchaseValuation: Math.round(totalPurchaseValuation * 100) / 100,
        totalRetailValuation: Math.round(totalRetailValuation * 100) / 100,
      },
      categories: Array.from(categoryMap.values()),
      itemVelocity,
      dailyMovement,
    });
  });

  router.get('/inventory/forecast/:itemId', authenticateRequest, requireRole('pharmacist', 'admin'), (req: AuthedRequest, res) => {
    const pharmacyId = req.user!.pharmacyId;
    const item = db
      .prepare('SELECT * FROM inventory_items WHERE id = ?')
      .get(req.params.itemId) as
      | { id: string; pharmacy_id: string; medicine_name: string; min_threshold: number }
      | undefined;

    if (!item) {
      res.status(404).json({ error: 'Inventory item not found.' });
      return;
    }

    if (req.user!.role !== 'admin' && item.pharmacy_id !== pharmacyId) {
      res.status(403).json({ error: 'Cross-pharmacy forecast access is denied.' });
      return;
    }

    const todayStr = getTodayStr();
    const eligibleStockRow = db
      .prepare(
        `SELECT COALESCE(SUM(quantity), 0) as qty FROM inventory_batches
         WHERE item_id = ? AND expiry_date > ?`
      )
      .get(item.id, todayStr) as { qty: number };

    const historyRows = db
      .prepare(
        `SELECT substr(created_at, 1, 10) as date,
                SUM(quantity) as unitsSold
         FROM inventory_transactions
         WHERE item_id = ? AND transaction_type IN ('sale', 'stock_out')
         GROUP BY substr(created_at, 1, 10)
         ORDER BY date ASC`
      )
      .all(item.id) as Array<{ date: string; unitsSold: number }>;

    const preferredModel = req.query.model as ForecastModelName | undefined;
    const horizonDays = Number(req.query.horizonDays ?? 30);

    const forecast = generateInventoryForecast({
      itemId: item.id,
      itemName: item.medicine_name,
      history: historyRows,
      currentEligibleStock: eligibleStockRow.qty,
      minThreshold: item.min_threshold,
      horizonDays: Number.isFinite(horizonDays) && horizonDays > 0 ? horizonDays : 30,
      modelDate: todayStr,
      preferredModel,
    });

    res.json({ forecast, history: historyRows });
  });

  // ---------------------------------------------------------------------------
  // MODULE 15: Nearby Pharmacy Locator & Medication Refill Requests
  // ---------------------------------------------------------------------------
  router.get('/pharmacies/nearby', authenticateRequest, (req: AuthedRequest, res) => {
    const access = resolveAuthorizedPatientId(
      req.user!,
      req.query.patientId as string | undefined,
      'schedules'
    );
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const prefRow = db
      .prepare('SELECT preferred_pharmacy_id FROM patient_profiles WHERE user_id = ?')
      .get(access.patientId) as { preferred_pharmacy_id?: string | null } | undefined;

    const rawPharmacies = db
      .prepare(
        `SELECT id, tenant_name, license_number, address
         FROM pharmacies
         WHERE status = 'active'
         ORDER BY tenant_name ASC`
      )
      .all() as Array<{ id: string; tenant_name: string; license_number: string; address: string }>;

    const preferredPharmacyId = prefRow?.preferred_pharmacy_id || rawPharmacies[0]?.id || null;
    const enriched = rawPharmacies.map(enrichPharmacyWithMapMetadata);
    const filtered = filterAndSortNearbyPharmacies(enriched, {
      query: (req.query.q as string | undefined) ?? '',
      open24hOnly: req.query.open24h === 'true',
      deliveryOnly: req.query.delivery === 'true',
      preferredPharmacyId,
    });

    res.json({
      pharmacies: filtered,
      preferredPharmacyId,
      patientLocation: {
        label: 'Bandra West Neighborhood',
        mapX: 400,
        mapY: 250,
      },
    });
  });

  router.patch('/patients/me/preferred-pharmacy', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const { pharmacyId } = req.body as { pharmacyId?: string };
    if (!pharmacyId) {
      res.status(400).json({ error: 'pharmacyId is required.' });
      return;
    }

    const pharm = db
      .prepare(`SELECT id, tenant_name, license_number, address FROM pharmacies WHERE id = ? AND status = 'active'`)
      .get(pharmacyId) as
      | { id: string; tenant_name: string; license_number: string; address: string }
      | undefined;

    if (!pharm) {
      res.status(404).json({ error: 'Selected pharmacy was not found or is inactive.' });
      return;
    }

    db.prepare('UPDATE patient_profiles SET preferred_pharmacy_id = ? WHERE user_id = ?').run(
      pharm.id,
      req.user!.id
    );

    logAudit(req.user!, 'patient.preferred_pharmacy_update', `pharmacy:${pharm.id}`, 'success', {
      tenantName: pharm.tenant_name,
    });

    res.json({
      preferredPharmacyId: pharm.id,
      pharmacy: enrichPharmacyWithMapMetadata(pharm),
    });
  });

  router.get('/refill-requests', authenticateRequest, (req: AuthedRequest, res) => {
    if (req.user!.role === 'pharmacist') {
      const requests = db
        .prepare(
          `SELECT rr.*, pp.display_name as patient_name
           FROM refill_requests rr
           LEFT JOIN patient_profiles pp ON pp.user_id = rr.patient_id
           WHERE rr.pharmacy_id = ?
           ORDER BY rr.requested_at DESC`
        )
        .all(req.user!.pharmacyId);
      res.json({ refillRequests: requests });
      return;
    }

    if (req.user!.role === 'admin') {
      const requests = db
        .prepare(
          `SELECT rr.*, pp.display_name as patient_name
           FROM refill_requests rr
           LEFT JOIN patient_profiles pp ON pp.user_id = rr.patient_id
           ORDER BY rr.requested_at DESC LIMIT 100`
        )
        .all();
      res.json({ refillRequests: requests });
      return;
    }

    const access = resolveAuthorizedPatientId(
      req.user!,
      req.query.patientId as string | undefined,
      'schedules'
    );
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }
    const requests = db
      .prepare('SELECT * FROM refill_requests WHERE patient_id = ? ORDER BY requested_at DESC')
      .all(access.patientId);
    res.json({ refillRequests: requests });
  });

  router.post('/refill-requests', authenticateRequest, requireRole('patient'), (req: AuthedRequest, res) => {
    const { patientMedicationId, pharmacyId, quantityRequested, notes } = req.body as {
      patientMedicationId?: string;
      pharmacyId?: string;
      quantityRequested?: number;
      notes?: string;
    };

    if (!patientMedicationId) {
      res.status(400).json({ error: 'Please select an active prescription to refill.' });
      return;
    }

    const med = db
      .prepare(
        `SELECT id, medicine_name, strength, status FROM patient_medications WHERE id = ? AND patient_id = ?`
      )
      .get(patientMedicationId, req.user!.id) as
      | { id: string; medicine_name: string; strength: string; status: string }
      | undefined;

    if (!med) {
      res.status(404).json({ error: 'Prescription not found for your account.' });
      return;
    }

    if (med.status !== 'active') {
      res.status(400).json({ error: 'Refill requests are only supported for active prescriptions.' });
      return;
    }

    const existingOpen = db
      .prepare(
        `SELECT id, status FROM refill_requests
         WHERE patient_id = ? AND patient_medication_id = ? AND status IN ('requested', 'approved', 'ready')`
      )
      .get(req.user!.id, med.id) as { id: string; status: string } | undefined;

    if (existingOpen) {
      res.status(409).json({
        error: `A refill request for ${med.medicine_name} ${med.strength} is already ${existingOpen.status}.`,
      });
      return;
    }

    const qty = Number(quantityRequested ?? 30);
    if (!Number.isInteger(qty) || qty < 1 || qty > 180) {
      res.status(400).json({ error: 'Requested quantity must be a whole number between 1 and 180.' });
      return;
    }

    let resolvedPharmacy: { id: string; tenant_name: string } | undefined;
    if (pharmacyId) {
      resolvedPharmacy = db
        .prepare(`SELECT id, tenant_name FROM pharmacies WHERE id = ? AND status = 'active'`)
        .get(pharmacyId) as { id: string; tenant_name: string } | undefined;
    } else {
      const prefRow = db
        .prepare('SELECT preferred_pharmacy_id FROM patient_profiles WHERE user_id = ?')
        .get(req.user!.id) as { preferred_pharmacy_id?: string | null } | undefined;
      if (prefRow?.preferred_pharmacy_id) {
        resolvedPharmacy = db
          .prepare(`SELECT id, tenant_name FROM pharmacies WHERE id = ? AND status = 'active'`)
          .get(prefRow.preferred_pharmacy_id) as { id: string; tenant_name: string } | undefined;
      }
      if (!resolvedPharmacy) {
        resolvedPharmacy = db
          .prepare(`SELECT id, tenant_name FROM pharmacies WHERE status = 'active' ORDER BY tenant_name ASC LIMIT 1`)
          .get() as { id: string; tenant_name: string } | undefined;
      }
    }

    const now = new Date().toISOString();
    const refillId = `refill-${crypto.randomUUID()}`;
    const targetPharmacyId = resolvedPharmacy?.id ?? null;
    const targetPharmacyName = resolvedPharmacy?.tenant_name ?? 'Preferred Pharmacy';

    db.prepare(
      `INSERT INTO refill_requests (id, patient_id, patient_medication_id, medicine_name, strength, pharmacy_id, pharmacy_name, quantity_requested, status, notes, requested_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?)`
    ).run(
      refillId,
      req.user!.id,
      med.id,
      med.medicine_name,
      med.strength,
      targetPharmacyId,
      targetPharmacyName,
      qty,
      notes?.trim() || null,
      now,
      now
    );

    // Notify patient and pharmacy staff
    db.prepare(
      `INSERT INTO notifications (id, user_id, kind, title, body, scheduled_at, channel, status, attempts, dedupe_key, created_at)
       VALUES (?, ?, 'system', ?, ?, ?, 'in_app', 'sent', 1, ?, ?)`
    ).run(
      `notif-${crypto.randomUUID()}`,
      req.user!.id,
      `Refill Requested: ${med.medicine_name} ${med.strength}`,
      `Requested ${qty} units from ${targetPharmacyName}.`,
      now,
      `refill:patient:${refillId}`,
      now
    );

    if (targetPharmacyId) {
      const pharmacists = db
        .prepare(`SELECT user_id FROM pharmacy_members WHERE pharmacy_id = ? AND status = 'active'`)
        .all(targetPharmacyId) as Array<{ user_id: string }>;
      for (const p of pharmacists) {
        db.prepare(
          `INSERT INTO notifications (id, user_id, kind, title, body, scheduled_at, channel, status, attempts, dedupe_key, created_at)
           VALUES (?, ?, 'system', ?, ?, ?, 'in_app', 'sent', 1, ?, ?)`
        ).run(
          `notif-${crypto.randomUUID()}`,
          p.user_id,
          `New Patient Refill Request`,
          `${med.medicine_name} ${med.strength} (${qty} units) requested by ${req.user!.fullName}.`,
          now,
          `refill:pharma:${refillId}:${p.user_id}`,
          now
        );
      }
    }

    logAudit(req.user!, 'refill_request.create', `refill:${refillId}`, 'success', {
      patientMedicationId: med.id,
      pharmacyId: targetPharmacyId,
      quantity: qty,
    });

    const created = db.prepare('SELECT * FROM refill_requests WHERE id = ?').get(refillId);
    res.status(201).json({ refillRequest: created });
  });

  router.patch('/refill-requests/:id/status', authenticateRequest, (req: AuthedRequest, res) => {
    const { status } = req.body as { status?: string };
    const existing = db
      .prepare('SELECT * FROM refill_requests WHERE id = ?')
      .get(req.params.id) as
      | {
          id: string;
          patient_id: string;
          pharmacy_id: string | null;
          pharmacy_name: string;
          medicine_name: string;
          strength: string;
          status: string;
        }
      | undefined;

    if (!existing) {
      res.status(404).json({ error: 'Refill request not found.' });
      return;
    }

    if (req.user!.role === 'patient') {
      if (existing.patient_id !== req.user!.id || status !== 'cancelled' || existing.status !== 'requested') {
        res.status(403).json({ error: 'Patients can only cancel their own pending refill requests.' });
        return;
      }
    } else if (req.user!.role === 'pharmacist') {
      if (existing.pharmacy_id !== req.user!.pharmacyId) {
        res.status(403).json({ error: 'Cross-pharmacy refill access is denied.' });
        return;
      }
      if (!status || !['approved', 'ready', 'completed', 'cancelled'].includes(status)) {
        res.status(400).json({ error: 'Invalid refill status update.' });
        return;
      }
    } else {
      res.status(403).json({ error: 'Current role cannot update refill requests.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE refill_requests SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      now,
      existing.id
    );

    if (req.user!.role === 'pharmacist') {
      db.prepare(
        `INSERT INTO notifications (id, user_id, kind, title, body, scheduled_at, channel, status, attempts, dedupe_key, created_at)
         VALUES (?, ?, 'system', ?, ?, ?, 'in_app', 'sent', 1, ?, ?)`
      ).run(
        `notif-${crypto.randomUUID()}`,
        existing.patient_id,
        `Refill ${status.charAt(0).toUpperCase() + status.slice(1)}: ${existing.medicine_name}`,
        `${existing.pharmacy_name} marked your ${existing.medicine_name} ${existing.strength} refill as ${status}.`,
        now,
        `refill:status:${existing.id}:${status}:${now}`,
        now
      );
    }

    logAudit(req.user!, 'refill_request.update_status', `refill:${existing.id}`, 'success', { status });
    const updated = db.prepare('SELECT * FROM refill_requests WHERE id = ?').get(existing.id);
    res.json({ refillRequest: updated });
  });

  // ---------------------------------------------------------------------------
  // MODULE 16: Admin, Audit Logs, Users & Notification Monitor
  // ---------------------------------------------------------------------------
  router.get('/admin/audit-logs', authenticateRequest, requireRole('admin'), (_req, res) => {
    const logs = db
      .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 120')
      .all();
    res.json({ logs });
  });

  router.get('/admin/notifications-monitor', authenticateRequest, requireRole('admin'), (_req, res) => {
    const jobs = db
      .prepare(
        `SELECT n.*, u.email as recipient_email
         FROM notifications n
         JOIN users u ON u.id = n.user_id
         ORDER BY n.created_at DESC
         LIMIT 100`
      )
      .all();
    res.json({ jobs });
  });

  router.get('/admin/users', authenticateRequest, requireRole('admin'), (_req, res) => {
    const users = db
      .prepare(
        `SELECT u.id, u.email, u.full_name, u.role, u.status, u.created_at, p.tenant_name as pharmacy_name
         FROM users u
         LEFT JOIN pharmacy_members pm ON pm.user_id = u.id
         LEFT JOIN pharmacies p ON p.id = pm.pharmacy_id
         ORDER BY u.created_at DESC`
      )
      .all();
    const pharmacies = db
      .prepare('SELECT id, tenant_name, license_number FROM pharmacies WHERE status = ? ORDER BY tenant_name ASC')
      .all('active');
    res.json({ users, pharmacies });
  });

  router.post('/admin/users', authenticateRequest, requireRole('admin'), (req: AuthedRequest, res) => {
    const { email, password, fullName, role, pharmacyId } = req.body as {
      email?: string;
      password?: string;
      fullName?: string;
      role?: UserRole;
      pharmacyId?: string;
    };

    if (!email || !password || !fullName || password.length < 8) {
      res.status(400).json({ error: 'Email, full name, and password (minimum 8 characters) are required.' });
      return;
    }

    if (!role || !['patient', 'caregiver', 'pharmacist', 'admin'].includes(role)) {
      res.status(400).json({ error: 'Valid role (patient, caregiver, pharmacist, admin) is required.' });
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const userId = `usr-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
      ).run(userId, normalizedEmail, hashPassword(password), fullName.trim(), role, now, now);

      if (role === 'patient') {
        db.prepare(
          `INSERT INTO patient_profiles (user_id, display_name, timezone, notification_prefs_json)
           VALUES (?, ?, 'UTC', ?)`
        ).run(
          userId,
          fullName.trim(),
          JSON.stringify({ pushEnabled: true, browserPush: true, leadMinutes: 15, overdueGraceMinutes: 720, soundEnabled: true })
        );
      } else if (role === 'pharmacist') {
        const targetPharm = pharmacyId || 'pharm-1';
        db.prepare(
          `INSERT INTO pharmacy_members (pharmacy_id, user_id, member_role, status)
           VALUES (?, ?, 'pharmacist', 'active')`
        ).run(targetPharm, userId);
      }
    });
    tx();

    logAudit(req.user!, 'admin.create_user', `user:${userId}`, 'success', { role, email: normalizedEmail });
    const created = db
      .prepare('SELECT id, email, full_name, role, status, created_at FROM users WHERE id = ?')
      .get(userId);
    res.status(201).json({ user: created });
  });

  router.patch('/admin/users/:id', authenticateRequest, requireRole('admin'), (req: AuthedRequest, res) => {
    const { status, newPassword } = req.body as { status?: string; newPassword?: string };
    const target = db.prepare('SELECT id, email, role, status FROM users WHERE id = ?').get(req.params.id) as
      | { id: string; email: string; role: string; status: string }
      | undefined;

    if (!target) {
      res.status(404).json({ error: 'User account not found.' });
      return;
    }

    const now = new Date().toISOString();
    if (status) {
      if (!['active', 'suspended'].includes(status)) {
        res.status(400).json({ error: 'Status must be active or suspended.' });
        return;
      }
      if (target.id === req.user!.id && status === 'suspended') {
        res.status(400).json({ error: 'An administrator cannot suspend their own active session.' });
        return;
      }
      db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, now, target.id);
      if (status === 'suspended') {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      }
    }

    if (newPassword !== undefined) {
      if (newPassword.length < 8) {
        res.status(400).json({ error: 'New password must be at least 8 characters.' });
        return;
      }
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
        hashPassword(newPassword),
        now,
        target.id
      );
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
    }

    logAudit(req.user!, 'admin.update_user', `user:${target.id}`, 'success', {
      statusUpdated: Boolean(status),
      passwordRotated: Boolean(newPassword),
    });

    const updated = db
      .prepare('SELECT id, email, full_name, role, status, created_at FROM users WHERE id = ?')
      .get(target.id);
    res.json({ user: updated });
  });

  return router;
}
