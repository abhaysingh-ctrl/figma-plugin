// Fetches Figma frame data via the REST API — the server-side equivalent of
// the get_metadata / get_design_context Figma MCP tools the ux-design-audit
// skill normally uses inside Claude Code, which aren't reachable from a
// plain backend. Variables API (get_variable_defs) is Enterprise-plan only
// and isn't needed here: the skill's "Every component" check only needs
// componentId/componentSetId references, available on every plan.

export interface FigmaFrameData {
  fileKey: string
  nodeId: string
  nodeJson: unknown
  screenshotBase64: string
  components: unknown
}

const FIGMA_API = 'https://api.figma.com/v1'

/**
 * Figma frame URLs look like:
 *   https://www.figma.com/design/<fileKey>/<name>?node-id=<id-with-hyphens>
 * The REST API wants the node id with a colon, not a hyphen.
 */
export function parseFigmaUrl(url: string): { fileKey: string; nodeId: string } {
  const parsed = new URL(url)
  const match = parsed.pathname.match(/\/(?:file|design)\/([a-zA-Z0-9]+)/)
  if (!match) {
    throw new Error('Could not find a file key in this URL')
  }
  const nodeIdRaw = parsed.searchParams.get('node-id')
  if (!nodeIdRaw) {
    throw new Error('URL is missing a node-id — select a single frame and rebuild the link')
  }
  return { fileKey: match[1], nodeId: nodeIdRaw.replace('-', ':') }
}

function figmaHeaders(): Record<string, string> {
  const token = process.env.FIGMA_TOKEN
  if (!token) {
    throw new Error('FIGMA_TOKEN is not configured on the server')
  }
  return { 'X-Figma-Token': token }
}

async function figmaGet(path: string): Promise<any> {
  const res = await fetch(`${FIGMA_API}${path}`, { headers: figmaHeaders() })
  if (!res.ok) {
    throw new Error(`Figma API error ${res.status}: ${await res.text()}`)
  }
  return res.json()
}

const STRIPPED_KEYS = new Set([
  'fillGeometry',
  'strokeGeometry',
  'vectorPaths',
  'absoluteRenderBounds',
  'pluginData',
  'sharedPluginData',
  'exportSettings',
])

/** Drops large/irrelevant fields (raw geometry, plugin data) before this goes into a prompt. */
function pruneNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(pruneNode)
  }
  if (!node || typeof node !== 'object') {
    return node
  }
  const pruned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (STRIPPED_KEYS.has(key)) continue
    pruned[key] = pruneNode(value)
  }
  return pruned
}

export async function fetchFrameData(fileKey: string, nodeId: string): Promise<FigmaFrameData> {
  const nodesRes = await figmaGet(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`)
  const nodeEntry = nodesRes.nodes?.[nodeId]
  if (!nodeEntry?.document) {
    throw new Error(`Figma returned no data for node ${nodeId} — check the frame still exists`)
  }
  const nodeJson = pruneNode(nodeEntry.document)

  const imagesRes = await figmaGet(
    `/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=2`,
  )
  const imageUrl = imagesRes.images?.[nodeId]
  if (!imageUrl) {
    throw new Error('Figma did not return a screenshot for this node')
  }
  const imageRes = await fetch(imageUrl)
  if (!imageRes.ok) {
    throw new Error(`Failed to download the rendered screenshot: ${imageRes.status}`)
  }
  const screenshotBase64 = Buffer.from(await imageRes.arrayBuffer()).toString('base64')

  // Component metadata is used to tell a real reusable instance from a
  // one-off (dimension 4 of the audit). Non-fatal if unavailable.
  let components: unknown = null
  try {
    const componentsRes = await figmaGet(`/files/${fileKey}/components`)
    components = componentsRes.meta?.components ?? null
  } catch {
    components = null
  }

  return { fileKey, nodeId, nodeJson, screenshotBase64, components }
}
