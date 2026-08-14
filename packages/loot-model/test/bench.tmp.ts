import { simulate, DEFAULT_SIM_CONTEXT } from '../src/index'
import { brutus, brutusPrices } from './fixtures/brutus'

/**
 * The Brutus benchmark. `docs/HANDOFF.md` section 4 carries the running table
 * of what each change cost.
 *
 * **The bar is 1M kills, not 10M** — the default below. 10M was the number
 * every session defended until it was measured against 1M directly and found to
 * carry no information the cheaper measurement doesn't:
 *
 *   - Scaling is dead linear. 10M/1M came out at 9.6–10.0 across every variant
 *     ever measured here: no GC cliff, no allocation growth, nothing appears
 *     between the two sizes.
 *   - 10M is not the more precise measurement, which is the part that settled
 *     it. Relative round-to-round spread is comparable at both sizes, because
 *     the noise is this machine's drift rather than per-run variance. 10M costs
 *     10x the wall-clock and buys no extra precision.
 *   - Nobody runs it. `DEFAULT_KILLS` in the frontend is 10,000, three orders
 *     of magnitude below it, and the simulation runs in a Worker regardless.
 *
 * Pass `--kills 10000000` to run the old size as an occasional linearity check;
 * that is what it is now for. See docs/DECISIONS.md's "Is 10M the right
 * benchmark bar?" entry.
 *
 * Read `docs/HANDOFF.md`'s drift warning before trusting a single number from
 * this. Anything comparing two variants must interleave them in the same
 * sitting — `--label` exists so an external script can alternate two builds and
 * tag each line, rather than running all of A then all of B and attributing the
 * machine's own drift to the change.
 *
 * Usage:
 *   tsx test/bench.tmp.ts [--label NAME] [--reps N] [--kills 1000000]
 */

const ctx = { ...DEFAULT_SIM_CONTEXT, members: true }

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback)
}

const label = arg('label', 'current')
const reps = Number(arg('reps', '3'))
const killCounts = arg('kills', '1000000').split(',').map(Number)

function run(n: number): { ms: number; gpPerKill: number } {
  const t0 = performance.now()
  const result = simulate(brutus, n, ctx, 12345, { prices: brutusPrices })
  return { ms: performance.now() - t0, gpPerKill: result.gpPerKill }
}

run(200_000) // warm up the JIT before anything is recorded

for (const n of killCounts) {
  const trials = Array.from({ length: reps }, () => run(n))
  const times = trials.map((t) => t.ms).sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]!
  // gpPerKill is the check that actually matters across variants: an
  // optimization that moves it has changed the model, not just its speed.
  console.log(
    `RESULT\t${label}\t${n}\t${median.toFixed(1)}\t${times.map((t) => t.toFixed(0)).join('/')}\t${trials[0]!.gpPerKill.toFixed(4)}`
  )
}
