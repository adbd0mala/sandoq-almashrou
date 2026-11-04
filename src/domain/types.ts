export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'OTHER'

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'نقدي',
  BANK_TRANSFER: 'تحويل بنكي',
  CHEQUE: 'شيك',
  OTHER: 'أخرى',
}

export interface Funder {
  id: string
  name: string
  phone?: string
  notes?: string
  sharePercent: number // expense-allocation share, active funders must sum to 100
  targetContributionQirsh?: number // optional informational target
  active: boolean
  createdAt: string
}

export interface ExpenseCategory {
  id: string
  name: string
  description?: string
  budgetQirsh: number // 0 = no budget set
  active: boolean
  createdAt: string
}

/** ADVANCE = money paid out before it's known which بند it belongs to (e.g.
 * a down payment to a contractor while work is still ongoing). It leaves the
 * vault immediately like an EXPENSE, but has no categoryId; allocateAdvance
 * later recognizes portions of it against real بنود. */
export type LedgerEntryType = 'CONTRIBUTION' | 'EXPENSE' | 'ADVANCE'

export interface LedgerEntry {
  id: string
  type: LedgerEntryType
  date: string // ISO date (yyyy-mm-dd)
  amountQirsh: number // always positive
  description: string
  counterparty?: string // supplier/beneficiary for expenses
  paymentMethod?: PaymentMethod
  invoiceNumber?: string
  funderId?: string // CONTRIBUTION
  categoryId?: string // EXPENSE (including advance-allocation entries)
  createdAt: string
  reversed?: boolean // true once a REVERSAL has cancelled this entry
  reversalOfId?: string // set on the reversal entry itself
  /** false only on advance-allocation entries: the cash already left the
   * vault when the original ADVANCE was recorded, so these category-tagged
   * entries must NOT be subtracted from the vault balance again. Undefined
   * (all pre-existing entries, and every CONTRIBUTION/EXPENSE/ADVANCE
   * created directly) means true — it's a normal cash-moving entry. */
  affectsVault?: boolean
  /** Set on an advance-allocation entry: the id of the ADVANCE ledger entry
   * this recognizes a portion of against a category. */
  advanceOriginId?: string
}

export interface ExpenseAllocation {
  id: string
  ledgerEntryId: string
  funderId: string
  sharePercentApplied: number
  amountQirsh: number
}

export interface Settings {
  id: 'singleton'
  projectName: string
  allowOverdraft: boolean
  lastAutoBackupAt?: string
}

export interface BackupSnapshot {
  id: string
  createdAt: string
  kind: 'AUTO' | 'MANUAL'
  payload: string // JSON.stringify of the full export
  sizeBytes: number
}

/** A supplier invoice that wasn't fully paid up front. Created alongside the
 * partial-payment EXPENSE entry (originLedgerEntryId); "paid so far" and
 * "remaining" are always derived from that entry + its settlements' signed
 * amounts, never stored, so a reversal anywhere stays automatically correct. */
export interface Payable {
  id: string
  categoryId: string
  supplierName: string
  totalQirsh: number
  date: string
  description: string
  originLedgerEntryId: string
  createdAt: string
}

/** One further payment against an open Payable. The actual cash movement is
 * the linked EXPENSE ledger entry (ledgerEntryId) — this row just links that
 * entry back to the payable it's settling. */
export interface PayableSettlement {
  id: string
  payableId: string
  ledgerEntryId: string
  createdAt: string
}
