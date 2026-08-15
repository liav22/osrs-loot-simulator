import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SNAPSHOT_VERSION, SnapshotSchema, type Snapshot } from '../wiki/schemas.js'
import type { RequestRecord } from '../wiki/client.js'
import { USER_AGENT } from '../wiki/client.js'

/**
 * Snapshot-first design (PROJECT_PLAN.md 6.3): the raw response is persisted
 * verbatim and everything downstream re-reads from disk. The wiki is never
 * re-hit to fix a parser bug.
 *
 * `data/snapshots/` is gitignored — it is a regenerable cache, not a source.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '../../../..')
export const SNAPSHOT_ROOT = join(REPO_ROOT, 'data', 'snapshots')

export type SnapshotKind =
  | 'inventory'
  | 'dropsline'
  | 'revisions'
  | 'schema'
  | 'page'
  | 'categories'
  | 'activity'
  | 'wikitext'
  | 'monster'
  | 'item-id'
  | 'ge-prices'
  /** `prop=imageinfo` batches and their per-name search fallbacks — see items/icons.ts. */
  | 'item-icon'

/**
 * Page title to filename-safe key. The original title is always stored inside
 * the snapshot, so nothing downstream has to reverse this.
 */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug === '' ? 'untitled' : slug
}

export function snapshotPath(kind: SnapshotKind, key: string): string {
  return join(SNAPSHOT_ROOT, kind, `${key}.json`)
}

export async function writeSnapshot(
  kind: SnapshotKind,
  key: string,
  record: RequestRecord
): Promise<string> {
  const snapshot: Snapshot = SnapshotSchema.parse({
    snapshotVersion: SNAPSHOT_VERSION,
    fetchedAt: new Date().toISOString(),
    userAgent: USER_AGENT,
    endpoint: record.endpoint,
    params: record.params,
    httpStatus: record.httpStatus,
    body: record.body,
  })
  const path = snapshotPath(kind, key)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  return path
}

export async function readSnapshot(kind: SnapshotKind, key: string): Promise<Snapshot> {
  const raw = await readFile(snapshotPath(kind, key), 'utf8')
  return SnapshotSchema.parse(JSON.parse(raw))
}

export async function listSnapshots(kind: SnapshotKind): Promise<string[]> {
  try {
    const entries = await readdir(join(SNAPSHOT_ROOT, kind))
    return entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => entry.slice(0, -'.json'.length))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/** Index of everything a fetch run produced, so triage need not guess. */
export interface InventoryEntry {
  title: string
  slug: string
  pageid: number
  revid: number | null
  dropRowCount: number
  bucketError: string | null
}

export interface FetchManifest {
  fetchedAt: string
  userAgent: string
  category: string
  requestCount: number
  entries: InventoryEntry[]
}

export const MANIFEST_PATH = join(SNAPSHOT_ROOT, 'manifest.json')

export async function writeManifest(manifest: FetchManifest): Promise<void> {
  await mkdir(SNAPSHOT_ROOT, { recursive: true })
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

export async function readManifest(): Promise<FetchManifest> {
  return JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as FetchManifest
}
