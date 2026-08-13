# Doom of Mokhaiotl

`lootSourceId: doom-of-mokhaiotl`. Watchlisted (`other`) via the ambiguous-heading path, not
`not_on_watchlist` directly — see below. No blocked sources.

Source: **Doom of Mokhaiotl** — https://oldschool.runescape.wiki/w/Doom_of_Mokhaiotl — pageid
`561466`, revid `15276851`. Local snapshot (`data/snapshots/wikitext/doom-of-mokhaiotl.json`,
fetched 2026-08-11T13:22:50Z) postdates this revid, current, no re-fetch needed.

## Watchlist label sanity check — the framing is materially wrong, not just imprecise

`data/mechanics-watchlist.json`'s entry and `docs/DECISIONS.md`'s "Ambiguous-heading-guess"
entry both describe this as **"the same wave/level-scaling shape as Fortis Colosseum's wave
scaling, one level deeper"** — correctly spotting the resemblance — but then file it as a
plain `other`/ambiguous-preroll-guess case, and separately, `docs/DECISIONS.md`'s "Phase 6
research item" concluded **"Fortis Colosseum's wave structure is currently a population of
one... no shared abstraction is justified by this evidence."** Read side by side, those two
conclusions are in tension: the second was written without connecting it back to the first.
**Having now read this page's actual mechanics in full, Doom of Mokhaiotl is not "one level
deeper" than a wave-scaling problem — it IS one, structurally identical in kind to Fortis
Colosseum:**

- The player descends through delve levels one at a time, choosing when to stop (or dying).
- **"Each delve level rolls once on the regular loot table"** — loot happens *per level cleared*,
  not once at the end of a single atomic encounter, and is bankable up to wherever the player
  stopped — exactly Fortis Colosseum's "loot bankable across partial completion."
- Both quantities *and* unique rates are level-indexed, with a table of per-level multipliers,
  not a single formula in raid-level style (contrast ToA, where one raid level scalar drives
  everything).

**This means the "Fortis Colosseum is a population of one" conclusion should be revisited before
anyone decides wave-structured content isn't worth a shared abstraction** — this session found a
second real, wiki-confirmed example that the earlier research pass didn't check against (it
checked Inferno/Fight Cave/Barbarian Assault/Nightmare Zone, not Doom of Mokhaiotl, which hadn't
been read closely at the time that research was done). Not resolving the "population of one"
question here — that's a design call, not a research one — but flagging plainly that the premise
it rested on no longer holds unexamined.

## The reward mechanic, in prose

1. **Per-level roll on the common table**, with quantity `Qₙ = Q₃ + trunc(Q₃ · Mₙ)` where `Q₃` is
   the quantity that would be rolled at delve level 3 (the baseline) and `Mₙ` is a per-level
   multiplier (`-0.5` at level 1 up to `+0.2` at level 9+, table given in full). `trunc` rounds
   toward zero. Every level cleared triggers its own independent roll of the common table at that
   level's multiplier — not one roll at the end scaled by the deepest level reached.
2. **Guaranteed demon tears** at certain levels (0 at levels 1–2, 50 at level 3, climbing to 100
   at level 8+), cumulative and separate from the demon-tear *drop* — a deterministic per-level
   grant, not a probability.
3. **Uniques**, each gated by a minimum delve level and each with its own **per-level** rate that
   *increases* with depth (not converges to a single altrarity the way the watchlist detail's
   "converging to a shared 1/540" phrasing implies — that figure is the DropsLine template's
   `altrarity` field, a wiki-convention *smoothed effective rate*, not the actual per-level roll
   rate): Mokhaiotl cloth from level 2 (`1/2,500` at exactly level 2, falling to `1/540` per-roll
   by level 9), Eye of ayak from level 3, Avernic treads from level 4, and Dom (pet) from level 6.
   A full per-level table is given for all three unique items plus Dom, both "overall chance
   at this level" and "cumulative chance across a run that reaches this level."
4. Beyond delve level 8, "deep delve" levels continue indefinitely, mechanically treated as level
   8 for combat purposes but the loot table (per the per-level table's `> 8` row) keeps using the
   `>8` row's flat rates — i.e. the level-indexing caps at 9 rows even though descent doesn't cap.

## Formulas

No existing formula id fits (nothing in the registry is delve/wave-indexed). If implemented, this
would need its own id, not a reuse of any points-scaled formula — the input is a **discrete level
index (1–9+)**, not a continuous points scalar, and the table below is a literal lookup, not a
closed-form curve (unlike, say, ToA's raid-level piecewise-linear scaling).

### Quantity multiplier and unique rate table (full, all rows given on the page)

| Delve level | Qty multiplier | Guaranteed tears | Cloth | Eye of ayak | Avernic treads | Dom |
|---|---|---|---|---|---|---|
| 1 | −0.5 | 0 | — | — | — | — |
| 2 | −0.35 | 0 | 1/2,500 | — | — | — |
| 3 | 0 | 50 | 1/2,000 | 1/2,000 | — | — |
| 4 | 0.05 | 60 | 1/1,350 | 1/1,350 | 1/1,350 | — |
| 5 | 0.1 | 70 | 1/810 | 1/810 | 1/810 | — |
| 6 | 0.12 | 80 | 1/765 | 1/765 | 1/765 | 1/1,000 |
| 7 | 0.14 | 90 | 1/720 | 1/720 | 1/720 | 1/750 |
| 8 | 0.17 | 100 | 1/630 | 1/630 | 1/630 | 1/500 |
| >8 | 0.2 | 100 | 1/540 | 1/540 | 1/540 | 1/250 |

Source: `===Mechanics===`/`===Uniques===`, revid `15276851`. No external citation given for these
numbers beyond the page's own tables — treated as directly wiki-sourced, not third-party-cited,
which is normal for numbers Jagex has made programmatically visible in-client.

## Proposed mapping onto the loot model

**Cannot be meaningfully proposed without wave/level machinery existing first** — same blocker as
Fortis Colosseum. A sketch of the shape, not a real proposal:

```
levels: [
  { level: 1, tables: [ { common table, qty multiplier: -0.5 } ] },
  { level: 2, tables: [ { common, -0.35 }, { unique: cloth, rate: fixed(1/2500) } ] },
  ...
  { level: 9+, tables: [ { common, 0.2 }, { cloth, eye, treads: fixed(1/540) }, { dom: fixed(1/250) } ] },
]
```
Whatever machinery ends up handling Fortis Colosseum's `Wave 1`–`Wave 12` structure should be
designed against *both* sources, not just one — this doc is the evidence that doing so is now
possible.

## What the mapping needs that doesn't exist

1. **Wave/level-indexed table structure with per-level bankable loot** — the same gap Fortis
   Colosseum needs (see `docs/bosses/rewards-chest-fortis-colosseum.md`), not a new one. This
   doc's contribution is evidence that this gap has **two** real sources now, not one — directly
   relevant to the open "population of one" question `docs/DECISIONS.md` raised.
2. **Gap 1** (per-run scalar) still applies underneath the level machinery — "how many levels did
   the player clear this run" is exactly the same *shape* of per-run context value as ToA's raid
   level or Fortis Colosseum's waves-completed, just discrete and small-ranged (1–9+, unbounded
   above 8).

Net for Doom of Mokhaiotl: **the wave/level-structure gap (now confirmed recurring, not a
one-off) plus gap 1** — no new family beyond what Fortis Colosseum already requires, but this
source is the reason the "recurring vs. one-off" answer for wave-structured content changes.
