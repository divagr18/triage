import { useCallback, useEffect, useState } from 'react'
import type { AiCache, RepoMeta, TriageCache } from './types'

export function useRepos() {
  const [repos, setRepos] = useState<RepoMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/repos')
      .then((r) => r.json())
      .then((data) => setRepos(data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return { repos, loading, error }
}

export function useRepoData(slug: string | null) {
  const [data, setData] = useState<TriageCache | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!slug) {
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/repos/${slug}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const nextData = await response.json()
      setData(nextData)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    let cancelled = false
    if (!slug) return

    async function loadRepo() {
      await refresh()
      if (cancelled) return
    }

    void loadRepo()
    return () => {
      cancelled = true
    }
  }, [refresh, slug])

  const runAiAction = useCallback(
    async (body: AiActionRequest) => {
      if (!slug) return
      const response = await fetch(`/api/repos/${slug}/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok || result.error) {
        throw new Error(result.error || `HTTP ${response.status}`)
      }
      if (result.data) {
        setData(result.data as TriageCache)
      } else {
        setData((current) => (current ? { ...current, ai: result.ai as AiCache } : current))
      }
      return result
    },
    [slug],
  )

  return { data: slug ? data : null, loading, error, refresh, runAiAction }
}

export type AiActionRequest =
  | { action: 'align'; pr: number }
  | { action: 'explain'; pr: number }
  | { action: 'changelets'; pr: number }
  | { action: 'classify'; pr: number }
  | { action: 'compare'; left: number; right: number }
  | { action: 'recommend'; limit?: number }
