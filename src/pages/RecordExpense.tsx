import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import {
  LedgerError,
  getVaultBalanceQirsh,
  recordAdvance,
  recordExpense,
  recordExpenseWithPayable,
  recordSplitExpense,
  recordSplitExpenseWithPayable,
} from '../domain/ledger'
import { egpToQirsh, formatEGP } from '../domain/money'
import { Banner, Button, Card, Field, PageTitle, inputClass } from '../components/ui'
import { PAYMENT_METHOD_LABELS, type ExpenseCategory, type PaymentMethod } from '../domain/types'

const todayIso = () => new Date().toISOString().slice(0, 10)

type Mode = 'single' | 'split' | 'advance'

export function RecordExpense({ onDone }: { onDone: () => void }) {
  const activeCategories = useLiveQuery(async () => (await db.categories.toArray()).filter((c) => c.active), [])
  const balanceQirsh = useLiveQuery(getVaultBalanceQirsh, [])
  const [mode, setMode] = useState<Mode>('single')

  const list = activeCategories ?? []
  const noCategories = list.length === 0

  return (
    <div className="space-y-4">
      <PageTitle>تسجيل مصروف</PageTitle>

      <Card className="bg-slate-50">
        <div className="text-sm text-slate-500">الرصيد المتاح</div>
        <div className="text-xl font-bold text-slate-800">{balanceQirsh !== undefined ? formatEGP(balanceQirsh) : '...'}</div>
      </Card>

      <div className="flex gap-2 bg-slate-100 rounded-xl p-1">
        <ModeButton active={mode === 'single'} onClick={() => setMode('single')}>
          بند واحد
        </ModeButton>
        <ModeButton active={mode === 'split'} onClick={() => setMode('split')}>
          تقسيم على بنود
        </ModeButton>
        <ModeButton active={mode === 'advance'} onClick={() => setMode('advance')}>
          دفعة بدون بند
        </ModeButton>
      </div>

      {mode !== 'advance' && noCategories && (
        <Banner kind="info">أضف بند مصروفات واحدًا على الأقل من شاشة "البنود" قبل استخدام هذا الوضع</Banner>
      )}
      {mode === 'split' && !noCategories && <SplitExpenseForm categories={list} balanceQirsh={balanceQirsh} onDone={onDone} />}
      {mode === 'single' && !noCategories && <SingleExpenseForm categories={list} balanceQirsh={balanceQirsh} onDone={onDone} />}
      {mode === 'advance' && <AdvanceForm balanceQirsh={balanceQirsh} onDone={onDone} />}
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-semibold transition disabled:opacity-40 ${
        active ? 'bg-white shadow text-teal-700' : 'text-slate-500'
      }`}
    >
      {children}
    </button>
  )
}

function AdvanceForm({ balanceQirsh, onDone }: { balanceQirsh: number | undefined; onDone: () => void }) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [counterparty, setCounterparty] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const amountQirsh = Number(amount) > 0 ? egpToQirsh(Number(amount)) : 0
  const willExceed = balanceQirsh !== undefined && amountQirsh > balanceQirsh

  async function submit() {
    setError('')
    setSuccess(false)
    try {
      await recordAdvance({ amountQirsh, date, description, counterparty, paymentMethod, invoiceNumber })
      setAmount('')
      setDescription('')
      setCounterparty('')
      setInvoiceNumber('')
      setSuccess(true)
    } catch (e) {
      setError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  return (
    <>
      {error && <Banner kind="error">{error}</Banner>}
      {success && (
        <Banner kind="success">تم تسجيل الدفعة وخصمها من الصندوق. وزّعها على البنود بعدين من تبويب "دفعات تحت التوزيع" بالتقارير</Banner>
      )}
      {willExceed && <Banner kind="error">القيمة أكبر من الرصيد المتاح في الصندوق</Banner>}

      <Card>
        <p className="text-xs text-slate-500 mb-3">
          لدفعة بتدفعها (مثلاً لمقاول) من غير ما تكون عارف هتتوزع على أنهي بنود لحد ما الشغل يخلص. الفلوس بتتخصم من
          الصندوق دلوقتي، وتقدر توزعها على البنود الصح بعدين من غير ما الرصيد يتأثر تاني.
        </p>
        <Field label="القيمة (ج.م)">
          <input type="number" inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="التاريخ">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="الوصف">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="مثال: دفعة مقدمة للمقاول" />
        </Field>
        <Field label="المستفيد (اختياري)">
          <input className={inputClass} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
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
          <Button className="flex-1" onClick={submit} disabled={amountQirsh <= 0}>
            تسجيل الدفعة
          </Button>
          <Button variant="secondary" onClick={onDone}>
            رجوع
          </Button>
        </div>
      </Card>
    </>
  )
}

function SingleExpenseForm({
  categories,
  balanceQirsh,
  onDone,
}: {
  categories: ExpenseCategory[]
  balanceQirsh: number | undefined
  onDone: () => void
}) {
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [counterparty, setCounterparty] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [isPartial, setIsPartial] = useState(false)
  const [totalInvoice, setTotalInvoice] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<string | null>(null)

  const amountQirsh = Number(amount) > 0 ? egpToQirsh(Number(amount)) : 0
  const totalQirsh = Number(totalInvoice) > 0 ? egpToQirsh(Number(totalInvoice)) : 0
  const willExceed = balanceQirsh !== undefined && amountQirsh > balanceQirsh
  const remainingQirsh = isPartial ? totalQirsh - amountQirsh : 0

  const canSubmit = isPartial
    ? !!categoryId && !!counterparty.trim() && totalQirsh > 0 && amountQirsh >= 0 && amountQirsh <= totalQirsh
    : !!categoryId && amountQirsh > 0

  async function submit() {
    setError('')
    setSuccess(null)
    try {
      if (isPartial) {
        const { payable } = await recordExpenseWithPayable({
          categoryId,
          amountQirsh,
          totalQirsh,
          date,
          description,
          counterparty,
          paymentMethod,
          invoiceNumber,
        })
        setSuccess(
          payable
            ? `تم التسجيل. باقي على ${counterparty.trim()}: ${formatEGP(totalQirsh - amountQirsh)} — موجود في تبويب "المستحقات" بالتقارير`
            : 'تم تسجيل المصروف بالكامل (مفيش باقي للمورد)',
        )
        setTotalInvoice('')
      } else {
        await recordExpense({ categoryId, amountQirsh, date, description, counterparty, paymentMethod, invoiceNumber })
        setSuccess('تم تسجيل المصروف بنجاح')
      }
      setAmount('')
      setDescription('')
      setCounterparty('')
      setInvoiceNumber('')
    } catch (e) {
      setError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  return (
    <>
      {error && <Banner kind="error">{error}</Banner>}
      {success && <Banner kind="success">{success}</Banner>}
      {willExceed && <Banner kind="error">القيمة المدفوعة الآن أكبر من الرصيد المتاح في الصندوق</Banner>}

      <Card>
        <Field label="البند">
          <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">اختر البند</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <label className="flex items-center justify-between py-2 mb-1 border-y border-slate-100">
          <span className="text-sm text-slate-600">دفعة جزئية (ولسه فيه باقي للمورد)</span>
          <input type="checkbox" checked={isPartial} onChange={(e) => setIsPartial(e.target.checked)} className="w-5 h-5" />
        </label>

        {isPartial && (
          <Field label="إجمالي قيمة الفاتورة (ج.م)">
            <input type="number" inputMode="decimal" className={inputClass} value={totalInvoice} onChange={(e) => setTotalInvoice(e.target.value)} />
          </Field>
        )}

        <Field label={isPartial ? 'المدفوع الآن (ج.م)' : 'القيمة (ج.م)'}>
          <input type="number" inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>

        {isPartial && totalQirsh > 0 && (
          <div className={`text-sm mb-3 font-semibold ${remainingQirsh < 0 ? 'text-red-600' : 'text-amber-600'}`}>
            {remainingQirsh < 0 ? 'المدفوع أكبر من إجمالي الفاتورة' : `الباقي للمورد: ${formatEGP(remainingQirsh)}`}
          </div>
        )}

        <Field label="تاريخ المصروف">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="الوصف">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={isPartial ? 'اسم المورد' : 'المورد / المستفيد (اختياري)'}>
          <input className={inputClass} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
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
          <Button className="flex-1" onClick={submit} disabled={!canSubmit}>
            {isPartial ? 'تسجيل الفاتورة والدفعة' : 'تسجيل المصروف'}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            رجوع
          </Button>
        </div>
      </Card>
    </>
  )
}

interface SplitLine {
  key: string
  categoryId: string
  amount: string
  note: string
}

function newLine(): SplitLine {
  return { key: crypto.randomUUID(), categoryId: '', amount: '', note: '' }
}

function SplitExpenseForm({
  categories,
  balanceQirsh,
  onDone,
}: {
  categories: ExpenseCategory[]
  balanceQirsh: number | undefined
  onDone: () => void
}) {
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('')
  const [counterparty, setCounterparty] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [lines, setLines] = useState<SplitLine[]>([newLine(), newLine()])
  const [isPartial, setIsPartial] = useState(false)
  const [paidNow, setPaidNow] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState<string | null>(null)

  function updateLine(key: string, patch: Partial<SplitLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }
  function removeLine(key: string) {
    setLines((ls) => (ls.length > 2 ? ls.filter((l) => l.key !== key) : ls))
  }

  const validLines = lines.filter((l) => l.categoryId && Number(l.amount) > 0)
  // In partial mode, each line's amount is its full invoice share, not what's paid.
  const totalQirsh = validLines.reduce((s, l) => s + egpToQirsh(Number(l.amount)), 0)
  const paidNowQirsh = isPartial ? (Number(paidNow) > 0 ? egpToQirsh(Number(paidNow)) : 0) : totalQirsh
  const remainingQirsh = totalQirsh - paidNowQirsh

  const canSubmit = isPartial
    ? validLines.length >= 2 && validLines.length === lines.length && !!counterparty.trim() && paidNowQirsh >= 0 && paidNowQirsh <= totalQirsh
    : validLines.length >= 2 && validLines.length === lines.length
  const willExceed = balanceQirsh !== undefined && paidNowQirsh > balanceQirsh

  async function submit() {
    setError('')
    setSuccess(null)
    try {
      if (isPartial) {
        const { payables } = await recordSplitExpenseWithPayable({
          date,
          description,
          counterparty,
          paymentMethod,
          invoiceNumber,
          paidNowQirsh,
          lines: lines.map((l) => ({ categoryId: l.categoryId, totalQirsh: egpToQirsh(Number(l.amount)), note: l.note })),
        })
        setSuccess(
          payables.length > 0
            ? `تم التسجيل. باقي على ${counterparty.trim()} في ${payables.length} بند — موجود في تبويب "المستحقات" بالتقارير`
            : 'تم تسجيل كل بنود المصروف بالكامل (مفيش باقي للمورد)',
        )
        setPaidNow('')
      } else {
        await recordSplitExpense({
          date,
          description,
          counterparty,
          paymentMethod,
          invoiceNumber,
          lines: lines.map((l) => ({ categoryId: l.categoryId, amountQirsh: egpToQirsh(Number(l.amount)), note: l.note })),
        })
        setSuccess('تم تسجيل كل بنود المصروف بنجاح (حركة مستقلة لكل بند)')
      }
      setLines([newLine(), newLine()])
      setDescription('')
      setCounterparty('')
      setInvoiceNumber('')
    } catch (e) {
      setError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  return (
    <>
      {error && <Banner kind="error">{error}</Banner>}
      {success && <Banner kind="success">{success}</Banner>}
      {willExceed && <Banner kind="error">القيمة المدفوعة الآن أكبر من الرصيد المتاح في الصندوق</Banner>}

      <Card>
        <p className="text-xs text-slate-500 mb-3">
          لمبلغ واحد اتصرف على أكتر من بند (مثلاً اسمنت اتوزع على المحارة والسيراميك والبناء). كل سطر هيتسجل كحركة مستقلة، تقدر تلغيها لوحدها بعدين.
        </p>
        <Field label="وصف عام (مثال: اسمنت)">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="التاريخ">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <label className="flex items-center justify-between py-2 mb-1 border-y border-slate-100">
          <span className="text-sm text-slate-600">دفعة جزئية (ولسه فيه باقي للمورد)</span>
          <input type="checkbox" checked={isPartial} onChange={(e) => setIsPartial(e.target.checked)} className="w-5 h-5" />
        </label>

        <Field label={isPartial ? 'اسم المورد' : 'المورد / المستفيد (اختياري)'}>
          <input className={inputClass} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
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
      </Card>

      <Card>
        <h3 className="font-bold text-slate-700 mb-2">البنود {isPartial && <span className="text-xs text-slate-400 font-normal">(القيمة هنا = إجمالي كل بند، مش بس المدفوع)</span>}</h3>
        <div className="space-y-3">
          {lines.map((line, idx) => (
            <div key={line.key} className="border border-slate-200 rounded-xl p-3">
              <div className="flex justify-between items-center mb-2">
                <span className="text-xs text-slate-400">بند {idx + 1}</span>
                {lines.length > 2 && (
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
                  placeholder={isPartial ? 'إجمالي البند (ج.م)' : 'القيمة (ج.م)'}
                  className={inputClass}
                  value={line.amount}
                  onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                />
                <input
                  placeholder="ملاحظة (مثال: 2 طن)"
                  className={inputClass}
                  value={line.note}
                  onChange={(e) => updateLine(line.key, { note: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>

        <Button variant="secondary" className="w-full mt-3" onClick={() => setLines((ls) => [...ls, newLine()])}>
          + إضافة بند
        </Button>

        <div className="flex justify-between items-center mt-4 pt-3 border-t">
          <span className="text-sm text-slate-500">إجمالي كل البنود</span>
          <span className="text-lg font-bold text-slate-800 tabular-nums">{formatEGP(totalQirsh)}</span>
        </div>

        {isPartial && (
          <>
            <Field label="المدفوع الآن من الإجمالي (ج.م)">
              <input type="number" inputMode="decimal" className={inputClass} value={paidNow} onChange={(e) => setPaidNow(e.target.value)} />
            </Field>
            {totalQirsh > 0 && (
              <div className={`text-sm mb-1 font-semibold ${remainingQirsh < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                {remainingQirsh < 0 ? 'المدفوع أكبر من إجمالي البنود' : `الباقي للمورد: ${formatEGP(remainingQirsh)} (بيتوزع على البنود بنفس نسبتها)`}
              </div>
            )}
          </>
        )}

        <div className="flex gap-2 mt-3">
          <Button className="flex-1" onClick={submit} disabled={!canSubmit}>
            {isPartial ? 'تسجيل الفاتورة والدفعة' : 'تسجيل كل البنود'}
          </Button>
          <Button variant="secondary" onClick={onDone}>
            رجوع
          </Button>
        </div>
      </Card>
    </>
  )
}
