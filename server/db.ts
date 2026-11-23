import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.resolve(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export const db = new Database(path.join(DATA_DIR, 'smartmed.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

function isoDateOffset(daysOffset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

export function initSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('patient', 'caregiver', 'pharmacist', 'admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'deactivated')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      remember_me INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS patient_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      dob TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      blood_group TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      preferred_pharmacy_id TEXT REFERENCES pharmacies(id) ON DELETE SET NULL,
      notification_prefs_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS caregiver_relationships (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      caregiver_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      caregiver_email TEXT NOT NULL,
      caregiver_name TEXT NOT NULL,
      relationship_label TEXT NOT NULL,
      consent_status TEXT NOT NULL CHECK(consent_status IN ('pending', 'active', 'revoked')),
      permissions_json TEXT NOT NULL,
      granted_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS medicine_catalog (
      id TEXT PRIMARY KEY,
      generic_name TEXT NOT NULL,
      brand_name TEXT NOT NULL,
      active_ingredients TEXT NOT NULL,
      strength TEXT NOT NULL,
      form TEXT NOT NULL,
      category TEXT NOT NULL,
      source TEXT NOT NULL,
      identifier_code TEXT,
      created_by_user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS patient_medications (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      medicine_id TEXT REFERENCES medicine_catalog(id),
      medicine_name TEXT NOT NULL,
      strength TEXT NOT NULL,
      prescribed_dose TEXT NOT NULL,
      route TEXT NOT NULL DEFAULT 'Oral',
      frequency_label TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      prescriber TEXT,
      instructions TEXT,
      patient_notes TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed', 'discontinued')),
      source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual', 'verified_prescription')),
      prescription_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS medication_schedules (
      id TEXT PRIMARY KEY,
      medication_id TEXT NOT NULL REFERENCES patient_medications(id) ON DELETE CASCADE,
      patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      schedule_type TEXT NOT NULL CHECK(schedule_type IN ('once_daily', 'multiple_daily', 'interval_based', 'weekly', 'custom')),
      times_json TEXT NOT NULL,
      interval_hours INTEGER,
      days_of_week_json TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      start_date TEXT NOT NULL,
      end_date TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS medication_logs (
      id TEXT PRIMARY KEY,
      schedule_id TEXT NOT NULL REFERENCES medication_schedules(id) ON DELETE CASCADE,
      patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      medication_name TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('taken', 'missed', 'skipped', 'delayed', 'pending', 'unconfirmed')),
      recorded_at TEXT,
      recorded_by TEXT REFERENCES users(id),
      note TEXT,
      idempotency_key TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS personal_inventory (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      medicine_name TEXT NOT NULL,
      batch_number TEXT,
      quantity INTEGER NOT NULL CHECK(quantity >= 0),
      unit TEXT NOT NULL,
      min_threshold INTEGER NOT NULL DEFAULT 5,
      purchase_date TEXT,
      expiry_date TEXT NOT NULL,
      storage_notes TEXT,
      source TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prescriptions (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      file_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      upload_date TEXT NOT NULL,
      document_date TEXT,
      doctor_name TEXT,
      ocr_status TEXT NOT NULL CHECK(ocr_status IN ('uploaded', 'draft_ready', 'confirmed', 'rejected', 'failed')),
      raw_text TEXT,
      engine_version TEXT,
      processing_ms INTEGER
    );

    CREATE TABLE IF NOT EXISTS prescription_items (
      id TEXT PRIMARY KEY,
      prescription_id TEXT NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
      medicine_name TEXT NOT NULL,
      strength TEXT NOT NULL,
      dosage TEXT NOT NULL,
      frequency TEXT NOT NULL,
      duration_days INTEGER NOT NULL DEFAULT 30,
      instructions TEXT,
      confidence_json TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'pending' CHECK(verification_status IN ('pending', 'approved', 'rejected'))
    );

    CREATE TABLE IF NOT EXISTS medical_documents (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_key TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('report', 'prescription', 'discharge_summary', 'test_result', 'insurance', 'bill', 'other')),
      tags TEXT NOT NULL DEFAULT '',
      document_date TEXT,
      provider TEXT,
      ocr_text TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'patient_upload',
      version INTEGER NOT NULL DEFAULT 1,
      uploaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS medical_conditions (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      condition_name TEXT NOT NULL,
      onset_date TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'resolved', 'managed')),
      source TEXT NOT NULL DEFAULT 'patient_entered',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS allergies (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      substance TEXT NOT NULL,
      reaction TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('Mild', 'Moderate', 'Severe')),
      source TEXT NOT NULL DEFAULT 'patient_entered',
      verification_status TEXT NOT NULL DEFAULT 'patient_reported'
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      facility TEXT NOT NULL,
      department TEXT,
      appointment_type TEXT NOT NULL CHECK(appointment_type IN ('consultation', 'follow_up', 'lab', 'imaging', 'vaccination', 'dental', 'other')),
      start_at TEXT NOT NULL,
      end_at TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      location TEXT,
      contact TEXT,
      notes TEXT,
      reminder_offsets_json TEXT NOT NULL DEFAULT '[1440, 120]',
      status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'rescheduled', 'completed', 'cancelled')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('med_reminder', 'appt_reminder', 'expiry_alert', 'low_stock', 'caregiver_alert', 'system')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'in_app',
      status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('queued', 'sent', 'retrying', 'failed', 'read')),
      attempts INTEGER NOT NULL DEFAULT 1,
      last_error TEXT,
      dedupe_key TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pharmacies (
      id TEXT PRIMARY KEY,
      tenant_name TEXT NOT NULL,
      license_number TEXT NOT NULL,
      address TEXT NOT NULL,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS pharmacy_members (
      pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      member_role TEXT NOT NULL CHECK(member_role IN ('lead_pharmacist', 'pharmacist', 'technician')),
      status TEXT NOT NULL DEFAULT 'active',
      PRIMARY KEY (pharmacy_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      contact_person TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      lead_time_days INTEGER NOT NULL DEFAULT 5,
      terms TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
      medicine_id TEXT REFERENCES medicine_catalog(id),
      sku TEXT NOT NULL,
      medicine_name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit TEXT NOT NULL,
      min_threshold INTEGER NOT NULL DEFAULT 30,
      unit_sell_price REAL NOT NULL DEFAULT 0,
      location_bin TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_batches (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
      batch_number TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity >= 0),
      supplier_id TEXT REFERENCES suppliers(id),
      purchase_price REAL NOT NULL DEFAULT 0,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_transactions (
      id TEXT PRIMARY KEY,
      pharmacy_id TEXT NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      batch_id TEXT NOT NULL REFERENCES inventory_batches(id) ON DELETE CASCADE,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('stock_in', 'stock_out', 'sale', 'adjustment', 'transfer', 'return', 'wastage')),
      quantity INTEGER NOT NULL,
      signed_delta INTEGER NOT NULL,
      actor_id TEXT NOT NULL REFERENCES users(id),
      reference_code TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT,
      actor_email TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      resource TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('success', 'denied', 'error')),
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS refill_requests (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      patient_medication_id TEXT NOT NULL REFERENCES patient_medications(id) ON DELETE CASCADE,
      medicine_name TEXT NOT NULL,
      strength TEXT NOT NULL,
      pharmacy_id TEXT REFERENCES pharmacies(id) ON DELETE SET NULL,
      pharmacy_name TEXT NOT NULL,
      quantity_requested INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested', 'approved', 'ready', 'completed', 'cancelled')),
      notes TEXT,
      requested_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_med_logs_patient ON medication_logs(patient_id, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_inv_batches_pharmacy ON inventory_batches(pharmacy_id, expiry_date);
    CREATE INDEX IF NOT EXISTS idx_inv_tx_item ON inventory_transactions(item_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_refill_patient ON refill_requests(patient_id, requested_at);
  `);

  // Safe idempotent migration for existing databases missing preferred_pharmacy_id or sessions.remember_me
  const profileCols = db.prepare(`PRAGMA table_info(patient_profiles)`).all() as Array<{ name: string }>;
  if (!profileCols.some((c) => c.name === 'preferred_pharmacy_id')) {
    db.exec(`ALTER TABLE patient_profiles ADD COLUMN preferred_pharmacy_id TEXT REFERENCES pharmacies(id) ON DELETE SET NULL`);
  }
  const sessionCols = db.prepare(`PRAGMA table_info(sessions)`).all() as Array<{ name: string }>;
  if (!sessionCols.some((c) => c.name === 'remember_me')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN remember_me INTEGER NOT NULL DEFAULT 1`);
  }
}

function ensureNearbyPharmacies(): void {
  const extraPharmacies: Array<[string, string, string, string]> = [
    ['pharm-3', 'MedPlus Central Chemist', 'MH-MUM-PH-51902', '210 Hill Road, Bandra West, Mumbai'],
    ['pharm-4', 'Lifeline 24x7 Pharmacy', 'MH-MUM-PH-63418', '52 Carter Road Promenade, Bandra West, Mumbai'],
    ['pharm-5', 'Wellness Square Apothecary', 'MH-MUM-PH-88210', '19 Pali Naka Lane, Bandra West, Mumbai'],
  ];
  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO pharmacies (id, tenant_name, license_number, address, timezone, status)
     VALUES (?, ?, ?, ?, 'Asia/Kolkata', 'active')`
  );
  for (const [id, name, license, addr] of extraPharmacies) {
    insertStmt.run(id, name, license, addr);
  }
  db.prepare(
    `UPDATE patient_profiles SET preferred_pharmacy_id = COALESCE(preferred_pharmacy_id, 'pharm-1') WHERE user_id = 'usr-patient-1'`
  ).run();
}

function ensurePharmacyCatalogStock(): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO medicine_catalog (id, generic_name, brand_name, active_ingredients, strength, form, category, source, identifier_code)
     VALUES ('cat-11', 'Clopidogrel', 'Plavix', 'Clopidogrel Bisulfate', '75 mg', 'Tablet', 'Cardiovascular', 'RxNorm-Reference', 'RX-32968')`
  ).run();

  const items: Array<[string, string, string | null, string, string, string, string, number, number, string]> = [
    // Apex Care Pharmacy (pharm-1) extra chronic-care items (Aspirin, Amlodipine, Clopidogrel)
    ['item-7', 'pharm-1', 'cat-6', 'SKU-ASP-75', 'Aspirin 75 mg (Ecosprin)', 'Cardiovascular', 'strips (14 tabs)', 30, 18.0, 'Rack A-05'],
    ['item-8', 'pharm-1', 'cat-8', 'SKU-AML-5', 'Amlodipine 5 mg (Norvasc)', 'Cardiovascular', 'strips (10 tabs)', 30, 42.0, 'Rack A-06'],
    ['item-9', 'pharm-1', 'cat-11', 'SKU-CLO-75', 'Clopidogrel 75 mg (Plavix)', 'Cardiovascular', 'strips (10 tabs)', 25, 96.0, 'Rack A-07'],

    // CityWell Pharmacy (pharm-2)
    ['item-p2-2', 'pharm-2', 'cat-6', 'CW-ASP-75', 'Aspirin 75 mg (Ecosprin)', 'Cardiovascular', 'strips (14 tabs)', 20, 17.5, 'Shelf 2'],
    ['item-p2-3', 'pharm-2', 'cat-8', 'CW-AML-5', 'Amlodipine 5 mg (Norvasc)', 'Cardiovascular', 'strips (10 tabs)', 20, 40.0, 'Shelf 3'],
    ['item-p2-4', 'pharm-2', 'cat-2', 'CW-ATO-20', 'Atorvastatin 20 mg (Lipitor)', 'Cardiovascular', 'strips (10 tabs)', 20, 110.0, 'Shelf 4'],

    // MedPlus Central Chemist (pharm-3)
    ['item-p3-1', 'pharm-3', 'cat-1', 'MP-MET-500', 'Metformin 500 mg (Glycomet)', 'Endocrinology', 'strips (10 tabs)', 30, 46.0, 'Bay A1'],
    ['item-p3-2', 'pharm-3', 'cat-6', 'MP-ASP-75', 'Aspirin 75 mg (Ecosprin)', 'Cardiovascular', 'strips (14 tabs)', 25, 19.0, 'Bay A2'],
    ['item-p3-3', 'pharm-3', 'cat-8', 'MP-AML-5', 'Amlodipine 5 mg (Norvasc)', 'Cardiovascular', 'strips (10 tabs)', 25, 43.0, 'Bay A3'],
    ['item-p3-4', 'pharm-3', 'cat-11', 'MP-CLO-75', 'Clopidogrel 75 mg (Plavix)', 'Cardiovascular', 'strips (10 tabs)', 20, 94.0, 'Bay A4'],
    ['item-p3-5', 'pharm-3', 'cat-9', 'MP-OME-20', 'Omeprazole 20 mg (Prilosec)', 'Gastroenterology', 'strips (15 caps)', 20, 65.0, 'Bay B1'],
    ['item-p3-6', 'pharm-3', 'cat-3', 'MP-LIS-10', 'Lisinopril 10 mg (Zestril)', 'Cardiovascular', 'strips (10 tabs)', 20, 80.0, 'Bay B2'],

    // Lifeline 24x7 Pharmacy (pharm-4)
    ['item-p4-1', 'pharm-4', 'cat-1', 'LL-MET-500', 'Metformin 500 mg (Glycomet)', 'Endocrinology', 'strips (10 tabs)', 35, 47.0, 'Counter C1'],
    ['item-p4-2', 'pharm-4', 'cat-6', 'LL-ASP-75', 'Aspirin 75 mg (Ecosprin)', 'Cardiovascular', 'strips (14 tabs)', 30, 18.0, 'Counter C2'],
    ['item-p4-3', 'pharm-4', 'cat-8', 'LL-AML-5', 'Amlodipine 5 mg (Norvasc)', 'Cardiovascular', 'strips (10 tabs)', 30, 41.0, 'Counter C3'],
    ['item-p4-4', 'pharm-4', 'cat-11', 'LL-CLO-75', 'Clopidogrel 75 mg (Plavix)', 'Cardiovascular', 'strips (10 tabs)', 25, 95.0, 'Counter C4'],
    ['item-p4-5', 'pharm-4', 'cat-9', 'LL-OME-20', 'Omeprazole 20 mg (Prilosec)', 'Gastroenterology', 'strips (15 caps)', 25, 66.0, 'Counter C5'],
    ['item-p4-6', 'pharm-4', 'cat-2', 'LL-ATO-20', 'Atorvastatin 20 mg (Lipitor)', 'Cardiovascular', 'strips (10 tabs)', 25, 114.0, 'Counter C6'],
    ['item-p4-7', 'pharm-4', 'cat-10', 'LL-PCM-650', 'Paracetamol 650 mg (Dolo)', 'Analgesic', 'strips (15 tabs)', 40, 32.0, 'Counter D1'],

    // Wellness Square Apothecary (pharm-5)
    ['item-p5-1', 'pharm-5', 'cat-6', 'WS-ASP-75', 'Aspirin 75 mg (Ecosprin)', 'Cardiovascular', 'strips (14 tabs)', 15, 20.0, 'Drawer 1'],
    ['item-p5-2', 'pharm-5', 'cat-4', 'WS-VITD-60K', 'Cholecalciferol 60000 IU (Vitamin D3)', 'Supplement', 'strips (4 caps)', 15, 125.0, 'Drawer 2'],
    ['item-p5-3', 'pharm-5', 'cat-9', 'WS-OME-20', 'Omeprazole 20 mg (Prilosec)', 'Gastroenterology', 'strips (15 caps)', 15, 69.0, 'Drawer 3'],
  ];

  const insertItemStmt = db.prepare(
    `INSERT OR IGNORE INTO inventory_items (id, pharmacy_id, medicine_id, sku, medicine_name, category, unit, min_threshold, unit_sell_price, location_bin, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertBatchStmt = db.prepare(
    `INSERT OR IGNORE INTO inventory_batches (id, item_id, pharmacy_id, batch_number, expiry_date, quantity, supplier_id, purchase_price, received_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  );

  for (const [id, pharmId, catId, sku, name, category, unit, minThresh, sellPrice, bin] of items) {
    insertItemStmt.run(id, pharmId, catId, sku, name, category, unit, minThresh, sellPrice, bin, now);
    insertBatchStmt.run(
      `batch-${id}`,
      id,
      pharmId,
      `LOT-${sku}`,
      isoDateOffset(210),
      65,
      Math.round(sellPrice * 0.65 * 100) / 100,
      isoDateOffset(-10)
    );
  }
}

function migrateLegacyDemoCredentials(): void {
  const adminEmail = (process.env.VEROMED_ADMIN_EMAIL || 'admin@veromed.care').trim().toLowerCase();
  const adminPass = process.env.VEROMED_ADMIN_PASSWORD || 'VeroAdmin#2026!';
  const now = new Date().toISOString();

  const legacyRows = db
    .prepare(`SELECT id, email FROM users WHERE id IN ('usr-patient-1', 'usr-caregiver-1', 'usr-pharma-1', 'usr-pharma-2', 'usr-admin-1')`)
    .all() as Array<{ id: string; email: string }>;

  const targets: Record<string, { email: string; password: string }> = {
    'usr-patient-1': { email: 'aarav.sharma@veromed.care', password: 'VeroPatient#2026!' },
    'usr-caregiver-1': { email: 'meera.sharma@veromed.care', password: 'VeroCare#2026!' },
    'usr-pharma-1': { email: 'priya.nair@veromed.care', password: 'VeroPharma#2026!' },
    'usr-pharma-2': { email: 'vikram.mehta@veromed.care', password: 'VeroCity#2026!' },
    'usr-admin-1': { email: adminEmail, password: adminPass },
  };

  let rotatedAny = false;
  for (const row of legacyRows) {
    const next = targets[row.id];
    if (!next) continue;
    const isLegacyDemo = row.email.endsWith('@veromed.local');
    const isAdminEnvOverride =
      row.id === 'usr-admin-1' &&
      (process.env.VEROMED_ADMIN_EMAIL || process.env.VEROMED_ADMIN_PASSWORD) &&
      row.email !== adminEmail;

    if (isLegacyDemo || isAdminEnvOverride) {
      db.prepare(`UPDATE users SET email = ?, password_hash = ?, updated_at = ? WHERE id = ?`).run(
        next.email,
        hashPassword(next.password),
        now,
        row.id
      );
      rotatedAny = true;
    }
  }

  if (rotatedAny) {
    db.prepare(`UPDATE caregiver_relationships SET caregiver_email = 'meera.sharma@veromed.care' WHERE id = 'cg-rel-1' AND caregiver_email = 'caregiver@veromed.local'`).run();
    db.prepare(`DELETE FROM sessions`).run();
  }
}

export function seedDatabase(): void {
  const existingUsers = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
  if (existingUsers.c > 0) {
    migrateLegacyDemoCredentials();
    ensureNearbyPharmacies();
    ensurePharmacyCatalogStock();
    return;
  }

  const now = new Date().toISOString();
  const today = isoDateOffset(0);
  const adminEmail = (process.env.VEROMED_ADMIN_EMAIL || 'admin@veromed.care').trim().toLowerCase();
  const adminPassword = process.env.VEROMED_ADMIN_PASSWORD || 'VeroAdmin#2026!';

  const insertUser = db.prepare(`
    INSERT INTO users (id, email, password_hash, full_name, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
  `);

  // Provisioned Role Accounts
  insertUser.run('usr-patient-1', 'aarav.sharma@veromed.care', hashPassword('VeroPatient#2026!'), 'Aarav Sharma', 'patient', now, now);
  insertUser.run('usr-caregiver-1', 'meera.sharma@veromed.care', hashPassword('VeroCare#2026!'), 'Meera Sharma', 'caregiver', now, now);
  insertUser.run('usr-pharma-1', 'priya.nair@veromed.care', hashPassword('VeroPharma#2026!'), 'Dr. Priya Nair', 'pharmacist', now, now);
  insertUser.run('usr-pharma-2', 'vikram.mehta@veromed.care', hashPassword('VeroCity#2026!'), 'Vikram Mehta', 'pharmacist', now, now);
  insertUser.run('usr-admin-1', adminEmail, hashPassword(adminPassword), 'Rohan Deshmukh', 'admin', now, now);

  // Patient Profile
  db.prepare(`
    INSERT INTO patient_profiles (user_id, display_name, dob, timezone, blood_group, emergency_contact_name, emergency_contact_phone, notification_prefs_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'usr-patient-1',
    'Aarav Sharma',
    '1978-05-14',
    'Asia/Kolkata',
    'O+',
    'Meera Sharma',
    '+91-98201-44210',
    JSON.stringify({ inApp: true, email: true, browserPush: false, quietStart: '22:30', quietEnd: '06:30' })
  );

  // Caregiver Relationship (granular consent)
  db.prepare(`
    INSERT INTO caregiver_relationships (id, patient_id, caregiver_user_id, caregiver_email, caregiver_name, relationship_label, consent_status, permissions_json, granted_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(
    'cg-rel-1',
    'usr-patient-1',
    'usr-caregiver-1',
    'meera.sharma@veromed.care',
    'Meera Sharma',
    'Spouse & Primary Caregiver',
    JSON.stringify({
      schedules: true,
      dose_history: true,
      appointments: true,
      documents: false,
      medical_history: false,
      emergency_info: true,
    }),
    now,
    now
  );

  // Medicine Catalog
  const catalogEntries = [
    ['cat-1', 'Metformin', 'Glycomet', 'Metformin Hydrochloride', '500 mg', 'Tablet', 'Endocrinology', 'RxNorm-Reference', 'RX-6809'],
    ['cat-2', 'Atorvastatin', 'Lipitor', 'Atorvastatin Calcium', '20 mg', 'Tablet', 'Cardiovascular', 'RxNorm-Reference', 'RX-83367'],
    ['cat-3', 'Lisinopril', 'Zestril', 'Lisinopril Dihydrate', '10 mg', 'Tablet', 'Cardiovascular', 'RxNorm-Reference', 'RX-29046'],
    ['cat-4', 'Cholecalciferol', 'D-Rise', 'Vitamin D3', '60000 IU', 'Softgel', 'Supplement', 'RxNorm-Reference', 'RX-11253'],
    ['cat-5', 'Amoxicillin', 'Augmentin', 'Amoxicillin / Clavulanate', '625 mg', 'Tablet', 'Antibiotic', 'RxNorm-Reference', 'RX-723'],
    ['cat-6', 'Aspirin', 'Ecosprin', 'Acetylsalicylic Acid', '75 mg', 'Tablet', 'Cardiovascular', 'RxNorm-Reference', 'RX-1191'],
    ['cat-7', 'Warfarin', 'Coumadin', 'Warfarin Sodium', '5 mg', 'Tablet', 'Anticoagulant', 'RxNorm-Reference', 'RX-11289'],
    ['cat-8', 'Amlodipine', 'Norvasc', 'Amlodipine Besylate', '5 mg', 'Tablet', 'Cardiovascular', 'RxNorm-Reference', 'RX-17767'],
    ['cat-9', 'Omeprazole', 'Prilosec', 'Omeprazole Magnesium', '20 mg', 'Capsule', 'Gastroenterology', 'RxNorm-Reference', 'RX-7646'],
    ['cat-10', 'Acetaminophen', 'Dolo 650', 'Paracetamol', '650 mg', 'Tablet', 'Analgesic', 'RxNorm-Reference', 'RX-161'],
  ];

  const insertCat = db.prepare(`
    INSERT INTO medicine_catalog (id, generic_name, brand_name, active_ingredients, strength, form, category, source, identifier_code)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const row of catalogEntries) {
    insertCat.run(...row);
  }

  // Patient Medications & Schedules
  const insertMed = db.prepare(`
    INSERT INTO patient_medications (id, patient_id, medicine_id, medicine_name, strength, prescribed_dose, route, frequency_label, start_date, end_date, prescriber, instructions, patient_notes, status, source_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertMed.run('pmed-1', 'usr-patient-1', 'cat-1', 'Metformin (Glycomet)', '500 mg', '1 tablet', 'Oral', 'Twice daily with meals', isoDateOffset(-45), null, 'Dr. Ananya Rao', 'Take after breakfast and dinner to minimize GI discomfort.', 'No stomach upset when taken post-meal.', 'active', 'verified_prescription', now, now);
  insertMed.run('pmed-2', 'usr-patient-1', 'cat-2', 'Atorvastatin (Lipitor)', '20 mg', '1 tablet', 'Oral', 'Once daily at bedtime', isoDateOffset(-90), null, 'Dr. S. Kulkarni', 'Take at night regardless of food.', null, 'active', 'verified_prescription', now, now);
  insertMed.run('pmed-3', 'usr-patient-1', 'cat-3', 'Lisinopril (Zestril)', '10 mg', '1 tablet', 'Oral', 'Once daily in the morning', isoDateOffset(-90), null, 'Dr. S. Kulkarni', 'Monitor morning blood pressure weekly.', null, 'active', 'verified_prescription', now, now);
  insertMed.run('pmed-4', 'usr-patient-1', 'cat-4', 'Vitamin D3 (D-Rise)', '60000 IU', '1 softgel', 'Oral', 'Weekly on Sundays', isoDateOffset(-30), isoDateOffset(60), 'Dr. Ananya Rao', 'Take with milk or main meal.', null, 'active', 'manual', now, now);

  const insertSched = db.prepare(`
    INSERT INTO medication_schedules (id, medication_id, patient_id, schedule_type, times_json, interval_hours, days_of_week_json, timezone, start_date, end_date, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  insertSched.run('sched-1', 'pmed-1', 'usr-patient-1', 'multiple_daily', JSON.stringify(['08:00', '20:00']), null, null, 'Asia/Kolkata', isoDateOffset(-45), null, now);
  insertSched.run('sched-2', 'pmed-2', 'usr-patient-1', 'once_daily', JSON.stringify(['22:00']), null, null, 'Asia/Kolkata', isoDateOffset(-90), null, now);
  insertSched.run('sched-3', 'pmed-3', 'usr-patient-1', 'once_daily', JSON.stringify(['07:30']), null, null, 'Asia/Kolkata', isoDateOffset(-90), null, now);
  insertSched.run('sched-4', 'pmed-4', 'usr-patient-1', 'weekly', JSON.stringify(['09:00']), null, JSON.stringify([0]), 'Asia/Kolkata', isoDateOffset(-30), isoDateOffset(60), now);

  // 14 Days of Dose Logs + Today's Pending/Taken doses
  const insertLog = db.prepare(`
    INSERT INTO medication_logs (id, schedule_id, patient_id, medication_name, scheduled_at, status, recorded_at, recorded_by, note, idempotency_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let logCounter = 1;
  for (let d = -13; d <= 0; d++) {
    const dateStr = isoDateOffset(d);
    const items: Array<{ schedId: string; medName: string; time: string }> = [
      { schedId: 'sched-3', medName: 'Lisinopril (Zestril) 10 mg', time: '07:30' },
      { schedId: 'sched-1', medName: 'Metformin (Glycomet) 500 mg', time: '08:00' },
      { schedId: 'sched-1', medName: 'Metformin (Glycomet) 500 mg', time: '20:00' },
      { schedId: 'sched-2', medName: 'Atorvastatin (Lipitor) 20 mg', time: '22:00' },
    ];

    for (const item of items) {
      const scheduledAt = `${dateStr}T${item.time}:00.000Z`;
      let status: string = 'taken';
      let recordedAt: string | null = scheduledAt;
      let note: string | null = null;

      if (d === 0) {
        if (item.time === '07:30') {
          status = 'taken';
        } else {
          status = 'pending';
          recordedAt = null;
        }
      } else if (d === -2 && item.time === '20:00') {
        status = 'delayed';
        note = 'Taken 45 mins after dinner.';
      } else if (d === -5 && item.time === '22:00') {
        status = 'missed';
        recordedAt = null;
      } else if (d === -8 && item.time === '08:00') {
        status = 'unconfirmed';
        recordedAt = null;
        note = 'Patient did not respond to reminder.';
      } else if (d === -10 && item.time === '20:00') {
        status = 'skipped';
        note = 'Fasting prior to morning lipid panel.';
      }

      insertLog.run(
        `log-${logCounter++}`,
        item.schedId,
        'usr-patient-1',
        item.medName,
        scheduledAt,
        status,
        recordedAt,
        status === 'pending' || status === 'unconfirmed' ? null : 'usr-patient-1',
        note,
        `seed:${item.schedId}:${scheduledAt}`
      );
    }
  }

  // Personal Medicine Inventory (includes healthy, expiring soon, and expired)
  const insertPersonalInv = db.prepare(`
    INSERT INTO personal_inventory (id, patient_id, medicine_name, batch_number, quantity, unit, min_threshold, purchase_date, expiry_date, storage_notes, source, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertPersonalInv.run('pinv-1', 'usr-patient-1', 'Metformin 500 mg', 'PM-4410', 28, 'tablets', 10, isoDateOffset(-20), isoDateOffset(240), 'Cool dry cabinet away from sunlight', 'Apex Care Pharmacy', now);
  insertPersonalInv.run('pinv-2', 'usr-patient-1', 'Atorvastatin 20 mg', 'AT-9082', 6, 'tablets', 8, isoDateOffset(-40), isoDateOffset(18), 'Bedroom drawer organizer', 'Apex Care Pharmacy', now);
  insertPersonalInv.run('pinv-3', 'usr-patient-1', 'Ibuprofen 400 mg (PRN)', 'IB-1120', 10, 'tablets', 4, isoDateOffset(-210), isoDateOffset(-12), 'Do not use — expired pack awaiting disposal', 'Retail Pharmacy', now);

  // Sample Prescriptions (1 verified, 1 pending OCR draft for human review!)
  db.prepare(`
    INSERT INTO prescriptions (id, patient_id, file_name, file_key, mime_type, upload_date, document_date, doctor_name, ocr_status, raw_text, engine_version, processing_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rx-1',
    'usr-patient-1',
    'dr_rao_endocrinology_rx.svg',
    'sample-verified-rx',
    'image/svg+xml',
    isoDateOffset(-45),
    isoDateOffset(-45),
    'Dr. Ananya Rao (MD Endocrinology)',
    'confirmed',
    'Patient: Aarav Sharma\nRx: Tab. Glycomet (Metformin) 500mg — 1 tab BD after food x 90 days.\nCap. D-Rise 60000 IU — 1 cap weekly x 8 weeks.',
    'gemini-4-hydrogen-ocr',
    1240
  );

  db.prepare(`
    INSERT INTO prescription_items (id, prescription_id, medicine_name, strength, dosage, frequency, duration_days, instructions, confidence_json, verification_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rxi-1',
    'rx-1',
    'Metformin (Glycomet)',
    '500 mg',
    '1 tablet',
    'Twice daily (08:00, 20:00)',
    90,
    'After breakfast and dinner',
    JSON.stringify({ medicineName: 0.98, strength: 0.99, dosage: 0.97, frequency: 0.95 }),
    'approved'
  );

  // Pending OCR draft awaiting human verification (AC-08 & AC-09)
  db.prepare(`
    INSERT INTO prescriptions (id, patient_id, file_name, file_key, mime_type, upload_date, document_date, doctor_name, ocr_status, raw_text, engine_version, processing_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rx-2',
    'usr-patient-1',
    'cardiology_followup_rx_scan.svg',
    'sample-pending-rx',
    'image/svg+xml',
    today,
    today,
    'Dr. S. Kulkarni (Cardiology)',
    'draft_ready',
    'PATIENT: Aarav Sharma | DATE: ' + today + '\nDR. S. KULKARNI - CARDIOLOGY CLINIC\n1. Tab. Ecosprin (Aspirin) 75mg - 1 tab OD after lunch\n2. Tab. Norvasc (Amlodipine) 5mg - 1 tab OD morning (handwriting faint on strength)',
    'gemini-4-hydrogen-ocr',
    1480
  );

  db.prepare(`
    INSERT INTO prescription_items (id, prescription_id, medicine_name, strength, dosage, frequency, duration_days, instructions, confidence_json, verification_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rxi-2',
    'rx-2',
    'Aspirin (Ecosprin)',
    '75 mg',
    '1 tablet',
    'Once daily (13:30)',
    30,
    'Take after lunch',
    JSON.stringify({ medicineName: 0.96, strength: 0.94, dosage: 0.95, frequency: 0.91 }),
    'pending'
  );
  db.prepare(`
    INSERT INTO prescription_items (id, prescription_id, medicine_name, strength, dosage, frequency, duration_days, instructions, confidence_json, verification_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'rxi-3',
    'rx-2',
    'Amlodipine (Norvasc)',
    '5 mg',
    '1 tablet',
    'Once daily (08:30)',
    30,
    'Check BP before dose; handwritten strength low confidence',
    JSON.stringify({ medicineName: 0.92, strength: 0.64, dosage: 0.89, frequency: 0.86 }),
    'pending'
  );

  // Medical Conditions, Allergies & Documents
  db.prepare(`INSERT INTO medical_conditions (id, patient_id, condition_name, onset_date, status, source, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'cond-1', 'usr-patient-1', 'Type 2 Diabetes Mellitus', '2023-03-10', 'managed', 'clinical_record', 'Managed with Metformin 500mg BD and diet.'
  );
  db.prepare(`INSERT INTO medical_conditions (id, patient_id, condition_name, onset_date, status, source, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'cond-2', 'usr-patient-1', 'Essential Hypertension (Stage 1)', '2024-01-18', 'managed', 'clinical_record', 'Managed with Lisinopril 10mg daily.'
  );

  db.prepare(`INSERT INTO allergies (id, patient_id, substance, reaction, severity, source, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'alg-1', 'usr-patient-1', 'Penicillin / Amoxicillin', 'Generalized urticaria and rash', 'Severe', 'clinical_record', 'clinician_verified'
  );
  db.prepare(`INSERT INTO allergies (id, patient_id, substance, reaction, severity, source, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    'alg-2', 'usr-patient-1', 'Shellfish', 'Mild oral itching', 'Mild', 'patient_entered', 'patient_reported'
  );

  const insertDoc = db.prepare(`
    INSERT INTO medical_documents (id, patient_id, title, file_name, file_key, mime_type, category, tags, document_date, provider, ocr_text, source, version, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);
  insertDoc.run(
    'doc-1', 'usr-patient-1', 'HbA1c & Comprehensive Lipid Panel', 'hba1c_lipid_panel.txt', 'seed-doc-1', 'text/plain', 'test_result', 'diabetes,lipids,lab', isoDateOffset(-14), 'Metropolis Diagnostics',
    'HbA1c: 6.7% (Target <7.0%). Fasting Glucose: 112 mg/dL. LDL Cholesterol: 88 mg/dL. HDL: 49 mg/dL. Triglycerides: 134 mg/dL.', 'lab_portal', now
  );
  insertDoc.run(
    'doc-2', 'usr-patient-1', 'Annual Cardiology Consultation Summary', 'cardiology_consult.txt', 'seed-doc-2', 'text/plain', 'report', 'cardiology,bp,ecg', isoDateOffset(-35), 'Dr. S. Kulkarni · HeartCare Center',
    'Resting ECG normal sinus rhythm. Office BP 126/80 mmHg. Continue Lisinopril 10mg OD and Atorvastatin 20mg HS.', 'provider_report', now
  );

  // Appointments
  const insertAppt = db.prepare(`
    INSERT INTO appointments (id, patient_id, provider, facility, department, appointment_type, start_at, end_at, timezone, location, contact, notes, reminder_offsets_json, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertAppt.run(
    'appt-1', 'usr-patient-1', 'Dr. Ananya Rao', 'Apollo Specialty Clinic', 'Endocrinology', 'follow_up',
    `${isoDateOffset(3)}T10:30:00.000Z`, `${isoDateOffset(3)}T11:00:00.000Z`, 'Asia/Kolkata',
    'Suite 304, 3rd Floor', '+91-22-4012-8890', 'Bring recent HbA1c and home fasting glucose log.', JSON.stringify([1440, 120]), 'scheduled', now
  );
  insertAppt.run(
    'appt-2', 'usr-patient-1', 'Metropolis Lab Wing', 'Metropolis Diagnostics', 'Pathology', 'lab',
    `${isoDateOffset(10)}T07:30:00.000Z`, `${isoDateOffset(10)}T08:00:00.000Z`, 'Asia/Kolkata',
    'Ground Floor Phlebotomy', '+91-22-3399-1122', '10-hour overnight fasting required.', JSON.stringify([1440, 120]), 'scheduled', now
  );

  // Pharmacies (Two isolated operational tenants + nearby community pharmacies)
  db.prepare(`INSERT INTO pharmacies (id, tenant_name, license_number, address, timezone, status) VALUES (?, ?, ?, ?, ?, 'active')`).run(
    'pharm-1', 'Apex Care Pharmacy', 'MH-MUM-PH-48291', '14 Linking Road, Bandra West, Mumbai', 'Asia/Kolkata'
  );
  db.prepare(`INSERT INTO pharmacies (id, tenant_name, license_number, address, timezone, status) VALUES (?, ?, ?, ?, ?, 'active')`).run(
    'pharm-2', 'CityWell Pharmacy', 'MH-MUM-PH-77104', '88 MG Road, Fort, Mumbai', 'Asia/Kolkata'
  );
  ensureNearbyPharmacies();

  db.prepare(`INSERT INTO pharmacy_members (pharmacy_id, user_id, member_role, status) VALUES (?, ?, 'lead_pharmacist', 'active')`).run('pharm-1', 'usr-pharma-1');
  db.prepare(`INSERT INTO pharmacy_members (pharmacy_id, user_id, member_role, status) VALUES (?, ?, 'lead_pharmacist', 'active')`).run('pharm-2', 'usr-pharma-2');

  // Suppliers
  const insertSup = db.prepare(`INSERT INTO suppliers (id, pharmacy_id, name, contact_person, email, phone, lead_time_days, terms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`);
  insertSup.run('sup-1', 'pharm-1', 'MedLine Distributors Ltd.', 'Suresh Iyer', 'orders@medline-dist.example', '+91-22-6611-2200', 4, 'Net 30 · Cold-chain certified');
  insertSup.run('sup-2', 'pharm-1', 'SunCure Pharma Supply', 'Kavita Joshi', 'supply@suncure.example', '+91-22-6688-9900', 7, 'Net 45 · Minimum order 50 units');
  insertSup.run('sup-3', 'pharm-2', 'Metro Wholesale Rx', 'Arjun Kapoor', 'arjun@metrowholesale.example', '+91-22-5511-0011', 5, 'Net 30');

  // Inventory Items for Pharmacy 1 (Apex Care) and Pharmacy 2 (CityWell)
  const insertItem = db.prepare(`
    INSERT INTO inventory_items (id, pharmacy_id, medicine_id, sku, medicine_name, category, unit, min_threshold, unit_sell_price, location_bin, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertItem.run('item-1', 'pharm-1', 'cat-1', 'SKU-MET-500', 'Metformin 500 mg (Glycomet)', 'Endocrinology', 'strips (10 tabs)', 40, 48.0, 'Rack A-01', now);
  insertItem.run('item-2', 'pharm-1', 'cat-2', 'SKU-ATO-20', 'Atorvastatin 20 mg (Lipitor)', 'Cardiovascular', 'strips (10 tabs)', 35, 115.0, 'Rack A-04', now);
  insertItem.run('item-3', 'pharm-1', 'cat-3', 'SKU-LIS-10', 'Lisinopril 10 mg (Zestril)', 'Cardiovascular', 'strips (10 tabs)', 30, 82.0, 'Rack B-02', now);
  insertItem.run('item-4', 'pharm-1', 'cat-5', 'SKU-AMX-625', 'Amoxicillin/Clav 625 mg', 'Antibiotic', 'strips (6 tabs)', 25, 165.0, 'Rack C-01', now);
  insertItem.run('item-5', 'pharm-1', 'cat-10', 'SKU-PCM-650', 'Paracetamol 650 mg (Dolo)', 'Analgesic', 'strips (15 tabs)', 60, 34.0, 'Rack D-03', now);
  insertItem.run('item-6', 'pharm-1', 'cat-9', 'SKU-OME-20', 'Omeprazole 20 mg (Prilosec)', 'Gastroenterology', 'strips (15 caps)', 25, 68.0, 'Rack B-08', now);
  // Tenant 2 isolated item
  insertItem.run('item-p2-1', 'pharm-2', 'cat-1', 'CW-MET-500', 'CityWell Metformin 500 mg', 'Endocrinology', 'strips (10 tabs)', 20, 45.0, 'Shelf 1', now);

  // Inventory Batches (including Healthy, 90d, 30d, 7d critical, and EXPIRED!)
  const insertBatch = db.prepare(`
    INSERT INTO inventory_batches (id, item_id, pharmacy_id, batch_number, expiry_date, quantity, supplier_id, purchase_price, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertBatch.run('batch-1', 'item-1', 'pharm-1', 'LOT-MET-26A', isoDateOffset(240), 95, 'sup-1', 31.0, isoDateOffset(-60));
  insertBatch.run('batch-2', 'item-1', 'pharm-1', 'LOT-MET-25Z', isoDateOffset(22), 18, 'sup-1', 30.0, isoDateOffset(-140));
  insertBatch.run('batch-3', 'item-2', 'pharm-1', 'LOT-ATO-26B', isoDateOffset(160), 28, 'sup-2', 78.0, isoDateOffset(-45)); // Low stock (28 <= 35)
  insertBatch.run('batch-4', 'item-3', 'pharm-1', 'LOT-LIS-26C', isoDateOffset(5), 14, 'sup-1', 54.0, isoDateOffset(-120)); // Critical <= 7d & Low stock!
  insertBatch.run('batch-5', 'item-3', 'pharm-1', 'LOT-LIS-26D', isoDateOffset(310), 42, 'sup-1', 55.0, isoDateOffset(-20));
  insertBatch.run('batch-6', 'item-4', 'pharm-1', 'LOT-AMX-EXP', isoDateOffset(-8), 24, 'sup-2', 110.0, isoDateOffset(-300)); // EXPIRED BATCH!
  insertBatch.run('batch-7', 'item-4', 'pharm-1', 'LOT-AMX-26E', isoDateOffset(195), 55, 'sup-2', 112.0, isoDateOffset(-15));
  insertBatch.run('batch-8', 'item-5', 'pharm-1', 'LOT-PCM-26F', isoDateOffset(365), 140, 'sup-1', 21.0, isoDateOffset(-30));
  insertBatch.run('batch-9', 'item-6', 'pharm-1', 'LOT-OME-26G', isoDateOffset(48), 20, 'sup-2', 42.0, isoDateOffset(-90)); // Low stock & <=60d
  insertBatch.run('batch-p2-1', 'item-p2-1', 'pharm-2', 'CW-LOT-01', isoDateOffset(200), 60, 'sup-3', 29.0, isoDateOffset(-15));

  // Seed 45 days of historical stock transactions so ML Demand Forecasting + Holdout MAE/RMSE + Analytics reconcile!
  const insertTx = db.prepare(`
    INSERT INTO inventory_transactions (id, pharmacy_id, item_id, batch_id, transaction_type, quantity, signed_delta, actor_id, reference_code, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Initial stock-in records matching current quantities plus historical sales
  const itemBatchMap: Array<{ itemId: string; batchId: string; currentQty: number; baseDailySale: number }> = [
    { itemId: 'item-1', batchId: 'batch-1', currentQty: 95, baseDailySale: 6 },
    { itemId: 'item-2', batchId: 'batch-3', currentQty: 28, baseDailySale: 4 },
    { itemId: 'item-3', batchId: 'batch-5', currentQty: 42, baseDailySale: 3 },
    { itemId: 'item-4', batchId: 'batch-7', currentQty: 55, baseDailySale: 3 },
    { itemId: 'item-5', batchId: 'batch-8', currentQty: 140, baseDailySale: 9 },
    { itemId: 'item-6', batchId: 'batch-9', currentQty: 20, baseDailySale: 2 },
  ];

  let txId = 1;
  for (const m of itemBatchMap) {
    let totalHistoricalSold = 0;
    const dailySales: Array<{ date: string; qty: number }> = [];
    for (let d = 44; d >= 1; d--) {
      const dateStr = isoDateOffset(-d);
      const wave = ((d * 3 + m.baseDailySale) % 5) - 1;
      const qty = Math.max(1, m.baseDailySale + wave);
      totalHistoricalSold += qty;
      dailySales.push({ date: dateStr, qty });
    }

    // Opening stock-in so ledger mathematically reconciles to batch.quantity!
    insertTx.run(
      `tx-${txId++}`,
      'pharm-1',
      m.itemId,
      m.batchId,
      'stock_in',
      m.currentQty + totalHistoricalSold,
      m.currentQty + totalHistoricalSold,
      'usr-pharma-1',
      `GRN-INIT-${m.batchId}`,
      'Opening verified batch receipt',
      `${isoDateOffset(-45)}T08:00:00.000Z`
    );

    for (const s of dailySales) {
      insertTx.run(
        `tx-${txId++}`,
        'pharm-1',
        m.itemId,
        m.batchId,
        'sale',
        s.qty,
        -s.qty,
        'usr-pharma-1',
        `POS-${s.date}`,
        'Counter dispensing sale',
        `${s.date}T14:30:00.000Z`
      );
    }
  }

  // Opening stock-in entries for remaining secondary batches so every batch reconciles!
  insertTx.run(`tx-${txId++}`, 'pharm-1', 'item-1', 'batch-2', 'stock_in', 18, 18, 'usr-pharma-1', 'GRN-B2', 'Secondary batch receipt', `${isoDateOffset(-140)}T09:00:00.000Z`);
  insertTx.run(`tx-${txId++}`, 'pharm-1', 'item-3', 'batch-4', 'stock_in', 14, 14, 'usr-pharma-1', 'GRN-B4', 'Short-dated batch receipt', `${isoDateOffset(-120)}T09:00:00.000Z`);
  insertTx.run(`tx-${txId++}`, 'pharm-1', 'item-4', 'batch-6', 'stock_in', 24, 24, 'usr-pharma-1', 'GRN-B6', 'Quarantined expired batch', `${isoDateOffset(-300)}T09:00:00.000Z`);
  insertTx.run(`tx-${txId++}`, 'pharm-2', 'item-p2-1', 'batch-p2-1', 'stock_in', 60, 60, 'usr-pharma-2', 'CW-GRN-1', 'CityWell opening stock', `${isoDateOffset(-15)}T09:00:00.000Z`);

  ensurePharmacyCatalogStock();

  // Initial Audit Log
  db.prepare(`INSERT INTO audit_logs (id, actor_id, actor_email, actor_role, action, resource, outcome, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, 'success', ?, ?)`).run(
    'aud-seed-1', 'usr-admin-1', adminEmail, 'admin', 'system.seed', 'database', JSON.stringify({ note: 'Initial clinical and pharmacy records provisioned' }), now
  );
}
