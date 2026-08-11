import { describe, expect, it } from 'vitest'
import {
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
    [{ kind: 'killCountAtLeast', n: 50 }, { killCount: 50 }, true],
    [{ kind: 'killCountAtLeast', n: 50 }, { killCount: 49 }, false],
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
            node: { kind: 'item', itemId: 1, name: 'Thing', qty: { kind: 'exact', n: 1 } },
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
