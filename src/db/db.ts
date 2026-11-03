import Dexie, { type Table } from 'dexie'
import type {
  BackupSnapshot,
  ExpenseAllocation,
  ExpenseCategory,
  Funder,
  LedgerEntry,
  Settings,
} from '../domain/types'

export class AppDatabase extends Dexie {
  funders!: Table<Funder, string>
  categories!: Table<ExpenseCategory, string>
  ledger!: Table<LedgerEntry, string>
  allocations!: Table<ExpenseAllocation, string>
  settings!: Table<Settings, string>
  backups!: Table<BackupSnapshot, string>

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
