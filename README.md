# OSRS Loot Simulator

**[liav22.github.io/osrs-loot-simulator](https://liav22.github.io/osrs-loot-simulator/)**

Search an Old School RuneScape boss, set a kill count, and simulate the drops.
The whole thing runs in your browser — the simulation is a Web Worker, the
dataset is static JSON, and there is no server or database anywhere in it.

Runs are seeded and reproducible: the seed goes in the URL, so a link to
5,000 Vorkath kills replays to exactly the same three visages for whoever you
send it to. Leave the seed on `0` and each press of Simulate rolls a fresh one.

## What's in the box

- **`packages/loot-model`** — the loot model and simulator. Pure TypeScript,
  zero runtime dependencies beyond `zod`, no knowledge of the wiki or the web
  app. It compiles a boss document into a flat form and simulates against a
  seeded RNG. 10M kills runs in ~2 seconds.
- **`apps/ingest`** — the pipeline that turns wiki pages into that model:
  fetch, parse, validate, and a set of checks that decide whether a source is
  trustworthy. Node only; it never runs in a browser.
- **`apps/web`** — the site. Vite + React, deployed to GitHub Pages.
- **`data/`** — the committed output. Git is the revision history, the diff
  tool and the audit log; there is no database because there does not need to
  be one.

## Corpus status

52 loot sources are published, each carrying its own validation report:

| status | count | meaning |
|---|---|---|
| `verified` | 18 | the pipeline derived this from the wiki unaided, and every check passes |
| `manual_override` | 2 | a hand-authored document (`data/overrides/`) that passes every check — the mechanic exists in prose the parser cannot read |
| `needs_review` | 32 | at least one check fails; the rates shown may be incomplete or wrong |

The badge in the UI is the same field. **`needs_review` is the honest majority
right now**, largely because of one known parser gap: a drop sub-table written
as a wiki *transclusion* (`{{TreeHerbSeedDropLines}}`, `{{Uniques/Corporeal
Beast}}`) produces no `{{DropsLine}}` rows, so the parser never sees it. The
`drops_covered` check compares every document against the wiki's own drop rows
and fails the sources where that happened, rather than shipping a `verified`
badge that is not true. See `docs/DECISIONS.md`.

## Running it

Requires Node 22+ and [pnpm](https://pnpm.io) (24 in CI).

```sh
pnpm install
pnpm --filter @osrs-loot-simulator/web dev     # the site, on :5173
```

Checks:

```sh
pnpm -r typecheck
pnpm lint
pnpm -r test                                   # unit tests, all three packages
pnpm --filter @osrs-loot-simulator/web test:e2e  # Playwright, against a production build
```

The e2e suite is deliberately not part of `pnpm -r test`: it downloads a
browser and does a full production build, served through a GitHub Pages mimic,
because the base path and the SPA 404 fallback only exist in that build.

A dev-only admin page at `/admin` shows the validation report for every source.
It is gated behind `import.meta.env.DEV` and is not in the production bundle.

## How ingest works

The pipeline is **snapshot-first**. Every wiki response is written to
`data/snapshots/` verbatim, and every later step re-reads from disk. The wiki
is never re-hit to fix a parser bug — you bump `parserVersion` and re-parse.
That directory is gitignored: it is a regenerable cache, not a source.

```sh
cd apps/ingest
pnpm ingest fetch --all      # snapshot the boss category, revisions, drop rows
pnpm ingest item-index       # resolve item names to item ids
pnpm ingest item-icons       # resolve every item's wiki icon file name
pnpm ingest triage           # classify each source by how hard it is to parse
pnpm ingest parse --tier A,B,C   # -> data/bosses/*.json
pnpm ingest site-index       # -> data/index.json (search index + boss portraits)
```

Requests are serialised, one at a time, with a delay, `maxlag=5`, retry on 429,
and a descriptive User-Agent — the wiki's `api.php` is robots-disallowed for
generic crawlers, and this is meant to be distinguishable from a crawl.

Parsing reads **wikitext**, not the rendered page, because wikitext is the only
place carrying the heading text, quantity qualifiers like `(noted)`, and
unambiguous template parameters. Each parsed document then goes through eight
checks (`weights_sum`, `refs_resolve`, `rates_valid`, `qty_sane`, `items_known`,
`not_on_watchlist`, `drops_covered`, and the advisory `ev_matches`). Seven of
them are closed-world over the extracted document; `drops_covered` is the one
that compares it back against the page it came from.

Where the wiki states a mechanic the schema cannot express, the source goes on
`data/mechanics-watchlist.json` and stays `needs_review` on purpose. **Nothing
in `data/` is guessed** — a rate the wiki does not state is recorded as unknown
rather than interpolated.

## Licensing

This repository carries **two licences**, and the split is not cosmetic.

| Path | Licence | Why |
|---|---|---|
| everything except `data/` | [MIT](./LICENSE) | original code |
| `data/` | [CC BY-NC-SA 3.0](./data/LICENSE) | derived from the OSRS Wiki, which is itself CC BY-NC-SA 3.0 — the share-alike and non-commercial terms carry over |

`data/` must never be relicensed as MIT. Images are **not** re-hosted for the
same reason: boss portraits and item icons are hot-linked to the wiki, and
`data/` stores only the file names.

## Attribution

Drop table data is derived from the
[Old School RuneScape Wiki](https://oldschool.runescape.wiki), licensed
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). The
attribution also appears in the site footer on every page, which is a licence
obligation rather than a courtesy.

Old School RuneScape and RuneScape are trademarks of Jagex Ltd. This is an
unofficial fan project, not affiliated with or endorsed by Jagex Ltd.

## Further reading

- [`docs/DECISIONS.md`](./docs/DECISIONS.md) — the append-only log of judgement
  calls, including the ones that were measured and then reversed.
- [`docs/HANDOFF.md`](./docs/HANDOFF.md) — current state and the landmines.
- [`docs/OVERRIDES.md`](./docs/OVERRIDES.md) — when a hand-authored document is
  the right answer, and the four-step sequence for shipping one.
- [`docs/bosses/`](./docs/bosses/) — per-source research notes for the hard
  ones, with the wiki citations behind each modelled mechanic.
