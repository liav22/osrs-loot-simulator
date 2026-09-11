import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { REPO_ROOT } from '../snapshots/store.js'
import { BossEntrySchema, LootSourceSchema, type BossEntry, type LootSource } from './schema.js'

/** Explicit reward entities outside Category:Bosses, retained when rebuilding inventory. */
export const AdditionalSourcesSchema = z
  .array(z.object({ boss: BossEntrySchema, source: LootSourceSchema }).strict())
  .superRefine((entries, ctx) => {
    const slugs = new Set<string>()
    const ids = new Set<string>()
    entries.forEach(({ boss, source }, i) => {
      if (
        boss.lootSourceId !== source.id ||
        source.bosses.length !== 1 ||
        source.bosses[0] !== boss.slug ||
        boss.repeatable !== source.repeatable ||
        slugs.has(boss.slug) ||
        ids.has(source.id)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Additional sources must have unique, consistent boss/source mappings',
          path: [i],
        })
      }
      slugs.add(boss.slug)
      ids.add(source.id)
    })
  })

export async function loadAdditionalSources() {
  const raw: unknown = JSON.parse(
    await readFile(join(REPO_ROOT, 'data', 'additional-sources.json'), 'utf8')
  )
  return AdditionalSourcesSchema.parse(raw)
}

export function appendAdditionalSources(
  bosses: BossEntry[],
  sources: Map<string, LootSource>,
  additions: z.infer<typeof AdditionalSourcesSchema>
): void {
  for (const { boss, source } of additions) {
    if (bosses.some((existing) => existing.slug === boss.slug) || sources.has(source.id)) {
      throw new Error(`Additional source '${source.id}' conflicts with the discovered inventory`)
    }
    bosses.push(boss)
    sources.set(source.id, source)
  }
}
