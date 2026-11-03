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
