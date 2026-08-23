import { WikiClient } from '../src/wiki/client.js'
import { writeSnapshot, slugify } from '../src/snapshots/store.js'

const titles = process.argv.slice(2)
if (titles.length === 0) {
  console.error('Usage: tsx scripts/fetch-template.ts "Template:Foo" ["Template:Bar" ...]')
  process.exit(1)
}

const client = new WikiClient()

for (const title of titles) {
  const { record } = await client.wikitext(title)
  const path = await writeSnapshot('wikitext', slugify(title), record)
  console.log(`${title} -> ${path}`)
}
