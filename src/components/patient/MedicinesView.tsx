import React, { useEffect, useState } from 'react';
import { AlertTriangle, Pause, Play, Plus, Trash2, XCircle } from 'lucide-react';
import { apiFetch } from '../../types/api';
import type { ScheduleType } from '../../lib/adherence';

interface MedicationRecord {
  id: string;
  medicine_name: string;
  strength: string;
  prescribed_dose: string;
  route: string;
  frequency_label: string;
  start_date: string;
  end_date: string | null;
  prescriber: string | null;
  instructions: string | null;
  patient_notes: string | null;
  status: 'active' | 'paused' | 'completed' | 'discontinued';
  source_type: 'manual' | 'verified_prescription';
  schedules: Array<{
    id: string;
    schedule_type: ScheduleType;
    times_json: string;
    timezone: string;
  }>;
}

interface DoseLogRow {
  id: string;
  medication_name: string;
  scheduled_at: string;
  status: string;
  recorded_at: string | null;
  note: string | null;
}

interface PersonalInventoryRow {
  id: string;
  medicine_name: string;
  batch_number: string | null;
  quantity: number;
  unit: string;
  min_threshold: number;
  expiry_date: string;
  storage_notes: string | null;
  expiryWindow: string;
  expiryLabel: string;
  daysRemaining: number;
  isLowStock: boolean;
}

interface MedicinesViewProps {
  patientId?: string;
  isCaregiver?: boolean;
}

export const MedicinesView: React.FC<MedicinesViewProps> = ({
  patientId = 'me',
  isCaregiver = false,
}) => {
  const [subTab, setSubTab] = useState<'active' | 'logs' | 'cabinet'>('active');
  const [medications, setMedications] = useState<MedicationRecord[]>([]);
  const [logs, setLogs] = useState<DoseLogRow[]>([]);
  const [cabinet, setCabinet] = useState<PersonalInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddMed, setShowAddMed] = useState(false);
  const [showAddCabinet, setShowAddCabinet] = useState(false);

  // New Medication Form State
  const [medName, setMedName] = useState('');
  const [strength, setStrength] = useState('');
  const [dose, setDose] = useState('1 tablet');
  const [freqLabel, setFreqLabel] = useState('Once daily');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('once_daily');
  const [timesStr, setTimesStr] = useState('08:00');
  const [intervalHours, setIntervalHours] = useState(8);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [prescriber, setPrescriber] = useState('');
  const [instructions, setInstructions] = useState('');

  // Personal Cabinet Form State
  const [cabName, setCabName] = useState('');
  const [cabBatch, setCabBatch] = useState('');
  const [cabQty, setCabQty] = useState(20);
  const [cabUnit, setCabUnit] = useState('tablets');
  const [cabThreshold, setCabThreshold] = useState(6);
  const [cabExpiry, setCabExpiry] = useState('2027-08-15');
  const [cabNotes, setCabNotes] = useState('');

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const q = patientId !== 'me' ? `?patientId=${encodeURIComponent(patientId)}` : '';
      const [medRes, logRes, cabRes] = await Promise.all([
        apiFetch<{ medications: MedicationRecord[] }>(`/patient-medications${q}`),
        apiFetch<{ logs: DoseLogRow[] }>(`/medication-logs${q}`),
        apiFetch<{ items: PersonalInventoryRow[] }>(`/personal-inventory${q}`),
      ]);
      setMedications(medRes.medications);
      setLogs(logRes.logs);
      setCabinet(cabRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load medication data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, [patientId]);

  async function handleCreateMedication(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const times = timesStr
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      await apiFetch('/patient-medications', {
        method: 'POST',
        body: JSON.stringify({
          medicineName: medName,
          strength,
          prescribedDose: dose,
          frequencyLabel: freqLabel,
          scheduleType,
          times,
          intervalHours: scheduleType === 'interval_based' ? Number(intervalHours) : undefined,
          daysOfWeek: scheduleType === 'weekly' ? [0] : undefined,
          startDate,
          prescriber,
          instructions,
        }),
      });
      setShowAddMed(false);
      setMedName('');
      setStrength('');
      setPrescriber('');
      setInstructions('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save medication.');
    }
  }

  async function handleStatusChange(
    id: string,
    status: 'active' | 'paused' | 'discontinued'
  ) {
    setError(null);
    try {
      await apiFetch(`/patient-medications/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update status.');
    }
  }

  async function handleAddCabinetItem(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/personal-inventory', {
        method: 'POST',
        body: JSON.stringify({
          medicineName: cabName,
          batchNumber: cabBatch,
          quantity: Number(cabQty),
          unit: cabUnit,
          minThreshold: Number(cabThreshold),
          expiryDate: cabExpiry,
          storageNotes: cabNotes,
        }),
      });
      setShowAddCabinet(false);
      setCabName('');
      setCabBatch('');
      setCabNotes('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add stock item.');
    }
  }

  async function handleAdjustCabinetQty(id: string, nextQty: number) {
    if (nextQty < 0) return;
    try {
      await apiFetch(`/personal-inventory/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ quantity: nextQty }),
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to adjust quantity.');
    }
  }

  async function handleDeleteCabinetItem(id: string) {
    try {
      await apiFetch(`/personal-inventory/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete stock item.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Medications, Schedules &amp; Personal Stock
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Manage prescribed regimens, dose history, and home cabinet expiry dates
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setSubTab('active')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subTab === 'active' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Medications ({medications.length})
          </button>
          <button
            type="button"
            onClick={() => setSubTab('logs')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subTab === 'logs' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Dose History
          </button>
          <button
            type="button"
            onClick={() => setSubTab('cabinet')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              subTab === 'cabinet' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Personal Cabinet ({cabinet.length})
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {subTab === 'active' && (
        <div className="space-y-4">
          {!isCaregiver && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowAddMed((v) => !v)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{showAddMed ? 'Close Form' : 'Add Medicine & Schedule'}</span>
              </button>
            </div>
          )}

          {showAddMed && !isCaregiver && (
            <form
              onSubmit={handleCreateMedication}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
            >
              <h2 className="font-display text-base font-bold text-slate-900">
                New Medication &amp; Schedule Rule
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="med-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Medicine Name
                  </label>
                  <input
                    id="med-name"
                    type="text"
                    required
                    value={medName}
                    onChange={(e) => setMedName(e.target.value)}
                    placeholder="e.g. Amlodipine (Norvasc)"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="med-strength" className="block text-xs font-medium text-slate-700 mb-1">
                    Strength
                  </label>
                  <input
                    id="med-strength"
                    type="text"
                    required
                    value={strength}
                    onChange={(e) => setStrength(e.target.value)}
                    placeholder="e.g. 5 mg"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="med-dose" className="block text-xs font-medium text-slate-700 mb-1">
                    Prescribed Dose
                  </label>
                  <input
                    id="med-dose"
                    type="text"
                    required
                    value={dose}
                    onChange={(e) => setDose(e.target.value)}
                    placeholder="1 tablet"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="med-sched-type" className="block text-xs font-medium text-slate-700 mb-1">
                    Schedule Type
                  </label>
                  <select
                    id="med-sched-type"
                    value={scheduleType}
                    onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="once_daily">Once Daily</option>
                    <option value="multiple_daily">Multiple Times Daily</option>
                    <option value="interval_based">Interval Based</option>
                    <option value="weekly">Weekly</option>
                    <option value="custom">Custom Clock Times</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="med-times" className="block text-xs font-medium text-slate-700 mb-1">
                    Clock Times (HH:MM, comma-sep)
                  </label>
                  <input
                    id="med-times"
                    type="text"
                    required
                    value={timesStr}
                    onChange={(e) => setTimesStr(e.target.value)}
                    placeholder="08:00, 20:00"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>

                {scheduleType === 'interval_based' ? (
                  <div>
                    <label htmlFor="med-interval" className="block text-xs font-medium text-slate-700 mb-1">
                      Interval (Hours)
                    </label>
                    <input
                      id="med-interval"
                      type="number"
                      min={1}
                      max={72}
                      value={intervalHours}
                      onChange={(e) => setIntervalHours(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                ) : (
                  <div>
                    <label htmlFor="med-freq-label" className="block text-xs font-medium text-slate-700 mb-1">
                      Frequency Label
                    </label>
                    <input
                      id="med-freq-label"
                      type="text"
                      value={freqLabel}
                      onChange={(e) => setFreqLabel(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="med-start" className="block text-xs font-medium text-slate-700 mb-1">
                    Start Date
                  </label>
                  <input
                    id="med-start"
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="med-prescriber" className="block text-xs font-medium text-slate-700 mb-1">
                    Prescriber (Optional)
                  </label>
                  <input
                    id="med-prescriber"
                    type="text"
                    value={prescriber}
                    onChange={(e) => setPrescriber(e.target.value)}
                    placeholder="Dr. S. Kulkarni"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="med-instructions" className="block text-xs font-medium text-slate-700 mb-1">
                    Prescribed Instructions
                  </label>
                  <input
                    id="med-instructions"
                    type="text"
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Take after food"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddMed(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
                >
                  Save &amp; Activate Schedule
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="h-40 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
              {medications.map((m) => {
                const times = m.schedules[0]
                  ? (JSON.parse(m.schedules[0].times_json) as string[]).join(', ')
                  : '—';
                return (
                  <div
                    key={m.id}
                    className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span
                          className={`font-semibold capitalize ${
                            m.status === 'active'
                              ? 'text-emerald-700'
                              : m.status === 'paused'
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }`}
                        >
                          {m.status}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {m.source_type === 'verified_prescription'
                            ? 'Verified Prescription'
                            : 'Patient-Entered'}
                        </span>
                        {m.prescriber && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{m.prescriber}</span>
                          </>
                        )}
                      </div>
                      <h3 className="font-display text-base font-bold text-slate-900">
                        {m.medicine_name} {m.strength}
                      </h3>
                      <p className="text-sm text-slate-600">
                        {m.prescribed_dose} ({m.route}) · {m.frequency_label} · Clock:{' '}
                        <span className="font-mono text-slate-800">{times}</span>
                      </p>
                      {m.instructions && (
                        <p className="text-xs text-slate-500">Instructions: {m.instructions}</p>
                      )}
                    </div>

                    {!isCaregiver && (
                      <div className="flex items-center gap-2 shrink-0">
                        {m.status === 'active' ? (
                          <button
                            type="button"
                            onClick={() => handleStatusChange(m.id, 'paused')}
                            aria-label={`Pause ${m.medicine_name}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                          >
                            <Pause className="w-3.5 h-3.5" />
                            <span>Pause</span>
                          </button>
                        ) : m.status === 'paused' ? (
                          <button
                            type="button"
                            onClick={() => handleStatusChange(m.id, 'active')}
                            aria-label={`Resume ${m.medicine_name}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-teal-700 bg-teal-50 border border-teal-300 hover:bg-teal-100 rounded-lg cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>Resume</span>
                          </button>
                        ) : null}

                        {m.status !== 'discontinued' && (
                          <button
                            type="button"
                            onClick={() => handleStatusChange(m.id, 'discontinued')}
                            aria-label={`Discontinue ${m.medicine_name}`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg cursor-pointer"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            <span>Discontinue</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {subTab === 'logs' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 bg-slate-50">
                <th className="py-3 px-4">Scheduled Time</th>
                <th className="py-3 px-4">Medication</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Recorded At</th>
                <th className="py-3 px-4">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                    {l.scheduled_at.slice(0, 16).replace('T', ' ')} UTC
                  </td>
                  <td className="py-2.5 px-4 font-medium text-slate-900">{l.medication_name}</td>
                  <td className="py-2.5 px-4">
                    <span
                      className={`text-xs font-semibold capitalize ${
                        l.status === 'taken'
                          ? 'text-emerald-700'
                          : l.status === 'missed'
                          ? 'text-red-700'
                          : l.status === 'unconfirmed'
                          ? 'text-slate-500'
                          : 'text-amber-700'
                      }`}
                    >
                      {l.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
                    {l.recorded_at ? l.recorded_at.slice(0, 16).replace('T', ' ') : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-600">{l.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'cabinet' && (
        <div className="space-y-4">
          {!isCaregiver && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowAddCabinet((v) => !v)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{showAddCabinet ? 'Close Form' : 'Add Personal Stock'}</span>
              </button>
            </div>
          )}

          {showAddCabinet && !isCaregiver && (
            <form
              onSubmit={handleAddCabinetItem}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
            >
              <h2 className="font-display text-base font-bold text-slate-900">
                Add Home Medicine Stock
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="cab-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Medicine Name
                  </label>
                  <input
                    id="cab-name"
                    type="text"
                    required
                    value={cabName}
                    onChange={(e) => setCabName(e.target.value)}
                    placeholder="Lisinopril 10 mg"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="cab-batch" className="block text-xs font-medium text-slate-700 mb-1">
                    Batch / Lot (Optional)
                  </label>
                  <input
                    id="cab-batch"
                    type="text"
                    value={cabBatch}
                    onChange={(e) => setCabBatch(e.target.value)}
                    placeholder="LOT-2026-A"
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="cab-expiry" className="block text-xs font-medium text-slate-700 mb-1">
                    Expiry Date
                  </label>
                  <input
                    id="cab-expiry"
                    type="date"
                    required
                    value={cabExpiry}
                    onChange={(e) => setCabExpiry(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="cab-qty" className="block text-xs font-medium text-slate-700 mb-1">
                    Quantity
                  </label>
                  <input
                    id="cab-qty"
                    type="number"
                    min={0}
                    required
                    value={cabQty}
                    onChange={(e) => setCabQty(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="cab-unit" className="block text-xs font-medium text-slate-700 mb-1">
                    Unit
                  </label>
                  <input
                    id="cab-unit"
                    type="text"
                    required
                    value={cabUnit}
                    onChange={(e) => setCabUnit(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="cab-thresh" className="block text-xs font-medium text-slate-700 mb-1">
                    Low-Stock Alert Threshold
                  </label>
                  <input
                    id="cab-thresh"
                    type="number"
                    min={0}
                    value={cabThreshold}
                    onChange={(e) => setCabThreshold(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="cab-notes" className="block text-xs font-medium text-slate-700 mb-1">
                    Storage Notes
                  </label>
                  <input
                    id="cab-notes"
                    type="text"
                    value={cabNotes}
                    onChange={(e) => setCabNotes(e.target.value)}
                    placeholder="Cool dry cabinet"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddCabinet(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
                >
                  Save to Cabinet
                </button>
              </div>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {cabinet.map((item) => {
              const isExpired = item.expiryWindow === 'expired';
              return (
                <div
                  key={item.id}
                  className={`p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    isExpired ? 'bg-red-50/40' : ''
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span
                        className={`font-semibold ${
                          isExpired
                            ? 'text-red-700'
                            : item.expiryWindow !== 'healthy'
                            ? 'text-amber-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {isExpired ? 'EXPIRED — Do Not Use' : item.expiryLabel}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="font-mono text-slate-600 tabular-nums">
                        Exp: {item.expiry_date}
                      </span>
                      {item.batch_number && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-slate-500">Lot {item.batch_number}</span>
                        </>
                      )}
                    </div>
                    <h3 className="font-display text-base font-bold text-slate-900">
                      {item.medicine_name}
                    </h3>
                    <p className="text-xs text-slate-600">
                      Remaining: <strong className="font-mono tabular-nums">{item.quantity}</strong> {item.unit}
                      {item.isLowStock && (
                        <span className="ml-2 font-semibold text-amber-700 inline-flex items-center gap-1">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Low stock (threshold {item.min_threshold})
                        </span>
                      )}
                    </p>
                  </div>

                  {!isCaregiver && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isExpired || item.quantity <= 0}
                        onClick={() => handleAdjustCabinetQty(item.id, item.quantity - 1)}
                        aria-label={`Consume 1 unit of ${item.medicine_name}`}
                        className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        -1 Used
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCabinetItem(item.id)}
                        aria-label={`Remove ${item.medicine_name} from cabinet`}
                        className="p-2 text-slate-500 hover:text-red-700 rounded-lg hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
