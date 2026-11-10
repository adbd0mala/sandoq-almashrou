import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { db } from '../db/db'
import {
  LedgerError,
  allocateAdvance,
  getCategoryStatement,
  getFunderStatement,
  getDashboardSummary,
  listOpenAdvances,
  listOpenPayables,
  reverseEntry,
  settlePayable,
  signedAmount,
  type AdvanceStatus,
  type CategoryStatement,
  type FunderStatement,
  type PayableStatus,
} from '../domain/ledger'
import { egpToQirsh, formatEGP } from '../domain/money'
import { Banner, Button, Card, EmptyState, Field, PageTitle, inputClass } from '../components/ui'
import { PAYMENT_METHOD_LABELS, type ExpenseCategory, type LedgerEntry, type PaymentMethod } from '../domain/types'

type Tab = 'full' | 'funder' | 'category' | 'payables' | 'advances'

// xlsx / jspdf / html2canvas are heavy — load them only when an export button
// is actually pressed instead of bloating the app's initial bundle.
const loadExcel = () => import('../export/excel')
const loadPdf = () => import('../export/pdf')

export function Reports({ initialCategoryId }: { initialCategoryId?: string }) {
  const [tab, setTab] = useState<Tab>(initialCategoryId ? 'category' : 'full')

  return (
    <div className="space-y-4">
      <PageTitle>التقارير</PageTitle>
      <div className="flex gap-2 bg-slate-100 rounded-xl p-1 overflow-x-auto">
        <TabButton active={tab === 'full'} onClick={() => setTab('full')}>
          تقرير شامل
        </TabButton>
        <TabButton active={tab === 'funder'} onClick={() => setTab('funder')}>
          كشف ممول
        </TabButton>
        <TabButton active={tab === 'category'} onClick={() => setTab('category')}>
          كشف بند
        </TabButton>
        <TabButton active={tab === 'payables'} onClick={() => setTab('payables')}>
          المستحقات للموردين
        </TabButton>
        <TabButton active={tab === 'advances'} onClick={() => setTab('advances')}>
          دفعات تحت التوزيع
        </TabButton>
      </div>

      {tab === 'full' && <FullProjectReport />}
      {tab === 'funder' && <FunderReport />}
      {tab === 'category' && <CategoryReport initialCategoryId={initialCategoryId} />}
      {tab === 'payables' && <PayablesReport />}
      {tab === 'advances' && <AdvancesReport />}
    </div>
  )
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap px-3 py-2 rounded-lg text-sm font-semibold transition ${active ? 'bg-white shadow text-teal-700' : 'text-slate-500'}`}
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
  const funders = useLiveQuery(() => db.funders.toArray(), [])
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
                        ? 'دفعة غير موزعة'
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
  const funders = useLiveQuery(() => db.funders.toArray(), [])
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
  const categories = useLiveQuery(() => db.categories.toArray(), [])
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
              <EmptyState>لا توجد حركات</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {stmt.entries.map((e) => (
                  <EntryRow key={e.id} entry={e} onReversed={() => load(categoryId)} />
                ))}
              </ul>
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

function AdvancesReport() {
  const advances = useLiveQuery(listOpenAdvances, [])
  const categories = useLiveQuery(() => db.categories.toArray(), [])
  const [allocating, setAllocating] = useState<AdvanceStatus | null>(null)

  if (!advances || !categories) return null

  if (advances.length === 0) {
    return (
      <Card>
        <EmptyState>
          مفيش دفعات تحت التوزيع دلوقتي. لما تسجّل مصروف من تبويب "دفعة بدون بند" هيظهر هنا لحد ما توزعه على البنود
        </EmptyState>
      </Card>
    )
  }

  const totalUnallocated = advances.reduce((s, a) => s + a.remainingQirsh, 0)
  const activeCategories = categories.filter((c) => c.active)

  return (
    <div className="space-y-3">
      <Card className="bg-amber-50 border-amber-200">
        <div className="text-sm text-amber-700">إجمالي الدفعات لسه مش موزعة</div>
        <div className="text-xl font-bold text-amber-800">{formatEGP(totalUnallocated)}</div>
      </Card>

      {advances.map((a) => (
        <AdvanceCard key={a.advance.id} status={a} activeCategories={activeCategories} onAllocate={() => setAllocating(a)} />
      ))}

      {allocating && (
        <AllocateAdvanceModal status={allocating} categories={activeCategories} onClose={() => setAllocating(null)} />
      )}
    </div>
  )
}

function AdvanceCard({
  status: a,
  activeCategories,
  onAllocate,
}: {
  status: AdvanceStatus
  activeCategories: ExpenseCategory[]
  onAllocate: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  async function doReverse() {
    try {
      await reverseEntry(a.advance.id, reason)
      setConfirming(false)
    } catch (e) {
      setError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  return (
    <Card>
      <div className="flex justify-between items-start">
        <div>
          <div className="font-semibold text-slate-800">{a.advance.description}</div>
          <div className="text-xs text-slate-400">
            {a.advance.counterparty ? `${a.advance.counterparty} · ` : ''}
            {a.advance.date}
          </div>
        </div>
        <span className="text-amber-700 font-bold tabular-nums">{formatEGP(a.remainingQirsh)}</span>
      </div>
      <div className="text-xs text-slate-500 mt-2">
        إجمالي الدفعة: {formatEGP(a.advance.amountQirsh)} · الموزَّع: {formatEGP(a.allocatedQirsh)}
      </div>
      {activeCategories.length > 0 ? (
        <Button variant="secondary" className="w-full mt-3" onClick={onAllocate}>
          توزيع على البنود
        </Button>
      ) : (
        <div className="text-xs text-red-500 mt-3">أضف بند مصروفات أولاً عشان تقدر توزّع الدفعة دي</div>
      )}

      {a.allocatedQirsh === 0 && !confirming && (
        <button className="text-red-500 text-xs mt-2" onClick={() => setConfirming(true)}>
          إلغاء الدفعة بالكامل (لو مسجلة غلط)
        </button>
      )}
      {confirming && (
        <div className="mt-2 bg-red-50 rounded-lg p-2 space-y-2">
          {error && <div className="text-red-600 text-xs">{error}</div>}
          <input className={inputClass} placeholder="سبب الإلغاء" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="danger" onClick={doReverse} disabled={!reason.trim()}>
              تأكيد إلغاء الدفعة
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              رجوع
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

interface AllocLine {
  key: string
  categoryId: string
  amount: string
  note: string
}

function AllocateAdvanceModal({
  status,
  categories,
  onClose,
}: {
  status: AdvanceStatus
  categories: ExpenseCategory[]
  onClose: () => void
}) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState<AllocLine[]>([{ key: crypto.randomUUID(), categoryId: '', amount: '', note: '' }])
  const [error, setError] = useState('')

  function updateLine(key: string, patch: Partial<AllocLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }
  function removeLine(key: string) {
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls))
  }

  const validLines = lines.filter((l) => l.categoryId && Number(l.amount) > 0)
  const totalQirsh = validLines.reduce((s, l) => s + egpToQirsh(Number(l.amount)), 0)
  const exceedsRemaining = totalQirsh > status.remainingQirsh
  const canSubmit = validLines.length > 0 && validLines.length === lines.length && !exceedsRemaining

  async function submit() {
    setError('')
    try {
      await allocateAdvance({
        advanceLedgerEntryId: status.advance.id,
        date,
        lines: lines.map((l) => ({ categoryId: l.categoryId, amountQirsh: egpToQirsh(Number(l.amount)), note: l.note })),
      })
      onClose()
    } catch (e) {
      setError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-4 pb-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-lg text-slate-800 mb-3">توزيع دفعة: {status.advance.description}</h2>
        {error && <Banner kind="error">{error}</Banner>}
        <div className="text-sm text-slate-500 mb-3">المتبقي غير الموزَّع: {formatEGP(status.remainingQirsh)}</div>

        <Field label="تاريخ التوزيع">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <div className="space-y-3 mb-3">
          {lines.map((line, idx) => (
            <div key={line.key} className="border border-slate-200 rounded-xl p-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-slate-400">بند {idx + 1}</span>
                {lines.length > 1 && (
                  <button className="text-red-500 text-xs" onClick={() => removeLine(line.key)}>
                    حذف السطر
                  </button>
                )}
              </div>
              <select
                className={`${inputClass} mb-2`}
                value={line.categoryId}
                onChange={(e) => updateLine(line.key, { categoryId: e.target.value })}
              >
                <option value="">اختر البند</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="القيمة (ج.م)"
                  className={inputClass}
                  value={line.amount}
                  onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                />
                <input
                  placeholder="ملاحظة (اختياري)"
                  className={inputClass}
                  value={line.note}
                  onChange={(e) => updateLine(line.key, { note: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>

        <Button
          variant="secondary"
          className="w-full mb-3"
          onClick={() => setLines((ls) => [...ls, { key: crypto.randomUUID(), categoryId: '', amount: '', note: '' }])}
        >
          + إضافة بند
        </Button>

        <div className={`text-sm mb-3 font-semibold ${exceedsRemaining ? 'text-red-600' : 'text-slate-700'}`}>
          إجمالي الموزَّع الآن: {formatEGP(totalQirsh)} {exceedsRemaining && '(أكبر من المتبقي!)'}
        </div>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={submit} disabled={!canSubmit}>
            تأكيد التوزيع
          </Button>
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </div>
    </div>
  )
}
