# Rewards Guardian (Guardians of the Rift)

Source: [Rewards Guardian — Rewards](https://oldschool.runescape.wiki/w/Rewards_Guardian?oldid=15338032#Rewards),
revision **15338032** (9 September 2026), page ID 351235. The serialized wiki
client fetched wikitext, 40 bucket rows, rendered HTML and revision metadata
on 11 September 2026. Supporting pouch and unique-item pages are cached too.

One attempt is **one search**, consuming one elemental and one catalytic point,
or 25 abyssal pearls. A Big-search is five attempts. The simulator awards gross
loot; it does not deduct pearls spent on searches, exchange duplicate rewards,
complete games, or open the Intricate pouch reward. Search by Rewards Guardian,
Guardians of the Rift, or GotR.

## Main table and ownership

The main table has 125 ordinary slots: runes 84, talismans 16, abyssal pearls 18,
Intricate pouch 5, abyssal ashes 1 and needle 1. When a pouch is missing, its
15 slots bring the denominator to 140. Owning all four pouches or a colossal
pouch removes those slots. Degraded pouches count as owned.

The [Large pouch](https://oldschool.runescape.wiki/w/Large_pouch) and
[Giant pouch](https://oldschool.runescape.wiki/w/Giant_pouch) pages say lower-tier
pouches must be owned before larger pouches drop. No Runecraft level is required
to receive them. The model gives the smallest missing pouch, prepacked with
2/4/6/8 pure essence for small/medium/large/giant respectively. Those are bundles,
not independent essence rolls. Pouches acquired within a run update ownership;
after completing the set, subsequent searches use denominator 125. Creating,
losing, or degrading pouches during a run is outside the simulation.

The override represents four mutually exclusive 15-slot pouch entries alongside
the 125 ordinary slots (185 authored slots). Compound ownership gates remove
three entries when a pouch is missing, or all four when none is eligible. The
resulting effective denominator is always 140 or 125, never 185.

Defaults assume the four pouches and both talisman quests are owned/completed.
Clear the corresponding controls to model an earlier account. Diary and abyssal
needle ownership means **ever received**, even if no longer held. Neither is
awarded again after its first drop in the run.

## Talismans, rares and pet

The 16-slot talisman access rolls a 35-slot sub-table: four elemental talismans
at weight 3 each; mind/body/chaos/cosmic/nature at weight 4 each;
elemental/law/death at weight 1 each. Incomplete Troll Stronghold replaces law
with air; incomplete Mourning's End Part II replaces death with air. The
substitution preserves probability mass. Notes follow the published item rows.

Rare rewards are separate from the main roll: diary 1/20, catalytic talisman
1/200, abyssal needle 1/300, abyssal lantern 1/700, and each of three dyes 1/1200.
The override uses a weighted rare pool with implicit nothing. Ownership gates
inside its diary/needle outcomes suppress repeats without increasing the rates
of other rare rewards. A separate tertiary roll awards the pet at 1/4000.

## Remaining source uncertainty

This source stays **needs_review / approximate**, with an explicit watchlist
entry, for two limitations:

- Rune quantities use the published full-level ranges. The page says quantities
  decrease below the level required to craft each rune. A hidden wikitext
  comment sketches fourth-power scaling but does not define complete bounds,
  the meaning of its base amount, or integer rounding. No precise low-level
  formula is inferred from that sketch.
- The page states that rare rewards roll separately from main, but does not
  explicitly settle co-occurrence within the rare table. The model assumes one
  mutually exclusive rare outcome, preserving each published marginal rate.

The introductory claim of 2.14 pearls/search and 1/7 pearl access conflicts with
the precise rows. Tests follow the explicit 18/140 and 18/125 rates and 14–16
quantity: **270/140** or **270/125** pearls/search. They do not tune the table to
match the conflicting prose average. Generic rendered GP comparison is advisory.

[Source regression tests](../../apps/ingest/test/rewards-guardian.test.ts) check
all 16 pouch combinations, both denominators, all main and rare rates, quest
substitutions, pouch bundles, progression, and one-time rewards. General
[compound ownership tests](../../packages/loot-model/test/compound-ownership.test.ts)
cover tracking, evolving requirements, simulation/expectation consistency,
seeded replay and conservative probability classification. Pet milestones remain
exact relative to the stated 1/4000 roll; evolving main-table probabilities are
reported as unsupported.
