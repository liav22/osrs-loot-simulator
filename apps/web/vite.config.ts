import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Project sites are served from a subpath — get this wrong and every
// asset 404s on GitHub Pages. See PROJECT_PLAN.md section 9. The app reads
// this back at runtime via `import.meta.env.BASE_URL` to build data fetch
// URLs, so dev and prod resolve the same `public/*.json` files correctly
// without a separate "/data/" prefix.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/osrs-loot-simulator/' : '/',
  plugins: [react(), tailwindcss()],
})
