import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { db } from '../db/db'
import { LedgerError, addCategory, archiveCategory, deleteCategoryIfUnused, updateCategory } from '../domain/ledger'
import { egpToQirsh, formatEGP } from '../domain/money'
import { Banner, Button, Card, EmptyState, Field, Modal, PageTitle, inputClass } from '../components/ui'
import type { ExpenseCategory } from '../domain/types'

export function Categories({ onOpenStatement }: { onOpenStatement: (categoryId: string) => void }) {
  const categories = useLiveQuery(() => db.categories.toArray(), [])
  const spentByCategory = useLiveQuery(async () => {
    const entries = await db.ledger.where('type').equals('EXPENSE').toArray()
    const map = new Map<string, number>()
    for (const e of entries) {
      if (!e.categoryId) continue
      const sign = e.reversalOfId ? -1 : 1
      map.set(e.categoryId, (map.get(e.categoryId) ?? 0) + sign * e.amountQirsh)
    }
    return map
  }, [])

  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState<ExpenseCategory | null>(null)
  const [error, setError] = useState('')

  const active = (categories ?? []).filter((c) => c.active)
  const archived = (categories ?? []).filter((c) => !c.active)

  return (
    <div className="space-y-4">
      <PageTitle action={<Button onClick={() => setShowAdd(true)}>+ بند جديد</Button>}>بنود المصروفات</PageTitle>
      {error && <Banner kind="error">{error}</Banner>}

      {active.length === 0 ? (
        <EmptyState>لا توجد بنود مصروفات بعد. اضغط "+ بند جديد" للبدء (مثل: البناء، الكهرباء، السيراميك)</EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {active.map((c) => {
              const spent = spentByCategory?.get(c.id) ?? 0
              const rawPct = c.budgetQirsh > 0 ? (spent / c.budgetQirsh) * 100 : null
              const pct = rawPct !== null ? Math.min(100, rawPct) : null
              return (
                <li key={c.id} className="py-3">
                  <button className="w-full text-right" onClick={() => onOpenStatement(c.id)}>
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-800">{c.name}</span>
                      <span className="font-semibold text-slate-800 tabular-nums">{formatEGP(spent)}</span>
                    </div>
                    {c.budgetQirsh > 0 && (
                      <>
                        <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                          <div
                            className={`h-full ${rawPct! > 100 ? 'bg-red-500' : rawPct! > 85 ? 'bg-amber-500' : 'bg-teal-600'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          الميزانية: {formatEGP(c.budgetQirsh)} · المتبقي: {formatEGP(c.budgetQirsh - spent)}
                        </div>
                      </>
                    )}
                  </button>
                  <button className="text-xs text-teal-700 mt-1" onClick={() => setEditing(c)}>
                    تعديل / أرشفة
                  </button>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {archived.length > 0 && (
        <Card>
          <h3 className="font-bold text-slate-500 mb-2 text-sm">بنود مؤرشفة</h3>
          <ul className="divide-y divide-slate-100">
            {archived.map((c) => (
              <li key={c.id} className="py-2 text-sm text-slate-400 flex justify-between">
                <button onClick={() => onOpenStatement(c.id)}>{c.name}</button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <AddCategoryModal open={showAdd} onClose={() => setShowAdd(false)} onError={setError} />
      {editing && <EditCategoryModal category={editing} onClose={() => setEditing(null)} onError={setError} />}
    </div>
  )
}

function AddCategoryModal({ open, onClose, onError }: { open: boolean; onClose: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [budget, setBudget] = useState('')

  async function submit() {
    try {
      onError('')
      await addCategory({ name, description, budgetQirsh: budget ? egpToQirsh(Number(budget)) : 0 })
      setName('')
      setDescription('')
      setBudget('')
      onClose()
    } catch (e) {
      onError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="بند مصروفات جديد">
      <Field label="اسم البند">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: الكهرباء" />
      </Field>
      <Field label="وصف (اختياري)">
        <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="الميزانية التقديرية بالجنيه (اختياري)">
        <input type="number" className={inputClass} value={budget} onChange={(e) => setBudget(e.target.value)} />
      </Field>
      <Button className="w-full" onClick={submit} disabled={!name.trim()}>
        حفظ
      </Button>
    </Modal>
  )
}

function EditCategoryModal({ category, onClose, onError }: { category: ExpenseCategory; onClose: () => void; onError: (m: string) => void }) {
  const [name, setName] = useState(category.name)
  const [description, setDescription] = useState(category.description ?? '')
  const [budget, setBudget] = useState(category.budgetQirsh > 0 ? String(category.budgetQirsh / 100) : '')

  async function save() {
    try {
      await updateCategory(category.id, { name, description, budgetQirsh: budget ? egpToQirsh(Number(budget)) : 0 })
      onClose()
    } catch (e) {
      onError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  async function archive() {
    await archiveCategory(category.id)
    onClose()
  }

  async function tryDelete() {
    try {
      await deleteCategoryIfUnused(category.id)
      onClose()
    } catch (e) {
      onError(e instanceof LedgerError ? e.message : 'حدث خطأ غير متوقع')
    }
  }

  return (
    <Modal open onClose={onClose} title="تعديل البند">
      <Field label="اسم البند">
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="وصف">
        <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="الميزانية التقديرية بالجنيه">
        <input type="number" className={inputClass} value={budget} onChange={(e) => setBudget(e.target.value)} />
      </Field>
      <Button className="w-full mb-3" onClick={save}>
        حفظ
      </Button>
      <div className="flex gap-2 border-t pt-3">
        <Button variant="secondary" className="flex-1" onClick={archive}>
          أرشفة البند
        </Button>
        <Button variant="danger" className="flex-1" onClick={tryDelete}>
          حذف (إن لم يكن له حركات)
        </Button>
      </div>
    </Modal>
  )
}
