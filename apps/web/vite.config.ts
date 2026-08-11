import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Project sites are served from a subpath — get this wrong and every
// asset 404s on GitHub Pages. See PROJECT_PLAN.md section 9.
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/osrs-loot-simulator/' : '/',
  plugins: [react()],
})
