import type { QtySpec, Rate } from '@osrs-loot-simulator/loot-model'

/** PROJECT_PLAN.md 9: "Show fractions (1/128) alongside decimals." */
export function formatRate(rate: Rate): string {
  switch (rate.kind) {
    case 'always':
      return 'Always'
    case 'fixed':
      return `${formatFraction(rate.num, rate.den)} (${formatPercent(rate.num / rate.den)})`
    case 'weight':
      return `${rate.weight} (share of table)`
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
  }
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n))
}

export function formatGp(n: number): string {
  const rounded = Math.round(n)
  if (Math.abs(rounded) >= 1_000_000) return `${(rounded / 1_000_000).toFixed(2)}M gp`
  if (Math.abs(rounded) >= 1_000) return `${(rounded / 1_000).toFixed(1)}K gp`
  return `${formatNumber(rounded)} gp`
}
