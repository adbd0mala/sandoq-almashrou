import { db, ensureSettings, newId } from '../db/db'
import type { ExpenseAllocation, ExpenseCategory, Funder, LedgerEntry, Settings } from '../domain/types'

const BACKUP_FORMAT_VERSION = 1
const MAX_AUTO_SNAPSHOTS = 14

export interface BackupPayload {
  formatVersion: number
  exportedAt: string
  funders: Funder[]
  categories: ExpenseCategory[]
  ledger: LedgerEntry[]
  allocations: ExpenseAllocation[]
  settings: Settings
}

export async function buildBackupPayload(): Promise<BackupPayload> {
  const [funders, categories, ledger, allocations, settings] = await Promise.all([
    db.funders.toArray(),
    db.categories.toArray(),
    db.ledger.toArray(),
    db.allocations.toArray(),
    ensureSettings(),
  ])
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    funders,
    categories,
    ledger,
    allocations,
    settings,
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
  if (d.formatVersion !== BACKUP_FORMAT_VERSION) throw new BackupValidationError('إصدار ملف النسخة الاحتياطية غير متوافق')
  for (const key of ['funders', 'categories', 'ledger', 'allocations']) {
    if (!Array.isArray(d[key])) throw new BackupValidationError(`الملف تالف: الحقل "${key}" غير موجود`)
  }
  if (!d.settings || typeof d.settings !== 'object') throw new BackupValidationError('الملف تالف: إعدادات غير موجودة')
  return d as unknown as BackupPayload
}

/** Restores from a backup payload. Validates fully before touching the live database,
 * and performs the swap inside one Dexie transaction so a failure mid-way rolls back
 * and leaves the existing data untouched. */
export async function restoreFromPayload(raw: unknown): Promise<void> {
  const payload = validatePayload(raw)

  await db.transaction('rw', [db.funders, db.categories, db.ledger, db.allocations, db.settings], async () => {
    await Promise.all([
      db.funders.clear(),
      db.categories.clear(),
      db.ledger.clear(),
      db.allocations.clear(),
      db.settings.clear(),
    ])
    await Promise.all([
      db.funders.bulkAdd(payload.funders),
      db.categories.bulkAdd(payload.categories),
      db.ledger.bulkAdd(payload.ledger),
      db.allocations.bulkAdd(payload.allocations),
      db.settings.add(payload.settings),
    ])
  })
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

export async function runDailyAutoBackupIfDue(): Promise<void> {
  const settings = await ensureSettings()
  const today = new Date().toISOString().slice(0, 10)
  if (settings.lastAutoBackupAt === today) return
  await createSnapshotNow('AUTO')
  await db.settings.update('singleton', { lastAutoBackupAt: today })
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
