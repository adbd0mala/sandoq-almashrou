// All money is stored and computed as integer qirsh (1/100 EGP).
// This makes arithmetic exact (JS integers are exact up to 2^53), avoiding
// any floating point rounding error in financial calculations.

export function egpToQirsh(egp: number): number {
  return Math.round(egp * 100)
}

export function qirshToEgp(qirsh: number): number {
  return qirsh / 100
}

export function formatEGP(qirsh: number): string {
  const egp = qirshToEgp(qirsh)
  return (
    egp.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م'
  )
}

/** A quantity or percentage for display: Arabic digits like the money
 * amounts beside it, at most 2 decimals, no trailing zeros. */
export function formatUnits(n: number): string {
  return n.toLocaleString('ar-EG', { maximumFractionDigits: 2 })
}

/**
 * Split `totalQirsh` across `weights` (percentages, must sum to ~100) so the
 * parts sum EXACTLY to totalQirsh. Uses the largest-remainder method:
 * floor each share, then hand out the leftover qirsh one by one to the
 * entries with the largest fractional remainder (ties broken by index,
 * i.e. by funder id order) so the result is fully deterministic.
 */
export function splitProportionally(
  totalQirsh: number,
  weights: { key: string; percent: number }[],
): { key: string; amountQirsh: number }[] {
  if (weights.length === 0) return []
  const weightSum = weights.reduce((s, w) => s + w.percent, 0)
  if (weightSum <= 0) throw new Error('إجمالي النسب يجب أن يكون أكبر من صفر')

  const raw = weights.map((w) => ({
    key: w.key,
    exact: (totalQirsh * w.percent) / weightSum,
  }))
  const floored = raw.map((r) => ({ key: r.key, amountQirsh: Math.floor(r.exact), remainder: r.exact - Math.floor(r.exact) }))

  let allocated = floored.reduce((s, f) => s + f.amountQirsh, 0)
  let leftover = totalQirsh - allocated

  const order = [...floored]
    .map((f, idx) => ({ ...f, idx }))
    .sort((a, b) => (b.remainder - a.remainder) || (a.idx - b.idx))

  const byKey = new Map(floored.map((f) => [f.key, f.amountQirsh]))
  for (let i = 0; i < order.length && leftover > 0; i++, leftover--) {
    byKey.set(order[i].key, (byKey.get(order[i].key) ?? 0) + 1)
  }

  return weights.map((w) => ({ key: w.key, amountQirsh: byKey.get(w.key) ?? 0 }))
}

/**
 * Rounds a set of percentages to 2 decimals for display/editing in a form —
 * guaranteeing the rounded values sum to EXACTLY 100.00, via the same
 * largest-remainder method as splitProportionally (scaled to centipercent).
 * Without this, three equal 33.333...% shares would each independently
 * round to "33.33", summing to 99.99 and failing a "must equal 100%"
 * check the moment the form reopens — even though nothing changed.
 */
export function roundPercentsForDisplay(shares: { key: string; percent: number }[]): Map<string, string> {
  const centipercent = splitProportionally(
    10000,
    shares.map((s) => ({ key: s.key, percent: s.percent })),
  )
  return new Map(centipercent.map((c) => [c.key, (c.amountQirsh / 100).toFixed(2)]))
}
