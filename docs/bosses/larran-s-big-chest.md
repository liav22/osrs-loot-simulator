# Larran's big chest

Source: [Larran's big chest — Possible loot](https://oldschool.runescape.wiki/w/Larran%27s_big_chest?oldid=15338728#Possible_loot),
revision **15338728** (20 September 2026), page ID 222072. The shared fish
calculation comes from `Module:Slayer chest fish chart`, revision **15317734**.

One attempt is **one opening**. The three Dagon'hai pieces are mutually
exclusive pre-roll rewards at 1/256 each. They are represented as an equal
three-way selection behind a 3/256 access roll, so later pieces are not
artificially suppressed by sequential Bernoulli checks. A unique replaces the
main reward.

The ordinary main rows occupy 57 of 60 slots. The remaining 3/60 are the
published 1/20 fish branch, folded into the same weighted table. Its fish-type
probabilities and level gates are identical to Brimstone chest.

The page states that every possible fish quantity is 50% above the matching
Brimstone quantity and rounded down. The model therefore rolls the Brimstone
base integer first and applies `floor(base * 3 / 2)`, rather than treating the
displayed endpoints as a continuous range. Shark lure additionally doubles the
raw-shark base, giving only multiples of three from 240 through 750. This keeps
simulation and analytic expected quantity aligned with the published averages.

The document is generated and `verified`. Regression coverage checks the
unique and main denominators, the fish branch's 1/20 total at representative
Fishing levels, exact scaled quantities, one-reward-per-opening behavior and
seeded simulation.
