import React, { useEffect, useState } from 'react';
import {
  Calendar,
  Download,
  FileText,
  FolderOpen,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { apiFetch, getAuthToken } from '../../types/api';

interface MedicalDoc {
  id: string;
  title: string;
  file_name: string;
  category: string;
  tags: string;
  document_date: string | null;
  provider: string | null;
  ocr_text: string;
  uploaded_at: string;
}

interface ConditionRow {
  id: string;
  condition_name: string;
  onset_date: string | null;
  status: string;
  notes: string | null;
}

interface AllergyRow {
  id: string;
  substance: string;
  reaction: string;
  severity: string;
  verification_status: string;
}

interface AppointmentRow {
  id: string;
  provider: string;
  facility: string;
  department: string | null;
  appointment_type: string;
  start_at: string;
  timezone: string;
  location: string | null;
  notes: string | null;
  status: 'scheduled' | 'rescheduled' | 'completed' | 'cancelled';
}

interface TimelineEntry {
  id: string;
  kind: string;
  date: string;
  title: string;
  subtitle: string;
  detail: string;
}

interface RecordsAppointmentsViewProps {
  patientId?: string;
  isCaregiver?: boolean;
}

export const RecordsAppointmentsView: React.FC<RecordsAppointmentsViewProps> = ({
  patientId = 'me',
  isCaregiver = false,
}) => {
  const [tab, setTab] = useState<'appointments' | 'documents' | 'history' | 'timeline'>(
    'appointments'
  );
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [documents, setDocuments] = useState<MedicalDoc[]>([]);
  const [docDeniedError, setDocDeniedError] = useState<string | null>(null);
  const [conditions, setConditions] = useState<ConditionRow[]>([]);
  const [allergies, setAllergies] = useState<AllergyRow[]>([]);
  const [historyDeniedError, setHistoryDeniedError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);

  // Appointment Form
  const [showApptForm, setShowApptForm] = useState(false);
  const [apptProvider, setApptProvider] = useState('');
  const [apptFacility, setApptFacility] = useState('');
  const [apptType, setApptType] = useState('consultation');
  const [apptDate, setApptDate] = useState(
    new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10)
  );
  const [apptTime, setApptTime] = useState('10:00');
  const [apptNotes, setApptNotes] = useState('');

  // Document Upload Form
  const [showDocForm, setShowDocForm] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docCategory, setDocCategory] = useState('report');
  const [docProvider, setDocProvider] = useState('');
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [docTags, setDocTags] = useState('');
  const [docNotes, setDocNotes] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);

  // Condition & Allergy Forms
  const [condName, setCondName] = useState('');
  const [allergySub, setAllergySub] = useState('');
  const [allergyReact, setAllergyReact] = useState('');
  const [allergySev, setAllergySev] = useState('Moderate');

  async function loadAll() {
    setError(null);
    const q = patientId !== 'me' ? `?patientId=${encodeURIComponent(patientId)}` : '';

    try {
      const apptRes = await apiFetch<{ appointments: AppointmentRow[] }>(`/appointments${q}`);
      setAppointments(apptRes.appointments);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load appointments.');
    }

    try {
      const docParams = new URLSearchParams();
      if (patientId !== 'me') docParams.set('patientId', patientId);
      if (searchQuery) docParams.set('q', searchQuery);
      if (catFilter !== 'all') docParams.set('category', catFilter);
      const docRes = await apiFetch<{ documents: MedicalDoc[] }>(
        `/medical-documents?${docParams.toString()}`
      );
      setDocuments(docRes.documents);
      setDocDeniedError(null);
    } catch (err) {
      setDocDeniedError(err instanceof Error ? err.message : 'Documents unavailable.');
    }

    try {
      const histRes = await apiFetch<{ conditions: ConditionRow[]; allergies: AllergyRow[] }>(
        `/medical-conditions${q}`
      );
      setConditions(histRes.conditions);
      setAllergies(histRes.allergies);
      setHistoryDeniedError(null);

      const tlRes = await apiFetch<{ timeline: TimelineEntry[] }>(
        `/patients/${encodeURIComponent(patientId)}/timeline`
      );
      setTimeline(tlRes.timeline);
    } catch (err) {
      setHistoryDeniedError(err instanceof Error ? err.message : 'Medical history unavailable.');
    }
  }

  useEffect(() => {
    void loadAll();
  }, [patientId, searchQuery, catFilter]);

  async function handleCreateAppointment(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiFetch('/appointments', {
        method: 'POST',
        body: JSON.stringify({
          provider: apptProvider,
          facility: apptFacility,
          appointmentType: apptType,
          startAt: `${apptDate}T${apptTime}:00.000Z`,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          notes: apptNotes,
          reminderOffsets: [1440, 120],
        }),
      });
      setShowApptForm(false);
      setApptProvider('');
      setApptFacility('');
      setApptNotes('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create appointment.');
    }
  }

  async function handleUpdateAppointment(
    id: string,
    payload: { status?: string; startAt?: string }
  ) {
    try {
      await apiFetch(`/appointments/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update appointment.');
    }
  }

  async function handleUploadDocument(e: React.FormEvent) {
    e.preventDefault();
    try {
      const form = new FormData();
      form.append('title', docTitle);
      form.append('category', docCategory);
      form.append('provider', docProvider);
      form.append('documentDate', docDate);
      form.append('tags', docTags);
      form.append('notes', docNotes);
      if (docFile) form.append('file', docFile);

      await apiFetch('/medical-documents', { method: 'POST', body: form });
      setShowDocForm(false);
      setDocTitle('');
      setDocProvider('');
      setDocTags('');
      setDocNotes('');
      setDocFile(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Document upload failed.');
    }
  }

  async function handleDownloadDocument(doc: MedicalDoc) {
    const token = getAuthToken();
    const res = await fetch(`/api/v1/medical-documents/${encodeURIComponent(doc.id)}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.file_name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleAddCondition(e: React.FormEvent) {
    e.preventDefault();
    if (!condName.trim()) return;
    await apiFetch('/medical-conditions', {
      method: 'POST',
      body: JSON.stringify({ conditionName: condName }),
    });
    setCondName('');
    await loadAll();
  }

  async function handleAddAllergy(e: React.FormEvent) {
    e.preventDefault();
    if (!allergySub.trim() || !allergyReact.trim()) return;
    await apiFetch('/allergies', {
      method: 'POST',
      body: JSON.stringify({
        substance: allergySub,
        reaction: allergyReact,
        severity: allergySev,
      }),
    });
    setAllergySub('');
    setAllergyReact('');
    await loadAll();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Medical Records &amp; Appointments
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Chronological history, searchable documents, allergies, and visit reminders
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
          {(['appointments', 'documents', 'history', 'timeline'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md capitalize transition-colors cursor-pointer ${
                tab === t ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {tab === 'appointments' && (
        <div className="space-y-4">
          {!isCaregiver && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowApptForm((v) => !v)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{showApptForm ? 'Close Form' : 'Schedule Appointment'}</span>
              </button>
            </div>
          )}

          {showApptForm && !isCaregiver && (
            <form
              onSubmit={handleCreateAppointment}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
            >
              <h2 className="font-display text-base font-bold text-slate-900">
                New Clinic or Lab Appointment
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="appt-provider" className="block text-xs font-medium text-slate-700 mb-1">
                    Provider / Clinician
                  </label>
                  <input
                    id="appt-provider"
                    type="text"
                    required
                    value={apptProvider}
                    onChange={(e) => setApptProvider(e.target.value)}
                    placeholder="Dr. S. Kulkarni"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="appt-facility" className="block text-xs font-medium text-slate-700 mb-1">
                    Facility / Clinic
                  </label>
                  <input
                    id="appt-facility"
                    type="text"
                    required
                    value={apptFacility}
                    onChange={(e) => setApptFacility(e.target.value)}
                    placeholder="HeartCare Center"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="appt-type" className="block text-xs font-medium text-slate-700 mb-1">
                    Appointment Category
                  </label>
                  <select
                    id="appt-type"
                    value={apptType}
                    onChange={(e) => setApptType(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="consultation">Consultation</option>
                    <option value="follow_up">Follow-Up</option>
                    <option value="lab">Lab Test</option>
                    <option value="imaging">Imaging</option>
                    <option value="vaccination">Vaccination</option>
                    <option value="dental">Dental</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="appt-date" className="block text-xs font-medium text-slate-700 mb-1">
                    Date
                  </label>
                  <input
                    id="appt-date"
                    type="date"
                    required
                    value={apptDate}
                    onChange={(e) => setApptDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="appt-time" className="block text-xs font-medium text-slate-700 mb-1">
                    Time (UTC)
                  </label>
                  <input
                    id="appt-time"
                    type="time"
                    required
                    value={apptTime}
                    onChange={(e) => setApptTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="appt-notes" className="block text-xs font-medium text-slate-700 mb-1">
                    Preparation Notes
                  </label>
                  <input
                    id="appt-notes"
                    type="text"
                    value={apptNotes}
                    onChange={(e) => setApptNotes(e.target.value)}
                    placeholder="Bring medication list"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowApptForm(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
                >
                  Save Appointment (24h &amp; 2h Reminders)
                </button>
              </div>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {appointments.length === 0 ? (
              <p className="p-8 text-center text-sm text-slate-500">No appointments scheduled.</p>
            ) : (
              appointments.map((a) => (
                <div
                  key={a.id}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <Calendar className="w-3.5 h-3.5 text-teal-700" />
                      <span className="font-mono text-slate-700 tabular-nums">
                        {a.start_at.slice(0, 16).replace('T', ' ')} UTC
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{a.appointment_type.replace('_', ' ')}</span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={`font-semibold capitalize ${
                          a.status === 'cancelled'
                            ? 'text-red-700'
                            : a.status === 'completed'
                            ? 'text-emerald-700'
                            : 'text-teal-700'
                        }`}
                      >
                        {a.status}
                      </span>
                    </div>
                    <h3 className="font-display text-base font-bold text-slate-900">
                      {a.provider} — {a.facility}
                    </h3>
                    {a.notes && <p className="text-xs text-slate-600">{a.notes}</p>}
                  </div>

                  {!isCaregiver && a.status !== 'cancelled' && (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          const nextDate = new Date(Date.parse(a.start_at) + 86400_000).toISOString();
                          void handleUpdateAppointment(a.id, {
                            status: 'rescheduled',
                            startAt: nextDate,
                          });
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
                      >
                        +1 Day Reschedule
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleUpdateAppointment(a.id, { status: 'cancelled' })}
                        aria-label={`Cancel appointment with ${a.provider}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Cancel</span>
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'documents' && (
        <div className="space-y-4">
          {docDeniedError ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-900">
              <p className="font-semibold">Access Boundary Enforced</p>
              <p className="mt-1">{docDeniedError}</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-1 items-center gap-2">
                  <div className="relative flex-1 max-w-md">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="search"
                      aria-label="Search medical documents"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search reports, tags, providers, or OCR text..."
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <select
                    aria-label="Filter documents by category"
                    value={catFilter}
                    onChange={(e) => setCatFilter(e.target.value)}
                    className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="all">All Categories</option>
                    <option value="test_result">Test Results</option>
                    <option value="report">Clinical Reports</option>
                    <option value="discharge_summary">Discharge Summaries</option>
                    <option value="insurance">Insurance</option>
                    <option value="bill">Bills</option>
                  </select>
                </div>

                {!isCaregiver && (
                  <button
                    type="button"
                    onClick={() => setShowDocForm((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer shrink-0"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload Medical Document</span>
                  </button>
                )}
              </div>

              {showDocForm && !isCaregiver && (
                <form
                  onSubmit={handleUploadDocument}
                  className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
                >
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Upload &amp; Index Medical Document
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="doc-title" className="block text-xs font-medium text-slate-700 mb-1">
                        Document Title
                      </label>
                      <input
                        id="doc-title"
                        type="text"
                        required
                        value={docTitle}
                        onChange={(e) => setDocTitle(e.target.value)}
                        placeholder="Complete Blood Count Report"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="doc-cat" className="block text-xs font-medium text-slate-700 mb-1">
                        Category
                      </label>
                      <select
                        id="doc-cat"
                        value={docCategory}
                        onChange={(e) => setDocCategory(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="test_result">Test Result</option>
                        <option value="report">Report</option>
                        <option value="discharge_summary">Discharge Summary</option>
                        <option value="prescription">Prescription</option>
                        <option value="insurance">Insurance</option>
                        <option value="bill">Bill</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="doc-date" className="block text-xs font-medium text-slate-700 mb-1">
                        Document Date
                      </label>
                      <input
                        id="doc-date"
                        type="date"
                        value={docDate}
                        onChange={(e) => setDocDate(e.target.value)}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="doc-provider" className="block text-xs font-medium text-slate-700 mb-1">
                        Provider / Lab
                      </label>
                      <input
                        id="doc-provider"
                        type="text"
                        value={docProvider}
                        onChange={(e) => setDocProvider(e.target.value)}
                        placeholder="Metropolis Diagnostics"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="doc-tags" className="block text-xs font-medium text-slate-700 mb-1">
                        Tags (comma-separated)
                      </label>
                      <input
                        id="doc-tags"
                        type="text"
                        value={docTags}
                        onChange={(e) => setDocTags(e.target.value)}
                        placeholder="blood,cbc,annual"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="doc-notes" className="block text-xs font-medium text-slate-700 mb-1">
                        Searchable Summary / Notes
                      </label>
                      <input
                        id="doc-notes"
                        type="text"
                        value={docNotes}
                        onChange={(e) => setDocNotes(e.target.value)}
                        placeholder="Hemoglobin 13.8 g/dL..."
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label htmlFor="doc-file" className="block text-xs font-medium text-slate-700 mb-1">
                        Attach File (PDF, JPG, PNG, TXT — optional)
                      </label>
                      <input
                        id="doc-file"
                        type="file"
                        accept=".pdf,.jpg,.jpeg,.png,.txt"
                        onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
                        className="w-full text-xs text-slate-600"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDocForm(false)}
                      className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
                    >
                      Save Document
                    </button>
                  </div>
                </form>
              )}

              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                {documents.length === 0 ? (
                  <p className="p-8 text-center text-sm text-slate-500">
                    No matching medical documents found.
                  </p>
                ) : (
                  documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <FileText className="w-3.5 h-3.5 text-teal-700" />
                          <span className="capitalize">{doc.category.replace('_', ' ')}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {doc.document_date || doc.uploaded_at.slice(0, 10)}
                          </span>
                          {doc.provider && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{doc.provider}</span>
                            </>
                          )}
                        </div>
                        <h3 className="font-display text-base font-bold text-slate-900">
                          {doc.title}
                        </h3>
                        {doc.ocr_text && (
                          <p className="text-xs text-slate-600 line-clamp-2">{doc.ocr_text}</p>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleDownloadDocument(doc)}
                        aria-label={`Download ${doc.title}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-6">
          {historyDeniedError ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-900">
              <p className="font-semibold">Access Boundary Enforced</p>
              <p className="mt-1">{historyDeniedError}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-base font-bold text-slate-900">
                  Recorded Conditions
                </h2>
                {!isCaregiver && (
                  <form onSubmit={handleAddCondition} className="flex gap-2">
                    <input
                      type="text"
                      aria-label="Add medical condition"
                      value={condName}
                      onChange={(e) => setCondName(e.target.value)}
                      placeholder="Add condition (e.g. Asthma)"
                      className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                    <button
                      type="submit"
                      className="px-3.5 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg cursor-pointer"
                    >
                      Add
                    </button>
                  </form>
                )}
                <div className="divide-y divide-slate-100">
                  {conditions.map((c) => (
                    <div key={c.id} className="py-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{c.condition_name}</span>
                        <span className="text-xs text-slate-500 capitalize">{c.status}</span>
                      </div>
                      {c.notes && <p className="text-xs text-slate-600 mt-0.5">{c.notes}</p>}
                    </div>
                  ))}
                </div>
              </section>

              <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="font-display text-base font-bold text-slate-900">
                  Allergies &amp; Reactions
                </h2>
                {!isCaregiver && (
                  <form onSubmit={handleAddAllergy} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <input
                      type="text"
                      aria-label="Allergy substance"
                      value={allergySub}
                      onChange={(e) => setAllergySub(e.target.value)}
                      placeholder="Substance"
                      className="px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                    <input
                      type="text"
                      aria-label="Allergy reaction"
                      value={allergyReact}
                      onChange={(e) => setAllergyReact(e.target.value)}
                      placeholder="Reaction"
                      className="px-3 py-2 text-sm border border-slate-300 rounded-lg sm:col-span-2"
                    />
                    <div className="flex gap-1">
                      <select
                        aria-label="Allergy severity"
                        value={allergySev}
                        onChange={(e) => setAllergySev(e.target.value)}
                        className="px-2 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="Mild">Mild</option>
                        <option value="Moderate">Moderate</option>
                        <option value="Severe">Severe</option>
                      </select>
                      <button
                        type="submit"
                        className="px-3 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg cursor-pointer"
                      >
                        Add
                      </button>
                    </div>
                  </form>
                )}
                <div className="divide-y divide-slate-100">
                  {allergies.map((a) => (
                    <div key={a.id} className="py-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{a.substance}</span>
                        <span
                          className={`text-xs font-semibold ${
                            a.severity === 'Severe' ? 'text-red-700' : 'text-amber-700'
                          }`}
                        >
                          {a.severity}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">{a.reaction}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {tab === 'timeline' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          {historyDeniedError ? (
            <p className="text-sm text-amber-900">{historyDeniedError}</p>
          ) : timeline.length === 0 ? (
            <p className="text-sm text-slate-500">No chronological events recorded yet.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {timeline.map((entry) => (
                <div key={`${entry.kind}-${entry.id}`} className="py-4 flex items-start gap-4">
                  <span className="font-mono text-xs text-slate-500 tabular-nums w-24 shrink-0 pt-0.5">
                    {entry.date}
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 text-xs text-teal-700 font-semibold capitalize">
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>{entry.kind}</span>
                    </div>
                    <p className="font-semibold text-sm text-slate-900">{entry.title}</p>
                    <p className="text-xs text-slate-500">{entry.subtitle}</p>
                    {entry.detail && <p className="text-xs text-slate-600 mt-1">{entry.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
