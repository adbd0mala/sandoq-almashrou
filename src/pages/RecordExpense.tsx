import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import { LedgerError, getVaultBalanceQirsh, recordExpense } from '../domain/ledger'
import { egpToQirsh, formatEGP } from '../domain/money'
import { Banner, Button, Card, Field, PageTitle, inputClass } from '../components/ui'
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../domain/types'

const todayIso = () => new Date().toISOString().slice(0, 10)

export function RecordExpense({ onDone }: { onDone: () => void }) {
  const activeCategories = useLiveQuery(async () => (await db.categories.toArray()).filter((c) => c.active), [])
  const balanceQirsh = useLiveQuery(getVaultBalanceQirsh, [])

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
      await recordExpense({
        categoryId,
        amountQirsh,
        date,
        description,
        counterparty,
        paymentMethod,
        invoiceNumber,
      })
      setAmount('')
      setDescription('')
      setCounterparty('')
      setInvoiceNumber('')
      setSuccess(true)
    } catch (e) {
      setError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

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

      {error && <Banner kind="error">{error}</Banner>}
      {success && <Banner kind="success">تم تسجيل المصروف بنجاح</Banner>}
      {willExceed && <Banner kind="error">قيمة المصروف أكبر من الرصيد المتاح في الصندوق</Banner>}

      <Card>
        <Field label="البند">
          <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">اختر البند</option>
            {list.map((c) => (
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
    </div>
  )
}
