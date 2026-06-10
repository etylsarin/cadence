import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { execSync } from 'node:child_process'

let gitHash = process.env.GIT_HASH ? process.env.GIT_HASH.slice(0, 7) : 'dev'
if (gitHash === 'dev') {
  try {
    gitHash = execSync('git rev-parse --short HEAD', { cwd: new URL('..', import.meta.url).pathname }).toString().trim()
  } catch {
    /* not a git checkout — keep 'dev' */
  }
}

// The backend mounts every tool router under its own URL prefix; proxy each so
// dev (Vite :5173) can talk to FastAPI (:8765) without CORS. Mirrors the Vue app.
export default defineConfig({
  define: {
    __GIT_HASH__: JSON.stringify(gitHash),
  },
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api':                'http://localhost:8765',
      '/release-notes/api':  'http://localhost:8765',
      '/sprint-summary/api': 'http://localhost:8765',
      '/sync/api':         'http://localhost:8765',
      '/ask/api':            'http://localhost:8765',
      '/squad-pulse/api':    'http://localhost:8765',
      '/planner/api':        'http://localhost:8765',
    },
  },
})
