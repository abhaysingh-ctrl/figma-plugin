import type { VercelRequest, VercelResponse } from '@vercel/node'
import { DeadlineBudget } from '../lib/budget'
import { crawlSite } from '../lib/crawler'
import { discoverViaSitemap } from '../lib/sitemap'
import { DEFAULT_MAX_PAGES, HARD_MAX_PAGES, type SitemapResult } from '../lib/tree'

export const config = { maxDuration: 120 }

const TIME_BUDGET_MS = 90_000
const DEFAULT_MAX_DEPTH = 3
const HARD_MAX_DEPTH = 6

function setCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-sitemap-secret')
}

interface RequestBody {
  url?: unknown
  maxDepth?: unknown
  maxPages?: unknown
}

function clamp(value: unknown, fallback: number, hardMax: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.round(value), hardMax)
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const expectedSecret = process.env.SITEMAP_SHARED_SECRET
  if (expectedSecret && req.headers['x-sitemap-secret'] !== expectedSecret) {
    res.status(401).json({ error: 'Invalid or missing sitemap secret' })
    return
  }

  const body = req.body as RequestBody | undefined
  const rawUrl = body?.url
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    res.status(400).json({ error: 'Request body must include a website url' })
    return
  }

  let rootUrl: string
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported protocol')
    rootUrl = parsed.toString()
  } catch {
    res.status(400).json({ error: 'That does not look like a valid http(s) url' })
    return
  }

  const maxPages = clamp(body?.maxPages, DEFAULT_MAX_PAGES, HARD_MAX_PAGES)
  const maxDepth = clamp(body?.maxDepth, DEFAULT_MAX_DEPTH, HARD_MAX_DEPTH)
  const budget = new DeadlineBudget(TIME_BUDGET_MS)

  try {
    const sitemapResult = await discoverViaSitemap(rootUrl, budget, maxPages)
    if (sitemapResult && sitemapResult.nodes.length > 0) {
      respond(res, {
        rootUrl,
        source: 'sitemap',
        generatedAt: new Date().toISOString(),
        totalPages: sitemapResult.nodes.length,
        truncated: sitemapResult.truncated,
        nodes: sitemapResult.nodes,
        warnings: sitemapResult.warnings,
      })
      return
    }

    const crawlResult = await crawlSite(rootUrl, { maxDepth, maxPages }, budget)
    if (crawlResult.nodes.length === 0) {
      res.status(502).json({ error: crawlResult.warnings[0] ?? 'Could not discover any pages for this site' })
      return
    }

    respond(res, {
      rootUrl,
      source: 'crawl',
      generatedAt: new Date().toISOString(),
      totalPages: crawlResult.nodes.length,
      truncated: crawlResult.truncated,
      nodes: crawlResult.nodes,
      warnings: crawlResult.warnings,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(502).json({ error: message })
  }
}

function respond(res: VercelResponse, result: SitemapResult): void {
  res.status(200).json(result)
}
