import React, { useEffect, useState } from 'react';
import { AlertOctagon, Plus, Search } from 'lucide-react';
import { apiFetch } from '../../types/api';

interface BatchRow {
  id: string;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  purchase_price: number;
  supplier_name: string | null;
  expiryWindow: string;
  expiryLabel: string;
  daysRemaining: number;
  dispensable: boolean;
}

interface InventoryItemRow {
  id: string;
  sku: string;
  medicine_name: string;
  category: string;
  unit: string;
  min_threshold: number;
  unit_sell_price: number;
  location_bin: string;
  totalQuantity: number;
  eligibleQuantity: number;
  expiredQuantity: number;
  isLowStock: boolean;
  batches: BatchRow[];
}

interface SupplierOption {
  id: string;
  name: string;
}

export const PharmacyInventoryView: React.FC = () => {
  const [items, setItems] = useState<InventoryItemRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [filter, setFilter] = useState<'all' | 'expired' | '30d' | '90d' | 'low_stock'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add New Catalogue Item Form
  const [showAddItem, setShowAddItem] = useState(false);
  const [sku, setSku] = useState('');
  const [medName, setMedName] = useState('');
  const [category, setCategory] = useState('Cardiovascular');
  const [unit, setUnit] = useState('strips (10 tabs)');
  const [threshold, setThreshold] = useState(30);
  const [sellPrice, setSellPrice] = useState(80);
  const [bin, setBin] = useState('Rack A-05');

  // Receive Batch Form
  const [showAddBatch, setShowAddBatch] = useState(false);
  const [batchItemId, setBatchItemId] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [batchExpiry, setBatchExpiry] = useState('2027-09-30');
  const [batchQty, setBatchQty] = useState(50);
  const [batchSupplierId, setBatchSupplierId] = useState('');
  const [batchCost, setBatchCost] = useState(52);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [invRes, supRes] = await Promise.all([
        apiFetch<{ items: InventoryItemRow[] }>('/inventory/items'),
        apiFetch<{ suppliers: SupplierOption[] }>('/suppliers'),
      ]);
      setItems(invRes.items);
      setSuppliers(supRes.suppliers);
      if (invRes.items[0] && !batchItemId) setBatchItemId(invRes.items[0].id);
      if (supRes.suppliers[0] && !batchSupplierId) setBatchSupplierId(supRes.suppliers[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load pharmacy inventory.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleCreateItem(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/inventory/items', {
        method: 'POST',
        body: JSON.stringify({
          sku,
          medicineName: medName,
          category,
          unit,
          minThreshold: threshold,
          unitSellPrice: sellPrice,
          locationBin: bin,
        }),
      });
      setShowAddItem(false);
      setSku('');
      setMedName('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create inventory item.');
    }
  }

  async function handleReceiveBatch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/inventory/batches', {
        method: 'POST',
        body: JSON.stringify({
          itemId: batchItemId,
          batchNumber,
          expiryDate: batchExpiry,
          quantity: Number(batchQty),
          supplierId: batchSupplierId || undefined,
          purchasePrice: Number(batchCost),
        }),
      });
      setShowAddBatch(false);
      setBatchNumber('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to receive batch.');
    }
  }

  const filteredItems = items.filter((item) => {
    const q = search.trim().toLowerCase();
    if (
      q &&
      !item.medicine_name.toLowerCase().includes(q) &&
      !item.sku.toLowerCase().includes(q) &&
      !item.batches.some((b) => b.batch_number.toLowerCase().includes(q))
    ) {
      return false;
    }

    if (filter === 'low_stock') return item.isLowStock;
    if (filter === 'expired') return item.batches.some((b) => b.expiryWindow === 'expired' && b.quantity > 0);
    if (filter === '30d') {
      return item.batches.some(
        (b) => (b.expiryWindow === 'critical_7d' || b.expiryWindow === 'warning_30d') && b.quantity > 0
      );
    }
    if (filter === '90d') {
      return item.batches.some(
        (b) =>
          ['critical_7d', 'warning_30d', 'notice_60d', 'notice_90d'].includes(b.expiryWindow) &&
          b.quantity > 0
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Batch Inventory &amp; Expiry Monitoring
          </h1>
          <p className="text-sm text-slate-600 mt-0.5">
            Lot-level stock tracking across 180 / 90 / 60 / 30 / 7-day expiry windows
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setShowAddItem((v) => !v);
              setShowAddBatch(false);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Medicine SKU</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAddBatch((v) => !v);
              setShowAddItem(false);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Receive New Batch</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {showAddItem && (
        <form onSubmit={handleCreateItem} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-900">Add Inventory SKU</h2>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label htmlFor="inv-sku" className="block text-xs font-medium text-slate-700 mb-1">
                SKU Code
              </label>
              <input
                id="inv-sku"
                type="text"
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="SKU-AML-5"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="inv-name" className="block text-xs font-medium text-slate-700 mb-1">
                Medicine Name &amp; Strength
              </label>
              <input
                id="inv-name"
                type="text"
                required
                value={medName}
                onChange={(e) => setMedName(e.target.value)}
                placeholder="Amlodipine 5 mg (Norvasc)"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="inv-cat" className="block text-xs font-medium text-slate-700 mb-1">
                Category
              </label>
              <input
                id="inv-cat"
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label htmlFor="inv-unit" className="block text-xs font-medium text-slate-700 mb-1">
                Unit
              </label>
              <input
                id="inv-unit"
                type="text"
                required
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="inv-thresh" className="block text-xs font-medium text-slate-700 mb-1">
                Min Stock Threshold
              </label>
              <input
                id="inv-thresh"
                type="number"
                min={0}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="inv-price" className="block text-xs font-medium text-slate-700 mb-1">
                Sell Price (₹)
              </label>
              <input
                id="inv-price"
                type="number"
                min={0}
                value={sellPrice}
                onChange={(e) => setSellPrice(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="inv-bin" className="block text-xs font-medium text-slate-700 mb-1">
                Location Bin
              </label>
              <input
                id="inv-bin"
                type="text"
                value={bin}
                onChange={(e) => setBin(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddItem(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg cursor-pointer"
            >
              Save SKU
            </button>
          </div>
        </form>
      )}

      {showAddBatch && (
        <form onSubmit={handleReceiveBatch} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <h2 className="font-display text-base font-bold text-slate-900">Receive New Stock Batch</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="b-item" className="block text-xs font-medium text-slate-700 mb-1">
                Inventory Item
              </label>
              <select
                id="b-item"
                value={batchItemId}
                onChange={(e) => setBatchItemId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.medicine_name} ({i.sku})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="b-num" className="block text-xs font-medium text-slate-700 mb-1">
                Batch / Lot Number
              </label>
              <input
                id="b-num"
                type="text"
                required
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="LOT-2026-X1"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="b-exp" className="block text-xs font-medium text-slate-700 mb-1">
                Expiry Date
              </label>
              <input
                id="b-exp"
                type="date"
                required
                value={batchExpiry}
                onChange={(e) => setBatchExpiry(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="b-qty" className="block text-xs font-medium text-slate-700 mb-1">
                Quantity Received
              </label>
              <input
                id="b-qty"
                type="number"
                min={1}
                required
                value={batchQty}
                onChange={(e) => setBatchQty(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="b-sup" className="block text-xs font-medium text-slate-700 mb-1">
                Supplier
              </label>
              <select
                id="b-sup"
                value={batchSupplierId}
                onChange={(e) => setBatchSupplierId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="b-cost" className="block text-xs font-medium text-slate-700 mb-1">
                Purchase Cost / Unit (₹)
              </label>
              <input
                id="b-cost"
                type="number"
                min={0}
                step="0.01"
                value={batchCost}
                onChange={(e) => setBatchCost(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAddBatch(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg cursor-pointer"
            >
              Commit Batch Intake
            </button>
          </div>
        </form>
      )}

      {/* Search & Expiry Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Search medicine, SKU, or batch lot number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search medicine, SKU, or batch lot number..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 rounded-lg self-start">
          {[
            { id: 'all', label: 'All Items' },
            { id: 'expired', label: 'Expired' },
            { id: '30d', label: '<= 30 Days' },
            { id: '90d', label: '<= 90 Days' },
            { id: 'low_stock', label: 'Low Stock' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id as typeof filter)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer ${
                filter === f.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-48 bg-white border border-slate-200 rounded-xl animate-pulse" />
      ) : (
        <div className="space-y-4">
          {filteredItems.map((item) => (
            <div key={item.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50/60">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-mono font-semibold text-slate-700">{item.sku}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.category}</span>
                    <span aria-hidden="true">·</span>
                    <span>Bin: {item.location_bin}</span>
                  </div>
                  <h2 className="font-display text-base font-bold text-slate-900 mt-0.5">
                    {item.medicine_name}
                  </h2>
                </div>

                <div className="flex items-center gap-4 text-xs tabular-nums">
                  <div>
                    <span className="text-slate-500">Eligible Stock: </span>
                    <strong className={`font-mono ${item.isLowStock ? 'text-red-700' : 'text-slate-900'}`}>
                      {item.eligibleQuantity} {item.unit}
                    </strong>
                  </div>
                  <span className="text-slate-300">|</span>
                  <span className="text-slate-500 font-mono">Threshold: {item.min_threshold}</span>
                  {item.isLowStock && (
                    <span className="font-semibold text-red-700">LOW STOCK</span>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 text-slate-500 font-semibold">
                      <th className="py-2.5 px-5">Batch / Lot #</th>
                      <th className="py-2.5 px-4">Expiry Date</th>
                      <th className="py-2.5 px-4">Expiry Status</th>
                      <th className="py-2.5 px-4">Supplier</th>
                      <th className="py-2.5 px-4 text-right">Qty On Hand</th>
                      <th className="py-2.5 px-5 text-right">Dispensing Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {item.batches.map((b) => {
                      const isExpired = b.expiryWindow === 'expired';
                      return (
                        <tr key={b.id} className={isExpired ? 'bg-red-50/40' : ''}>
                          <td className="py-2.5 px-5 font-mono font-semibold text-slate-800">
                            {b.batch_number}
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums text-slate-700">
                            {b.expiry_date}
                          </td>
                          <td className="py-2.5 px-4">
                            <span
                              className={`font-semibold ${
                                isExpired
                                  ? 'text-red-700'
                                  : b.expiryWindow === 'healthy'
                                  ? 'text-emerald-700'
                                  : 'text-amber-700'
                              }`}
                            >
                              {b.expiryLabel} ({b.daysRemaining}d)
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-600">{b.supplier_name || '—'}</td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold tabular-nums text-slate-900">
                            {b.quantity}
                          </td>
                          <td className="py-2.5 px-5 text-right">
                            {isExpired ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                                <AlertOctagon className="w-3.5 h-3.5" />
                                Blocked (Expired)
                              </span>
                            ) : b.quantity > 0 ? (
                              <span className="font-semibold text-emerald-700">Eligible</span>
                            ) : (
                              <span className="text-slate-400">Depleted</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
