export type ExpiryWindow =
  | 'expired'
  | 'critical_7d'
  | 'warning_30d'
  | 'notice_60d'
  | 'notice_90d'
  | 'notice_180d'
  | 'healthy';

export type TransactionType =
  | 'stock_in'
  | 'stock_out'
  | 'sale'
  | 'adjustment'
  | 'transfer'
  | 'return'
  | 'wastage';

export interface BatchLike {
  id: string;
  batchNumber: string;
  expiryDate: string; // YYYY-MM-DD
  quantity: number;
}

export interface LedgerTransactionLike {
  transactionType: TransactionType;
  quantity: number; // positive magnitude for standard types, signed or positive for adjustment
}

export function daysUntilDate(targetDateStr: string, referenceDateStr: string): number {
  const target = Date.parse(`${targetDateStr}T00:00:00Z`);
  const ref = Date.parse(`${referenceDateStr}T00:00:00Z`);
  return Math.floor((target - ref) / (1000 * 60 * 60 * 24));
}

export function classifyExpiryWindow(
  expiryDate: string,
  referenceDate: string
): { window: ExpiryWindow; daysRemaining: number; label: string } {
  const days = daysUntilDate(expiryDate, referenceDate);

  if (days <= 0) {
    return { window: 'expired', daysRemaining: days, label: 'Expired' };
  }
  if (days <= 7) {
    return { window: 'critical_7d', daysRemaining: days, label: 'Expiring in <= 7 days' };
  }
  if (days <= 30) {
    return { window: 'warning_30d', daysRemaining: days, label: 'Expiring in <= 30 days' };
  }
  if (days <= 60) {
    return { window: 'notice_60d', daysRemaining: days, label: 'Expiring in <= 60 days' };
  }
  if (days <= 90) {
    return { window: 'notice_90d', daysRemaining: days, label: 'Expiring in <= 90 days' };
  }
  if (days <= 180) {
    return { window: 'notice_180d', daysRemaining: days, label: 'Expiring in <= 180 days' };
  }
  return { window: 'healthy', daysRemaining: days, label: 'Healthy (> 180 days)' };
}

export function isBatchEligibleForDispensing(
  batch: BatchLike,
  referenceDate: string
): { eligible: boolean; reason?: string } {
  const { window, daysRemaining } = classifyExpiryWindow(batch.expiryDate, referenceDate);
  if (window === 'expired') {
    return {
      eligible: false,
      reason: `Batch ${batch.batchNumber} expired on ${batch.expiryDate} (${Math.abs(daysRemaining)} day(s) ago) and is blocked from sale/dispensing.`,
    };
  }
  if (batch.quantity <= 0) {
    return {
      eligible: false,
      reason: `Batch ${batch.batchNumber} has zero remaining stock.`,
    };
  }
  return { eligible: true };
}

export function computeTransactionDelta(
  txType: TransactionType,
  quantity: number
): number {
  if (!Number.isFinite(quantity) || quantity === 0) {
    throw new Error('Transaction quantity must be a non-zero finite number.');
  }

  if (txType !== 'adjustment' && quantity < 0) {
    throw new Error(`Quantity for ${txType} must be positive.`);
  }

  switch (txType) {
    case 'stock_in':
    case 'return':
      return Math.abs(quantity);
    case 'stock_out':
    case 'sale':
    case 'transfer':
    case 'wastage':
      return -Math.abs(quantity);
    case 'adjustment':
      return quantity;
  }
}

export function validateAndApplyStockTransaction(
  batch: BatchLike,
  txType: TransactionType,
  quantity: number,
  referenceDate: string
): { nextQuantity: number; delta: number } {
  if (txType === 'sale' || txType === 'stock_out' || txType === 'transfer') {
    const eligibility = isBatchEligibleForDispensing(batch, referenceDate);
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason);
    }
  }

  const delta = computeTransactionDelta(txType, quantity);
  const nextQuantity = batch.quantity + delta;

  if (nextQuantity < 0) {
    throw new Error(
      `Insufficient stock in batch ${batch.batchNumber}. Available: ${batch.quantity}, requested deduction: ${Math.abs(delta)}.`
    );
  }

  return { nextQuantity, delta };
}

export function reconcileLedgerQuantity(transactions: LedgerTransactionLike[]): number {
  return transactions.reduce(
    (sum, tx) => sum + computeTransactionDelta(tx.transactionType, tx.quantity),
    0
  );
}

export function isLowStock(totalQuantity: number, minThreshold: number): boolean {
  return totalQuantity <= minThreshold;
}
