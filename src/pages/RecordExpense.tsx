import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import { LedgerError, getVaultBalanceQirsh, recordExpense, recordSplitExpense } from '../domain/ledger'
import { egpToQirsh, formatEGP } from '../domain/money'
import { Banner, Button, Card, Field, PageTitle, inputClass } from '../components/ui'
import { PAYMENT_METHOD_LABELS, type ExpenseCategory, type PaymentMethod } from '../domain/types'

const todayIso = () => new Date().toISOString().slice(0, 10)

export function RecordExpense({ onDone }: { onDone: () => void }) {
  const activeCategories = useLiveQuery(async () => (await db.categories.toArray()).filter((c) => c.active), [])
  const balanceQirsh = useLiveQuery(getVaultBalanceQirsh, [])
  const [splitMode, setSplitMode] = useState(false)

  const list = activeCategories ?? []

  if (list.length === 0) {
    return (
      <div className="space-y-4">
        <PageTitle>تسجيل مصروف</PageTitle>
        <Banner kind="info">أضف بند مصروفات واحدًا على الأقل من شاشة "البنود" قبل تسجيل أي مصروف</Banner>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageTitle>تسجيل مصروف</PageTitle>

      <Card className="bg-slate-50">
        <div className="text-sm text-slate-500">الرصيد المتاح</div>
        <div className="text-xl font-bold text-slate-800">{balanceQirsh !== undefined ? formatEGP(balanceQirsh) : '...'}</div>
      </Card>

      <div className="flex gap-2 bg-slate-100 rounded-xl p-1">
        <button
          onClick={() => setSplitMode(false)}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${!splitMode ? 'bg-white shadow text-teal-700' : 'text-slate-500'}`}
        >
          مصروف على بند واحد
        </button>
        <button
          onClick={() => setSplitMode(true)}
          className={`flex-1 py-2 rounded-lg text-sm font-semibold transition ${splitMode ? 'bg-white shadow text-teal-700' : 'text-slate-500'}`}
        >
          تقسيم على أكتر من بند
        </button>
      </div>

      {splitMode ? (
        <SplitExpenseForm categories={list} balanceQirsh={balanceQirsh} onDone={onDone} />
      ) : (
        <SingleExpenseForm categories={list} balanceQirsh={balanceQirsh} onDone={onDone} />
      )}
    </div>
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
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const amountQirsh = Number(amount) > 0 ? egpToQirsh(Number(amount)) : 0
  const willExceed = balanceQirsh !== undefined && amountQirsh > balanceQirsh

  async function submit() {
    setError('')
    setSuccess(false)
    try {
      await recordExpense({ categoryId, amountQirsh, date, description, counterparty, paymentMethod, invoiceNumber })
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
      {success && <Banner kind="success">تم تسجيل المصروف بنجاح</Banner>}
      {willExceed && <Banner kind="error">قيمة المصروف أكبر من الرصيد المتاح في الصندوق</Banner>}

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
        <Field label="القيمة (ج.م)">
          <input type="number" inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="تاريخ المصروف">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="الوصف">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="المورد / المستفيد (اختياري)">
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
          <Button className="flex-1" onClick={submit} disabled={!categoryId || amountQirsh <= 0}>
            تسجيل المصروف
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
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  function updateLine(key: string, patch: Partial<SplitLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }
  function removeLine(key: string) {
    setLines((ls) => (ls.length > 2 ? ls.filter((l) => l.key !== key) : ls))
  }

  const validLines = lines.filter((l) => l.categoryId && Number(l.amount) > 0)
  const totalQirsh = validLines.reduce((s, l) => s + egpToQirsh(Number(l.amount)), 0)
  const canSubmit = validLines.length >= 2 && validLines.length === lines.length
  const willExceed = balanceQirsh !== undefined && totalQirsh > balanceQirsh

  async function submit() {
    setError('')
    setSuccess(false)
    try {
      await recordSplitExpense({
        date,
        description,
        counterparty,
        paymentMethod,
        invoiceNumber,
        lines: lines.map((l) => ({ categoryId: l.categoryId, amountQirsh: egpToQirsh(Number(l.amount)), note: l.note })),
      })
      setLines([newLine(), newLine()])
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
      {success && <Banner kind="success">تم تسجيل كل بنود المصروف بنجاح (حركة مستقلة لكل بند)</Banner>}
      {willExceed && <Banner kind="error">إجمالي قيم البنود أكبر من الرصيد المتاح في الصندوق</Banner>}

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
        <Field label="المورد / المستفيد (اختياري)">
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
        <h3 className="font-bold text-slate-700 mb-2">البنود</h3>
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
                  placeholder="القيمة (ج.م)"
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
          <span className="text-sm text-slate-500">الإجمالي</span>
          <span className="text-lg font-bold text-slate-800 tabular-nums">{formatEGP(totalQirsh)}</span>
        </div>

        <div className="flex gap-2 mt-3">
          <Button className="flex-1" onClick={submit} disabled={!canSubmit}>
            تسجيل كل البنود
          </Button>
          <Button variant="secondary" onClick={onDone}>
            رجوع
          </Button>
        </div>
      </Card>
    </>
  )
}
