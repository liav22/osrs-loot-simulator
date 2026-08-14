# Corporeal Beast

> ### ⚠️ Capability verdicts below are STALE — re-audited 2026-08-13
>
> The **mechanics, prose and cited numbers in this doc are accurate** and are
> what to implement from. Its "What the mapping needs that doesn't exist"
> section is **not** — it was written before Extensions A and B, step (c)
> (`suppressesFollowing`, `drawsPerHit`) and `qtyRounding` existed, and has
> never been revised. Corrections for this source:
>
> - **SHIPPED — this source is `verified` as of 2026-08-13.** Its single gap
>   is **RESOLVED** by `TableRefNode.drawsPerHit`, scoped exactly as this doc
>   proposed (a field on the `tableRef` node, not a new `TableMode`, and
>   `Table.rolls` untouched globally). Off the mechanics watchlist.
> - **One claim here is overstated**: the default reading does *not* differ in
>   per-kill expectation at all — expectation is linear, so both readings give
>   `10p x E[draw]`. The real difference is distributional (2.3% of kills yield
>   loot vs 21.1%), which is a sharper argument for the fix, not a weaker one:
>   no mean-based check, `ev_matches` included, could ever have caught it.
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


`lootSourceId: corporeal-beast`. Watchlisted (`other`). No blocked sources.

Source: **Corporeal Beast** — https://oldschool.runescape.wiki/w/Corporeal_Beast — pageid `41957`,
revid `15281958`. Local snapshot (`data/snapshots/wikitext/corporeal-beast.json`, fetched
2026-08-11T19:23:36Z) postdates this revid, current, no re-fetch needed.

## Watchlist label sanity check

**Correct**, and — like Abyssal Sire — the entire mechanic is fully stated in one template call,
confirming the watchlist detail verbatim:

```
{{GemDropTable|12/512|naturetalisman=yes|rolls=10|override=There is a 12/512 chance of rolling
the [[gem drop table]], whereupon its contents are rolled 10 times.}}
```

`docs/DECISIONS.md`'s "Wired `tableRef` into the parser" entry already flags this as the
confirmed exception to `Table.rolls`' usual "N independent access attempts" meaning — "one access
check, ten draws after, the opposite of the default reading" — and explicitly warns not to "fix"
`Table.rolls` globally over this one case. Nothing found this session changes that conclusion;
this doc exists to give it a formal model-mapping writeup, not to re-investigate it.

## The reward mechanic, in prose

1. Sigils (Spectral/Arcane/Elysian) — transcluded from `Template:Uniques/Corporeal Beast`, not
   read in full this session (a separate, standard weighted unique table, no watchlist-relevant
   mechanic of its own found in the heading structure).
2. Standard weighted table (weapons/armour, runes/ammo, resources, other) — ordinary structure.
3. **`12/512` chance to access the shared `gem_drop_table`. If it hits, the table's contents are
   drawn 10 times from that single access** — i.e. one Bernoulli check gates a fixed *batch* of 10
   draws, not 10 independent Bernoulli checks each independently gating one draw. Every other
   `rolls=N` on an RDT/gem access line on the wiki (confirmed across the tier-C wiring session,
   `docs/DECISIONS.md`) means the latter; this is the one confirmed exception.
4. Tertiary — not investigated further this session.

## Formulas

**No formula needed.** `12/512` is a plain `fixed` rate. The gap is structural (what `rolls`
*means* for this one access line), not a probability calculation.

## Proposed mapping onto the loot model

The default reading (`{ mode: 'independent', rolls: 10, entries: [{ node: tableRef(gem), rate:
fixed(12/512) }] }`) is confirmed **wrong** for this source specifically — it would model 10
independent 12/512 checks (expected ~0.234 hits) rather than one 12/512 check gating 10 guaranteed
draws (expected 10× the per-hit yield, conditional on one check succeeding). The two are not
close: the existing reading understates how much loot a successful proc yields by an order of
magnitude, and overstates how *often* any gem-table loot happens at all relative to what a single
12/512-gated batch actually produces.

```
tables: [
  ...,
  { id: 'corp:gem-access', mode: 'independent', entries: [
      { node: { kind: 'tableRef', ref: 'gem_drop_table', drawsPerHit: 10 }, rate: fixed(12/512) }
  ] },
]
```

## What the mapping needs that doesn't exist

1. **A "access once, draw K times if it hits" mode for a `tableRef` node — the opposite of what
   `Table.rolls` means everywhere else.** This is *not* the same gap as the quantity-scaling
   family (Abyssal Sire/Duke Sucellus/Zalcano/ToB) — those scale the *quantity per item* on a
   yield that still happens 0 or 1 times; this scales *how many independent draws* happen,
   conditional on a single gate. It's also not the `rolls`-reads-integer-context gap (Lunar
   Chest/Reward pool/Reward Cart) — those need `rolls` itself to vary with a per-run scalar;
   Corporeal Beast's `10` is a *constant*, the issue is purely that today's `rolls` semantics
   (independent per-attempt access checks) is the wrong shape for this source regardless of what
   number is plugged in. This is confirmed, by `docs/DECISIONS.md`'s own account, to be a
   **genuine one-source exception** — not evidence `Table.rolls`' existing meaning is wrong in
   general, and not something to fix by changing `Table.rolls` globally. The narrowest fix is an
   escape-hatch field scoped to this one access pattern (e.g. a `drawsPerHit` on the `tableRef`
   node, only meaningful when the entry's own `rate` already gates access), not a new `TableMode`.

Net for Corporeal Beast: **one distinct, narrow, source-specific gap** — not a member of any
family named so far in this batch (quantity-scaling, rolls-reads-context, owned/received-before
state). Confirmed, by the project's own prior investigation, to be a genuine outlier rather than a
sign of a broader missing feature — the correct scope for a fix here is deliberately narrow.
