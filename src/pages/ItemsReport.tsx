import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import {
  LedgerError,
  addAdvanceShares,
  allocateAdvance,
  describeItemUnits,
  listAdvanceItems,
  listCategories,
  recordAdvancePayment,
  removeAdvanceShare,
  reverseEntry,
  setAdvanceAgreedTotal,
  updateAdvanceItem,
  type AdvanceStatus,
} from '../domain/ledger'
import { egpToQirsh, formatEGP, formatUnits } from '../domain/money'
import { Banner, Button, Card, EmptyState, Field, Modal, inputClass } from '../components/ui'
import { EditEntryModal } from '../components/EditEntryModal'
import { PAYMENT_METHOD_LABELS, type ExpenseCategory, type LedgerEntry, type PaymentMethod } from '../domain/types'

const todayIso = () => new Date().toISOString().slice(0, 10)
const errorText = (e: unknown) => (e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')

/** Items bought for several بنود, and advances paid before their بند was
 * known: what was paid for each, how it's split across بنود, what's left. */
export function ItemsReport({ showHistory }: { showHistory: boolean }) {
  const allItems = useLiveQuery(listAdvanceItems, [])
  const categories = useLiveQuery(listCategories, [])
  const [distributingId, setDistributingId] = useState<string | null>(null)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [showDone, setShowDone] = useState(false)

  if (!allItems || !categories) return null

  // An item whose every payment was cancelled is history, like a cancelled entry.
  const items = showHistory ? allItems : allItems.filter((i) => !i.cancelled)

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState>
          مفيش أصناف أو دفعات مسجلة. سجّل صنف من «تسجيل مصروف» ← «صنف يوزَّع لاحقًا» وهيظهر هنا عشان توزّعه على البنود
        </EmptyState>
      </Card>
    )
  }

  const needsAttention = (i: AdvanceStatus) => i.remainingQirsh > 0 || (i.owedQirsh ?? 0) > 0
  const open = items.filter(needsAttention)
  const done = items.filter((i) => !needsAttention(i))
  const totalUndistributed = open.reduce((s, i) => s + Math.max(0, i.remainingQirsh), 0)
  const totalOwed = open.reduce((s, i) => s + Math.max(0, i.owedQirsh ?? 0), 0)
  const activeCategories = categories.filter((c) => c.active)
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? 'بند محذوف'
  const distributing = items.find((i) => i.advance.id === distributingId)
  const paying = items.find((i) => i.advance.id === payingId)

  const card = (item: AdvanceStatus) => (
    <ItemCard
      key={item.advance.id}
      item={item}
      showHistory={showHistory}
      categoryName={categoryName}
      hasCategories={activeCategories.length > 0}
      onDistribute={() => setDistributingId(item.advance.id)}
      onPay={() => setPayingId(item.advance.id)}
    />
  )

  return (
    <div className="space-y-3">
      {(totalUndistributed > 0 || totalOwed > 0) && (
        <Card className="bg-amber-50 border-amber-200 space-y-2">
          {totalUndistributed > 0 && (
            <div>
              <div className="text-sm text-amber-700">إجمالي المدفوع ولسه مش موزَّع على بنود</div>
              <div className="text-xl font-bold text-amber-800">{formatEGP(totalUndistributed)}</div>
            </div>
          )}
          {totalOwed > 0 && (
            <div>
              <div className="text-sm text-amber-700">باقي حساب أصناف للموردين</div>
              <div className="text-xl font-bold text-amber-800">{formatEGP(totalOwed)}</div>
            </div>
          )}
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
  showHistory,
  categoryName,
  hasCategories,
  onDistribute,
  onPay,
}: {
  item: AdvanceStatus
  showHistory: boolean
  categoryName: (id: string) => string
  hasCategories: boolean
  onDistribute: () => void
  onPay: () => void
}) {
  const [showPayments, setShowPayments] = useState(false)
  const [editingItem, setEditingItem] = useState(false)
  const [editingPayment, setEditingPayment] = useState<LedgerEntry | null>(null)
  const { advance } = item
  const fixedRows = item.allocationEntries.filter((e) => !e.reversalOfId && !e.reversed)
  const payments = showHistory ? item.payments : item.payments.filter((p) => !p.reversed)
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
          <button className="text-teal-700 text-xs font-semibold mt-1" onClick={() => setEditingItem(true)}>
            تعديل بيانات الصنف
          </button>
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
      {item.agreedTotalQirsh !== null && item.owedQirsh !== null && (
        <>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-slate-500">إجمالي الحساب</span>
            <span className="font-semibold text-slate-800 tabular-nums">{formatEGP(item.agreedTotalQirsh)}</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-slate-500">باقي للمورد</span>
            {item.owedQirsh > 0 ? (
              <span className="font-bold text-amber-700 tabular-nums">{formatEGP(item.owedQirsh)}</span>
            ) : (
              <span className="font-semibold text-emerald-600">خالص</span>
            )}
          </div>
        </>
      )}
      {item.cancelled ? (
        <p className="text-xs text-slate-500 mt-1">
          كل دفعات الصنف ده ملغاة، فمفيش عليه مستحق للمورد. لو اتدفع له تاني استخدم «إضافة دفعة».
        </p>
      ) : (
        <AgreedTotalControl item={item} />
      )}
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

      {payments.length > 0 && (
        <button className="text-xs text-teal-700 font-semibold mt-3" onClick={() => setShowPayments((v) => !v)}>
          {showPayments ? 'إخفاء' : 'عرض'} الدفعات ({formatUnits(payments.length)})
        </button>
      )}
      {showPayments && (
        <ul className="divide-y divide-slate-100">
          {payments.map((p) => (
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
              {p.reversed ? (
                <span className="text-xs text-slate-400">ملغاة</span>
              ) : (
                <>
                  <button className="text-teal-700 text-xs mt-0.5 ml-3" onClick={() => setEditingPayment(p)}>
                    تعديل
                  </button>
                  <ReverseControl entryId={p.id} label="إلغاء الدفعة دي" />
                </>
              )}
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

      {editingItem && <EditItemModal item={item} onClose={() => setEditingItem(false)} />}
      {editingPayment && <EditEntryModal entry={editingPayment} onClose={() => setEditingPayment(null)} />}
    </Card>
  )
}

/** Corrects an item's name, supplier, quantity or unit. Money never moves
 * here: what each بند carries is derived from the item's payments. */
function EditItemModal({ item, onClose }: { item: AdvanceStatus; onClose: () => void }) {
  const { advance } = item
  const [name, setName] = useState(advance.description)
  const [counterparty, setCounterparty] = useState(advance.counterparty ?? '')
  const [quantity, setQuantity] = useState(item.hasQuantity ? String(advance.quantity) : '')
  const [unitName, setUnitName] = useState(advance.unitName ?? '')
  const [error, setError] = useState('')

  // An item split by fixed amounts has no use for a quantity, so it isn't offered.
  const fixedOnly = item.fixedAllocatedQirsh > 0
  const quantityValue = quantity.trim() === '' ? null : Number(quantity)
  const quantityInvalid = quantityValue !== null && !(quantityValue > 0)
  const distributedUnits = item.shares.reduce((s, c) => s + c.share.units, 0)
  const quantityHint = fixedOnly
    ? undefined
    : item.shares.length === 0
      ? 'لو كتبت كمية، الصنف بيتوزّع على البنود بعدد الوحدات. لو سبتها فاضية بيتوزّع بالنسبة أو بالمبلغ'
      : item.hasQuantity
        ? `متوزَّع منه ${describeItemUnits(item, distributedUnits)}، فالكمية مينفعش تقل عن كده. لو مسحتها التوزيع بيتحوّل لنِسب بنفس نصيب كل بند`
        : 'الصنف متوزَّع بالنسبة. لو كتبت كمية، النِّسب بتتحوّل لوحدات بنفس نصيب كل بند'

  async function save() {
    setError('')
    try {
      await updateAdvanceItem(advance.id, {
        name,
        counterparty,
        ...(fixedOnly ? {} : { quantity: quantityValue, unitName }),
      })
      onClose()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Modal open onClose={onClose} title="تعديل بيانات الصنف">
      {error && <Banner kind="error">{error}</Banner>}
      <Field label="اسم الصنف">
        <input className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="المورد / المستفيد (اختياري)">
        <input className={inputClass} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
      </Field>
      {fixedOnly ? (
        <p className="text-xs text-slate-500 mb-3">الصنف ده متوزَّع على بنود بمبالغ ثابتة، فمالوش كمية أو وحدة.</p>
      ) : (
        <div className="flex gap-2">
          <div className="flex-1">
            <Field label="الكمية (اختياري)">
              <input type="number" inputMode="decimal" className={inputClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
          </div>
          <div className="flex-1">
            <Field label="الوحدة">
              <input
                className={inputClass}
                value={unitName}
                maxLength={20}
                placeholder="نقلة، شيكارة، طن..."
                disabled={quantityValue === null}
                onChange={(e) => setUnitName(e.target.value)}
              />
            </Field>
          </div>
        </div>
      )}
      {quantityInvalid && <p className="text-xs text-red-600 -mt-2 mb-3">الكمية لازم تكون أكبر من صفر</p>}
      {quantityHint && !quantityInvalid && <p className="text-xs text-slate-500 -mt-2 mb-3">{quantityHint}</p>}
      <p className="text-xs text-slate-500 mb-3">
        المدفوع والتوزيع مبيتغيروش من هنا. تاريخ كل دفعة وطريقة دفعها بيتعدلوا من «عرض الدفعات».
      </p>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={save} disabled={!name.trim() || quantityInvalid}>
          حفظ التعديل
        </Button>
        <Button variant="secondary" onClick={onClose}>
          رجوع
        </Button>
      </div>
    </Modal>
  )
}

/** Sets the item's full price once it's known, changes it, or clears it. */
function AgreedTotalControl({ item }: { item: AdvanceStatus }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const known = item.agreedTotalQirsh !== null

  if (!open) {
    return (
      <button
        className="text-teal-700 text-xs font-semibold mt-1"
        onClick={() => {
          setValue(known ? String(item.agreedTotalQirsh! / 100) : '')
          setError('')
          setOpen(true)
        }}
      >
        {known ? 'تعديل إجمالي الحساب' : 'تحديد إجمالي الحساب (لو بقى معروف)'}
      </button>
    )
  }

  const totalQirsh = Number(value) > 0 ? egpToQirsh(Number(value)) : 0

  async function save(qirsh: number | null) {
    try {
      await setAdvanceAgreedTotal(item.advance.id, qirsh)
      setOpen(false)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <div className="mt-2 bg-slate-50 rounded-lg p-2 space-y-2">
      {error && <div className="text-red-600 text-xs">{error}</div>}
      <input
        type="number"
        inputMode="decimal"
        className={inputClass}
        placeholder="إجمالي حساب الصنف (ج.م)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex gap-2">
        <Button onClick={() => save(totalQirsh)} disabled={totalQirsh <= 0}>
          حفظ
        </Button>
        {known && (
          <Button variant="secondary" onClick={() => save(null)}>
            مش معروف
          </Button>
        )}
        <Button variant="secondary" onClick={() => setOpen(false)}>
          رجوع
        </Button>
      </div>
    </div>
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
  // Against the full price directly: owedQirsh is null for a cancelled item,
  // but a new payment for it still can't exceed the price that was agreed.
  const owed = item.agreedTotalQirsh === null ? null : Math.max(0, item.agreedTotalQirsh - item.totalPaidQirsh)
  const overpays = owed !== null && amountQirsh > owed

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
      {owed !== null && (
        <div className="flex justify-between items-center text-sm mb-3">
          <span className="text-slate-600">
            الباقي من الحساب: <span className="font-bold text-amber-700">{formatEGP(owed)}</span>
          </span>
          {owed > 0 && (
            <button className="text-teal-700 text-xs font-semibold" onClick={() => setAmount(String(owed / 100))}>
              كل الباقي
            </button>
          )}
        </div>
      )}
      <Field label="القيمة (ج.م)">
        <input type="number" inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      {amount !== '' && amountQirsh <= 0 && <p className="text-xs text-red-600 -mt-2 mb-3">القيمة لازم تكون أكبر من صفر</p>}
      {overpays && (
        <p className="text-xs text-red-600 -mt-2 mb-3">القيمة أكبر من الباقي من الحساب. لو الحساب اتغيّر عدّل إجمالي الحساب من كارت الصنف الأول</p>
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
      <Field label="ملاحظة (اختياري)">
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: باقي الحساب" />
      </Field>
      <Field label="رقم الفاتورة (اختياري)">
        <input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={submit} disabled={amountQirsh <= 0 || overpays}>
          تسجيل الدفعة
        </Button>
        <Button variant="secondary" onClick={onClose}>
          إلغاء
        </Button>
      </div>
    </Modal>
  )
}
