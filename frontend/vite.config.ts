import { defineConfig, type Plugin, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { promisify } from 'node:util'

type Next = (err?: unknown) => void
const execFileAsync = promisify(execFile)

const triageCachePlugin = (): Plugin => ({
  name: 'triage-cache',
  configureServer(server: ViteDevServer) {
    const projectRoot = path.resolve('..')
    const cacheRoot = path.join(projectRoot, '.triage', 'cache')

    server.middlewares.use('/api/repos', async (req: IncomingMessage, res: ServerResponse, next: Next) => {
      try {
        const sub = req.url?.replace(/^\//, '') || ''

        if (req.method === 'GET' && (!sub || sub === 'repos')) {
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

        const slug = safeSlug(sub.split('/')[0])
        const parts = sub.split('/').filter(Boolean)
        const file = path.join(cacheRoot, slug, 'prs.json')
        if (!fs.existsSync(file)) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'not found' }))
          return
        }

        if (req.method === 'POST' && parts[1] === 'ai') {
          const payload = JSON.parse(fs.readFileSync(file, 'utf-8'))
          const body = await readRequestJson(req)
          const result = await runAiAction(projectRoot, payload.repo, body).catch((error: unknown) => {
            res.statusCode = 500
            return { ok: false, error: error instanceof Error ? error.message : String(error) }
          })
          const refreshed = JSON.parse(fs.readFileSync(file, 'utf-8'))
          refreshed.ai = readAiCache(path.join(cacheRoot, slug))
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ...result, data: refreshed, ai: refreshed.ai }))
          return
        }

        if (req.method !== 'GET') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'method not allowed' }))
          return
        }

        const payload = JSON.parse(fs.readFileSync(file, 'utf-8'))
        payload.ai = readAiCache(path.join(cacheRoot, slug))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(payload))
      } catch (err) {
        next(err)
      }
    })
  },
})

async function runAiAction(projectRoot: string, repo: string, body: Record<string, unknown>) {
  const action = String(body.action ?? '')
  const python = fs.existsSync(path.join(projectRoot, '.venv', 'Scripts', 'python.exe'))
    ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
    : 'python'
  const args = ['triage.py']

  if (action === 'align' || action === 'explain') {
    const pr = positiveInt(body.pr, 'pr')
    args.push(action, repo, String(pr), '--refresh-ai')
  } else if (action === 'compare') {
    const left = positiveInt(body.left, 'left')
    const right = positiveInt(body.right, 'right')
    args.push('compare', repo, String(left), String(right), '--refresh-ai')
  } else if (action === 'recommend') {
    const limit = Math.min(10, positiveInt(body.limit ?? 5, 'limit'))
    args.push('recommend', repo, '--limit', String(limit), '--refresh-ai')
  } else {
    throw new Error('unsupported AI action')
  }

  const { stdout, stderr } = await execFileAsync(python, args, {
    cwd: projectRoot,
    timeout: 240000,
    maxBuffer: 1024 * 1024 * 4,
  })
  return { ok: true, stdout, stderr }
}

function positiveInt(value: unknown, name: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function readRequestJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf-8')
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 8192) reject(new Error('request body too large'))
    })
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function safeSlug(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '')
}

function readAiCache(repoDir: string) {
  const aiRoot = path.join(repoDir, 'ai')
  const empty = { alignment: {}, explain: {}, recommendations: [], compare: [] }
  if (!fs.existsSync(aiRoot)) return empty

  return {
    alignment: indexByPr(readJsonFiles(path.join(aiRoot, 'alignment'))),
    explain: indexByPr(readJsonFiles(path.join(aiRoot, 'codex_explain'))),
    recommendations: readJsonFiles(path.join(aiRoot, 'codex_recommend')).sort(sortByCachedAt),
    compare: readJsonFiles(path.join(aiRoot, 'codex_compare')).sort(sortByCachedAt),
  }
}

function readJsonFiles(dir: string) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(dir, name))
    .map((file) => {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf-8'))
      } catch {
        return null
      }
    })
    .filter((value): value is Record<string, unknown> => Boolean(value))
}

function indexByPr(items: Array<Record<string, unknown>>) {
  return Object.fromEntries(
    items
      .filter((item) => Number.isFinite(item.pr))
      .sort(sortByCachedAt)
      .map((item) => [String(item.pr), item]),
  )
}

function sortByCachedAt(left: Record<string, unknown>, right: Record<string, unknown>) {
  return String(right._cachedAt ?? '').localeCompare(String(left._cachedAt ?? ''))
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), triageCachePlugin()],
  server: {
    port: 5173,
  },
})
