// Shared data contract + hierarchy-building for both discovery paths
// (sitemap.xml, a flat URL list with no parent info; and crawling, which
// gives an explicit parent per page via BFS).

export interface SitemapNode {
  id: string
  url: string
  path: string
  title: string
  depth: number
  parentId: string | null
  /** True for structural placeholder nodes: a missing intermediate path segment, or a "+N more" sibling. */
  synthetic: boolean
}

export interface SitemapResult {
  rootUrl: string
  source: 'sitemap' | 'crawl'
  generatedAt: string
  totalPages: number
  truncated: boolean
  nodes: SitemapNode[]
  warnings: string[]
}

export const DEFAULT_MAX_PAGES = 300
export const HARD_MAX_PAGES = 500
export const MAX_CHILDREN_PER_PARENT = 30

/**
 * Normalizes a URL for dedup: lowercase host, strip default port/hash, drop
 * every query string (site *structure*, not query permutations). Returns
 * null for non-http(s) links.
 */
export function canonicalizeUrl(raw: string, base: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw, base)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  parsed.hostname = parsed.hostname.toLowerCase()
  if ((parsed.protocol === 'http:' && parsed.port === '80') || (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = ''
  }
  parsed.hash = ''
  parsed.search = ''

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1)
  }

  return parsed.toString()
}

export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).host === new URL(origin).host
  } catch {
    return false
  }
}

/** "/about-us" -> "About Us", "/blog/my-post.html" -> "My Post". */
export function humanizeSegment(segment: string): string {
  let decoded = segment
  try {
    decoded = decodeURIComponent(segment)
  } catch {
    // malformed escape sequence — fall back to the raw segment
  }
  const withoutExtension = decoded.replace(/\.\w{2,5}$/, '')
  const spaced = withoutExtension.replace(/[-_]+/g, ' ').trim()
  if (!spaced) return 'Home'
  return spaced.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1))
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return '/'
  }
}

interface TrieNode {
  segment: string
  url: string | null
  children: Map<string, TrieNode>
}

interface BuildResult {
  nodes: SitemapNode[]
  truncated: boolean
}

/** Builds a hierarchy from a flat, unordered URL list (sitemap.xml) by trie-ing path segments. */
export function buildTreeFromUrlList(rootUrl: string, urls: string[], maxNodes: number): BuildResult {
  const root: TrieNode = { segment: '', url: rootUrl, children: new Map() }

  for (const url of urls) {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      continue
    }
    const segments = parsed.pathname.split('/').filter(Boolean)
    let node = root
    for (const segment of segments) {
      let child = node.children.get(segment)
      if (!child) {
        child = { segment, url: null, children: new Map() }
        node.children.set(segment, child)
      }
      node = child
    }
    node.url = url
  }

  const nodes: SitemapNode[] = []
  let truncated = false
  let idCounter = 0
  const nextId = (): string => 'n' + idCounter++

  function walk(trieNode: TrieNode, parentId: string | null, depth: number, path: string): void {
    if (nodes.length >= maxNodes) {
      truncated = true
      return
    }
    const id = nextId()
    nodes.push({
      id,
      url: trieNode.url ?? rootUrl.replace(/\/$/, '') + path,
      path,
      title: depth === 0 ? 'Home' : humanizeSegment(trieNode.segment),
      depth,
      parentId,
      synthetic: trieNode.url === null,
    })

    const entries = [...trieNode.children.entries()]
    const overflow = entries.length - MAX_CHILDREN_PER_PARENT
    const kept = overflow > 0 ? entries.slice(0, MAX_CHILDREN_PER_PARENT) : entries
    if (overflow > 0) truncated = true

    for (const [segment, child] of kept) {
      if (nodes.length >= maxNodes) {
        truncated = true
        break
      }
      const childPath = path === '/' ? '/' + segment : path + '/' + segment
      walk(child, id, depth + 1, childPath)
    }

    if (overflow > 0 && nodes.length < maxNodes) {
      nodes.push({
        id: nextId(),
        url: '',
        path: path + '/…',
        title: '+' + overflow + ' more',
        depth: depth + 1,
        parentId: id,
        synthetic: true,
      })
    }
  }

  walk(root, null, 0, '/')
  return { nodes, truncated }
}

export interface CrawledPage {
  url: string
  title: string
  parentUrl: string | null
  depth: number
}

/** Builds a hierarchy from BFS-crawled pages, which already carry an explicit parent (first-seen wins). */
export function buildTreeFromCrawl(pages: CrawledPage[], maxNodes: number): BuildResult {
  const nodes: SitemapNode[] = []
  let truncated = false
  let idCounter = 0
  const nextId = (): string => 'n' + idCounter++

  const childrenByParent = new Map<string | null, CrawledPage[]>()
  for (const page of pages) {
    const list = childrenByParent.get(page.parentUrl) ?? []
    list.push(page)
    childrenByParent.set(page.parentUrl, list)
  }

  function walk(page: CrawledPage, parentId: string | null): void {
    if (nodes.length >= maxNodes) {
      truncated = true
      return
    }
    const id = nextId()
    nodes.push({
      id,
      url: page.url,
      path: pathOf(page.url),
      title: page.title || pathOf(page.url),
      depth: page.depth,
      parentId,
      synthetic: false,
    })

    const children = childrenByParent.get(page.url) ?? []
    const overflow = children.length - MAX_CHILDREN_PER_PARENT
    const kept = overflow > 0 ? children.slice(0, MAX_CHILDREN_PER_PARENT) : children
    if (overflow > 0) truncated = true

    for (const child of kept) {
      if (nodes.length >= maxNodes) {
        truncated = true
        break
      }
      walk(child, id)
    }

    if (overflow > 0 && nodes.length < maxNodes) {
      nodes.push({
        id: nextId(),
        url: '',
        path: pathOf(page.url) + '/…',
        title: '+' + overflow + ' more',
        depth: page.depth + 1,
        parentId: id,
        synthetic: true,
      })
    }
  }

  const rootPage = pages.find((p) => p.parentUrl === null)
  if (rootPage) walk(rootPage, null)

  return { nodes, truncated }
}
