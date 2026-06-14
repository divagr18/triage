import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

type Next = (err?: unknown) => void

const triageCachePlugin = (): Plugin => ({
  name: 'triage-cache',
  configureServer(server: ViteDevServer) {
    const cacheRoot = path.resolve('..', '.triage', 'cache')

    server.middlewares.use('/api/repos', async (req: IncomingMessage, res: ServerResponse, next: Next) => {
      try {
        const sub = req.url?.replace(/^\//, '') || ''

        if (!sub || sub === 'repos') {
          const entries = fs.readdirSync(cacheRoot, { withFileTypes: true })
          const repos = entries
            .filter((e) => e.isDirectory())
            .map((e) => {
              const slug = e.name
              const file = path.join(cacheRoot, slug, 'prs.json')
              const repo = slug.replace(/_/g, '/')
              return { slug, repo, exists: fs.existsSync(file) }
            })
            .filter((r) => r.exists)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(repos))
          return
        }

        const slug = sub.split('/')[0]
        const file = path.join(cacheRoot, slug, 'prs.json')
        if (!fs.existsSync(file)) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'not found' }))
          return
        }
        res.setHeader('Content-Type', 'application/json')
        res.end(fs.readFileSync(file, 'utf-8'))
      } catch (err) {
        next(err)
      }
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), triageCachePlugin()],
  server: {
    port: 5173,
  },
})
