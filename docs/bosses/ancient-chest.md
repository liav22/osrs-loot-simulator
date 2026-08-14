# Ancient chest — Chambers of Xeric (CoX)

> ### ⚠️ Capability verdicts below are STALE — re-audited 2026-08-13
>
> The **mechanics, prose and cited numbers in this doc are accurate** and are
> what to implement from. Its "What the mapping needs that doesn't exist"
> section is **not** — it was written before Extensions A and B, step (c)
> (`suppressesFollowing`, `drawsPerHit`) and `qtyRounding` existed, and has
> never been revised. Corrections for this source:
>
> - Gap 1 (`SimContext` points) — **RESOLVED**: `ctx.points`.
> - Gap 2 (a hit in an `independent` table suppressing later tables) —
>   **RESOLVED**: `Table.suppressesFollowing`, built generically as this doc
>   argued it should be.
> - Gap 3 (cross-table outcome visibility for elite clue / Olmlet) —
>   **RESOLVED AS UNNECESSARY, do not build.** Because `ctx.points` is static
>   per run, the conditioned marginals (`P(no unique) x 1/12`,
>   `P(unique) x 1/53`) are *exact* on every aggregate the simulator reports —
>   a plain formula `Rate`, no new condition kind. Using the raw subrates
>   instead overstates Olmlet by 33x; that is the failure mode to avoid.
>   Residual: elite clue and Olmlet can co-occur in the kill log (~4.6% chance
>   across a 1,000-kill log), which needs an FE note, not an engine feature.
> - Gap 4 (do common-table quantity ranges scale with points?) — still
>   **UNKNOWN**; a research question, never a model gap.
> - **Still blocking**: `cox_points` is an unimplemented stub, and the page's
>   `==Loot table==` heading is not matched by `DROPS_SECTION_TITLE`, which is
>   why this is `parse_failed`. Per-player allocation within a team stays out
>   of scope.
>
> Model capabilities now available: per-run `SimContext` scalars (`points`,
> `raidLevel`, `deaths`, `perfectKill`, `isMVP`, `delveLevel`, `wavesReached`,
> `moonsKilled`, `fishingLevel`, `hitpointsDamage`, `shieldDamage`,
> `ownedCounts`); `QtySpec.formula`; formula-driven `Table.rolls`;
> `Table`/`TableRefNode` `qtyMultiplier` + `qtyRounding`;
> `Condition.levelAtLeast`; `Entry.ownershipGate`; `Table.suppressesFollowing`;
> `TableRefNode.drawsPerHit`. Still absent: run-scoped (within-kill) dynamic
> state, deeper inline table nesting, `data/overrides/`, party/team context,
> and real implementations for every `FORMULA_IDS` entry (all still stubs).
> See `docs/DECISIONS.md`.


`lootSourceId`: not yet assigned (currently `parse_failed`, not on the mechanics watchlist — see
"Why this is `parse_failed`, not `needs_review`" below). Not gated by `not_on_watchlist` today
because it never reaches watchlist evaluation; it fails earlier, at section detection.

Sources:
- **Ancient chest** — https://oldschool.runescape.wiki/w/Ancient_chest — pageid `320054`, revid
  `15295333`. **Re-fetched fresh this session** — the local snapshot
  (`data/snapshots/wikitext/ancient-chest.json`, fetched 2026-08-11) was stale: a real balance
  patch, *Summer Sweep Up - Agility & Chambers of Xeric Changes*, landed 2026-08-12 (one day
  before this research session) and changed the unique-item weight table (see below). All numbers
  in this doc are from the fresh fetch, not the stale snapshot.
- **Chambers of Xeric** (points-earning context) —
  https://oldschool.runescape.wiki/w/Chambers_of_Xeric — pageid `82089`, revid `15293485`.

## The reward mechanic, in prose

Solo or up to 100 players raid the Chambers. On defeating the Great Olm, each player's own chest
is decided by a points roll:

1. **Points.** Earned from combat damage, storage-unit tiers, agility/strength shortcuts,
   Muttadile tree-cutting, Guardian pushes (uncapped formula "not currently known"), cooking food
   for teammates, potion-making, crab-room crystal changes, Ice Demon kindling, and a Thieving
   grub-filling minigame with its own documented cap formula
   (`MaxPoints = max(4500, ⌊totalThievingLevel/6⌋·150)`, `MaxGrubs = ⌈MaxPoints/115⌉`). Dying costs
   40% of the dying player's points (or 5% off the *team* total if the player had under 5% of the
   team total). Common-loot scaling caps at 131,071 points; the unique roll is **uncapped by
   points** (excess still rolls for further uniques, see below).
2. **Unique roll.** 1% chance per 8,676 total (team) points, capped at **65.7%** (570,000
   points). Points beyond the cap roll again for a **second** unique at the same 1%-per-8,676
   rate (so 855,000 points → 65.7% first roll, then 32.85% second roll on the 285,000-point
   remainder). **Up to 6 uniques can be awarded in one raid**, each an independent roll against
   its own points remainder. Getting a unique replaces that player's *entire* chest — no common
   rolls for them.
3. **Item weighting** (patched 2026-08-12, this fetch): Normal Mode denominator 60 (was 69),
   Challenge Mode denominator 56 (new — previously Normal/Challenge shared one table at
   denominator 69). Both prayer scrolls dropped from 20→14 (Normal) / →12 (Challenge); ancestral
   pieces rose 3→4 in both modes.
4. **Common table.** 2 rolls, **without replacement** — "the two rolls cannot end on the same
   drop" — across Runes/ammo, Herbs (33% chance of a seed substituting for the herb, ratio varies
   per herb), Ores/gems, and an Other group (torn prayer scroll, dark relic, etc.). An `ancient
   tablet` tertiary-style item ("replaces one of the loot rolls" if not already owned) sits inside
   the Other group at `1/10`, `gemw=No`.
5. **Tertiary**, always rolled regardless of unique/common outcome: `dark journal` (always, unless
   banked), elite clue `1/12` **only when no broadcasted unique was received this raid**, `Olmlet`
   pet `1/53` **only when a unique WAS received** (page notes this makes the effective rate
   "~1/1,765" at the average 26,025 points/raid — i.e. `1/53` of `P(unique)`, not unconditional),
   `twisted ancestral colour kit` `1/75`, `metamorphic dust` `1/400` (Challenge Mode only, within
   a time limit).

## Formulas

### `cox_points` — unique roll, per player, per raid, up to 6 rolls

```
rawChance(points) = points / 867,600          [1% per 8,676 points]
P(roll_n) = min(0.657, rawChance(remainingPoints_n))
remainingPoints_1 = TotalPoints
remainingPoints_{n+1} = remainingPoints_n − 570,000   (only reached if roll_n hit; 0 if negative)
n ranges 1..6
```
Source: Ancient chest, `===Unique drop table===`, revid `15295333`. The 65.7% figure itself cites
a 2019 Mod Ash tweet (previously 80% before a nerf).

**Per-player allocation within a team is unmodeled and out of scope**: "the player's points will
also determine who is more likely to obtain the unique drop if rolled on" — this is a
multi-player weighted lottery over the *team's* points distribution, not a single-player
probability. `SimContext` models one player's perspective; this needs a `PartySimContext`-shaped
extension PROJECT_PLAN.md never specifies, and no session should invent one without being asked.
Treat "total points" in the formula above as *this player's own* points when simulating solo, and
flag team play as unmodeled.

### Item weight table (post-2026-08-12 patch)

| Item | Normal (÷60) | Challenge (÷56) |
|---|---|---|
| Dexterous prayer scroll | 14 | 12 |
| Arcane prayer scroll | 14 | 12 |
| Twisted buckler | 4 | 4 |
| Dragon hunter crossbow | 4 | 4 |
| Dinh's bulwark | 3 | 3 |
| Ancestral hat | 4 | 4 |
| Ancestral robe top | 4 | 4 |
| Ancestral robe bottom | 4 | 4 |
| Dragon claws | 3 | 3 |
| Elder maul | 2 | 2 |
| Kodai insignia | 2 | 2 |
| Twisted bow | 2 | 2 |

Source: `===Unique drop table===`, `====Normal mode====`/`====Challenge mode====`, revid
`15295333`, citing the 12 August 2026 news post "Summer Sweep Up - Agility & Chambers of Xeric
Changes."

### Common-table quantity scaling

The page's common-table rows give flat quantity *ranges* (e.g. Death rune 1–3,640) rather than a
closed-form points formula the way ToA's does. **UNKNOWN — needs manual research**: whether these
ranges scale continuously with points (like ToA/ToB) or are genuinely flat per-roll ranges; the
page text doesn't state a scaling rule for this table the way it explicitly does for ToA and ToB.
Not guessed at.

## Why this is `parse_failed`, not `needs_review` on the mechanics watchlist

HANDOFF.md's landmine notes call this "zero `{{DropsLine}}`-shaped content on its page at all,"
which is true literally (the template used is `{{DropsLineReward}}`, confirmed present and
well-formed throughout this page) but slightly overstates the cause. The real reason
`findDropsSections` finds nothing: this page's heading is `==Loot table==`, and
`DROPS_SECTION_TITLE`'s regex requires the heading's own last significant word to be
"drops"/"rewards" — "Loot table" matches neither. `Loot table` never gets scanned for
`DropsLineReward` calls at all, regardless of the parser already recognizing that template name
(confirmed working for Barrows per `docs/DECISIONS.md`'s "DropsLineReward, not DropsLine" entry).
This is a heading-detection gap, not a missing-template gap — a fix (if one is warranted) is
adding "Loot table" as a recognized section-title synonym, not touching template recognition.

## Proposed mapping onto the loot model

```
tables: [
  { id: 'cox:tertiary-journal', mode: 'always', entries: [ dark journal ] },
  { id: 'cox:unique-rolls', mode: 'independent', entries: [
      { node: oneOf(12 items, weights per mode), rate: formula('cox_points', {rollIndex:1}) },
      { node: oneOf(...), rate: formula('cox_points', {rollIndex:2}) },
      ... up to rollIndex:6
  ] },
  { id: 'cox:common', mode: 'weighted', denominator: <sum>, rolls: 2, withoutReplacement: true, entries: [ ... ] },
  { id: 'cox:tertiary', mode: 'independent', entries: [
      { node: elite-clue, rate: fixed(1/12), conditions: [no-unique-this-raid] },
      { node: olmlet, rate: fixed(1/53), conditions: [unique-this-raid] },
      { node: twisted-kit, rate: fixed(1/75) },
      { node: metamorphic-dust, rate: fixed(1/400), conditions: [variant: challenge-mode, within-time] },
  ] },
]
```

`cox:common`'s `rolls: 2, withoutReplacement: true` is a **direct, already-supported use** of the
schema field PROJECT_PLAN.md's Phase 1 decision log added for exactly this shape (see
`docs/DECISIONS.md`, "Table.withoutReplacement?: boolean") — no new model feature needed for the
"cannot roll the same drop twice" behaviour.

## What the mapping needs that doesn't exist

1. **Same `SimContext` points/raidLevel gap as ToA** (see that doc) — `cox_points` needs a
   per-run `points` field to read from `ctx`.
2. **A hit anywhere in `cox:unique-rolls` (`independent` mode) needs to suppress `cox:common`
   later in the document, but only `preroll` hits suppress anything today**
   (`suppressedByPreroll` in `compile.ts`, PROJECT_PLAN.md 4.3's mode table). `preroll` itself
   doesn't fit here either: preroll's "first hit short-circuits" would stop after the *first*
   successful unique roll, discarding rolls 2–6 — CoX explicitly awards up to *six* independently.
   This is a **new hybrid**, distinct from both existing suppression rules: "every entry in this
   table rolls independently (so multiple can hit), but a hit *anywhere* in the table suppresses
   *later* tables in the document (the way a preroll hit does)." Neither `independent` nor
   `preroll` is this today.
3. **The `elite-clue`/`Olmlet` tertiary entries are conditioned on "a unique was/wasn't awarded
   this raid,"** a fact that only exists as an intermediate result of `cox:unique-rolls`
   evaluating, not as anything in `SimContext`. Every existing `Condition` kind reads static
   per-run context; none can reference *another table's outcome within the same kill*. This is a
   third, separate gap from #2 (that one is about suppression between tables; this one is about
   one table's roll result feeding into a sibling table's condition) — though a mechanism general
   enough to solve #2 (some kind of "table X's outcome is visible to table Y") might solve both at
   once; flagging both distinctly since they aren't proven to be the same fix yet.

4. **If the common-table quantity ranges do turn out to scale with points** (still UNKNOWN, see
   above), that would be the quantity/yield-scaling family tracked across
   `docs/bosses/chest-tombs-of-amascut.md` gap 4 and `docs/bosses/monumental-chest.md` gap 3 — not
   a new family, just another possible instance, contingent on research this session couldn't
   complete.

Net for CoX: the SimContext gap is shared with ToA (not a new count), but CoX adds **two further,
CoX-specific gaps** (#2 cross-table suppression-from-independent, #3 cross-table outcome
visibility) that ToA's simpler single-preroll shape never exercises, plus a possible (unconfirmed)
instance of the quantity-scaling family.
