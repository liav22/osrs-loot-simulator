# Chest (Tombs of Amascut) — ToA

> ### ✅ BUILT — `data/overrides/chest-tombs-of-amascut.json`, 2026-08-15
>
> **This source is now implemented.** The doc below is kept as the research
> record; where it and the override disagree, **the override and
> `apps/ingest/test/toa.test.ts` are correct**. Read this banner first — the
> body's capability verdicts were stale twice over, and its *numbers* have a
> better source now too.
>
> **A second source exists that this doc never found: `Module:Tombs of Amascut
> loot`** (revid 15216862), the Lua behind the page's own
> `{{Calculator:Tombs of Amascut loot}}`. It states the arithmetic the prose
> gives only continuously, and it **closed the one gap this doc called
> UNKNOWN**:
>
> - **Gap 3 (weight interpolation between breakpoints) — RESOLVED, not
>   guessed.** The module's `p.reweight` gives the rule as `floor` expressions
>   over raid level, and the underlying weights are integers (shadow 10, each
>   masori 20, ward 30, fang/lightbearer 70, summing to 240). It reproduces all
>   five of the page's published rows exactly. Worth knowing *before* trusting
>   the 5-row table as a curve: it is **non-monotone** in the fang's rate
>   (400 → .2105, 450 → .2222), so interpolating between rows would have been
>   wrong, not merely unstated.
> - **Gaps 1, 4, 5 — RESOLVED** as the previous banner said (`ctx.points`/
>   `ctx.raidLevel`, `QtySpec.formula`, `Entry.ownershipGate`).
> - **Gap 2 (per-raid achievement conditions) — PARTLY WRONG.** The doc says
>   all 8 challenge rewards are unsimulable. Three are not: the page gates
>   Masori crafting kit (350+), Menaphite ornament kit (425+) and Cursed
>   phalanx (500+) on raid level and party-wide zero deaths *only* (`{{NA}}`
>   other requirements), all expressible. **The five remnants really are out of
>   scope** and are why this source stays watchlisted.
>
> **What the body's "what doesn't exist" section still gets wrong**, beyond the
> above: it does not notice that `levelAtLeast` could not read `points`,
> `raidLevel` or `deaths` (the fields existed; the condition's enum did not
> admit them — the `lunar-chest.md` lesson again), and its proposed `oneOf`
> mapping assumes weights can key on `ctx.raidLevel`, which the schema forbade.
> Both were fixed: the enum widened, and `weight` gained a formula variant —
> Extension A's missing fourth member, alongside `rolls`/`QtySpec`/
> `qtyMultiplier`.
>
> **Also corrected against the module:** the common-quantity multiplier is
> *stepped* (`floor((RL-300)/5)`), not the continuous ramp in the body's
> formula block, and there is a `raidLevel < 150` case (loot × 0.75) the page's
> prose never mentions at all.
>
> Not modelled, deliberately, and stated in the override's note: the five
> remnants, team size, the elite CA's 1.05× clue multiplier, and duplicate
> jewels once all four are owned.


`lootSourceId: chest-tombs-of-amascut`. Watchlisted (`point_scaled`). Blocks: Akkha, Ba-Ba,
Elidinis' Warden, Kephri, Tumeken's Warden, Zebak.

Sources:
- **Chest (Tombs of Amascut)** — https://oldschool.runescape.wiki/w/Chest_(Tombs_of_Amascut) —
  pageid `363893`, revid `15274037` (fetched fresh this session; byte-identical to the
  2026-08-11 local snapshot, `data/snapshots/wikitext/chest-tombs-of-amascut.json` — no drift).
- **Tombs of Amascut** (raid overview, points-earning context) —
  https://oldschool.runescape.wiki/w/Tombs_of_Amascut — pageid `326230`, revid `15285447`.

## The reward mechanic, in prose

Up to 8 players raid the Tombs. On defeating the Wardens, each player gets their own chest.
Whether it holds a unique or the common table is decided by a **per-player points roll**, not a
per-item rarity:

1. **Points.** Each player earns *room points* from damage dealt (some NPCs have a multiplier,
   e.g. Ba-Ba 2x, Het's Seal 2.5x, Warden's Core 0x), capped at 20,000/room, added to a running
   total capped at 64,000. A room MVP gets `+300 × TeamSize`. Dying costs 20% of total points
   (floor 1,000). Every player starts with 5,000 points, which are **subtracted at the end**
   before loot/purple-chance is calculated (confirmed by a cited Mod Ash tweet correcting the
   original news post, which omitted this).
2. **Dung gate.** If a player finishes with fewer than 1,500 points, they get `fossilised dung`
   (noted) and nothing else — no unique roll, no common rolls.
3. **Unique roll.** Otherwise: 1% chance per `10,500 − 20·RL` points, where `RL` is a *scaled*
   raid level (formula below). Capped at **55%**; points beyond the cap are wasted — unlike CoX,
   ToA only ever awards **one** unique per raid, never a second roll on excess.
4. **Item weighting.** If the roll hits, one of 7 uniques is drawn from a **raid-level-dependent
   weight table** — Osmumten's fang and Lightbearer's weights fall as raid level climbs from
   150→500, while the armour/robe pieces' weights climb. Table only gives 6 explicit breakpoints
   (150–300 flat, then 350/400/450/500); the interpolation rule for levels between breakpoints is
   not stated on this page.
5. **Out-of-invocation-range unique.** If the item rolled is locked behind an invocation the
   player didn't set (shown greyed out in the invocation menu), an additional 1/50 roll decides
   whether the restriction is ignored (success) or an untradeable tertiary substitutes (failure).
6. **Common rewards.** If no unique: 3 rolls on a fixed-weight common table (`rarity=1/27` each,
   `rolls=3`), with each item's **quantity** scaled by `Points / ItemDivisor`, further multiplied
   by `1.15 + 0.01·(RaidLevel−300)/5` once raid level ≥ 300 (flat multiplier of 1 below 300).
   `cache of runes` is exempt — always exactly 1.
7. **Tertiary** (independent of unique/common outcome): `thread of Elidinis` and 4 keris-partisan
   jewels, each on its own kill-count-scaled "bad luck mitigation" curve; an elite clue that
   scales 1/100 per 2,000 points up to 25/100; the pet (`Tumeken's guardian`), on the *same*
   points-percentile formula as uniques but with different constants.
8. **Challenge rewards**: 8 `Always`-rate items each gated on raid level plus a specific
   zero-death/all-invocations achievement per boss (e.g. `Remnant of akkha` needs "all Akkha
   invocations and level 4 Akkha" with zero deaths raid-wide).

## Formulas

### `toa_invocation` — unique-item roll (per player, per raid)

```
P(unique) = min(0.55, (10500 − 20·RL)⁻¹ · Points)     [1% per (10500 − 20·RL) points]

RL(RaidLevel) =
  RaidLevel                              if RaidLevel ≤ 310
  310 + (RaidLevel − 310)/3              if 310 < RaidLevel ≤ 430
  350 + (RaidLevel − 430)/6              if RaidLevel > 430
```
Variables: `Points` = player's total reward points *after* the 5,000-point starting subtraction;
`RaidLevel` = the raid's configured invocation level (0–500).
Source: Chest (Tombs of Amascut), `===Uniques===` section, revid `15274037`.

### Item weight table (raid-level-dependent, given at 6 breakpoints only)

| Raid level | Fang | Lightbearer | Ward | Mask | Body | Chaps | Shadow |
|---|---|---|---|---|---|---|---|
| 150–300 | 1/3.43 | 1/3.43 | 1/8 | 1/12 | 1/12 | 1/12 | 1/24 |
| 350 | 1/3.67 | 1/3.67 | 1/7.33 | 1/11 | 1/11 | 1/11 | 1/22 |
| 400 | 1/4.75 | 1/3.8 | 1/6.33 | 1/9.5 | 1/9.5 | 1/9.5 | 1/19 |
| 450 | 1/4.5 | 1/4.5 | 1/6 | 1/9 | 1/9 | 1/9 | 1/18 |
| 500 | 1/5.5 | 1/4.71 | 1/5.5 | 1/8.25 | 1/8.25 | 1/8.25 | 1/16.5 |

**UNKNOWN — needs manual research**: the interpolation rule between breakpoints (e.g. raid level
375 or 420) is not stated on this page. The wiki's own rewards calculator
(`{{Calculator:Tombs of Amascut loot}}`) presumably encodes it in Lua module code, which was not
fetched this session.

Source: same page, same section, revid `15274037`.

### Common-table quantity scaling

```
ItemQty = Points / ItemDivisor                                    if RaidLevel < 300
ItemQty = (Points / ItemDivisor) · (1.15 + 0.01·(RaidLevel−300)/5) if RaidLevel ≥ 300
```
`ItemDivisor` is a fixed per-item constant (27 values given in-page, e.g. Coins 1, Death rune 20,
Blood essence 6). `cache of runes` ignores the formula: quantity fixed at 1.
Source: `===Common rewards===`, revid `15274037`.

### Pet roll (`Tumeken's guardian`) — same shape as uniques, different constants

```
P(pet) = 1% per (350,000 − 700·RL) points   [no stated cap]

RL(RaidLevel) =
  RaidLevel                        if RaidLevel ≤ 400
  400 + (RaidLevel − 400)/3        if 400 < RaidLevel ≤ 550
  450                              if RaidLevel > 550
```
Source: `===Tertiary rewards===`, revid `15274037`.

### Tertiary bad-luck-mitigation curve (thread of Elidinis, 4 jewels)

```
rate(kc) = base_rate · min(3, 1 + 2·kc / (1.5·base_denominator))   [linear 1x→3x, caps at kc = 1.5·base_denom]
```
Thread of Elidinis: `base_rate = 1/10` (→ 3/10 at kc=15), reverts to a flat `1/50` once one has
ever been received. Jewels: `base_rate = 4/50` for "any jewel" (→ 12/50 at kc=75); an unowned
jewel is *guaranteed* on a successful "any jewel" roll while any of the 4 remain unowned (making
the effective single-jewel rate 1/37.5 → 1/12.5 depending how many are already owned), reverting
to flat rates once all 4 are owned. `kc` here is **raid completions**, not this loot source's
kill count in the ordinary per-boss sense — it is per-*raid*, shared across the whole Tombs of
Amascut activity, not per-encounter.
Source: `===Tertiary rewards===`, revid `15274037`; two cited Mod Ash tweets confirm the
post-first-receipt reversion and the 1.5× multiplier.

### Elite clue tertiary

```
P(clue) = min(0.25, Points / 200,000)     [1% per 2,000 points, capped 25%]
```
Source: same section, revid `15274037` (cites a Mod Ash tweet, archived 2026-01-10).

## Proposed mapping onto the loot model

```
tables: [
  { id: 'toa:dung-gate', mode: 'preroll', rolls: 1, entries: [
      { node: item(fossilised dung), rate: { kind:'formula', id:'toa_invocation', params:{ tier:'dung-gate' } } }
  ] },
  { id: 'toa:unique', mode: 'preroll', rolls: 1, entries: [
      { node: { kind:'oneOf', entries: [ 7 unique items, weight = table above, params keyed by ctx.raidLevel ] },
        rate: { kind:'formula', id:'toa_invocation', params:{ tier:'unique' } } }
  ] },
  { id: 'toa:common', mode: 'weighted', denominator: 27, entries: [ 27 items, rate: weight:1, qty: { kind:'formula'... } ] },
  { id: 'toa:tertiary', mode: 'independent', entries: [ thread, 4 jewels, elite clue, pet — each rate: formula ] },
  { id: 'toa:challenge', mode: 'independent', entries: [ 8 always-rate items, gated on conditions the model can't express — see gaps ] },
]
```

`toa:dung-gate` as a `preroll` table ahead of `toa:unique` is exactly right: a preroll hit
suppresses later `preroll`/`weighted` tables (PROJECT_PLAN.md 4.3, `compile.ts`'s
`suppressedByPreroll`), so a dung hit correctly blocks the unique roll, and a unique hit (also
`preroll`) correctly blocks `toa:common` — both "if X, no common rewards" sentences on the page
fall out of the *existing* suppression rule for free once both gates are formula-rate preroll
entries. Only one unique per raid (unlike CoX) means `preroll`'s "first hit stops" semantics are
exactly correct here, not an approximation.

## What the mapping needs that doesn't exist

1. **`SimContext` has no per-run "points earned" field.** `toa_invocation`'s formula fn receives
   `(params, ctx)` — `params` is static config baked into the boss doc at parse time, `ctx` is the
   only place a *per-run* number (this raid's points total, raid level) can come from. Today's
   `SimContext` (`{ members, ringOfWealth, onSlayerTask, questsComplete, killCount, variant }`)
   has no such field. `killCount` is the right *shape* (a static, UI-exposed per-run scalar) but
   the wrong *name and count* — ToA alone needs both `points` and `raidLevel`. This is the same
   gap every other points-scaled source in this batch hits (see the running tally at the end of
   this research pass) — one schema extension, not seven bespoke ones.
2. **Challenge rewards' conditions are per-raid achievements** ("all Akkha invocations and level
   4 Akkha, zero deaths raid-wide"), not expressible by any existing `Condition` kind or by the
   `raidLevel`/`points` fields proposed above — no schema change is even a good fit here, since
   these are structurally a raid-composition/skill fact, not a scalar. Recommend explicitly
   marking these 8 entries as **out of v1 scope** (unsimulable without a much larger per-room
   telemetry model) rather than inventing a special condition kind for them alone.
3. The item-weight interpolation between the 6 given raid-level breakpoints is UNKNOWN — needs
   manual research (the calculator module's Lua source, not fetched this session) before
   `toa:unique`'s `oneOf` weights can be computed for an arbitrary raid level rather than only the
   6 listed ones.
4. **`QtySpec` has no formula-driven kind.** `toa:common`'s per-item quantity is
   `Points / ItemDivisor × (mode-dependent multiplier)` — a value computed from `ctx` at
   evaluate time, not a static `exact`/`range`/`choice` spec (`QtySpecSchema`'s only three kinds,
   audited as exhaustive in `docs/DECISIONS.md`'s "Constant-returning validation checks" entry).
   This recurs at every points-scaled common-reward table reviewed so far (also CoX, possibly) and
   at every conditional-multiplier source (Abyssal Sire's ×2, Duke Sucellus's perfect-kill +50%,
   Zalcano's MVP +10% — see those docs), so it's being tracked as one family, not restated as a
   separate count per source. First flagged here because ToA's is the cleanest case: a genuine
   closed-form formula per item, not just a flat multiplier.

5. **The thread of Elidinis / jewel tertiary rewards reverting to a flat rate "once received"
   need per-item owned/received-before state**, a family named explicitly in
   `docs/bosses/duke-sucellus.md` (ice quartz/frozen tablet have the identical shape) — noted here
   in passing originally but not called out as its own gap; correcting that now for consistency
   across this batch.

Net for ToA: **one shared model feature** (SimContext points/raidLevel fields) plus a second,
also-shared one (formula-driven quantities) plus a third, also-shared one (owned/received-before
state) plus one item explicitly out of scope. Everything else — the dung/unique mutual exclusion,
the tertiary independence, the common-table structure — already fits the existing four-mode schema
once those features exist and the formula is implemented.
