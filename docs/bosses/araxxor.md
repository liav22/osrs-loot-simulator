# Araxxor

Source: [Araxxor — Unique](https://oldschool.runescape.wiki/w/Araxxor?oldid=15290082#Unique),
revision **15290082**, from the existing wikitext snapshot fetched 11 August
2026. The live page could not be read during this fix because browsing was
blocked by robots.txt; the cached text agrees with the supplied wiki excerpt.

The unique table has a combined chance of **1/150**: **1/200 for any noxious
halberd piece**, and **1/600 for an Araxyte fang**. Each component row repeats
the pool's 1/200 rate. The Halberd footnote specifies duplicate protection
until each full set is obtained, and the embedded Jagex citation compares it
to the Abyssal bludgeon system.

The [override](../../data/overrides/araxxor.json) uses one weight-3 `oneOf`
choice out of 600, alongside the weight-1 fang. Pieces are uniform among
missing components, using the existing `ownershipGate.resetPerSet` mechanic.
Protection restarts after every complete set. All other tables are preserved.
This corrects both the former threefold component access rate and the
unrestricted duplicate selection; no simulator special case is needed.

Starting with no pieces, cumulative component counts differ by at most one.
Entering ownership contributes to set completion but is not added to the
displayed loot earned during the run. Results retain components; the assembled
halberd's value is not included. Expected value describes the next kill's
entering ownership state; component milestones that depend on evolving
ownership remain explicitly unsupported.

[Regression tests](../../apps/ingest/test/araxxor.test.ts) check the published
rates, partial and complete entering sets, every component drop in seeded
10,000-kill runs, and deterministic replay against the committed document.
