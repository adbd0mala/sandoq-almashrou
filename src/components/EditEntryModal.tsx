import { useState } from 'react'
import { LedgerError, updateEntryDetails } from '../domain/ledger'
import { formatEGP } from '../domain/money'
import { PAYMENT_METHOD_LABELS, type LedgerEntry, type PaymentMethod } from '../domain/types'
import { Banner, Button, Field, Modal, inputClass } from './ui'

/** Corrects the details of a recorded entry that move no money. Which fields
 * are offered depends on what the entry is: a contribution has no supplier,
 * an item payment's name and supplier belong to the item itself, and a
 * distribution of an item to a بند was never a payment. */
export function EditEntryModal({ entry, onClose, onSaved }: { entry: LedgerEntry; onClose: () => void; onSaved?: () => void }) {
  const isContribution = entry.type === 'CONTRIBUTION'
  const isItemPayment = entry.type === 'ADVANCE'
  const isDistribution = entry.affectsVault === false
  const showDescription = !isItemPayment
  const showCounterparty = !isContribution && !isItemPayment && !isDistribution
  const showPayment = !isDistribution

  const [description, setDescription] = useState(entry.description)
  const [date, setDate] = useState(entry.date)
  const [counterparty, setCounterparty] = useState(entry.counterparty ?? '')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | ''>(entry.paymentMethod ?? '')
  const [invoiceNumber, setInvoiceNumber] = useState(entry.invoiceNumber ?? '')
  const [error, setError] = useState('')

  async function save() {
    setError('')
    try {
      await updateEntryDetails(entry.id, {
        description: showDescription ? description : undefined,
        date,
        counterparty: showCounterparty ? counterparty : undefined,
        paymentMethod: showPayment && paymentMethod ? paymentMethod : undefined,
        invoiceNumber: showPayment ? invoiceNumber : undefined,
      })
      onSaved?.()
      onClose()
    } catch (e) {
      setError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  return (
    <Modal open onClose={onClose} title="تعديل بيانات الحركة">
      {error && <Banner kind="error">{error}</Banner>}
      <p className="text-xs text-slate-500 mb-3">
        القيمة {formatEGP(entry.amountQirsh)} مبتتعدلش من هنا. لو فيه غلط في المبلغ أو البند أو الممول، الغِ الحركة وسجّلها من جديد.
      </p>
      {showDescription && (
        <Field label={isContribution ? 'نوع المساهمة / الوصف' : 'الوصف'}>
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
      )}
      <Field label="التاريخ">
        <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {showCounterparty && (
        <Field label="المورد / المستفيد">
          <input className={inputClass} value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
        </Field>
      )}
      {showPayment && (
        <>
          <Field label="طريقة الدفع">
            <select className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')}>
              {!entry.paymentMethod && <option value="">غير محددة</option>}
              {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label={isContribution ? 'رقم الإيصال (اختياري)' : 'رقم الفاتورة (اختياري)'}>
            <input className={inputClass} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </Field>
        </>
      )}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={save} disabled={!date || (showDescription && !description.trim())}>
          حفظ التعديل
        </Button>
        <Button variant="secondary" onClick={onClose}>
          رجوع
        </Button>
      </div>
    </Modal>
  )
}
