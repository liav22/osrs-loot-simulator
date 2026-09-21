# Vyre (pickpocketing)

Research source: `Haemas Lamescus`, wiki revision **14813304**, and its
transcluded `Template:Pickpocket/Vyre`, revision **14994098**, fetched
2026-09-18. The tertiary pet rule comes from `Rocky`, revision **15352783**,
fetched 2026-09-22.

## Model

- One simulation attempt is one **successful** Vyre pickpocket. Failure chance,
  stun time, damage, Thieving experience and pickpockets per hour are outside
  the loot-table model.
- The ordinary reward is one weighted draw out of 132: coins 109, death runes
  8, blood runes 2, blood pints 6, uncut rubies 5, diamond 1 and cooked mystery
  meat 1.
- Blood shard is an independent 1/5,000 roll and can accompany the ordinary
  reward.
- Rocky is a separate independent roll using the page's exact
  `1 / (99,175 - 25 × Thieving level)` formula. The default level is the Vyre
  requirement, 82 Thieving.
- Full rogue equipment doubles the realized quantity of ordinary rewards and
  blood shards. The shared `rogue_outfit_multiplier` formula applies to those
  two tables without altering rates; it does not duplicate Rocky.

The source is registered through `data/additional-sources.json` because
pickpocketable NPCs are outside `Category:Bosses`. The parser expands the
row-bearing `Pickpocket/Vyre` template locally and remains snapshot-first. A
documented override adds Rocky because that separate pet page is not
transcluded into the NPC's pickpocket table.

## Verification

`apps/ingest/test/pickpocketing.test.ts` pins every published rate, confirms
that each attempt yields exactly one ordinary reward plus the independent
blood-shard roll, pins Rocky at the required and maximum Thieving levels, and
proves that the full rogue outfit doubles loot quantities without duplicating
the pet.
