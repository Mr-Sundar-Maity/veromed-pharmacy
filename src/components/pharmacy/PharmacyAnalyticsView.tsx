import React, { useEffect, useState } from 'react';
import { AlertTriangle, Download, TrendingUp } from 'lucide-react';
import { apiFetch } from '../../types/api';
import type { ForecastModelName, ForecastOutput } from '../../lib/forecasting';

interface PharmacyAnalyticsResponse {
  kpis: {
    totalUnits: number;
    eligibleUnits: number;
    expiredUnits: number;
    expiring30dUnits: number;
    totalPurchaseValuation: number;
    totalRetailValuation: number;
  };
  categories: Array<{ category: string; units: number; valuation: number }>;
  itemVelocity: Array<{
    id: string;
    medicine_name: string;
    sku: string;
    min_threshold: number;
    total_sold: number;
    total_in: number;
  }>;
  dailyMovement: Array<{ date: string; units_out: number; units_in: number }>;
}

interface ForecastApiResponse {
  forecast: ForecastOutput;
  history: Array<{ date: string; unitsSold: number }>;
}

export const PharmacyAnalyticsView: React.FC = () => {
  const [analytics, setAnalytics] = useState<PharmacyAnalyticsResponse | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<ForecastModelName | 'auto'>('auto');
  const [forecastRes, setForecastRes] = useState<ForecastApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiFetch<PharmacyAnalyticsResponse>('/inventory/analytics')
      .then((res) => {
        setAnalytics(res);
        if (res.itemVelocity[0]) {
          setSelectedItemId(res.itemVelocity[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load analytics.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedItemId) return;
    const params = new URLSearchParams({ horizonDays: '30' });
    if (selectedModel !== 'auto') params.set('model', selectedModel);

    apiFetch<ForecastApiResponse>(
      `/inventory/forecast/${encodeURIComponent(selectedItemId)}?${params.toString()}`
    )
      .then(setForecastRes)
      .catch((err) => setError(err instanceof Error ? err.message : 'Forecast failed.'));
  }, [selectedItemId, selectedModel]);

  function handleExportCsv() {
    if (!analytics) return;
    const header = 'SKU,Medicine,Min_Threshold,45d_Sold,Total_Stock_In\n';
    const rows = analytics.itemVelocity
      .map((i) => `${i.sku},"${i.medicine_name}",${i.min_threshold},${i.total_sold},${i.total_in}`)
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'veromed_pharmacy_inventory_report.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading || !analytics) {
    return <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />;
  }

  const maxDailyOut = Math.max(1, ...analytics.dailyMovement.map((d) => d.units_out));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Pharmacy Analytics &amp; ML Demand Forecasting
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Stock valuation, fast/slow turnover, and holdout-evaluated demand estimation
          </p>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer self-start"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Inventory Report</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Category & Daily Stock Outbound Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-900">
            Daily Dispensing Volume (Trailing Transactions)
          </h2>
          <div className="overflow-x-auto">
            <div className="min-w-[480px] flex items-end gap-1 h-40 pt-4 pb-2 border-b border-slate-200">
              {analytics.dailyMovement.slice(-24).map((d) => {
                const heightPct = Math.max(6, Math.round((d.units_out / maxDailyOut) * 100));
                return (
                  <div
                    key={d.date}
                    title={`${d.date}: ${d.units_out} units dispensed`}
                    className="flex-1 flex flex-col items-center gap-1 h-full justify-end"
                  >
                    <div className="w-full bg-slate-100 rounded-t h-28 flex items-end">
                      <div
                        className="w-full bg-blue-600 rounded-t"
                        style={{ height: `${heightPct}%` }}
                      />
                    </div>
                    <span className="font-mono text-[9px] text-slate-400 tabular-nums">
                      {d.date.slice(8)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Reconciled directly from committed sale and stock-out ledger transactions.
          </p>
        </section>

        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="font-display text-base font-bold text-slate-900">
              Category Valuation Summary
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {analytics.categories.map((c) => (
              <div key={c.category} className="p-4 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium text-slate-900">{c.category}</p>
                  <p className="text-xs text-slate-500 font-mono tabular-nums">{c.units} total units</p>
                </div>
                <span className="font-mono font-semibold text-slate-900 tabular-nums">
                  ₹{c.valuation.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ML Demand Forecasting Workbench */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-start gap-2.5">
            <TrendingUp className="w-5 h-5 text-blue-700 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                ML Demand Forecast &amp; Holdout Evaluation
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Compares Moving Average, Exponential Smoothing, and OLS Regression on a 14-day holdout split
              </p>
            </div>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
            <select
              aria-label="Select medicine for forecast"
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className="px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white max-w-[220px]"
            >
              {analytics.itemVelocity.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.medicine_name} ({item.sku})
                </option>
              ))}
            </select>

            <select
              aria-label="Select forecasting model"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as ForecastModelName | 'auto')}
              className="px-3 py-2 text-xs font-medium border border-slate-300 rounded-lg bg-white max-w-[220px]"
            >
              <option value="auto">Auto-Select Lowest Holdout RMSE</option>
              <option value="moving_average">7-Day Moving Average</option>
              <option value="exponential_smoothing">Exponential Smoothing (α=0.30)</option>
              <option value="linear_regression">OLS Linear Trend Regression</option>
            </select>
          </div>
        </div>

        {forecastRes && (
          <div className="space-y-5">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 text-xs text-amber-950 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <p>
                <strong>Advisory Estimate Only:</strong> {forecastRes.forecast.disclaimer}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="border border-slate-200 rounded-lg p-4">
                <p className="text-xs text-slate-500">30-Day Predicted Demand</p>
                <p className="font-display text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                  {forecastRes.forecast.forecastedTotalDemand} units
                </p>
                <p className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
                  95% CI: [{forecastRes.forecast.confidenceInterval95.lower} –{' '}
                  {forecastRes.forecast.confidenceInterval95.upper}]
                </p>
              </div>

              <div className="border border-slate-200 rounded-lg p-4">
                <p className="text-xs text-slate-500">Selected Model</p>
                <p className="font-display text-base font-bold text-blue-800 mt-1">
                  {forecastRes.forecast.selectedModelLabel}
                </p>
                <p className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
                  Model date: {forecastRes.forecast.modelDate}
                </p>
              </div>

              <div className="border border-slate-200 rounded-lg p-4">
                <p className="text-xs text-slate-500">Estimated Days of Cover</p>
                <p className="font-display text-2xl font-bold text-slate-900 mt-1 tabular-nums">
                  {forecastRes.forecast.daysOfCoverEstimate ?? '—'} days
                </p>
                <p className="text-xs mt-1">
                  Stockout risk:{' '}
                  <strong
                    className={`uppercase ${
                      forecastRes.forecast.stockoutRisk === 'high'
                        ? 'text-red-700'
                        : forecastRes.forecast.stockoutRisk === 'moderate'
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }`}
                  >
                    {forecastRes.forecast.stockoutRisk}
                  </strong>
                </p>
              </div>

              <div className="border border-slate-200 rounded-lg p-4">
                <p className="text-xs text-slate-500">Advisory Reorder Estimate</p>
                <p className="font-display text-2xl font-bold text-blue-700 mt-1 tabular-nums">
                  {forecastRes.forecast.advisoryReorderQuantity} units
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Manual pharmacist PO approval required
                </p>
              </div>
            </div>

            {/* Holdout Evaluation Table */}
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold">
                    <th className="py-2.5 px-4">Candidate Model</th>
                    <th className="py-2.5 px-4 text-right">Holdout Window</th>
                    <th className="py-2.5 px-4 text-right">Holdout MAE</th>
                    <th className="py-2.5 px-4 text-right">Holdout RMSE</th>
                    <th className="py-2.5 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {forecastRes.forecast.evaluations.map((ev) => {
                    const isSelected = ev.model === forecastRes.forecast.selectedModel;
                    return (
                      <tr key={ev.model} className={isSelected ? 'bg-blue-50/50' : ''}>
                        <td className="py-2.5 px-4 font-medium text-slate-900">{ev.label}</td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {ev.holdoutDays} days
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">{ev.mae}</td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums">
                          {ev.rmse}
                        </td>
                        <td className="py-2.5 px-4 text-right font-semibold text-blue-800">
                          {isSelected ? 'Active Model' : 'Benchmark'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="text-xs text-slate-600 space-y-1">
              <p className="font-semibold text-slate-800">Model Assumptions:</p>
              <ul className="list-disc pl-5 space-y-0.5">
                {forecastRes.forecast.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
