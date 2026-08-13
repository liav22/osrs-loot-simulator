# Inferno

Not in `data/mechanics-watchlist.json` (no `lootSourceId` assigned — this source has never
resolved to a loot source at all; `docs/DECISIONS.md`'s discovery-pipeline entry recorded it as a
recovered `component` encounter with "no reward-table page found linked from it," correctly not
force-matched to anything). Covered here per this session's explicit brief to research the
wave-structured sources as a group, not because it's watchlisted.

Source: **Inferno** — https://oldschool.runescape.wiki/w/Inferno — pageid `79933`, revid
`15229265`. Local snapshot (`data/snapshots/wikitext/inferno.json`, fetched
2026-08-11T14:17:19Z) postdates this revid, current, no re-fetch needed.

## Sanity check against the earlier "population of one" research

`docs/DECISIONS.md`'s "Phase 6 research item" already checked this page and concluded correctly:
**"Inferno and TzHaar Fight Cave have zero `{{DropsLine}}` calls each... not a wave-scaled loot
table at all — closer to a single `Boss` doc with two `always`/`fixed` entries than to Fortis
Colosseum's per-wave chest."** Re-reading the `==Rewards==` section directly this session
confirms that conclusion is still accurate — nothing found here contradicts it, unlike Doom of
Mokhaiotl (see that doc, and `docs/bosses/rewards-chest-fortis-colosseum.md`). Inferno really is
the simple case that prior research described.

## The reward mechanic, in prose

1. **Infernal cape**: guaranteed on defeating TzKal-Zuk (the final boss) — a completion reward,
   not a per-kill drop roll at all.
2. **Tokkul**: "increasing amounts based on the wave they were defeated on (16,440 maximum; this
   is doubled if the player has completed the elite tier of the Karamja Diary)." **No formula or
   per-wave table is given on this page** — only the maximum value and the diary-completion
   doubling.
3. **Jal-nib-rek pet**: `1/100` on defeating TzKal-Zuk, `1/75` if on a Slayer task. A *separate*
   `1/100` chance obtainable later by exchanging an unwanted infernal cape with TzHaar-Ket-Keh (an
   out-of-encounter NPC transaction, not a kill outcome).

## Formulas

**UNKNOWN — needs manual research: the exact Tokkul-per-wave curve.** Only the maximum (16,440 at
full completion) is stated. Resist the temptation to guess an arithmetic-progression shape by
analogy with TzHaar Fight Cave's `N(N+1)` formula (see `docs/bosses/tzhaar-fight-cave.md`) — that
page states its formula explicitly and cites two tweets for it; this page states neither, and the
two encounters have a different wave count and structure (Fight Caves: 63 waves + Jad; Inferno:
69 waves + TzKal-Zuk with a phase mechanic), so the same constant almost certainly wouldn't carry
over even if the shape does. Recording as unknown rather than as a plausible extrapolation, per
this session's instructions.

## Proposed mapping onto the loot model

```
tables: [
  { id: 'inferno:completion', mode: 'always', entries: [ infernal-cape ] },
  { id: 'inferno:tokkul', mode: 'always', entries: [ { node: tokkul, qty: formula('inferno_tokkul', {}) } ] },
  { id: 'inferno:pet', mode: 'independent', entries: [
      { node: jal-nib-rek, rate: fixed(1/100), conditions: [onSlayerTask: false] },
      { node: jal-nib-rek, rate: fixed(1/75), conditions: [onSlayerTask: true] },
  ] },
]
```

This is **not wave-structured content** in the model sense — it's a single deterministic
completion reward plus a scalar-quantity item plus an ordinary `killCountAtLeast`-shaped pet
chance, confirming the prior research's framing. No wave/level machinery is needed here even
though "Inferno" sounds superficially similar to Fortis Colosseum/Doom of Mokhaiotl.

## What the mapping needs that doesn't exist

1. **The Tokkul quantity needs the formula-driven-`QtySpec` extension** already tracked as part
   of the quantity-scaling family (`docs/bosses/chest-tombs-of-amascut.md` gap 4) — but note the
   formula itself can't be written until the UNKNOWN curve is sourced; the schema gap and the
   missing-data problem are separate blockers here, not one.
2. **Gap 1** (per-run scalar: wave reached) — needed as the formula's input once it exists,
   same shape as everywhere else in this batch.
3. The cape-exchange pet reroll is a deferred NPC transaction outside the kill event — flagged as
   likely out of scope, same call as Fortis Colosseum's quiver exchange.

Net for Inferno: **gap 1 plus the quantity-scaling family** — no wave-machinery gap, and no new
family. The main blocker is missing wiki data (the Tokkul curve), not model expressiveness.
