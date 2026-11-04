import { db, ensureSettings, newId } from '../db/db'
import type { ExpenseCategory, Funder, LedgerEntry, PaymentMethod } from './types'
import { splitProportionally } from './money'

export class LedgerError extends Error {}

const SHARE_TOLERANCE = 0.01

// ---------------------------------------------------------------------------
// Funders & shares
// ---------------------------------------------------------------------------

export async function listFunders(): Promise<Funder[]> {
  return db.funders.toArray()
}

export async function listActiveFunders(): Promise<Funder[]> {
  const all = await db.funders.toArray()
  return all.filter((f) => f.active).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
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

export async function resetToEqualShares(): Promise<void> {
  await db.transaction('rw', db.funders, async () => {
    const active = await listActiveFunders()
    const shares = equalShares(active.map((f) => f.id))
    await Promise.all(active.map((f) => db.funders.update(f.id, { sharePercent: shares.get(f.id) ?? 0 })))
  })
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

export async function updateFunderInfo(
  funderId: string,
  patch: { name?: string; phone?: string; notes?: string; targetContributionQirsh?: number },
): Promise<void> {
  await db.funders.update(funderId, patch)
}

// ---------------------------------------------------------------------------
// Expense categories
// ---------------------------------------------------------------------------

export async function listCategories(): Promise<ExpenseCategory[]> {
  return db.categories.toArray()
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
  await db.categories.update(id, patch)
}

export async function archiveCategory(id: string): Promise<void> {
  await db.categories.update(id, { active: false })
}

export async function deleteCategoryIfUnused(id: string): Promise<void> {
  const count = await db.ledger.where('categoryId').equals(id).count()
  if (count > 0) throw new LedgerError('لا يمكن حذف بند له حركات مالية سابقة. يمكنك أرشفته فقط')
  await db.categories.delete(id)
}

// ---------------------------------------------------------------------------
// Vault balance (derived only — never stored)
// ---------------------------------------------------------------------------

export async function getVaultBalanceQirsh(): Promise<number> {
  const entries = await db.ledger.toArray()
  return entries.reduce((sum, e) => sum + signedAmount(e), 0)
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

/** Inserts one EXPENSE ledger entry + its per-funder allocation. Assumes it
 * already runs inside an open Dexie transaction covering ledger/allocations
 * — callers (recordExpense, recordSplitExpense) own the transaction and the
 * balance/shares checks, so a multi-line split stays atomic as one unit. */
async function insertExpenseEntry(input: RecordExpenseInput, activeFunders: Funder[]): Promise<LedgerEntry> {
  const category = await db.categories.get(input.categoryId)
  if (!category || !category.active) throw new LedgerError('بند المصروف غير موجود أو مؤرشف')

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

  const split = splitProportionally(
    input.amountQirsh,
    activeFunders.map((f) => ({ key: f.id, percent: f.sharePercent })),
  )
  for (const s of split) {
    const funder = activeFunders.find((f) => f.id === s.key)!
    await db.allocations.add({
      id: newId(),
      ledgerEntryId: entry.id,
      funderId: s.key,
      sharePercentApplied: funder.sharePercent,
      amountQirsh: s.amountQirsh,
    })
  }

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
      `الرصيد غير كافٍ. الرصيد الحالي ${(balance / 100).toFixed(2)} ج.م وقيمة المصروف ${(totalQirsh / 100).toFixed(2)} ج.م`,
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

export async function reverseEntry(entryId: string, reason: string): Promise<LedgerEntry> {
  if (!reason.trim()) throw new LedgerError('سبب الإلغاء مطلوب')

  return db.transaction('rw', [db.ledger, db.allocations], async () => {
    const original = await db.ledger.get(entryId)
    if (!original) throw new LedgerError('الحركة غير موجودة')
    if (original.reversalOfId) throw new LedgerError('لا يمكن إلغاء حركة عكسية بالفعل')

    const existingReversal = await db.ledger.where('reversalOfId').equals(entryId).first()
    if (existingReversal) throw new LedgerError('هذه الحركة مُلغاة من قبل')

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
      reversalOfId: original.id,
      createdAt: new Date().toISOString(),
    }
    await db.ledger.add(reversal)

    if (original.type === 'EXPENSE') {
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
    }

    await db.ledger.update(original.id, { reversed: true })
    return reversal
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

export interface CategoryStatement {
  category: ExpenseCategory
  totalSpentQirsh: number
  remainingBudgetQirsh: number | null
  entries: LedgerEntry[]
}

export async function getCategoryStatement(categoryId: string): Promise<CategoryStatement> {
  const category = await db.categories.get(categoryId)
  if (!category) throw new LedgerError('البند غير موجود')

  const entries = await db.ledger.where('categoryId').equals(categoryId).sortBy('date')
  const totalSpentQirsh = entries.reduce((s, e) => s - signedAmount(e), 0) // expenses are negative signed; spend is positive

  return {
    category,
    totalSpentQirsh,
    remainingBudgetQirsh: category.budgetQirsh > 0 ? category.budgetQirsh - totalSpentQirsh : null,
    entries,
  }
}

export interface DashboardSummary {
  balanceQirsh: number
  totalContributionsQirsh: number
  totalExpensesQirsh: number
  funderCount: number
  categoryCount: number
  recentEntries: LedgerEntry[]
  topCategories: { category: ExpenseCategory; spentQirsh: number }[]
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const [entries, funders, categories] = await Promise.all([
    db.ledger.toArray(),
    db.funders.toArray(),
    db.categories.toArray(),
  ])

  // Bucket by the entry's own type (not by the sign of signedAmount): a
  // reversed CONTRIBUTION has a negative signedAmount but must still reduce
  // totalContributions, not inflate totalExpenses, and vice versa.
  let totalContributionsQirsh = 0
  let totalExpensesQirsh = 0
  for (const e of entries) {
    if (e.type === 'CONTRIBUTION') totalContributionsQirsh += signedAmount(e)
    else totalExpensesQirsh += -signedAmount(e)
  }

  const spentByCategory = new Map<string, number>()
  for (const e of entries) {
    if (e.categoryId) {
      const s = -signedAmount(e) // positive spend contribution (handles reversals correctly)
      spentByCategory.set(e.categoryId, (spentByCategory.get(e.categoryId) ?? 0) + s)
    }
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
    funderCount: funders.filter((f) => f.active).length,
    categoryCount: categories.filter((c) => c.active).length,
    recentEntries,
    topCategories,
  }
}
