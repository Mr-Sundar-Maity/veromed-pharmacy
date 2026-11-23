import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Camera,
  Check,
  Clock,
  FileScan,
  MapPin,
  Pill,
  Plus,
  RefreshCw,
  SkipForward,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { apiFetch } from '../../types/api';
import type { AdherenceSummary, DoseStatus } from '../../lib/adherence';
import {
  DEFAULT_PUSH_PREFERENCES,
  type PushNotificationPreferences,
} from '../../lib/pushNotifications';
import type { PrescriptionSupplyEvaluation } from '../../lib/refillSupply';
import { MedicationPushPanel } from './MedicationPushPanel';

interface TodayLog {
  id: string;
  schedule_id: string;
  medication_name: string;
  scheduled_at: string;
  status: DoseStatus;
  recorded_at: string | null;
  note: string | null;
}

interface RefillRequestRow {
  id: string;
  patient_medication_id: string;
  medicine_name: string;
  strength: string;
  pharmacy_id: string | null;
  pharmacy_name: string;
  quantity_requested: number;
  status: 'requested' | 'approved' | 'ready' | 'completed' | 'cancelled';
  notes: string | null;
  requested_at: string;
}

interface PharmacyOption {
  id: string;
  tenant_name: string;
  license_number: string;
  address: string;
}

interface DashboardResponse {
  todayDate: string;
  activeMedications: Array<{
    id: string;
    medicine_name: string;
    strength: string;
    prescribed_dose: string;
    frequency_label: string;
    source_type: string;
    supply?: PrescriptionSupplyEvaluation;
  }>;
  refillDueCount?: number;
  todayLogs: TodayLog[];
  adherence: AdherenceSummary;
  upcomingAppointments: Array<{
    id: string;
    provider: string;
    facility: string;
    appointment_type: string;
    start_at: string;
    location: string | null;
  }>;
  personalAlerts: Array<{
    id: string;
    medicine_name: string;
    quantity: number;
    unit: string;
    expiry_date: string;
    expiryWindow: string;
    expiryLabel: string;
    daysRemaining: number;
    isLowStock: boolean;
  }>;
  pendingDraftsCount: number;
  unreadNotificationsCount: number;
  notificationPreferences?: PushNotificationPreferences;
  refillRequests?: RefillRequestRow[];
  pharmacies?: PharmacyOption[];
  preferredPharmacyId?: string | null;
}

interface PatientDashboardProps {
  patientId?: string;
  isCaregiver?: boolean;
  onNavigate: (tab: string) => void;
  onOpenRxCamera?: () => void;
}

export const PatientDashboard: React.FC<PatientDashboardProps> = ({
  patientId = 'me',
  isCaregiver = false,
  onNavigate,
  onOpenRxCamera,
}) => {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Refill request modal/form state
  const [refillOpen, setRefillOpen] = useState(false);
  const [refillMedId, setRefillMedId] = useState('');
  const [refillPharmacyId, setRefillPharmacyId] = useState('');
  const [refillQty, setRefillQty] = useState(30);
  const [refillNotes, setRefillNotes] = useState('');
  const [refillSubmitting, setRefillSubmitting] = useState(false);
  const [requestingMedId, setRequestingMedId] = useState<string | null>(null);
  const [refillFeedback, setRefillFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<DashboardResponse>(
        `/patients/${encodeURIComponent(patientId)}/dashboard`
      );
      setData(res);
      if (res.activeMedications.length > 0 && !refillMedId) {
        setRefillMedId(res.activeMedications[0].id);
      }
      if (res.preferredPharmacyId) {
        setRefillPharmacyId(res.preferredPharmacyId);
      } else if (res.pharmacies && res.pharmacies.length > 0 && !refillPharmacyId) {
        setRefillPharmacyId(res.pharmacies[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
  }, [patientId]);

  async function handleLogDose(logId: string, status: DoseStatus) {
    setUpdatingId(logId);
    try {
      await apiFetch(`/medication-logs/${encodeURIComponent(logId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update dose log.');
    } finally {
      setUpdatingId(null);
    }
  }

  function openRefillForMedication(medicationId?: string) {
    if (!data) return;
    const targetMed = medicationId || data.activeMedications[0]?.id || '';
    setRefillMedId(targetMed);
    if (!refillPharmacyId && data.pharmacies?.[0]) {
      setRefillPharmacyId(data.pharmacies[0].id);
    }
    setRefillQty(30);
    setRefillNotes('');
    setRefillFeedback(null);
    setRefillOpen(true);
  }

  async function handleSubmitRefill(e: React.FormEvent) {
    e.preventDefault();
    setRefillSubmitting(true);
    setRefillFeedback(null);
    try {
      const res = await apiFetch<{ refillRequest: RefillRequestRow }>('/refill-requests', {
        method: 'POST',
        body: JSON.stringify({
          patientMedicationId: refillMedId,
          pharmacyId: refillPharmacyId || undefined,
          quantityRequested: Number(refillQty),
          notes: refillNotes,
        }),
      });
      setRefillFeedback({
        type: 'success',
        message: `Refill request sent for ${res.refillRequest.medicine_name} ${res.refillRequest.strength} (${res.refillRequest.quantity_requested} units) to ${res.refillRequest.pharmacy_name}.`,
      });
      setRefillOpen(false);
      await loadDashboard();
    } catch (err) {
      setRefillFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to submit refill request.',
      });
    } finally {
      setRefillSubmitting(false);
    }
  }

  async function handleDirectPrescriptionRefill(medId: string) {
    if (!data) return;
    setRequestingMedId(medId);
    setRefillFeedback(null);
    try {
      const targetPharmacyId = refillPharmacyId || data.pharmacies?.[0]?.id;
      const res = await apiFetch<{ refillRequest: RefillRequestRow }>('/refill-requests', {
        method: 'POST',
        body: JSON.stringify({
          patientMedicationId: medId,
          pharmacyId: targetPharmacyId || undefined,
          quantityRequested: 30,
        }),
      });
      setRefillFeedback({
        type: 'success',
        message: `Refill request sent for ${res.refillRequest.medicine_name} ${res.refillRequest.strength} (${res.refillRequest.quantity_requested} units) to ${res.refillRequest.pharmacy_name}.`,
      });
      await loadDashboard();
    } catch (err) {
      setRefillFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to submit refill request.',
      });
    } finally {
      setRequestingMedId(null);
    }
  }

  async function handleCancelRefill(refillId: string) {
    setRefillFeedback(null);
    try {
      await apiFetch(`/refill-requests/${encodeURIComponent(refillId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });
      setRefillFeedback({ type: 'success', message: 'Pending refill request cancelled.' });
      await loadDashboard();
    } catch (err) {
      setRefillFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to cancel refill request.',
      });
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((k) => (
            <div key={k} className="h-28 bg-white border border-slate-200 rounded-xl" />
          ))}
        </div>
        <div className="h-72 bg-white border border-slate-200 rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 text-sm text-red-800">
        {error || 'Dashboard unavailable.'}
      </div>
    );
  }

  const nextPending = data.todayLogs.find((l) => l.status === 'pending');
  const refills = data.refillRequests ?? [];
  const pharmacies = data.pharmacies ?? [];
  const preferredPharmacy =
    pharmacies.find((p) => p.id === (data.preferredPharmacyId || refillPharmacyId)) ||
    pharmacies[0] ||
    null;
  const refillDueMeds = data.activeMedications.filter((m) => m.supply?.isRefillDue);

  return (
    <div className="space-y-6">
      {/* Header & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            {isCaregiver ? 'Shared Care Overview' : 'Daily Healthcare Overview'}
          </h1>
          <p className="text-sm text-slate-600 mt-0.5 tabular-nums">
            Schedule date: {data.todayDate} · {data.activeMedications.length} active prescriptions
          </p>
        </div>

        {!isCaregiver && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('medicines')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Add Medicine</span>
            </button>
            <button
              type="button"
              disabled={data.activeMedications.length === 0}
              onClick={() => openRefillForMedication()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-300 hover:bg-teal-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Request Refill</span>
            </button>
            <button
              type="button"
              onClick={() => (onOpenRxCamera ? onOpenRxCamera() : onNavigate('prescriptions'))}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-teal-800 bg-teal-50 border border-teal-300 hover:bg-teal-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Camera className="w-4 h-4" />
              <span>Scan Rx (Camera)</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('prescriptions')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Upload className="w-4 h-4" />
              <span>Upload Prescription</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('records')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Calendar className="w-4 h-4" />
              <span>Add Appointment</span>
            </button>
          </div>
        )}
      </div>

      {/* Refill Status Banner */}
      {refillFeedback && (
        <div
          role={refillFeedback.type === 'error' ? 'alert' : 'status'}
          className={`p-4 rounded-xl border text-sm flex items-center justify-between gap-3 ${
            refillFeedback.type === 'error'
              ? 'bg-red-50 border-red-200 text-red-900'
              : 'bg-teal-50 border-teal-200 text-teal-900'
          }`}
        >
          <span>{refillFeedback.message}</span>
          <button
            type="button"
            aria-label="Dismiss refill status"
            onClick={() => setRefillFeedback(null)}
            className="p-1 rounded hover:bg-black/5 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Refill Request Form Panel */}
      {!isCaregiver && refillOpen && (
        <section
          aria-label="Request Medication Refill"
          className="bg-white border border-teal-300 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Request Prescription Refill
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Select a specific active prescription to route a refill request to a licensed pharmacy.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close refill form"
              onClick={() => setRefillOpen(false)}
              className="p-1.5 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmitRefill} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div>
              <label htmlFor="refill-med-select" className="block text-xs font-semibold text-slate-700 mb-1">
                Prescription Medication
              </label>
              <select
                id="refill-med-select"
                required
                value={refillMedId}
                onChange={(e) => setRefillMedId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                {data.activeMedications.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.medicine_name} {m.strength} ({m.prescribed_dose})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="refill-pharmacy-select" className="block text-xs font-semibold text-slate-700 mb-1">
                Destination Pharmacy
              </label>
              <select
                id="refill-pharmacy-select"
                value={refillPharmacyId}
                onChange={(e) => setRefillPharmacyId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              >
                {pharmacies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.tenant_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="refill-qty-input" className="block text-xs font-semibold text-slate-700 mb-1">
                Quantity (Units)
              </label>
              <input
                id="refill-qty-input"
                type="number"
                min={1}
                max={180}
                required
                value={refillQty}
                onChange={(e) => setRefillQty(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg tabular-nums focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div>
              <label htmlFor="refill-notes-input" className="block text-xs font-semibold text-slate-700 mb-1">
                Pharmacy Notes (Optional)
              </label>
              <input
                id="refill-notes-input"
                type="text"
                value={refillNotes}
                onChange={(e) => setRefillNotes(e.target.value)}
                placeholder="e.g., 30-day supply needed by Friday"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRefillOpen(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={refillSubmitting || !refillMedId}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{refillSubmitting ? 'Submitting...' : 'Submit Refill Request'}</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Medication Push Notification System */}
      <MedicationPushPanel
        todayLogs={data.todayLogs}
        preferences={data.notificationPreferences ?? DEFAULT_PUSH_PREFERENCES}
        isCaregiver={isCaregiver}
        updatingId={updatingId}
        onLogDose={handleLogDose}
        onPreferencesChange={(next) =>
          setData((prev) => (prev ? { ...prev, notificationPreferences: next } : prev))
        }
      />

      {/* Medication Refill Due Indicator Banner (< 7 days supply remaining) */}
      {refillDueMeds.length > 0 && (
        <div
          role="status"
          data-testid="medication-refill-due-banner"
          className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3 min-w-0">
            <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-sm min-w-0">
              <p className="font-semibold text-amber-950">
                Medication Refill Due · {refillDueMeds.length} prescription
                {refillDueMeds.length === 1 ? '' : 's'} with less than 7 days of supply
              </p>
              <p className="text-amber-800 text-xs mt-0.5 leading-relaxed tabular-nums">
                {refillDueMeds
                  .map(
                    (m) =>
                      `${m.medicine_name} ${m.strength} (${m.supply?.daysRemaining ?? 0}d left)`
                  )
                  .join(' · ')}
              </p>
            </div>
          </div>
          {!isCaregiver && (
            <button
              type="button"
              onClick={() => openRefillForMedication(refillDueMeds[0]?.id)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Request Refill</span>
            </button>
          )}
        </div>
      )}

      {/* Pending OCR Draft Banner */}
      {!isCaregiver && data.pendingDraftsCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <FileScan className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-amber-950">
                {data.pendingDraftsCount} prescription OCR draft awaiting human verification
              </p>
              <p className="text-amber-800 text-xs mt-0.5">
                Unverified OCR extractions never activate medication schedules automatically. Review and approve fields first.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('prescriptions')}
            className="px-3.5 py-2 text-xs font-semibold text-amber-950 bg-white border border-amber-300 hover:bg-amber-100 rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            Review OCR Draft
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Recorded Adherence</p>
          <p className="font-display text-3xl font-bold text-slate-900 mt-1 tabular-nums">
            {data.adherence.recordedAdherenceRate}%
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {data.adherence.takenCount} taken / {data.adherence.eligibleCount} resolved doses
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Next Scheduled Dose</p>
          {nextPending ? (
            <>
              <p className="font-display text-lg font-bold text-slate-900 mt-1 truncate">
                {nextPending.medication_name}
              </p>
              <p className="text-xs font-mono text-teal-700 mt-1 tabular-nums">
                Due at {nextPending.scheduled_at.slice(11, 16)} UTC
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-lg font-bold text-emerald-700 mt-1">
                All Doses Resolved
              </p>
              <p className="text-xs text-slate-500 mt-1">No pending doses remaining today</p>
            </>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Upcoming Appointment</p>
          {data.upcomingAppointments[0] ? (
            <>
              <p className="font-display text-lg font-bold text-slate-900 mt-1 truncate">
                {data.upcomingAppointments[0].provider}
              </p>
              <p className="text-xs text-slate-600 mt-1 tabular-nums">
                {data.upcomingAppointments[0].start_at.slice(0, 10)} · {data.upcomingAppointments[0].facility}
              </p>
            </>
          ) : (
            <>
              <p className="font-display text-lg font-bold text-slate-900 mt-1">None Scheduled</p>
              <p className="text-xs text-slate-500 mt-1">Add a clinic or lab visit anytime</p>
            </>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Cabinet Expiry &amp; Stock Alerts</p>
          <p className="font-display text-3xl font-bold text-slate-900 mt-1 tabular-nums">
            {data.personalAlerts.length}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {data.personalAlerts.some((a) => a.expiryWindow === 'expired')
              ? 'Includes expired medicine to discard'
              : 'Active personal stock notices'}
          </p>
        </div>
      </div>

      {/* Main Split: Today's Medication Schedule + Active Prescriptions & Refills / Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Today&apos;s Medication Schedule
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Log taken, delayed, skipped, or missed status directly
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('medicines')}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                Manage All
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {data.todayLogs.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  No doses scheduled for today.
                </div>
              ) : (
                data.todayLogs.map((log) => {
                  const timeLabel = log.scheduled_at.slice(11, 16);
                  const statusColor =
                    log.status === 'taken'
                      ? 'text-emerald-700'
                      : log.status === 'missed'
                      ? 'text-red-700'
                      : log.status === 'delayed' || log.status === 'skipped'
                      ? 'text-amber-700'
                      : 'text-slate-600';

                  return (
                    <div
                      key={log.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-xs font-semibold text-slate-700 tabular-nums">
                            {timeLabel} UTC
                          </span>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <span className={`text-xs font-semibold capitalize ${statusColor}`}>
                            {log.status}
                          </span>
                        </div>
                        <p className="font-medium text-sm text-slate-900 mt-1 truncate">
                          {log.medication_name}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={updatingId === log.id}
                          aria-label={`Mark ${log.medication_name} at ${timeLabel} as Taken`}
                          onClick={() => handleLogDose(log.id, 'taken')}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                            log.status === 'taken'
                              ? 'bg-emerald-700 text-white border-emerald-700'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-emerald-50 hover:border-emerald-400'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Taken</span>
                        </button>

                        <button
                          type="button"
                          disabled={updatingId === log.id}
                          aria-label={`Mark ${log.medication_name} at ${timeLabel} as Delayed`}
                          onClick={() => handleLogDose(log.id, 'delayed')}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                            log.status === 'delayed'
                              ? 'bg-amber-600 text-white border-amber-600'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-amber-50'
                          }`}
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>Delayed</span>
                        </button>

                        <button
                          type="button"
                          disabled={updatingId === log.id}
                          aria-label={`Mark ${log.medication_name} at ${timeLabel} as Skipped`}
                          onClick={() => handleLogDose(log.id, 'skipped')}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                            log.status === 'skipped'
                              ? 'bg-slate-700 text-white border-slate-700'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                          }`}
                        >
                          <SkipForward className="w-3.5 h-3.5" />
                          <span>Skip</span>
                        </button>

                        <button
                          type="button"
                          disabled={updatingId === log.id}
                          aria-label={`Mark ${log.medication_name} at ${timeLabel} as Missed`}
                          onClick={() => handleLogDose(log.id, 'missed')}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                            log.status === 'missed'
                              ? 'bg-red-700 text-white border-red-700'
                              : 'bg-white text-slate-700 border-slate-300 hover:bg-red-50'
                          }`}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Missed</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Active Prescriptions & Refills, Personal Cabinet Alerts & Appointments */}
        <div className="lg:col-span-5 space-y-6">
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Active Prescriptions
                  </h2>
                  {refillDueMeds.length > 0 && (
                    <span
                      data-testid="refill-due-header-badge"
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 border border-amber-300 text-[11px] font-semibold text-amber-950 whitespace-nowrap"
                    >
                      <AlertCircle className="w-3 h-3 text-amber-700" />
                      <span>Medication Refill Due ({refillDueMeds.length})</span>
                    </span>
                  )}
                </div>
                {!isCaregiver && (
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => onNavigate('pharmacy-locator')}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>Pharmacy Map</span>
                    </button>
                    {data.activeMedications.length > 0 && (
                      <button
                        type="button"
                        onClick={() => openRefillForMedication()}
                        className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        Custom Refill
                      </button>
                    )}
                  </div>
                )}
              </div>
              <p className="text-xs text-slate-500">
                {preferredPharmacy
                  ? `Preferred refill pharmacy: ${preferredPharmacy.tenant_name}`
                  : 'Send a pharmacy refill request directly per prescription'}
              </p>
            </div>

            <div className="divide-y divide-slate-100">
              {data.activeMedications.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">No active prescriptions recorded.</div>
              ) : (
                data.activeMedications.map((med) => {
                  const openRefill = refills.find(
                    (r) =>
                      r.patient_medication_id === med.id &&
                      ['requested', 'approved', 'ready'].includes(r.status)
                  );
                  const isRequesting = requestingMedId === med.id;
                  const isRefillDue = Boolean(med.supply?.isRefillDue);
                  return (
                    <div
                      key={med.id}
                      data-testid={`prescription-row-${med.id}`}
                      className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        isRefillDue
                          ? 'bg-amber-50/70 dark:bg-amber-950/30 border-l-4 border-l-amber-500'
                          : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-sm text-slate-900 truncate">
                            {med.medicine_name} {med.strength}
                          </p>
                          {isRefillDue && (
                            <span
                              data-testid={`refill-due-indicator-${med.id}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 border border-amber-300 text-[11px] font-semibold text-amber-950 whitespace-nowrap"
                            >
                              <AlertCircle className="w-3 h-3 text-amber-700" />
                              <span>Medication Refill Due</span>
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">
                          {med.prescribed_dose} · {med.frequency_label}
                        </p>
                        {isRefillDue && med.supply?.dueReason && (
                          <p className="text-xs font-medium text-amber-800 mt-1 tabular-nums">
                            {med.supply.usableQuantity > 0 && med.supply.unit
                              ? `${med.supply.usableQuantity} ${med.supply.unit} left · `
                              : ''}
                            {med.supply.dueReason}
                          </p>
                        )}
                        {!isRefillDue && med.supply?.hasSupplyTracking && med.supply.daysRemaining !== null && (
                          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                            {med.supply.usableQuantity} {med.supply.unit || 'units'} left · ~{med.supply.daysRemaining}d supply
                          </p>
                        )}
                        {openRefill && (
                          <p className="text-xs font-medium text-teal-800 mt-1 tabular-nums">
                            Refill {openRefill.status}: {openRefill.quantity_requested} units ·{' '}
                            {openRefill.pharmacy_name}
                          </p>
                        )}
                      </div>

                      {!isCaregiver && (
                        <div className="flex items-center gap-2 shrink-0">
                          {openRefill?.status === 'requested' && (
                            <button
                              type="button"
                              onClick={() => void handleCancelRefill(openRefill.id)}
                              className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                            >
                              Cancel
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={Boolean(openRefill) || isRequesting}
                            aria-label={`Request refill for ${med.medicine_name} ${med.strength}`}
                            onClick={() => void handleDirectPrescriptionRefill(med.id)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-50 disabled:cursor-not-allowed ${
                              isRefillDue && !openRefill
                                ? 'text-white bg-amber-600 hover:bg-amber-700 border border-amber-600'
                                : 'text-teal-800 bg-teal-50 border border-teal-300 hover:bg-teal-100'
                            }`}
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isRequesting ? 'animate-spin' : ''}`} />
                            <span>
                              {isRequesting
                                ? 'Requesting...'
                                : openRefill
                                ? `Refill ${openRefill.status}`
                                : 'Request Refill'}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900">
                Personal Cabinet Alerts
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('medicines')}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                View Stock
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {data.personalAlerts.length === 0 ? (
                <p className="p-5 text-sm text-slate-500">
                  All home medicines are well-stocked and within safe expiry windows.
                </p>
              ) : (
                data.personalAlerts.map((alert) => (
                  <div key={alert.id} className="p-4 flex items-start gap-3">
                    <AlertCircle
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        alert.expiryWindow === 'expired' ? 'text-red-600' : 'text-amber-600'
                      }`}
                    />
                    <div className="text-xs space-y-0.5 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm">{alert.medicine_name}</p>
                      <p className="text-slate-600">
                        {alert.expiryWindow === 'expired'
                          ? `Expired (${alert.expiry_date}) — Do not use`
                          : `${alert.expiryLabel} (${alert.expiry_date})`}
                        {alert.isLowStock && ` · Low stock (${alert.quantity} ${alert.unit} left)`}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900">
                Upcoming Appointments
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('records')}
                className="text-xs font-semibold text-teal-700 hover:text-teal-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                Calendar
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {data.upcomingAppointments.length === 0 ? (
                <p className="p-5 text-sm text-slate-500">No upcoming appointments.</p>
              ) : (
                data.upcomingAppointments.map((appt) => (
                  <div key={appt.id} className="p-4 flex items-start justify-between gap-3">
                    <div className="text-xs space-y-0.5">
                      <p className="font-semibold text-sm text-slate-900">{appt.provider}</p>
                      <p className="text-slate-600">
                        {appt.facility} · <span className="capitalize">{appt.appointment_type.replace('_', ' ')}</span>
                      </p>
                    </div>
                    <span className="font-mono text-xs text-slate-700 tabular-nums shrink-0">
                      {appt.start_at.slice(0, 10)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-600 flex items-start gap-2.5">
            <Pill className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
            <p>
              <strong className="text-slate-900">Adherence Rule:</strong> {data.adherence.formulaDescription}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
