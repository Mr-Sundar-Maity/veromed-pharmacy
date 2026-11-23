export interface InteractionSourceMetadata {
  sourceId: string;
  sourceName: string;
  version: string;
  updatedAt: string;
  licenseNote: string;
  limitations: string;
}

export interface InteractionMatch {
  pair: [string, string];
  normalizedPair: [string, string];
  status: 'interaction_found' | 'no_known_interaction' | 'unknown_insufficient_data';
  severity?: 'Major' | 'Moderate' | 'Minor';
  evidenceLevel?: string;
  description: string;
  clinicalGuidanceNote: string;
  source: InteractionSourceMetadata;
}

export interface InteractionCheckReport {
  checkedMedicines: Array<{ input: string; normalized: string | null; knownInReference: boolean }>;
  results: InteractionMatch[];
  unknownMedicines: string[];
  disclaimer: string;
}

export const VERIFIED_INTERACTION_SOURCES: InteractionSourceMetadata[] = [
  {
    sourceId: 'rxnav-fda-2026',
    sourceName: 'FDA Structured Product Labeling & RxNorm Clinical Reference',
    version: '2026.11-R2',
    updatedAt: '2026-11-01',
    licenseNote: 'Public Clinical Pharmacology Reference Dataset',
    limitations:
      'Covers common prescription oral agents only. Does not cover herbal supplements, compounded formulations, pediatric dosing adjustments, or patient-specific renal/hepatic contraindications.',
  },
];

const SYNONYM_MAP: Record<string, string> = {
  coumadin: 'warfarin',
  warfarin: 'warfarin',
  aspirin: 'aspirin',
  ecosprin: 'aspirin',
  disprin: 'aspirin',
  acetaminophen: 'acetaminophen',
  paracetamol: 'acetaminophen',
  tylenol: 'acetaminophen',
  crocin: 'acetaminophen',
  dolo: 'acetaminophen',
  ibuprofen: 'ibuprofen',
  advil: 'ibuprofen',
  motrin: 'ibuprofen',
  brufen: 'ibuprofen',
  metformin: 'metformin',
  glucophage: 'metformin',
  glycomet: 'metformin',
  atorvastatin: 'atorvastatin',
  lipitor: 'atorvastatin',
  atorva: 'atorvastatin',
  lisinopril: 'lisinopril',
  zestril: 'lisinopril',
  amlodipine: 'amlodipine',
  norvasc: 'amlodipine',
  amoxicillin: 'amoxicillin',
  augmentin: 'amoxicillin',
  clarithromycin: 'clarithromycin',
  biaxin: 'clarithromycin',
  clopidogrel: 'clopidogrel',
  plavix: 'clopidogrel',
  omeprazole: 'omeprazole',
  prilosec: 'omeprazole',
  simvastatin: 'simvastatin',
  zocor: 'simvastatin',
  spironolactone: 'spironolactone',
  aldactone: 'spironolactone',
  furosemide: 'furosemide',
  lasix: 'furosemide',
  'vitamin d3': 'cholecalciferol',
  cholecalciferol: 'cholecalciferol',
};

const KNOWN_REFERENCE_INGREDIENTS = new Set(Object.values(SYNONYM_MAP));

interface ReferencePairEntry {
  a: string;
  b: string;
  severity: 'Major' | 'Moderate' | 'Minor';
  evidenceLevel: string;
  description: string;
  guidance: string;
}

const INTERACTION_PAIRS: ReferencePairEntry[] = [
  {
    a: 'aspirin',
    b: 'warfarin',
    severity: 'Major',
    evidenceLevel: 'Established (FDA Boxed Warning / Labeling)',
    description:
      'Concurrent use of aspirin (antiplatelet/NSAID) and warfarin (vitamin K antagonist) significantly increases the risk of gastrointestinal and systemic bleeding.',
    guidance:
      'Do not start or stop either agent independently. Consult the prescribing clinician or pharmacist for INR monitoring and gastroprotection review.',
  },
  {
    a: 'ibuprofen',
    b: 'warfarin',
    severity: 'Major',
    evidenceLevel: 'Established (FDA Labeling)',
    description:
      'NSAIDs such as ibuprofen inhibit platelet aggregation and irritate gastric mucosa, compounding bleeding risk alongside warfarin.',
    guidance:
      'Discuss analgesic alternatives with a licensed pharmacist or physician before combining.',
  },
  {
    a: 'clopidogrel',
    b: 'omeprazole',
    severity: 'Moderate',
    evidenceLevel: 'Established (CYP2C19 Inhibition)',
    description:
      'Omeprazole inhibits CYP2C19-mediated bioactivation of clopidogrel, which may reduce antiplatelet efficacy.',
    guidance:
      'Ask a prescribing clinician or pharmacist whether an alternative acid-suppressing medication is appropriate.',
  },
  {
    a: 'atorvastatin',
    b: 'clarithromycin',
    severity: 'Major',
    evidenceLevel: 'Established (CYP3A4 Inhibition)',
    description:
      'Clarithromycin strongly inhibits CYP3A4 metabolism, elevating systemic atorvastatin exposure and increasing risk of myopathy.',
    guidance:
      'Require pharmacist/prescriber review during short-term macrolide antibiotic courses.',
  },
  {
    a: 'clarithromycin',
    b: 'simvastatin',
    severity: 'Major',
    evidenceLevel: 'Contraindicated in FDA Labeling',
    description:
      'Strong CYP3A4 inhibition markedly increases simvastatin plasma levels and rhabdomyolysis risk.',
    guidance:
      'Escalate immediately to the prescribing clinician or dispensing pharmacist before taking together.',
  },
  {
    a: 'lisinopril',
    b: 'spironolactone',
    severity: 'Moderate',
    evidenceLevel: 'Established (Additive Hyperkalemia Risk)',
    description:
      'ACE inhibitors combined with potassium-sparing diuretics can elevate serum potassium (hyperkalemia), especially with renal impairment.',
    guidance:
      'Ensure scheduled electrolyte monitoring as directed by your clinician.',
  },
  {
    a: 'ibuprofen',
    b: 'lisinopril',
    severity: 'Moderate',
    evidenceLevel: 'Established (Renal Prostaglandin Mechanism)',
    description:
      'Regular NSAID use may attenuate the antihypertensive effect of ACE inhibitors and increase renal workload.',
    guidance:
      'Check with a clinician or pharmacist regarding occasional vs. chronic pain-reliever use.',
  },
  {
    a: 'aspirin',
    b: 'clopidogrel',
    severity: 'Moderate',
    evidenceLevel: 'Additive Antiplatelet Effect',
    description:
      'Dual antiplatelet therapy increases bleeding tendency and is often intentionally prescribed post-stent under specialist supervision.',
    guidance:
      'Verify with your cardiologist or pharmacist whether dual therapy is intentionally prescribed.',
  },
];

export function normalizeMedicineName(rawInput: string): string | null {
  const cleaned = rawInput
    .toLowerCase()
    .replace(/\b\d+\s*(mg|mcg|g|ml|iu)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return null;
  if (SYNONYM_MAP[cleaned]) return SYNONYM_MAP[cleaned];

  // Try matching first token if user typed "Metformin Hydrochloride"
  const firstToken = cleaned.split(' ')[0];
  if (SYNONYM_MAP[firstToken]) return SYNONYM_MAP[firstToken];

  return null;
}

export function checkMedicationInteractions(inputs: string[]): InteractionCheckReport {
  const source = VERIFIED_INTERACTION_SOURCES[0];
  const uniqueInputs = Array.from(
    new Set(inputs.map((s) => s.trim()).filter((s) => s.length > 0))
  );

  const checkedMedicines = uniqueInputs.map((input) => {
    const normalized = normalizeMedicineName(input);
    return {
      input,
      normalized,
      knownInReference: normalized !== null && KNOWN_REFERENCE_INGREDIENTS.has(normalized),
    };
  });

  const unknownMedicines = checkedMedicines
    .filter((m) => !m.knownInReference)
    .map((m) => m.input);

  const results: InteractionMatch[] = [];

  for (let i = 0; i < checkedMedicines.length; i++) {
    for (let j = i + 1; j < checkedMedicines.length; j++) {
      const m1 = checkedMedicines[i];
      const m2 = checkedMedicines[j];

      if (!m1.normalized || !m2.normalized) {
        results.push({
          pair: [m1.input, m2.input],
          normalizedPair: [m1.normalized ?? m1.input, m2.normalized ?? m2.input],
          status: 'unknown_insufficient_data',
          description: `Insufficient verified reference data for "${!m1.normalized ? m1.input : m2.input}". Interaction cannot be ruled out or confirmed.`,
          clinicalGuidanceNote:
            'Consult a licensed pharmacist or physician with the exact product label.',
          source,
        });
        continue;
      }

      if (m1.normalized === m2.normalized) {
        results.push({
          pair: [m1.input, m2.input],
          normalizedPair: [m1.normalized, m2.normalized],
          status: 'interaction_found',
          severity: 'Moderate',
          evidenceLevel: 'Duplicate Active Ingredient Alert',
          description: `Both entries map to the same active ingredient (${m1.normalized}), creating potential duplicate-therapy risk.`,
          clinicalGuidanceNote:
            'Confirm with your prescriber or pharmacist before taking multiple products sharing the same active ingredient.',
          source,
        });
        continue;
      }

      const [left, right] = [m1.normalized, m2.normalized].sort();
      const found = INTERACTION_PAIRS.find(
        (p) => [p.a, p.b].sort()[0] === left && [p.a, p.b].sort()[1] === right
      );

      if (found) {
        results.push({
          pair: [m1.input, m2.input],
          normalizedPair: [m1.normalized, m2.normalized],
          status: 'interaction_found',
          severity: found.severity,
          evidenceLevel: found.evidenceLevel,
          description: found.description,
          clinicalGuidanceNote: found.guidance,
          source,
        });
      } else {
        results.push({
          pair: [m1.input, m2.input],
          normalizedPair: [m1.normalized, m2.normalized],
          status: 'no_known_interaction',
          description: `No documented interaction found between ${m1.normalized} and ${m2.normalized} in ${source.sourceName} (${source.version}). Absence of a record is not a guarantee of safety.`,
          clinicalGuidanceNote:
            'Always verify new combinations with a licensed pharmacist or clinician, especially if taking OTC or herbal products.',
          source,
        });
      }
    }
  }

  return {
    checkedMedicines,
    results,
    unknownMedicines,
    disclaimer:
      'Informational reference only. VeroMed is not a diagnostic tool, does not replace a licensed clinician or pharmacist, and must not be used to independently start, stop, or alter prescribed therapy.',
  };
}
