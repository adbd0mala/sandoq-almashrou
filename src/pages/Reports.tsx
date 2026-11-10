import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db } from '../db/db'
import {
  LedgerError,
  describeItemUnits,
  getCategoryStatement,
  getFunderStatement,
  getDashboardSummary,
  listCategories,
  listFunders,
  listOpenPayables,
  reverseEntry,
  settlePayable,
  signedAmount,
  type CategoryStatement,
  type FunderStatement,
  type PayableStatus,
} from '../domain/ledger'
import { egpToQirsh, formatEGP } from '../domain/money'
import { Banner, Button, Card, EmptyState, Field, PageTitle, inputClass } from '../components/ui'
import { PAYMENT_METHOD_LABELS, type LedgerEntry, type PaymentMethod } from '../domain/types'
import { ItemsReport } from './ItemsReport'

export type ReportsTab = 'full' | 'funder' | 'category' | 'payables' | 'items'

// xlsx / jspdf / html2canvas are heavy — load them only when an export button
// is actually pressed instead of bloating the app's initial bundle.
const loadExcel = () => import('../export/excel')
const loadPdf = () => import('../export/pdf')

export function Reports({ initialCategoryId, initialTab }: { initialCategoryId?: string; initialTab?: ReportsTab }) {
  const [tab, setTab] = useState<ReportsTab>(initialTab ?? (initialCategoryId ? 'category' : 'full'))

  return (
    <div className="space-y-4">
      <PageTitle>التقارير</PageTitle>
      <div className="grid grid-cols-6 gap-1 bg-slate-100 rounded-xl p-1">
        <TabButton active={tab === 'full'} onClick={() => setTab('full')}>
          تقرير شامل
        </TabButton>
        <TabButton active={tab === 'funder'} onClick={() => setTab('funder')}>
          كشف ممول
        </TabButton>
        <TabButton active={tab === 'category'} onClick={() => setTab('category')}>
          كشف بند
        </TabButton>
        <TabButton wide active={tab === 'payables'} onClick={() => setTab('payables')}>
          المستحقات للموردين
        </TabButton>
        <TabButton wide active={tab === 'items'} onClick={() => setTab('items')}>
          الأصناف والدفعات
        </TabButton>
      </div>

      {tab === 'full' && <FullProjectReport />}
      {tab === 'funder' && <FunderReport />}
      {tab === 'category' && <CategoryReport initialCategoryId={initialCategoryId} />}
      {tab === 'payables' && <PayablesReport />}
      {tab === 'items' && <ItemsReport />}
    </div>
  )
}

function TabButton({
  active,
  wide,
  onClick,
  children,
}: {
  active: boolean
  wide?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`${wide ? 'col-span-3' : 'col-span-2'} px-1 py-2 rounded-lg text-sm leading-tight font-semibold transition ${active ? 'bg-white shadow text-teal-700' : 'text-slate-500'}`}
    >
      {children}
    </button>
  )
}

function EntryRow({ entry, onReversed }: { entry: LedgerEntry; onReversed: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const canReverse = !entry.reversalOfId && !entry.reversed

  async function doReverse() {
    try {
      await reverseEntry(entry.id, reason)
      setConfirming(false)
      onReversed()
    } catch (e) {
      setError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  return (
    <li className="py-2 text-sm">
      <div className="flex justify-between">
        <span className="text-slate-700">{entry.description}</span>
        {entry.affectsVault === false ? (
          <span className="font-semibold tabular-nums text-sky-600">{formatEGP(entry.amountQirsh)}</span>
        ) : (
          <span className={`font-semibold tabular-nums ${signedAmount(entry) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {signedAmount(entry) >= 0 ? '+' : '-'}
            {formatEGP(entry.amountQirsh)}
          </span>
        )}
      </div>
      <div className="text-xs text-slate-400 mt-0.5 flex items-center justify-between">
        <span>
          {entry.date} {entry.paymentMethod ? `· ${PAYMENT_METHOD_LABELS[entry.paymentMethod]}` : ''}
          {entry.invoiceNumber ? ` · فاتورة ${entry.invoiceNumber}` : ''}
          {entry.affectsVault === false && ' · توزيع من دفعة سابقة'}
          {entry.reversed && ' · (ملغاة)'}
          {entry.reversalOfId && ' · حركة إلغاء'}
        </span>
        {canReverse && (
          <button className="text-red-500 no-print" onClick={() => setConfirming(true)}>
            إلغاء الحركة
          </button>
        )}
      </div>
      {confirming && (
        <div className="mt-2 bg-red-50 rounded-lg p-2 space-y-2 no-print">
          {error && <div className="text-red-600 text-xs">{error}</div>}
          <input
            className={inputClass}
            placeholder="سبب الإلغاء"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="danger" onClick={doReverse} disabled={!reason.trim()}>
              تأكيد إلغاء الحركة
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              رجوع
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function FullProjectReport() {
  const printRef = useRef<HTMLDivElement>(null)
  const summary = useLiveQuery(getDashboardSummary, [])
  const funders = useLiveQuery(listFunders, [])
  const entries = useLiveQuery(() => db.ledger.toArray(), [])
  const allocations = useLiveQuery(() => db.allocations.toArray(), [])

  if (!summary || !funders || !entries || !allocations) return null

  return (
    <Card className="space-y-3">
      <div className="flex gap-2">
        <Button
          className="flex-1"
          onClick={async () => (await loadExcel()).exportFullProjectToExcel({ ...summary, funders, entries, allocations })}
        >
          تصدير Excel
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          onClick={async () => printRef.current && (await loadPdf()).exportNodeToPdf(printRef.current, 'تقرير-الصندوق-الكامل.pdf')}
        >
          تصدير PDF
        </Button>
      </div>

      <div ref={printRef} className="p-4" dir="rtl">
        <h2 className="text-lg font-bold mb-3">التقرير المالي العام للصندوق</h2>
        <table className="w-full text-sm mb-4">
          <tbody>
            <tr>
              <td className="py-1 text-slate-500">إجمالي المساهمات</td>
              <td className="py-1 font-semibold text-left">{formatEGP(summary.totalContributionsQirsh)}</td>
            </tr>
            <tr>
              <td className="py-1 text-slate-500">إجمالي المصروفات</td>
              <td className="py-1 font-semibold text-left">{formatEGP(summary.totalExpensesQirsh)}</td>
            </tr>
            <tr>
              <td className="py-1 text-slate-500">رصيد الصندوق الحالي</td>
              <td className="py-1 font-semibold text-left">{formatEGP(summary.balanceQirsh)}</td>
            </tr>
          </tbody>
        </table>

        <h3 className="font-bold mb-2">الممولون</h3>
        <table className="w-full text-sm mb-4 border border-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-1.5 text-right">الممول</th>
              <th className="p-1.5 text-right">النسبة</th>
              <th className="p-1.5 text-right">المساهمة</th>
              <th className="p-1.5 text-right">نصيبه من المصروفات</th>
            </tr>
          </thead>
          <tbody>
            {funders.map((f) => {
              const contributed = entries.filter((e) => e.funderId === f.id).reduce((s, e) => s + signedAmount(e), 0)
              const share = allocations.filter((a) => a.funderId === f.id).reduce((s, a) => s + a.amountQirsh, 0)
              return (
                <tr key={f.id} className="border-t border-slate-100">
                  <td className="p-1.5 break-words max-w-[120px]">{f.name}</td>
                  <td className="p-1.5">{f.sharePercent.toFixed(2)}%</td>
                  <td className="p-1.5">{formatEGP(contributed)}</td>
                  <td className="p-1.5">{formatEGP(share)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <h3 className="font-bold mb-2">كل الحركات</h3>
        <table className="w-full text-sm border border-slate-200">
          <thead className="bg-slate-50">
            <tr>
              <th className="p-1.5 text-right">التاريخ</th>
              <th className="p-1.5 text-right">النوع</th>
              <th className="p-1.5 text-right">الوصف</th>
              <th className="p-1.5 text-right">القيمة</th>
            </tr>
          </thead>
          <tbody>
            {[...entries].sort((a, b) => a.date.localeCompare(b.date)).map((e) => (
              <tr key={e.id} className="border-t border-slate-100">
                <td className="p-1.5">{e.date}</td>
                <td className="p-1.5">
                  {e.type === 'CONTRIBUTION'
                    ? 'مساهمة'
                    : e.affectsVault === false
                      ? 'توزيع دفعة'
                      : e.type === 'ADVANCE'
                        ? 'دفعة صنف'
                        : 'مصروف'}
                </td>
                <td className="p-1.5 break-words max-w-[160px]">{e.description}</td>
                <td className="p-1.5">{formatEGP(e.amountQirsh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function FunderReport() {
  const funders = useLiveQuery(listFunders, [])
  const [funderId, setFunderId] = useState('')
  const [stmt, setStmt] = useState<FunderStatement | null>(null)
  const printRef = useRef<HTMLDivElement>(null)

  async function load(id: string) {
    setFunderId(id)
    if (!id) return setStmt(null)
    setStmt(await getFunderStatement(id))
  }

  if (!funders || funders.length === 0) return <EmptyState>لا يوجد ممولون بعد</EmptyState>

  return (
    <div className="space-y-3">
      <Card>
        <select className={inputClass} value={funderId} onChange={(e) => load(e.target.value)}>
          <option value="">اختر الممول</option>
          {funders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Card>

      {stmt && (
        <Card className="space-y-3">
          <div className="flex gap-2">
            <Button className="flex-1" onClick={async () => (await loadExcel()).exportFunderStatementToExcel(stmt)}>
              تصدير Excel
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={async () => printRef.current && (await loadPdf()).exportNodeToPdf(printRef.current, `ممول-${stmt.funder.name}.pdf`)}
            >
              تصدير PDF
            </Button>
          </div>

          <div ref={printRef} className="p-4" dir="rtl">
            <h2 className="text-lg font-bold mb-2">كشف حساب الممول: {stmt.funder.name}</h2>
            <table className="w-full text-sm mb-3">
              <tbody>
                <tr>
                  <td className="py-1 text-slate-500">نسبة تحمل المصروفات</td>
                  <td className="py-1 font-semibold text-left">{stmt.funder.sharePercent.toFixed(2)}%</td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-500">إجمالي ما ساهم به</td>
                  <td className="py-1 font-semibold text-left">{formatEGP(stmt.totalContributedQirsh)}</td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-500">نصيبه من المصروفات</td>
                  <td className="py-1 font-semibold text-left">{formatEGP(stmt.totalExpenseShareQirsh)}</td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-500">صافي موقفه المالي</td>
                  <td className="py-1 font-bold text-left">{formatEGP(stmt.netPositionQirsh)}</td>
                </tr>
              </tbody>
            </table>
            <h3 className="font-bold mb-2">الحركات</h3>
            {stmt.entries.length === 0 ? (
              <EmptyState>لا توجد حركات</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {stmt.entries.map((e) => (
                  <EntryRow key={e.id} entry={e} onReversed={() => load(funderId)} />
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

function CategoryReport({ initialCategoryId }: { initialCategoryId?: string }) {
  const categories = useLiveQuery(listCategories, [])
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? '')
  const [stmt, setStmt] = useState<CategoryStatement | null>(null)
  const printRef = useRef<HTMLDivElement>(null)

  async function load(id: string) {
    setCategoryId(id)
    if (!id) return setStmt(null)
    setStmt(await getCategoryStatement(id))
  }

  useEffect(() => {
    if (initialCategoryId) load(initialCategoryId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCategoryId])

  if (!categories || categories.length === 0) return <EmptyState>لا توجد بنود بعد</EmptyState>

  return (
    <div className="space-y-3">
      <Card>
        <select className={inputClass} value={categoryId} onChange={(e) => load(e.target.value)}>
          <option value="">اختر البند</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Card>

      {stmt && (
        <Card className="space-y-3">
          <div className="flex gap-2">
            <Button className="flex-1" onClick={async () => (await loadExcel()).exportCategoryStatementToExcel(stmt)}>
              تصدير Excel
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={async () => printRef.current && (await loadPdf()).exportNodeToPdf(printRef.current, `بند-${stmt.category.name}.pdf`)}
            >
              تصدير PDF
            </Button>
          </div>

          <div ref={printRef} className="p-4" dir="rtl">
            <h2 className="text-lg font-bold mb-2">كشف حساب بند: {stmt.category.name}</h2>
            <table className="w-full text-sm mb-3">
              <tbody>
                <tr>
                  <td className="py-1 text-slate-500">الميزانية التقديرية</td>
                  <td className="py-1 font-semibold text-left">{stmt.category.budgetQirsh > 0 ? formatEGP(stmt.category.budgetQirsh) : 'غير محددة'}</td>
                </tr>
                <tr>
                  <td className="py-1 text-slate-500">إجمالي المصروف</td>
                  <td className="py-1 font-semibold text-left">{formatEGP(stmt.totalSpentQirsh)}</td>
                </tr>
                {stmt.remainingBudgetQirsh !== null && (
                  <tr>
                    <td className="py-1 text-slate-500">المتبقي</td>
                    <td className="py-1 font-bold text-left">{formatEGP(stmt.remainingBudgetQirsh)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <h3 className="font-bold mb-2">الحركات</h3>
            {stmt.entries.length === 0 ? (
              stmt.itemShares.length === 0 && <EmptyState>لا توجد حركات</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {stmt.entries.map((e) => (
                  <EntryRow key={e.id} entry={e} onReversed={() => load(categoryId)} />
                ))}
              </ul>
            )}
            {stmt.itemShares.length > 0 && (
              <>
                <h3 className="font-bold mt-3 mb-2">نصيب البند من أصناف موزَّعة</h3>
                <ul className="divide-y divide-slate-100">
                  {stmt.itemShares.map((s) => (
                    <li key={s.share.id} className="py-2 text-sm flex justify-between gap-2">
                      <span className="text-slate-700 min-w-0 break-words">
                        {s.item.advance.description} — {describeItemUnits(s.item, s.share.units)}
                        {s.share.note && <span className="text-slate-400"> · {s.share.note}</span>}
                      </span>
                      <span className="font-semibold tabular-nums text-sky-600 shrink-0">{formatEGP(s.amountQirsh)}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-slate-400 mt-1 no-print">
                  القيمة محسوبة من المدفوع لكل صنف لحد دلوقتي، وبتتعدل لوحدها لو اتدفع باقي حسابه أو اتغيّر توزيعه (من تبويب «الأصناف والدفعات»).
                </p>
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

function PayablesReport() {
  const payables = useLiveQuery(listOpenPayables, [])
  const [settling, setSettling] = useState<PayableStatus | null>(null)

  if (!payables) return null

  if (payables.length === 0) {
    return (
      <Card>
        <EmptyState>مفيش مستحقات مفتوحة لموردين دلوقتي. لما تسجّل مصروف بدفعة جزئية هيظهر هنا</EmptyState>
      </Card>
    )
  }

  const totalRemaining = payables.reduce((s, p) => s + p.remainingQirsh, 0)

  return (
    <div className="space-y-3">
      <Card className="bg-amber-50 border-amber-200">
        <div className="text-sm text-amber-700">إجمالي المستحق لكل الموردين</div>
        <div className="text-xl font-bold text-amber-800">{formatEGP(totalRemaining)}</div>
      </Card>

      {payables.map((p) => (
        <Card key={p.payable.id}>
          <div className="flex justify-between items-start">
            <div>
              <div className="font-semibold text-slate-800">{p.payable.supplierName}</div>
              <div className="text-xs text-slate-400">{p.payable.description} · {p.payable.date}</div>
            </div>
            <span className="text-amber-700 font-bold tabular-nums">{formatEGP(p.remainingQirsh)}</span>
          </div>
          <div className="text-xs text-slate-500 mt-2">
            إجمالي الفاتورة: {formatEGP(p.payable.totalQirsh)} · المدفوع: {formatEGP(p.paidQirsh)}
          </div>
          <Button variant="secondary" className="w-full mt-3" onClick={() => setSettling(p)}>
            سداد جزء أو كل الباقي
          </Button>
        </Card>
      ))}

      {settling && <SettlePayableModal status={settling} onClose={() => setSettling(null)} />}
    </div>
  )
}

function SettlePayableModal({ status, onClose }: { status: PayableStatus; onClose: () => void }) {
  const [amount, setAmount] = useState(String(status.remainingQirsh / 100))
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [error, setError] = useState('')

  const amountQirsh = Number(amount) > 0 ? egpToQirsh(Number(amount)) : 0

  async function submit() {
    setError('')
    try {
      await settlePayable({ payableId: status.payable.id, amountQirsh, date, paymentMethod, invoiceNumber })
      onClose()
    } catch (e) {
      setError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-4 pb-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-lg text-slate-800 mb-3">سداد مستحق: {status.payable.supplierName}</h2>
        {error && <Banner kind="error">{error}</Banner>}
        <div className="text-sm text-slate-500 mb-3">المتبقي حاليًا: {formatEGP(status.remainingQirsh)}</div>
        <Field label="قيمة السداد (ج.م)">
          <input type="number" inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        {amount !== '' && amountQirsh <= 0 && <p className="text-xs text-red-600 -mt-2 mb-3">القيمة لازم تكون أكبر من صفر</p>}
        {amountQirsh > status.remainingQirsh && (
          <p className="text-xs text-red-600 -mt-2 mb-3">القيمة أكبر من المتبقي ({formatEGP(status.remainingQirsh)})</p>
        )}
        <Field label="التاريخ">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="طريقة الدفع">
          <select className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="رقم الفاتورة (اختياري)">
          <input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={submit} disabled={amountQirsh <= 0 || amountQirsh > status.remainingQirsh}>
            تأكيد السداد
          </Button>
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </div>
    </div>
  )
}
