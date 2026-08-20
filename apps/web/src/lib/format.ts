import type { QtySpec, Rate } from '@osrs-loot-simulator/loot-model'

/** PROJECT_PLAN.md 9: "Show fractions (1/128) alongside decimals." */
export function formatRate(rate: Rate): string {
  switch (rate.kind) {
    case 'always':
      return 'Always'
    case 'fixed':
      return `${formatFraction(rate.num, rate.den)} (${formatPercent(rate.num / rate.den)})`
    case 'weight':
      // A formula-driven weight has no number until it is compiled against a
      // context (ToA's unique pool is reweighted by raid level), so name the
      // formula rather than printing "[object Object]".
      return typeof rate.weight === 'number'
        ? `${rate.weight} (share of table)`
        : `formula: ${rate.weight.id} (share of table)`
    case 'formula':
      return `formula: ${rate.id}`
  }
}

export function formatFraction(num: number, den: number): string {
  if (num === 0) return '0'
  const divisor = gcd(Math.round(num), Math.round(den))
  if (divisor > 1 && Number.isInteger(num) && Number.isInteger(den)) {
    return `${num / divisor}/${den / divisor}`
  }
  return `${num}/${den}`
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

export function formatPercent(p: number, digits = 3): string {
  return `${(p * 100).toFixed(digits)}%`
}

export function formatQty(qty: QtySpec): string {
  switch (qty.kind) {
    case 'exact':
      return String(qty.n)
    case 'range':
      return `${qty.min}-${qty.max}`
    case 'choice':
      return qty.values.join('/')
    case 'formula':
      return `formula: ${qty.id}`
  }
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n))
}

/**
 * K/M/B/T-suffixed, for card grids where a full grouped number ("×2,048,338")
 * would push everything else off the row. `formatNumber` is still what a
 * hover title/log entry shows — this is a lossy display form, not a
 * replacement.
 */
export function formatCompact(n: number): string {
  const rounded = Math.round(n)
  const abs = Math.abs(rounded)
  if (abs >= 1_000_000_000_000) return `${(rounded / 1_000_000_000_000).toFixed(2)}T`
  if (abs >= 1_000_000_000) return `${(rounded / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(rounded / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(rounded / 1_000).toFixed(1)}K`
  return formatNumber(rounded)
}

export function formatGp(n: number): string {
  const rounded = Math.round(n)
  if (Math.abs(rounded) >= 1_000) return `${formatCompact(rounded)} gp`
  return `${formatNumber(rounded)} gp`
}
