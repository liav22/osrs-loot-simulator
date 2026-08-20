import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FORMULA_IDS, IMPLEMENTED_FORMULA_IDS, type FormulaId } from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'

/**
 * `docs/bosses/*.md`'s own "STALE, re-audited" banners exist specifically to
 * correct earlier-stale capability verdicts — and the formula-implementation
 * claims inside them have themselves gone stale, repeatedly, with nothing
 * comparing the prose to `IMPLEMENTED_FORMULA_IDS` until this test. Fourth
 * time this class of bug was found (see `docs/DECISIONS.md`'s
 * "docs/bosses/*.md's formula-status claims" entry for the fix and the
 * history). Two shapes, both guarded here:
 *
 * 1. A blanket claim that every `FORMULA_IDS` entry is unimplemented ("all
 *    still stubs") — copy-pasted into 12 of 14 files, and false the moment
 *    any ONE formula is ever implemented, which is permanently true now.
 * 2. A claim that one SPECIFIC formula id is still a stub/unimplemented
 *    (`ancient-chest.md`'s `cox_points`, `monumental-chest.md`'s
 *    `tob_points`, twice) when `IMPLEMENTED_FORMULA_IDS` says otherwise —
 *    literally true when written, false the session that formula shipped.
 *
 * Deliberately does NOT flag a formula id mentioned near "stub" when that
 * formula genuinely IS still a stub (`duke_sucellus_ice_quartz`,
 * `tzhaar_fight_cave_tokkul`, `zalcano_points` all still say so, correctly,
 * as of writing) — the check only fires on a claim that is actually false
 * against the codebase right now, not on every mention of the word "stub".
 */
const DOCS_BOSSES_DIR = join(REPO_ROOT, 'docs', 'bosses')

function docsBossesFiles(): string[] {
  return readdirSync(DOCS_BOSSES_DIR).filter((f) => f.endsWith('.md'))
}

/**
 * Strips markdown blockquote `>` continuation markers so a phrase wrapped
 * across several `> `-prefixed lines reads as one run of text. Load-bearing:
 * a plain `\s+` between two words in a claim like "all still\n> stubs" does
 * NOT match across the literal `>` that starts the next line, which would
 * have silently missed this exact bug on `monumental-chest.md` (confirmed by
 * testing this check against the pre-fix file from git history before
 * relying on it).
 */
function stripBlockquoteMarkers(text: string): string {
  return text.replace(/^>\s?/gm, '')
}

/** Escapes a literal for embedding in a `RegExp`. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether `text` claims `formulaId` is still a stub/unimplemented — the word
 * "stub" or "unimplemented" appearing within `WINDOW` characters either side
 * of the id, on the same claim. Covers every phrasing this project's own
 * docs have actually used ("X remains an unimplemented stub", "X is an
 * unimplemented stub", "X (still a stub implementation)", "X (registered,
 * still a stub)") without hand-listing each one — a formula id mentioned any
 * OTHER way (describing what it does, or that it's implemented) has no
 * "stub"/"unimplemented" nearby and is correctly not matched.
 */
const WINDOW = 80

function claimsUnimplemented(text: string, formulaId: FormulaId): boolean {
  const id = escapeRegExp(formulaId)
  const pattern = new RegExp(
    `${id}[\\s\\S]{0,${WINDOW}}?\\b(stub|unimplemented)\\b` +
      `|\\b(stub|unimplemented)\\b[\\s\\S]{0,${WINDOW}}?${id}`,
    'i'
  )
  return pattern.test(text)
}

describe('docs/bosses/*.md: formula-implementation claims checked against the codebase', () => {
  it('never claims every FORMULA_IDS entry is unimplemented, once any one is', () => {
    // Sanity: this guard is only meaningful while the premise holds. If it
    // ever fails, `IMPLEMENTED_FORMULA_IDS` went back to empty, which should
    // not happen — investigate rather than deleting this test.
    expect(IMPLEMENTED_FORMULA_IDS.size).toBeGreaterThan(0)

    const offenders = docsBossesFiles().filter((file) =>
      /\ball\s+still\s+stubs?\b/i.test(
        stripBlockquoteMarkers(readFileSync(join(DOCS_BOSSES_DIR, file), 'utf8'))
      )
    )
    expect(offenders).toEqual([])
  })

  it('never claims a specific implemented formula is still a stub/unimplemented', () => {
    const offenders: Array<{ file: string; formulaId: FormulaId }> = []

    for (const file of docsBossesFiles()) {
      const text = stripBlockquoteMarkers(readFileSync(join(DOCS_BOSSES_DIR, file), 'utf8'))
      for (const formulaId of FORMULA_IDS) {
        // Only an id `IMPLEMENTED_FORMULA_IDS` actually has can be stale this
        // way — a claim about a genuine stub (duke_sucellus_ice_quartz,
        // tzhaar_fight_cave_tokkul, zalcano_points) is still true.
        if (!IMPLEMENTED_FORMULA_IDS.has(formulaId)) continue
        if (claimsUnimplemented(text, formulaId)) offenders.push({ file, formulaId })
      }
    }
    expect(offenders).toEqual([])
  })
})
