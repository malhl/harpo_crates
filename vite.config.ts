import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import type { Plugin } from 'vite'

/** Dev-only plugin: POST /api/debug-log appends JSON lines to debug.log.
 *  Clears the log file each time the dev server starts. */
function debugLogPlugin(): Plugin {
  return {
    name: 'debug-log',
    buildStart() {
      // Purge debug log at the start of every build (dev or production)
      try { fs.writeFileSync('debug.log', '') } catch {}
    },
    configureServer(server) {
      server.middlewares.use('/api/debug-log', (req, res) => {
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: string) => body += chunk)
          req.on('end', () => {
            fs.appendFileSync('debug.log', body + '\n')
            res.statusCode = 200
            res.end('ok')
          })
        } else {
          res.statusCode = 405
          res.end()
        }
      })
    },
  }
}

export default defineConfig({
  base: '/harpo_crates/',
  plugins: [react(), tailwindcss(), debugLogPlugin()],
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })),
  },
})
