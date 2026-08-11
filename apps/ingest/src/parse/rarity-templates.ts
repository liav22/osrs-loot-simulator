import type { Condition } from '@osrs-loot-simulator/loot-model'
import { parseTemplateCall } from './wikitext-drops.js'

/**
 * A `rarity=` value is sometimes itself a template call — e.g.
 * `{{Brimstone rarity|784}}` — rather than a literal `N/M` fraction. This is
 * a registry (template name -> evaluator), not a per-boss special case: an
 * unregistered template name must be flagged for review, never silently
 * treated as unparseable-and-ignored or guessed at.
 */

export interface RarityTemplateEvaluation {
  /** Resolved fixed-rate fraction, `num/den`. */
  num: number
  den: number
  /** Extra conditions the drop's ELIGIBILITY depends on, ANDed with the entry's own. */
  conditions?: Condition[]
}

type RarityTemplateEvaluator = (params: ReadonlyMap<string, string>) => RarityTemplateEvaluation | null

/**
 * Brimstone key. Its denominator is a deterministic function of the killed
 * monster's combat level (the template's positional param 1) — not of any
 * SimContext state. Derived by fitting the wiki's own pre-resolved
 * `dropsline` bucket `Rarity` values across all 18 sources that currently
 * carry this template (see docs/DECISIONS.md for the worked fit):
 *
 *   base = max(50, 100 - floor(max(0, combatLevel - 100) / 5))
 *   bonus=yes (Grotesque Guardians) multiplies by 0.8: floor(55 * 0.8) = 44
 *
 * Matches all 18 known (combatLevel, resolved rarity) pairs exactly, with no
 * remainder — this is the game's real formula, not a guess. Every DropsLine
 * call carrying this template also carries a raritynotes footnote
 * restricting the drop to a Wilderness-Slayer task from Konar quo Maten, so
 * that gating is an `onSlayerTask` condition (PROJECT_PLAN.md 4.4), already
 * expressible without a formula — the RATE itself is a parse-time constant,
 * not a `Rate.formula`.
 */
function brimstoneRarity(params: ReadonlyMap<string, string>): RarityTemplateEvaluation | null {
  const level = Number(params.get('1'))
  if (!Number.isFinite(level)) return null
  const base = Math.max(50, 100 - Math.floor(Math.max(0, level - 100) / 5))
  const bonus = (params.get('bonus') ?? '').toLowerCase() === 'yes'
  const den = bonus ? Math.floor(base * 0.8) : base
  return {
    num: 1,
    den,
    conditions: [{ kind: 'onSlayerTask', value: true }],
  }
}

const RARITY_TEMPLATES = new Map<string, RarityTemplateEvaluator>([['brimstone rarity', brimstoneRarity]])

export interface RarityTemplateResolution {
  name: string
  /** `null` when the template name is not registered, or its params don't evaluate. */
  result: RarityTemplateEvaluation | null
}

/** Evaluates a `{{Template|params}}`-shaped rarity string against the registry. */
export function evaluateRarityTemplate(call: string): RarityTemplateResolution {
  const { name, params } = parseTemplateCall(call)
  const evaluator = RARITY_TEMPLATES.get(name.toLowerCase())
  return { name, result: evaluator === undefined ? null : evaluator(params) }
}
