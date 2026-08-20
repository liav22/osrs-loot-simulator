import { describe, expect, it } from 'vitest'
import { formatCompact, formatFraction, formatGp, formatPercent, formatQty, formatRate } from '../src/lib/format'

describe('formatFraction', () => {
  it('reduces to lowest terms', () => {
    expect(formatFraction(2, 4)).toBe('1/2')
  })
  it('leaves an already-reduced fraction alone', () => {
    expect(formatFraction(3, 128)).toBe('3/128')
  })
  it('shows 0 plainly, not 0/N', () => {
    expect(formatFraction(0, 128)).toBe('0')
  })
})

describe('formatPercent', () => {
  it('formats to 3 decimal places by default', () => {
    expect(formatPercent(0.5)).toBe('50.000%')
  })
})

describe('formatQty', () => {
  it('formats exact, range and choice kinds', () => {
    expect(formatQty({ kind: 'exact', n: 3 })).toBe('3')
    expect(formatQty({ kind: 'range', min: 2, max: 5 })).toBe('2-5')
    expect(formatQty({ kind: 'choice', values: [1, 5, 10] })).toBe('1/5/10')
  })
})

describe('formatRate', () => {
  it('formats always, fixed, weight and formula rates', () => {
    expect(formatRate({ kind: 'always' })).toBe('Always')
    expect(formatRate({ kind: 'fixed', num: 1, den: 4 })).toBe('1/4 (25.000%)')
    expect(formatRate({ kind: 'weight', weight: 5 })).toBe('5 (share of table)')
    expect(formatRate({ kind: 'formula', id: 'wilderness_slayer', params: {} })).toBe('formula: wilderness_slayer')
  })
})

describe('formatCompact', () => {
  it('uses K/M/B/T suffixes at the right thresholds', () => {
    expect(formatCompact(500)).toBe('500')
    expect(formatCompact(1_500)).toBe('1.5K')
    expect(formatCompact(2_500_000)).toBe('2.50M')
    expect(formatCompact(55_026_420_000)).toBe('55.03B')
    expect(formatCompact(1_200_000_000_000)).toBe('1.20T')
  })
})

describe('formatGp', () => {
  it('uses K/M/B suffixes at the right thresholds', () => {
    expect(formatGp(500)).toBe('500 gp')
    expect(formatGp(1_500)).toBe('1.5K gp')
    expect(formatGp(2_500_000)).toBe('2.50M gp')
    expect(formatGp(55_026_420_000)).toBe('55.03B gp')
  })
})
