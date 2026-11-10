import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { db, ensureSettings } from '../db/db'
import {
  BackupValidationError,
  buildBackupPayload,
  createSnapshotNow,
  deleteSnapshot,
  downloadBackupFile,
  listSnapshots,
  readBackupFile,
  restoreFromPayload,
  restoreFromSnapshotId,
} from '../backup/backup'
import { Banner, Button, Card, EmptyState, Field, PageTitle } from '../components/ui'

export function BackupPage() {
  const settings = useLiveQuery(ensureSettings, [])
  const snapshots = useLiveQuery(listSnapshots, [])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function doManualBackup() {
    setError('')
    const payload = await buildBackupPayload()
    downloadBackupFile(payload)
    await createSnapshotNow('MANUAL')
    setSuccess('تم إنشاء النسخة الاحتياطية وتنزيلها')
  }

  async function onFileChosen(file: File) {
    setError('')
    setSuccess('')
    try {
      const data = await readBackupFile(file)
      if (!confirm('سيتم استبدال كل البيانات الحالية بالنسخة الاحتياطية المختارة. متأكد؟')) return
      await restoreFromPayload(data)
      setSuccess('تمت الاستعادة بنجاح')
    } catch (e) {
      setError(e instanceof BackupValidationError ? e.message : 'فشلت الاستعادة. لم يتم تغيير أي بيانات حالية')
    }
  }

  async function restoreSnapshot(id: string) {
    if (!confirm('سيتم استبدال كل البيانات الحالية بهذه النسخة. متأكد؟')) return
    setError('')
    setSuccess('')
    try {
      await restoreFromSnapshotId(id)
      setSuccess('تمت الاستعادة بنجاح')
    } catch (e) {
      setError(e instanceof BackupValidationError ? e.message : 'فشلت الاستعادة')
    }
  }

  async function toggleOverdraft() {
    if (!settings) return
    await db.settings.update('singleton', { allowOverdraft: !settings.allowOverdraft })
  }

  return (
    <div className="space-y-4">
      <PageTitle>النسخ الاحتياطي والإعدادات</PageTitle>
      {error && <Banner kind="error">{error}</Banner>}
      {success && <Banner kind="success">{success}</Banner>}

      <Card>
        <h3 className="font-bold text-slate-700 mb-2">نسخة احتياطية يدوية</h3>
        <p className="text-sm text-slate-500 mb-3">
          يُنصح بعمل نسخة احتياطية وحفظها في مكان آمن خارج الموبايل (مثل Google Drive أو البريد الإلكتروني) بشكل دوري، لأن البيانات مخزنة على هذا الجهاز فقط.
        </p>
        <Button className="w-full" onClick={doManualBackup}>
          تصدير نسخة احتياطية الآن
        </Button>
      </Card>

      <Card>
        <h3 className="font-bold text-slate-700 mb-2">استعادة من ملف</h3>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFileChosen(e.target.files[0])}
        />
        <Button variant="secondary" className="w-full" onClick={() => fileRef.current?.click()}>
          اختيار ملف نسخة احتياطية للاستعادة
        </Button>
      </Card>

      <Card>
        <h3 className="font-bold text-slate-700 mb-2">نسخ محفوظة تلقائيًا على الجهاز</h3>
        <p className="text-xs text-slate-400 mb-2">يتم إنشاء نسخة يوميًا تلقائيًا عند فتح التطبيق، ويُحتفظ بآخر 14 نسخة</p>
        {!snapshots || snapshots.length === 0 ? (
          <EmptyState>لا توجد نسخ محفوظة بعد</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {snapshots.map((s) => (
              <li key={s.id} className="py-2 flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium text-slate-700">{new Date(s.createdAt).toLocaleString('ar-EG')}</div>
                  <div className="text-xs text-slate-400">{s.kind === 'AUTO' ? 'تلقائية' : 'يدوية'} · {(s.sizeBytes / 1024).toFixed(1)} كيلوبايت</div>
                </div>
                <div className="flex gap-2">
                  <button className="text-teal-700 text-xs font-semibold" onClick={() => restoreSnapshot(s.id)}>
                    استعادة
                  </button>
                  <button
                    className="text-red-500 text-xs font-semibold"
                    onClick={() => confirm('هتحذف النسخة دي نهائيًا. متأكد؟') && deleteSnapshot(s.id)}
                  >
                    حذف
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {settings && (
        <Card>
          <h3 className="font-bold text-slate-700 mb-2">إعدادات</h3>
          <Field label="اسم المشروع">
            <input
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5"
              defaultValue={settings.projectName}
              onBlur={(e) => db.settings.update('singleton', { projectName: e.target.value })}
            />
          </Field>
          <label className="flex items-center justify-between py-2">
            <span className="text-sm text-slate-600">السماح بالسحب على المكشوف (صرف أكبر من الرصيد المتاح)</span>
            <input type="checkbox" checked={settings.allowOverdraft} onChange={toggleOverdraft} className="w-5 h-5" />
          </label>
        </Card>
      )}
    </div>
  )
}
