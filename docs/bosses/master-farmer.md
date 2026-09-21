# Master Farmer

Research sources: `Master Farmer`, wiki revision **15267392**;
`Module:Master farmer special seed calculator`, revision **14718052**; and
`Rocky`, revision **15352783**, fetched 2026-09-22.

## Model

- One simulation attempt is one **successful** Master Farmer pickpocket.
  Failure chance, stun time, damage, Thieving experience and pickpockets per
  hour are outside the loot-table model.
- Every success first selects exactly one seed category out of 1,000:
  allotments 485, hops 243, flowers 122, bushes 97, special 5 and herbs 48.
  It then selects exactly one seed from that category. The page publishes the
  category chances in prose and the final marginal seed rates to three
  significant figures, so the static within-category weights are those
  published marginals normalized inside their stated category.
- The herb pool keeps a fixed 48/1,000 access chance. The wiki calculator
  module defines `s = (6 + min(85, Farming level)) / 1000`; Guam has weight
  `0.320 + 0.081 - s`, while Ranarr, Snapdragon and Torstol receive
  `69/81 × s`, `10/81 × s` and `2/81 × s`. Those four weights always sum to
  0.401 and the ten fixed herb weights sum to 0.599.
- Rocky is an independent tertiary roll. The Rocky page states
  `1 / (B - 25 × Thieving level)` and lists `B = 257,211` for Master Farmer,
  reproducing the Master Farmer page's 1/256,261 rate at level 38 and
  1/254,736 rate at level 99.
- Full rogue equipment doubles the realized seed quantity without changing
  any seed rate. It does not duplicate the tertiary pet.

Master Farmer is registered through `data/additional-sources.json` because it
is outside `Category:Bosses`. Its inline `DropsLineSkill` rows cannot express
the two-stage category selection or the calculator-defined Farming curve, so a
documented override replaces the parser's flat-table result. The page's inline
pickpocketing section is still detected generically to supply the successful-
pickpocket attempt label.

## Verification

`apps/ingest/test/pickpocketing.test.ts` checks all six category shares, proves
that every success yields exactly one seed, pins both Farming endpoints for the
four scaling herbs, pins both Rocky endpoints, and confirms that rogue
equipment doubles seed quantities but not rates or the pet. Formula-level tests
also enforce that the four scaling herb weights retain their constant 401/1,000
share and cap at Farming level 85.
