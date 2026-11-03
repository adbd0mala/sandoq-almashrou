import type { ReactNode } from 'react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-4 ${className}`}>{children}</div>
}

export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h1 className="text-xl font-bold text-slate-800">{children}</h1>
      {action}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  disabled,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  type?: 'button' | 'submit'
  disabled?: boolean
  className?: string
}) {
  const styles: Record<string, string> = {
    primary: 'bg-teal-700 text-white active:bg-teal-800 disabled:bg-slate-300',
    secondary: 'bg-slate-100 text-slate-700 active:bg-slate-200',
    danger: 'bg-red-600 text-white active:bg-red-700',
    ghost: 'bg-transparent text-teal-700',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2.5 rounded-xl font-semibold text-sm transition disabled:cursor-not-allowed ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block mb-3">
      <span className="block text-sm font-medium text-slate-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-400 mt-1">{hint}</span>}
    </label>
  )
}

export const inputClass =
  'w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600 bg-white'

export function Banner({ kind, children }: { kind: 'error' | 'success' | 'info'; children: ReactNode }) {
  const styles: Record<string, string> = {
    error: 'bg-red-50 text-red-700 border-red-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    info: 'bg-sky-50 text-sky-700 border-sky-200',
  }
  return <div className={`border rounded-xl px-3 py-2 text-sm mb-3 ${styles[kind]}`}>{children}</div>
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="text-center text-slate-400 text-sm py-10">{children}</div>
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-4 pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-lg text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-400 text-2xl leading-none px-2">
            &times;
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
