/**
 * A static file server that mimics GitHub Pages, so the Playwright suite
 * exercises the two failures PROJECT_PLAN.md section 9 names as the ones that
 * will bite — base path and SPA routing — the way the real host produces them.
 *
 * `vite preview` is deliberately NOT used for this. It has an SPA history
 * fallback built in, so every unknown path silently resolves to index.html and
 * a deep link "works" in preview even when `dist/404.html` is missing or the
 * router's basename is wrong. That would make the test agree with a broken
 * deploy. GitHub Pages has no such fallback: it serves the repo's `404.html`
 * with an HTTP 404 status, and the SPA only recovers because
 * scripts/copy-404.mjs made that file a copy of index.html.
 *
 * The rules implemented, all of them observable GitHub Pages behaviour:
 *
 *  1. Everything is served under a base prefix (a project site's subpath).
 *  2. An exact file match under that prefix is served as-is.
 *  3. The prefix root serves index.html.
 *  4. Any other path under the prefix serves 404.html with status 404 —
 *     which is what hands control back to the router.
 *  5. A path OUTSIDE the prefix is a plain 404 with no app on it. On the real
 *     host that path belongs to a different site entirely, so an app-internal
 *     link that forgets BASE_URL lands somewhere the app does not exist. That
 *     is a bug this server is built to make visible rather than absorb.
 *
 * Usage: node e2e/gh-pages-server.mjs [--base /prefix/] [--port 4178] [--dir dist]
 */
import { createServer } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function arg(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback)
}

const base = arg('base', '/osrs-loot-simulator/')
const port = Number(arg('port', '4178'))
const root = resolve(here, '..', arg('dir', 'dist'))

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

async function fileAt(path) {
  // `normalize` collapses any ../ before the prefix check below, so a
  // traversal attempt resolves outside `root` and fails the startsWith test.
  const full = normalize(join(root, path))
  if (!full.startsWith(root)) return null
  try {
    const stats = await stat(full)
    return stats.isFile() ? full : null
  } catch {
    return null
  }
}

function send(response, status, file) {
  response.writeHead(status, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  createReadStream(file).pipe(response)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`)
  const pathname = decodeURIComponent(url.pathname)

  // Rule 5: outside the base prefix, this site does not exist.
  if (!pathname.startsWith(base)) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(`404: ${pathname} is outside the base path ${base}\n`)
    return
  }

  const relative = pathname.slice(base.length)

  // Rules 2 and 3.
  const direct = await fileAt(relative === '' ? 'index.html' : relative)
  if (direct !== null) {
    send(response, 200, direct)
    return
  }

  // Rule 4: GitHub Pages' own 404 document, at a 404 status. The SPA only
  // survives this because copy-404.mjs made it a copy of index.html.
  const notFound = await fileAt('404.html')
  if (notFound !== null) {
    send(response, 404, notFound)
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
  response.end('404: no 404.html in the build\n')
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`gh-pages mimic serving ${root} at http://127.0.0.1:${port}${base}\n`)
})
