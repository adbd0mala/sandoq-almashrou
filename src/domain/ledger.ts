import { db, ensureSettings, newId } from '../db/db'
import type { ExpenseCategory, Funder, LedgerEntry, Payable, PaymentMethod } from './types'
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

export async function getPayableStatus(payableId: string): Promise<PayableStatus> {
  const payable = await db.payables.get(payableId)
  if (!payable) throw new LedgerError('المستحق غير موجود')

  const origin = await db.ledger.get(payable.originLedgerEntryId)
  const settlements = await db.payableSettlements.where('payableId').equals(payableId).toArray()
  const settlementEntries = (
    await Promise.all(settlements.map((s) => db.ledger.get(s.ledgerEntryId)))
  ).filter((e): e is LedgerEntry => !!e)

  const paidQirsh = [origin, ...settlementEntries].reduce((sum, e) => (e ? sum - signedAmount(e) : sum), 0)
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
          `قيمة السداد أكبر من المتبقي. المتبقي للمورد ${status.payable.supplierName} هو ${(status.remainingQirsh / 100).toFixed(2)} ج.م`,
        )
      }

      const activeFunders = await checkCanSpend(input.amountQirsh)
      const entry = await insertExpenseEntry(
        {
          categoryId: status.payable.categoryId,
          amountQirsh: input.amountQirsh,
          date: input.date,
          description: `سداد مستحق مورد: ${status.payable.supplierName} (${status.payable.description})`,
          counterparty: status.payable.supplierName,
          paymentMethod: input.paymentMethod,
          invoiceNumber: input.invoiceNumber,
        },
        activeFunders,
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
// Advances — pay a contractor/supplier before knowing which بند the money
// will end up against (e.g. a down payment while work is still ongoing).
// Cash leaves the vault immediately; allocateAdvance later recognizes
// portions of it against real بنود once the work/usage is known, without
// touching the vault again (the cash already left).
// ---------------------------------------------------------------------------

export interface RecordAdvanceInput {
  amountQirsh: number
  date: string
  description: string
  counterparty?: string
  paymentMethod?: PaymentMethod
  invoiceNumber?: string
}

export async function recordAdvance(input: RecordAdvanceInput): Promise<LedgerEntry> {
  if (input.amountQirsh <= 0) throw new LedgerError('قيمة الدفعة يجب أن تكون أكبر من صفر')

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
      createdAt: new Date().toISOString(),
    }
    await db.ledger.add(entry)
    await recordFunderAllocations(entry.id, input.amountQirsh, activeFunders)
    return entry
  })
}

export interface AdvanceStatus {
  advance: LedgerEntry
  allocatedQirsh: number
  remainingQirsh: number
  allocationEntries: LedgerEntry[]
}

export async function getAdvanceStatus(advanceLedgerEntryId: string): Promise<AdvanceStatus> {
  const advance = await db.ledger.get(advanceLedgerEntryId)
  if (!advance || advance.type !== 'ADVANCE') throw new LedgerError('الدفعة غير موجودة')

  const allocationEntries = await db.ledger.where('advanceOriginId').equals(advanceLedgerEntryId).toArray()
  const allocatedQirsh = allocationEntries.reduce((s, e) => s - signedAmount(e), 0)

  return { advance, allocatedQirsh, remainingQirsh: advance.amountQirsh - allocatedQirsh, allocationEntries }
}

export async function listOpenAdvances(): Promise<AdvanceStatus[]> {
  const all = await db.ledger.where('type').equals('ADVANCE').toArray()
  const origins = all.filter((e) => !e.reversalOfId) // exclude reversal markers, keep only original advances
  const statuses = await Promise.all(origins.map((a) => getAdvanceStatus(a.id)))
  return statuses.filter((s) => s.remainingQirsh > 0 && !s.advance.reversed).sort((a, b) => a.advance.date.localeCompare(b.advance.date))
}

export interface AllocateAdvanceInput {
  advanceLedgerEntryId: string
  date: string
  lines: { categoryId: string; amountQirsh: number; note?: string }[]
}

/** Recognizes part (or all) of an already-paid ADVANCE against one or more
 * بنود, now that the actual usage/work is known. Creates category-tagged
 * EXPENSE entries with affectsVault:false — the vault was already debited
 * when the advance itself was recorded, so these must not debit it again. */
export async function allocateAdvance(input: AllocateAdvanceInput): Promise<LedgerEntry[]> {
  if (input.lines.length === 0) throw new LedgerError('أضف بند واحد على الأقل للتوزيع')
  if (input.lines.some((l) => l.amountQirsh <= 0)) throw new LedgerError('قيمة كل بند يجب أن تكون أكبر من صفر')

  return db.transaction('rw', [db.ledger, db.categories], async () => {
    const status = await getAdvanceStatus(input.advanceLedgerEntryId)
    const totalToAllocate = input.lines.reduce((s, l) => s + l.amountQirsh, 0)
    if (totalToAllocate > status.remainingQirsh) {
      throw new LedgerError(
        `إجمالي المطلوب توزيعه أكبر من المتبقي غير الموزع (${(status.remainingQirsh / 100).toFixed(2)} ج.م)`,
      )
    }

    const entries: LedgerEntry[] = []
    for (const line of input.lines) {
      const category = await db.categories.get(line.categoryId)
      if (!category || !category.active) throw new LedgerError('بند غير موجود أو مؤرشف')

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

export async function reverseEntry(entryId: string, reason: string): Promise<LedgerEntry> {
  if (!reason.trim()) throw new LedgerError('سبب الإلغاء مطلوب')

  return db.transaction('rw', [db.ledger, db.allocations], async () => {
    const original = await db.ledger.get(entryId)
    if (!original) throw new LedgerError('الحركة غير موجودة')
    if (original.reversalOfId) throw new LedgerError('لا يمكن إلغاء حركة عكسية بالفعل')

    const existingReversal = await db.ledger.where('reversalOfId').equals(entryId).first()
    if (existingReversal) throw new LedgerError('هذه الحركة مُلغاة من قبل')

    if (original.type === 'ADVANCE') {
      const hasAllocations = await db.ledger.where('advanceOriginId').equals(original.id).count()
      if (hasAllocations > 0) {
        throw new LedgerError('جزء من هذه الدفعة اتوزع على بنود بالفعل. لازم تلغي توزيعاتها الأول من تبويب الدفعات')
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
  totalPayablesQirsh: number
  totalUnallocatedAdvancesQirsh: number
  funderCount: number
  categoryCount: number
  recentEntries: LedgerEntry[]
  topCategories: { category: ExpenseCategory; spentQirsh: number }[]
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const [entries, funders, categories, openPayables, openAdvances] = await Promise.all([
    db.ledger.toArray(),
    db.funders.toArray(),
    db.categories.toArray(),
    listOpenPayables(),
    listOpenAdvances(),
  ])
  const totalPayablesQirsh = openPayables.reduce((s, p) => s + p.remainingQirsh, 0)
  const totalUnallocatedAdvancesQirsh = openAdvances.reduce((s, a) => s + a.remainingQirsh, 0)

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
    totalPayablesQirsh,
    totalUnallocatedAdvancesQirsh,
    funderCount: funders.filter((f) => f.active).length,
    categoryCount: categories.filter((c) => c.active).length,
    recentEntries,
    topCategories,
  }
}
