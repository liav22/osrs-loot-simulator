import { describe, expect, it } from 'vitest'
import {
  ConditionSchema,
  conditionsHold,
  DEFAULT_SIM_CONTEXT,
  entryApplies,
  evaluateCondition,
  resolveSimContext,
  type Condition,
} from '../src/index'
import { ctxWith, makeBoss } from './helpers'

describe('evaluateCondition', () => {
  const cases: Array<[Condition, Parameters<typeof ctxWith>[0], boolean]> = [
    [{ kind: 'members', value: true }, { members: true }, true],
    [{ kind: 'members', value: true }, { members: false }, false],
    [{ kind: 'members', value: false }, { members: false }, true],
    [{ kind: 'ringOfWealth', value: true }, { ringOfWealth: true }, true],
    [{ kind: 'ringOfWealth', value: true }, { ringOfWealth: false }, false],
    [{ kind: 'onSlayerTask', value: true }, { onSlayerTask: true }, true],
    [{ kind: 'onSlayerTask', value: false }, { onSlayerTask: true }, false],
    [{ kind: 'questComplete', quest: "Legends' Quest" }, { questsComplete: ["Legends' Quest"] }, true],
    [{ kind: 'questComplete', quest: "Legends' Quest" }, { questsComplete: [] }, false],
    // `killCountAtLeast` was retired into `levelAtLeast`; this is its replacement spelling.
    [{ kind: 'levelAtLeast', field: 'killCount', n: 50 }, { killCount: 50 }, true],
    [{ kind: 'levelAtLeast', field: 'killCount', n: 50 }, { killCount: 49 }, false],
    // One-sided (no `atMost`) stays open-ended above `n`.
    [{ kind: 'levelAtLeast', field: 'delveLevel', n: 3 }, { delveLevel: 99 }, true],
    // Two-sided brackets: Reward pool's "Levels 40-45", inclusive at both ends.
    [{ kind: 'levelAtLeast', field: 'fishingLevel', n: 40, atMost: 45 }, { fishingLevel: 39 }, false],
    [{ kind: 'levelAtLeast', field: 'fishingLevel', n: 40, atMost: 45 }, { fishingLevel: 40 }, true],
    [{ kind: 'levelAtLeast', field: 'fishingLevel', n: 40, atMost: 45 }, { fishingLevel: 45 }, true],
    [{ kind: 'levelAtLeast', field: 'fishingLevel', n: 40, atMost: 45 }, { fishingLevel: 46 }, false],
    [{ kind: 'variant', name: 'demonic' }, { variant: 'demonic' }, true],
    [{ kind: 'variant', name: 'demonic' }, { variant: 'normal' }, false],
  ]

  it.each(cases)('%o against %o is %s', (condition, overrides, expected) => {
    expect(evaluateCondition(condition, ctxWith(overrides))).toBe(expected)
  })
})

describe('conditionsHold', () => {
  it('holds when the list is absent or empty', () => {
    expect(conditionsHold(undefined, DEFAULT_SIM_CONTEXT)).toBe(true)
    expect(conditionsHold([], DEFAULT_SIM_CONTEXT)).toBe(true)
  })

  it('ANDs every condition', () => {
    const conditions: Condition[] = [
      { kind: 'members', value: true },
      { kind: 'onSlayerTask', value: true },
    ]
    expect(conditionsHold(conditions, ctxWith({ members: true, onSlayerTask: true }))).toBe(true)
    expect(conditionsHold(conditions, ctxWith({ members: true, onSlayerTask: false }))).toBe(false)
    expect(conditionsHold(conditions, ctxWith({ members: false, onSlayerTask: true }))).toBe(false)
  })
})

describe('entryApplies', () => {
  it('reads only the entry conditions', () => {
    expect(entryApplies({ conditions: undefined }, DEFAULT_SIM_CONTEXT)).toBe(true)
    expect(
      entryApplies({ conditions: [{ kind: 'members', value: false }] }, ctxWith({ members: true }))
    ).toBe(false)
  })
})

describe('resolveSimContext', () => {
  const boss = makeBoss(
    [
      {
        id: 't',
        mode: 'always',
        entries: [
          {
            node: {
              kind: 'item',
              itemId: 1,
              itemKey: 'thing',
              name: 'Thing',
              qty: { kind: 'exact', n: 1 },
            },
            rate: { kind: 'always' },
          },
        ],
      },
    ],
    { contextDefaults: { members: false, variant: 'demonic' } }
  )

  it('layers overrides over boss defaults over package defaults', () => {
    expect(resolveSimContext(boss)).toEqual({
      ...DEFAULT_SIM_CONTEXT,
      members: false,
      variant: 'demonic',
    })
    expect(resolveSimContext(boss, { members: true })).toEqual({
      ...DEFAULT_SIM_CONTEXT,
      members: true,
      variant: 'demonic',
    })
  })
})

describe("'includes': set membership over a set-valued context field", () => {
  it('holds when ANY listed value is present, not only when all are', () => {
    const ctx = ctxWith({ moonsKilled: ['blood', 'eclipse'] })
    expect(evaluateCondition({ kind: 'includes', field: 'moonsKilled', values: ['blood'] }, ctx)).toBe(true)
    expect(evaluateCondition({ kind: 'includes', field: 'moonsKilled', values: ['blue'] }, ctx)).toBe(false)
    // Disjunction is the whole point: this is the one thing the conditions
    // array cannot already express, since it ANDs its members.
    expect(
      evaluateCondition({ kind: 'includes', field: 'moonsKilled', values: ['blue', 'eclipse'] }, ctx)
    ).toBe(true)
  })

  it('conjunction is still available by listing two conditions', () => {
    const both = ctxWith({ moonsKilled: ['blood', 'blue'] })
    const onlyOne = ctxWith({ moonsKilled: ['blood'] })
    const conditions: Condition[] = [
      { kind: 'includes', field: 'moonsKilled', values: ['blood'] },
      { kind: 'includes', field: 'moonsKilled', values: ['blue'] },
    ]
    expect(conditionsHold(conditions, both)).toBe(true)
    expect(conditionsHold(conditions, onlyOne)).toBe(false)
  })

  it('is empty-safe and works over questsComplete too', () => {
    expect(
      evaluateCondition({ kind: 'includes', field: 'moonsKilled', values: ['blood'] }, ctxWith({}))
    ).toBe(false)
    expect(
      evaluateCondition(
        { kind: 'includes', field: 'questsComplete', values: ["Legends' Quest"] },
        ctxWith({ questsComplete: ["Legends' Quest"] })
      )
    ).toBe(true)
  })

  it('rejects an unknown field and an empty values list', () => {
    expect(
      ConditionSchema.safeParse({ kind: 'includes', field: 'killCount', values: ['x'] }).success
    ).toBe(false)
    expect(
      ConditionSchema.safeParse({ kind: 'includes', field: 'moonsKilled', values: [] }).success
    ).toBe(false)
  })
})
