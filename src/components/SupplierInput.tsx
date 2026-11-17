import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { listSupplierAccounts, listSupplierNames, supplierKey } from '../domain/ledger'
import { formatEGP } from '../domain/money'
import { inputClass } from './ui'

/** Supplier field as a searchable drop-down: the arrow opens the list of
 * suppliers already used (most recent first, with what is owed to each),
 * typing in the box searches it, and tapping a name fills it in exactly as
 * it was written before — which is what puts a new purchase on the same
 * supplier account. A name that isn't in the list is simply a new supplier. */
export function SupplierInput({ value, onChange, maxLength = 80 }: { value: string; onChange: (name: string) => void; maxLength?: number }) {
  const names = useLiveQuery(listSupplierNames, []) ?? []
  const accounts = useLiveQuery(listSupplierAccounts, []) ?? []
  const [open, setOpen] = useState(false)
  // The box holds a name already when the list opens; only what is typed
  // after that is a search, so opening it always shows every supplier.
  const [searching, setSearching] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  // Opened with the arrow, the box may not have focus, so there is no blur
  // to close the list: a tap anywhere outside does it.
  useEffect(() => {
    if (!open) return
    const closeIfOutside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeIfOutside)
    return () => document.removeEventListener('pointerdown', closeIfOutside)
  }, [open])

  // On a phone the keyboard takes the lower half of the screen and the list
  // opens under the field — move the field up so the list is in view. The
  // short wait lets the keyboard finish opening (the browser scrolls then too).
  useEffect(() => {
    if (!open || !window.matchMedia('(pointer: coarse)').matches) return
    const timer = setTimeout(() => root.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 300)
    return () => clearTimeout(timer)
  }, [open])

  const typed = supplierKey(value)
  const matches = searching && typed ? names.filter((n) => n.includes(typed)) : names
  const isNew = typed !== '' && !names.includes(typed)
  const owed = new Map(accounts.map((a) => [a.name, a.remainingQirsh]))
  // Keeps the box's focus (and the keyboard) where it is while the list is used.
  const keepFocus = (e: React.SyntheticEvent) => e.preventDefault()

  return (
    <div ref={root} className="relative scroll-mt-20">
      <input
        className={`${inputClass} pl-11`}
        role="combobox"
        aria-expanded={open}
        value={value}
        maxLength={maxLength}
        placeholder="اختار من القائمة أو اكتب اسم"
        onFocus={() => {
          setSearching(false)
          setOpen(true)
        }}
        onChange={(e) => {
          onChange(e.target.value)
          setSearching(true)
          setOpen(true)
        }}
        onBlur={() => setOpen(false)}
      />
      <button
        type="button"
        aria-label="قائمة الموردين"
        className="absolute left-0 inset-y-0 px-3.5 text-slate-600 text-xl"
        onPointerDown={keepFocus}
        onMouseDown={keepFocus}
        onClick={() => {
          setSearching(false)
          setOpen((v) => !v)
        }}
      >
        {open ? '▴' : '▾'}
      </button>
      {open && (
        <ul
          className="absolute z-20 top-full inset-x-0 mt-1 bg-white border border-slate-300 rounded-xl shadow-lg max-h-56 overflow-y-auto divide-y divide-slate-100"
          onPointerDown={keepFocus}
          onMouseDown={keepFocus}
        >
          {matches.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="w-full text-right px-3 py-2.5 text-sm flex justify-between items-center gap-2 active:bg-slate-50"
                onClick={() => {
                  onChange(name)
                  setOpen(false)
                }}
              >
                <span className={`min-w-0 break-words ${name === typed ? 'font-bold text-teal-700' : 'text-slate-800'}`}>{name}</span>
                {(owed.get(name) ?? 0) > 0 && (
                  <span className="shrink-0 text-xs text-amber-700 tabular-nums">باقي عليه {formatEGP(owed.get(name) ?? 0)}</span>
                )}
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-slate-400">
              {names.length === 0 ? 'مفيش موردين مسجلين لسه. اكتب اسم المورد' : 'مفيش مورد بالاسم ده في القائمة'}
            </li>
          )}
          {isNew && <li className="px-3 py-2.5 text-xs text-teal-700">هيتسجل كمورد جديد: «{typed}»</li>}
        </ul>
      )}
    </div>
  )
}
