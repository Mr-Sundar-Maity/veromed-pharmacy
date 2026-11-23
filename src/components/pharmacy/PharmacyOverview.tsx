import React, { useEffect, useState } from 'react';
import { AlertOctagon, AlertTriangle, ArrowRight, Building2, PackageCheck, TrendingUp } from 'lucide-react';
import { apiFetch } from '../../types/api';

interface PharmacyAnalyticsSummary {
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
}

interface PharmacyItemsSummary {
  pharmacy: { id: string; tenant_name: string; license_number: string; address: string } | null;
  items: Array<{
    id: string;
    medicine_name: string;
    sku: string;
    eligibleQuantity: number;
    expiredQuantity: number;
    min_threshold: number;
    isLowStock: boolean;
    batches: Array<{
      id: string;
      batch_number: string;
      expiry_date: string;
      quantity: number;
      expiryWindow: string;
      expiryLabel: string;
      daysRemaining: number;
    }>;
  }>;
}

interface PharmacyRefillRow {
  id: string;
  patient_name: string | null;
  medicine_name: string;
  strength: string;
  quantity_requested: number;
  status: string;
  notes: string | null;
  requested_at: string;
}

export const PharmacyOverview: React.FC<{ onNavigate: (tab: string) => void }> = ({
  onNavigate,
}) => {
  const [analytics, setAnalytics] = useState<PharmacyAnalyticsSummary | null>(null);
  const [inventory, setInventory] = useState<PharmacyItemsSummary | null>(null);
  const [refillRequests, setRefillRequests] = useState<PharmacyRefillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadOverview() {
    setLoading(true);
    try {
      const [an, inv, ref] = await Promise.all([
        apiFetch<PharmacyAnalyticsSummary>('/inventory/analytics'),
        apiFetch<PharmacyItemsSummary>('/inventory/items'),
        apiFetch<{ refillRequests: PharmacyRefillRow[] }>('/refill-requests'),
      ]);
      setAnalytics(an);
      setInventory(inv);
      setRefillRequests(ref.refillRequests);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load pharmacy overview.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  async function handleUpdateRefillStatus(id: string, status: string) {
    try {
      await apiFetch(`/refill-requests/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await loadOverview();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update refill status.');
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
        <div className="h-64 bg-white border border-slate-200 rounded-xl" />
      </div>
    );
  }

  if (error || !analytics || !inventory) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 text-sm text-red-800">
        {error || 'Pharmacy overview unavailable.'}
      </div>
    );
  }

  const lowStockItems = inventory.items.filter((i) => i.isLowStock);
  const urgentBatches = inventory.items
    .flatMap((item) =>
      item.batches
        .filter((b) => b.quantity > 0 && b.expiryWindow !== 'healthy')
        .map((b) => ({ ...b, medicineName: item.medicine_name }))
    )
    .sort((a, b) => a.daysRemaining - b.daysRemaining);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-blue-800 font-semibold">
            <Building2 className="w-4 h-4" />
            <span>
              {inventory.pharmacy?.tenant_name || 'Pharmacy Tenant'} · License{' '}
              <span className="font-mono">{inventory.pharmacy?.license_number}</span>
            </span>
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-900 mt-1">
            Pharmacy Operations Overview
          </h1>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onNavigate('pharma-transactions')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
          >
            <span>Record Stock Movement</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('pharma-analytics')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>ML Demand Forecast</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Eligible Dispensable Units</p>
          <p className="font-display text-3xl font-bold text-slate-900 mt-1 tabular-nums">
            {analytics.kpis.eligibleUnits}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            Excludes {analytics.kpis.expiredUnits} expired units
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Retail Inventory Valuation</p>
          <p className="font-display text-3xl font-bold text-slate-900 mt-1 tabular-nums">
            ₹{analytics.kpis.totalRetailValuation.toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            Cost basis: ₹{analytics.kpis.totalPurchaseValuation.toLocaleString()}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Expiring Within 30 Days</p>
          <p className="font-display text-3xl font-bold text-amber-700 mt-1 tabular-nums">
            {analytics.kpis.expiring30dUnits}
          </p>
          <p className="text-xs text-slate-500 mt-1">Units needing FEFO prioritization</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500">Low-Stock Threshold Alerts</p>
          <p className="font-display text-3xl font-bold text-red-700 mt-1 tabular-nums">
            {lowStockItems.length}
          </p>
          <p className="text-xs text-slate-500 mt-1">Items at or below reorder threshold</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Urgent Batch Expiry Monitor */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-slate-900">
              Batch Expiry Action Queue
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('pharma-inventory')}
              className="text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
            >
              View All Batches
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {urgentBatches.length === 0 ? (
              <p className="p-6 text-sm text-slate-500 flex items-center gap-2">
                <PackageCheck className="w-4 h-4 text-emerald-700" />
                <span>No batches currently within warning expiry windows.</span>
              </p>
            ) : (
              urgentBatches.map((b) => {
                const isExpired = b.expiryWindow === 'expired';
                return (
                  <div key={b.id} className="p-4 flex items-center justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      {isExpired ? (
                        <AlertOctagon className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-slate-900 truncate">
                          {b.medicineName}
                        </p>
                        <p className="text-xs text-slate-600 font-mono">
                          Lot {b.batch_number} · Exp {b.expiry_date} ·{' '}
                          <span className={isExpired ? 'text-red-700 font-semibold' : 'text-amber-700 font-semibold'}>
                            {isExpired ? 'BLOCKED (Expired)' : b.expiryLabel}
                          </span>
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums shrink-0">
                      {b.quantity} units
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Low Stock & Fast Movers */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="font-display text-base font-bold text-slate-900">
              Low-Stock &amp; Turnover Watch
            </h2>
          </div>
          <div className="divide-y divide-slate-100">
            {analytics.itemVelocity.slice(0, 6).map((v) => {
              const invMatch = inventory.items.find((i) => i.id === v.id);
                return (
                  <div key={v.id} className="p-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-slate-900 truncate">
                        {v.medicine_name}
                      </p>
                      <p className="text-xs text-slate-500 font-mono tabular-nums">
                        {v.sku} · 45d sold: {v.total_sold}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p
                        className={`font-mono text-sm font-semibold tabular-nums ${
                          invMatch?.isLowStock ? 'text-red-700' : 'text-slate-900'
                        }`}
                      >
                        {invMatch?.eligibleQuantity ?? 0} avail
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono tabular-nums">
                        Min {v.min_threshold}
                      </p>
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      </div>

      {/* Patient Prescription Refill Queue */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Patient Medication Refill Queue
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Refill requests routed to {inventory.pharmacy?.tenant_name || 'your pharmacy'}
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {refillRequests.filter((r) => ['requested', 'approved', 'ready'].includes(r.status)).length} active
          </span>
        </div>
        <div className="divide-y divide-slate-100">
          {refillRequests.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No patient refill requests received yet.</p>
          ) : (
            refillRequests.map((r) => (
              <div
                key={r.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-sm text-slate-900">
                    {r.medicine_name} {r.strength} ·{' '}
                    <span className="font-mono tabular-nums">{r.quantity_requested} units</span>
                  </p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Patient: {r.patient_name || 'Verified Patient'} · Status:{' '}
                    <span className="capitalize font-semibold text-blue-800">{r.status}</span>
                    {r.notes ? ` · "${r.notes}"` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {r.status === 'requested' && (
                    <button
                      type="button"
                      onClick={() => void handleUpdateRefillStatus(r.id, 'approved')}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Approve
                    </button>
                  )}
                  {r.status === 'approved' && (
                    <button
                      type="button"
                      onClick={() => void handleUpdateRefillStatus(r.id, 'ready')}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Mark Ready
                    </button>
                  )}
                  {r.status === 'ready' && (
                    <button
                      type="button"
                      onClick={() => void handleUpdateRefillStatus(r.id, 'completed')}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                    >
                      Mark Dispensed
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};
