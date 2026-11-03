import { useEffect, useState } from 'react'
import { Dashboard } from './pages/Dashboard'
import { Funders } from './pages/Funders'
import { Categories } from './pages/Categories'
import { RecordExpense } from './pages/RecordExpense'
import { RecordContribution } from './pages/RecordContribution'
import { Reports } from './pages/Reports'
import { BackupPage } from './pages/BackupPage'
import { runDailyAutoBackupIfDue } from './backup/backup'

type Tab = 'home' | 'expense' | 'contribution' | 'funders' | 'categories' | 'reports' | 'backup'

const NAV: { tab: Tab; label: string; icon: string }[] = [
  { tab: 'home', label: 'الرئيسية', icon: '🏠' },
  { tab: 'funders', label: 'الممولون', icon: '👥' },
  { tab: 'categories', label: 'البنود', icon: '🧾' },
  { tab: 'reports', label: 'التقارير', icon: '📊' },
  { tab: 'backup', label: 'المزيد', icon: '⚙️' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [reportCategoryId, setReportCategoryId] = useState<string | undefined>(undefined)

  useEffect(() => {
    runDailyAutoBackupIfDue().catch(() => {
      // non-fatal: the manual backup button on the backup page still works
    })
  }, [])

  function openCategoryStatement(categoryId: string) {
    setReportCategoryId(categoryId)
    setTab('reports')
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20" dir="rtl">
      <div className="max-w-md mx-auto px-4 pt-5">
        {tab === 'home' && <Dashboard onNavigate={(t) => setTab(t as Tab)} />}
        {tab === 'expense' && <RecordExpense onDone={() => setTab('home')} />}
        {tab === 'contribution' && <RecordContribution onDone={() => setTab('home')} />}
        {tab === 'funders' && <Funders />}
        {tab === 'categories' && <Categories onOpenStatement={openCategoryStatement} />}
        {tab === 'reports' && <Reports initialCategoryId={reportCategoryId} />}
        {tab === 'backup' && <BackupPage />}
      </div>

      <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 flex max-w-md mx-auto">
        {NAV.map((n) => (
          <button
            key={n.tab}
            onClick={() => setTab(n.tab)}
            className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 text-xs ${
              tab === n.tab || (n.tab === 'backup' && tab === 'backup') ? 'text-teal-700 font-bold' : 'text-slate-400'
            }`}
          >
            <span className="text-lg">{n.icon}</span>
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
