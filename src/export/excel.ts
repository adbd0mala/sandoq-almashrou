import * as XLSX from 'xlsx'
import { PAYMENT_METHOD_LABELS } from '../domain/types'
import type { CategoryStatement, FunderStatement } from '../domain/ledger'
import { describeItemUnits, signedAmount } from '../domain/ledger'
import { qirshToEgp } from '../domain/money'
import type { ExpenseAllocation, Funder, LedgerEntry } from '../domain/types'

function download(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename)
}

function entryRow(e: LedgerEntry) {
  return {
    التاريخ: e.date,
    'النوع': e.type === 'CONTRIBUTION' ? 'مساهمة' : e.affectsVault === false ? 'توزيع دفعة' : e.type === 'ADVANCE' ? 'دفعة صنف' : 'مصروف',
    'الوصف': e.description,
    'المورد/المستفيد': e.counterparty ?? '',
    'طريقة الدفع': e.paymentMethod ? PAYMENT_METHOD_LABELS[e.paymentMethod] : '',
    'رقم الفاتورة': e.invoiceNumber ?? '',
    'القيمة (ج.م)': qirshToEgp(Math.abs(signedAmount(e))),
    'الحالة': e.reversalOfId ? 'حركة إلغاء' : e.reversed ? 'ملغاة' : 'سارية',
  }
}

export function exportCategoryStatementToExcel(stmt: CategoryStatement, filename?: string) {
  const wb = XLSX.utils.book_new()
  const summarySheet = XLSX.utils.json_to_sheet([
    { 'البند': stmt.category.name, 'الوصف': stmt.category.description ?? '' },
    {},
    { 'الميزانية التقديرية (ج.م)': qirshToEgp(stmt.category.budgetQirsh) },
    { 'إجمالي المصروف (ج.م)': qirshToEgp(stmt.totalSpentQirsh) },
    {
      'المتبقي من الميزانية (ج.م)':
        stmt.remainingBudgetQirsh === null ? 'بدون ميزانية محددة' : qirshToEgp(stmt.remainingBudgetQirsh),
    },
  ])
  XLSX.utils.book_append_sheet(wb, summarySheet, 'ملخص البند')

  const rows = stmt.entries.map(entryRow)
  const sheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, sheet, 'الحركات')

  if (stmt.itemShares.length > 0) {
    const sharesSheet = XLSX.utils.json_to_sheet(
      stmt.itemShares.map((s) => ({
        'الصنف': s.item.advance.description,
        'المورد': s.item.advance.counterparty ?? '',
        'نصيب البند من الصنف': describeItemUnits(s.item, s.share.units),
        'ملاحظة': s.share.note ?? '',
        'القيمة حسب المدفوع حتى الآن (ج.م)': qirshToEgp(s.amountQirsh),
      })),
    )
    XLSX.utils.book_append_sheet(wb, sharesSheet, 'أصناف موزعة')
  }

  download(wb, filename ?? `بند-${stmt.category.name}.xlsx`)
}

export function exportFunderStatementToExcel(stmt: FunderStatement, filename?: string) {
  const wb = XLSX.utils.book_new()
  const summarySheet = XLSX.utils.json_to_sheet([
    { 'الممول': stmt.funder.name, 'الهاتف': stmt.funder.phone ?? '' },
    {},
    { 'نسبة تحمل المصروفات الحالية (%)': stmt.funder.sharePercent },
    { 'إجمالي ما ساهم به (ج.م)': qirshToEgp(stmt.totalContributedQirsh) },
    { 'نصيبه من المصروفات (ج.م)': qirshToEgp(stmt.totalExpenseShareQirsh) },
    { 'صافي موقفه المالي (ج.م)': qirshToEgp(stmt.netPositionQirsh) },
  ])
  XLSX.utils.book_append_sheet(wb, summarySheet, 'ملخص الممول')

  const rows = stmt.entries.map(entryRow)
  const sheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, sheet, 'الحركات')

  download(wb, filename ?? `ممول-${stmt.funder.name}.xlsx`)
}

export function exportFullProjectToExcel(data: {
  balanceQirsh: number
  totalContributionsQirsh: number
  totalExpensesQirsh: number
  funders: Funder[]
  entries: LedgerEntry[]
  allocations: ExpenseAllocation[]
}) {
  const wb = XLSX.utils.book_new()

  const summarySheet = XLSX.utils.json_to_sheet([
    { 'إجمالي المساهمات (ج.م)': qirshToEgp(data.totalContributionsQirsh) },
    { 'إجمالي المصروفات (ج.م)': qirshToEgp(data.totalExpensesQirsh) },
    { 'رصيد الصندوق الحالي (ج.م)': qirshToEgp(data.balanceQirsh) },
  ])
  XLSX.utils.book_append_sheet(wb, summarySheet, 'ملخص عام')

  const fundersSheet = XLSX.utils.json_to_sheet(
    data.funders.map((f) => {
      const contributed = data.entries
        .filter((e) => e.funderId === f.id)
        .reduce((s, e) => s + signedAmount(e), 0)
      const share = data.allocations.filter((a) => a.funderId === f.id).reduce((s, a) => s + a.amountQirsh, 0)
      return {
        'الممول': f.name,
        'نشط': f.active ? 'نعم' : 'لا',
        'نسبة تحمل المصروفات (%)': f.sharePercent,
        'إجمالي المساهمة (ج.م)': qirshToEgp(contributed),
        'نصيبه من المصروفات (ج.م)': qirshToEgp(share),
        'صافي الموقف (ج.م)': qirshToEgp(contributed - share),
      }
    }),
  )
  XLSX.utils.book_append_sheet(wb, fundersSheet, 'الممولون')

  const allSheet = XLSX.utils.json_to_sheet(data.entries.map(entryRow))
  XLSX.utils.book_append_sheet(wb, allSheet, 'كل الحركات')

  download(wb, 'تقرير-الصندوق-الكامل.xlsx')
}
