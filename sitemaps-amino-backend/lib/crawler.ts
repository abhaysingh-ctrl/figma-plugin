import * as cheerio from 'cheerio'
import robotsParser from 'robots-parser'
import { DeadlineBudget } from './budget'
import { buildTreeFromCrawl, canonicalizeUrl, isSameOrigin, type CrawledPage, type SitemapNode } from './tree'

const FETCH_TIMEOUT_MS = 8000
const CONCURRENCY = 5
const USER_AGENT = 'SitemapsAminoBot/1.0'

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT } })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchRobots(origin: string): Promise<ReturnType<typeof robotsParser> | null> {
  const robotsUrl = origin + '/robots.txt'
  try {
    const res = await fetchWithTimeout(robotsUrl, 5000)
    if (!res.ok) return null
    return robotsParser(robotsUrl, await res.text())
  } catch {
    return null
  }
}

interface QueueItem {
  url: string
  parentUrl: string | null
  depth: number
}

export interface CrawlOptions {
  maxDepth: number
  maxPages: number
}

export interface CrawlResult {
  nodes: SitemapNode[]
  truncated: boolean
  warnings: string[]
}

/** BFS crawl from the homepage, same-origin only, used when no sitemap.xml is available. */
export async function crawlSite(rootUrl: string, options: CrawlOptions, budget: DeadlineBudget): Promise<CrawlResult> {
  const origin = new URL(rootUrl).origin
  const warnings: string[] = []
  const robots = await fetchRobots(origin)

  const canonicalRoot = canonicalizeUrl(rootUrl, origin) ?? rootUrl
  const visited = new Set<string>([canonicalRoot])
  const pages: CrawledPage[] = []
  let truncated = false

  let currentLevel: QueueItem[] = [{ url: canonicalRoot, parentUrl: null, depth: 0 }]

  while (currentLevel.length > 0 && pages.length < options.maxPages) {
    if (budget.isExpired()) {
      truncated = true
      warnings.push('Crawl stopped early: time budget exceeded')
      break
    }

    const nextLevel: QueueItem[] = []

    for (let i = 0; i < currentLevel.length; i += CONCURRENCY) {
      if (pages.length >= options.maxPages || budget.isExpired()) {
        truncated = true
        break
      }

      const batch = currentLevel.slice(i, i + CONCURRENCY)
      const fetched = await Promise.all(
        batch.map(async (item) => {
          if (robots && !robots.isAllowed(item.url, USER_AGENT)) return null
          try {
            const res = await fetchWithTimeout(item.url, FETCH_TIMEOUT_MS)
            if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null
            return { item, html: await res.text() }
          } catch {
            return null
          }
        }),
      )

      for (const result of fetched) {
        if (!result || pages.length >= options.maxPages) continue
        const { item, html } = result
        const $ = cheerio.load(html)
        const title = $('title').first().text().trim() || item.url
        pages.push({ url: item.url, title, parentUrl: item.parentUrl, depth: item.depth })

        if (item.depth >= options.maxDepth) continue

        $('a[href]').each((_i, el) => {
          const href = $(el).attr('href')
          if (!href) return
          const canonical = canonicalizeUrl(href, item.url)
          if (!canonical || !isSameOrigin(canonical, origin) || visited.has(canonical)) return
          visited.add(canonical)
          nextLevel.push({ url: canonical, parentUrl: item.url, depth: item.depth + 1 })
        })
      }
    }

    currentLevel = nextLevel
  }

  if (currentLevel.length > 0 && pages.length >= options.maxPages) truncated = true

  if (pages.length === 0) {
    return { nodes: [], truncated: false, warnings: ['Could not reach or parse the homepage'] }
  }

  const { nodes, truncated: capTruncated } = buildTreeFromCrawl(pages, options.maxPages)
  return { nodes, truncated: truncated || capTruncated, warnings }
}
