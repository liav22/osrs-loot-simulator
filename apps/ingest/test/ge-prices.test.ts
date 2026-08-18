import { describe, expect, it } from 'vitest'
import { priceOf } from '../src/prices/ge-prices.js'

describe('priceOf', () => {
  it('prefers the more recently timestamped trade over averaging, when timestamps disagree', () => {
    // The real Cod (id 339) case: a stale high trade sitting next to a
    // fresh, much lower one. Averaging gave ~5,010gp for a 21gp item.
    expect(priceOf({ high: 10000, highTime: 1787064329, low: 21, lowTime: 1787065080 })).toBe(21)
  })

  it('picks the high trade when it is the more recent one', () => {
    expect(priceOf({ high: 100, highTime: 200, low: 50, lowTime: 100 })).toBe(100)
  })

  it('averages when both trades are equally recent', () => {
    expect(priceOf({ high: 100, highTime: 100, low: 50, lowTime: 100 })).toBe(75)
  })

  it('averages when timestamps are missing on either side', () => {
    expect(priceOf({ high: 100, low: 50 })).toBe(75)
  })

  it('falls back to whichever side is present when only one trade exists', () => {
    expect(priceOf({ high: 100, highTime: 100 })).toBe(100)
    expect(priceOf({ low: 50, lowTime: 100 })).toBe(50)
  })

  it('is undefined when neither side is a real number', () => {
    expect(priceOf({})).toBeUndefined()
    expect(priceOf({ high: null, low: null })).toBeUndefined()
  })
})
