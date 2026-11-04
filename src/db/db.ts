import Dexie, { type Table } from 'dexie'
import type {
  BackupSnapshot,
  ExpenseAllocation,
  ExpenseCategory,
  Funder,
  LedgerEntry,
  Payable,
  PayableSettlement,
  Settings,
} from '../domain/types'

export class AppDatabase extends Dexie {
  funders!: Table<Funder, string>
  categories!: Table<ExpenseCategory, string>
  ledger!: Table<LedgerEntry, string>
  allocations!: Table<ExpenseAllocation, string>
  settings!: Table<Settings, string>
  backups!: Table<BackupSnapshot, string>
  payables!: Table<Payable, string>
  payableSettlements!: Table<PayableSettlement, string>

  constructor() {
    super('pfems-vault')
    this.version(1).stores({
      funders: 'id, active, name',
      categories: 'id, active, name',
      ledger: 'id, type, date, funderId, categoryId, createdAt, reversalOfId',
      allocations: 'id, ledgerEntryId, funderId',
      settings: 'id',
      backups: 'id, createdAt, kind',
    })
    // v2: supplier payables (partial payments — pay part now, owe the rest).
    // Existing tables/data are untouched; only new empty tables are added.
    this.version(2).stores({
      payables: 'id, categoryId, originLedgerEntryId, createdAt',
      payableSettlements: 'id, payableId, ledgerEntryId',
    })
  }
}

export const db = new AppDatabase()

export function newId(): string {
  return crypto.randomUUID()
}

export async function ensureSettings(): Promise<Settings> {
  const existing = await db.settings.get('singleton')
  if (existing) return existing
  const def: Settings = { id: 'singleton', projectName: 'صندوق المشروع', allowOverdraft: false }
  await db.settings.put(def)
  return def
}
