import type { NearbyPharmacy } from './pharmacyLocator';

export interface PharmacyInventoryStockRow {
  pharmacy_id: string;
  medicine_name: string;
  available_quantity: number;
  unit: string;
  unit_sell_price: number;
  earliest_expiry: string | null;
}

export interface RequestedMedicineQuery {
  medicineName: string;
  strength?: string;
}

export interface MatchedPharmacyMedicine {
  requestedName: string;
  matchedCatalogName: string;
  availableQuantity: number;
  unit: string;
  unitSellPrice: number;
  earliestExpiry: string | null;
}

export interface PharmacyMedicineSuggestion {
  pharmacy: NearbyPharmacy;
  matchedMedicines: MatchedPharmacyMedicine[];
  missingMedicines: string[];
  matchedCount: number;
  totalRequested: number;
  allAvailable: boolean;
  isPreferred: boolean;
}

const TOKEN_STOPWORDS = new Set([
  'tab',
  'tablet',
  'tablets',
  'cap',
  'capsule',
  'capsules',
  'softgel',
  'mg',
  'mcg',
  'iu',
  'ml',
  'sr',
  'xr',
  'er',
  'hcl',
  'sodium',
  'calcium',
  'hydrochloride',
  'prn',
  'od',
  'bd',
]);

const GENERIC_SYNONYMS: Record<string, string[]> = {
  acetaminophen: ['paracetamol', 'dolo', 'crocin', 'tylenol'],
  paracetamol: ['acetaminophen', 'dolo', 'crocin', 'tylenol'],
  aspirin: ['ecosprin', 'acetylsalicylic'],
  ecosprin: ['aspirin', 'acetylsalicylic'],
  metformin: ['glycomet', 'glucophage'],
  glycomet: ['metformin', 'glucophage'],
  atorvastatin: ['lipitor', 'atorva'],
  lipitor: ['atorvastatin', 'atorva'],
  lisinopril: ['zestril', 'prinivil'],
  zestril: ['lisinopril', 'prinivil'],
  amlodipine: ['norvasc', 'amlopres'],
  norvasc: ['amlodipine', 'amlopres'],
  clopidogrel: ['plavix', 'clopilet'],
  plavix: ['clopidogrel', 'clopilet'],
  omeprazole: ['prilosec', 'omez'],
  prilosec: ['omeprazole', 'omez'],
  amoxicillin: ['augmentin', 'clav', 'amox'],
  augmentin: ['amoxicillin', 'clav', 'amox'],
  cholecalciferol: ['vitamin d3', 'd-rise', 'drise'],
  'vitamin d3': ['cholecalciferol', 'd-rise', 'drise'],
};

export function extractMedicineTokens(rawName: string): string[] {
  const cleaned = rawName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((tok) => tok.length >= 3 && !/^\d+$/.test(tok) && !TOKEN_STOPWORDS.has(tok));

  const expanded = new Set<string>(cleaned);
  for (const tok of cleaned) {
    const syns = GENERIC_SYNONYMS[tok];
    if (syns) {
      for (const s of syns) expanded.add(s);
    }
  }
  return Array.from(expanded);
}

export function doesInventoryMatchMedicine(
  inventoryMedicineName: string,
  requested: RequestedMedicineQuery
): boolean {
  const reqTokens = extractMedicineTokens(requested.medicineName);
  if (reqTokens.length === 0) return false;
  const invLower = inventoryMedicineName.toLowerCase();
  const invTokens = extractMedicineTokens(inventoryMedicineName);

  const hasNameMatch = reqTokens.some(
    (rt) => invLower.includes(rt) || invTokens.some((it) => it.includes(rt) || rt.includes(it))
  );
  if (!hasNameMatch) return false;

  // If strength is specified (e.g. "500 mg"), prefer strength consistency when stock string includes digits
  if (requested.strength) {
    const reqDigits = requested.strength.match(/\d+/)?.[0];
    const invDigits = inventoryMedicineName.match(/\d+/)?.[0];
    if (reqDigits && invDigits && reqDigits !== invDigits) {
      return false;
    }
  }
  return true;
}

export function matchMedicinesToPharmacies(params: {
  medicines: RequestedMedicineQuery[];
  pharmacies: NearbyPharmacy[];
  stockRows: PharmacyInventoryStockRow[];
  preferredPharmacyId?: string | null;
}): PharmacyMedicineSuggestion[] {
  const uniqueRequested: RequestedMedicineQuery[] = [];
  const seenKeys = new Set<string>();
  for (const m of params.medicines) {
    const key = `${m.medicineName.trim().toLowerCase()}|${(m.strength ?? '').trim().toLowerCase()}`;
    if (!m.medicineName.trim() || seenKeys.has(key)) continue;
    seenKeys.add(key);
    uniqueRequested.push(m);
  }

  const results: PharmacyMedicineSuggestion[] = params.pharmacies.map((pharmacy) => {
    const pharmacyStock = params.stockRows.filter(
      (row) => row.pharmacy_id === pharmacy.id && row.available_quantity > 0
    );

    const matchedMedicines: MatchedPharmacyMedicine[] = [];
    const missingMedicines: string[] = [];

    for (const reqMed of uniqueRequested) {
      const displayReq = reqMed.strength
        ? `${reqMed.medicineName} ${reqMed.strength}`.trim()
        : reqMed.medicineName.trim();
      const match = pharmacyStock.find((row) => doesInventoryMatchMedicine(row.medicine_name, reqMed));
      if (match) {
        matchedMedicines.push({
          requestedName: displayReq,
          matchedCatalogName: match.medicine_name,
          availableQuantity: match.available_quantity,
          unit: match.unit,
          unitSellPrice: match.unit_sell_price,
          earliestExpiry: match.earliest_expiry,
        });
      } else {
        missingMedicines.push(displayReq);
      }
    }

    const totalRequested = uniqueRequested.length;
    const matchedCount = matchedMedicines.length;

    return {
      pharmacy,
      matchedMedicines,
      missingMedicines,
      matchedCount,
      totalRequested,
      allAvailable: totalRequested > 0 && matchedCount === totalRequested,
      isPreferred: pharmacy.id === params.preferredPharmacyId,
    };
  });

  return results.sort((a, b) => {
    if (a.allAvailable !== b.allAvailable) return a.allAvailable ? -1 : 1;
    if (a.matchedCount !== b.matchedCount) return b.matchedCount - a.matchedCount;
    if (a.pharmacy.distanceKm !== b.pharmacy.distanceKm) {
      return a.pharmacy.distanceKm - b.pharmacy.distanceKm;
    }
    return a.isPreferred ? -1 : b.isPreferred ? 1 : 0;
  });
}
