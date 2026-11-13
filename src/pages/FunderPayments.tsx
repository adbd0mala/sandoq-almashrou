import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef } from 'react'
import { listFunderPayments } from '../domain/ledger'
import { formatEGP, formatUnits } from '../domain/money'
import { Button, Card, EmptyState, PageTitle } from '../components/ui'
import { PAYMENT_METHOD_LABELS } from '../domain/types'

/** What each funder has paid in: one table per funder with the date and
 * amount of every payment and the total, under a summary of all of them.
 * `focusFunderId` scrolls straight to that funder's table. */
export function FunderPayments({ focusFunderId, onBack }: { focusFunderId?: string; onBack: () => void }) {
  const funders = useLiveQuery(listFunderPayments, [])
  const tables = useRef<Record<string, HTMLDivElement | null>>({})
  const loaded = funders !== undefined

  useEffect(() => {
    if (loaded && focusFunderId) tables.current[focusFunderId]?.scrollIntoView({ block: 'start' })
  }, [loaded, focusFunderId])

  if (!funders) return null

  const grandTotal = funders.reduce((s, f) => s + f.totalPaidQirsh, 0)

  return (
    <div className="space-y-4">
      <PageTitle
        action={
          <Button variant="secondary" onClick={onBack}>
            رجوع
          </Button>
        }
      >
        دفعات الممولين
      </PageTitle>

      {funders.length === 0 ? (
        <EmptyState>لا يوجد ممولون بعد</EmptyState>
      ) : (
        <>
          <Card>
            <h3 className="font-bold text-slate-700 mb-2">إجمالي المدفوع من كل ممول</h3>
            <table className="w-full text-sm border border-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-1.5 text-right">الممول</th>
                  <th className="p-1.5 text-right">عدد الدفعات</th>
                  <th className="p-1.5 text-right">الإجمالي المدفوع</th>
                </tr>
              </thead>
              <tbody>
                {funders.map((f) => (
                  <tr key={f.funder.id} className="border-t border-slate-100">
                    <td className="p-1.5 break-words max-w-[130px]">{f.funder.name}</td>
                    <td className="p-1.5 tabular-nums">{formatUnits(f.payments.length)}</td>
                    <td className="p-1.5 tabular-nums">{formatEGP(f.totalPaidQirsh)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 font-bold">
                  <td className="p-1.5" colSpan={2}>
                    الإجمالي
                  </td>
                  <td className="p-1.5 tabular-nums">{formatEGP(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </Card>

          {funders.map((f) => (
            <div
              key={f.funder.id}
              className="scroll-mt-4"
              ref={(el) => {
                tables.current[f.funder.id] = el
              }}
            >
              <Card>
                <h3 className="font-bold text-slate-800 mb-2 break-words">
                  {f.funder.name}
                  {!f.funder.active && <span className="text-xs font-normal text-slate-400"> (مؤرشف)</span>}
                </h3>
                {f.payments.length === 0 ? (
                  <p className="text-sm text-slate-400">لسه مسجّلش أي دفعة</p>
                ) : (
                  <table className="w-full text-sm border border-slate-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="p-1.5 text-right">التاريخ</th>
                        <th className="p-1.5 text-right">البيان</th>
                        <th className="p-1.5 text-right">المبلغ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.payments.map((p) => (
                        <tr key={p.id} className="border-t border-slate-100">
                          <td className="p-1.5 whitespace-nowrap">{p.date}</td>
                          <td className="p-1.5 break-words max-w-[120px]">
                            {p.description}
                            <div className="text-xs text-slate-400">
                              {p.paymentMethod ? PAYMENT_METHOD_LABELS[p.paymentMethod] : ''}
                              {p.invoiceNumber ? ` · إيصال ${p.invoiceNumber}` : ''}
                            </div>
                          </td>
                          <td className="p-1.5 tabular-nums">{formatEGP(p.amountQirsh)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-slate-50 font-bold">
                        <td className="p-1.5" colSpan={2}>
                          الإجمالي المدفوع
                        </td>
                        <td className="p-1.5 tabular-nums">{formatEGP(f.totalPaidQirsh)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </Card>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
