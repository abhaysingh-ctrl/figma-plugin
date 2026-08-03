import { XMLParser } from 'fast-xml-parser'
import { DeadlineBudget } from './budget'
import { buildTreeFromUrlList, canonicalizeUrl, isSameOrigin, type SitemapNode } from './tree'

const FETCH_TIMEOUT_MS = 8000
const MAX_CHILD_SITEMAPS = 50
const MAX_SITEMAP_INDEX_DEPTH = 3
const USER_AGENT = 'SitemapsAminoBot/1.0'
// Sitemap entries are cheap to collect (no per-page fetch), so gather more
// than maxNodes up front — buildTreeFromUrlList applies the real node cap.
const HARD_URL_COLLECTION_CAP = 2000

const xmlParser = new XMLParser({ ignoreAttributes: true })

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT } })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchRobotsSitemaps(origin: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(origin + '/robots.txt', 5000)
    if (!res.ok) return []
    const text = await res.text()
    const sitemaps: string[] = []
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*sitemap\s*:\s*(\S+)/i)
      if (match) sitemaps.push(match[1])
    }
    return sitemaps
  } catch {
    return []
  }
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** Fetches one sitemap URL and returns the page URLs it (transitively) lists, recursing into sitemap indexes. */
async function fetchAndParseSitemap(
  url: string,
  depth: number,
  budget: DeadlineBudget,
  maxUrls: number,
  warnings: string[],
): Promise<string[]> {
  if (depth > MAX_SITEMAP_INDEX_DEPTH) return []
  if (budget.isExpired()) {
    warnings.push('Time budget exceeded while fetching sitemaps')
    return []
  }

  let res: Response
  try {
    res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS)
  } catch {
    return []
  }
  if (!res.ok) return []

  let parsed: unknown
  try {
    parsed = xmlParser.parse(await res.text())
  } catch {
    return []
  }
  const doc = parsed as {
    sitemapindex?: { sitemap?: { loc?: string } | Array<{ loc?: string }> }
    urlset?: { url?: { loc?: string } | Array<{ loc?: string }> }
  }

  if (doc.sitemapindex) {
    const entries = toArray(doc.sitemapindex.sitemap)
    if (entries.length > MAX_CHILD_SITEMAPS) {
      warnings.push('Sitemap index has more than ' + MAX_CHILD_SITEMAPS + ' child sitemaps; extra ones were skipped')
    }
    const urls: string[] = []
    for (const entry of entries.slice(0, MAX_CHILD_SITEMAPS)) {
      if (budget.isExpired() || urls.length >= maxUrls) break
      if (typeof entry?.loc !== 'string') continue
      urls.push(...(await fetchAndParseSitemap(entry.loc, depth + 1, budget, maxUrls - urls.length, warnings)))
    }
    return urls
  }

  if (doc.urlset) {
    return toArray(doc.urlset.url)
      .map((entry) => entry?.loc)
      .filter((loc): loc is string => typeof loc === 'string')
  }

  return []
}

export interface SitemapDiscoveryResult {
  nodes: SitemapNode[]
  truncated: boolean
  warnings: string[]
}

/** Returns null when no usable sitemap.xml/sitemap index was found, signaling the caller to fall back to crawling. */
export async function discoverViaSitemap(
  rootUrl: string,
  budget: DeadlineBudget,
  maxNodes: number,
): Promise<SitemapDiscoveryResult | null> {
  const origin = new URL(rootUrl).origin
  const warnings: string[] = []

  const candidates = [origin + '/sitemap.xml', origin + '/sitemap_index.xml', ...(await fetchRobotsSitemaps(origin))]
  const seen = new Set<string>()

  let rawUrls: string[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate) || budget.isExpired()) continue
    seen.add(candidate)
    const urls = await fetchAndParseSitemap(candidate, 0, budget, HARD_URL_COLLECTION_CAP, warnings)
    if (urls.length > 0) {
      rawUrls = urls
      break
    }
  }

  if (rawUrls.length === 0) return null

  const canonical = new Set<string>()
  for (const raw of rawUrls) {
    const c = canonicalizeUrl(raw, origin)
    if (c && isSameOrigin(c, origin)) canonical.add(c)
  }
  const canonicalRoot = canonicalizeUrl(rootUrl, origin)
  if (canonicalRoot) canonical.add(canonicalRoot)

  const urls = [...canonical]
  const { nodes, truncated } = buildTreeFromUrlList(rootUrl, urls, maxNodes)
  return { nodes, truncated, warnings }
}
