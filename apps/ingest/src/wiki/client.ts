import { z } from 'zod'
import {
  BucketResponseSchema,
  CategoryMembersResponseSchema,
  ParseWikitextResponseSchema,
  RevisionsResponseSchema,
  type BucketResponse,
} from './schemas.js'
import {
  BOSS_CATEGORY,
  BUCKET_NAMESPACE,
  DROPS_BUCKET,
  DROPSLINE_FIELDS,
  ITEM_ID_BUCKET,
  ITEM_ID_PAGE_SIZE,
  ITEM_NAME_BUCKET,
  ITEM_NAME_PAGE_SIZE,
} from './fields.js'

export const API_ENDPOINT = 'https://oldschool.runescape.wiki/api.php'

/**
 * Descriptive, with contact info (PROJECT_PLAN.md 6.2). `api.php` is
 * robots-disallowed for generic crawlers; this User-Agent is what marks the
 * difference between a deliberate API consumer and a crawl.
 */
export const USER_AGENT =
  'osrs-loot-simulator/0.0.0 (+https://github.com/liav22/osrs-loot-simulator)'

/** Serial requests with a delay between them. No parallel bursts, ever. */
export const DEFAULT_DELAY_MS = 1000
const MAX_RETRIES = 3
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

export interface ItemIdRow {
  pageName: string
  /** Usually one element; `["N/A"]` when the page has no single resolvable id. */
  ids: string[]
}

export interface ItemNameRow {
  pageName: string
  /** The exact display name a `{{DropsLine|name=...}}` value would carry. */
  itemName: string
  /** Usually one element; several means the name genuinely covers multiple items. */
  ids: string[]
}

export interface RequestRecord {
  endpoint: string
  params: Record<string, string>
  httpStatus: number
  body: unknown
}

export interface WikiClientOptions {
  delayMs?: number
  userAgent?: string
  onRequest?: (params: Record<string, string>) => void
}

export class WikiApiError extends Error {
  constructor(
    message: string,
    readonly params: Record<string, string>,
    readonly httpStatus: number
  ) {
    super(message)
    this.name = 'WikiApiError'
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class WikiClient {
  private readonly delayMs: number
  private readonly userAgent: string
  private readonly onRequest: ((params: Record<string, string>) => void) | undefined
  /** Serialises every call through one promise chain. */
  private queue: Promise<unknown> = Promise.resolve()
  private lastRequestAt = 0
  private requestCount = 0

  constructor(options: WikiClientOptions = {}) {
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS
    this.userAgent = options.userAgent ?? USER_AGENT
    this.onRequest = options.onRequest
  }

  get requests(): number {
    return this.requestCount
  }

  /** Raw request. Every call in the process funnels through here, in order. */
  async request(params: Record<string, string>): Promise<RequestRecord> {
    const run = this.queue.then(() => this.execute(params))
    // Keep the chain alive even if this call rejects.
    this.queue = run.catch(() => undefined)
    return run
  }

  private async execute(params: Record<string, string>): Promise<RequestRecord> {
    const withDefaults: Record<string, string> = {
      format: 'json',
      formatversion: '2',
      maxlag: '5',
      ...params,
    }

    for (let attempt = 0; ; attempt++) {
      const since = Date.now() - this.lastRequestAt
      if (since < this.delayMs) await sleep(this.delayMs - since)

      this.onRequest?.(withDefaults)
      const url = `${API_ENDPOINT}?${new URLSearchParams(withDefaults).toString()}`
      const response = await fetch(url, {
        headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      })
      this.lastRequestAt = Date.now()
      this.requestCount += 1

      const text = await response.text()

      if (!response.ok) {
        if (RETRYABLE_STATUS.has(response.status) && attempt < MAX_RETRIES) {
          const retryAfter = Number(response.headers.get('retry-after') ?? 0)
          await sleep(retryAfter > 0 ? retryAfter * 1000 : this.delayMs * 2 ** (attempt + 1))
          continue
        }
        throw new WikiApiError(
          `HTTP ${response.status} for ${JSON.stringify(withDefaults)}`,
          withDefaults,
          response.status
        )
      }

      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        throw new WikiApiError(
          `Response was not JSON: ${text.slice(0, 200)}`,
          withDefaults,
          response.status
        )
      }

      // MediaWiki reports lag as a 200 with an error object.
      const lagged = z
        .object({ error: z.object({ code: z.string() }).passthrough() })
        .safeParse(body)
      if (lagged.success && lagged.data.error.code === 'maxlag' && attempt < MAX_RETRIES) {
        await sleep(this.delayMs * 2 ** (attempt + 1))
        continue
      }

      return { endpoint: API_ENDPOINT, params: withDefaults, httpStatus: response.status, body }
    }
  }

  /** Every page in a category. Follows `cmcontinue` until exhausted. */
  async categoryMembers(category = BOSS_CATEGORY): Promise<{
    titles: { pageid: number; title: string }[]
    records: RequestRecord[]
  }> {
    const titles: { pageid: number; title: string }[] = []
    const records: RequestRecord[] = []
    let cmcontinue: string | undefined

    do {
      const record = await this.request({
        action: 'query',
        list: 'categorymembers',
        cmtitle: category,
        cmlimit: '500',
        cmtype: 'page',
        ...(cmcontinue === undefined ? {} : { cmcontinue }),
      })
      records.push(record)
      const parsed = CategoryMembersResponseSchema.parse(record.body)
      for (const member of parsed.query.categorymembers) {
        titles.push({ pageid: member.pageid, title: member.title })
      }
      cmcontinue = parsed.continue?.cmcontinue
    } while (cmcontinue !== undefined)

    return { titles, records }
  }

  /** All `dropsline` rows for one page. */
  async dropsFor(pageName: string): Promise<{ response: BucketResponse; record: RequestRecord }> {
    const fields = Object.values(DROPSLINE_FIELDS)
      .map((field) => `'${field}'`)
      .join(',')
    const escaped = pageName.replace(/'/g, "\\'")
    const query =
      `bucket('${DROPS_BUCKET}')` +
      `.select(${fields})` +
      `.where('${DROPSLINE_FIELDS.pageName}','${escaped}')` +
      `.limit(500).run()`

    const record = await this.request({ action: 'bucket', query })
    return { response: BucketResponseSchema.parse(record.body), record }
  }

  /** Latest revision id per page, batched (the API caps titles at 50). */
  async revisions(pageTitles: readonly string[]): Promise<{
    revisions: Map<string, { revid: number; timestamp: string } | null>
    records: RequestRecord[]
  }> {
    const revisions = new Map<string, { revid: number; timestamp: string } | null>()
    const records: RequestRecord[] = []

    for (let i = 0; i < pageTitles.length; i += 50) {
      const batch = pageTitles.slice(i, i + 50)
      const record = await this.request({
        action: 'query',
        prop: 'revisions',
        titles: batch.join('|'),
        rvprop: 'ids|timestamp',
      })
      records.push(record)
      const parsed = RevisionsResponseSchema.parse(record.body)
      for (const page of parsed.query.pages) {
        const latest = page.revisions?.[0]
        revisions.set(
          page.title,
          latest === undefined ? null : { revid: latest.revid, timestamp: latest.timestamp }
        )
      }
    }

    return { revisions, records }
  }

  /** Raw wikitext of a page, for the schema pages and prose inspection. */
  async wikitext(page: string): Promise<{ wikitext: string; record: RequestRecord }> {
    const record = await this.request({ action: 'parse', page, prop: 'wikitext' })
    return { wikitext: ParseWikitextResponseSchema.parse(record.body).parse.wikitext, record }
  }

  /** Rendered HTML of a page, for figures the buckets do not expose. */
  async pageHtml(page: string): Promise<{ html: string; record: RequestRecord }> {
    const record = await this.request({ action: 'parse', page, prop: 'text' })
    const parsed = z
      .object({ parse: z.object({ title: z.string(), text: z.string() }).passthrough() })
      .parse(record.body)
    return { html: parsed.parse.text, record }
  }

  /** Categories each page belongs to, batched with `clcontinue` followed. */
  async categoriesFor(pageTitles: readonly string[]): Promise<{
    categories: Map<string, string[]>
    records: RequestRecord[]
  }> {
    const categories = new Map<string, string[]>()
    const records: RequestRecord[] = []
    const schema = z.object({
      query: z.object({
        pages: z.array(
          z
            .object({
              title: z.string(),
              categories: z.array(z.object({ title: z.string() }).passthrough()).optional(),
            })
            .passthrough()
        ),
      }),
      continue: z.object({ clcontinue: z.string() }).passthrough().optional(),
    })

    for (let i = 0; i < pageTitles.length; i += 50) {
      const batch = pageTitles.slice(i, i + 50)
      let clcontinue: string | undefined
      do {
        const record = await this.request({
          action: 'query',
          prop: 'categories',
          titles: batch.join('|'),
          cllimit: '500',
          ...(clcontinue === undefined ? {} : { clcontinue }),
        })
        records.push(record)
        const parsed = schema.parse(record.body)
        for (const page of parsed.query.pages) {
          const existing = categories.get(page.title) ?? []
          for (const category of page.categories ?? []) {
            existing.push(category.title.replace(/^Category:/, ''))
          }
          categories.set(page.title, existing)
        }
        clcontinue = parsed.continue?.clcontinue
      } while (clcontinue !== undefined)
    }

    return { categories, records }
  }

  /**
   * Whether a page carries an `infobox_activity` row. This is what separates a
   * real encounter (a raid, Barrows, the Gauntlet) from an incidental shared
   * category like a quest name or a release year.
   */
  async isActivity(pageName: string): Promise<{ activity: boolean; record: RequestRecord }> {
    const escaped = pageName.replace(/'/g, "\\'")
    const record = await this.request({
      action: 'bucket',
      query: `bucket('infobox_activity').select('page_name').where('page_name','${escaped}').limit(1).run()`,
    })
    const parsed = BucketResponseSchema.parse(record.body)
    return { activity: (parsed.bucket?.length ?? 0) > 0, record }
  }

  /**
   * `infobox_monster` rows for a page. A page with a real combat level is a
   * fightable monster, so finding one on a page we excluded for having no drop
   * data is a signal that the exclusion needs a human look.
   */
  async monsterInfo(pageName: string): Promise<{
    rows: { name: string | null; combatLevel: number | null; hitpoints: number | null }[]
    record: RequestRecord
  }> {
    const escaped = pageName.replace(/'/g, "\\'")
    const record = await this.request({
      action: 'bucket',
      query:
        `bucket('infobox_monster')` +
        `.select('page_name','name','combat_level','hitpoints')` +
        `.where('page_name','${escaped}').limit(50).run()`,
    })
    const parsed = BucketResponseSchema.parse(record.body)
    const rowSchema = z.object({
      name: z.string().nullable().optional(),
      combat_level: z.number().nullable().optional(),
      hitpoints: z.number().nullable().optional(),
    })
    const rows = (parsed.bucket ?? []).map((raw) => {
      const row = rowSchema.parse(raw)
      return {
        name: row.name ?? null,
        combatLevel: row.combat_level ?? null,
        hitpoints: row.hitpoints ?? null,
      }
    })
    return { rows, record }
  }

  /**
   * One page of `bucket('item_id')`, at the given offset. The bucket caps at
   * 5,000 rows per query regardless of `limit`, so a full fetch needs
   * `.offset()` paging — see `itemIdPages` below.
   */
  async itemIdPage(offset: number): Promise<{ rows: ItemIdRow[]; record: RequestRecord }> {
    const record = await this.request({
      action: 'bucket',
      query:
        `bucket('${ITEM_ID_BUCKET}').select('page_name','id')` +
        `.limit(${ITEM_ID_PAGE_SIZE}).offset(${offset}).run()`,
    })
    const parsed = BucketResponseSchema.parse(record.body)
    const rowSchema = z.object({
      page_name: z.string(),
      id: z.array(z.string()).optional(),
    })
    const rows = (parsed.bucket ?? []).map((raw) => {
      const row = rowSchema.parse(raw)
      return { pageName: row.page_name, ids: row.id ?? [] }
    })
    return { rows, record }
  }

  /**
   * Every `item_id` row, paged with `.offset()` until a page returns fewer
   * than the page size. Each page is a separate snapshot so a partial run can
   * resume without re-fetching pages already on disk.
   */
  async itemIdPages(
    onPage: (rows: ItemIdRow[], record: RequestRecord, offset: number) => Promise<void>
  ): Promise<number> {
    let offset = 0
    for (;;) {
      const { rows, record } = await this.itemIdPage(offset)
      await onPage(rows, record, offset)
      if (rows.length < ITEM_ID_PAGE_SIZE) return offset + rows.length
      offset += ITEM_ID_PAGE_SIZE
    }
  }

  /**
   * One page of `bucket('infobox_item')`, at the given offset — one row per
   * item VERSION, with the exact display name `{{DropsLine|name=...}}` uses.
   */
  async itemNamePage(offset: number): Promise<{ rows: ItemNameRow[]; record: RequestRecord }> {
    const record = await this.request({
      action: 'bucket',
      query:
        `bucket('${ITEM_NAME_BUCKET}').select('page_name','item_name','item_id')` +
        `.limit(${ITEM_NAME_PAGE_SIZE}).offset(${offset}).run()`,
    })
    const parsed = BucketResponseSchema.parse(record.body)
    const rowSchema = z.object({
      page_name: z.string(),
      item_name: z.string().nullable().optional(),
      item_id: z.array(z.string()).optional(),
    })
    const rows = (parsed.bucket ?? []).map((raw) => {
      const row = rowSchema.parse(raw)
      return { pageName: row.page_name, itemName: row.item_name ?? row.page_name, ids: row.item_id ?? [] }
    })
    return { rows, record }
  }

  /** Every `infobox_item` row, paged the same way as `itemIdPages`. */
  async itemNamePages(
    onPage: (rows: ItemNameRow[], record: RequestRecord, offset: number) => Promise<void>
  ): Promise<number> {
    let offset = 0
    for (;;) {
      const { rows, record } = await this.itemNamePage(offset)
      await onPage(rows, record, offset)
      if (rows.length < ITEM_NAME_PAGE_SIZE) return offset + rows.length
      offset += ITEM_NAME_PAGE_SIZE
    }
  }

  /** Bucket names currently defined on the wiki. */
  async listBuckets(): Promise<{ names: string[]; record: RequestRecord }> {
    const record = await this.request({
      action: 'query',
      list: 'allpages',
      apnamespace: String(BUCKET_NAMESPACE),
      aplimit: '500',
    })
    const parsed = z
      .object({
        query: z.object({ allpages: z.array(z.object({ title: z.string() }).passthrough()) }),
      })
      .parse(record.body)
    return { names: parsed.query.allpages.map((page) => page.title), record }
  }
}
