# Unsired

Source: [Unsired — Rewards](https://oldschool.runescape.wiki/w/Unsired?oldid=15328493#Rewards),
revision **15328493** (2 September 2026), page ID 65210. Wikitext and eight
DropsLineReward bucket rows fetched through the serialized wiki client on
11 September 2026. The revision records that rewards now roll when an Unsired
is offered to the Font of Consumption, following the 2 September update.

One simulated attempt is **one Unsired offered**, independent of obtaining it
from Abyssal Sire. The existing Sire source continues to drop Unsired itself.
The inventory supplement in `data/additional-sources.json` preserves this
item-based reward entity when rebuilding from Category:Bosses.

| Reward | Weight |
|---|---:|
| Any bludgeon piece | 62 |
| Abyssal dagger | 26 |
| Abyssal whip | 12 |
| Jar of Miasma | 13 |
| Abyssal head | 10 |
| Abyssal orphan | 5 |

The denominator is 128 without the pet, 123 with it. The pet's ownership gate
removes its five slots after acquisition within the run. A pet reclaimable
from Probita counts as unowned for this rule; leave its ownership control off.
The model does not simulate losing a pet during a run.

The three component rows each list the **combined** bludgeon access rate,
not three independent rolls. The override uses one weight-62 `oneOf` choice,
uniform among missing pieces. `ownershipGate.resetPerSet` subtracts the minimum
count across all three components before applying the ordinary below-one gate.
This restarts protection after each complete set without discarding the
component tallies or adding source-specific simulator code.

Enter pieces held toward the current bludgeon. Completed sets are treated as
assembled; assembling or disposing of pieces manually between offerings is
not a separate simulated action. Rewards show component quantities. GP totals
exclude the assembled bludgeon's value, so they do not reproduce the wiki's
Unsired EV, which values a third of a bludgeon per component roll.

[Unsired tests](../../apps/ingest/test/unsired.test.ts) compare every weight to
both published denominators, check one reward per offering, pet removal and
repeated complete sets. [Model tests](../../packages/loot-model/test/repeating-set.test.ts)
cover partial entering sets, analytic expectation, seeded replay, schema
validation and conservative probability classification. First-pet probability
is exact; item milestone calculations that depend on evolving ownership remain
explicitly unsupported. Expected value describes the next offering's entering
state, as for other ownership-dependent sources.
