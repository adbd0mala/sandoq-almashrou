import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import {
  LedgerError,
  addSupplier,
  deleteSupplier,
  listSuppliers,
  renameSupplier,
  setSupplierActive,
  supplierKey,
  type SupplierInfo,
} from '../domain/ledger'
import { formatEGP, formatUnits } from '../domain/money'
import { Banner, Button, Card, EmptyState, Field, Modal, PageTitle, inputClass } from '../components/ui'

const errorText = (e: unknown) => (e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')

/** The supplier list: every name purchases were recorded under, plus any
 * added by hand. Each can be renamed (everywhere at once), made dormant so
 * it stops being offered when recording, or deleted if nothing uses it. */
export function Suppliers({ onBack }: { onBack: () => void }) {
  const suppliers = useLiveQuery(listSuppliers, [])
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editingName, setEditingName] = useState<string | null>(null)
  const [error, setError] = useState('')

  if (!suppliers) return null

  const wanted = supplierKey(query)
  const shown = wanted ? suppliers.filter((s) => s.name.includes(wanted)) : suppliers
  const active = shown.filter((s) => s.active)
  const dormant = shown.filter((s) => !s.active)
  const editing = suppliers.find((s) => s.name === editingName)

  const details = (s: SupplierInfo) => (
    <div className="text-xs text-slate-400">
      {s.movements > 0 ? `${formatUnits(s.movements)} حركة` : 'مفيش حركات مسجلة'}
      {s.remainingQirsh > 0 && <span className="text-amber-700"> · باقي عليه {formatEGP(s.remainingQirsh)}</span>}
    </div>
  )

  return (
    <div className="space-y-4">
      <PageTitle
        action={
          <div className="flex gap-2">
            <Button onClick={() => setShowAdd(true)}>+ مورد جديد</Button>
            <Button variant="secondary" onClick={onBack}>
              رجوع
            </Button>
          </div>
        }
      >
        الموردون
      </PageTitle>
      {error && <Banner kind="error">{error}</Banner>}

      {suppliers.length === 0 ? (
        <EmptyState>مفيش موردين لسه. اضغط «+ مورد جديد»، أو اكتب اسم المورد وإنت بتسجل أي مصروف وهيتضاف هنا لوحده</EmptyState>
      ) : (
        <>
          <input className={inputClass} placeholder="ابحث باسم المورد" value={query} onChange={(e) => setQuery(e.target.value)} />

          <Card>
            <h3 className="font-bold text-slate-700 mb-2">موردون نشطون ({formatUnits(active.length)})</h3>
            {active.length === 0 ? (
              <p className="text-sm text-slate-400">{wanted ? 'مفيش مورد نشط بالاسم ده' : 'مفيش موردين نشطين'}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {active.map((s) => (
                  <li key={s.name} className="py-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 break-words">{s.name}</div>
                      {details(s)}
                    </div>
                    <Button variant="ghost" onClick={() => setEditingName(s.name)}>
                      تعديل
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {dormant.length > 0 && (
            <Card>
              <h3 className="font-bold text-slate-500 mb-1 text-sm">موردون خاملون ({formatUnits(dormant.length)})</h3>
              <p className="text-xs text-slate-400 mb-2">مش بيظهروا في قائمة الموردين وقت التسجيل. حساباتهم وحركاتهم زي ما هي.</p>
              <ul className="divide-y divide-slate-100">
                {dormant.map((s) => (
                  <li key={s.name} className="py-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-500 break-words">{s.name}</div>
                      {details(s)}
                    </div>
                    <div className="flex items-center shrink-0">
                      <button
                        className="text-teal-700 font-semibold text-xs"
                        onClick={() => setSupplierActive(s.name, true).catch((e) => setError(errorText(e)))}
                      >
                        تنشيط
                      </button>
                      <Button variant="ghost" onClick={() => setEditingName(s.name)}>
                        تعديل
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {showAdd && <AddSupplierModal onClose={() => setShowAdd(false)} />}
      {editing && (
        <EditSupplierModal key={editing.name} supplier={editing} others={suppliers.filter((s) => s.name !== editing.name)} onClose={() => setEditingName(null)} />
      )}
    </div>
  )
}

function AddSupplierModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  async function submit() {
    try {
      await addSupplier(name)
      onClose()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Modal open onClose={onClose} title="مورد جديد">
      {error && <Banner kind="error">{error}</Banner>}
      <Field label="اسم المورد">
        <input className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      <p className="text-xs text-slate-400 mb-3">هيظهر في قائمة الموردين وقت تسجيل أي مصروف أو صنف.</p>
      <Button className="w-full" onClick={submit} disabled={!name.trim()}>
        حفظ
      </Button>
    </Modal>
  )
}

function EditSupplierModal({ supplier, others, onClose }: { supplier: SupplierInfo; others: SupplierInfo[]; onClose: () => void }) {
  const [name, setName] = useState(supplier.name)
  const [error, setError] = useState('')

  const next = supplierKey(name)
  const changed = next !== '' && next !== supplier.name
  // Renaming onto another supplier's name makes the two one account.
  const mergesInto = changed ? others.find((s) => s.name === next) : undefined

  const run = (action: () => Promise<void>) => async () => {
    setError('')
    try {
      await action()
      onClose()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Modal open onClose={onClose} title="تعديل المورد">
      {error && <Banner kind="error">{error}</Banner>}

      <Field label="اسم المورد">
        <input className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </Field>
      {mergesInto ? (
        <p className="text-xs text-amber-700 -mt-2 mb-3">
          فيه مورد تاني بالاسم ده. الحفظ هيدمج الاتنين في حساب واحد باسم «{next}»، والدمج مبيترجعش.
        </p>
      ) : (
        <p className="text-xs text-slate-400 -mt-2 mb-3">الاسم الجديد هيتكتب على كل حركات المورد ومستحقاته.</p>
      )}
      <Button className="w-full mb-4" onClick={run(() => renameSupplier(supplier.name, name))} disabled={!changed}>
        {mergesInto ? 'دمج الموردين' : 'حفظ الاسم'}
      </Button>

      <div className="border-t pt-3 mb-4">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-sm text-slate-600">
            الحالة: <span className="font-bold">{supplier.active ? 'نشط' : 'خامل'}</span>
          </span>
          <Button variant="secondary" onClick={run(() => setSupplierActive(supplier.name, !supplier.active))}>
            {supplier.active ? 'خلّيه خامل' : 'رجّعه نشط'}
          </Button>
        </div>
        <p className="text-xs text-slate-400">المورد الخامل بيختفي من قائمة الموردين وقت التسجيل. حسابه وحركاته وأي باقي عليه بيفضلوا زي ما هم.</p>
      </div>

      <div className="border-t pt-3">
        <Button
          variant="danger"
          className="w-full"
          disabled={supplier.movements > 0}
          onClick={() => {
            if (confirm(`هتحذف المورد «${supplier.name}» من القائمة. متأكد؟`)) run(() => deleteSupplier(supplier.name))()
          }}
        >
          حذف المورد
        </Button>
        <p className="text-xs text-slate-400 mt-1">
          {supplier.movements > 0
            ? `عليه ${formatUnits(supplier.movements)} حركة مسجلة، فمينفعش يتحذف. خلّيه خامل بدل الحذف.`
            : 'المورد ده ملوش أي حركات، فحذفه مبيأثرش على أي حساب.'}
        </p>
      </div>
    </Modal>
  )
}
