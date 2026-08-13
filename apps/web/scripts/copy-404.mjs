// GitHub Pages has no server, so a client-side route (e.g. /boss/vorkath)
// 404s on a hard refresh or direct link — GitHub serves 404.html for any
// unknown path, so making that file identical to index.html hands control
// back to the SPA router, which then reads the URL and renders the right
// page. PROJECT_PLAN.md 9 names this as one of the two silent Pages
// failures (the other is the base path, handled in vite.config.ts).
import { copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = join(here, '..', 'dist')

await copyFile(join(distDir, 'index.html'), join(distDir, '404.html'))
process.stdout.write('Copied dist/index.html -> dist/404.html\n')
