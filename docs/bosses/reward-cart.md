# Reward Cart — Wintertodt

`lootSourceId: reward-cart`. Watchlisted (`point_scaled`).

## ⚠️ Watchlist label is misattributed to the wrong activity

`data/mechanics-watchlist.json`'s `reward-cart` entry currently reads `"blockedBy": ["Tempoross"]`
and `"detail": "...Needs the tempoross_points formula."` **This is wrong, the same swap as
`reward-pool`'s, in the opposite direction.** The wiki page titled "Reward Cart"
(https://oldschool.runescape.wiki/w/Reward_Cart, pageid `541484`) is unambiguously **Wintertodt's**
reward mechanism — its unique items are the phoenix pet, dragon axe, tome of fire, warm gloves,
bruma torch, and Pyromancer outfit, all Wintertodt-specific. `data/_inventory.json` already has
this right (`{ "title": "Wintertodt", ..., "lootSourceId": "reward-cart" }`); only the
hand-authored watchlist JSON swapped the two. **Fix both entries in
`data/mechanics-watchlist.json` together** — see `docs/bosses/reward-pool.md` for the Tempoross
side of the same correction.

Source: **Reward Cart** — https://oldschool.runescape.wiki/w/Reward_Cart — pageid `541484`, revid
`15293480`. No local wikitext snapshot existed for this page before this session (only a
`dropsline` snapshot did); fetched fresh — worth noting the fetch timestamp (2026-08-13, this
session) is only one day after this page's own last edit (2026-08-12T11:22Z), so there was no
stale-snapshot risk here specifically, but it's a second confirmation (after CoX) that this
corner of the wiki has been actively edited in the last 48 hours. Also: **Wintertodt** (points
context) — https://oldschool.runescape.wiki/w/Wintertodt — pageid `69573`, revid `15276053` —
local snapshot (`data/snapshots/wikitext/wintertodt.json`, fetched 2026-08-11T10:19:48Z) postdates
this revid, current.

## The reward mechanic, in prose

1. **Points**, earned fighting the Wintertodt: lighting a brazier (25), adding Bruma
   roots/kindling (10/25), repairing a destroyed brazier (25), healing a pyromancer (75). No
   stated upper cap. Logging out or leaving early **forfeits all points for the round** — an
   all-or-nothing condition, not a partial-credit one.
2. **Minimum threshold.** Below 500 points: no reward at all (an explicit in-game chat message
   confirms this, cited).
3. **Roll count.** `500 pts → 2 rolls`; **+1 guaranteed roll per full additional 500 points**;
   within the current 500-point band, **+1% chance of one *extra* roll per 5 points** past the
   last threshold (`505 pts → 2 rolls + 1%`, `750 → 2 rolls + 50%`, `1000 → 3 rolls` exactly).
4. **Each roll is an independent 7-tier ordered chain, not a flat weighted pick**: phoenix pet
   1/5,000 → dragon axe 1/10,000 → tome of fire 1/1,000 → warm gloves 1/150 → bruma torch 1/150 →
   Pyromancer outfit 1/150 → burnt page 1/45. First hit in the chain wins *that roll*; if none of
   the 7 hit, the roll falls through to the ordinary material drop table (logs/ores/herbs/seeds/
   fish/gems, quality gated by the relevant skill level, decided **at search time**, not at
   points-earning time — same deliberate design as Tempoross's Reward pool). **Multiple
   Pyromancer pieces can be obtained across rolls/searches** (least-owned piece given, ties broken
   Garb→Hood→Robe→Boots) — confirms rolls are independent per-search events, not deduplicated
   across a single search or across searches.
5. **Duplicate substitution**: a 4th+ warm gloves or bruma torch converts to a magic seed /
   torstol seeds respectively (cited Mod Ash tweet) — a per-item cap-then-substitute rule, not
   modeled by any existing node kind.

## Formulas

### `wintertodt_points` — roll count per search

```
rolls(points) = 0                                  if points < 500
baseRolls(points) = 2 + floor((points − 500) / 500)   if points ≥ 500
remainder(points) = (points − 500) mod 500
P(extra roll) = remainder / 500      [equivalently 1% per 5 points into the band]
rolls(points) = baseRolls(points), plus one more with probability P(extra roll)
```
Source: Reward Cart, `==Drop mechanic==`, revid `15293480` — worked examples on the page (505→1%,
750→50%, 1000→3 exact) all check out against this formula exactly, so it's a direct read, not a
reconstruction from a vaguer statement.

### Per-roll ordered unique chain — fixed rates, no formula needed

| Order | Item | Rate |
|---|---|---|
| 1 | Phoenix (pet) | 1/5,000 |
| 2 | Dragon axe | 1/10,000 |
| 3 | Tome of fire | 1/1,000 |
| 4 | Warm gloves | 1/150 (→ magic seed if 3 already owned) |
| 5 | Bruma torch | 1/150 (→ torstol seeds if 3 already owned) |
| 6 | Pyromancer outfit (least-owned piece) | 1/150 |
| 7 | Burnt page | 1/45 |
| — | *(fallthrough)* material table | remainder |

Source: `===Reward rolls===`, revid `15293480`, citing a Mod Kieren/Mod Ronan YouTube VOD for the
original rarities.

## Proposed mapping onto the loot model

```
tables: [
  { id: 'reward-cart:search', mode: 'preroll', rolls: <rolls(ctx.points)>, entries: [
      { node: phoenix, rate: fixed(1/5000) },
      { node: dragon-axe, rate: fixed(1/10000) },
      { node: tome-of-fire, rate: fixed(1/1000) },
      { node: warm-gloves-or-magic-seed, rate: fixed(1/150) },   // conditional substitution — see gaps
      { node: bruma-torch-or-torstol-seeds, rate: fixed(1/150) }, // conditional substitution — see gaps
      { node: pyromancer-piece(least-owned), rate: fixed(1/150) },
      { node: burnt-page, rate: fixed(1/45) },
  ] },
  { id: 'reward-cart:material', mode: 'weighted', denominator: <sum>, entries: [ logs/ores/herbs/seeds/fish/gems, skill-gated ] },
]
```

The 7-tier ordered chain is a **textbook fit for `preroll` mode as it already exists** — "checked
in order, first hit short-circuits, falls through to the next table" is exactly this mechanic,
and (per `docs/DECISIONS.md`'s Phase 1 entry) a preroll hit already suppresses a later `weighted`
table, which is exactly "fall through to material table only if none of the 7 hit." **No model
change is needed for the chain shape itself** — same conclusion as Duke Sucellus's roll-until-
success chain (see that doc). The only real gap is running this chain `rolls(points)` times per
Wintertodt kill.

## What the mapping needs that doesn't exist

1. **Gap 1** (`SimContext` needs a per-run `points` field) — shared with every other points-scaled
   source in this batch.
2. **Beyond gap 1: `preroll` tables are schema-pinned to `rolls: 1`**
   (`docs/DECISIONS.md`, Phase 1: "preroll tables must have `rolls: 1`... has no defined meaning
   when repeated"). This is now the **third** source (after Lunar Chest, Reward pool) needing
   `rolls` to read an arbitrary context-derived integer rather than a static number or Bernoulli
   rate — but this one additionally needs that integer applied to a `preroll`-mode table
   specifically, which the schema currently forbids outright, not merely lacks a mechanism for.
   Worth being precise about why the original Phase 1 reasoning doesn't actually block this: that
   decision worried about what a *repeated* preroll's hit means for suppressing *sibling
   document-level tables* — but here, each of the `rolls(points)` searches is fully self-contained
   (chain-hit vs. material-table fallback happens *within* one search, doesn't touch anything
   outside `reward-cart:search`+`reward-cart:material`), so the original concern doesn't actually
   apply to this shape. Loosening the `rolls===1` pin for this specific case looks safe on
   inspection, but that's a design call for whoever implements it, not something to decide here.
3. **Duplicate-item substitution (warm gloves/bruma torch → seed after 3 owned) is an instance of
   the "owned/received-before state" family**, named explicitly in `docs/bosses/duke-sucellus.md`
   (this doc originally described it as a standalone one-off; correcting that framing now for
   consistency — it's the same fact-shape as ice quartz's ownership check, just counting to 3
   instead of 1, and gating a node substitution instead of a rate).

Net for Reward Cart: **gap 1, the same rolls-reads-integer-context extension (now a 3-source
pattern), plus the owned/received-before-state family (counting variant).**
