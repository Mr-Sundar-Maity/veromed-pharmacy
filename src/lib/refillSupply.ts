export const REFILL_DUE_THRESHOLD_DAYS = 7;

export interface SupplyMedicationInput {
  id: string;
  medicine_name: string;
  strength?: string | null;
  prescribed_dose?: string | null;
  frequency_label?: string | null;
  end_date?: string | null;
}

export interface SupplyScheduleInput {
  medication_id: string;
  schedule_type?: string | null;
  times_json?: string | null;
  interval_hours?: number | null;
  days_of_week_json?: string | null;
  enabled?: number | boolean | null;
}

export interface PersonalInventorySupplyInput {
  id: string;
  medicine_name: string;
  quantity: number;
  unit: string;
  expiry_date: string;
}

export interface PrescriptionSupplyEvaluation {
  medicationId: string;
  hasSupplyTracking: boolean;
  usableQuantity: number;
  unit: string | null;
  dailyDoseRate: number;
  daysRemaining: number | null;
  daysUntilEndDate: number | null;
  isRefillDue: boolean;
  dueReason: string | null;
}

const IGNORED_KEYWORDS = new Set([
  'tablet',
  'tablets',
  'tab',
  'tabs',
  'capsule',
  'capsules',
  'cap',
  'caps',
  'softgel',
  'softgels',
  'syrup',
  'prn',
  'oral',
  'mg',
  'mcg',
  'ml',
  'iu',
  'gm',
]);

export function extractMedicineKeywords(name: string): string[] {
  const cleaned = name
    .toLowerCase()
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|iu|ml|g|gm|%)\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (!cleaned) return [];
  return Array.from(
    new Set(
      cleaned
        .split(/\s+/)
        .filter((token) => token.length >= 2 && !/^\d+$/.test(token) && !IGNORED_KEYWORDS.has(token))
    )
  );
}

export function doesInventoryMatchMedication(medicationName: string, inventoryName: string): boolean {
  const medTokens = extractMedicineKeywords(medicationName);
  const invTokens = extractMedicineKeywords(inventoryName);
  if (medTokens.length === 0 || invTokens.length === 0) return false;

  return medTokens.some((token) =>
    invTokens.some(
      (invTok) =>
        invTok === token ||
        (token.length >= 5 && invTok.includes(token)) ||
        (invTok.length >= 5 && token.includes(invTok))
    )
  );
}

export function parsePrescribedDoseUnits(prescribedDose?: string | null): number {
  if (!prescribedDose) return 1;
  const match = prescribedDose.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 1;
  const val = Number(match[1]);
  return Number.isFinite(val) && val > 0 ? val : 1;
}

export function computeDailyDoseRate(
  medication: Pick<SupplyMedicationInput, 'prescribed_dose' | 'frequency_label'>,
  schedule?: SupplyScheduleInput | null
): number {
  const unitsPerDose = parsePrescribedDoseUnits(medication.prescribed_dose);

  if (schedule && (schedule.enabled === undefined || schedule.enabled === null || Boolean(schedule.enabled))) {
    let timesCount = 1;
    if (schedule.times_json) {
      try {
        const parsed = JSON.parse(schedule.times_json);
        if (Array.isArray(parsed) && parsed.length > 0) {
          timesCount = parsed.length;
        }
      } catch {
        timesCount = 1;
      }
    }

    if (schedule.schedule_type === 'interval_based' && schedule.interval_hours && schedule.interval_hours > 0) {
      return Math.round((24 / schedule.interval_hours) * unitsPerDose * 100) / 100;
    }

    if (schedule.schedule_type === 'weekly') {
      let daysPerWeek = 1;
      if (schedule.days_of_week_json) {
        try {
          const parsedDays = JSON.parse(schedule.days_of_week_json);
          if (Array.isArray(parsedDays) && parsedDays.length > 0) {
            daysPerWeek = parsedDays.length;
          }
        } catch {
          daysPerWeek = 1;
        }
      }
      return Math.round(((daysPerWeek * timesCount) / 7) * unitsPerDose * 100) / 100;
    }

    return Math.round(timesCount * unitsPerDose * 100) / 100;
  }

  const freq = (medication.frequency_label || '').toLowerCase();
  let perDay = 1;
  if (freq.includes('twice') || freq.includes('2x') || freq.includes('bd') || freq.includes('bid')) {
    perDay = 2;
  } else if (freq.includes('three') || freq.includes('thrice') || freq.includes('tds') || freq.includes('tid')) {
    perDay = 3;
  } else if (freq.includes('four') || freq.includes('qid')) {
    perDay = 4;
  } else if (freq.includes('week')) {
    perDay = 1 / 7;
  }

  return Math.round(perDay * unitsPerDose * 100) / 100;
}

function diffIsoDays(targetDate: string, todayDate: string): number | null {
  if (!targetDate || !todayDate) return null;
  const targetMs = Date.parse(`${targetDate.slice(0, 10)}T00:00:00.000Z`);
  const todayMs = Date.parse(`${todayDate.slice(0, 10)}T00:00:00.000Z`);
  if (!Number.isFinite(targetMs) || !Number.isFinite(todayMs)) return null;
  return Math.round((targetMs - todayMs) / (1000 * 60 * 60 * 24));
}

export function evaluatePrescriptionSupply(params: {
  medication: SupplyMedicationInput;
  schedule?: SupplyScheduleInput | null;
  personalInventory: PersonalInventorySupplyInput[];
  todayDate: string;
}): PrescriptionSupplyEvaluation {
  const { medication, schedule, personalInventory, todayDate } = params;
  const dailyDoseRate = Math.max(0.14, computeDailyDoseRate(medication, schedule));

  const matchingRows = personalInventory.filter((row) =>
    doesInventoryMatchMedication(medication.medicine_name, row.medicine_name)
  );
  const usableRows = matchingRows.filter((row) => row.expiry_date.slice(0, 10) > todayDate.slice(0, 10));

  const usableQuantity = usableRows.reduce((acc, row) => acc + Math.max(0, Number(row.quantity) || 0), 0);
  const unit = usableRows[0]?.unit ?? matchingRows[0]?.unit ?? null;
  const hasCabinetMatch = matchingRows.length > 0;
  const daysUntilEndDate = medication.end_date ? diffIsoDays(medication.end_date, todayDate) : null;

  if (hasCabinetMatch) {
    const rawDays = usableQuantity / dailyDoseRate;
    const daysRemaining = Math.round(rawDays * 10) / 10;
    const isRefillDue = daysRemaining < REFILL_DUE_THRESHOLD_DAYS;

    return {
      medicationId: medication.id,
      hasSupplyTracking: true,
      usableQuantity,
      unit,
      dailyDoseRate,
      daysRemaining,
      daysUntilEndDate,
      isRefillDue,
      dueReason: isRefillDue
        ? usableQuantity <= 0
          ? 'No usable supply remaining in personal cabinet'
          : `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} of supply remaining (< ${REFILL_DUE_THRESHOLD_DAYS} days)`
        : null,
    };
  }

  if (daysUntilEndDate !== null && daysUntilEndDate >= 0 && daysUntilEndDate < REFILL_DUE_THRESHOLD_DAYS) {
    return {
      medicationId: medication.id,
      hasSupplyTracking: true,
      usableQuantity: 0,
      unit: null,
      dailyDoseRate,
      daysRemaining: daysUntilEndDate,
      daysUntilEndDate,
      isRefillDue: true,
      dueReason: `Prescription cycle ends in ${daysUntilEndDate} day${daysUntilEndDate === 1 ? '' : 's'}`,
    };
  }

  return {
    medicationId: medication.id,
    hasSupplyTracking: false,
    usableQuantity: 0,
    unit: null,
    dailyDoseRate,
    daysRemaining: null,
    daysUntilEndDate,
    isRefillDue: false,
    dueReason: null,
  };
}
