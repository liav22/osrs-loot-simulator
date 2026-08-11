import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { classify, classifyRows, groupByDenominator } from '../src/triage/classify.js'
import { snapshotPath } from '../src/snapshots/store.js'
import { BucketResponseSchema, SnapshotSchema } from '../src/wiki/schemas.js'

/**
 * Verifies the members/F2P weight split PROJECT_PLAN.md 6.4 states for Brutus
 * against the live snapshot.
 *
 * Reads from `data/snapshots/`, which is gitignored and regenerable — the wiki
 * rows are CC BY-NC-SA and are never copied into this MIT-licensed directory.
 * Run `pnpm ingest fetch --page Brutus` to populate it; without the snapshot
 * these assertions skip rather than fail, so CI stays green on a clean checkout.
 */

const path = snapshotPath('dropsline', 'brutus')
const present = existsSync(path)

describe.skipIf(!present)('Brutus snapshot vs PROJECT_PLAN.md 6.4', () => {
  const response = BucketResponseSchema.parse(
    SnapshotSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).body
  )
  const rawRows = response.bucket ?? []
  const { rows } = classifyRows(rawRows)
  const groups = groupByDenominator(rows)
  const main = groups.find((group) => group.denominator === 81)

  it('has an /81 main table group', () => {
    expect(main).toBeDefined()
  })

  it('sums to 106/81 when the variants are naively merged', () => {
    expect(main?.naiveSum).toBe(106)
  })

  it('sums to exactly 81 for members', () => {
    expect(main?.membersSum).toBe(81)
  })

  it('sums to exactly 81 for free-to-play', () => {
    expect(main?.freeToPlaySum).toBe(81)
  })

  it('reconciles only after the membership split', () => {
    expect(main?.reconcilesFlat).toBe(false)
    expect(main?.reconcilesSplit).toBe(true)
  })

  it('triages as tier B', () => {
    const result = classify({
      title: 'Brutus',
      slug: 'brutus',
      rawRows,
      bucketError: response.error ?? null,
    })
    expect(result.tier).toBe('B')
    expect(result.hasRareDropTable).toBe(false)
  })

  it('has two Always rows', () => {
    expect(rows.filter((row) => row.isAlways)).toHaveLength(2)
  })
})
