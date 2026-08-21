# Rewards Chest (Fortis Colosseum)

> ### 🛠 CORRECTED — 2026-08-21, see `docs/DECISIONS.md`'s "Fortis Colosseum
> ### accumulation fix" entry
>
> **The Phase 7 build below shipped the wrong selection semantics — fixed.**
> It claimed "each wave is its own complete, self-contained weighted table,
> not additive layers" and gated every wave's entries with an *exact-match*
> `levelAtLeast(n=atMost=W)`, so `ctx.wavesReached: 12` fired ONLY wave 12's
> table. That contradicts this very doc's own quoted wiki prose two sections
> down ("walk away with the rewards they've accumulated so far") and the
> structurally identical Doom of Mokhaiotl, which already shipped the
> correct cumulative pattern for this shape. Fixed to plain
> `levelAtLeast('wavesReached', n)` with no `atMost`, so wave W's table fires
> whenever `wavesReached >= W` — every wave up to the one reached
> contributes, not just the last. Corroborated two ways: summed unique
> chance across waves 4–12 now lands at ≈22% (matching community reports for
> a full clear, vs ≈8.3% under the old exact-match reading), and cumulative
> expected sunfire splinters for a full clear computes to ≈2014.6, matching
> this page's own cited average almost exactly. No engine/schema change was
> needed, same as Doom of Mokhaiotl's already-correct build.
>
> ### ✅ BUILT — `data/overrides/rewards-chest-fortis-colosseum.json`, 2026-08-16
>
> **This source is now implemented.** All 12 waves are modelled as their own
> complete, self-contained weighted table (matching how the page itself
> publishes them — not additive layers on lower waves), gated exactly on
> `ctx.wavesReached` via `levelAtLeast(n=atMost=W)`. No new formula or schema
> capability was needed — every gap this doc's earlier passes named was
> already resolved. `apps/ingest/test/rewards-chest-fortis-colosseum.test.ts`
> checks the merged document against the page's own published per-wave
> "effective rates" table.
>
> **The wave-scoped armour-piece duplicate-avoidance is shipped as the
> flagged with-replacement approximation — quantified, not assumed small.**
> The per-piece EXPECTED DROP RATE (the simulator's headline number) is
> IDENTICAL to the true mechanic, by symmetry. The cost is entirely in joint/
> same-run statistics: P(a duplicate armour piece in one clear) is ~0.20%
> under this approximation vs ~0.00025% under true dedup (~800x relative,
> both absolute-tiny), and P(a complete 3-piece set in one clear) is
> understated ~4.4x. See the override's own `note` for the full computation.
>
> **The duplicate-protection's SCOPE (per-run vs lifetime/account-wide)
> remains unconfirmed after two separate passes.** First pass: the Sunfire
> fanatic armour page, two web searches, an attempted fetch of the original
> Jagex announcement (blocked, HTTP 403). Second pass, specifically checking
> update/news posts and individual item pages as requested: the OSRS Wiki's
> own mirror of that same announcement (fetched successfully — discusses
> stats and design philosophy only), two further Jagex devblog mirrors from
> the same release cycle, the individual Sunfire fanatic helm page, the
> Rewards Chest/Fortis Colosseum pages' full patch-history, and
> Fortis Colosseum/Strategies. None mention "duplicat"/"reset"/"attempt"/
> "account" in this context at all. One mildly suggestive (not dispositive)
> data point: the SAME patch-history changelog explicitly distinguishes
> per-wave from per-run scope for OTHER Colosseum mechanics when it matters
> ("Doom stacks are now removed at the end of a wave, rather than being
> permanent for a run") — the total absence of equivalent language for the
> armour protection is weak evidence against it being run-scoped, not proof.
> Per explicit instruction, the investigation stopped here and the
> approximation shipped as-is. If it turns out to be lifetime-scoped, an
> EXACT model via `ownershipGate` (identical to ToA's jewel pool) is directly
> available and should replace this approximation entirely, not just refine
> it. **Resolve this from an authoritative in-game/community source before
> trusting the armour-piece numbers for anything precision-sensitive.**
>
> Token (Varlamore) (wave 3 only, `rarity=Varies`) is excluded — no fixed
> rate is stated anywhere, and `drops_covered` correctly still fails on
> exactly that one row. `not_on_watchlist` is left failing deliberately, the
> same judgement call as ToB's and CoX's own entries.
>
> ### ⚠️ Capability verdicts below are STALE — re-audited 2026-08-16
>
> The **mechanics, prose and cited numbers in this doc are accurate** and are
> what to implement from. Its older "What the mapping needs that doesn't
> exist" section is **not** — it was written before Extensions A and B, step
> (c) (`suppressesFollowing`, `drawsPerHit`) and `qtyRounding` existed. This is
> the *second* pass at this correction: the 2026-08-13 banner resolved the
> capability gaps but the "Proposed mapping" section below it was never
> updated to match and still said "cannot be meaningfully proposed" — fixed
> this session, see that section for the real mapping. Corrections:
>
> - Gap 1 (wave/level-indexed structure with per-level bankable loot) —
>   **RESOLVED, no wave engine required**: `levelAtLeast('wavesReached', n)`-
>   gated tables in the existing `tables` array, one per wave. The same
>   correction applies to `docs/bosses/doom-of-mokhaiotl.md`; see its banner.
> - Gap 2 (per-run scalar: which wave the run ended at) — **RESOLVED**:
>   `ctx.wavesReached`.
> - Gap 4 (quiver -> splinters/pet exchange) — out of scope, an NPC
>   transaction, not a kill event.
> - Gap 3 (wave-scoped armour-piece dedup) — **STILL OPEN, and deliberately
>   so.** This is *run-scoped* state (it resets each attempt), materially
>   different from `ownershipGate`'s lifetime-scoped counts, and it is the only
>   remaining source needing within-kill dynamic state. Ship the flagged
>   with-replacement approximation; do not build general within-kill state for
>   one sub-mechanic of one source.
> - **This page still cannot be assembled by the generated parser at all**
>   (its `Wave 1`..`Wave 12` headings fit no canonical `TableMode`, and it is
>   tier D with no override), so it needs `data/overrides/` — which now
>   **does** exist and is in live use (ToA, Doom of Mokhaiotl, Lunar Chest,
>   Zalcano, Reward pool) — before any of the above matters. No document
>   exists yet at `data/bosses/rewards-chest-fortis-colosseum.json`; confirmed
>   absent this session, not assumed.
> - **Checked this session, directly, and confirmed: no `Module:`/
>   `Calculator:` page exists for this source.** Neither the Rewards Chest
>   page, the Fortis Colosseum overview page, nor the Sol Heredit page
>   transcludes or links a calculator (grepped all three snapshots for
>   `calc`/`Calculator`/`#invoke`: zero matches), and the wiki's own
>   `Category:Calculators` listing has no Fortis Colosseum/Sol Heredit/Rewards
>   Chest entry (it does have `Calculator:Chambers of Xeric loot` and
>   `Calculator:Theatre of Blood loot`, both checked as part of the same
>   sweep — see `docs/bosses/ancient-chest.md` and
>   `docs/bosses/monumental-chest.md`). This is the "check for a Module:/
>   Calculator: page before recording a curve as UNKNOWN" step actually
>   applied and coming back negative — the wave-rate table in this doc *is*
>   the complete, only-published source, not an approximation of a hidden
>   formula.
>
> Model capabilities now available: per-run `SimContext` scalars (`points`,
> `raidLevel`, `deaths`, `perfectKill`, `isMVP`, `delveLevel`, `wavesReached`,
> `moonsKilled`, `fishingLevel`, `hitpointsDamage`, `shieldDamage`,
> `ownedCounts`); `QtySpec.formula`; formula-driven `Table.rolls`;
> `Table`/`TableRefNode` `qtyMultiplier` + `qtyRounding`;
> `Condition.levelAtLeast`; `Entry.ownershipGate`; `Table.suppressesFollowing`;
> `TableRefNode.drawsPerHit`. Still absent: run-scoped (within-kill) dynamic
> state, deeper inline table nesting, party/team context, and real
> implementations for every `FORMULA_IDS` entry — current status:
> `IMPLEMENTED_FORMULA_IDS` in `packages/loot-model/src/formulas.ts`, not a
> count restated here (see `docs/DECISIONS.md`'s formula-status entry).
> See `docs/DECISIONS.md`.


`lootSourceId: rewards-chest-fortis-colosseum` (tier D, `include: true`, `repeatable: true`,
170 raw rows). Watchlisted (`other`). Blocks: Sol Heredit. No `data/bosses/*.json` document exists
— it is tier D and has no override yet, so it never reaches the parser (landmine #12's fix means an
authored override *would* force it through the tier filter, but none has been written).

Source: **Rewards Chest (Fortis Colosseum)** —
https://oldschool.runescape.wiki/w/Rewards_Chest_(Fortis_Colosseum) — pageid `460258`, revid
`15285141`. Local snapshot (`data/snapshots/wikitext/rewards-chest-fortis-colosseum.json`, fetched
2026-08-11T14:43:12Z) postdates this revid, current, no re-fetch needed.

## Watchlist label sanity check

**Correct**, and this doc's job is mostly to confirm the shape `docs/DECISIONS.md`'s "Phase 6
research item" already inferred without reading this page's wave sections individually. It's
right: each `Wave N` heading is a genuine, independent, well-formed drop table (`Wave 1` is a
trivial `Always: 80 sunfire splinters`; `Wave 12` is a full 16-row weighted table), and loot is
explicitly bankable per-wave ("the player has the option to continue... or end their run and walk
away with the rewards they've accumulated so far"; dying loses everything unclaimed). **See
`docs/bosses/doom-of-mokhaiotl.md` for why "population of one" no longer holds** — that source
turned out to share this exact shape and wasn't checked against it when that conclusion was
written.

## The reward mechanic, in prose

1. **Waves 1–3**: fixed, deterministic per-wave rewards (Wave 1: 80 sunfire splinters, always).
2. **From the end of wave 3 onward**, the chest additionally rolls the unique table, at a rate
   that *increases* per wave reached (not points-scaled — directly wave-indexed, given as a table,
   not a formula with a general curve).
3. **If the unique table hits**, a further split: waves 4–6 use `4/10` echo crystal / `6/10`
   sunfire fanatic armour piece; waves 7–12 use `6/16` / `9/16` / plus `1/16` Tonalztics of Ralos
   (a third item only unlocked from wave 7 on). Both echo crystal and the armour piece have their
   own further sub-mechanics (crystal: 1/10 chance of 2–3 instead of 1; armour: duplicate-avoidance
   preferring an unowned piece — the owned/received-before-state family again, at the *wave*
   level this time rather than the *lifetime* level Duke Sucellus/ToA needed).
4. **Wave 12 specifically**: `Dizana's quiver` guaranteed, `Smol heredit` pet flat `1/200`
   (independent of the unique-table mechanic above), plus its own large weighted table (16 rows,
   denominator 4800) layered *on top of* the wave-scaling unique mechanic — i.e. wave 12's chest
   is not merely "the wave-12 row of the general unique table," it's a materially bigger, richer
   table than waves 4–11 get.
5. **Quiver exchange**: `Dizana's quiver` can later be traded to an NPC for 4,000 sunfire
   splinters or another independent `1/200` Smol heredit roll — a genuinely separate, later,
   NPC-shop transaction outside the chest itself; likely out of scope for a loot-source simulator
   (it's not something that happens "on kill," it's a deferred player choice against banked
   items) — flagging as probably out of v1 scope rather than a gap to fix.

## Formulas

No formula id fits (wave-indexed lookup table, not a continuous scalar curve — same shape
conclusion as Doom of Mokhaiotl). If implemented, needs its own id and is a literal per-wave
lookup, not a closed form.

### Unique-table access rate by wave (full table given)

| Wave | Overall unique chance | Echo crystal | Armour piece | Tonalztics |
|---|---|---|---|---|
| 4 | 1/124 | 1/310 | 1/206.67 | — |
| 5 | 1/110 | 1/275 | 1/183.33 | — |
| 6 | 1/96 | 1/240 | 1/160 | — |
| 7 | 1/82 | 1/218.67 | 1/145.78 | 1/1,312 |
| 8 | 1/68 | 1/181.33 | 1/120.89 | 1/1,088 |
| 9 | 1/54 | 1/144 | 1/96 | 1/864 |
| 10 | 1/40 | 1/106.67 | 1/71.11 | 1/640 |
| 11 | 1/26 | 1/69.33 | 1/46.22 | 1/416 |
| 12 | 1/12 | 1/32 | 1/21.33 | 1/192 |

Source: `==Loot mechanics==`, revid `15285141`. Table explicitly states "Glory plays no role in
rolling the unique drop table" — ruling out a `ringOfWealth`-shaped condition here, worth noting
so nobody adds one speculatively.

## Proposed mapping onto the loot model

**Now a real proposal, not a sketch** — the banner's Gap 1/Gap 2 corrections
(`levelAtLeast('wavesReached', n)`-gated tables reading `ctx.wavesReached`) are sufficient to
express every wave except the armour-piece dedup sub-mechanic (gap 3, still open). No new
`TableMode`, no wave-indexed schema construct — just ordinary `Table`s with a `conditions: [{
kind: 'levelAtLeast', field: 'wavesReached', n: N }]` at the entry level, exactly the pattern
already shipped for Doom of Mokhaiotl's delve levels:

```
tables: [
  // Waves 1-3: fixed, deterministic. Wave 1 shown; 2-3 follow the page's own per-wave rows.
  { id: 'fortis:wave1', mode: 'always', entries: [
      { node: item('Sunfire splinters', qty: exact(80)) },
  ] },

  // Waves 4-12: the unique-table access rate, gated on having reached that wave, using the
  // full per-wave rate table this doc already cites (fixed rates — the wiki gives the number
  // directly per wave, so no formula id is needed; `fortis_colosseum_uniques` in FORMULA_IDS
  // is a placeholder for exactly this lookup if a formula ends up cleaner than 9 fixed-rate
  // conditioned entries).
  { id: 'fortis:unique-access', mode: 'independent', entries: [
      { node: oneOf([echo crystal, armour piece], weights [4,6]), rate: fixed(1, 124),
        conditions: [{ kind: 'levelAtLeast', field: 'wavesReached', n: 4, atMost: 4 }] },
      { node: oneOf([echo crystal, armour piece], weights [4,6]), rate: fixed(1, 110),
        conditions: [{ kind: 'levelAtLeast', field: 'wavesReached', n: 5, atMost: 5 }] },
      // ... one bracketed entry per wave, 4 through 11, each using that wave's own published
      // rate and item split (waves 7-11 add Tonalztics of Ralos as a third pool member).
      { node: oneOf([echo crystal, armour piece, tonalztics], weights [6,9,1]), rate: fixed(1, 12),
        conditions: [{ kind: 'levelAtLeast', field: 'wavesReached', n: 12 }] },
        // wave 12 is open-ended (no atMost) since it is the run's maximum
  ] },

  // Wave 12 only: guaranteed quiver, independent pet roll, and the large weighted table —
  // three separate tables, all gated the same way, stacking on top of the unique-access table
  // above rather than replacing it (the page states this explicitly: wave 12's chest is
  // materially richer than waves 4-11's, not just another row in the same lookup).
  { id: 'fortis:wave12-quiver', mode: 'always', entries: [
      { node: item("Dizana's quiver", ...), conditions: [{ kind: 'levelAtLeast', field: 'wavesReached', n: 12 }] },
  ] },
  { id: 'fortis:wave12-pet', mode: 'independent', entries: [
      { node: item('Smol heredit', ...), rate: fixed(1, 200),
        conditions: [{ kind: 'levelAtLeast', field: 'wavesReached', n: 12 }] },
  ] },
  { id: 'fortis:wave12-table', mode: 'weighted', denominator: 4800, entries: [ ...16 rows... ] },
    // this table's own entries carry the wavesReached>=12 condition individually, or the
    // whole table could be wrapped the way Brutus's members split already demonstrates
]
```

The one piece this sketch cannot close: `fortis:wave12-table`'s armour-piece rows (and the
echo-crystal/armour-piece pool inside `fortis:unique-access`) need duplicate-avoidance against
*this run's own* prior wave hits, not lifetime ownership — `ownershipGate` reads
`ctx.ownedCounts`, which is lifetime-scoped by design and would incorrectly treat an armour piece
obtained in a *previous, separate* simulated run as blocking this run's duplicate roll. This is
exactly gap 3 below, and is the one reason this source cannot ship even as an approximation-free
override today.

## What the mapping needs that doesn't exist

1. ~~Wave/level-indexed table structure with per-level bankable loot~~ **RESOLVED** — see the
   mapping above; ordinary `levelAtLeast('wavesReached', n)`-gated tables, no wave engine.
2. ~~Gap 1 (per-run scalar: which wave the run ended at)~~ **RESOLVED**: `ctx.wavesReached`.
3. **Wave-scoped owned/received-before state (armour-piece duplicate avoidance) — the one real
   remaining gap.** Same *family* named in `docs/bosses/duke-sucellus.md`
   (`ownershipGate`/`OwnershipGate`), but scoped to "this run" rather than "lifetime, across the
   whole simulated batch." `docs/mechanics-model-proposal.md`'s Extension B section confirms all
   four shipped ownership sources (Duke Sucellus, ToA, Lunar Chest, Reward Cart) are
   lifetime-scoped, and HANDOFF.md's Extension B summary still lists "run-scoped (within-kill)
   dynamic state" as absent — unchanged by this session's fetches, since this is a schema/engine
   question, not a research one. **Ship the flagged with-replacement approximation instead of
   building it**, per the banner: treat the two armour pieces as ordinary weighted-pool draws with
   no duplicate-avoidance, document the approximation in whatever override eventually ships, and do
   not build general within-kill state for one sub-mechanic of one source.
4. **The out-of-band quiver→splinters/pet exchange** is a deferred NPC transaction, not a kill
   outcome — flagged as likely out of scope, not a gap.

Net for Fortis Colosseum, current: **only gap 3 (run-scoped dedup) is a real open capability gap**,
and this session's recommendation is to ship without it (flagged approximation) rather than build
run-scoped ownership state for this one sub-mechanic. Everything else — the wave structure itself,
the per-wave rates (confirmed complete; no calculator hides a different curve, see the banner), the
`wavesReached` context field — is buildable today with an override, following the same
`data/overrides/` + wiki-figure-test pattern as Doom of Mokhaiotl.
