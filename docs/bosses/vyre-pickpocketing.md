# Vyre (pickpocketing)

Research source: `Haemas Lamescus`, wiki revision **14813304**, and its
transcluded `Template:Pickpocket/Vyre`, revision **14994098**, fetched
2026-09-18.

## Model

- One simulation attempt is one **successful** Vyre pickpocket. Failure chance,
  stun time, damage, Thieving experience and pickpockets per hour are outside
  the loot-table model.
- The ordinary reward is one weighted draw out of 132: coins 109, death runes
  8, blood runes 2, blood pints 6, uncut rubies 5, diamond 1 and cooked mystery
  meat 1.
- Blood shard is an independent 1/5,000 roll and can accompany the ordinary
  reward.
- Full rogue equipment doubles the realized quantity of every reward from the
  successful pickpocket. The shared `rogue_outfit_multiplier` formula applies
  to both tables; it does not alter drop rates.

The source is registered through `data/additional-sources.json` because
pickpocketable NPCs are outside `Category:Bosses`. The parser expands the
row-bearing `Pickpocket/Vyre` template locally and remains snapshot-first.

## Verification

`apps/ingest/test/pickpocketing.test.ts` pins every published rate, confirms
that each attempt yields exactly one ordinary reward plus the independent
blood-shard roll, and proves that the full rogue outfit doubles quantities
without changing drop counts.
