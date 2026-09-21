# OSRS Loot Simulator

[![CI](https://github.com/liav22/osrs-loot-simulator/actions/workflows/ci.yml/badge.svg)](https://github.com/liav22/osrs-loot-simulator/actions/workflows/ci.yml)

**[Open the simulator](https://liav22.github.io/osrs-loot-simulator/)**

Search an Old School RuneScape loot source, choose an attempt count and
encounter settings, and simulate the loot. Runs execute in a Web Worker in your
browser, using a static dataset derived from the OSRS Wiki. No account,
application server, or database is required.

- **Share a run:** the URL carries the seed and settings for reproducible drops.
  Leave the seed at `0` to generate a fresh one each time you simulate.
- **Explore item probabilities:** click an item to see the chance of obtaining
  at least a target number of copies and kill-count milestones. Supported cases
  use analytic calculations; unsupported ownership-dependent cases are identified.
- **See data quality:** each source has a validation status. Unstated rates and
  incomplete mechanics remain flagged rather than filled in with guesses.

## Data coverage

Snapshot of the committed dataset, checked **2026-09-22**:

| Status | Sources | Meaning |
|---|---:|---|
| `verified` | 78 | Derived by the pipeline and passing deterministic checks |
| `manual_override` | 18 | Hand-authored mechanics, passing the same checks |
| `needs_review` | 14 | Incomplete data, an approximation, or a failing check |
| No generated document | 2 | Included in the inventory but not yet represented |
| **Total included** | **112** | Loot sources selected for coverage |

A loot source can be a boss, pickpocketable NPC, shared raid chest, or reward
pool. The inventory also includes one-time quest encounters, which default
search hides. Of the **82 repeatable sources**, 67 pass validation: 50
pipeline-derived and 17 using overrides. Validation measures agreement with
available source evidence; it does not guarantee every in-game mechanic is
known.

Counts change as the corpus evolves. [The inventory](data/_inventory.json)
defines inclusion; [the site index](data/index.json) lists generated sources.
See [current limitations](docs/PROJECT_GUIDE.md#current-limitations-and-useful-next-work)
for the remaining mechanics and data gaps. The development-only `/admin` page
exposes source validation reports.

## Run locally

Requires **Node.js 22+** (CI uses 24) and **pnpm 9.15.9**, pinned in `package.json`.

```sh
pnpm install
pnpm --filter @osrs-loot-simulator/web dev
```

Open the Vite URL, normally `http://localhost:5173`. The dev and build commands
automatically copy the committed dataset into `apps/web/public/`.

```sh
pnpm -r typecheck
pnpm lint
pnpm -r test
pnpm --filter @osrs-loot-simulator/web build
```

Browser tests run separately against a production build served under the
GitHub Pages subpath, including deep links and the real simulation worker:

```sh
pnpm --filter @osrs-loot-simulator/web exec playwright install chromium
pnpm --filter @osrs-loot-simulator/web test:e2e
```

Snapshot-dependent ingest tests can skip on a fresh checkout because the raw
wiki cache is gitignored. Ordinary frontend development uses committed JSON
and does not require fetching the wiki.

## Repository layout

| Path | Purpose |
|---|---|
| [`packages/loot-model`](packages/loot-model/) | Pure TypeScript schemas, seeded simulation, expected value and probabilities; `zod` is its only runtime dependency |
| [`apps/ingest`](apps/ingest/) | Node CLI for fetching, parsing, item resolution, overrides and validation |
| [`apps/web`](apps/web/) | Vite + React site, deployed to GitHub Pages |
| [`data`](data/) | Versioned boss documents, shared tables, inventory and source metadata |
| [`docs`](docs/) | Current engineering guide, override contract and source research |

## Updating the dataset

Ingestion is **snapshot-first**: wiki responses are saved verbatim in ignored
`data/snapshots/`, and parsing uses those local files. Fix a parser bug by
re-parsing the existing snapshots. `parserVersion` records provenance; it is
not a staleness switch and does not need bumping for each parser fix.

For initial collection or an intentional source refresh, run from the root:

```sh
pnpm --filter @osrs-loot-simulator/ingest ingest fetch --all
pnpm --filter @osrs-loot-simulator/ingest ingest item-index
```

These commands contact the wiki. The client serializes requests, uses a delay
and descriptive User-Agent, sends `maxlag=5`, and retries rate-limited requests.
To regenerate documents and the site data after collection:

```sh
pnpm --filter @osrs-loot-simulator/ingest ingest parse
pnpm --filter @osrs-loot-simulator/ingest ingest item-icons
pnpm --filter @osrs-loot-simulator/ingest ingest site-index
```

`item-icons` may also contact the wiki. Use `parse --source <slug>` for a
focused re-parse; an unscoped parse attempts every included source. Review
generated changes and run the relevant checks before publishing them.

The parser reads wikitext and cached template definitions. Validation checks
both model consistency and coverage against the wiki's drop rows. Mechanics
that cannot be derived automatically can use [documented overrides](docs/OVERRIDES.md).
Overrides still pass validation, and partially modeled sources retain their
[watchlist entries](data/mechanics-watchlist.json). Price-based expected-value
comparison is advisory, not part of the success gate.

## Contributing and project context

Start with [AGENTS.md](AGENTS.md) for Codex or [CLAUDE.md](CLAUDE.md) for
Claude Code development rules, and [the project guide](docs/PROJECT_GUIDE.md) for architecture, decisions, regression
guards and remaining work. [Boss research](docs/bosses/) retains the evidence
behind individual mechanics. The [original build plan](PROJECT_PLAN.md) and
[mechanics proposal](docs/mechanics-model-proposal.md) are historical references.

## Licensing and attribution

| Content | License |
|---|---|
| Code and other files outside `data/` | [MIT](LICENSE) |
| Everything under `data/`, derived from the OSRS Wiki | [CC BY-NC-SA 3.0](data/LICENSE) |

Drop data comes from the [Old School RuneScape Wiki](https://oldschool.runescape.wiki),
licensed [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/).
Preserve the data license and the site's wiki attribution. Boss portraits and
item icons are hot-linked to the wiki rather than re-hosted.

Old School RuneScape and RuneScape are trademarks of Jagex Ltd. This is an
unofficial fan project, not affiliated with or endorsed by Jagex Ltd.
