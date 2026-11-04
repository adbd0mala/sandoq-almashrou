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

export type LedgerEntryType = 'CONTRIBUTION' | 'EXPENSE'

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
  categoryId?: string // EXPENSE
  createdAt: string
  reversed?: boolean // true once a REVERSAL has cancelled this entry
  reversalOfId?: string // set on the reversal entry itself
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
