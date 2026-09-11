# Alchemical Hydra

Source: [Alchemical Hydra — Unique](https://oldschool.runescape.wiki/w/Alchemical_Hydra?oldid=15285801#Unique),
revision **15285801**, using the existing cached wikitext. Live browsing of
the Hydra and Brimstone ring pages was blocked by robots.txt during this fix.

The Unique section describes successive rolls, stopping on the first success:

| Reward | Conditional rate |
|---|---|
| Dragon thrownaxe | 1/2000 |
| Dragon knife | 1/2000 |
| Hydra's claw | 1/1000 |
| Hydra tail | 1/512 |
| Hydra leather | 1/512 |
| Any Brimstone ring component | 1/180 |

The ring roll's effective probability is
`(1999/2000)^2 × (999/1000) × (511/512)^2 / 180`, approximately 1/181.07.
The three displayed component rows repeat this combined rate. Their footnote
specifies **eye → fang → heart** order. Together the unique rolls give the
wiki's approximately 1/87.6 chance of a unique.

The [existing override](../../data/overrides/alchemical-hydra.json) now uses
these conditional rates in the stated order, with one access to the shared
[ring-component table](../../data/tables/brimstone_ring_pieces.json). Its
ordered preroll entries award the first missing component. Repeating-set ownership gates select the eye if missing,
otherwise the fang if missing, otherwise the heart. Subtracting complete sets
restarts that order after every full set while retaining cumulative loot.
This reuses the general model without source-specific simulator changes.
The override's prior herb correction and other non-unique tables are preserved.

Entering owned components contribute to the current set but are not counted
as newly earned loot. Results retain components rather than assembled rings.
Expected value describes the next kill's entering state; component milestones
remain unsupported because ownership evolves during a run.

[Hydra regression tests](../../apps/ingest/test/alchemical-hydra.test.ts)
check exact composed unique rates, partial and complete entering sets,
the order of every ring drop across 10,000-kill runs, and seeded replay.
