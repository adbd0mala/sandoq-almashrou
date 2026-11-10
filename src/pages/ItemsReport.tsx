import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import {
  LedgerError,
  addAdvanceShares,
  allocateAdvance,
  describeItemUnits,
  listAdvanceItems,
  recordAdvancePayment,
  removeAdvanceShare,
  reverseEntry,
  type AdvanceStatus,
} from '../domain/ledger'
import { egpToQirsh, formatEGP, formatUnits } from '../domain/money'
import { Banner, Button, Card, EmptyState, Field, Modal, inputClass } from '../components/ui'
import { PAYMENT_METHOD_LABELS, type ExpenseCategory, type PaymentMethod } from '../domain/types'

const todayIso = () => new Date().toISOString().slice(0, 10)
const errorText = (e: unknown) => (e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')

/** Items bought for several بنود, and advances paid before their بند was
 * known: what was paid for each, how it's split across بنود, what's left. */
export function ItemsReport() {
  const items = useLiveQuery(listAdvanceItems, [])
  const categories = useLiveQuery(() => db.categories.toArray(), [])
  const [distributingId, setDistributingId] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)

  if (!items || !categories) return null

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState>
          مفيش أصناف أو دفعات مسجلة. سجّل صنف من «تسجيل مصروف» ← «صنف يوزَّع لاحقًا» وهيظهر هنا عشان توزّعه على البنود
        </EmptyState>
      </Card>
    )
  }

  const open = items.filter((i) => i.remainingQirsh > 0)
  const done = items.filter((i) => i.remainingQirsh <= 0)
  const activeCategories = categories.filter((c) => c.active)
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? 'بند محذوف'
  const distributing = items.find((i) => i.advance.id === distributingId)
  const paying = items.find((i) => i.advance.id === payingId)

  const card = (item: AdvanceStatus) => (
    <ItemCard
      key={item.advance.id}
      item={item}
      categoryName={categoryName}
      hasCategories={activeCategories.length > 0}
      onDistribute={() => setDistributingId(item.advance.id)}
      onPay={() => setPayingId(item.advance.id)}
    />
  )

  return (
    <div className="space-y-3">
      {open.length > 0 && (
        <Card className="bg-amber-50 border-amber-200">
          <div className="text-sm text-amber-700">إجمالي المدفوع ولسه مش موزَّع على بنود</div>
          <div className="text-xl font-bold text-amber-800">{formatEGP(open.reduce((s, i) => s + i.remainingQirsh, 0))}</div>
        </Card>
      )}

      {open.map(card)}

      {done.length > 0 && (
        <>
          <button className="text-sm text-teal-700 font-semibold" onClick={() => setShowDone((v) => !v)}>
            {showDone ? 'إخفاء' : 'عرض'} الأصناف الموزَّعة بالكامل ({formatUnits(done.length)})
          </button>
          {showDone && done.map(card)}
        </>
      )}

      {distributing && (
        <DistributeModal key={distributing.advance.id} item={distributing} categories={activeCategories} onClose={() => setDistributingId(null)} />
      )}
      {paying && <AddPaymentModal key={paying.advance.id} item={paying} onClose={() => setPayingId(null)} />}
    </div>
  )
}

function ItemCard({
  item,
  categoryName,
  hasCategories,
  onDistribute,
  onPay,
}: {
  item: AdvanceStatus
  categoryName: (id: string) => string
  hasCategories: boolean
  onDistribute: () => void
  onPay: () => void
}) {
  const [showPayments, setShowPayments] = useState(false)
  const { advance } = item
  const fixedRows = item.allocationEntries.filter((e) => !e.reversalOfId && !e.reversed)
  const usesShares = item.hasQuantity || item.shares.length > 0
  const canDistribute = usesShares ? item.remainingUnits > 0 : item.remainingQirsh > 0

  return (
    <Card>
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-slate-800 break-words">{advance.description}</div>
          <div className="text-xs text-slate-400">
            {advance.counterparty ? `${advance.counterparty} · ` : ''}
            {advance.date}
          </div>
        </div>
        {item.hasQuantity && (
          <span className="shrink-0 text-xs font-semibold bg-slate-100 text-slate-600 rounded-lg px-2 py-1">
            {formatUnits(item.basisUnits)} {advance.unitName || 'وحدة'}
          </span>
        )}
      </div>

      <div className="flex justify-between text-sm mt-3">
        <span className="text-slate-500">المدفوع لحد دلوقتي</span>
        <span className="font-semibold text-slate-800 tabular-nums">{formatEGP(item.totalPaidQirsh)}</span>
      </div>
      <div className="flex justify-between text-sm mt-1">
        <span className="text-slate-500">غير موزَّع على بنود</span>
        {canDistribute ? (
          <span className="font-bold text-amber-700 tabular-nums">
            {usesShares && `${describeItemUnits(item, item.remainingUnits)} = `}
            {formatEGP(item.remainingQirsh)}
          </span>
        ) : (
          <span className="font-semibold text-emerald-600">موزَّع بالكامل</span>
        )}
      </div>

      {(item.shares.length > 0 || fixedRows.length > 0) && (
        <ul className="mt-3 border-t border-slate-100 divide-y divide-slate-100">
          {item.shares.map(({ share, amountQirsh }) => (
            <li key={share.id} className="py-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-slate-700 min-w-0 break-words">
                  {categoryName(share.categoryId)} — {describeItemUnits(item, share.units)}
                  {share.note && <span className="text-slate-400"> · {share.note}</span>}
                </span>
                <span className="font-semibold text-slate-800 tabular-nums shrink-0">{formatEGP(amountQirsh)}</span>
              </div>
              <button
                className="text-red-500 text-xs mt-0.5"
                onClick={() => confirm(`هترجّع نصيب «${categoryName(share.categoryId)}» من الصنف ده لغير الموزَّع. متأكد؟`) && removeAdvanceShare(share.id)}
              >
                حذف التوزيع ده
              </button>
            </li>
          ))}
          {fixedRows.map((e) => (
            <li key={e.id} className="py-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-slate-700 min-w-0 break-words">
                  {categoryName(e.categoryId ?? '')} — مبلغ ثابت · {e.date}
                </span>
                <span className="font-semibold text-slate-800 tabular-nums shrink-0">{formatEGP(e.amountQirsh)}</span>
              </div>
              <ReverseControl entryId={e.id} label="إلغاء التوزيع ده" />
            </li>
          ))}
        </ul>
      )}

      <button className="text-xs text-teal-700 font-semibold mt-3" onClick={() => setShowPayments((v) => !v)}>
        {showPayments ? 'إخفاء' : 'عرض'} الدفعات ({formatUnits(item.payments.length)})
      </button>
      {showPayments && (
        <ul className="divide-y divide-slate-100">
          {item.payments.map((p) => (
            <li key={p.id} className="py-2 text-sm">
              <div className="flex justify-between gap-2">
                <span className={p.reversed ? 'text-slate-400 line-through' : 'text-slate-700'}>
                  {p.date}
                  {p.paymentMethod ? ` · ${PAYMENT_METHOD_LABELS[p.paymentMethod]}` : ''}
                  {p.invoiceNumber ? ` · فاتورة ${p.invoiceNumber}` : ''}
                </span>
                <span className={`font-semibold tabular-nums shrink-0 ${p.reversed ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                  {formatEGP(p.amountQirsh)}
                </span>
              </div>
              {p.reversed ? <span className="text-xs text-slate-400">ملغاة</span> : <ReverseControl entryId={p.id} label="إلغاء الدفعة دي" />}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2 mt-3">
        {canDistribute && hasCategories && (
          <Button variant="secondary" className="flex-1" onClick={onDistribute}>
            توزيع على البنود
          </Button>
        )}
        <Button variant="secondary" className="flex-1" onClick={onPay}>
          إضافة دفعة
        </Button>
      </div>
      {canDistribute && !hasCategories && <div className="text-xs text-red-500 mt-2">أضف بند مصروفات أولاً عشان تقدر توزّع الصنف ده</div>}
    </Card>
  )
}

/** "Cancel" link that asks for a reason, then posts a reversal entry. */
function ReverseControl({ entryId, label }: { entryId: string; label: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  if (!open) {
    return (
      <button className="text-red-500 text-xs mt-0.5" onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }

  async function submit() {
    try {
      await reverseEntry(entryId, reason)
      setOpen(false)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="mt-2 bg-red-50 rounded-lg p-2 space-y-2">
      {error && <div className="text-red-600 text-xs">{error}</div>}
      <input className={inputClass} placeholder="سبب الإلغاء" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button variant="danger" onClick={submit} disabled={!reason.trim()}>
          تأكيد الإلغاء
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          رجوع
        </Button>
      </div>
    </div>
  )
}

type Mode = 'units' | 'percent' | 'amount'

const MODE_LABELS: Record<Mode, string> = { units: 'بالوحدات', percent: 'بالنسبة %', amount: 'بالمبلغ' }

interface Line {
  key: string
  categoryId: string
  value: string
  note: string
}

const newLine = (): Line => ({ key: crypto.randomUUID(), categoryId: '', value: '', note: '' })

function DistributeModal({ item, categories, onClose }: { item: AdvanceStatus; categories: ExpenseCategory[]; onClose: () => void }) {
  // An item with a quantity is split by its units (or a percent of them).
  // One without is split by percent or by fixed amounts — whichever it
  // started with, since the two can't be mixed on the same item.
  const modes: Mode[] = item.hasQuantity
    ? ['units', 'percent']
    : item.fixedAllocatedQirsh > 0
      ? ['amount']
      : item.shares.length > 0
        ? ['percent']
        : ['percent', 'amount']

  const [mode, setMode] = useState<Mode>(modes[0])
  const [lines, setLines] = useState<Line[]>([newLine()])
  const [date, setDate] = useState(todayIso())
  const [error, setError] = useState('')

  const unitLabel = item.advance.unitName || 'وحدة'
  const toUnits = (v: number) => (mode === 'percent' ? (item.basisUnits * v) / 100 : v)
  const remaining = mode === 'amount' ? item.remainingQirsh / 100 : mode === 'percent' ? (item.remainingUnits / item.basisUnits) * 100 : item.remainingUnits
  const unitTolerance = Math.max(item.basisUnits * 0.0002, 0.005) // same slack the ledger allows for rounded input

  const values = lines.map((l) => (Number(l.value) > 0 ? Number(l.value) : 0))
  const total = values.reduce((s, v) => s + v, 0)
  const exceeds = mode === 'amount' ? egpToQirsh(total) > item.remainingQirsh : toUnits(total) - item.remainingUnits > unitTolerance
  const complete = lines.every((l, idx) => l.categoryId && values[idx] > 0)

  // What a share is worth right now, from what has been paid for the item so far.
  const paidForShares = item.totalPaidQirsh - item.fixedAllocatedQirsh
  const worth = (v: number) => Math.round((paidForShares * toUnits(v)) / item.basisUnits)

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  function fillRest(key: string) {
    const others = lines.reduce((s, l, idx) => (l.key === key ? s : s + values[idx]), 0)
    const rest = Math.max(0, remaining - others)
    updateLine(key, { value: mode === 'amount' ? rest.toFixed(2) : String(Number(rest.toFixed(4))) })
  }

  async function submit() {
    setError('')
    try {
      if (mode === 'amount') {
        await allocateAdvance({
          advanceLedgerEntryId: item.advance.id,
          date,
          lines: lines.map((l) => ({ categoryId: l.categoryId, amountQirsh: egpToQirsh(Number(l.value)), note: l.note })),
        })
      } else {
        await addAdvanceShares({
          advanceId: item.advance.id,
          lines: lines.map((l) => ({ categoryId: l.categoryId, units: toUnits(Number(l.value)), note: l.note })),
        })
      }
      onClose()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const remainingText =
    mode === 'amount'
      ? formatEGP(item.remainingQirsh)
      : `${mode === 'percent' ? `${formatUnits(remaining)}%` : `${formatUnits(remaining)} ${unitLabel}`} = ${formatEGP(item.remainingQirsh)}`

  return (
    <Modal open onClose={onClose} title={`توزيع: ${item.advance.description}`}>
      {error && <Banner kind="error">{error}</Banner>}

      {modes.length > 1 && (
        <div className="flex gap-2 bg-slate-100 rounded-xl p-1 mb-3">
          {modes.map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m)
                setLines([newLine()])
              }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${mode === m ? 'bg-white shadow text-teal-700' : 'text-slate-500'}`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      )}

      <div className="text-sm text-slate-500 mb-1">غير موزَّع: {remainingText}</div>
      {mode !== 'amount' && (
        <p className="text-xs text-slate-400 mb-3">
          قيمة كل بند بتتحسب من المدفوع للصنف لحد دلوقتي ({formatEGP(paidForShares)}). لو دفعت باقي الحساب بعدين، نصيب كل بند هيزيد لوحده
          بنفس النسبة.
        </p>
      )}

      {mode === 'amount' && (
        <Field label="تاريخ التوزيع">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      )}

      <div className="space-y-3 mb-3">
        {lines.map((line, idx) => (
          <div key={line.key} className="border border-slate-200 rounded-xl p-3">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs text-slate-400">بند {formatUnits(idx + 1)}</span>
              <span className="flex gap-3">
                <button className="text-teal-700 text-xs font-semibold" onClick={() => fillRest(line.key)}>
                  كل الباقي
                </button>
                {lines.length > 1 && (
                  <button className="text-red-500 text-xs" onClick={() => setLines((ls) => ls.filter((l) => l.key !== line.key))}>
                    حذف السطر
                  </button>
                )}
              </span>
            </div>
            <select className={`${inputClass} mb-2`} value={line.categoryId} onChange={(e) => updateLine(line.key, { categoryId: e.target.value })}>
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
                placeholder={mode === 'amount' ? 'القيمة (ج.م)' : mode === 'percent' ? 'النسبة %' : `العدد (${unitLabel})`}
                className={inputClass}
                value={line.value}
                onChange={(e) => updateLine(line.key, { value: e.target.value })}
              />
              <input placeholder="ملاحظة (اختياري)" className={inputClass} value={line.note} onChange={(e) => updateLine(line.key, { note: e.target.value })} />
            </div>
            {mode !== 'amount' && values[idx] > 0 && <div className="text-xs text-slate-500 mt-1">≈ {formatEGP(worth(values[idx]))} حاليًا</div>}
          </div>
        ))}
      </div>

      <Button variant="secondary" className="w-full mb-3" onClick={() => setLines((ls) => [...ls, newLine()])}>
        + إضافة بند
      </Button>

      {exceeds && <p className="text-sm text-red-600 font-semibold mb-3">الإجمالي أكبر من غير الموزَّع من الصنف</p>}

      <div className="flex gap-2">
        <Button className="flex-1" onClick={submit} disabled={!complete || exceeds}>
          تأكيد التوزيع
        </Button>
        <Button variant="secondary" onClick={onClose}>
          إلغاء
        </Button>
      </div>
    </Modal>
  )
}

function AddPaymentModal({ item, onClose }: { item: AdvanceStatus; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayIso())
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const amountQirsh = Number(amount) > 0 ? egpToQirsh(Number(amount)) : 0
  const usesShares = item.hasQuantity || item.shares.length > 0

  async function submit() {
    setError('')
    try {
      await recordAdvancePayment({ advanceId: item.advance.id, amountQirsh, date, paymentMethod, invoiceNumber, note })
      onClose()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Modal open onClose={onClose} title={`دفعة إضافية: ${item.advance.description}`}>
      {error && <Banner kind="error">{error}</Banner>}
      <p className="text-xs text-slate-500 mb-3">
        المدفوع للصنف لحد دلوقتي {formatEGP(item.totalPaidQirsh)}. الدفعة دي بتتخصم من الصندوق وبتتضاف على حساب الصنف
        {usesShares ? '، وبتتوزع لوحدها على البنود بنفس توزيع الصنف.' : '، وبتزوّد غير الموزَّع منه.'}
      </p>
      <Field label="القيمة (ج.م)">
        <input type="number" inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      {amount !== '' && amountQirsh <= 0 && <p className="text-xs text-red-600 -mt-2 mb-3">القيمة لازم تكون أكبر من صفر</p>}
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
      <Field label="ملاحظة (اختياري)">
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: باقي الحساب" />
      </Field>
      <Field label="رقم الفاتورة (اختياري)">
        <input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={submit} disabled={amountQirsh <= 0}>
          تسجيل الدفعة
        </Button>
        <Button variant="secondary" onClick={onClose}>
          إلغاء
        </Button>
      </div>
    </Modal>
  )
}
