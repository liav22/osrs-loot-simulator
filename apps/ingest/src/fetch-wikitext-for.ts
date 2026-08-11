import { WikiClient } from './wiki/client.js'
import { listSnapshots, slugify, writeSnapshot } from './snapshots/store.js'

/** One-off: fetch wikitext for a title list, skipping what's already cached. */
async function main(): Promise<void> {
  const titles = process.argv.slice(2)
  const client = new WikiClient({ delayMs: 1000 })
  const onDisk = new Set(await listSnapshots('wikitext'))

  for (const title of titles) {
    const slug = slugify(title)
    if (onDisk.has(slug)) {
      process.stdout.write(`skip (cached): ${title}\n`)
      continue
    }
    const { record } = await client.wikitext(title)
    await writeSnapshot('wikitext', slug, record)
    process.stdout.write(`fetched: ${title}\n`)
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
