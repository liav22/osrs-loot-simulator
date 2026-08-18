import { deepStrictEqual } from 'node:assert'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { USER_AGENT } from '../src/wiki/client.js'
import { readItemIndex } from '../src/items/index.js'
import { loadItemAllowlist } from '../src/items/allowlist.js'
import { loadWatchlist } from '../src/validate/watchlist.js'
import { fetchGePrices } from '../src/prices/ge-prices.js'
import { loadSharedTables } from '../src/tables/shared-tables.js'
import { loadTemplateDefinitions } from '../src/parse/expand-transclusions.js'
import { parseBoss, BOSSES_DIR } from '../src/parse/parse-boss.js'
import { InventorySchema } from '../src/inventory/schema.js'
import { INVENTORY_PATH } from '../src/inventory/build.js'
import { snapshotPath } from '../src/snapshots/store.js'

/**
 * `data/bosses/*.json` is not automatically kept in sync with the current
 * parser — landmine #1 in `docs/HANDOFF.md`, known since Phase 3. Every prior
 * guard against it was a human habit ("always re-run `ingest parse` before
 * trusting `data/bosses/`"), which is exactly the shape of thing that stops
 * working the moment nobody remembers to do it: `monumental-chest` sat
 * quietly stale — its committed document no longer reproduces under current
 * code (`'preroll' entries must use fixed or formula rates, got 'always'`) —
 * invisible to every other check because tier D was outside every documented
 * parse invocation until the tier-gate fix (see docs/DECISIONS.md). This is
 * that habit turned into an assertion: it runs the REAL pipeline, with the
 * REAL committed inputs, against every REAL committed document, and fails
 * loudly the moment one disagrees, instead of silently keeping a wrong answer
 * on disk indefinitely.
 *
 * Runs against a scratch directory (`parseBoss`'s `outputDir`), never against
 * `data/bosses/` itself — this check must never be the thing that silently
 * rewrites committed data; a human decides that by re-running `ingest parse`
 * and reviewing the diff.
 */

const SNAPSHOTS_PRESENT = existsSync(snapshotPath('dropsline', 'brutus'))

describe.skipIf(!SNAPSHOTS_PRESENT)('every committed document reproduces from a fresh parse', () => {
  let scratch: string

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'corpus-repro-'))
  })

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true })
  })

  it("matches parseBoss's current output for every committed source", async () => {
    // Re-parses the whole corpus for real (~100 sources, each running every
    // validation check including drops_covered's own snapshot reads) —
    // slower than this suite's other tests by design, not a flake.
    const inventory = InventorySchema.parse(JSON.parse(await readFile(INVENTORY_PATH, 'utf8')))
    const itemIndex = await readItemIndex()
    const allowlist = await loadItemAllowlist()
    const watchlist = await loadWatchlist()
    const gePrices = await fetchGePrices(USER_AGENT)
    const sharedTables = await loadSharedTables()
    const templates = await loadTemplateDefinitions()

    const committedFiles = (await readdir(BOSSES_DIR)).filter((f) => f.endsWith('.json'))
    expect(committedFiles.length).toBeGreaterThan(50)

    // Each source writes to its own file in `scratch` and reads only shared,
    // already-loaded-once inputs, so this parallelises safely — the sequential
    // version of this loop took ~23s re-running every check on ~100 sources.
    const results = await Promise.all(
      committedFiles.map(async (file): Promise<string | null> => {
        const slug = file.slice(0, -'.json'.length)
        const source = inventory.lootSources.find((s) => s.id === slug)
        // A committed file naming a loot source that no longer exists at all
        // is a different, already-covered failure mode (landmine #1's
        // "source stops producing output") — not this check's job.
        if (source === undefined) {
          return `${slug}: committed file has no matching loot source in _inventory.json`
        }

        const revid = inventory.bosses.find((boss) => boss.lootSourceId === source.id)?.revid ?? 0
        const committed: unknown = JSON.parse(await readFile(join(BOSSES_DIR, file), 'utf8'))

        const outcome = await parseBoss({
          title: source.dropsPage,
          slug: source.id,
          wikiRevId: revid ?? 0,
          parserVersion: 1,
          itemIndex,
          allowlist,
          watchlist,
          gePrices,
          sharedTables,
          templates,
          repeatable: source.repeatable,
          outputDir: scratch,
          // A confirmed co-drop bundle writes its own `data/tables/<id>.json`
          // — must never land in the real, committed directory from a test
          // run, the same reason `outputDir` is scratch too.
          tablesDir: join(scratch, 'tables'),
        })

        if (outcome.status === 'parse_failed') {
          return `${slug}: committed as a real document, but a fresh parse now fails: ${outcome.reasons.join('; ')}`
        }

        const fresh: unknown = JSON.parse(await readFile(join(scratch, file), 'utf8'))
        try {
          deepStrictEqual(fresh, committed)
          return null
        } catch {
          return `${slug}: fresh parse disagrees with the committed document`
        }
      })
    )
    const mismatches = results.filter((r): r is string => r !== null)

    // One assertion naming every offender at once, not a per-file `it` block
    // — a partial re-parse mid-investigation should never look like 97 passes
    // and 1 unrelated-looking failure.
    expect(mismatches).toEqual([])
  }, 60000)
})
