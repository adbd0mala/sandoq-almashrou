import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import {
  LedgerError,
  addFunder,
  archiveFunder,
  resetToEqualShares,
  setCustomShares,
  updateFunderInfo,
} from '../domain/ledger'
import { egpToQirsh } from '../domain/money'
import { Banner, Button, Card, EmptyState, Field, Modal, PageTitle, inputClass } from '../components/ui'
import type { Funder } from '../domain/types'

export function Funders() {
  const funders = useLiveQuery(() => db.funders.toArray(), [])
  const [showAdd, setShowAdd] = useState(false)
  const [showShares, setShowShares] = useState(false)
  const [editing, setEditing] = useState<Funder | null>(null)
  const [error, setError] = useState('')

  const active = (funders ?? []).filter((f) => f.active)
  const archived = (funders ?? []).filter((f) => !f.active)
  const shareSum = active.reduce((s, f) => s + f.sharePercent, 0)

  return (
    <div className="space-y-4">
      <PageTitle action={<Button onClick={() => setShowAdd(true)}>+ ممول جديد</Button>}>الممولون</PageTitle>

      {error && <Banner kind="error">{error}</Banner>}

      {Math.abs(shareSum - 100) > 0.01 && active.length > 0 && (
        <Banner kind="error">تحذير: إجمالي نسب تحمل المصروفات الحالية {shareSum.toFixed(2)}% وليس 100%. صحّح النسب قبل تسجيل مصروف جديد.</Banner>
      )}

      {active.length === 0 ? (
        <EmptyState>لا يوجد ممولون بعد. اضغط "+ ممول جديد" للبدء</EmptyState>
      ) : (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-slate-700">نسب تحمل المصروفات</h3>
            <Button variant="ghost" onClick={() => setShowShares(true)}>
              تعديل النسب
            </Button>
          </div>
          <ul className="divide-y divide-slate-100">
            {active.map((f) => (
              <li key={f.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-800">{f.name}</div>
                  <div className="text-xs text-slate-400">{f.phone}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-teal-700 tabular-nums">{f.sharePercent.toFixed(2)}%</span>
                  <Button variant="ghost" onClick={() => setEditing(f)}>
                    تعديل
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {archived.length > 0 && (
        <Card>
          <h3 className="font-bold text-slate-500 mb-2 text-sm">ممولون مؤرشفون</h3>
          <ul className="divide-y divide-slate-100">
            {archived.map((f) => (
              <li key={f.id} className="py-2 text-sm text-slate-400">
                {f.name}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AddFunderModal open={showAdd} onClose={() => setShowAdd(false)} onError={setError} />
      {editing && (
        <EditFunderModal
          funder={editing}
          onClose={() => setEditing(null)}
          onError={setError}
          onArchived={() => setEditing(null)}
        />
      )}
      {showShares && (
        <EditSharesModal funders={active} onClose={() => setShowShares(false)} onError={setError} />
      )}
    </div>
  )
}

function AddFunderModal({ open, onClose, onError }: { open: boolean; onClose: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [target, setTarget] = useState('')

  async function submit() {
    try {
      onError('')
      await addFunder({
        name,
        phone,
        targetContributionQirsh: target ? egpToQirsh(Number(target)) : undefined,
      })
      setName('')
      setPhone('')
      setTarget('')
      onClose()
    } catch (e) {
      onError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="إضافة ممول جديد">
      <Field label="اسم الممول">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="رقم الهاتف (اختياري)">
        <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="المبلغ المتفق على تمويله (اختياري، للمتابعة فقط)">
        <input type="number" className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)} />
      </Field>
      <p className="text-xs text-slate-400 mb-3">نسب تحمل المصروفات ستُعدَّل تلقائيًا بالتساوي بين كل الممولين النشطين</p>
      <Button className="w-full" onClick={submit} disabled={!name.trim()}>
        حفظ
      </Button>
    </Modal>
  )
}

function EditFunderModal({
  funder,
  onClose,
  onError,
  onArchived,
}: {
  funder: Funder
  onClose: () => void
  onError: (m: string) => void
  onArchived: () => void
}) {
  const [name, setName] = useState(funder.name)
  const [phone, setPhone] = useState(funder.phone ?? '')
  const [confirmArchive, setConfirmArchive] = useState(false)

  async function save() {
    try {
      await updateFunderInfo(funder.id, { name, phone })
      onClose()
    } catch (e) {
      onError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  async function doArchive() {
    try {
      await archiveFunder(funder.id)
      onArchived()
    } catch (e) {
      onError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  return (
    <Modal open onClose={onClose} title="تعديل الممول">
      <Field label="اسم الممول">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="رقم الهاتف">
        <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <div className="flex gap-2 mb-4">
        <Button className="flex-1" onClick={save}>
          حفظ
        </Button>
      </div>
      <div className="border-t pt-3">
        {!confirmArchive ? (
          <Button variant="danger" className="w-full" onClick={() => setConfirmArchive(true)}>
            أرشفة هذا الممول
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">
              أرشفة الممول توقف مشاركته في توزيع المصروفات الجديدة، وتُعاد النسب بالتساوي بين الباقي. حركاته السابقة تبقى محفوظة.
            </p>
            <div className="flex gap-2">
              <Button variant="danger" className="flex-1" onClick={doArchive}>
                تأكيد الأرشفة
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => setConfirmArchive(false)}>
                إلغاء
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function EditSharesModal({ funders, onClose, onError }: { funders: Funder[]; onClose: () => void; onError: (m: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(funders.map((f) => [f.id, f.sharePercent.toFixed(2)])),
  )
  const sum = Object.values(values).reduce((s, v) => s + (Number(v) || 0), 0)

  async function saveCustom() {
    try {
      await setCustomShares(funders.map((f) => ({ funderId: f.id, percent: Number(values[f.id]) || 0 })))
      onClose()
    } catch (e) {
      onError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  async function saveEqual() {
    await resetToEqualShares()
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="تعديل نسب تحمل المصروفات">
      <p className="text-xs text-slate-400 mb-3">يجب أن يكون إجمالي النسب 100% بالضبط</p>
      {funders.map((f) => (
        <Field key={f.id} label={f.name}>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.01"
              className={inputClass}
              value={values[f.id]}
              onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
            />
            <span className="text-slate-500">%</span>
          </div>
        </Field>
      ))}
      <div className={`text-sm mb-3 font-semibold ${Math.abs(sum - 100) > 0.01 ? 'text-red-600' : 'text-emerald-600'}`}>
        الإجمالي: {sum.toFixed(2)}%
      </div>
      <div className="flex gap-2">
        <Button className="flex-1" onClick={saveCustom} disabled={Math.abs(sum - 100) > 0.01}>
          حفظ النسب
        </Button>
        <Button variant="secondary" className="flex-1" onClick={saveEqual}>
          إعادة توزيع بالتساوي
        </Button>
      </div>
    </Modal>
  )
}
