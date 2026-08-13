# Abyssal Sire

`lootSourceId: abyssal-sire`. Watchlisted (`other`). No blocked sources.

Source: **Abyssal Sire** — https://oldschool.runescape.wiki/w/Abyssal_Sire — pageid `65167`, revid
`15283163`. Local snapshot (`data/snapshots/wikitext/abyssal-sire.json`, fetched
2026-08-11T19:23:28Z) postdates this revid, current, no re-fetch needed.

## Watchlist label sanity check

**Correct, and unusually simple to confirm** — the entire mechanic is one wikitext template call:

```
{{RareDropTable|3/139|naturetalisman=yes|override=There is a 3/139 chance of rolling the [[rare
drop table]]. This monster will always drop double the usual quantity from this table.|multiplier=2}}
```

This is the exact template shape `docs/DECISIONS.md`'s "Wired `tableRef` into the parser" entry
already documents `rdt-access.ts` reading — including confirming `multiplier=N` is real and
currently produces a watchlist hit rather than a silent wrong answer, per that entry: "scales the
QUANTITY the RDT yields, which a single shared, unscaled `data/tables/rare_drop_table.json`
record cannot express — watchlisted." Nothing found this session contradicts that.

## The reward mechanic, in prose

1. `Always`: abyssal ashes.
2. `Pre-roll`: `1/100` Unsired (untradeable).
3. Standard weighted table (weapons/armour, runes/ammo, herbs, seeds, materials, talismans, other)
   — ordinary, already-parseable structure, not part of this doc's concern.
4. **`3/139` chance to access the shared `rare_drop_table`, with every item quantity yielded by
   that access DOUBLED.** This is the entire watchlisted mechanic: a per-boss multiplier on a
   table normally shared, unscaled, across ~200 other loot sources.
5. Tertiary: standard clue-scroll-shaped rolls (not investigated further this session — no
   watchlist-relevant mechanic there).

## Formulas

**No formula needed.** The access rate (`3/139`) is a plain `fixed` rate, already expressible.
The only missing piece is a way to apply a `×2` multiplier to whatever the `rare_drop_table`
`tableRef` yields — a schema/node capability, not a probability calculation.

## Proposed mapping onto the loot model

```
tables: [
  ...,
  { id: 'sire:rdt-access', mode: 'independent', entries: [
      { node: { kind: 'tableRef', ref: 'rare_drop_table', multiplier: 2 }, rate: fixed(3/139) }
  ] },
]
```

## What the mapping needs that doesn't exist

1. **`TableRefNodeSchema` has no `multiplier` (or equivalent quantity-scaling) field.** This is
   the cleanest, most concrete instance yet of the quantity/yield-scaling family already tracked
   in `docs/bosses/chest-tombs-of-amascut.md` (gap 4) / `docs/bosses/monumental-chest.md` (gap 3) /
   `docs/bosses/zalcano.md` — the flavor here (flat, unconditional, table-level multiplier) is the
   *simplest possible* member of that family: no formula, no condition, just "whatever this
   `tableRef` node yields, double its quantity." If the eventual fix to this family is designed to
   handle Abyssal Sire's case, it should fall out as the trivial special case (constant multiplier,
   no condition) of whatever handles Duke Sucellus's perfect-kill +50% (conditional multiplier)
   and Zalcano's MVP +10% (conditional, self-referential multiplier) — worth designing against
   this source specifically since it's the simplest member to build and test first.

Net for Abyssal Sire: **the quantity-scaling family only** — no other gap. This source doesn't
need gap 1 (no per-run scalar at all, the multiplier is an unconditional constant) and doesn't
need the owned/received-before-state family either. The single cleanest test case for whatever
the eventual quantity-scaling fix looks like.
