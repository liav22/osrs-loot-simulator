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
    case 'includes': {
      // ANY, not ALL — see `ConditionSchema`'s comment: the conditions array
      // already gives conjunction, so disjunction is what this buys.
      const held: readonly string[] = ctx[condition.field]
      return condition.values.some((value) => held.includes(value))
    }
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
 * Recomputes every derived `SimContext` field from its inputs.
 *
 * There is one today: `totalDamage = hitpointsDamage + shieldDamage`, Zalcano's
 * combined unique/pet eligibility gate. It is *derived* rather than supplied so
 * that a two-field threshold needs no new condition shape — `levelAtLeast`
 * reads it as an ordinary field, and conditions stay resolved-once against a
 * fixed context (see `SimContextSchema`'s comment on the field).
 *
 * Whatever a caller passes for a derived field is overwritten, never merged.
 * That is the point: the field cannot drift from its inputs, and a hand-built
 * context that simply omits it is still correct. The function is idempotent, so
 * applying it at more than one layer costs nothing but consistency.
 *
 * Called from `compileBoss`, which both `simulate` and `expectedValue` funnel
 * through — so a context built by hand and passed straight to either one gets
 * the same treatment as one built by `resolveSimContext`.
 */
export function withDerivedContext(ctx: SimContext): SimContext {
  const totalDamage = ctx.hitpointsDamage + ctx.shieldDamage
  if (ctx.totalDamage === totalDamage) return ctx
  return { ...ctx, totalDamage }
}

/**
 * Layer the caller's overrides over the boss's `contextDefaults`, over the
 * package defaults, then resolve derived fields. The result is fixed for the
 * whole simulation run, which is what lets tables be compiled once up front.
 */
export function resolveSimContext(boss: Boss, overrides: PartialSimContext = {}): SimContext {
  return withDerivedContext({
    ...DEFAULT_SIM_CONTEXT,
    ...boss.contextDefaults,
    ...overrides,
  })
}
