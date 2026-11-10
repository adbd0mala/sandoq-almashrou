import { db, ensureSettings, newId } from '../db/db'
import type {
  AdvanceShare,
  ExpenseAllocation,
  ExpenseCategory,
  Funder,
  LedgerEntry,
  Payable,
  PayableSettlement,
  Settings,
} from '../domain/types'

const BACKUP_FORMAT_VERSION = 3
const MAX_AUTO_SNAPSHOTS = 14

export interface BackupPayload {
  formatVersion: number
  exportedAt: string
  funders: Funder[]
  categories: ExpenseCategory[]
  ledger: LedgerEntry[]
  allocations: ExpenseAllocation[]
  settings: Settings
  payables: Payable[]
  payableSettlements: PayableSettlement[]
  advanceShares: AdvanceShare[]
}

export async function buildBackupPayload(): Promise<BackupPayload> {
  const [funders, categories, ledger, allocations, settings, payables, payableSettlements, advanceShares] = await Promise.all([
    db.funders.toArray(),
    db.categories.toArray(),
    db.ledger.toArray(),
    db.allocations.toArray(),
    ensureSettings(),
    db.payables.toArray(),
    db.payableSettlements.toArray(),
    db.advanceShares.toArray(),
  ])
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    funders,
    categories,
    ledger,
    allocations,
    settings,
    payables,
    payableSettlements,
    advanceShares,
  }
}

export function downloadBackupFile(payload: BackupPayload): void {
  const json = JSON.stringify(payload, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = payload.exportedAt.slice(0, 19).replace(/[:T]/g, '-')
  a.href = url
  a.download = `backup-sandoq-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export class BackupValidationError extends Error {}

function validatePayload(data: unknown): BackupPayload {
  if (!data || typeof data !== 'object') throw new BackupValidationError('ملف النسخة الاحتياطية غير صالح')
  const d = data as Record<string, unknown>
  // Older backups stay restorable: version 1 predates supplier payables and
  // version 2 predates item shares — they simply have no rows for those.
  if (typeof d.formatVersion !== 'number' || d.formatVersion < 1 || d.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupValidationError('إصدار ملف النسخة الاحتياطية غير متوافق')
  }
  for (const key of ['funders', 'categories', 'ledger', 'allocations']) {
    if (!Array.isArray(d[key])) throw new BackupValidationError(`الملف تالف: الحقل "${key}" غير موجود`)
  }
  if (!d.settings || typeof d.settings !== 'object') throw new BackupValidationError('الملف تالف: إعدادات غير موجودة')
  if (d.payables !== undefined && !Array.isArray(d.payables)) throw new BackupValidationError('الملف تالف: حقل المستحقات غير صالح')
  if (d.payableSettlements !== undefined && !Array.isArray(d.payableSettlements)) {
    throw new BackupValidationError('الملف تالف: حقل سدادات المستحقات غير صالح')
  }
  if (d.advanceShares !== undefined && !Array.isArray(d.advanceShares)) {
    throw new BackupValidationError('الملف تالف: حقل توزيع الأصناف غير صالح')
  }
  return {
    ...(d as unknown as BackupPayload),
    payables: (d.payables as Payable[] | undefined) ?? [],
    payableSettlements: (d.payableSettlements as PayableSettlement[] | undefined) ?? [],
    advanceShares: (d.advanceShares as AdvanceShare[] | undefined) ?? [],
  }
}

/** Restores from a backup payload. Validates fully before touching the live database,
 * and performs the swap inside one Dexie transaction so a failure mid-way rolls back
 * and leaves the existing data untouched. */
export async function restoreFromPayload(raw: unknown): Promise<void> {
  const payload = validatePayload(raw)

  await db.transaction(
    'rw',
    [db.funders, db.categories, db.ledger, db.allocations, db.settings, db.payables, db.payableSettlements, db.advanceShares],
    async () => {
      await Promise.all([
        db.funders.clear(),
        db.categories.clear(),
        db.ledger.clear(),
        db.allocations.clear(),
        db.settings.clear(),
        db.payables.clear(),
        db.payableSettlements.clear(),
        db.advanceShares.clear(),
      ])
      await Promise.all([
        db.funders.bulkAdd(payload.funders),
        db.categories.bulkAdd(payload.categories),
        db.ledger.bulkAdd(payload.ledger),
        db.allocations.bulkAdd(payload.allocations),
        db.settings.add(payload.settings),
        payload.payables.length ? db.payables.bulkAdd(payload.payables) : Promise.resolve(),
        payload.payableSettlements.length ? db.payableSettlements.bulkAdd(payload.payableSettlements) : Promise.resolve(),
        payload.advanceShares.length ? db.advanceShares.bulkAdd(payload.advanceShares) : Promise.resolve(),
      ])
    },
  )
}

export async function readBackupFile(file: File): Promise<unknown> {
  const text = await file.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new BackupValidationError('الملف ليس JSON صالح')
  }
}

// --- Automatic periodic snapshots kept inside the same local database -----

export async function createSnapshotNow(kind: 'AUTO' | 'MANUAL'): Promise<void> {
  const payload = await buildBackupPayload()
  const json = JSON.stringify(payload)
  await db.backups.add({
    id: newId(),
    createdAt: new Date().toISOString(),
    kind,
    payload: json,
    sizeBytes: new Blob([json]).size,
  })
  if (kind === 'AUTO') {
    const autos = await db.backups.where('kind').equals('AUTO').sortBy('createdAt')
    const excess = autos.length - MAX_AUTO_SNAPSHOTS
    if (excess > 0) {
      await db.backups.bulkDelete(autos.slice(0, excess).map((b) => b.id))
    }
  }
}

const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Takes a fresh AUTO snapshot once at least 24h have passed since the last
 * one — a rolling window, not "once per calendar day". The old calendar-day
 * check took exactly one snapshot at the app's first open of the day and
 * then never again, so it kept capturing whatever (often near-empty) state
 * existed at that moment even after hours of real work. Call this on every
 * app open AND periodically while the app stays open (see App.tsx) so a
 * long-running session still gets a snapshot of its current data roughly
 * once a day. Wrapped in one transaction so two near-simultaneous calls
 * (e.g. two tabs) can't both pass the check and double-snapshot.
 */
export async function runDailyAutoBackupIfDue(): Promise<void> {
  await db.transaction(
    'rw',
    [db.settings, db.backups, db.funders, db.categories, db.ledger, db.allocations, db.payables, db.payableSettlements, db.advanceShares],
    async () => {
      const settings = await ensureSettings()
      const lastMs = settings.lastAutoBackupAt ? new Date(settings.lastAutoBackupAt).getTime() : 0
      if (Date.now() - lastMs < AUTO_BACKUP_INTERVAL_MS) return
      await createSnapshotNow('AUTO')
      await db.settings.update('singleton', { lastAutoBackupAt: new Date().toISOString() })
    },
  )
}

export async function listSnapshots() {
  return db.backups.orderBy('createdAt').reverse().toArray()
}

export async function restoreFromSnapshotId(id: string): Promise<void> {
  const snap = await db.backups.get(id)
  if (!snap) throw new BackupValidationError('النسخة غير موجودة')
  await restoreFromPayload(JSON.parse(snap.payload))
}

export async function deleteSnapshot(id: string): Promise<void> {
  await db.backups.delete(id)
}
