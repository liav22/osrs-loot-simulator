import { simulate } from '../src/index'
import { brutus, brutusPrices } from './fixtures/brutus'
import { DEFAULT_SIM_CONTEXT } from '../src/index'

const ctx = { ...DEFAULT_SIM_CONTEXT, members: true }

function run(n: number): { ms: number; gpPerKill: number } {
  const t0 = performance.now()
  const result = simulate(brutus, n, ctx, 12345, { prices: brutusPrices })
  return { ms: performance.now() - t0, gpPerKill: result.gpPerKill }
}

// warm up
run(200_000)

for (const n of [1_000_000, 10_000_000]) {
  const trials = [run(n), run(n), run(n)]
  const times = trials.map((t) => t.ms).sort((a, b) => a - b)
  console.log(
    `${n.toLocaleString()} kills: median ${times[1]!.toFixed(0)}ms ` +
      `(${times.map((t) => t.toFixed(0)).join('/')}) gpPerKill=${trials[0]!.gpPerKill.toFixed(2)}`
  )
}
