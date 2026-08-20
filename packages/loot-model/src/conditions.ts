import type { Boss, Condition, Entry, PartialSimContext, SimContext } from './schema.js'
import { DEFAULT_SIM_CONTEXT } from './schema.js'

/** Evaluate a single condition against the context supplied by the caller. */
export function evaluateCondition(condition: Condition, ctx: SimContext): boolean {
  switch (condition.kind) {
    case 'members':
      return ctx.members === condition.value
    case 'ringOfWealth':
      return ctx.ringOfWealth === condition.value
    case 'onKonarTask':
      return ctx.onKonarTask === condition.value
    case 'awakened':
      return ctx.awakened === condition.value
    case 'questComplete':
      return ctx.questsComplete.includes(condition.quest)
    case 'variant':
      return ctx.variant === condition.name
    case 'levelAtLeast': {
      // Two-sided when `atMost` is present (Reward pool's seven Fishing
      // brackets), the original one-sided threshold when it isn't. `atMost` is
      // inclusive — see `ConditionSchema`.
      const value = ctx[condition.field]
      if (value < condition.n) return false
      return condition.atMost === undefined || value <= condition.atMost
    }
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

/** Theatre of Blood's per-room point value and MVP pool — see `tobPoints`. */
const TOB_POINTS_PER_ROOM = 3
const TOB_ROOM_COUNT = 6
const TOB_MVP_POOL_POINTS = 14
const TOB_DEATH_PENALTY_POINTS = 4

/**
 * `tobPoints`, from `roomsSkipped` and `deaths`. `roomsSkipped` is clamped to
 * `[0, TOB_ROOM_COUNT]` here defensively — the schema already enforces the
 * upper bound, but a hand-built context (this function's whole reason to
 * exist) does not go through `SimContextSchema.parse`, and a raid genuinely
 * cannot skip more than its own 6 rooms.
 *
 * Solo-player only: a solo player always receives the whole 14-point MVP pool
 * (nobody else exists to share it with), which is what makes `roomPoints +
 * TOB_MVP_POOL_POINTS - deathPenalty` the player's own score rather than a
 * team's. See `Module:Theatre of Blood calculator`'s `playerpoints` for a
 * solo run (`teammates = 1`), cited in `docs/bosses/monumental-chest.md`.
 */
function tobPointsFor(ctx: Pick<SimContext, 'roomsSkipped' | 'deaths'>): number {
  const roomsSkipped = Math.min(Math.max(ctx.roomsSkipped, 0), TOB_ROOM_COUNT)
  const roomPoints = (TOB_ROOM_COUNT - roomsSkipped) * TOB_POINTS_PER_ROOM
  const deathPenalty = ctx.deaths * TOB_DEATH_PENALTY_POINTS
  return Math.max(0, roomPoints + TOB_MVP_POOL_POINTS - deathPenalty)
}

/**
 * Recomputes every derived `SimContext` field from its inputs.
 *
 * Two today:
 *
 * - `totalDamage = hitpointsDamage + shieldDamage`, Zalcano's combined
 *   unique/pet eligibility gate.
 * - `tobPoints`, Theatre of Blood's points total (see `tobPointsFor`).
 *
 * Both are *derived* rather than supplied so that a multi-field rule needs no
 * new condition shape — `levelAtLeast` reads the result as an ordinary field,
 * and conditions stay resolved-once against a fixed context (see
 * `SimContextSchema`'s comment on the field).
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
  const tobPoints = tobPointsFor(ctx)
  if (ctx.totalDamage === totalDamage && ctx.tobPoints === tobPoints) return ctx
  return { ...ctx, totalDamage, tobPoints }
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
