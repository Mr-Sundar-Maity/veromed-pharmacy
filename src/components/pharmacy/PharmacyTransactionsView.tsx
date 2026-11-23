import React, { useEffect, useState } from 'react';
import { ArrowDownUp, Building2, Plus } from 'lucide-react';
import { apiFetch } from '../../types/api';
import type { TransactionType } from '../../lib/inventoryRules';

interface BatchSelectOption {
  batchId: string;
  itemName: string;
  batchNumber: string;
  expiryDate: string;
  expiryWindow: string;
  quantity: number;
}

interface TransactionRow {
  id: string;
  medicine_name: string;
  sku: string;
  batch_number: string;
  transaction_type: TransactionType;
  quantity: number;
  signed_delta: number;
  actor_name: string;
  reference_code: string | null;
  notes: string | null;
  created_at: string;
}

interface SupplierRow {
  id: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  lead_time_days: number;
  terms: string;
}

export const PharmacyTransactionsView: React.FC = () => {
  const [batches, setBatches] = useState<BatchSelectOption[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);

  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [txType, setTxType] = useState<TransactionType>('sale');
  const [qty, setQty] = useState(5);
  const [refCode, setRefCode] = useState('');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add Supplier state
  const [showSupForm, setShowSupForm] = useState(false);
  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supEmail, setSupEmail] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supLeadDays, setSupLeadDays] = useState(5);

  async function loadAll() {
    try {
      const [invRes, txRes, supRes] = await Promise.all([
        apiFetch<{
          items: Array<{
            medicine_name: string;
            batches: Array<{
              id: string;
              batch_number: string;
              expiry_date: string;
              expiryWindow: string;
              quantity: number;
            }>;
          }>;
        }>('/inventory/items'),
        apiFetch<{ transactions: TransactionRow[] }>('/inventory/transactions'),
        apiFetch<{ suppliers: SupplierRow[] }>('/suppliers'),
      ]);

      const flatBatches: BatchSelectOption[] = invRes.items.flatMap((item) =>
        item.batches.map((b) => ({
          batchId: b.id,
          itemName: item.medicine_name,
          batchNumber: b.batch_number,
          expiryDate: b.expiry_date,
          expiryWindow: b.expiryWindow,
          quantity: b.quantity,
        }))
      );
      setBatches(flatBatches);
      if (flatBatches[0] && !selectedBatchId) setSelectedBatchId(flatBatches[0].batchId);
      setTransactions(txRes.transactions);
      setSuppliers(supRes.suppliers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load stock ledger.');
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function handleRecordTransaction(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await apiFetch<{ newBatchQuantity: number }>('/inventory/transactions', {
        method: 'POST',
        body: JSON.stringify({
          batchId: selectedBatchId,
          transactionType: txType,
          quantity: Number(qty),
          referenceCode: refCode,
          notes,
        }),
      });
      setSuccess(`Transaction recorded atomically. New batch balance: ${res.newBatchQuantity} units.`);
      setRefCode('');
      setNotes('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Stock transaction rejected.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateSupplier(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/suppliers', {
        method: 'POST',
        body: JSON.stringify({
          name: supName,
          contactPerson: supContact,
          email: supEmail,
          phone: supPhone,
          leadTimeDays: Number(supLeadDays),
        }),
      });
      setShowSupForm(false);
      setSupName('');
      setSupContact('');
      setSupEmail('');
      setSupPhone('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add supplier.');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900">
          Stock Transactions Ledger &amp; Suppliers
        </h1>
        <p className="text-sm text-slate-600 mt-0.5">
          Concurrency-safe atomic stock ledger. Expired batches are automatically blocked from sale or dispensing.
        </p>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 font-medium">
          {error}
        </div>
      )}

      {success && (
        <div role="status" className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 font-medium">
          {success}
        </div>
      )}

      {/* Stock Movement Form */}
      <form
        onSubmit={handleRecordTransaction}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
      >
        <div className="flex items-center gap-2">
          <ArrowDownUp className="w-4 h-4 text-blue-700" />
          <h2 className="font-display text-base font-bold text-slate-900">
            Record Batch Stock Movement
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="sm:col-span-2">
            <label htmlFor="tx-batch" className="block text-xs font-medium text-slate-700 mb-1">
              Target Batch / Lot
            </label>
            <select
              id="tx-batch"
              value={selectedBatchId}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {batches.map((b) => (
                <option key={b.batchId} value={b.batchId}>
                  {b.itemName} · {b.batchNumber} ({b.quantity} qty · Exp {b.expiryDate}
                  {b.expiryWindow === 'expired' ? ' · EXPIRED' : ''})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="tx-type" className="block text-xs font-medium text-slate-700 mb-1">
              Transaction Type
            </label>
            <select
              id="tx-type"
              value={txType}
              onChange={(e) => setTxType(e.target.value as TransactionType)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              <option value="sale">Sale / Dispense (-)</option>
              <option value="stock_out">Stock-Out (-)</option>
              <option value="stock_in">Stock-In (+)</option>
              <option value="return">Customer Return (+)</option>
              <option value="wastage">Expired / Damaged Wastage (-)</option>
              <option value="transfer">Branch Transfer (-)</option>
              <option value="adjustment">Audit Adjustment (+/-)</option>
            </select>
          </div>

          <div>
            <label htmlFor="tx-qty" className="block text-xs font-medium text-slate-700 mb-1">
              Quantity
            </label>
            <input
              id="tx-qty"
              type="number"
              required
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label htmlFor="tx-ref" className="block text-xs font-medium text-slate-700 mb-1">
              Reference / Invoice #
            </label>
            <input
              id="tx-ref"
              type="text"
              value={refCode}
              onChange={(e) => setRefCode(e.target.value)}
              placeholder="POS-8821"
              className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="tx-notes" className="block text-xs font-medium text-slate-700 mb-1">
              Audit Notes
            </label>
            <input
              id="tx-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Verified prescription dispense"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto px-5 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'Committing...' : 'Commit Atomic Transaction'}
            </button>
          </div>
        </div>
      </form>

      {/* Immutable Ledger Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="font-display text-base font-bold text-slate-900">
            Recent Inventory Ledger Entries
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-semibold">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Item / Batch</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4 text-right">Delta</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {transactions.slice(0, 25).map((tx) => (
                <tr key={tx.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                    {tx.created_at.slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className="font-medium text-slate-900">{tx.medicine_name}</span>
                    <span className="ml-2 font-mono text-slate-500">{tx.batch_number}</span>
                  </td>
                  <td className="py-2.5 px-4 capitalize font-medium text-slate-700">
                    {tx.transaction_type.replace('_', ' ')}
                  </td>
                  <td
                    className={`py-2.5 px-4 text-right font-mono font-semibold tabular-nums ${
                      tx.signed_delta > 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {tx.signed_delta > 0 ? `+${tx.signed_delta}` : tx.signed_delta}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600">{tx.actor_name}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-500">{tx.reference_code || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Suppliers Directory */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-700" />
            <h2 className="font-display text-base font-bold text-slate-900">
              Approved Suppliers ({suppliers.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setShowSupForm((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Supplier</span>
          </button>
        </div>

        {showSupForm && (
          <form onSubmit={handleCreateSupplier} className="p-5 border-b border-slate-200 bg-slate-50 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <input
                type="text"
                required
                aria-label="Supplier name"
                value={supName}
                onChange={(e) => setSupName(e.target.value)}
                placeholder="Supplier Name"
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                required
                aria-label="Contact person"
                value={supContact}
                onChange={(e) => setSupContact(e.target.value)}
                placeholder="Contact Person"
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
              <input
                type="email"
                required
                aria-label="Supplier email"
                value={supEmail}
                onChange={(e) => setSupEmail(e.target.value)}
                placeholder="Email"
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                aria-label="Supplier phone"
                value={supPhone}
                onChange={(e) => setSupPhone(e.target.value)}
                placeholder="Phone"
                className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  aria-label="Lead time days"
                  value={supLeadDays}
                  onChange={(e) => setSupLeadDays(Number(e.target.value))}
                  className="w-16 px-2 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg"
                />
                <button
                  type="submit"
                  className="flex-1 px-3 py-2 text-xs font-semibold text-white bg-blue-700 rounded-lg cursor-pointer"
                >
                  Save
                </button>
              </div>
            </div>
          </form>
        )}

        <div className="divide-y divide-slate-100">
          {suppliers.map((s) => (
            <div key={s.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div>
                <p className="font-semibold text-sm text-slate-900">{s.name}</p>
                <p className="text-slate-600">
                  {s.contact_person} · {s.email} · {s.phone}
                </p>
              </div>
              <div className="text-slate-500 font-mono tabular-nums">
                Lead time: {s.lead_time_days}d · {s.terms}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
