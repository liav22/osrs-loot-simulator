import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSiteIndex, SiteIndexSchema } from '../src/site-index.js'

function bossJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    slug: 'test-boss',
    name: 'Test Boss',
    aliases: ['tb'],
    wikiPage: 'Test Boss',
    wikiRevId: 1,
    variants: ['normal'],
    tables: [
      {
        id: 't',
        mode: 'always',
        rolls: 1,
        withoutReplacement: false,
        entries: [
          {
            node: { kind: 'item', itemId: 1, itemKey: 'a', name: 'A', qty: { kind: 'exact', n: 1 } },
            rate: { kind: 'always' },
          },
        ],
      },
    ],
    contextDefaults: {},
    status: 'verified',
    validation: { ok: true, checks: [] },
    source: 'generated',
    parserVersion: 1,
    ...overrides,
  })
}

describe('buildSiteIndex', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'site-index-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('summarises every boss file into slug/name/aliases/status', async () => {
    await writeFile(join(dir, 'test-boss.json'), bossJson())
    await writeFile(
      join(dir, 'other-boss.json'),
      bossJson({ slug: 'other-boss', name: 'Other Boss', aliases: [], status: 'needs_review' })
    )

    const index = await buildSiteIndex(dir)
    expect(SiteIndexSchema.safeParse(index).success).toBe(true)
    expect(index.entries).toEqual([
      { slug: 'other-boss', name: 'Other Boss', aliases: [], status: 'needs_review' },
      { slug: 'test-boss', name: 'Test Boss', aliases: ['tb'], status: 'verified' },
    ])
  })

  it('produces an empty index for an empty directory', async () => {
    const index = await buildSiteIndex(dir)
    expect(index.entries).toEqual([])
  })

  it('throws on a file that is not a valid Boss document', async () => {
    await writeFile(join(dir, 'broken.json'), JSON.stringify({ not: 'a boss' }))
    await expect(buildSiteIndex(dir)).rejects.toThrow()
  })
})
