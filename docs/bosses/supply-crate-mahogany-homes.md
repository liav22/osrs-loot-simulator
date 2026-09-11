# Supply crate (Mahogany Homes)

Source: [Supply crate — Possible loot](https://oldschool.runescape.wiki/w/Supply_crate_(Mahogany_Homes)?oldid=15189848#Possible_loot),
revision **15189848** (22 April 2026), page ID 272546. Wikitext, rendered HTML,
revision metadata and 18 reward bucket rows fetched through the serialized wiki
client on 11 September 2026.

One simulated attempt opens **one crate**, purchased for 25 Carpenter points.
The 18 precise reward rows sum to 144/144 and select one noted material stack.
Different quantities of the same material have distinct weights; they are not
uniform quantity ranges. No override or simulator-specific mechanic is needed.
The general parser recognizes the page's “Possible loot” heading through its
row-content-gated heading rule. Registration in `data/additional-sources.json`
keeps the entity available when rebuilding the boss inventory.

| Material | Quantity: weight (out of 144) | Expected quantity per crate |
|---|---|---|
| Bolt of cloth | 9: 5, 10: 1 | 55/144 |
| Limestone brick | 9: 5, 10: 1 | 55/144 |
| Mahogany plank | 6: 15, 7: 3 | 111/144 |
| Oak plank | 28: 10, 29: 15, 30: 5 | 865/144 |
| Soft clay | 45: 5, 46: 10, 47: 10, 48: 5 | 1395/144 |
| Steel bar | 23: 5, 24: 20, 25: 5 | 720/144 |
| Teak plank | 15: 20, 16: 4 | 364/144 |

[Regression tests](../../apps/ingest/test/supply-crate-mahogany-homes.test.ts)
check every exact stack weight, the wiki's separately stated average quantities,
item probabilities, and one stack per simulated opening. The generic rendered
GP comparison does not recognize this page's value wording; it remains advisory.
Contract completion and the cost of earning Carpenter points are outside this
per-crate simulation.
