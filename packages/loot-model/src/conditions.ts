import type { Boss, Condition, Entry, PartialSimContext, SimContext } from './schema.js'
import { DEFAULT_SIM_CONTEXT } from './schema.js'

/** Evaluate a single condition against the context supplied by the caller. */
export function evaluateCondition(condition: Condition, ctx: SimContext): boolean {
  switch (condition.kind) {
    case 'members':
      return ctx.members === condition.value
    case 'ringOfWealth':
      return ctx.ringOfWealth === condition.value
    case 'onSlayerTask':
      return ctx.onSlayerTask === condition.value
    case 'questComplete':
      return ctx.questsComplete.includes(condition.quest)
    case 'killCountAtLeast':
      return ctx.killCount >= condition.n
    case 'variant':
      return ctx.variant === condition.name
    case 'levelAtLeast':
      return ctx[condition.field] >= condition.n
  }
}

/** ALL conditions must hold (AND). An absent list always holds. */
export function conditionsHold(
  conditions: readonly Condition[] | undefined,
  ctx: SimContext
): boolean {
  if (conditions === undefined) return true
  for (const condition of conditions) {
    if (!evaluateCondition(condition, ctx)) return false
  }
  return true
}

/** Whether an entry participates in this run at all. */
export function entryApplies(entry: Pick<Entry, 'conditions'>, ctx: SimContext): boolean {
  return conditionsHold(entry.conditions, ctx)
}

/**
 * Layer the caller's overrides over the boss's `contextDefaults`, over the
 * package defaults. The result is fixed for the whole simulation run, which is
 * what lets tables be compiled once up front.
 */
export function resolveSimContext(boss: Boss, overrides: PartialSimContext = {}): SimContext {
  return {
    ...DEFAULT_SIM_CONTEXT,
    ...boss.contextDefaults,
    ...overrides,
  }
}
