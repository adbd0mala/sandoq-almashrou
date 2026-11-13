import { useLiveQuery } from 'dexie-react-hooks'
import { getDashboardSummary, signedAmount } from '../domain/ledger'
import { formatEGP } from '../domain/money'
import { Card, EmptyState, PageTitle } from '../components/ui'
import { PAYMENT_METHOD_LABELS } from '../domain/types'

export function Dashboard({
  onNavigate,
  onOpenReport,
}: {
  onNavigate: (tab: string) => void
  onOpenReport: (tab: 'payables' | 'items') => void
}) {
  const summary = useLiveQuery(getDashboardSummary, [])

  if (!summary) return null

  return (
    <div className="space-y-4">
      <PageTitle>صندوق المشروع</PageTitle>

      <Card className="bg-gradient-to-br from-teal-700 to-teal-800 text-white border-0">
        <div className="text-sm opacity-80 mb-1">رصيد الصندوق الحالي</div>
        <div className="text-3xl font-extrabold tabular-nums">{formatEGP(summary.balanceQirsh)}</div>
        <div className="flex gap-4 mt-3 text-sm opacity-90">
          <span>مساهمات: {formatEGP(summary.totalContributionsQirsh)}</span>
          <span>مصروفات: {formatEGP(summary.totalExpensesQirsh)}</span>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <button onClick={() => onNavigate('expense')} className="bg-white rounded-2xl border border-slate-200 p-4 text-right active:bg-slate-50">
          <div className="text-2xl mb-1">💸</div>
          <div className="font-semibold text-slate-700">تسجيل مصروف</div>
        </button>
        <button onClick={() => onNavigate('contribution')} className="bg-white rounded-2xl border border-slate-200 p-4 text-right active:bg-slate-50">
          <div className="text-2xl mb-1">➕</div>
          <div className="font-semibold text-slate-700">تسجيل مساهمة</div>
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-center">
        <button onClick={() => onNavigate('funders')} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 active:bg-slate-50">
          <div className="text-2xl font-bold text-slate-800">{summary.funderCount}</div>
          <div className="text-xs text-teal-700 font-semibold mt-1">ممولون نشطون ‹</div>
        </button>
        <button onClick={() => onNavigate('categories')} className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 active:bg-slate-50">
          <div className="text-2xl font-bold text-slate-800">{summary.categoryCount}</div>
          <div className="text-xs text-teal-700 font-semibold mt-1">بند مصروفات نشط ‹</div>
        </button>
      </div>

      {summary.totalPayablesQirsh > 0 && (
        <button onClick={() => onOpenReport('payables')} className="w-full text-right">
          <Card className="bg-amber-50 border-amber-200">
            <div className="flex justify-between items-center">
              <span className="text-sm text-amber-700">مستحقات مفتوحة لموردين</span>
              <span className="font-bold text-amber-800 tabular-nums">{formatEGP(summary.totalPayablesQirsh)}</span>
            </div>
          </Card>
        </button>
      )}

      {summary.totalUnallocatedAdvancesQirsh > 0 && (
        <button onClick={() => onOpenReport('items')} className="w-full text-right">
          <Card className="bg-sky-50 border-sky-200">
            <div className="flex justify-between items-center">
              <span className="text-sm text-sky-700">أصناف ودفعات لسه مش موزَّعة على بنود</span>
              <span className="font-bold text-sky-800 tabular-nums">{formatEGP(summary.totalUnallocatedAdvancesQirsh)}</span>
            </div>
          </Card>
        </button>
      )}

      <Card>
        <h3 className="font-bold text-slate-700 mb-2">أعلى البنود إنفاقًا</h3>
        {summary.topCategories.filter((c) => c.spentQirsh > 0).length === 0 ? (
          <EmptyState>لا توجد مصروفات مسجلة بعد</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {summary.topCategories
              .filter((c) => c.spentQirsh > 0)
              .map((c) => (
                <li key={c.category.id} className="flex justify-between py-2 text-sm">
                  <span className="text-slate-600">{c.category.name}</span>
                  <span className="font-semibold text-slate-800 tabular-nums">{formatEGP(c.spentQirsh)}</span>
                </li>
              ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="font-bold text-slate-700 mb-2">آخر الحركات</h3>
        {summary.recentEntries.length === 0 ? (
          <EmptyState>لا توجد حركات مسجلة بعد</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {summary.recentEntries.map((e) => (
              <li key={e.id} className="py-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-700">{e.description}</span>
                  {e.affectsVault === false ? (
                    <span className="font-semibold tabular-nums text-sky-600">{formatEGP(e.amountQirsh)}</span>
                  ) : (
                    <span className={`font-semibold tabular-nums ${signedAmount(e) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {signedAmount(e) >= 0 ? '+' : '-'}
                      {formatEGP(e.amountQirsh)}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {e.date} {e.paymentMethod ? `· ${PAYMENT_METHOD_LABELS[e.paymentMethod]}` : ''}
                  {e.affectsVault === false && ' · توزيع من دفعة سابقة (من غير خصم جديد)'}
                  {e.reversed && ' · (ملغاة)'}
                  {e.reversalOfId && ' · حركة إلغاء'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
