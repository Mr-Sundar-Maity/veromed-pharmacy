import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateAdherence,
  validateScheduleRule,
  generateOccurrencesForDate,
  buildReminderDedupeKey,
  computeRetryBackoffMs,
} from './adherence';
import {
  classifyExpiryWindow,
  isBatchEligibleForDispensing,
  validateAndApplyStockTransaction,
  reconcileLedgerQuantity,
} from './inventoryRules';
import {
  evaluateHoldoutModels,
  generateInventoryForecast,
} from './forecasting';
import {
  normalizeMedicineName,
  checkMedicationInteractions,
} from './interactions';
import {
  computeSessionExpiry,
  formatSessionBadge,
  getSessionRemainingDays,
  getSessionRemainingHours,
  isSessionExpired,
  SESSION_DURATION_DAYS,
  SESSION_DURATION_MS,
  SHORT_SESSION_HOURS,
  SHORT_SESSION_MS,
} from './session';
import { getNextTheme, normalizeThemeMode } from './theme';
import { matchMedicinesToPharmacies } from './medicineAvailability';
import {
  evaluatePrescriptionSupply,
  REFILL_DUE_THRESHOLD_DAYS,
} from './refillSupply';

test('Adherence excludes unconfirmed and pending doses from denominator', () => {
  const summary = calculateAdherence([
    { id: '1', scheduleId: 's1', scheduledAt: '2026-11-20T08:00:00Z', status: 'taken' },
    { id: '2', scheduleId: 's1', scheduledAt: '2026-11-21T08:00:00Z', status: 'taken' },
    { id: '3', scheduleId: 's1', scheduledAt: '2026-11-22T08:00:00Z', status: 'missed' },
    { id: '4', scheduleId: 's1', scheduledAt: '2026-11-23T08:00:00Z', status: 'unconfirmed' },
    { id: '5', scheduleId: 's1', scheduledAt: '2026-11-23T20:00:00Z', status: 'pending' },
  ]);

  assert.equal(summary.eligibleCount, 3);
  assert.equal(summary.takenCount, 2);
  assert.equal(summary.unconfirmedCount, 1);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.recordedAdherenceRate, 66.7);
});

test('Schedule validation & occurrence generation handle interval and weekly rules', () => {
  const invalid = validateScheduleRule({
    scheduleType: 'weekly',
    startDate: '2026-11-25',
    endDate: '2026-11-20',
    times: ['25:99'],
    daysOfWeek: [],
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length >= 3);

  const intervalOcc = generateOccurrencesForDate(
    {
      id: 's-int',
      medicationId: 'm1',
      scheduleType: 'interval_based',
      times: ['08:00'],
      intervalHours: 8,
      timezone: 'UTC',
      startDate: '2026-11-01',
      enabled: true,
    },
    '2026-11-23'
  );
  assert.deepEqual(intervalOcc, [
    '2026-11-23T08:00:00.000Z',
    '2026-11-23T16:00:00.000Z',
  ]);

  const dedupe = buildReminderDedupeKey('u1', 'med', 's1', '2026-11-23T08:00:00Z');
  assert.equal(dedupe, 'u1:med:s1:2026-11-23T08:00:00Z');
  assert.equal(computeRetryBackoffMs(2, 5000, 30000), 20000);
  assert.equal(computeRetryBackoffMs(5, 5000, 30000), 30000);
});

test('Expiry classification & expired batch dispensing block', () => {
  assert.equal(classifyExpiryWindow('2026-11-20', '2026-11-23').window, 'expired');
  assert.equal(classifyExpiryWindow('2026-11-28', '2026-11-23').window, 'critical_7d');
  assert.equal(classifyExpiryWindow('2026-12-15', '2026-11-23').window, 'warning_30d');
  assert.equal(classifyExpiryWindow('2027-07-01', '2026-11-23').window, 'healthy');

  const expiredBatch = {
    id: 'b-exp',
    batchNumber: 'LOT-EXP-01',
    expiryDate: '2026-11-01',
    quantity: 50,
  };
  const check = isBatchEligibleForDispensing(expiredBatch, '2026-11-23');
  assert.equal(check.eligible, false);

  assert.throws(
    () => validateAndApplyStockTransaction(expiredBatch, 'sale', 5, '2026-11-23'),
    /expired/i
  );

  const activeBatch = {
    id: 'b-ok',
    batchNumber: 'LOT-OK-01',
    expiryDate: '2027-06-01',
    quantity: 40,
  };
  const res = validateAndApplyStockTransaction(activeBatch, 'sale', 12, '2026-11-23');
  assert.equal(res.nextQuantity, 28);
  assert.equal(res.delta, -12);

  const reconciled = reconcileLedgerQuantity([
    { transactionType: 'stock_in', quantity: 50 },
    { transactionType: 'sale', quantity: 12 },
    { transactionType: 'wastage', quantity: 3 },
    { transactionType: 'return', quantity: 2 },
  ]);
  assert.equal(reconciled, 37);
});

test('ML forecasting evaluates holdout MAE/RMSE and returns advisory estimate', () => {
  const history = Array.from({ length: 45 }, (_, idx) => ({
    date: `2026-10-${String((idx % 28) + 1).padStart(2, '0')}`,
    unitsSold: 10 + (idx % 4),
  }));

  const evals = evaluateHoldoutModels(
    history.map((h) => h.unitsSold),
    14
  );
  assert.equal(evals.length, 3);
  assert.ok(evals.every((e) => Number.isFinite(e.mae) && Number.isFinite(e.rmse)));

  const forecast = generateInventoryForecast({
    itemId: 'item-1',
    itemName: 'Metformin 500mg',
    history,
    currentEligibleStock: 40,
    minThreshold: 60,
    modelDate: '2026-11-23',
  });
  assert.equal(forecast.stockoutRisk, 'high');
  assert.ok(forecast.advisoryReorderQuantity > 0);
  assert.match(forecast.disclaimer, /never trigger automatic purchase/i);
});

test('Interaction checker normalizes synonyms, flags unknown data, and cites source', () => {
  assert.equal(normalizeMedicineName('Coumadin 5mg'), 'warfarin');
  assert.equal(normalizeMedicineName('Ashwagandha Root'), null);

  const report = checkMedicationInteractions(['Coumadin 5mg', 'Aspirin 81mg', 'Ashwagandha Root']);
  const knownMatch = report.results.find(
    (r) => r.status === 'interaction_found'
  );
  assert.ok(knownMatch);
  assert.equal(knownMatch.severity, 'Major');
  assert.ok(knownMatch.source.sourceName.includes('FDA'));

  const unknownMatch = report.results.find(
    (r) => r.status === 'unknown_insufficient_data'
  );
  assert.ok(unknownMatch);
  assert.deepEqual(report.unknownMedicines, ['Ashwagandha Root']);
});

import {
  evaluateDueMedicationAlerts,
  formatPushNotificationMessage,
  normalizeNotificationPreferences,
} from './pushNotifications';

test('Medication push notification engine flags due/overdue doses and respects snooze & dismissal', () => {
  const baseNow = Date.parse('2026-11-23T20:05:00.000Z');
  const logs = [
    {
      id: 'l-taken',
      schedule_id: 's1',
      medication_name: 'Lisinopril 10 mg',
      scheduled_at: '2026-11-23T07:30:00.000Z',
      status: 'taken',
    },
    {
      id: 'l-due-now',
      schedule_id: 's1',
      medication_name: 'Metformin 500 mg',
      scheduled_at: '2026-11-23T20:00:00.000Z',
      status: 'pending',
    },
    {
      id: 'l-upcoming',
      schedule_id: 's2',
      medication_name: 'Atorvastatin 20 mg',
      scheduled_at: '2026-11-23T20:15:00.000Z',
      status: 'pending',
    },
    {
      id: 'l-overdue',
      schedule_id: 's3',
      medication_name: 'Vitamin D3 1000 IU',
      scheduled_at: '2026-11-23T18:30:00.000Z',
      status: 'pending',
    },
    {
      id: 'l-far-future',
      schedule_id: 's4',
      medication_name: 'Aspirin 75 mg',
      scheduled_at: '2026-11-23T23:00:00.000Z',
      status: 'pending',
    },
  ];

  const active = evaluateDueMedicationAlerts(logs, baseNow, {
    leadMinutes: 15,
    overdueGraceMinutes: 240,
  });

  assert.equal(active.length, 3);
  assert.equal(active[0].logId, 'l-due-now');
  assert.equal(active[0].urgency, 'due_now');
  assert.equal(active[1].logId, 'l-overdue');
  assert.equal(active[1].urgency, 'overdue');
  assert.equal(active[2].logId, 'l-upcoming');
  assert.equal(active[2].urgency, 'upcoming');

  const msg = formatPushNotificationMessage(active[0]);
  assert.match(msg.title, /Medication Time Now: Metformin 500 mg/);
  assert.equal(msg.tag, 'veromed-dose-l-due-now');

  const snoozed = evaluateDueMedicationAlerts(logs, baseNow, {
    leadMinutes: 15,
    overdueGraceMinutes: 240,
    snoozedUntilMap: { 'l-due-now': baseNow + 10 * 60_000 },
    dismissedIds: ['l-upcoming'],
  });
  assert.deepEqual(
    snoozed.map((a) => a.logId),
    ['l-overdue']
  );

  const prefs = normalizeNotificationPreferences({ leadMinutes: 30, soundEnabled: false });
  assert.equal(prefs.leadMinutes, 30);
  assert.equal(prefs.soundEnabled, false);
  assert.equal(prefs.pushEnabled, true);
});

import {
  enrichPharmacyWithMapMetadata,
  filterAndSortNearbyPharmacies,
} from './pharmacyLocator';

test('Pharmacy locator enriches map coordinates, filters by 24h/delivery/search, and sorts preferred first', () => {
  const raw = [
    { id: 'pharm-1', tenant_name: 'Apex Care Pharmacy', license_number: 'MH-1', address: 'Linking Road, Bandra' },
    { id: 'pharm-4', tenant_name: 'Lifeline 24x7 Pharmacy', license_number: 'MH-4', address: 'Carter Road, Bandra' },
    { id: 'pharm-5', tenant_name: 'Wellness Square Apothecary', license_number: 'MH-5', address: 'Pali Naka' },
  ];
  const enriched = raw.map(enrichPharmacyWithMapMetadata);
  assert.equal(enriched.length, 3);
  assert.ok(enriched.every((p) => p.mapX > 0 && p.mapY > 0));

  const open24h = filterAndSortNearbyPharmacies(enriched, { open24hOnly: true });
  assert.deepEqual(open24h.map((p) => p.id), ['pharm-4']);

  const withDeliveryAndPreferred = filterAndSortNearbyPharmacies(enriched, {
    deliveryOnly: true,
    preferredPharmacyId: 'pharm-4',
  });
  assert.deepEqual(withDeliveryAndPreferred.map((p) => p.id), ['pharm-4', 'pharm-1']);

  const searchMatch = filterAndSortNearbyPharmacies(enriched, { query: 'carter' });
  assert.deepEqual(searchMatch.map((p) => p.id), ['pharm-4']);
});

test('Session lifecycle supports 24-hour default and 30-day Remember Me windows', () => {
  assert.equal(SESSION_DURATION_DAYS, 30);
  assert.equal(SHORT_SESSION_HOURS, 24);
  const startMs = Date.parse('2026-11-01T00:00:00.000Z');

  // Remember Me ON -> 30 days
  const longExpiresAt = computeSessionExpiry(startMs, true);
  const day15Ms = startMs + 1000 * 60 * 60 * 24 * 15;
  assert.equal(isSessionExpired(longExpiresAt, day15Ms), false);
  assert.equal(getSessionRemainingDays(longExpiresAt, day15Ms), 15);
  assert.match(formatSessionBadge(longExpiresAt, true, day15Ms), /^30d session/);

  const day30Ms = startMs + SESSION_DURATION_MS;
  assert.equal(isSessionExpired(longExpiresAt, day30Ms), true);
  assert.equal(getSessionRemainingDays(longExpiresAt, day30Ms), 0);

  // Remember Me OFF -> 24 hours
  const shortExpiresAt = computeSessionExpiry(startMs, false);
  const hour23Ms = startMs + 1000 * 60 * 60 * 23;
  assert.equal(isSessionExpired(shortExpiresAt, hour23Ms), false);
  assert.equal(getSessionRemainingHours(shortExpiresAt, hour23Ms), 1);
  assert.match(formatSessionBadge(shortExpiresAt, false, hour23Ms), /^24h session/);

  const hour24Ms = startMs + SHORT_SESSION_MS;
  assert.equal(isSessionExpired(shortExpiresAt, hour24Ms), true);
  assert.equal(getSessionRemainingHours(shortExpiresAt, hour24Ms), 0);
  assert.equal(isSessionExpired(null), true);
});

test('Theme helper toggles deterministically between light and dark modes', () => {
  assert.equal(normalizeThemeMode('dark'), 'dark');
  assert.equal(normalizeThemeMode('unknown'), 'light');
  assert.equal(getNextTheme('light'), 'dark');
  assert.equal(getNextTheme('dark'), 'light');
});

test('Medicine availability matcher ranks pharmacies with all prescribed medicines in stock first', () => {
  const pharmacies = [
    enrichPharmacyWithMapMetadata({
      id: 'pharm-1',
      tenant_name: 'Apex Care Pharmacy',
      license_number: 'MH-1',
      address: 'Linking Road',
    }),
    enrichPharmacyWithMapMetadata({
      id: 'pharm-3',
      tenant_name: 'MedPlus Central Chemist',
      license_number: 'MH-3',
      address: 'Hill Road',
    }),
    enrichPharmacyWithMapMetadata({
      id: 'pharm-5',
      tenant_name: 'Wellness Square Apothecary',
      license_number: 'MH-5',
      address: 'Pali Naka',
    }),
  ];

  const stockRows = [
    {
      pharmacy_id: 'pharm-1',
      medicine_name: 'Clopidogrel 75 mg (Plavix)',
      available_quantity: 50,
      unit: 'strips (10 tabs)',
      unit_sell_price: 96,
      earliest_expiry: '2027-06-01',
    },
    {
      pharmacy_id: 'pharm-3',
      medicine_name: 'Clopidogrel 75 mg (Plavix)',
      available_quantity: 40,
      unit: 'strips (10 tabs)',
      unit_sell_price: 94,
      earliest_expiry: '2027-05-01',
    },
    {
      pharmacy_id: 'pharm-3',
      medicine_name: 'Omeprazole 20 mg (Prilosec)',
      available_quantity: 35,
      unit: 'strips (15 caps)',
      unit_sell_price: 65,
      earliest_expiry: '2027-04-01',
    },
    {
      pharmacy_id: 'pharm-5',
      medicine_name: 'Omeprazole 20 mg (Prilosec)',
      available_quantity: 0, // Zero available stock must be excluded
      unit: 'strips (15 caps)',
      unit_sell_price: 69,
      earliest_expiry: null,
    },
  ];

  const ranked = matchMedicinesToPharmacies({
    medicines: [
      { medicineName: 'Plavix', strength: '75 mg' },
      { medicineName: 'Prilosec', strength: '20 mg' },
    ],
    pharmacies,
    stockRows,
    preferredPharmacyId: 'pharm-1',
  });

  // pharm-3 has BOTH Clopidogrel (Plavix) and Omeprazole (Prilosec), so it ranks 1st above pharm-1 (partial 1/2)
  assert.equal(ranked[0].pharmacy.id, 'pharm-3');
  assert.equal(ranked[0].allAvailable, true);
  assert.equal(ranked[0].matchedCount, 2);

  assert.equal(ranked[1].pharmacy.id, 'pharm-1');
  assert.equal(ranked[1].allAvailable, false);
  assert.equal(ranked[1].matchedCount, 1);

  assert.equal(ranked[2].pharmacy.id, 'pharm-5');
  assert.equal(ranked[2].matchedCount, 0);
});

test('Medication Refill Due flags prescriptions with fewer than 7 days of usable supply remaining', () => {
  assert.equal(REFILL_DUE_THRESHOLD_DAYS, 7);
  const today = '2026-11-23';

  const personalInventory = [
    {
      id: 'pinv-1',
      medicine_name: 'Metformin 500 mg',
      quantity: 28,
      unit: 'tablets',
      expiry_date: '2027-07-01',
    },
    {
      id: 'pinv-2',
      medicine_name: 'Atorvastatin 20 mg',
      quantity: 6,
      unit: 'tablets',
      expiry_date: '2026-12-10',
    },
    {
      id: 'pinv-exp',
      medicine_name: 'Lisinopril 10 mg',
      quantity: 12,
      unit: 'tablets',
      expiry_date: '2026-11-10', // Expired stock must not count toward usable supply
    },
  ];

  // Twice daily (2/day), 28 tablets -> 14 days remaining (>= 7d) -> NOT due
  const metforminSupply = evaluatePrescriptionSupply({
    medication: {
      id: 'pmed-1',
      medicine_name: 'Metformin (Glycomet)',
      prescribed_dose: '1 tablet',
      frequency_label: 'Twice daily with meals',
    },
    schedule: {
      medication_id: 'pmed-1',
      schedule_type: 'multiple_daily',
      times_json: JSON.stringify(['08:00', '20:00']),
      enabled: 1,
    },
    personalInventory,
    todayDate: today,
  });
  assert.equal(metforminSupply.isRefillDue, false);
  assert.equal(metforminSupply.daysRemaining, 14);

  // Once daily (1/day), 6 tablets -> 6 days remaining (< 7d) -> Refill Due!
  const atorvastatinSupply = evaluatePrescriptionSupply({
    medication: {
      id: 'pmed-2',
      medicine_name: 'Atorvastatin (Lipitor)',
      prescribed_dose: '1 tablet',
      frequency_label: 'Once daily at bedtime',
    },
    schedule: {
      medication_id: 'pmed-2',
      schedule_type: 'once_daily',
      times_json: JSON.stringify(['22:00']),
      enabled: 1,
    },
    personalInventory,
    todayDate: today,
  });
  assert.equal(atorvastatinSupply.isRefillDue, true);
  assert.equal(atorvastatinSupply.daysRemaining, 6);
  assert.match(atorvastatinSupply.dueReason || '', /6 days of supply remaining/i);

  // Expired cabinet stock yields 0 usable supply -> Refill Due!
  const expiredOnlySupply = evaluatePrescriptionSupply({
    medication: {
      id: 'pmed-3',
      medicine_name: 'Lisinopril (Zestril)',
      prescribed_dose: '1 tablet',
      frequency_label: 'Once daily in the morning',
    },
    personalInventory,
    todayDate: today,
  });
  assert.equal(expiredOnlySupply.isRefillDue, true);
  assert.equal(expiredOnlySupply.usableQuantity, 0);
});

