# Elf (pickpocketing)

Research source: `Celebrian`, wiki revision **14864691**, and its transcluded
`Template:Pickpocket/Elf`, revision **14994099**, fetched 2026-09-18. The
tertiary pet rule comes from `Rocky`, revision **15352783**, fetched 2026-09-22.

## Model

- One simulation attempt is one **successful** Elf pickpocket. Failure chance,
  stun time, damage, Thieving experience and pickpockets per hour are outside
  the loot-table model.
- The ordinary reward is one weighted draw out of 128: coins 105, death runes
  8, nature runes 5, jug of wine 6, diamond 1, fire orb 2 and gold ore 1.
- In Prifddinas, crystal shards roll independently at 1/35 and enhanced crystal
  teleport seeds roll independently at 1/1,024. They can accompany the ordinary
  reward and each other.
- Rocky is a separate independent roll using the page's exact
  `1 / (99,175 - 25 × Thieving level)` formula. The default level is the Elf
  requirement, 85 Thieving.
- Full rogue equipment doubles the realized quantity of ordinary and crystal
  rewards. The shared `rogue_outfit_multiplier` formula applies to those two
  tables without altering rates; it does not duplicate Rocky.

The source is registered through `data/additional-sources.json` because
pickpocketable NPCs are outside `Category:Bosses`. The parser expands the
row-bearing `Pickpocket/Elf` template locally and remains snapshot-first. A
documented override adds Rocky because that separate pet page is not
transcluded into the NPC's pickpocket table.

## Verification

`apps/ingest/test/pickpocketing.test.ts` pins every published rate, confirms
that each attempt yields exactly one ordinary reward, checks independent
crystal rewards, pins Rocky at the required and maximum Thieving levels, and
proves that the full rogue outfit doubles loot quantities without duplicating
the pet.
