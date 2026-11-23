import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Info,
  Plus,
  Send,
  ShieldCheck,
  UserPlus,
  UserX,
} from 'lucide-react';
import { apiFetch } from '../../types/api';
import type { InteractionCheckReport } from '../../lib/interactions';

interface CaregiverRow {
  id: string;
  caregiver_email: string;
  caregiver_name: string;
  relationship_label: string;
  consent_status: 'active' | 'revoked' | 'pending';
  permissions: Record<string, boolean>;
  granted_at: string | null;
  revoked_at: string | null;
}

const PERMISSION_LABELS: Array<{ key: string; label: string }> = [
  { key: 'schedules', label: 'Medication Schedules' },
  { key: 'dose_history', label: 'Dose History & Logging' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'documents', label: 'Medical Documents' },
  { key: 'medical_history', label: 'Conditions & Allergies' },
  { key: 'emergency_info', label: 'Emergency Contact Info' },
];

export const InteractionsCaregiverView: React.FC<{
  patientId?: string;
  isCaregiver?: boolean;
}> = ({ patientId = 'me', isCaregiver = false }) => {
  const [tab, setTab] = useState<'interactions' | 'caregivers' | 'assistant'>('interactions');

  // Interaction Checker State
  const [medInputs, setMedInputs] = useState<string[]>([
    'Warfarin (Coumadin) 5mg',
    'Aspirin (Ecosprin) 75mg',
  ]);
  const [newMedInput, setNewMedInput] = useState('');
  const [interactionReport, setInteractionReport] = useState<InteractionCheckReport | null>(null);
  const [checkingInteractions, setCheckingInteractions] = useState(false);

  // Caregiver State
  const [caregivers, setCaregivers] = useState<CaregiverRow[]>([]);
  const [cgEmail, setCgEmail] = useState('');
  const [cgName, setCgName] = useState('');
  const [cgRelation, setCgRelation] = useState('Family Caregiver');

  // Healthcare Assistant State
  const [question, setQuestion] = useState('');
  const [assistantReply, setAssistantReply] = useState<{
    answer: string;
    citedSources: string[];
    clinicalEscalation: boolean;
  } | null>(null);
  const [askingAi, setAskingAi] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function loadCaregivers() {
    try {
      const res = await apiFetch<{ caregivers: CaregiverRow[] }>('/caregivers');
      setCaregivers(res.caregivers);
    } catch {
      // Ignore if current role has restricted access
    }
  }

  useEffect(() => {
    void loadCaregivers();
  }, []);

  async function handleCheckInteractions(e?: React.FormEvent) {
    e?.preventDefault();
    if (medInputs.length < 2) {
      setError('Add at least two medicines to check pairwise interactions.');
      return;
    }
    setCheckingInteractions(true);
    setError(null);
    try {
      const res = await apiFetch<{ report: InteractionCheckReport }>('/interactions/check', {
        method: 'POST',
        body: JSON.stringify({ medicines: medInputs }),
      });
      setInteractionReport(res.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Interaction lookup failed.');
    } finally {
      setCheckingInteractions(false);
    }
  }

  function handleAddMedInput() {
    const trimmed = newMedInput.trim();
    if (!trimmed) return;
    setMedInputs((prev) => [...prev, trimmed]);
    setNewMedInput('');
  }

  async function handleInviteCaregiver(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/caregivers/invite', {
        method: 'POST',
        body: JSON.stringify({
          caregiverEmail: cgEmail,
          caregiverName: cgName,
          relationshipLabel: cgRelation,
        }),
      });
      setCgEmail('');
      setCgName('');
      await loadCaregivers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to invite caregiver.');
    }
  }

  async function handleTogglePermission(row: CaregiverRow, key: string) {
    try {
      await apiFetch(`/caregivers/${encodeURIComponent(row.id)}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({
          permissions: { [key]: !row.permissions[key] },
        }),
      });
      await loadCaregivers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update permission.');
    }
  }

  async function handleRevokeCaregiver(id: string) {
    try {
      await apiFetch(`/caregivers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadCaregivers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to revoke access.');
    }
  }

  async function handleAskAssistant(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAskingAi(true);
    setError(null);
    try {
      const res = await apiFetch<{
        answer: string;
        citedSources: string[];
        clinicalEscalation: boolean;
      }>('/assistant/query', {
        method: 'POST',
        body: JSON.stringify({ question, patientId }),
      });
      setAssistantReply(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Healthcare Assistant query failed.');
    } finally {
      setAskingAi(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Interactions, Shared Care &amp; Record Assistant
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Verified drug-reference lookup, granular caregiver consent, and record-grounded navigation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setTab('interactions')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              tab === 'interactions' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Interaction Lookup
          </button>
          <button
            type="button"
            onClick={() => setTab('caregivers')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              tab === 'caregivers' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Caregiver Sharing
          </button>
          <button
            type="button"
            onClick={() => setTab('assistant')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
              tab === 'assistant' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Record Assistant
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {tab === 'interactions' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <h2 className="font-display text-base font-bold text-slate-900">
              Multi-Medication Interaction Check
            </h2>
            <p className="text-xs text-slate-600">
              Enter brand or generic names (e.g. Coumadin, Aspirin, Atorvastatin, Clarithromycin, Omeprazole, Clopidogrel, or an unlisted herbal supplement to verify unknown-evidence reporting).
            </p>

            <div className="flex flex-wrap gap-2">
              {medInputs.map((m, idx) => (
                <div
                  key={`${m}-${idx}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-800 rounded-lg border border-slate-200"
                >
                  <span>{m}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${m}`}
                    onClick={() => setMedInputs((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-slate-500 hover:text-red-700 cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                aria-label="Add medicine to interaction check"
                value={newMedInput}
                onChange={(e) => setNewMedInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddMedInput();
                  }
                }}
                placeholder="Add medicine name (e.g. Ibuprofen 400mg or Ashwagandha)"
                className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
              <button
                type="button"
                onClick={handleAddMedInput}
                className="inline-flex items-center justify-center gap-1 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add Medicine</span>
              </button>
              <button
                type="button"
                disabled={checkingInteractions}
                onClick={() => void handleCheckInteractions()}
                className="px-5 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer disabled:opacity-50"
              >
                {checkingInteractions ? 'Checking...' : 'Check Interactions'}
              </button>
            </div>
          </div>

          {interactionReport && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-xs text-amber-950 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <p>{interactionReport.disclaimer}</p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                {interactionReport.results.map((r, idx) => (
                  <div key={idx} className="p-5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-display text-base font-bold text-slate-900">
                        {r.pair[0]} + {r.pair[1]}
                      </h3>
                      <span
                        className={`text-xs font-semibold ${
                          r.status === 'interaction_found'
                            ? r.severity === 'Major'
                              ? 'text-red-700'
                              : 'text-amber-700'
                            : r.status === 'unknown_insufficient_data'
                            ? 'text-slate-700'
                            : 'text-teal-700'
                        }`}
                      >
                        {r.status === 'interaction_found'
                          ? `${r.severity} Interaction`
                          : r.status === 'unknown_insufficient_data'
                          ? 'Unknown / Insufficient Evidence'
                          : 'No Documented Record Found (Not Guaranteed Safe)'}
                      </span>
                    </div>

                    <p className="text-sm text-slate-700">{r.description}</p>
                    <p className="text-xs text-slate-600">
                      <strong>Guidance:</strong> {r.clinicalGuidanceNote}
                    </p>
                    <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-500 space-y-0.5">
                      <p>
                        <strong>Source:</strong> {r.source.sourceName} · Version {r.source.version} · Updated{' '}
                        <span className="font-mono">{r.source.updatedAt}</span>
                      </p>
                      <p>
                        <strong>Limitations:</strong> {r.source.limitations}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'caregivers' && (
        <div className="space-y-6">
          {!isCaregiver && (
            <form
              onSubmit={handleInviteCaregiver}
              className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
            >
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-teal-700" />
                <h2 className="font-display text-base font-bold text-slate-900">
                  Invite &amp; Authorise a Caregiver
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="cg-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Caregiver Name
                  </label>
                  <input
                    id="cg-name"
                    type="text"
                    required
                    value={cgName}
                    onChange={(e) => setCgName(e.target.value)}
                    placeholder="Rahul Sharma"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="cg-email" className="block text-xs font-medium text-slate-700 mb-1">
                    Caregiver Email
                  </label>
                  <input
                    id="cg-email"
                    type="email"
                    required
                    value={cgEmail}
                    onChange={(e) => setCgEmail(e.target.value)}
                    placeholder="rahul@example.com"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="cg-rel" className="block text-xs font-medium text-slate-700 mb-1">
                    Relationship
                  </label>
                  <input
                    id="cg-rel"
                    type="text"
                    value={cgRelation}
                    onChange={(e) => setCgRelation(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer"
                >
                  Grant Consent &amp; Invite
                </button>
              </div>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {caregivers.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">No caregiver relationships configured.</p>
            ) : (
              caregivers.map((cg) => (
                <div key={cg.id} className="p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs">
                        <span
                          className={`font-semibold capitalize ${
                            cg.consent_status === 'active' ? 'text-emerald-700' : 'text-red-700'
                          }`}
                        >
                          Consent {cg.consent_status}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-500">{cg.relationship_label}</span>
                      </div>
                      <h3 className="font-display text-base font-bold text-slate-900 mt-0.5">
                        {cg.caregiver_name} ({cg.caregiver_email})
                      </h3>
                    </div>

                    {!isCaregiver && cg.consent_status === 'active' && (
                      <button
                        type="button"
                        onClick={() => void handleRevokeCaregiver(cg.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-white border border-red-200 hover:bg-red-50 rounded-lg cursor-pointer self-start"
                      >
                        <UserX className="w-3.5 h-3.5" />
                        <span>Revoke Access Immediately</span>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {PERMISSION_LABELS.map((perm) => {
                      const enabled = Boolean(cg.permissions[perm.key]);
                      return (
                        <label
                          key={perm.key}
                          className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs ${
                            enabled
                              ? 'border-teal-200 bg-teal-50/40 text-slate-900'
                              : 'border-slate-200 bg-slate-50 text-slate-500'
                          } ${!isCaregiver && cg.consent_status === 'active' ? 'cursor-pointer' : ''}`}
                        >
                          <input
                            type="checkbox"
                            disabled={isCaregiver || cg.consent_status !== 'active'}
                            checked={enabled}
                            onChange={() => void handleTogglePermission(cg, perm.key)}
                            className="rounded border-slate-300 text-teal-700"
                          />
                          <span>{perm.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'assistant' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <div className="flex items-start gap-3">
            <Bot className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Record-Grounded Healthcare Assistant
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Retrieves only your authorised records and cites exact document/record IDs. Clinical treatment or diagnosis questions are escalated to a licensed professional.
              </p>
            </div>
          </div>

          <form onSubmit={handleAskAssistant} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              aria-label="Ask a record navigation question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. What was my last HbA1c value? or When is my next appointment?"
              className="flex-1 px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg"
            />
            <button
              type="submit"
              disabled={askingAi}
              className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{askingAi ? 'Retrieving...' : 'Ask Record Assistant'}</span>
            </button>
          </form>

          <div className="flex flex-wrap gap-2 text-xs">
            {[
              'When is my next appointment and what should I bring?',
              'What was my latest HbA1c and LDL cholesterol result?',
              'Should I double my Metformin dose today?',
            ].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setQuestion(sample)}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md cursor-pointer"
              >
                {sample}
              </button>
            ))}
          </div>

          {assistantReply && (
            <div className="border border-slate-200 rounded-xl p-5 space-y-3 bg-slate-50/50">
              {assistantReply.clinicalEscalation && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    Clinical Escalation Notice: Please consult your licensed clinician or pharmacist for medical advice.
                  </span>
                </div>
              )}
              <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
                {assistantReply.answer}
              </p>
              <div className="pt-2 border-t border-slate-200 text-xs text-slate-500 flex items-center gap-2">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Cited Authorised Sources:{' '}
                  {assistantReply.citedSources.length > 0
                    ? assistantReply.citedSources.join(', ')
                    : 'No matching source records found'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
