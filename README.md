# OSRS Loot Simulator

A wiki-driven loot table database and kill simulator for Old School RuneScape.

- **Data pipeline** — turns OSRS Wiki drop tables into a validated, canonical JSON
  schema (`apps/ingest` → `data/`).
- **Static site** — search a boss, view its loot table, and simulate up to 10M
  kills entirely client-side (`apps/web`).

No database, no server. The dataset is committed JSON; git is the revision history,
diff tool, and audit log. See [`PROJECT_PLAN.md`](./PROJECT_PLAN.md) for the full
spec and [`docs/DECISIONS.md`](./docs/DECISIONS.md) for judgement calls made along
the way.

## Status

Phase 0 (scaffold). Nothing simulates yet — see `PROJECT_PLAN.md` section 16 for
the phase plan.

## Repository layout

```
packages/loot-model/   pure loot model: schema, conditions, formulas, simulator
apps/ingest/           wiki client, parser, validator (network + fs, not browser)
apps/web/              Vite + React + TS static site, deployed to GitHub Pages
data/                  generated + hand-authored boss/table JSON (own license)
infra.example/         committed templates for the optional Phase 6 backend
infra/                 gitignored — real IDs and secrets, mirrors infra.example/
```

## Development

Requires Node 22+ and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm -r test
pnpm -r typecheck
pnpm lint
```

## Licensing

This repository carries **two licenses**:

| Path | License | Why |
|---|---|---|
| everything except `data/` | [MIT](./LICENSE) | original code |
| `data/` | [CC BY-NC-SA 3.0](./data/LICENSE) | derived from the OSRS Wiki, which is itself CC BY-NC-SA 3.0 — share-alike and non-commercial terms carry over |

Drop-rate data comes from the [OSRS Wiki](https://oldschool.runescape.wiki). Old
School RuneScape and RuneScape are trademarks of Jagex Ltd.; this project is not
affiliated with or endorsed by Jagex Ltd.
