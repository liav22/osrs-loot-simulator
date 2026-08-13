// Copies the subset of committed data/*.json the frontend actually needs
// into public/, which Vite serves as-is in dev and copies verbatim into
// dist/ on build. NEVER import this JSON into the app bundle (PROJECT_PLAN.md
// 9: "250 bosses would bloat it") — this script is what makes runtime
// `fetch()` possible instead. public/ is gitignored; this script is the only
// thing that writes to it, so it's safe to wipe and repopulate every time.
import { cp, mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const dataDir = join(repoRoot, 'data')
const publicDir = join(here, '..', 'public')

async function copyIfExists(rel) {
  const src = join(dataDir, rel)
  if (!existsSync(src)) {
    process.stdout.write(`  skip (missing): data/${rel}\n`)
    return
  }
  const dest = join(publicDir, rel)
  await mkdir(dirname(dest), { recursive: true })
  await cp(src, dest, { recursive: true })
  process.stdout.write(`  copied: data/${rel}\n`)
}

async function main() {
  await rm(publicDir, { recursive: true, force: true })
  await mkdir(publicDir, { recursive: true })
  process.stdout.write('Syncing data/ -> apps/web/public/\n')
  await copyIfExists('index.json')
  await copyIfExists('bosses')
  await copyIfExists('tables')
  await copyIfExists('LICENSE')
  process.stdout.write('Done.\n')
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`)
  process.exitCode = 1
})
