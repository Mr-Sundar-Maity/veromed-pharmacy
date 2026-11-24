import { GoogleGenAI, Type } from '@google/genai';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured in Settings > Secrets. AI OCR and Healthcare Assistant require a valid server-side key.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export interface ExtractedPrescriptionItem {
  medicineName: string;
  strength: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  instructions: string;
  confidence: {
    medicineName: number;
    strength: number;
    dosage: number;
    frequency: number;
  };
}

export interface PrescriptionOcrResult {
  documentType: string;
  patientName: string;
  doctorName: string;
  prescriptionDate: string;
  rawText: string;
  items: ExtractedPrescriptionItem[];
  engineVersion: string;
  processingMs: number;
}

export async function extractPrescriptionWithGemini(params: {
  fileBuffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<PrescriptionOcrResult> {
  const startedAt = Date.now();
  const ai = getGeminiClient();

  const prompt = `You are a clinical prescription OCR parser inside VeroMed.
Extract structured medication draft fields from the provided prescription document.
Rules:
1. Never invent medications that are not present in the source.
2. Provide honest field-level confidence scores between 0.0 and 1.0 for medicineName, strength, dosage, and frequency. Lower the confidence (<0.75) if handwriting or scan quality is ambiguous.
3. Preserve every legible source detail in rawText and format it as a readable clinical transcript using this exact section order:
   PRESCRIPTION DETAILS
   Patient: <value or Not stated>
   Prescriber: <value or Not stated>
   Date: <value or Not stated>

   MEDICATIONS
   1. <medicine name and strength>
      Dosage: <value or Not stated>
      Frequency: <value or Not stated>
      Duration: <value or Not stated>
      Instructions: <value or Not stated>

   ADDITIONAL NOTES
   <all other legible clinical text, registration details, signature text, or Not stated>
   Do not add Markdown symbols, commentary, inferred diagnoses, or information absent from the source.
4. Normalize durationDays to an integer number of days (default 30 if unspecified).
5. Classify documentType (e.g. "Prescription", "Discharge Medication List", or "Non-Prescription Document").`;

  const supportedBinaryMimes = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'application/pdf',
  ]);

  const contents = supportedBinaryMimes.has(params.mimeType)
    ? {
        parts: [
          {
            inlineData: {
              mimeType: params.mimeType === 'image/jpg' ? 'image/jpeg' : params.mimeType,
              data: params.fileBuffer.toString('base64'),
            },
          },
          { text: prompt },
        ],
      }
    : `${prompt}\n\nDocument (${params.fileName}):\n${params.fileBuffer.toString('utf8')}`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          documentType: { type: Type.STRING },
          patientName: { type: Type.STRING },
          doctorName: { type: Type.STRING },
          prescriptionDate: { type: Type.STRING },
          rawText: { type: Type.STRING },
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                medicineName: { type: Type.STRING },
                strength: { type: Type.STRING },
                dosage: { type: Type.STRING },
                frequency: { type: Type.STRING },
                durationDays: { type: Type.INTEGER },
                instructions: { type: Type.STRING },
                confidence: {
                  type: Type.OBJECT,
                  properties: {
                    medicineName: { type: Type.NUMBER },
                    strength: { type: Type.NUMBER },
                    dosage: { type: Type.NUMBER },
                    frequency: { type: Type.NUMBER },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const rawJson = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawJson) as Omit<
    PrescriptionOcrResult,
    'engineVersion' | 'processingMs'
  >;

  return {
    documentType: parsed.documentType || 'Prescription',
    patientName: parsed.patientName || 'Unknown',
    doctorName: parsed.doctorName || 'Unspecified Prescriber',
    prescriptionDate: parsed.prescriptionDate || new Date().toISOString().slice(0, 10),
    rawText: parsed.rawText || '',
    items: Array.isArray(parsed.items) ? parsed.items : [],
    engineVersion: 'gemini-4-hydrogen-ocr',
    processingMs: Date.now() - startedAt,
  };
}

export async function askHealthcareAssistant(params: {
  authorizedRecordsJson: string;
  question: string;
}): Promise<{ answer: string; citedSources: string[]; clinicalEscalation: boolean }> {
  const ai = getGeminiClient();

  const systemInstruction = `You are the VeroMed Informational Record Assistant.
STRICT SAFETY & GROUNDING RULES:
1. You ONLY answer questions using the authorized patient records JSON provided in the prompt.
2. Always cite the exact source record titles/IDs you used in "citedSources".
3. If the information is not present in the provided records, clearly state that it is missing from the patient's uploaded records. Never invent dates, dosages, or lab results.
4. NEVER diagnose conditions, interpret symptoms, or recommend starting, stopping, or changing medication doses.
5. If the user asks for medical advice, diagnosis, symptom evaluation, or missed-dose treatment advice, set clinicalEscalation=true and politely direct them to consult their licensed physician or pharmacist.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `Authorized Patient Records:\n${params.authorizedRecordsJson}\n\nUser Question: ${params.question}`,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          answer: { type: Type.STRING },
          citedSources: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          clinicalEscalation: { type: Type.BOOLEAN },
        },
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    answer?: string;
    citedSources?: string[];
    clinicalEscalation?: boolean;
  };

  return {
    answer:
      parsed.answer ||
      'Unable to locate matching details in your authorized health records.',
    citedSources: Array.isArray(parsed.citedSources) ? parsed.citedSources : [],
    clinicalEscalation: Boolean(parsed.clinicalEscalation),
  };
}
