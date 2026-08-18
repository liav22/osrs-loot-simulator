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

The wiki's `Category:Bosses` resolves to 102 distinct loot sources that the
project has decided to cover (`include: true` in `data/_inventory.json` — the
denominator; not every page in the category is a real, independent loot
source, and a few are quest-only encounters with no loot at all). **99 of
those 102 (97.1%) have a generated document**, each carrying its own
validation report:

| status | count | of 102 include:true | of 99 documents | meaning |
|---|---|---|---|---|
| `verified` | 67 | 65.7% | 67.7% | the pipeline derived this from the wiki unaided, and every check passes |
| `manual_override` | 2 | 2.0% | 2.0% | a hand-authored document (`data/overrides/`) that passes every check — the mechanic exists in prose the parser cannot read |
| `needs_review` | 30 | 29.4% | 30.3% | at least one check fails; the rates shown may be incomplete or wrong |
| *(no document)* | 3 | 2.9% | — | not yet parseable at all — see below |

**That 67 is inflated by content nobody would simulate, and the site's search
already corrects for it.** Every source also carries `repeatable: boolean` —
whether the same account can get more than one roll against it, `false` for a
boss fought exactly once during a quest and never again (Bouncer, Sigmund,
`Dad`). Split by that field:

| | total | documents | verified | manual_override |
|---|---|---|---|---|
| `repeatable: true` (farmable) | 72 | 71 (98.6%) | 41 (**56.9%**) | 2 (2.8%) |
| `repeatable: false` (one-time) | 30 | 28 (93.3%) | 26 (86.7%) | 0 |

26 of the 67 `verified` sources (38.8%) are one-time quest encounters, whose
tiny `always`-only tables clear every deterministic check almost by
construction. **41/72 = 56.9%, not 65.7%, is the number that answers "how
much of what a user would actually simulate is verified."** Counting the two
`manual_override` raid/chest sources too (also a terminal, passes-every-check
state — see `docs/OVERRIDES.md` — just hand-authored rather than
pipeline-derived) brings farmable coverage to 43/72 = 59.7%. Nothing is
deleted for this — the documents, and the flag itself, stay visible on
`/admin` — but `apps/web`'s default search excludes non-repeatable sources,
since a simulator has nothing meaningful to say about a source with exactly
one possible sample. See `docs/DECISIONS.md`'s `repeatable` entry for the
signal it's derived from (`Category:Quest monsters` membership, live from the
wiki) and its measured false-positive/negative rates.

The badge in the UI is the `status` field. **`needs_review` is still a large
minority**, for several distinct reasons rather than one: five sources stuck
on an ambiguous heading the wiki gives no signal to resolve (the "Uniques"/
"Mutagens" question, most re-litigated question in the project); a handful of
raids and points-scaled mechanics the wiki states in prose but declines a
precise formula for on purpose (Tombs of Amascut, Theatre of Blood, Chambers
of Xeric and Fortis Colosseum all ship hand-authored overrides already and
stay watchlisted for one named, deliberately-unmodelled remnant each; Zalcano
and Reward pool similarly); a few curves the wiki names but never states a
formula for at all (Duke Sucellus, Reward cart); two sources whose own
published weights don't sum to their own stated denominator; and a residue of
per-source coverage gaps, some already root-caused (a Lua-transclusion the
parser can't run, on two sources; a case-sensitive item-name comparison bug
that already fully explains two more), some not yet investigated. None of
these are guessed around — `drops_covered` compares every document against
the wiki's own drop rows and fails a source where they disagree, rather than
shipping a `verified` badge that isn't true. The 3 sources with no document at
all: `revenant-maledictus` (own open parse gap — no `{{DropsLine}}` template
anywhere on the page), `burnt-chest` (a heading-matching gap) and `sigmund`
(no real combat loot, only a quest-only pickpocket reward). See
`docs/DECISIONS.md` and `docs/HANDOFF.md` for the full history and reasoning
behind every number here — it changes as the corpus grows, this table will
not always be current.

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
pnpm ingest parse            # -> data/bosses/*.json (every include:true source; --tier narrows it)
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
