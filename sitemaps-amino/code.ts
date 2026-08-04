// Sitemaps Amino — draws a visual sitemap (tree diagram) on the Figma
// canvas from a website URL, via the sitemaps-amino-backend/ service (see
// that plugin's README for why a backend is needed at all: plugin UI
// iframes can only fetch domains listed in networkAccess.allowedDomains,
// so arbitrary website discovery has to happen server-side).

const UI_WIDTH = 380
const UI_INITIAL_HEIGHT = 340
const UI_MIN_HEIGHT = 220
const UI_MAX_HEIGHT = 640

// Must match manifest.json's networkAccess.allowedDomains and the deployed
// sitemaps-amino-backend/ domain. Update all three together after deploying.
// const BACKEND_URL = 'https://sitemaps-amino-backend.vercel.app/api/generate'
const BACKEND_URL = 'http://localhost:3300/api/generate'

const BOX_WIDTH = 200
const BOX_HEIGHT = 64
const H_GAP = 40
const V_GAP = 120
const CONTAINER_PADDING = 40

// ─── data contract (mirrors sitemaps-amino-backend/lib/tree.ts) ───

interface SitemapNode {
  id: string
  url: string
  path: string
  title: string
  depth: number
  parentId: string | null
  synthetic: boolean
}

interface SitemapResult {
  rootUrl: string
  source: 'sitemap' | 'crawl'
  generatedAt: string
  totalPages: number
  truncated: boolean
  nodes: SitemapNode[]
  warnings: string[]
}

// ─── messages from ui.html ───

type IncomingMessage =
  | { type: 'resize'; height: number }
  | { type: 'ready' }
  | { type: 'draw-sitemap'; data: SitemapResult }

// ─── layout: simplified tidy-tree, top-down, root at the top ───

interface Position {
  x: number
  y: number
}

function buildChildrenIndex(nodes: SitemapNode[]): { childrenOf: Map<string, string[]>; rootId: string | null } {
  const childrenOf = new Map<string, string[]>()
  let rootId: string | null = null
  for (const node of nodes) {
    if (node.parentId === null) {
      rootId = node.id
      continue
    }
    const list = childrenOf.get(node.parentId) ?? []
    list.push(node.id)
    childrenOf.set(node.parentId, list)
  }
  return { childrenOf, rootId }
}

function computeLayout(nodes: SitemapNode[]): Map<string, Position> {
  const { childrenOf, rootId } = buildChildrenIndex(nodes)
  if (!rootId) throw new Error('Sitemap result has no root node')

  const widthCache = new Map<string, number>()
  function subtreeWidth(id: string): number {
    const cached = widthCache.get(id)
    if (cached !== undefined) return cached
    const children = childrenOf.get(id) ?? []
    const width =
      children.length === 0
        ? BOX_WIDTH
        : Math.max(
          BOX_WIDTH,
          children.reduce((sum, childId) => sum + subtreeWidth(childId), 0) + (children.length - 1) * H_GAP,
        )
    widthCache.set(id, width)
    return width
  }

  const positions = new Map<string, Position>()
  function assignPositions(id: string, xStart: number, depth: number): void {
    const width = subtreeWidth(id)
    positions.set(id, { x: xStart + width / 2, y: depth * (BOX_HEIGHT + V_GAP) })
    let cursor = xStart
    for (const childId of childrenOf.get(id) ?? []) {
      assignPositions(childId, cursor, depth + 1)
      cursor += subtreeWidth(childId) + H_GAP
    }
  }
  assignPositions(rootId, 0, 0)

  return positions
}

// ─── node creation ───

/** The plugin sandbox has no DOM `URL` global, so parse the hostname by hand. */
function hostnameOf(url: string): string {
  const match = url.match(/^[a-z]+:\/\/([^/]+)/i)
  return match ? match[1] : url
}

function styleTextLine(text: TextNode, fontSize: number, color: RGB): void {
  text.fontSize = fontSize
  text.fills = [{ type: 'SOLID', color }]
  text.layoutSizingHorizontal = 'FILL'
  text.textAutoResize = 'HEIGHT'
  text.maxLines = 1
  text.textTruncation = 'ENDING'
}

function createPageBox(node: SitemapNode): FrameNode {
  const frame = figma.createFrame()
  frame.name = node.title
  frame.resize(BOX_WIDTH, BOX_HEIGHT)
  frame.layoutMode = 'VERTICAL'
  frame.primaryAxisSizingMode = 'FIXED'
  frame.counterAxisSizingMode = 'FIXED'
  frame.primaryAxisAlignItems = 'CENTER'
  frame.paddingLeft = 10
  frame.paddingRight = 10
  frame.paddingTop = 8
  frame.paddingBottom = 8
  frame.itemSpacing = 2
  frame.cornerRadius = 8
  frame.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  frame.strokeWeight = 1
  frame.strokes = node.synthetic
    ? [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6 } }]
    : [{ type: 'SOLID', color: { r: 0.85, g: 0.85, b: 0.85 } }]
  if (node.synthetic) frame.dashPattern = [4, 4]

  const title = figma.createText()
  title.fontName = { family: 'Inter', style: 'Bold' }
  title.characters = node.title
  styleTextLine(title, 12, { r: 0.12, g: 0.12, b: 0.12 })
  frame.appendChild(title)

  if (!node.synthetic) {
    const path = figma.createText()
    path.fontName = { family: 'Inter', style: 'Regular' }
    path.characters = node.path
    styleTextLine(path, 10, { r: 0.5, g: 0.5, b: 0.5 })
    frame.appendChild(path)
  }

  return frame
}

function createConnector(from: Position, to: Position): LineNode {
  const line = figma.createLine()
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy)
  const centerX = (from.x + to.x) / 2
  const centerY = (from.y + to.y) / 2

  line.resize(length, 0)
  // Figma rotates about the node's center and recomputes x/y as the rotated
  // bounding box's top-left, so position the *unrotated* line centered on
  // the midpoint first, and set rotation last — don't touch x/y after this.
  line.x = centerX - length / 2
  line.y = centerY
  line.rotation = (Math.atan2(dy, dx) * 180) / Math.PI
  line.strokes = [{ type: 'SOLID', color: { r: 0.7, g: 0.7, b: 0.7 } }]
  line.strokeWeight = 1.5
  return line
}

async function drawSitemap(result: SitemapResult): Promise<void> {
  if (result.nodes.length === 0) throw new Error('The sitemap has no pages to draw')

  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })

  const positions = computeLayout(result.nodes)

  const container = figma.createFrame()
  container.name = 'Sitemap: ' + hostnameOf(result.rootUrl)
  container.fills = [{ type: 'SOLID', color: { r: 0.97, g: 0.97, b: 0.98 } }]

  for (const node of result.nodes) {
    const pos = positions.get(node.id)
    if (!pos) continue
    const box = createPageBox(node)
    box.x = pos.x - BOX_WIDTH / 2
    box.y = pos.y
    container.appendChild(box)
  }

  for (const node of result.nodes) {
    if (node.parentId === null) continue
    const parentPos = positions.get(node.parentId)
    const childPos = positions.get(node.id)
    if (!parentPos || !childPos) continue
    const line = createConnector({ x: parentPos.x, y: parentPos.y + BOX_HEIGHT }, { x: childPos.x, y: childPos.y })
    container.appendChild(line)
  }
  const bounds = container.children.reduce(
    (acc, child) => ({
      minX: Math.min(acc.minX, child.x),
      minY: Math.min(acc.minY, child.y),
      maxX: Math.max(acc.maxX, child.x + child.width),
      maxY: Math.max(acc.maxY, child.y + child.height),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  )
  for (const child of container.children) {
    child.x -= bounds.minX - CONTAINER_PADDING
    child.y -= bounds.minY - CONTAINER_PADDING
  }
  container.resize(bounds.maxX - bounds.minX + CONTAINER_PADDING * 2, bounds.maxY - bounds.minY + CONTAINER_PADDING * 2)

  const origin = figma.viewport.center
  container.x = origin.x
  container.y = origin.y

  figma.currentPage.appendChild(container)
  figma.viewport.scrollAndZoomIntoView([container])
}

// ─── UI wiring ───

figma.showUI(__uiFiles__['ui'], {
  width: UI_WIDTH,
  height: UI_INITIAL_HEIGHT,
  title: 'Sitemaps Amino',
})

figma.ui.onmessage = (msg: IncomingMessage) => {
  if (msg.type === 'resize') {
    figma.ui.resize(UI_WIDTH, Math.max(UI_MIN_HEIGHT, Math.min(UI_MAX_HEIGHT, Math.round(msg.height))))
    return
  }

  if (msg.type === 'ready') {
    figma.ui.postMessage({ type: 'init', backendUrl: BACKEND_URL })
    return
  }

  if (msg.type === 'draw-sitemap') {
    drawSitemap(msg.data)
      .then(() => {
        figma.notify('Sitemap drawn — ' + msg.data.totalPages + ' pages', { timeout: 2500 })
        figma.ui.postMessage({ type: 'draw-success' })
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to draw the sitemap'
        figma.notify(message, { error: true, timeout: 5000 })
        figma.ui.postMessage({ type: 'draw-error', message })
      })
  }
}
