# Overrides — hand-authoring a loot source

`data/overrides/<slug>.json` lets a human supply what the parser cannot derive
from the wiki. This document is the contract.

## When an override is the right tool

Use one when **the wiki never encoded the mechanic in `{{DropsLine}}` rows**,
so no parser improvement could reach it:

- **Chambers of Xeric (Ancient chest)** — the unique roll is prose under a
  `==Loot table==` heading; there is no row to parse.
- **Rewards Chest (Fortis Colosseum)** — structured by `Wave 1`..`Wave 12`
  headings, which fit none of the four canonical modes.
- **Doom of Mokhaiotl** — per-delve-level rates and quantity multipliers live
  in a `===Mechanics===` prose table, not in any drop row.

**Do not use one to paper over a parser bug.** If the parser *can* read a page
and gets it wrong, fix the parser and re-parse from `data/snapshots/`
(CLAUDE.md's hard rule) — pinning the wrong answer in place with an override
hides the defect from every other source sharing that code path.

## File format

```jsonc
{
  "slug": "corporeal-beast",        // required; must equal the file name
  "note": "Why this exists, citing the wiki section it came from.",  // required, >= 30 chars
  "tables": [ /* Table[] */ ],      // optional; REPLACES generated tables wholesale
  "name": "...",                    // optional metadata overrides
  "aliases": ["..."],
  "wikiPage": "...",
  "wikiRevId": 12345678,
  "variants": ["normal"],
  "contextDefaults": { "members": true }
}
```

Every field is validated by `BossOverrideSchema`
(`apps/ingest/src/parse/overrides.ts`). Unknown keys are rejected — the schema
is `.strict()`, so a typo fails loudly instead of being silently ignored.

`note` has a 30-character minimum on purpose. An override silently replacing
generated data is exactly what a future session must be able to audit without
re-deriving the reasoning, so "fix" is not an acceptable note.

## Merge semantics

| Case | `source` | Meaning |
|---|---|---|
| A generated document exists | `merged` | Override fields win; everything else is inherited |
| The parser could not reach the page | `override` | The override IS the document |

- **`tables` replaces wholesale, never per-table-id.** The sources needing an
  override need a different *shape*, not a patched row. A per-table merge
  would quietly leave a stale generated table behind whenever a hand-authored
  one renamed it — all-or-nothing is auditable, partial is not.
- When there is no generated document, the override must supply `name`,
  `wikiPage`, `wikiRevId` and `tables`; it fails loudly if any is missing,
  since there is nothing to inherit them from.
- An override carrying `tables` also **rescues the three `parse_failed`
  exits** (no wikitext snapshot, no `{{DropsLine}}` calls, assembly failed) —
  those paths consult the override before returning.

## Validation still applies — an override is not a rubber stamp

The **merged** document is what every check runs against, not the generated
one. A hand-authored table with weights that do not sum, an unresolvable
`tableRef`, or an unknown item fails exactly as a bad parse would.

Status outcomes:

| Deterministic checks | Override present | Status |
|---|---|---|
| pass | no | `verified` |
| pass | yes | `manual_override` |
| fail | either | `needs_review` |

`verified` and `manual_override` are kept distinct deliberately. `verified`
asserts the pipeline derived the document from the wiki unaided — a claim that
would be false for a hand-authored one. Both are terminal success states under
PROJECT_PLAN.md 16's Phase 5 done-when ("every boss `verified` or
`manual_override`, zero `needs_review`").

One asymmetry worth knowing: an override supplying `tables` also clears the
parser's **ambiguous-group** guesses, because those guesses describe a
structure the override just replaced. It does **not** clear anything else.

## The mechanics watchlist is a separate gate, on purpose

Writing an override does **not** remove a source from
`data/mechanics-watchlist.json`, and `not_on_watchlist` will keep it at
`needs_review` until you do. That is intended. The watchlist's own removal
policy is:

> remove an entry only when the mechanic is modelled **and the simulation has
> been checked against the wiki's own figures**

So the sequence for a watchlisted source is:

1. Author `data/overrides/<slug>.json`.
2. Re-parse and confirm every other check passes.
3. Write a test that checks the simulated/analytic output against the figures
   the wiki itself states — see
   `apps/ingest/test/rdt-access-mechanics.test.ts` for the pattern (it runs
   against the real generated documents and real `data/tables/` records, so it
   fails if a future re-parse stops emitting the modelled field).
4. Only then remove the watchlist entry.

Skipping step 3 is how a plausible-looking-but-wrong model ships.

## Worked example

Abyssal Sire and Corporeal Beast did **not** need overrides — their mechanics
were readable from the access template once `qtyMultiplier` and `drawsPerHit`
existed, so they were fixed in the parser instead. That is the preferred
outcome and the reason `data/overrides/` is empty at the time of writing.
Reach for an override only after establishing the parser genuinely cannot get
there.


## An override for a source the parser cannot reach at all

`data/overrides/<slug>.json` may supply a document **from scratch**, with no
generated parse underneath it. Reward pool is the worked example: its fish
sub-tables are `{{Reward pool/Rewards levels 35-39}}` template transclusions
rather than inline `{{DropsLine}}` calls, so `extractDropLines` finds nothing on
the page at all.

To do this the override must supply `name`, `wikiPage`, `wikiRevId` and
`tables` — there is no generated document to inherit them from, and
`applyOverride` refuses rather than guessing. The result is recorded as
`source: 'override'` rather than `'merged'`.

**The tier filter does not apply to a source with an authored override.**
`ingest parse --tier A,B,C` will still build it, and the run log says so. This
is deliberate and was a real bug before it was: Reward pool is tier D, every
documented parse invocation names tiers A–C, and a correct override for it would
otherwise have sat in `data/overrides/` doing nothing, silently, forever. An
override file *is* the decision to build a source; the tier filter only decides
what to attempt without one.

A slug in `data/overrides/` matching no loot source in `data/_inventory.json` is
reported as an orphan at the top of a parse run — otherwise a typo'd filename is
invisible, since overrides are looked up by slug and a slug nobody enumerates is
never opened.

Everything else is unchanged: the merged document is validated by the same
checks a generated one faces, and a source whose mechanic is still partly
unknown keeps its watchlist entry and stays `needs_review` no matter how clean
the override is.
