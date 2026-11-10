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

/** ADVANCE = money paid out before it's known which بند it belongs to (a
 * material bought for several بنود, or a down payment while work is still
 * ongoing). It leaves the vault immediately like an EXPENSE, but has no
 * categoryId; its cost reaches real بنود later, either through AdvanceShare
 * rows (by units / percent) or allocateAdvance entries (fixed amounts). */
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
  /** Set on a follow-up payment for an item bought earlier (deposit first,
   * rest later): the id of the item's first ADVANCE entry. Copied onto the
   * payment's reversal too, so one indexed lookup nets them out. */
  advanceParentId?: string
  /** Only on an item's first ADVANCE entry: how many units were bought
   * (4 نقلة, 60 شيكارة). When set, the item is distributed to بنود by
   * units; when absent it's distributed by percent or by fixed amounts. */
  quantity?: number
  unitName?: string
  /** Only on an item's first ADVANCE entry, and only when the full price is
   * known (it often isn't at deposit time, and can be filled in later):
   * what the item costs in total. Not money that moved — just what lets
   * "still owed to the supplier" be shown as this minus what's been paid. */
  agreedTotalQirsh?: number
  /** When the entry's wording (description, date, supplier, payment method,
   * invoice number) was last corrected. Its amount, بند and funder can never
   * be edited — only reversed — so this never marks a change in money. */
  editedAt?: string
}

/** One بند's share of an item (an ADVANCE and its follow-up payments),
 * expressed in the item's units — or in percent points (basis 100) when the
 * item has no quantity. The money is never stored: it is always derived as
 * (what's been paid for the item so far) × units ÷ basis, so paying the rest
 * of the price later, or cancelling a payment, re-prices every share by
 * itself with nothing to redo. */
export interface AdvanceShare {
  id: string
  advanceId: string
  categoryId: string
  units: number
  note?: string
  date: string
  createdAt: string
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
