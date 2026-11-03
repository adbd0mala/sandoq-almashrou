import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import { LedgerError, recordContribution } from '../domain/ledger'
import { egpToQirsh } from '../domain/money'
import { Banner, Button, Card, Field, PageTitle, inputClass } from '../components/ui'
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '../domain/types'

const todayIso = () => new Date().toISOString().slice(0, 10)

export function RecordContribution({ onDone }: { onDone: () => void }) {
  const activeFunders = useLiveQuery(async () => (await db.funders.toArray()).filter((f) => f.active), [])

  const [funderId, setFunderId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayIso())
  const [description, setDescription] = useState('مساهمة رأسمالية')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const amountQirsh = Number(amount) > 0 ? egpToQirsh(Number(amount)) : 0
  const list = activeFunders ?? []

  async function submit() {
    setError('')
    setSuccess(false)
    try {
      await recordContribution({ funderId, amountQirsh, date, description, paymentMethod, invoiceNumber })
      setAmount('')
      setInvoiceNumber('')
      setSuccess(true)
    } catch (e) {
      setError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  if (list.length === 0) {
    return (
      <div className="space-y-4">
        <PageTitle>تسجيل مساهمة</PageTitle>
        <Banner kind="info">أضف ممولاً واحدًا على الأقل من شاشة "الممولون" قبل تسجيل أي مساهمة</Banner>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageTitle>تسجيل مساهمة</PageTitle>
      {error && <Banner kind="error">{error}</Banner>}
      {success && <Banner kind="success">تم تسجيل المساهمة بنجاح</Banner>}

      <Card>
        <Field label="الممول">
          <select className={inputClass} value={funderId} onChange={(e) => setFunderId(e.target.value)}>
            <option value="">اختر الممول</option>
            {list.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="القيمة (ج.م)">
          <input type="number" inputMode="decimal" className={inputClass} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="التاريخ">
          <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="نوع المساهمة / الوصف">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
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
        <Field label="رقم الإيصال (اختياري)">
          <input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
        </Field>

        <div className="flex gap-2">
          <Button className="flex-1" onClick={submit} disabled={!funderId || amountQirsh <= 0}>
            تسجيل المساهمة
          </Button>
          <Button variant="secondary" onClick={onDone}>
            رجوع
          </Button>
        </div>
      </Card>
    </div>
  )
}
