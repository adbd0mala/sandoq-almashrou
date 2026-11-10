import { db, ensureSettings, newId } from '../db/db'
import type { AdvanceShare, ExpenseCategory, Funder, LedgerEntry, Payable, PaymentMethod } from './types'
import { formatEGP, formatUnits, splitProportionally } from './money'

export class LedgerError extends Error {}

const SHARE_TOLERANCE = 0.01

// ---------------------------------------------------------------------------
// Funders & shares
// ---------------------------------------------------------------------------

/** Oldest first. Ids are random, so the table's own order would look shuffled. */
export async function listFunders(): Promise<Funder[]> {
  return (await db.funders.toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function listActiveFunders(): Promise<Funder[]> {
  return (await listFunders()).filter((f) => f.active)
}

/**
 * Evenly splits 100% across the given funder ids. Deliberately NOT rounded to
 * 2 decimals: for counts that don't divide evenly into 100 (e.g. 3 funders),
 * a 2-decimal percent (33.33/33.33/33.34) makes expense allocation land on
 * 9,999.00/9,999.00/10,002.00 instead of the expected 10,000 each. Keeping
 * full float precision (100/n sums back to ~100 within 1e-9) lets
 * splitProportionally's largest-remainder step land on the exact equal split.
 */
export function equalShares(funderIds: string[]): Map<string, number> {
  const n = funderIds.length
  const map = new Map<string, number>()
  if (n === 0) return map
  const percent = 100 / n
  for (const id of funderIds) map.set(id, percent)
  return map
}

export async function addFunder(input: {
  name: string
  phone?: string
  notes?: string
  targetContributionQirsh?: number
}): Promise<Funder> {
  if (!input.name.trim()) throw new LedgerError('اسم الممول مطلوب')
  const funder: Funder = {
    id: newId(),
    name: input.name.trim(),
    phone: input.phone?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    targetContributionQirsh: input.targetContributionQirsh,
    sharePercent: 0,
    active: true,
    createdAt: new Date().toISOString(),
  }
  await db.transaction('rw', db.funders, async () => {
    await db.funders.add(funder)
    const active = await listActiveFunders()
    const shares = equalShares(active.map((f) => f.id))
    await Promise.all(active.map((f) => db.funders.update(f.id, { sharePercent: shares.get(f.id) ?? 0 })))
  })
  return funder
}

/** Set custom shares. Must cover exactly the active funders and sum to 100.00 (+-0.01) */
export async function setCustomShares(entries: { funderId: string; percent: number }[]): Promise<void> {
  const active = await listActiveFunders()
  const activeIds = new Set(active.map((f) => f.id))
  const givenIds = new Set(entries.map((e) => e.funderId))

  if (entries.length !== active.length || [...activeIds].some((id) => !givenIds.has(id))) {
    throw new LedgerError('يجب تحديد نسبة لكل الممولين النشطين فقط، بدون تكرار أو نقص')
  }
  if (entries.some((e) => e.percent < 0)) {
    throw new LedgerError('لا يمكن أن تكون النسبة بالسالب')
  }
  const sum = entries.reduce((s, e) => s + e.percent, 0)
  if (Math.abs(sum - 100) > SHARE_TOLERANCE) {
    throw new LedgerError(`مجموع النسب يجب أن يساوي 100% (الحالي: ${sum.toFixed(2)}%)`)
  }
  await db.transaction('rw', db.funders, async () => {
    await Promise.all(entries.map((e) => db.funders.update(e.funderId, { sharePercent: e.percent })))
  })
}

export async function archiveFunder(funderId: string): Promise<void> {
  await db.transaction('rw', db.funders, async () => {
    await db.funders.update(funderId, { active: false, sharePercent: 0 })
    const active = await listActiveFunders()
    const shares = equalShares(active.map((f) => f.id))
    await Promise.all(active.map((f) => db.funders.update(f.id, { sharePercent: shares.get(f.id) ?? 0 })))
  })
}

/** Reactivates an archived funder and folds them back into the equal split
 * with the other active funders (same re-equalization archiveFunder does).
 * Their historical ledger entries were never touched by archiving, so
 * nothing needs restoring there. */
export async function unarchiveFunder(funderId: string): Promise<void> {
  await db.transaction('rw', db.funders, async () => {
    await db.funders.update(funderId, { active: true })
    const active = await listActiveFunders()
    const shares = equalShares(active.map((f) => f.id))
    await Promise.all(active.map((f) => db.funders.update(f.id, { sharePercent: shares.get(f.id) ?? 0 })))
  })
}

export async function updateFunderInfo(
  funderId: string,
  patch: { name?: string; phone?: string; notes?: string; targetContributionQirsh?: number },
): Promise<void> {
  if (patch.name !== undefined && !patch.name.trim()) throw new LedgerError('اسم الممول مطلوب')
  await db.funders.update(funderId, patch)
}

// ---------------------------------------------------------------------------
// Expense categories
// ---------------------------------------------------------------------------

/** Oldest first, for the same reason as listFunders. */
export async function listCategories(): Promise<ExpenseCategory[]> {
  return (await db.categories.toArray()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function addCategory(input: { name: string; description?: string; budgetQirsh?: number }): Promise<ExpenseCategory> {
  if (!input.name.trim()) throw new LedgerError('اسم البند مطلوب')
  const existing = await db.categories.toArray()
  if (existing.some((c) => c.name.trim() === input.name.trim())) {
    throw new LedgerError('يوجد بند بنفس الاسم')
  }
  const category: ExpenseCategory = {
    id: newId(),
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    budgetQirsh: input.budgetQirsh ?? 0,
    active: true,
    createdAt: new Date().toISOString(),
  }
  await db.categories.add(category)
  return category
}

export async function updateCategory(
  id: string,
  patch: { name?: string; description?: string; budgetQirsh?: number },
): Promise<void> {
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new LedgerError('اسم البند مطلوب')
    const existing = await db.categories.toArray()
    if (existing.some((c) => c.id !== id && c.name.trim() === patch.name!.trim())) {
      throw new LedgerError('يوجد بند بنفس الاسم')
    }
  }
  await db.categories.update(id, patch)
}

export async function archiveCategory(id: string): Promise<void> {
  await db.categories.update(id, { active: false })
}

/** Puts an archived بند back in use. Its entries were never touched by
 * archiving, so there is nothing else to restore. */
export async function unarchiveCategory(id: string): Promise<void> {
  if (!(await db.categories.get(id))) throw new LedgerError('بند المصروف غير موجود')
  await db.categories.update(id, { active: true })
}

export async function deleteCategoryIfUnused(id: string): Promise<void> {
  const count =
    (await db.ledger.where('categoryId').equals(id).count()) + (await db.advanceShares.where('categoryId').equals(id).count())
  if (count > 0) throw new LedgerError('لا يمكن حذف بند له حركات مالية سابقة. يمكنك أرشفته فقط')
  await db.categories.delete(id)
}

// ---------------------------------------------------------------------------
// Vault balance (derived only — never stored)
// ---------------------------------------------------------------------------

export async function getVaultBalanceQirsh(): Promise<number> {
  const entries = await db.ledger.toArray()
  // Advance-allocation entries (affectsVault === false) recognize a category
  // cost for money that already left the vault when the ADVANCE itself was
  // recorded — counting them again here would double-subtract that cash.
  return entries.reduce((sum, e) => sum + (e.affectsVault === false ? 0 : signedAmount(e)), 0)
}

export function signedAmount(e: LedgerEntry): number {
  const base = e.type === 'CONTRIBUTION' ? e.amountQirsh : -e.amountQirsh
  // A reversal flips the sign of what its own type would normally contribute.
  return e.reversalOfId ? -base : base
}

// ---------------------------------------------------------------------------
// Recording money in / out
// ---------------------------------------------------------------------------

export interface RecordContributionInput {
  funderId: string
  amountQirsh: number
  date: string
  description: string
  paymentMethod?: PaymentMethod
  invoiceNumber?: string
}

export async function recordContribution(input: RecordContributionInput): Promise<LedgerEntry> {
  if (input.amountQirsh <= 0) throw new LedgerError('قيمة المساهمة يجب أن تكون أكبر من صفر')
  const funder = await db.funders.get(input.funderId)
  if (!funder || !funder.active) throw new LedgerError('الممول غير موجود أو غير نشط')

  const entry: LedgerEntry = {
    id: newId(),
    type: 'CONTRIBUTION',
    date: input.date,
    amountQirsh: input.amountQirsh,
    description: input.description.trim() || 'مساهمة',
    paymentMethod: input.paymentMethod,
    invoiceNumber: input.invoiceNumber?.trim() || undefined,
    funderId: input.funderId,
    createdAt: new Date().toISOString(),
  }
  await db.transaction('rw', db.ledger, async () => {
    await db.ledger.add(entry)
  })
  return entry
}

export interface RecordExpenseInput {
  categoryId: string
  amountQirsh: number
  date: string
  description: string
  counterparty?: string
  paymentMethod?: PaymentMethod
  invoiceNumber?: string
}

/** Splits amountQirsh across activeFunders by current share% and records one
 * ExpenseAllocation row per funder, so later "نصيب كل ممول من المصروفات"
 * reports reflect this cash leaving the vault. */
async function recordFunderAllocations(ledgerEntryId: string, amountQirsh: number, activeFunders: Funder[]): Promise<void> {
  const split = splitProportionally(
    amountQirsh,
    activeFunders.map((f) => ({ key: f.id, percent: f.sharePercent })),
  )
  for (const s of split) {
    const funder = activeFunders.find((f) => f.id === s.key)!
    await db.allocations.add({
      id: newId(),
      ledgerEntryId,
      funderId: s.key,
      sharePercentApplied: funder.sharePercent,
      amountQirsh: s.amountQirsh,
    })
  }
}

/** Checks a category exists, optionally rejecting an archived one. Archived
 * categories must still accept settlePayable (paying off a debt recognized
 * before archiving), just not brand-new spending. */
async function assertCategory(categoryId: string, requireActive: boolean): Promise<void> {
  const category = await db.categories.get(categoryId)
  if (!category) throw new LedgerError('بند المصروف غير موجود')
  if (requireActive && !category.active) throw new LedgerError('بند المصروف مؤرشف. فعّله أولاً من شاشة البنود')
}

/** Inserts one EXPENSE ledger entry + its per-funder allocation. Assumes it
 * already runs inside an open Dexie transaction covering ledger/allocations
 * — callers (recordExpense, recordSplitExpense) own the transaction and the
 * balance/shares checks, so a multi-line split stays atomic as one unit. */
async function insertExpenseEntry(
  input: RecordExpenseInput,
  activeFunders: Funder[],
  opts: { requireActiveCategory?: boolean } = {},
): Promise<LedgerEntry> {
  await assertCategory(input.categoryId, opts.requireActiveCategory ?? true)

  const entry: LedgerEntry = {
    id: newId(),
    type: 'EXPENSE',
    date: input.date,
    amountQirsh: input.amountQirsh,
    description: input.description.trim() || 'مصروف',
    counterparty: input.counterparty?.trim() || undefined,
    paymentMethod: input.paymentMethod,
    invoiceNumber: input.invoiceNumber?.trim() || undefined,
    categoryId: input.categoryId,
    createdAt: new Date().toISOString(),
  }
  await db.ledger.add(entry)
  await recordFunderAllocations(entry.id, input.amountQirsh, activeFunders)
  return entry
}

/** Shared pre-checks for posting expense money: funders configured with
 * valid shares, and enough balance (unless overdraft is allowed) for the
 * total amount about to leave the vault. */
async function checkCanSpend(totalQirsh: number): Promise<Funder[]> {
  const settings = await ensureSettings()
  const balance = await getVaultBalanceQirsh()
  if (!settings.allowOverdraft && totalQirsh > balance) {
    throw new LedgerError(
      `الرصيد غير كافٍ. الرصيد الحالي ${formatEGP(balance)} وقيمة المصروف ${formatEGP(totalQirsh)}`,
    )
  }

  const activeFunders = await listActiveFunders()
  if (activeFunders.length === 0) throw new LedgerError('لا يوجد ممولون نشطون لتوزيع المصروف عليهم')
  const shareSum = activeFunders.reduce((s, f) => s + f.sharePercent, 0)
  if (Math.abs(shareSum - 100) > SHARE_TOLERANCE) {
    throw new LedgerError(`نسب تحمل المصروفات الحالية غير مكتملة (الإجمالي ${shareSum.toFixed(2)}%). راجع شاشة الممولين`)
  }
  return activeFunders
}

export async function recordExpense(input: RecordExpenseInput): Promise<LedgerEntry> {
  if (input.amountQirsh <= 0) throw new LedgerError('قيمة المصروف يجب أن تكون أكبر من صفر')

  return db.transaction('rw', [db.ledger, db.categories, db.funders, db.allocations, db.settings], async () => {
    const activeFunders = await checkCanSpend(input.amountQirsh)
    return insertExpenseEntry(input, activeFunders)
  })
}

export interface RecordSplitExpenseInput {
  date: string
  description: string
  counterparty?: string
  paymentMethod?: PaymentMethod
  invoiceNumber?: string
  /** Each line becomes its own independent EXPENSE ledger entry (its own id,
   * reversible on its own), sharing the same date/supplier/invoice/payment
   * method. The vault/overdraft check runs once against the combined total,
   * so the whole split posts or fails together. */
  lines: { categoryId: string; amountQirsh: number; note?: string }[]
}

/** Records one payment split across several expense categories — e.g. 6
 * tons of cement bought in one purchase, 2 tons charged to each of three
 * بنود. Each line is inserted via insertExpenseEntry as its own ledger
 * entry, so later it can be individually reversed without touching the
 * other lines, while the balance/overdraft check covers the full amount. */
export async function recordSplitExpense(input: RecordSplitExpenseInput): Promise<LedgerEntry[]> {
  if (input.lines.length < 2) {
    throw new LedgerError('أدخل بندين على الأقل للتقسيم. لبند واحد استخدم تسجيل مصروف عادي')
  }
  if (input.lines.some((l) => l.amountQirsh <= 0)) {
    throw new LedgerError('قيمة كل بند في التقسيم يجب أن تكون أكبر من صفر')
  }
  const totalQirsh = input.lines.reduce((s, l) => s + l.amountQirsh, 0)
  const baseDescription = input.description.trim() || 'مصروف'

  return db.transaction('rw', [db.ledger, db.categories, db.funders, db.allocations, db.settings], async () => {
    const activeFunders = await checkCanSpend(totalQirsh)

    const entries: LedgerEntry[] = []
    for (const line of input.lines) {
      const entry = await insertExpenseEntry(
        {
          categoryId: line.categoryId,
          amountQirsh: line.amountQirsh,
          date: input.date,
          description: line.note?.trim() ? `${baseDescription} — ${line.note.trim()}` : baseDescription,
          counterparty: input.counterparty,
          paymentMethod: input.paymentMethod,
          invoiceNumber: input.invoiceNumber,
        },
        activeFunders,
      )
      entries.push(entry)
    }
    return entries
  })
}

// ---------------------------------------------------------------------------
// Supplier payables — buy for the full invoice amount, pay only part of it
// now, owe the rest. The vault is only ever debited for cash that actually
// left it; "paid so far" / "remaining" are derived from the ledger, never
// stored, so reversing any linked payment keeps the numbers correct.
// ---------------------------------------------------------------------------

export interface RecordExpenseWithPayableInput extends RecordExpenseInput {
  /** The full invoice/purchase amount. amountQirsh is only what's paid now;
   * the difference becomes an open Payable owed to `counterparty`. */
  totalQirsh: number
}

export async function recordExpenseWithPayable(input: RecordExpenseWithPayableInput): Promise<{ entry: LedgerEntry; payable: Payable | null }> {
  if (input.totalQirsh <= 0) throw new LedgerError('إجمالي قيمة الفاتورة يجب أن يكون أكبر من صفر')
  if (input.amountQirsh < 0) throw new LedgerError('قيمة المدفوع الآن لا يمكن أن تكون بالسالب')
  if (input.amountQirsh > input.totalQirsh) {
    throw new LedgerError('المبلغ المدفوع الآن لا يمكن أن يكون أكبر من إجمالي قيمة الفاتورة')
  }
  if (!input.counterparty?.trim()) throw new LedgerError('اسم المورد مطلوب لتسجيل فاتورة بدفعة جزئية')
  const supplierName = input.counterparty.trim()

  return db.transaction('rw', [db.ledger, db.categories, db.funders, db.allocations, db.settings, db.payables], async () => {
    const remainingQirsh = input.totalQirsh - input.amountQirsh

    // amountQirsh may be 0 (nothing paid yet, pure debt) — checkCanSpend/insertExpenseEntry
    // require a positive amount, so route that case through a zero-cash marker entry instead.
    const paidNowQirsh = input.amountQirsh > 0 ? input.amountQirsh : 0
    let entry: LedgerEntry
    if (paidNowQirsh > 0) {
      const activeFunders = await checkCanSpend(paidNowQirsh)
      entry = await insertExpenseEntry({ ...input, amountQirsh: paidNowQirsh }, activeFunders)
    } else {
      // Nothing paid yet: still record a zero-value EXPENSE entry so the
      // payable has an originLedgerEntryId to anchor to and the purchase
      // shows up in the category's history from day one.
      await checkCanSpend(0)
      await assertCategory(input.categoryId, true)
      entry = {
        id: newId(),
        type: 'EXPENSE',
        date: input.date,
        amountQirsh: 0,
        description: input.description.trim() || 'مصروف',
        counterparty: supplierName,
        paymentMethod: input.paymentMethod,
        invoiceNumber: input.invoiceNumber?.trim() || undefined,
        categoryId: input.categoryId,
        createdAt: new Date().toISOString(),
      }
      await db.ledger.add(entry)
    }

    if (remainingQirsh <= 0) return { entry, payable: null }

    const payable: Payable = {
      id: newId(),
      categoryId: input.categoryId,
      supplierName,
      totalQirsh: input.totalQirsh,
      date: input.date,
      description: input.description.trim() || 'مصروف',
      originLedgerEntryId: entry.id,
      createdAt: new Date().toISOString(),
    }
    await db.payables.add(payable)
    return { entry, payable }
  })
}

export interface PayableStatus {
  payable: Payable
  paidQirsh: number
  remainingQirsh: number
  settlementEntries: LedgerEntry[]
}

/** Sums an entry's cash effect together with any reversal of it, so a
 * reversed payment nets to exactly 0 instead of still counting as paid. */
async function paidEffect(entryId: string): Promise<number> {
  const entry = await db.ledger.get(entryId)
  if (!entry) return 0
  const reversal = await db.ledger.where('reversalOfId').equals(entryId).first()
  return -signedAmount(entry) + (reversal ? -signedAmount(reversal) : 0)
}

export async function getPayableStatus(payableId: string): Promise<PayableStatus> {
  const payable = await db.payables.get(payableId)
  if (!payable) throw new LedgerError('المستحق غير موجود')

  const settlements = await db.payableSettlements.where('payableId').equals(payableId).toArray()
  const settlementEntries = (
    await Promise.all(settlements.map((s) => db.ledger.get(s.ledgerEntryId)))
  ).filter((e): e is LedgerEntry => !!e)

  // paidQirsh must reflect reversals: if the origin payment or any
  // settlement was later cancelled, it must stop counting as paid.
  const ids = [payable.originLedgerEntryId, ...settlementEntries.map((e) => e.id)]
  const effects = await Promise.all(ids.map(paidEffect))
  const paidQirsh = effects.reduce((s, v) => s + v, 0)

  return { payable, paidQirsh, remainingQirsh: payable.totalQirsh - paidQirsh, settlementEntries }
}

export async function listOpenPayables(): Promise<PayableStatus[]> {
  const all = await db.payables.toArray()
  const statuses = await Promise.all(all.map((p) => getPayableStatus(p.id)))
  return statuses.filter((s) => s.remainingQirsh > 0).sort((a, b) => a.payable.date.localeCompare(b.payable.date))
}

export async function listAllPayables(): Promise<PayableStatus[]> {
  const all = await db.payables.toArray()
  const statuses = await Promise.all(all.map((p) => getPayableStatus(p.id)))
  return statuses.sort((a, b) => b.payable.createdAt.localeCompare(a.payable.createdAt))
}

/** How a payment against a payable is labelled. One place, so a corrected
 * supplier name or description can be carried onto payments already made. */
const settlementDescription = (supplierName: string, description: string) => `سداد مستحق مورد: ${supplierName} (${description})`

export interface SettlePayableInput {
  payableId: string
  amountQirsh: number
  date: string
  paymentMethod?: PaymentMethod
  invoiceNumber?: string
}

/** Pays some or all of what's still owed on a Payable. Reuses recordExpense
 * as-is (same balance check, same funder-share allocation, same category),
 * then links the new entry back to the payable as a settlement. */
export async function settlePayable(input: SettlePayableInput): Promise<LedgerEntry> {
  if (input.amountQirsh <= 0) throw new LedgerError('قيمة السداد يجب أن تكون أكبر من صفر')

  return db.transaction(
    'rw',
    [db.ledger, db.categories, db.funders, db.allocations, db.settings, db.payables, db.payableSettlements],
    async () => {
      const status = await getPayableStatus(input.payableId)
      if (input.amountQirsh > status.remainingQirsh) {
        throw new LedgerError(
          `قيمة السداد أكبر من المتبقي. المتبقي للمورد ${status.payable.supplierName} هو ${formatEGP(status.remainingQirsh)}`,
        )
      }

      const activeFunders = await checkCanSpend(input.amountQirsh)
      const entry = await insertExpenseEntry(
        {
          categoryId: status.payable.categoryId,
          amountQirsh: input.amountQirsh,
          date: input.date,
          description: settlementDescription(status.payable.supplierName, status.payable.description),
          counterparty: status.payable.supplierName,
          paymentMethod: input.paymentMethod,
          invoiceNumber: input.invoiceNumber,
        },
        activeFunders,
        { requireActiveCategory: false },
      )

      await db.payableSettlements.add({ id: newId(), payableId: input.payableId, ledgerEntryId: entry.id, createdAt: new Date().toISOString() })
      return entry
    },
  )
}

export interface RecordSplitExpenseWithPayableInput {
  date: string
  description: string
  /** Required — a payable needs someone to owe. */
  counterparty: string
  paymentMethod?: PaymentMethod
  invoiceNumber?: string
  /** Total cash paid now, across every line combined. Distributed across
   * lines proportional to each line's own totalQirsh (same largest-remainder
   * method used for funder allocation), so partly-paid cement split 3 ways
   * leaves each بند with its own fair share already paid and its own
   * independent payable for the rest. */
  paidNowQirsh: number
  /** Each line's totalQirsh is its full invoice share (not just what's paid). */
  lines: { categoryId: string; totalQirsh: number; note?: string }[]
}

/** Combines recordSplitExpense + recordExpenseWithPayable: one purchase,
 * split across several بنود, with only part of the combined total paid now.
 * Each line gets its own ledger entry for its paid portion and — if its
 * share isn't fully paid — its own independent Payable, so settling one
 * بند's remaining debt later doesn't touch the others. */
export async function recordSplitExpenseWithPayable(
  input: RecordSplitExpenseWithPayableInput,
): Promise<{ entries: LedgerEntry[]; payables: Payable[] }> {
  if (input.lines.length < 2) {
    throw new LedgerError('أدخل بندين على الأقل للتقسيم. لبند واحد استخدم تسجيل مصروف عادي')
  }
  if (input.lines.some((l) => l.totalQirsh <= 0)) {
    throw new LedgerError('قيمة كل بند في التقسيم يجب أن تكون أكبر من صفر')
  }
  if (!input.counterparty?.trim()) throw new LedgerError('اسم المورد مطلوب لتسجيل فاتورة بدفعة جزئية')
  const supplierName = input.counterparty.trim()

  const grandTotalQirsh = input.lines.reduce((s, l) => s + l.totalQirsh, 0)
  if (input.paidNowQirsh < 0) throw new LedgerError('قيمة المدفوع الآن لا يمكن أن تكون بالسالب')
  if (input.paidNowQirsh > grandTotalQirsh) {
    throw new LedgerError('المبلغ المدفوع الآن لا يمكن أن يكون أكبر من إجمالي قيمة الفاتورة')
  }

  const baseDescription = input.description.trim() || 'مصروف'

  return db.transaction('rw', [db.ledger, db.categories, db.funders, db.allocations, db.settings, db.payables], async () => {
    const activeFunders = await checkCanSpend(input.paidNowQirsh)

    const paidSplit = splitProportionally(
      input.paidNowQirsh,
      input.lines.map((l, idx) => ({ key: String(idx), percent: l.totalQirsh })),
    )

    const entries: LedgerEntry[] = []
    const payables: Payable[] = []

    for (let idx = 0; idx < input.lines.length; idx++) {
      const line = input.lines[idx]
      const paidForLine = paidSplit.find((s) => s.key === String(idx))!.amountQirsh
      const description = line.note?.trim() ? `${baseDescription} — ${line.note.trim()}` : baseDescription

      let entry: LedgerEntry
      if (paidForLine > 0) {
        entry = await insertExpenseEntry(
          {
            categoryId: line.categoryId,
            amountQirsh: paidForLine,
            date: input.date,
            description,
            counterparty: supplierName,
            paymentMethod: input.paymentMethod,
            invoiceNumber: input.invoiceNumber,
          },
          activeFunders,
        )
      } else {
        await assertCategory(line.categoryId, true)
        entry = {
          id: newId(),
          type: 'EXPENSE',
          date: input.date,
          amountQirsh: 0,
          description,
          counterparty: supplierName,
          paymentMethod: input.paymentMethod,
          invoiceNumber: input.invoiceNumber?.trim() || undefined,
          categoryId: line.categoryId,
          createdAt: new Date().toISOString(),
        }
        await db.ledger.add(entry)
      }
      entries.push(entry)

      const remainingForLine = line.totalQirsh - paidForLine
      if (remainingForLine > 0) {
        const payable: Payable = {
          id: newId(),
          categoryId: line.categoryId,
          supplierName,
          totalQirsh: line.totalQirsh,
          date: input.date,
          description,
          originLedgerEntryId: entry.id,
          createdAt: new Date().toISOString(),
        }
        await db.payables.add(payable)
        payables.push(payable)
      }
    }

    return { entries, payables }
  })
}

// ---------------------------------------------------------------------------
// Items / advances — money paid before it's known which بند it belongs to:
// a material bought for several بنود (4 نقلات رمل), or a down payment while
// work is still ongoing. Cash leaves the vault as each payment is recorded:
// the first one, then any follow-ups (the rest of the price after a deposit).
// The cost reaches real بنود later, one of two ways per item:
//   - shares (AdvanceShare), by units or percent. Derived, never stored, so
//     later payments and cancellations re-price every بند by themselves.
//   - fixed amounts (allocateAdvance): category-tagged entries with
//     affectsVault:false — "this much of the advance went to that بند".
// ---------------------------------------------------------------------------

export interface RecordAdvanceInput {
  amountQirsh: number
  date: string
  description: string
  counterparty?: string
  paymentMethod?: PaymentMethod
  invoiceNumber?: string
  /** How many units were bought. Set it to distribute the item by units later. */
  quantity?: number
  unitName?: string
  /** The item's full price, when known. amountQirsh is then a deposit against it. */
  agreedTotalQirsh?: number
}

export async function recordAdvance(input: RecordAdvanceInput): Promise<LedgerEntry> {
  if (input.amountQirsh <= 0) throw new LedgerError('قيمة الدفعة يجب أن تكون أكبر من صفر')
  if (input.quantity !== undefined && !(input.quantity > 0)) throw new LedgerError('الكمية يجب أن تكون أكبر من صفر')
  if (input.agreedTotalQirsh !== undefined && input.agreedTotalQirsh < input.amountQirsh) {
    throw new LedgerError('المدفوع الآن أكبر من إجمالي الحساب')
  }

  return db.transaction('rw', [db.ledger, db.funders, db.allocations, db.settings], async () => {
    const activeFunders = await checkCanSpend(input.amountQirsh)
    const entry: LedgerEntry = {
      id: newId(),
      type: 'ADVANCE',
      date: input.date,
      amountQirsh: input.amountQirsh,
      description: input.description.trim() || 'دفعة غير موزعة',
      counterparty: input.counterparty?.trim() || undefined,
      paymentMethod: input.paymentMethod,
      invoiceNumber: input.invoiceNumber?.trim() || undefined,
      quantity: input.quantity,
      unitName: input.quantity !== undefined ? input.unitName?.trim() || undefined : undefined,
      agreedTotalQirsh: input.agreedTotalQirsh,
      createdAt: new Date().toISOString(),
    }
    await db.ledger.add(entry)
    await recordFunderAllocations(entry.id, input.amountQirsh, activeFunders)
    return entry
  })
}

export interface RecordAdvancePaymentInput {
  advanceId: string
  amountQirsh: number
  date: string
  paymentMethod?: PaymentMethod
  invoiceNumber?: string
  note?: string
}

/** A further payment for an item already recorded — e.g. the rest of the
 * price after a deposit, when the total wasn't known up front. Leaves the
 * vault like any payment; shares re-price themselves from the new total. */
export async function recordAdvancePayment(input: RecordAdvancePaymentInput): Promise<LedgerEntry> {
  if (input.amountQirsh <= 0) throw new LedgerError('قيمة الدفعة يجب أن تكون أكبر من صفر')

  return db.transaction('rw', [db.ledger, db.funders, db.allocations, db.settings, db.advanceShares], async () => {
    const { advance, owedQirsh } = await getAdvanceStatus(input.advanceId)
    if (owedQirsh !== null && input.amountQirsh > owedQirsh) {
      throw new LedgerError(
        `الدفعة أكبر من الباقي من حساب الصنف (${formatEGP(Math.max(0, owedQirsh))}). لو الحساب اتغيّر عدّل إجمالي الحساب الأول`,
      )
    }
    const activeFunders = await checkCanSpend(input.amountQirsh)
    const entry: LedgerEntry = {
      id: newId(),
      type: 'ADVANCE',
      date: input.date,
      amountQirsh: input.amountQirsh,
      description: `${advance.description} — ${input.note?.trim() || 'دفعة إضافية'}`,
      counterparty: advance.counterparty,
      paymentMethod: input.paymentMethod,
      invoiceNumber: input.invoiceNumber?.trim() || undefined,
      advanceParentId: advance.id,
      createdAt: new Date().toISOString(),
    }
    await db.ledger.add(entry)
    await recordFunderAllocations(entry.id, input.amountQirsh, activeFunders)
    return entry
  })
}

export interface AdvanceShareCost {
  share: AdvanceShare
  amountQirsh: number
}

export interface AdvanceStatus {
  /** The item's first payment: its identity, name, quantity and unit. */
  advance: LedgerEntry
  /** Every payment made for the item, oldest first. Cancelled ones carry reversed:true. */
  payments: LedgerEntry[]
  totalPaidQirsh: number
  /** Fixed-amount allocations (allocateAdvance entries and their reversals). */
  allocationEntries: LedgerEntry[]
  fixedAllocatedQirsh: number
  /** Unit/percent shares, each with the money it carries right now. */
  shares: AdvanceShareCost[]
  /** What share units are measured against: the item's quantity, or 100 (percent). */
  basisUnits: number
  hasQuantity: boolean
  remainingUnits: number
  /** Money not yet attributed to any بند. */
  remainingQirsh: number
  /** The item's full price if it has been set, else null (not known yet). */
  agreedTotalQirsh: number | null
  /** Still to pay the supplier: full price − paid so far. null while the full price isn't known. */
  owedQirsh: number | null
}

const UNIT_EPSILON = 1e-6
const UNDISTRIBUTED_KEY = '__undistributed__'

function isItemOrigin(e: LedgerEntry | undefined): e is LedgerEntry {
  return !!e && e.type === 'ADVANCE' && !e.reversalOfId && !e.advanceParentId
}

export async function getAdvanceStatus(advanceId: string): Promise<AdvanceStatus> {
  const advance = await db.ledger.get(advanceId)
  if (!isItemOrigin(advance)) throw new LedgerError('الصنف غير موجود')

  const [originReversal, followUps, allocationEntries, shareRows] = await Promise.all([
    db.ledger.where('reversalOfId').equals(advanceId).first(),
    db.ledger.where('advanceParentId').equals(advanceId).toArray(), // later payments + their reversals
    db.ledger.where('advanceOriginId').equals(advanceId).toArray(),
    db.advanceShares.where('advanceId').equals(advanceId).toArray(),
  ])

  const cashRows = [advance, ...(originReversal ? [originReversal] : []), ...followUps]
  const totalPaidQirsh = cashRows.reduce((s, e) => s - signedAmount(e), 0)
  const payments = [advance, ...followUps.filter((e) => !e.reversalOfId)].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const fixedAllocatedQirsh = allocationEntries.reduce((s, e) => s - signedAmount(e), 0)

  const hasQuantity = advance.quantity !== undefined && advance.quantity > 0
  const basisUnits = hasQuantity ? advance.quantity! : 100
  const restUnits = basisUnits - shareRows.reduce((s, r) => s + r.units, 0)
  const remainingUnits = restUnits > UNIT_EPSILON ? restUnits : 0

  // Shares split whatever has been paid so far in proportion to their units;
  // units not yet given to a بند keep their part of the money undistributed.
  let shares: AdvanceShareCost[] = []
  if (shareRows.length > 0) {
    const split = splitProportionally(Math.max(0, totalPaidQirsh - fixedAllocatedQirsh), [
      ...shareRows.map((r) => ({ key: r.id, percent: r.units })),
      ...(remainingUnits > 0 ? [{ key: UNDISTRIBUTED_KEY, percent: remainingUnits }] : []),
    ])
    const amountById = new Map(split.map((s) => [s.key, s.amountQirsh]))
    shares = [...shareRows]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => ({ share: r, amountQirsh: amountById.get(r.id) ?? 0 }))
  }
  const sharedQirsh = shares.reduce((s, c) => s + c.amountQirsh, 0)
  const agreedTotalQirsh = advance.agreedTotalQirsh !== undefined && advance.agreedTotalQirsh > 0 ? advance.agreedTotalQirsh : null

  return {
    advance,
    payments,
    totalPaidQirsh,
    allocationEntries,
    fixedAllocatedQirsh,
    shares,
    basisUnits,
    hasQuantity,
    remainingUnits,
    remainingQirsh: totalPaidQirsh - fixedAllocatedQirsh - sharedQirsh,
    agreedTotalQirsh,
    owedQirsh: agreedTotalQirsh === null ? null : agreedTotalQirsh - totalPaidQirsh,
  }
}

/** Sets, changes or clears (null) an item's full price — it is often only
 * known after the deposit. Can't be set below what has already been paid. */
export async function setAdvanceAgreedTotal(advanceId: string, totalQirsh: number | null): Promise<void> {
  await db.transaction('rw', [db.ledger, db.advanceShares], async () => {
    const status = await getAdvanceStatus(advanceId)
    if (totalQirsh !== null && totalQirsh < status.totalPaidQirsh) {
      throw new LedgerError(`إجمالي الحساب أقل من المدفوع للصنف فعلاً (${formatEGP(status.totalPaidQirsh)})`)
    }
    await db.ledger.update(advanceId, { agreedTotalQirsh: totalQirsh ?? undefined })
  })
}

/** How a number of an item's share units reads to the user: "٢ نقلة (٥٠%)"
 * for an item with a quantity, just "٤٠%" for one distributed by percent. */
export function describeItemUnits(item: Pick<AdvanceStatus, 'advance' | 'basisUnits' | 'hasQuantity'>, units: number): string {
  const percent = `${formatUnits((units / item.basisUnits) * 100)}%`
  return item.hasQuantity ? `${formatUnits(units)} ${item.advance.unitName || 'وحدة'} (${percent})` : percent
}

/** Every item, oldest first — including fully distributed ones, since more
 * of the price may still be paid later. Only fully cancelled items with
 * nothing attached are left out. */
export async function listAdvanceItems(): Promise<AdvanceStatus[]> {
  const all = await db.ledger.where('type').equals('ADVANCE').toArray()
  const statuses = await Promise.all(all.filter(isItemOrigin).map((a) => getAdvanceStatus(a.id)))
  return statuses
    .filter((s) => s.totalPaidQirsh !== 0 || s.shares.length > 0 || s.fixedAllocatedQirsh !== 0)
    .sort((a, b) => a.advance.createdAt.localeCompare(b.advance.createdAt))
}

export interface AllocateAdvanceInput {
  advanceLedgerEntryId: string
  date: string
  lines: { categoryId: string; amountQirsh: number; note?: string }[]
}

/** Attributes a fixed amount of an already-paid advance to one or more
 * بنود. Creates category-tagged EXPENSE entries with affectsVault:false —
 * the vault was debited when the advance was paid, so these must not debit
 * it again. Not for items distributed by units/percent: mixing a fixed
 * amount into those would make a unit's price depend on the order of entry. */
export async function allocateAdvance(input: AllocateAdvanceInput): Promise<LedgerEntry[]> {
  if (input.lines.length === 0) throw new LedgerError('أضف بند واحد على الأقل للتوزيع')
  if (input.lines.some((l) => l.amountQirsh <= 0)) throw new LedgerError('قيمة كل بند يجب أن تكون أكبر من صفر')

  return db.transaction('rw', [db.ledger, db.categories, db.advanceShares], async () => {
    const status = await getAdvanceStatus(input.advanceLedgerEntryId)
    if (status.hasQuantity || status.shares.length > 0) {
      throw new LedgerError('الصنف ده بيتوزع بالوحدات أو بالنسبة، مش بمبلغ ثابت')
    }
    const totalToAllocate = input.lines.reduce((s, l) => s + l.amountQirsh, 0)
    if (totalToAllocate > status.remainingQirsh) {
      throw new LedgerError(
        `إجمالي المطلوب توزيعه أكبر من المتبقي غير الموزع (${formatEGP(status.remainingQirsh)})`,
      )
    }

    const entries: LedgerEntry[] = []
    for (const line of input.lines) {
      await assertCategory(line.categoryId, true)

      const entry: LedgerEntry = {
        id: newId(),
        type: 'EXPENSE',
        date: input.date,
        amountQirsh: line.amountQirsh,
        description: line.note?.trim() ? `${status.advance.description} — ${line.note.trim()}` : status.advance.description,
        counterparty: status.advance.counterparty,
        paymentMethod: status.advance.paymentMethod,
        categoryId: line.categoryId,
        affectsVault: false,
        advanceOriginId: status.advance.id,
        createdAt: new Date().toISOString(),
      }
      await db.ledger.add(entry)
      entries.push(entry)
    }
    return entries
  })
}

export interface AddAdvanceSharesInput {
  advanceId: string
  /** units are in the item's own basis: its quantity, or percent points when it has none. */
  lines: { categoryId: string; units: number; note?: string }[]
}

/** Gives some of an item's units (or percent) to بنود. Only the split is
 * stored; each بند's cost follows from what has been paid for the item. */
export async function addAdvanceShares(input: AddAdvanceSharesInput): Promise<AdvanceShare[]> {
  if (input.lines.length === 0) throw new LedgerError('أضف بند واحد على الأقل للتوزيع')
  if (input.lines.some((l) => !(l.units > 0))) throw new LedgerError('قيمة كل بند يجب أن تكون أكبر من صفر')

  return db.transaction('rw', [db.ledger, db.categories, db.advanceShares], async () => {
    const status = await getAdvanceStatus(input.advanceId)
    if (status.fixedAllocatedQirsh > 0) {
      throw new LedgerError('الصنف ده اتوزع منه بمبلغ ثابت قبل كده. كمّل توزيعه بالمبلغ، أو الغِ التوزيعات دي الأول')
    }
    for (const line of input.lines) await assertCategory(line.categoryId, true)

    // Values are typed from a rounded display ("1.33" of an exact 1.3333…),
    // so a request within the tolerance of everything that's left means
    // "all of it" — otherwise a sliver would stay undistributed forever.
    const tolerance = Math.max(status.basisUnits * 0.0002, 0.005)
    const units = input.lines.map((l) => l.units)
    const gap = status.remainingUnits - units.reduce((s, u) => s + u, 0)
    if (gap < -tolerance) throw new LedgerError('المطلوب توزيعه أكبر من غير الموزَّع من الصنف')
    const last = units.length - 1
    if (Math.abs(gap) <= tolerance && units[last] + gap > 0) units[last] += gap

    const now = new Date().toISOString()
    const rows: AdvanceShare[] = input.lines.map((line, idx) => ({
      id: newId(),
      advanceId: status.advance.id,
      categoryId: line.categoryId,
      units: units[idx],
      note: line.note?.trim() || undefined,
      date: now.slice(0, 10),
      createdAt: now,
    }))
    await db.advanceShares.bulkAdd(rows)
    return rows
  })
}

/** Takes a بند's share back; its units and money return to "undistributed". */
export async function removeAdvanceShare(shareId: string): Promise<void> {
  await db.advanceShares.delete(shareId)
}

export async function reverseEntry(entryId: string, reason: string): Promise<LedgerEntry> {
  if (!reason.trim()) throw new LedgerError('سبب الإلغاء مطلوب')

  return db.transaction('rw', [db.ledger, db.allocations, db.advanceShares], async () => {
    const original = await db.ledger.get(entryId)
    if (!original) throw new LedgerError('الحركة غير موجودة')
    if (original.reversalOfId) throw new LedgerError('لا يمكن إلغاء حركة عكسية بالفعل')

    const existingReversal = await db.ledger.where('reversalOfId').equals(entryId).first()
    if (existingReversal) throw new LedgerError('هذه الحركة مُلغاة من قبل')

    // Cancelling a payment can't leave more money attributed to بنود by fixed
    // amount than was paid for the item. Unit/percent shares need no such
    // check: they re-price themselves from whatever remains paid.
    if (original.type === 'ADVANCE') {
      const item = await getAdvanceStatus(original.advanceParentId ?? original.id)
      if (item.totalPaidQirsh - original.amountQirsh < item.fixedAllocatedQirsh) {
        throw new LedgerError('جزء من فلوس الدفعة دي اتوزع على بنود بمبلغ ثابت. الغِ التوزيع ده الأول وبعدين الغِ الدفعة')
      }
    }

    const reversal: LedgerEntry = {
      id: newId(),
      type: original.type,
      date: new Date().toISOString().slice(0, 10),
      amountQirsh: original.amountQirsh,
      description: `إلغاء: ${reason.trim()} (مرجع: ${original.description})`,
      counterparty: original.counterparty,
      paymentMethod: original.paymentMethod,
      invoiceNumber: original.invoiceNumber,
      funderId: original.funderId,
      categoryId: original.categoryId,
      affectsVault: original.affectsVault,
      advanceOriginId: original.advanceOriginId,
      advanceParentId: original.advanceParentId,
      reversalOfId: original.id,
      createdAt: new Date().toISOString(),
    }
    await db.ledger.add(reversal)

    // Mirrors any funder allocation the original entry had (EXPENSE and
    // ADVANCE both get one; CONTRIBUTION and advance-allocation entries
    // don't, so this is a no-op for those — safe either way).
    const originalAllocations = await db.allocations.where('ledgerEntryId').equals(original.id).toArray()
    for (const alloc of originalAllocations) {
      await db.allocations.add({
        id: newId(),
        ledgerEntryId: reversal.id,
        funderId: alloc.funderId,
        sharePercentApplied: alloc.sharePercentApplied,
        amountQirsh: -alloc.amountQirsh,
      })
    }

    await db.ledger.update(original.id, { reversed: true })
    return reversal
  })
}

// ---------------------------------------------------------------------------
// Corrections that move no money: wording, dates, names, an item's quantity,
// a payable's invoice total. Amounts, بنود and funders are never edited in
// place — those change only by reversing an entry and recording it again,
// so every number in the ledger stays traceable.
// ---------------------------------------------------------------------------

function assertIsoDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new LedgerError('التاريخ غير صحيح')
}

/** A live row's wording may still be corrected. Reversal entries, and the
 * entries they cancelled, are history and stay exactly as recorded. */
const isLive = (e: LedgerEntry) => !e.reversalOfId && !e.reversed

/** New text for a row that was labelled from a name ("name" or
 * "name — note"), or null if it no longer follows that pattern. */
function relabel(description: string, oldName: string, newName: string): string | null {
  if (description === oldName) return newName
  if (description.startsWith(`${oldName} — `)) return newName + description.slice(oldName.length)
  return null
}

/** Carries an item's new name / supplier onto its follow-up payments and
 * fixed-amount allocations, which were labelled from it when recorded.
 * `advance` is the item's first entry as it was before the change. */
async function relabelItemRows(advance: LedgerEntry, name: string, counterparty: string | undefined): Promise<void> {
  const rows = [
    ...(await db.ledger.where('advanceParentId').equals(advance.id).toArray()),
    ...(await db.ledger.where('advanceOriginId').equals(advance.id).toArray()),
  ]
  for (const row of rows.filter(isLive)) {
    await db.ledger.update(row.id, {
      description: relabel(row.description, advance.description, name) ?? row.description,
      counterparty,
    })
  }
}

/** Saves a payable's corrected fields, and carries its supplier name and
 * description onto the settlement payments that were labelled from them.
 * `payable` is the row as it was before the change. */
async function relabelPayable(
  payable: Payable,
  next: { supplierName: string; description: string; date: string; totalQirsh: number },
): Promise<void> {
  const oldLabel = settlementDescription(payable.supplierName, payable.description)
  const settlements = await db.payableSettlements.where('payableId').equals(payable.id).toArray()
  for (const settlement of settlements) {
    const entry = await db.ledger.get(settlement.ledgerEntryId)
    if (!entry || !isLive(entry)) continue
    await db.ledger.update(entry.id, {
      counterparty: next.supplierName,
      description: entry.description === oldLabel ? settlementDescription(next.supplierName, next.description) : entry.description,
    })
  }
  await db.payables.update(payable.id, next)
}

export interface EntryDetailsPatch {
  description?: string
  date?: string
  /** Ignored for contributions, whose other party is the funder. */
  counterparty?: string
  paymentMethod?: PaymentMethod
  invoiceNumber?: string
}

/** Corrects the wording of a recorded entry — never its amount, بند or
 * funder. A name other rows were labelled from (an item's, a payable
 * supplier's) is carried onto those rows too. */
export async function updateEntryDetails(entryId: string, patch: EntryDetailsPatch): Promise<void> {
  await db.transaction('rw', [db.ledger, db.payables, db.payableSettlements], async () => {
    const entry = await db.ledger.get(entryId)
    if (!entry) throw new LedgerError('الحركة غير موجودة')
    if (!isLive(entry)) throw new LedgerError('الحركة دي ملغاة أو حركة إلغاء، وبياناتها بتفضل زي ما اتسجلت')

    const description = patch.description !== undefined ? patch.description.trim() : entry.description
    if (!description) throw new LedgerError('الوصف مطلوب')
    const date = patch.date ?? entry.date
    assertIsoDate(date)
    const counterparty =
      patch.counterparty !== undefined && entry.type !== 'CONTRIBUTION' ? patch.counterparty.trim() || undefined : entry.counterparty
    const paymentMethod = patch.paymentMethod ?? entry.paymentMethod
    const invoiceNumber = patch.invoiceNumber !== undefined ? patch.invoiceNumber.trim() || undefined : entry.invoiceNumber

    const unchanged =
      description === entry.description &&
      date === entry.date &&
      counterparty === entry.counterparty &&
      paymentMethod === entry.paymentMethod &&
      invoiceNumber === entry.invoiceNumber
    if (unchanged) return

    const payable = await db.payables.where('originLedgerEntryId').equals(entryId).first()
    if (payable) {
      if (!counterparty) throw new LedgerError('اسم المورد مطلوب لأن الحركة دي عليها مستحق للمورد')
      await relabelPayable(payable, { supplierName: counterparty, description, date, totalQirsh: payable.totalQirsh })
    }
    if (isItemOrigin(entry)) await relabelItemRows(entry, description, counterparty)

    await db.ledger.update(entryId, { description, date, counterparty, paymentMethod, invoiceNumber, editedAt: new Date().toISOString() })
  })
}

export interface UpdateAdvanceItemInput {
  name?: string
  counterparty?: string
  /** A number sets or corrects the quantity bought; null removes it, and
   * the item is then distributed by percent instead of by units. */
  quantity?: number | null
  unitName?: string
}

/** Corrects an item's name, supplier, quantity or unit. No money moves:
 * what each بند carries is always derived from the item's payments. */
export async function updateAdvanceItem(advanceId: string, patch: UpdateAdvanceItemInput): Promise<void> {
  await db.transaction('rw', [db.ledger, db.advanceShares], async () => {
    const status = await getAdvanceStatus(advanceId)
    const { advance } = status

    const name = patch.name !== undefined ? patch.name.trim() : advance.description
    if (!name) throw new LedgerError('اسم الصنف مطلوب')
    const counterparty = patch.counterparty !== undefined ? patch.counterparty.trim() || undefined : advance.counterparty

    const oldQuantity = status.hasQuantity ? advance.quantity! : null
    const quantity = patch.quantity === undefined ? oldQuantity : patch.quantity
    if (quantity !== null && !(quantity > 0)) throw new LedgerError('الكمية يجب أن تكون أكبر من صفر')

    if (quantity !== oldQuantity) {
      if (quantity !== null && status.fixedAllocatedQirsh > 0) {
        throw new LedgerError('الصنف ده اتوزع منه بمبلغ ثابت، فمينفعش يتحدد له كمية. الغِ التوزيعات دي الأول')
      }
      if (quantity !== null && oldQuantity !== null) {
        // Units already given to بنود are real quantities: they stay as they
        // are, so the corrected total can't be less than what was handed out.
        const distributed = status.shares.reduce((s, c) => s + c.share.units, 0)
        if (quantity < distributed - UNIT_EPSILON) {
          throw new LedgerError(
            `الكمية الجديدة أقل من اللي اتوزّع على البنود فعلاً (${formatUnits(distributed)} ${advance.unitName || 'وحدة'})`,
          )
        }
      } else {
        // Switching between "by units" and "by percent": every بند keeps its
        // proportion of the item, re-expressed in the new basis.
        const factor = (quantity ?? 100) / status.basisUnits
        for (const { share } of status.shares) await db.advanceShares.update(share.id, { units: share.units * factor })
      }
    }
    const unitName = quantity === null ? undefined : patch.unitName !== undefined ? patch.unitName.trim() || undefined : advance.unitName

    await relabelItemRows(advance, name, counterparty)
    await db.ledger.update(advanceId, { description: name, counterparty, quantity: quantity ?? undefined, unitName })
  })
}

/** Corrects a payable's supplier name or invoice total. The total can't go
 * below what has been paid; setting it equal to that closes the payable. */
export async function updatePayable(payableId: string, patch: { supplierName?: string; totalQirsh?: number }): Promise<void> {
  await db.transaction('rw', [db.ledger, db.payables, db.payableSettlements], async () => {
    const { payable, paidQirsh } = await getPayableStatus(payableId)

    const supplierName = patch.supplierName !== undefined ? patch.supplierName.trim() : payable.supplierName
    if (!supplierName) throw new LedgerError('اسم المورد مطلوب')
    const totalQirsh = patch.totalQirsh ?? payable.totalQirsh
    if (!(totalQirsh > 0)) throw new LedgerError('إجمالي قيمة الفاتورة يجب أن يكون أكبر من صفر')
    if (totalQirsh < paidQirsh) throw new LedgerError(`إجمالي الفاتورة أقل من المدفوع فعلاً (${formatEGP(paidQirsh)})`)

    const origin = await db.ledger.get(payable.originLedgerEntryId)
    if (origin && isLive(origin)) await db.ledger.update(origin.id, { counterparty: supplierName })
    await relabelPayable(payable, { supplierName, description: payable.description, date: payable.date, totalQirsh })
  })
}

// ---------------------------------------------------------------------------
// Statements & reports
// ---------------------------------------------------------------------------

export interface FunderStatement {
  funder: Funder
  totalContributedQirsh: number
  totalExpenseShareQirsh: number
  netPositionQirsh: number
  entries: LedgerEntry[]
}

export async function getFunderStatement(funderId: string): Promise<FunderStatement> {
  const funder = await db.funders.get(funderId)
  if (!funder) throw new LedgerError('الممول غير موجود')

  const entries = await db.ledger.where('funderId').equals(funderId).sortBy('date')
  const totalContributedQirsh = entries.reduce((s, e) => s + signedAmount(e), 0)

  const allocations = await db.allocations.where('funderId').equals(funderId).toArray()
  const totalExpenseShareQirsh = allocations.reduce((s, a) => s + a.amountQirsh, 0)

  return {
    funder,
    totalContributedQirsh,
    totalExpenseShareQirsh,
    netPositionQirsh: totalContributedQirsh - totalExpenseShareQirsh,
    entries,
  }
}

/** A بند's part of an item distributed by units/percent (see AdvanceShare). */
export interface CategoryItemShare {
  item: AdvanceStatus
  share: AdvanceShare
  amountQirsh: number
}

export interface CategoryStatement {
  category: ExpenseCategory
  totalSpentQirsh: number
  remainingBudgetQirsh: number | null
  entries: LedgerEntry[]
  itemShares: CategoryItemShare[]
}

/** What each بند has cost so far: its own entries (direct expenses, payable
 * settlements, fixed-amount advance allocations) plus its unit/percent
 * shares of items. The one place this is computed, for every screen. */
export async function getSpentByCategory(): Promise<Map<string, number>> {
  const spent = new Map<string, number>()
  const add = (categoryId: string, qirsh: number) => spent.set(categoryId, (spent.get(categoryId) ?? 0) + qirsh)

  for (const e of await db.ledger.toArray()) {
    if (e.categoryId) add(e.categoryId, -signedAmount(e)) // expenses are negative signed; spend is positive
  }
  for (const item of await listAdvanceItems()) {
    for (const s of item.shares) add(s.share.categoryId, s.amountQirsh)
  }
  return spent
}

export async function getCategoryStatement(categoryId: string): Promise<CategoryStatement> {
  const category = await db.categories.get(categoryId)
  if (!category) throw new LedgerError('البند غير موجود')

  const entries = await db.ledger.where('categoryId').equals(categoryId).sortBy('date')
  const itemShares = (await listAdvanceItems()).flatMap((item) =>
    item.shares.filter((s) => s.share.categoryId === categoryId).map((s) => ({ item, share: s.share, amountQirsh: s.amountQirsh })),
  )
  const totalSpentQirsh =
    entries.reduce((s, e) => s - signedAmount(e), 0) + itemShares.reduce((s, i) => s + i.amountQirsh, 0)

  return {
    category,
    totalSpentQirsh,
    remainingBudgetQirsh: category.budgetQirsh > 0 ? category.budgetQirsh - totalSpentQirsh : null,
    entries,
    itemShares,
  }
}

export interface DashboardSummary {
  balanceQirsh: number
  totalContributionsQirsh: number
  totalExpensesQirsh: number
  totalPayablesQirsh: number
  totalUnallocatedAdvancesQirsh: number
  funderCount: number
  categoryCount: number
  recentEntries: LedgerEntry[]
  topCategories: { category: ExpenseCategory; spentQirsh: number }[]
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const [entries, funders, categories, openPayables, items, spentByCategory] = await Promise.all([
    db.ledger.toArray(),
    db.funders.toArray(),
    db.categories.toArray(),
    listOpenPayables(),
    listAdvanceItems(),
    getSpentByCategory(),
  ])
  const totalPayablesQirsh =
    openPayables.reduce((s, p) => s + p.remainingQirsh, 0) + items.reduce((s, i) => s + Math.max(0, i.owedQirsh ?? 0), 0)
  const totalUnallocatedAdvancesQirsh = items.reduce((s, i) => s + Math.max(0, i.remainingQirsh), 0)

  // Bucket by the entry's own type (not by the sign of signedAmount): a
  // reversed CONTRIBUTION has a negative signedAmount but must still reduce
  // totalContributions, not inflate totalExpenses, and vice versa. Entries
  // with affectsVault === false (advance-allocation entries) are excluded
  // from totalExpensesQirsh — their cash was already counted against the
  // original ADVANCE, so counting them again here would double it.
  let totalContributionsQirsh = 0
  let totalExpensesQirsh = 0
  for (const e of entries) {
    if (e.type === 'CONTRIBUTION') totalContributionsQirsh += signedAmount(e)
    else if (e.affectsVault !== false) totalExpensesQirsh += -signedAmount(e)
  }

  const topCategories = categories
    .map((c) => ({ category: c, spentQirsh: spentByCategory.get(c.id) ?? 0 }))
    .sort((a, b) => b.spentQirsh - a.spentQirsh)
    .slice(0, 5)

  const recentEntries = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10)

  return {
    balanceQirsh: totalContributionsQirsh - totalExpensesQirsh,
    totalContributionsQirsh,
    totalExpensesQirsh,
    totalPayablesQirsh,
    totalUnallocatedAdvancesQirsh,
    funderCount: funders.filter((f) => f.active).length,
    categoryCount: categories.filter((c) => c.active).length,
    recentEntries,
    topCategories,
  }
}
