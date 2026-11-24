import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  FileScan,
  MapPin,
  Navigation,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import { apiFetch, getAuthToken } from '../../types/api';
import type { PharmacyMedicineSuggestion } from '../../lib/medicineAvailability';
import { CameraPrescriptionModal } from './CameraPrescriptionModal';

interface PrescriptionItemDraft {
  id: string;
  medicine_name: string;
  strength: string;
  dosage: string;
  frequency: string;
  duration_days: number;
  instructions: string;
  verification_status: 'pending' | 'approved' | 'rejected';
  confidence: {
    medicineName: number;
    strength: number;
    dosage: number;
    frequency: number;
  };
}

interface PrescriptionRecord {
  id: string;
  file_name: string;
  mime_type: string;
  upload_date: string;
  document_date: string | null;
  doctor_name: string | null;
  ocr_status: 'uploaded' | 'draft_ready' | 'confirmed' | 'rejected' | 'failed';
  raw_text: string | null;
  engine_version: string | null;
  processing_ms: number | null;
  items: PrescriptionItemDraft[];
}

interface PrescriptionsOcrViewProps {
  onScheduleActivated: () => void;
  autoOpenCamera?: boolean;
  onCameraHandled?: () => void;
  onNavigate?: (tab: string) => void;
}

function structureRawTranscript(
  rawText: string | null,
  items: Array<{
    medicineName: string;
    strength: string;
    dosage: string;
    frequency: string;
    durationDays: number;
    instructions: string;
  }>
): { details: string; medicineLines: string[] } {
  const normalized = (rawText || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
  if (!normalized) {
    return {
      details: 'No additional prescription details were transcribed.',
      medicineLines: items.map((item) =>
        [item.medicineName, item.strength, item.dosage, item.frequency, item.durationDays ? `${item.durationDays} days` : '', item.instructions]
          .filter(Boolean)
          .join(' · ')
      ),
    };
  }

  const positions = items
    .map((item) => ({ item, index: normalized.toLowerCase().indexOf(item.medicineName.trim().toLowerCase()) }))
    .filter((entry) => entry.item.medicineName.trim() && entry.index >= 0)
    .sort((a, b) => a.index - b.index);

  if (positions.length === 0) {
    return {
      details: items.length > 0
        ? 'Additional raw details could not be separated reliably. Review the original document for confirmation.'
        : normalized,
      medicineLines: items.map((item) =>
        [item.medicineName, item.strength, item.dosage, item.frequency, item.durationDays ? `${item.durationDays} days` : '', item.instructions]
          .filter(Boolean)
          .join(' · ')
      ),
    };
  }

  const details = normalized.slice(0, positions[0].index).replace(/[-–—·|,;:\s]+$/g, '').trim();
  const medicineLines = positions.map((entry, index) => {
    const end = positions[index + 1]?.index ?? normalized.length;
    return normalized
      .slice(entry.index, end)
      .replace(/^[\s,;|–—-]+|[\s,;|–—-]+$/g, '')
      .trim();
  });

  return {
    details: details || 'No additional prescription details were stated.',
    medicineLines,
  };
}

export const PrescriptionsOcrView: React.FC<PrescriptionsOcrViewProps> = ({
  onScheduleActivated,
  autoOpenCamera = false,
  onCameraHandled,
  onNavigate,
}) => {
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editableItems, setEditableItems] = useState<
    Array<{
      id: string;
      medicineName: string;
      strength: string;
      dosage: string;
      frequency: string;
      durationDays: number;
      instructions: string;
      approved: boolean;
      confidence: PrescriptionItemDraft['confidence'];
    }>
  >([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pharmacySuggestions, setPharmacySuggestions] = useState<PharmacyMedicineSuggestion[]>([]);
  const [preferredPharmacyId, setPreferredPharmacyId] = useState<string | null>(null);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [savingPharmacyId, setSavingPharmacyId] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function loadPrescriptions(selectLatest = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ prescriptions: PrescriptionRecord[] }>('/prescriptions');
      setPrescriptions(res.prescriptions);
      if (res.prescriptions.length > 0) {
        const nextId = selectLatest
          ? res.prescriptions[0].id
          : selectedId && res.prescriptions.some((p) => p.id === selectedId)
          ? selectedId
          : res.prescriptions.find((p) => p.ocr_status === 'draft_ready')?.id ||
            res.prescriptions[0].id;
        setSelectedId(nextId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load prescriptions.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPrescriptions();
  }, []);

  useEffect(() => {
    if (autoOpenCamera) {
      setCameraOpen(true);
      onCameraHandled?.();
    }
  }, [autoOpenCamera]);

  const selectedRx = prescriptions.find((p) => p.id === selectedId) ?? null;
  const structuredRawTranscript = structureRawTranscript(selectedRx?.raw_text ?? null, editableItems);

  async function refreshPharmacySuggestions(
    items: Array<{ medicineName: string; strength?: string }>
  ) {
    if (items.length === 0) {
      setPharmacySuggestions([]);
      return;
    }
    setSuggestionsLoading(true);
    try {
      const res = await apiFetch<{
        suggestions: PharmacyMedicineSuggestion[];
        preferredPharmacyId: string | null;
      }>('/prescriptions/pharmacy-suggestions', {
        method: 'POST',
        body: JSON.stringify({ medicines: items }),
      });
      setPharmacySuggestions(res.suggestions);
      setPreferredPharmacyId(res.preferredPharmacyId);
    } catch {
      // Keep prior state if lookup fails transiently
    } finally {
      setSuggestionsLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedRx) {
      setEditableItems([]);
      setPreviewUrl(null);
      setPharmacySuggestions([]);
      return;
    }

    const mapped = selectedRx.items.map((item) => ({
      id: item.id,
      medicineName: item.medicine_name,
      strength: item.strength,
      dosage: item.dosage,
      frequency: item.frequency,
      durationDays: item.duration_days,
      instructions: item.instructions || '',
      approved: item.verification_status !== 'rejected',
      confidence: item.confidence,
    }));
    setEditableItems(mapped);
    void refreshPharmacySuggestions(
      mapped.map((m) => ({ medicineName: m.medicineName, strength: m.strength }))
    );

    let activeUrl: string | null = null;
    const token = getAuthToken();
    fetch(`/api/v1/prescriptions/${encodeURIComponent(selectedRx.id)}/file`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (blob) {
          activeUrl = URL.createObjectURL(blob);
          setPreviewUrl(activeUrl);
        }
      })
      .catch(() => setPreviewUrl(null));

    return () => {
      if (activeUrl) URL.revokeObjectURL(activeUrl);
    };
  }, [selectedRx?.id, selectedRx?.ocr_status]);

  async function uploadPrescriptionFile(file: File) {
    setUploading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiFetch<{
        prescription: PrescriptionRecord;
        pharmacySuggestions?: PharmacyMedicineSuggestion[];
      }>('/prescriptions/upload', {
        method: 'POST',
        body: form,
      });
      await loadPrescriptions(true);
      setSelectedId(res.prescription.id);
      if (res.pharmacySuggestions) {
        setPharmacySuggestions(res.pharmacySuggestions);
      }
      setSuccessMsg(
        'Prescription processed by AI into an unverified OCR draft with matching pharmacy stock availability below.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prescription OCR upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSelectPreferredPharmacy(pharmacyId: string, pharmacyName: string) {
    setSavingPharmacyId(pharmacyId);
    setError(null);
    try {
      await apiFetch('/patients/me/preferred-pharmacy', {
        method: 'PATCH',
        body: JSON.stringify({ pharmacyId }),
      });
      setPreferredPharmacyId(pharmacyId);
      setPharmacySuggestions((prev) =>
        prev.map((s) => ({ ...s, isPreferred: s.pharmacy.id === pharmacyId }))
      );
      setSuccessMsg(
        `${pharmacyName} is now your preferred pharmacy for medication refills.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to set preferred pharmacy.');
    } finally {
      setSavingPharmacyId(null);
    }
  }

  async function handleRunSampleImageOcr() {
    const canvas = document.createElement('canvas');
    canvas.width = 760;
    canvas.height = 460;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(0, 0, canvas.width, 72);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('CITY HEART & DIABETES CLINIC — PRESCRIPTION', 28, 44);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('Patient: Aarav Sharma     Date: 2026-11-23', 28, 112);
    ctx.fillText('Prescriber: Dr. Kavita Menon, MD (Internal Medicine)', 28, 140);

    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(28, 160);
    ctx.lineTo(732, 160);
    ctx.stroke();

    ctx.font = '18px monospace';
    ctx.fillText('1. Tab. Clopidogrel (Plavix) 75 mg', 28, 210);
    ctx.font = '15px sans-serif';
    ctx.fillText('   Sig: 1 tablet once daily after breakfast x 30 days', 28, 236);

    ctx.font = '18px monospace';
    ctx.fillText('2. Tab. Omeprazole (Prilosec) 20 mg', 28, 290);
    ctx.font = '15px sans-serif';
    ctx.fillText('   Sig: 1 capsule once daily 30 mins before breakfast x 30 days', 28, 316);

    ctx.fillStyle = '#475569';
    ctx.font = 'italic 13px sans-serif';
    ctx.fillText('Signature: Dr. K. Menon · Reg No. MMC-2019-44102', 28, 415);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png')
    );
    if (!blob) return;
    const file = new File([blob], 'sample_clinic_prescription.png', { type: 'image/png' });
    await uploadPrescriptionFile(file);
  }

  async function handleConfirmDraft() {
    if (!selectedRx) return;
    setConfirming(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await apiFetch<{ activatedMedications: string[] }>(
        `/prescriptions/${encodeURIComponent(selectedRx.id)}/confirm`,
        {
          method: 'POST',
          body: JSON.stringify({ items: editableItems }),
        }
      );
      setSuccessMsg(
        `Verified and activated ${res.activatedMedications.length} medication schedule(s) in My Medicines.`
      );
      await loadPrescriptions();
      onScheduleActivated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to confirm prescription.');
    } finally {
      setConfirming(false);
    }
  }

  async function handleRejectDraft() {
    if (!selectedRx) return;
    setError(null);
    try {
      await apiFetch(`/prescriptions/${encodeURIComponent(selectedRx.id)}/reject`, {
        method: 'POST',
      });
      setSuccessMsg('OCR draft rejected. No medication schedules were modified.');
      await loadPrescriptions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reject draft.');
    }
  }

  async function handleDeletePrescription() {
    if (!selectedRx || deleting) return;
    const confirmed = window.confirm(
      `Delete ${selectedRx.file_name}? This permanently removes the prescription, OCR data, and source file.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await apiFetch(`/prescriptions/${encodeURIComponent(selectedRx.id)}`, {
        method: 'DELETE',
      });
      setSelectedId(null);
      setSuccessMsg('Prescription and its OCR data were permanently deleted.');
      await loadPrescriptions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete prescription.');
    } finally {
      setDeleting(false);
    }
  }

  function renderConfidenceBadge(score: number) {
    const pct = Math.round((score ?? 0) * 100);
    const tone =
      pct >= 85 ? 'text-emerald-700' : pct >= 70 ? 'text-amber-700' : 'text-red-700 font-bold';
    return (
      <span className={`font-mono text-[11px] tabular-nums ${tone}`}>
        {pct}% conf{pct < 75 ? ' · verify' : ''}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Prescription OCR &amp; Human Verification
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Upload JPG, PNG, WEBP, or PDF prescriptions. All OCR outputs require explicit review before creating schedules.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={uploading}
            onClick={() => setCameraOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            <Camera className="w-4 h-4" />
            <span>Take Picture (Camera)</span>
          </button>

          <button
            type="button"
            disabled={uploading}
            onClick={handleRunSampleImageOcr}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-300 hover:bg-teal-100 rounded-lg cursor-pointer disabled:opacity-50 whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4" />
            <span>{uploading ? 'Processing...' : 'Test Gemini OCR with Sample Rx'}</span>
          </button>

          <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap">
            <Upload className="w-4 h-4" />
            <span>{uploading ? 'Uploading...' : 'Upload Prescription'}</span>
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.pdf,.txt"
              className="sr-only"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadPrescriptionFile(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      <CameraPrescriptionModal
        open={cameraOpen}
        uploading={uploading}
        onClose={() => setCameraOpen(false)}
        onCaptureFile={uploadPrescriptionFile}
      />

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {successMsg && (
        <div role="status" className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
          {successMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left List: Uploaded Prescriptions */}
        <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="font-display text-sm font-bold text-slate-900">
              Prescription Queue ({prescriptions.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {loading ? (
              <div className="p-4 text-sm text-slate-500">Loading prescriptions...</div>
            ) : prescriptions.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No prescriptions uploaded yet.</div>
            ) : (
              prescriptions.map((rx) => {
                const isSelected = rx.id === selectedRx?.id;
                const statusLabel =
                  rx.ocr_status === 'draft_ready'
                    ? 'Pending Human Review'
                    : rx.ocr_status === 'confirmed'
                    ? 'Verified & Active'
                    : rx.ocr_status === 'rejected'
                    ? 'Rejected'
                    : rx.ocr_status;
                const statusColor =
                  rx.ocr_status === 'draft_ready'
                    ? 'text-amber-700'
                    : rx.ocr_status === 'confirmed'
                    ? 'text-emerald-700'
                    : 'text-slate-500';

                return (
                  <button
                    key={rx.id}
                    type="button"
                    onClick={() => setSelectedId(rx.id)}
                    className={`w-full text-left p-4 transition-colors cursor-pointer ${
                      isSelected ? 'bg-teal-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className={`font-semibold ${statusColor}`}>{statusLabel}</span>
                      <span className="font-mono text-slate-400 tabular-nums">{rx.upload_date}</span>
                    </div>
                    <p className="font-medium text-sm text-slate-900 mt-1 truncate">
                      {rx.file_name}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {rx.doctor_name || 'Prescriber pending'} · {rx.items.length} extracted item(s)
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right Detail: Preview & Editable Draft Verification */}
        <section className="lg:col-span-8 space-y-5">
          {!selectedRx ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
              Select a prescription from the queue to inspect extracted fields.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <FileScan className="w-4 h-4 text-teal-700" />
                    <span>Engine: {selectedRx.engine_version || 'gemini-4-hydrogen-ocr'}</span>
                    {selectedRx.processing_ms && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{selectedRx.processing_ms} ms</span>
                      </>
                    )}
                  </div>
                  <h2 className="font-display text-lg font-bold text-slate-900 mt-1">
                    {selectedRx.file_name}
                  </h2>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2">
                {selectedRx.ocr_status === 'draft_ready' ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg">
                    <AlertTriangle className="w-4 h-4" />
                    Unverified Draft — Not Active
                  </span>
                ) : selectedRx.ocr_status === 'confirmed' ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                    <CheckCircle2 className="w-4 h-4" />
                    Verified &amp; Activated
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-slate-600 capitalize">
                    {selectedRx.ocr_status}
                  </span>
                )}
                  <button
                    type="button"
                    disabled={deleting}
                    onClick={() => void handleDeletePrescription()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{deleting ? 'Deleting...' : 'Delete Prescription'}</span>
                  </button>
                </div>
              </div>

              {/* Source Document Preview & Structured OCR Transcript */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                  <div className="px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-700 bg-white">
                    Original Source Document
                  </div>
                  {previewUrl ? (
                    selectedRx.mime_type === 'application/pdf' ? (
                      <iframe
                        src={previewUrl}
                        title={selectedRx.file_name}
                        className="w-full h-56 bg-white"
                      />
                    ) : (
                      <img
                        src={previewUrl}
                        alt={`Prescription scan ${selectedRx.file_name}`}
                        className="w-full h-56 object-contain bg-white p-2"
                      />
                    )
                  ) : (
                    <div className="h-56 flex items-center justify-center text-xs text-slate-500">
                      Preview loading...
                    </div>
                  )}
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 flex flex-col">
                  <div className="px-3 py-2 border-b border-slate-200 text-xs font-semibold text-slate-700 bg-white">
                    Detailed OCR Transcript
                  </div>
                  <div className="p-3 overflow-y-auto h-56 space-y-3 text-xs text-slate-700">
                    <section>
                      <p className="font-display font-bold uppercase tracking-wide text-[11px] text-teal-800">
                        Prescription Details
                      </p>
                      <dl className="mt-1.5 grid grid-cols-[82px_1fr] gap-x-2 gap-y-1">
                        <dt className="font-semibold text-slate-500">File</dt>
                        <dd className="font-medium text-slate-900 break-words">{selectedRx.file_name}</dd>
                        <dt className="font-semibold text-slate-500">Prescriber</dt>
                        <dd className="font-medium text-slate-900">{selectedRx.doctor_name || 'Not stated'}</dd>
                        <dt className="font-semibold text-slate-500">Date</dt>
                        <dd className="font-medium text-slate-900">{selectedRx.document_date || 'Not stated'}</dd>
                      </dl>
                    </section>

                    <section className="border-t border-slate-200 pt-2.5">
                      <p className="font-display font-bold uppercase tracking-wide text-[11px] text-teal-800">
                        Other Prescription Details
                      </p>
                      <p className="mt-1.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-slate-600">
                        {structuredRawTranscript.details}
                      </p>
                    </section>

                    <section className="border-t border-slate-200 pt-2.5">
                      <p className="font-display font-bold uppercase tracking-wide text-[11px] text-teal-800">
                        Medicine Lines From Prescription
                      </p>
                      {structuredRawTranscript.medicineLines.length > 0 ? (
                        <ol className="mt-2 space-y-1.5 list-decimal list-inside">
                          {structuredRawTranscript.medicineLines.map((line, index) => (
                            <li
                              key={`${selectedRx.id}-raw-medicine-${index}`}
                              className="rounded-md border border-slate-200 bg-white px-2.5 py-2 font-mono text-[11px] leading-relaxed text-slate-700"
                            >
                              {line}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="mt-1.5 text-slate-500">No medicine lines were extracted.</p>
                      )}
                    </section>
                  </div>
                </div>
              </div>

              {/* Extracted Draft Fields with Per-Field Confidence */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-sm font-bold text-slate-900">
                    Extracted Medications (Editable Verification Fields)
                  </h3>
                  <span className="text-xs text-slate-500">
                    Correct any low-confidence fields before confirming
                  </span>
                </div>

                {editableItems.map((item, idx) => (
                  <div
                    key={item.id}
                    className="border border-slate-200 rounded-lg p-4 space-y-3 bg-slate-50/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700">
                        Extracted Item #{idx + 1}
                      </span>
                      <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          disabled={selectedRx.ocr_status !== 'draft_ready'}
                          checked={item.approved}
                          onChange={(e) => {
                            const next = [...editableItems];
                            next[idx] = { ...item, approved: e.target.checked };
                            setEditableItems(next);
                          }}
                          className="rounded border-slate-300 text-teal-700"
                        />
                        <span>Include in Activation</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label
                            htmlFor={`ocr-med-${item.id}`}
                            className="text-xs font-medium text-slate-700"
                          >
                            Medicine Name
                          </label>
                          {renderConfidenceBadge(item.confidence.medicineName)}
                        </div>
                        <input
                          id={`ocr-med-${item.id}`}
                          type="text"
                          disabled={selectedRx.ocr_status !== 'draft_ready'}
                          value={item.medicineName}
                          onChange={(e) => {
                            const next = [...editableItems];
                            next[idx] = { ...item, medicineName: e.target.value };
                            setEditableItems(next);
                          }}
                          className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md disabled:bg-slate-100"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label
                            htmlFor={`ocr-strength-${item.id}`}
                            className="text-xs font-medium text-slate-700"
                          >
                            Strength
                          </label>
                          {renderConfidenceBadge(item.confidence.strength)}
                        </div>
                        <input
                          id={`ocr-strength-${item.id}`}
                          type="text"
                          disabled={selectedRx.ocr_status !== 'draft_ready'}
                          value={item.strength}
                          onChange={(e) => {
                            const next = [...editableItems];
                            next[idx] = { ...item, strength: e.target.value };
                            setEditableItems(next);
                          }}
                          className={`w-full px-3 py-1.5 text-sm bg-white border rounded-md disabled:bg-slate-100 ${
                            item.confidence.strength < 0.75
                              ? 'border-red-400 ring-1 ring-red-200'
                              : 'border-slate-300'
                          }`}
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label
                            htmlFor={`ocr-dosage-${item.id}`}
                            className="text-xs font-medium text-slate-700"
                          >
                            Dosage
                          </label>
                          {renderConfidenceBadge(item.confidence.dosage)}
                        </div>
                        <input
                          id={`ocr-dosage-${item.id}`}
                          type="text"
                          disabled={selectedRx.ocr_status !== 'draft_ready'}
                          value={item.dosage}
                          onChange={(e) => {
                            const next = [...editableItems];
                            next[idx] = { ...item, dosage: e.target.value };
                            setEditableItems(next);
                          }}
                          className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md disabled:bg-slate-100"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label
                            htmlFor={`ocr-freq-${item.id}`}
                            className="text-xs font-medium text-slate-700"
                          >
                            Frequency &amp; Clock Hint
                          </label>
                          {renderConfidenceBadge(item.confidence.frequency)}
                        </div>
                        <input
                          id={`ocr-freq-${item.id}`}
                          type="text"
                          disabled={selectedRx.ocr_status !== 'draft_ready'}
                          value={item.frequency}
                          onChange={(e) => {
                            const next = [...editableItems];
                            next[idx] = { ...item, frequency: e.target.value };
                            setEditableItems(next);
                          }}
                          className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md disabled:bg-slate-100"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label
                          htmlFor={`ocr-dur-${item.id}`}
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          Duration (Days)
                        </label>
                        <input
                          id={`ocr-dur-${item.id}`}
                          type="number"
                          min={1}
                          disabled={selectedRx.ocr_status !== 'draft_ready'}
                          value={item.durationDays}
                          onChange={(e) => {
                            const next = [...editableItems];
                            next[idx] = { ...item, durationDays: Number(e.target.value) };
                            setEditableItems(next);
                          }}
                          className="w-full px-3 py-1.5 text-sm font-mono bg-white border border-slate-300 rounded-md disabled:bg-slate-100"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label
                          htmlFor={`ocr-inst-${item.id}`}
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          Instructions
                        </label>
                        <input
                          id={`ocr-inst-${item.id}`}
                          type="text"
                          disabled={selectedRx.ocr_status !== 'draft_ready'}
                          value={item.instructions}
                          onChange={(e) => {
                            const next = [...editableItems];
                            next[idx] = { ...item, instructions: e.target.value };
                            setEditableItems(next);
                          }}
                          className="w-full px-3 py-1.5 text-sm bg-white border border-slate-300 rounded-md disabled:bg-slate-100"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {selectedRx.ocr_status === 'draft_ready' && (
                <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-xs text-slate-600 flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Human confirmation required: approving creates active schedules in My Medicines.
                    </span>
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleRejectDraft}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg cursor-pointer"
                    >
                      <XCircle className="w-4 h-4" />
                      <span>Reject Draft</span>
                    </button>
                    <button
                      type="button"
                      disabled={confirming}
                      onClick={handleConfirmDraft}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        {confirming ? 'Activating...' : 'Approve & Activate Schedule'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Suggested Pharmacies Where Extracted Medicines Are Available */}
              <div className="pt-4 border-t border-slate-200 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-sm font-bold text-slate-900">
                      Suggested Pharmacies With Extracted Medicines Available
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Matched against live non-expired inventory across partner pharmacies
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      disabled={suggestionsLoading || editableItems.length === 0}
                      onClick={() =>
                        void refreshPharmacySuggestions(
                          editableItems.map((i) => ({
                            medicineName: i.medicineName,
                            strength: i.strength,
                          }))
                        )
                      }
                      className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap"
                    >
                      {suggestionsLoading ? 'Checking stock...' : 'Refresh Stock'}
                    </button>
                    {onNavigate && (
                      <button
                        type="button"
                        onClick={() => onNavigate('pharmacy-locator')}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap"
                      >
                        <MapPin className="w-3.5 h-3.5" />
                        <span>Open Pharmacy Map</span>
                      </button>
                    )}
                  </div>
                </div>

                {suggestionsLoading && pharmacySuggestions.length === 0 ? (
                  <p className="text-xs text-slate-500 py-3">Checking live pharmacy stock...</p>
                ) : pharmacySuggestions.length === 0 ? (
                  <p className="text-xs text-slate-500 py-3">
                    No extracted medicines available to match against pharmacy stock yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {pharmacySuggestions.filter((s) => s.matchedCount > 0).length === 0 ? (
                      <p className="text-xs text-slate-600 md:col-span-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        None of the extracted medicines matched current non-expired catalog inventory. Use Custom Refill or check nearby pharmacies directly.
                      </p>
                    ) : (
                      pharmacySuggestions
                        .filter((s) => s.matchedCount > 0)
                        .map((suggestion) => {
                          const isPreferred =
                            suggestion.isPreferred ||
                            suggestion.pharmacy.id === preferredPharmacyId;
                          return (
                            <div
                              key={suggestion.pharmacy.id}
                              className={`border rounded-lg p-3.5 space-y-2 ${
                                suggestion.allAvailable
                                  ? 'border-teal-300 bg-teal-50/30'
                                  : 'border-slate-200 bg-white'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="font-display text-sm font-bold text-slate-900 truncate">
                                    {suggestion.pharmacy.tenant_name}
                                  </p>
                                  <p className="text-xs text-slate-600 tabular-nums mt-0.5 flex items-center gap-1">
                                    <Navigation className="w-3 h-3 text-teal-700 shrink-0" />
                                    <span>
                                      {suggestion.pharmacy.distanceKm.toFixed(1)} km (~
                                      {suggestion.pharmacy.etaMinutes} min) ·{' '}
                                      {suggestion.pharmacy.hoursLabel}
                                    </span>
                                  </p>
                                </div>
                                <span
                                  className={`text-xs font-semibold whitespace-nowrap shrink-0 tabular-nums ${
                                    suggestion.allAvailable ? 'text-emerald-700' : 'text-amber-700'
                                  }`}
                                >
                                  {suggestion.allAvailable
                                    ? `All ${suggestion.totalRequested} in stock`
                                    : `${suggestion.matchedCount}/${suggestion.totalRequested} in stock`}
                                </span>
                              </div>

                              <div className="text-xs text-slate-700 space-y-1">
                                {suggestion.matchedMedicines.map((mm) => (
                                  <p key={mm.requestedName} className="truncate tabular-nums">
                                    <span className="font-medium text-slate-900">
                                      {mm.requestedName}:
                                    </span>{' '}
                                    <span className="text-emerald-700 font-medium">
                                      {mm.availableQuantity} {mm.unit}
                                    </span>
                                  </p>
                                ))}
                                {suggestion.missingMedicines.length > 0 && (
                                  <p className="text-slate-500">
                                    Not stocked: {suggestion.missingMedicines.join(', ')}
                                  </p>
                                )}
                              </div>

                              <div className="pt-1 flex items-center justify-between gap-2">
                                <span className="text-[11px] text-slate-500 truncate">
                                  {suggestion.pharmacy.address}
                                </span>
                                {isPreferred ? (
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 shrink-0 whitespace-nowrap">
                                    <Check className="w-3.5 h-3.5" />
                                    <span>Preferred</span>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    disabled={savingPharmacyId === suggestion.pharmacy.id}
                                    onClick={() =>
                                      void handleSelectPreferredPharmacy(
                                        suggestion.pharmacy.id,
                                        suggestion.pharmacy.tenant_name
                                      )
                                    }
                                    className="px-2.5 py-1 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-300 hover:bg-teal-100 rounded-md cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
                                  >
                                    {savingPharmacyId === suggestion.pharmacy.id
                                      ? 'Saving...'
                                      : 'Select Pharmacy'}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
