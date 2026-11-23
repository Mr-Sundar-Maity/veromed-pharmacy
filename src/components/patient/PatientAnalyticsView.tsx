import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { apiFetch } from '../../types/api';
import type { AdherenceSummary } from '../../lib/adherence';

interface AdherenceAnalyticsResponse {
  summary: AdherenceSummary;
  dailySeries: Array<{
    date: string;
    adherenceRate: number;
    taken: number;
    missed: number;
    eligible: number;
  }>;
  medicationBreakdown: Array<AdherenceSummary & { medicine: string }>;
}

export const PatientAnalyticsView: React.FC<{ patientId?: string }> = ({
  patientId = 'me',
}) => {
  const [days, setDays] = useState<number>(14);
  const [data, setData] = useState<AdherenceAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ days: String(days) });
    if (patientId !== 'me') params.set('patientId', patientId);

    apiFetch<AdherenceAnalyticsResponse>(`/medication-logs/adherence?${params.toString()}`)
      .then(setData)
      .catch((err) =>
        setError(err instanceof Error ? err.message : 'Unable to load analytics.')
      )
      .finally(() => setLoading(false));
  }, [days, patientId]);

  function handleExportCsv() {
    if (!data) return;
    const header = 'Date,Adherence_Pct,Taken,Missed,Eligible_Resolved\n';
    const rows = data.dailySeries
      .map((d) => `${d.date},${d.adherenceRate},${d.taken},${d.missed},${d.eligible}`)
      .join('\n');
    const footer = `\n# Definition: ${data.summary.formulaDescription}\n`;
    const blob = new Blob([header + rows + footer], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veromed_adherence_${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Patient Adherence Analytics
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Recorded adherence reconciled directly with timestamped dose logs
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                  days === d ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                {d}D
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!data}
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading || !data ? (
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Recorded Rate</p>
              <p className="font-display text-2xl font-bold text-teal-700 mt-1 tabular-nums">
                {data.summary.recordedAdherenceRate}%
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Taken</p>
              <p className="font-display text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                {data.summary.takenCount}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Missed</p>
              <p className="font-display text-2xl font-bold text-red-700 mt-1 tabular-nums">
                {data.summary.missedCount}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Delayed / Skipped</p>
              <p className="font-display text-2xl font-bold text-amber-700 mt-1 tabular-nums">
                {data.summary.delayedCount + data.summary.skippedCount}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <p className="text-xs text-slate-500">Unconfirmed (Excluded)</p>
              <p className="font-display text-2xl font-bold text-slate-600 mt-1 tabular-nums">
                {data.summary.unconfirmedCount}
              </p>
            </div>
          </div>

          {/* Daily Adherence Bar Chart */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h2 className="font-display text-base font-bold text-slate-900">
                Daily Recorded Adherence ({days}-Day Window)
              </h2>
              <span className="text-xs text-slate-500">
                Denominator: Taken + Missed + Skipped + Delayed
              </span>
            </div>

            {data.dailySeries.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No dose logs in this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[560px] flex items-end gap-2 h-44 pt-4 pb-2 border-b border-slate-200">
                  {data.dailySeries.map((day) => (
                    <div key={day.date} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                      <span className="font-mono text-[10px] text-slate-600 tabular-nums">
                        {day.adherenceRate}%
                      </span>
                      <div className="w-full max-w-[32px] bg-slate-100 rounded-t-md h-28 flex items-end overflow-hidden">
                        <div
                          className={`w-full rounded-t-md transition-all ${
                            day.adherenceRate >= 80
                              ? 'bg-teal-600'
                              : day.adherenceRate >= 50
                              ? 'bg-amber-500'
                              : 'bg-red-500'
                          }`}
                          style={{ height: `${Math.max(4, day.adherenceRate)}%` }}
                        />
                      </div>
                      <span className="font-mono text-[10px] text-slate-500 tabular-nums">
                        {day.date.slice(5)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-slate-500">{data.summary.formulaDescription}</p>
          </section>

          {/* Per-Medication Breakdown */}
          <section className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="font-display text-base font-bold text-slate-900">
                Breakdown by Medication
              </h2>
            </div>
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-4">Medication</th>
                  <th className="py-3 px-4 text-right">Taken</th>
                  <th className="py-3 px-4 text-right">Missed</th>
                  <th className="py-3 px-4 text-right">Delayed/Skipped</th>
                  <th className="py-3 px-4 text-right">Unconfirmed</th>
                  <th className="py-3 px-4 text-right">Recorded Adherence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.medicationBreakdown.map((row) => (
                  <tr key={row.medicine}>
                    <td className="py-3 px-4 font-medium text-slate-900">{row.medicine}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{row.takenCount}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-red-700">
                      {row.missedCount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {row.delayedCount + row.skippedCount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-500">
                      {row.unconfirmedCount}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-teal-700">
                      {row.recordedAdherenceRate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
};
