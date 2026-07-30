// Amino Helps — Standalone Figma Plugin
// Audits design layers against Amino Design System tokens, styles, and variables.

type Priority = 'critical' | 'warning' | 'info'
type Category = 'Icons' | 'Background' | 'Border' | 'Text & Typography' | 'Radius' | 'Color'
type Issue = {
  node: SceneNode
  issue: string
  category: Category
  priority: Priority
  solution: string
  dsToken: string
}
type ComponentFlag = {
  node: SceneNode
  detail: string
  recommendation: string
}
type ModeInfo = { collectionName: string; modeName: string }
type BrandInfo = { brandName: string; modes: ModeInfo[]; collectionIds: Set<string> }
type Params = {
  checkColors: boolean
  checkText: boolean
  checkSpacing: boolean
  checkDetached: boolean
  checkRadius: boolean
}

const TAG_PREFIX = '@@AminoHelps@@'
const TARGET_ID_KEY = 'aminoTargetId'
const DEFAULTS: Params = { checkColors: true, checkText: true, checkSpacing: true, checkDetached: true, checkRadius: true }
let latestParams: Params = DEFAULTS
let isExecuting = false

const PRIORITY_COLORS: Record<Priority, { r: number; g: number; b: number }> = {
  critical: { r: 0.88, g: 0.17, b: 0.17 },
  warning: { r: 0.93, g: 0.58, b: 0.07 },
  info: { r: 0.18, g: 0.46, b: 0.88 },
}

const CATEGORY_ORDER: Category[] = ['Icons', 'Background', 'Border', 'Text & Typography', 'Radius', 'Color']
const CATEGORY_COLORS: Record<Category, { r: number; g: number; b: number }> = {
  'Icons': { r: 0.16, g: 0.5, b: 0.5 },
  'Background': { r: 0.35, g: 0.3, b: 0.62 },
  'Border': { r: 0.55, g: 0.4, b: 0.12 },
  'Text & Typography': { r: 0.13, g: 0.38, b: 0.68 },
  'Radius': { r: 0.22, g: 0.52, b: 0.28 },
  'Color': { r: 0.4, g: 0.4, b: 0.4 },
}
const COMPONENT_COLOR = { r: 0.5, g: 0.15, b: 0.55 }

const AMINO_RADII = [2, 4, 8, 12, 16, 24, 32, 40, 48, 64]

// ─── Mode Detection ───

// "Recognized collection" drives the other-system check, so it must not be
// allowed to come back empty. Building it only from the audited node's own
// resolvedVariableModes silently disables that check on any plain node with
// no local mode override — every foreign/nonexistent token then passes.
// Union in every collection actually defined in this file as a second,
// unconditional source so the check always has something to compare against.
async function getRecognizedCollectionIds(): Promise<Set<string>> {
  const ids = new Set<string>()
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync()
    for (const collection of collections) ids.add(collection.id)
  } catch { /* skip */ }
  return ids
}

async function getActiveModes(rootNode: SceneNode): Promise<BrandInfo> {
  const modes: ModeInfo[] = []
  const collectionIds = await getRecognizedCollectionIds()
  if (!('resolvedVariableModes' in rootNode)) return { brandName: 'Unknown', modes, collectionIds }
  const resolvedModes = (rootNode as FrameNode).resolvedVariableModes
  if (!resolvedModes) return { brandName: 'Unknown', modes, collectionIds }
  const modeNameCounts: Record<string, number> = {}
  for (const collectionId of Object.keys(resolvedModes)) {
    collectionIds.add(collectionId)
    const modeId = resolvedModes[collectionId]
    try {
      const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId)
      if (collection) {
        const modeEntry = collection.modes.find(m => m.modeId === modeId)
        const modeName = modeEntry?.name ?? modeId
        modes.push({ collectionName: collection.name, modeName })
        const parts = modeName.split('/')
        for (const p of parts) {
          const clean = p.trim()
          if (clean && clean.length > 1) modeNameCounts[clean] = (modeNameCounts[clean] || 0) + 1
        }
      }
    } catch { /* skip */ }
  }
  let brandName = 'Unknown'
  let maxCount = 0
  for (const [name, count] of Object.entries(modeNameCounts)) {
    if (count > maxCount) { maxCount = count; brandName = name }
  }
  return { brandName, modes, collectionIds }
}

function isDeprecatedTokenName(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.startsWith('old tokens') || lower.includes('/old tokens/') || lower.includes('old-buttons')
}

async function checkTokenIdentity(alias: VariableAlias, recognizedCollectionIds: Set<string>): Promise<{ variable: Variable | null; deprecated: boolean; otherSystem: boolean }> {
  const variable = await figma.variables.getVariableByIdAsync(alias.id)
  if (!variable) return { variable: null, deprecated: false, otherSystem: false }
  const deprecated = isDeprecatedTokenName(variable.name)
  const otherSystem = recognizedCollectionIds.size > 0 && !recognizedCollectionIds.has(variable.variableCollectionId)
  return { variable, deprecated, otherSystem }
}

// Typography in Figma is correctly done via Text Styles (not Variables), so
// a bound text style isn't automatically wrong the way a bound colour style
// is — but it should still look like it came from Amino's type ramp.
const AMINO_TEXT_STYLE_PREFIXES = ['display/', 'body/', 'caption/', 'label/']
function looksLikeAminoTextStyle(name: string): boolean {
  const lower = name.toLowerCase()
  return AMINO_TEXT_STYLE_PREFIXES.some(p => lower.startsWith(p))
}

// ─── Element Role & Token Family ───

type ElementRole = 'text' | 'icon' | 'background' | 'border' | 'unknown'
type TokenCategory = 'text' | 'icon' | 'bg' | 'border' | 'unknown'

function detectElementRole(node: SceneNode): ElementRole {
  if (node.type === 'TEXT') return 'text'
  const nameLower = node.name.toLowerCase()
  if (nameLower.includes('icon') || nameLower.includes('ico-') || nameLower.includes('_icon')) return 'icon'
  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION' || node.type === 'STAR' || node.type === 'POLYGON') return 'icon'
  if (node.type === 'INSTANCE' || node.type === 'COMPONENT') {
    if (node.width <= 48 && node.height <= 48) return 'icon'
  }
  if (node.type === 'LINE') return 'border'
  if ((node.type === 'RECTANGLE' || node.type === 'ELLIPSE') && node.width <= 32 && node.height <= 32) return 'icon'
  if (node.type === 'FRAME' || node.type === 'RECTANGLE' || node.type === 'ELLIPSE' || node.type === 'SECTION') return 'background'
  return 'unknown'
}

function classifyTokenName(varName: string): TokenCategory {
  const lower = varName.toLowerCase()
  if (lower.includes('/text/') || lower.includes('text-0') || lower.includes('text-black') || lower.includes('text-white') || lower.includes('text-inverse') || lower.includes('text-brand') || lower.includes('text-link')) return 'text'
  if (lower.includes('/icon/') || lower.includes('icon-') || lower.includes('/icon')) return 'icon'
  if (lower.includes('/bg/') || lower.includes('bg-primary') || lower.includes('bg-secondary') || lower.includes('bg-brand') || lower.includes('bg-surface') || lower.includes('bg-overlay')) return 'bg'
  if (lower.includes('/border') || lower.includes('border-')) return 'border'
  return 'unknown'
}

const ROLE_ALLOWED_TOKENS: Record<ElementRole, TokenCategory[]> = {
  text: ['text'],
  icon: ['icon', 'text'],
  background: ['bg'],
  border: ['border'],
  unknown: ['text', 'icon', 'bg', 'border', 'unknown'],
}
const ROLE_SUGGESTED_TOKEN: Record<ElementRole, string> = {
  text: 'Semantic/Text/text-01',
  icon: 'Semantic/Icon/icon-01',
  background: 'Semantic/bg/Global/Primary/bg-primary-01',
  border: 'Semantic/Borders/border-05',
  unknown: '',
}
const ROLE_LABELS: Record<ElementRole, string> = {
  text: 'Text', icon: 'Icon', background: 'Background', border: 'Border', unknown: 'Element',
}

// A colour/border/typography finding is bucketed to the sheet matching the
// element it lives on, not the check that found it — so every category
// (Icons/Background/Border/Text & Typography) can contain both "hardcoded"
// and "not in our design system" rows side by side, per that category.
function categoryForColorIssue(node: SceneNode, isStroke: boolean): Category {
  if (isStroke) return 'Border'
  const role = detectElementRole(node)
  if (role === 'icon') return 'Icons'
  if (role === 'background') return 'Background'
  if (role === 'text') return 'Text & Typography'
  if (role === 'border') return 'Border'
  return 'Color'
}

async function checkBoundColorToken(node: SceneNode, alias: VariableAlias, property: string, isStroke: boolean, recognizedCollectionIds: Set<string>): Promise<Issue | null> {
  if (!alias || !alias.id) return null
  const category = categoryForColorIssue(node, isStroke)
  const role = detectElementRole(node)
  const expectedRole: ElementRole = isStroke ? 'border' : role
  const suggested = ROLE_SUGGESTED_TOKEN[expectedRole] || 'the matching Amino Semantic token for this element'
  const { variable, deprecated, otherSystem } = await checkTokenIdentity(alias, recognizedCollectionIds)
  if (!variable) {
    return { node, issue: `${property} references a token that could not be resolved (deleted/unavailable)`, category, priority: 'critical', dsToken: suggested, solution: `Re-bind to a valid Amino token — try ${suggested}` }
  }
  if (deprecated) {
    return { node, issue: `${property} uses deprecated token: ${variable.name}`, category, priority: 'critical', dsToken: suggested, solution: `Migrate off this Old Tokens reference — nearest current equivalent: ${suggested}` }
  }
  if (otherSystem) {
    return { node, issue: `${property} uses a token that doesn't exist in the Amino design system: ${variable.name}`, category, priority: 'critical', dsToken: suggested, solution: `This token isn't part of Amino — replace with ${suggested}` }
  }
  const allowedTokens = ROLE_ALLOWED_TOKENS[expectedRole]
  const roleLabel = ROLE_LABELS[expectedRole]
  const tokenCat = classifyTokenName(variable.name)
  if (tokenCat !== 'unknown' && !allowedTokens.includes(tokenCat)) {
    return { node, issue: `${property} using ${tokenCat} token: ${variable.name}`, category, priority: 'critical', dsToken: suggested, solution: `${roleLabel} should use ${allowedTokens.join('/')} token → ${suggested}` }
  }
  return null
}

// Amino's colour system is Variable-based (Semantic/Text/text-01, etc.) — a
// fill/stroke bound to a Figma Style instead (e.g. "Color Styles/Gray/#800")
// is a parallel, non-Amino mechanism. It isn't a bare literal, so the
// hardcoded check misses it, and it isn't a bound variable either, so the
// variable-identity check misses it too — it was previously invisible.
async function checkColorStyleIssue(node: SceneNode, property: string, styleId: string, isStroke: boolean): Promise<Issue | null> {
  const category = categoryForColorIssue(node, isStroke)
  const role = detectElementRole(node)
  const expectedRole: ElementRole = isStroke ? 'border' : role
  const suggested = ROLE_SUGGESTED_TOKEN[expectedRole] || 'the matching Amino Semantic token for this element'
  try {
    const style = await figma.getStyleByIdAsync(styleId)
    if (!style) {
      return { node, issue: `${property} references a style that could not be resolved (deleted/unavailable)`, category, priority: 'critical', dsToken: suggested, solution: `Re-bind to a valid Amino token variable — try ${suggested}` }
    }
    return { node, issue: `${property} uses a Figma Style, not an Amino variable: "${style.name}"`, category, priority: 'critical', dsToken: suggested, solution: `Replace with the equivalent Amino Semantic colour variable — try ${suggested}` }
  } catch {
    return null
  }
}

async function scanComponentSourcing(node: SceneNode): Promise<ComponentFlag[]> {
  const flags: ComponentFlag[] = []
  if (node.type === 'INSTANCE') {
    try {
      const main = await node.getMainComponentAsync()
      if (!main) {
        flags.push({ node, detail: 'Instance’s source component could not be resolved (deleted or unavailable)', recommendation: 'Re-link this instance to a valid Amino library component' })
      } else if (main.remote === false) {
        flags.push({ node, detail: `Instance of a locally-defined component, not a library component: "${main.name}"`, recommendation: 'Replace with an instance of the equivalent Amino library component' })
      }
    } catch { /* skip */ }
  }
  return flags
}

// ─── Suggestions ───

function suggestColorToken(node: SceneNode, isStroke: boolean): string {
  if (isStroke) return 'Semantic/Borders/border-05'
  if (node.type === 'TEXT') return 'Semantic/Text/text-01'
  return 'Semantic/bg/Global/Primary/bg-primary-01'
}

function suggestTextStyle(fontSize: number): string {
  if (fontSize >= 32) return 'Display/Large/Bold'
  if (fontSize >= 24) return 'Display/Medium/Bold'
  if (fontSize >= 20) return 'Display/Small/Medium'
  if (fontSize >= 16) return 'Body/Large/Medium'
  if (fontSize >= 14) return 'Body/Medium/Medium'
  if (fontSize >= 12) return 'Caption/Large/Medium'
  if (fontSize >= 10) return 'Label/Small/Medium'
  return 'Label/X small/Bold'
}

function findClosestRadius(value: number): number {
  let best = AMINO_RADII[0]
  let bestDist = Math.abs(value - best)
  for (const r of AMINO_RADII) {
    const d = Math.abs(value - r)
    if (d < bestDist) { bestDist = d; best = r }
  }
  return best
}

// ─── Audit Engine ───

async function runAudit(params: Params): Promise<{ issues: Issue[]; brandInfo: BrandInfo; componentFlags: ComponentFlag[] }> {
  const selection = figma.currentPage.selection
  const roots: SceneNode[] = selection.length > 0 ? [...selection] : [...figma.currentPage.children] as SceneNode[]

  const allNodes: SceneNode[] = []
  function collect(node: SceneNode) {
    if (node.name.startsWith(TAG_PREFIX)) return
    allNodes.push(node)
    if ('children' in node) {
      for (const child of (node as FrameNode).children) collect(child as SceneNode)
    }
  }
  for (const r of roots) collect(r)

  const referenceNode = roots[0]
  const brandInfo = await getActiveModes(referenceNode)
  const issues: Issue[] = []
  const componentFlags: ComponentFlag[] = []

  for (const node of allNodes) {
    componentFlags.push(...await scanComponentSourcing(node))

    if (params.checkColors && 'fills' in node) {
      const fills = (node as GeometryMixin).fills
      if (Array.isArray(fills)) {
        const boundArr = node.boundVariables && (node.boundVariables.fills as VariableAlias[] | undefined)
        const fillStyleId = 'fillStyleId' in node ? (node as MinimalFillsMixin).fillStyleId : ''
        const hasStyle = typeof fillStyleId === 'string' && fillStyleId !== ''
        if (hasStyle) {
          const found = await checkColorStyleIssue(node, 'Fill', fillStyleId as string, false)
          if (found) issues.push(found)
        } else if (boundArr && boundArr.length > 0) {
          for (const alias of boundArr) {
            const found = await checkBoundColorToken(node, alias, 'Fill', false, brandInfo.collectionIds)
            if (found) issues.push(found)
          }
        } else {
          for (const f of fills) {
            if (f.type === 'SOLID' && f.visible !== false) {
              const hex = '#' + [f.color.r, f.color.g, f.color.b].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
              const token = suggestColorToken(node as SceneNode, false)
              issues.push({ node: node as SceneNode, issue: `Hardcoded fill: ${hex}`, category: categoryForColorIssue(node, false), priority: 'critical', dsToken: token, solution: `Use Amino token → ${token}` })
            }
          }
        }
      }
    }

    if (params.checkColors && 'strokes' in node) {
      const strokes = (node as MinimalStrokesMixin).strokes
      if (Array.isArray(strokes)) {
        const boundArr = node.boundVariables && (node.boundVariables.strokes as VariableAlias[] | undefined)
        const strokeStyleId = 'strokeStyleId' in node ? (node as MinimalStrokesMixin).strokeStyleId : ''
        const hasStyle = typeof strokeStyleId === 'string' && strokeStyleId !== ''
        if (hasStyle) {
          const found = await checkColorStyleIssue(node, 'Stroke', strokeStyleId as string, true)
          if (found) issues.push(found)
        } else if (boundArr && boundArr.length > 0) {
          for (const alias of boundArr) {
            const found = await checkBoundColorToken(node, alias, 'Stroke', true, brandInfo.collectionIds)
            if (found) issues.push(found)
          }
        } else {
          for (const s of strokes) {
            if (s.type === 'SOLID' && s.visible !== false) {
              const hex = '#' + [s.color.r, s.color.g, s.color.b].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
              const token = suggestColorToken(node as SceneNode, true)
              issues.push({ node: node as SceneNode, issue: `Hardcoded stroke: ${hex}`, category: 'Border', priority: 'warning', dsToken: token, solution: `Use Amino token → ${token}` })
            }
          }
        }
      }
    }

    if (params.checkText && node.type === 'TEXT') {
      const textNode = node as TextNode
      if (!textNode.textStyleId || textNode.textStyleId === '') {
        const fontSize = typeof textNode.fontSize === 'number' ? textNode.fontSize : 14
        const suggested = suggestTextStyle(fontSize)
        issues.push({ node, issue: `No text style (${fontSize}px)`, category: 'Text & Typography', priority: 'critical', dsToken: suggested, solution: `Apply Amino style → ${suggested}` })
      } else if (typeof textNode.textStyleId === 'string') {
        const fontSize = typeof textNode.fontSize === 'number' ? textNode.fontSize : 14
        const suggestedStyle = suggestTextStyle(fontSize)
        try {
          const style = await figma.getStyleByIdAsync(textNode.textStyleId)
          if (!style) {
            issues.push({ node, issue: 'Text style references a style that could not be resolved (deleted/unavailable)', category: 'Text & Typography', priority: 'critical', dsToken: suggestedStyle, solution: `Re-bind to a valid Amino style — try ${suggestedStyle}` })
          } else if (!looksLikeAminoTextStyle(style.name)) {
            issues.push({ node, issue: `Text style doesn't exist in the Amino type ramp: "${style.name}"`, category: 'Text & Typography', priority: 'critical', dsToken: suggestedStyle, solution: `This style isn't part of Amino — replace with ${suggestedStyle}` })
          }
        } catch { /* skip */ }
      }
    }

    if (params.checkRadius && 'cornerRadius' in node) {
      const n = node as RectangleNode
      if (typeof n.cornerRadius === 'number' && n.cornerRadius > 0) {
        const boundAlias = n.boundVariables && (n.boundVariables.topLeftRadius as VariableAlias | undefined)
        const closest = findClosestRadius(n.cornerRadius)
        const suggestedRadius = `Primitive/Radius/radius-${closest} (${closest}px)`
        if (boundAlias) {
          const { variable, deprecated, otherSystem } = await checkTokenIdentity(boundAlias, brandInfo.collectionIds)
          if (!variable) {
            issues.push({ node, issue: 'Corner radius references a token that could not be resolved (deleted/unavailable)', category: 'Radius', priority: 'critical', dsToken: suggestedRadius, solution: `Re-bind to a valid Amino radius token — try ${suggestedRadius}` })
          } else if (deprecated) {
            issues.push({ node, issue: `Corner radius uses deprecated token: ${variable.name}`, category: 'Radius', priority: 'critical', dsToken: suggestedRadius, solution: `Migrate off this Old Tokens reference — nearest current equivalent: ${suggestedRadius}` })
          } else if (otherSystem) {
            issues.push({ node, issue: `Corner radius uses a token that doesn't exist in the Amino design system: ${variable.name}`, category: 'Radius', priority: 'critical', dsToken: suggestedRadius, solution: `This token isn't part of Amino — replace with ${suggestedRadius}` })
          }
        } else if (!AMINO_RADII.includes(n.cornerRadius)) {
          issues.push({ node: node as SceneNode, issue: `Non-standard radius: ${n.cornerRadius}px`, category: 'Radius', priority: 'info', dsToken: suggestedRadius, solution: `Use Amino token → ${suggestedRadius}` })
        }
      }
    }

    if (params.checkDetached && node.type === 'FRAME') {
      const frame = node as FrameNode
      const pluginData = frame.getPluginData('defn')
      if (pluginData && pluginData.includes('detached')) {
        componentFlags.push({ node, detail: 'Detached component (tagged by design tooling)', recommendation: 'Re-attach to the original Amino library component' })
      }
    }
  }

  return { issues, brandInfo, componentFlags }
}

// ─── Display Selection ───
// Balancing pin placement by category (not just priority) means every
// category shows up near the design, not just whichever has the most rows.
type PinItem = {
  node: SceneNode
  color: { r: number; g: number; b: number }
  header: string
  lines: string[]
  bucket: string
}

function buildPinItems(issues: Issue[], componentFlags: ComponentFlag[], issueIndex: Map<Issue, number>, componentIndex: Map<ComponentFlag, number>): PinItem[] {
  const items: PinItem[] = []
  for (const issue of issues) {
    const num = issueIndex.get(issue) ?? 0
    items.push({
      node: issue.node,
      color: PRIORITY_COLORS[issue.priority],
      header: `${issue.category.toUpperCase()} #${num} — ${issue.priority.toUpperCase()}`,
      lines: [issue.issue, `Fix: ${issue.solution}`],
      bucket: issue.category,
    })
  }
  for (const flag of componentFlags) {
    const num = componentIndex.get(flag) ?? 0
    items.push({
      node: flag.node,
      color: COMPONENT_COLOR,
      header: `COMPONENTS #${num}`,
      lines: [flag.detail, `Fix: ${flag.recommendation}`],
      bucket: 'Components',
    })
  }
  return items
}

function selectBalancedByBucket(items: PinItem[], capPerBucket: number): PinItem[] {
  const counts: Record<string, number> = {}
  const selected: PinItem[] = []
  for (const item of items) {
    counts[item.bucket] = counts[item.bucket] || 0
    if (counts[item.bucket] < capPerBucket) {
      selected.push(item)
      counts[item.bucket]++
    }
  }
  return selected
}

// ─── Annotation Cards (both sides) ───

async function placeCommentPins(items: PinItem[], targetBounds: Rect): Promise<{ created: SceneNode[]; shown: number; total: number }> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
  const created: SceneNode[] = []
  const CARD_W = 240
  const CARD_GAP = 6
  const LINE_GAP = 24
  const frameLeftX = Math.round(targetBounds.x)
  const frameRightX = Math.round(targetBounds.x + targetBounds.width)
  const frameMidX = Math.round(targetBounds.x + targetBounds.width / 2)
  const PIN_CAP_PER_BUCKET = 6
  const pinItems = selectBalancedByBucket(items, PIN_CAP_PER_BUCKET)
  const occupiedLeft: { y: number; h: number }[] = []
  const occupiedRight: { y: number; h: number }[] = []

  function findFreeY(desiredY: number, cardH: number, occupied: { y: number; h: number }[]): number {
    let y = desiredY
    let tries = 0
    while (tries < 200) {
      let overlap = false
      for (const slot of occupied) {
        if (y < slot.y + slot.h + CARD_GAP && y + cardH + CARD_GAP > slot.y) { y = slot.y + slot.h + CARD_GAP; overlap = true; break }
      }
      if (!overlap) break
      tries++
    }
    return Math.round(y)
  }

  for (let i = 0; i < pinItems.length; i++) {
    const item = pinItems[i]
    const node = item.node
    if (!node || node.removed) continue
    const nodeBounds = node.absoluteBoundingBox
    if (!nodeBounds) continue
    const color = item.color
    const nodeMidX = Math.round(nodeBounds.x + nodeBounds.width / 2)
    const isLeft = nodeMidX < frameMidX
    const PAD = 8
    const TEXT_W = CARD_W - PAD * 2
    const gap = 2

    const lineSpecs: { text: string; style: 'Bold' | 'Medium' | 'Regular'; size: number; color: { r: number; g: number; b: number } }[] = [
      { text: item.header, style: 'Bold', size: 10, color },
      { text: `Layer: ${node.name.slice(0, 35)}`, style: 'Medium', size: 9, color: { r: 0.5, g: 0.5, b: 0.5 } },
    ]
    item.lines.forEach((line, idx) => {
      lineSpecs.push({
        text: line || 'No description',
        style: idx === 0 ? 'Regular' : 'Medium',
        size: idx === 0 ? 10 : 9,
        color: idx === 0 ? { r: 0.2, g: 0.2, b: 0.2 } : { r: 0.1, g: 0.38, b: 0.72 },
      })
    })

    const textNodes: TextNode[] = []
    for (const spec of lineSpecs) {
      const t = figma.createText()
      t.fontName = { family: 'Inter', style: spec.style }
      t.characters = spec.text
      t.fontSize = spec.size
      t.fills = [{ type: 'SOLID', color: spec.color }]
      t.resize(TEXT_W, t.height)
      t.textAutoResize = 'HEIGHT'
      textNodes.push(t)
    }
    let totalH = PAD
    for (const t of textNodes) totalH += t.height + gap
    totalH += PAD - gap

    const card = figma.createFrame()
    card.name = `${TAG_PREFIX}Pin ${i + 1}`
    card.resize(CARD_W, totalH)
    card.cornerRadius = 8
    card.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
    card.strokes = [{ type: 'SOLID', color }]
    card.strokeWeight = 1.5
    card.strokeAlign = 'INSIDE'
    card.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 2 }, radius: 6, spread: 0, visible: true, blendMode: 'NORMAL', boundVariables: {} }]
    card.clipsContent = false
    figma.currentPage.appendChild(card)

    let yPos = PAD
    for (const t of textNodes) {
      card.appendChild(t); t.x = PAD; t.y = yPos
      yPos += t.height + gap
    }

    const nodeMidY = Math.round(nodeBounds.y + nodeBounds.height / 2)
    const cardH = totalH
    const desiredY = nodeMidY - cardH / 2

    if (isLeft) {
      const cardY = findFreeY(desiredY, cardH, occupiedLeft)
      card.x = frameLeftX - LINE_GAP - CARD_W; card.y = cardY
      occupiedLeft.push({ y: cardY, h: cardH })
      const ncx = Math.round(nodeBounds.x), ccx = card.x + CARD_W
      const ccy = Math.round(cardY + cardH / 2)
      const line = figma.createLine(); line.name = `${TAG_PREFIX}Line ${i + 1}`
      line.strokeWeight = 1; line.strokes = [{ type: 'SOLID', color, opacity: 0.6 }]; line.dashPattern = [4, 3]
      figma.currentPage.appendChild(line)
      const dx = ncx - ccx, dy = nodeMidY - ccy, len = Math.sqrt(dx * dx + dy * dy), angle = Math.atan2(dy, dx)
      line.resize(len, 0); line.x = ccx; line.y = ccy; line.rotation = -angle * (180 / Math.PI)
      created.push(line)
      const dot = figma.createEllipse(); dot.name = `${TAG_PREFIX}Dot ${i + 1}`; dot.resize(6, 6); dot.fills = [{ type: 'SOLID', color }]
      figma.currentPage.appendChild(dot); dot.x = ncx - 3; dot.y = nodeMidY - 3; created.push(dot)
    } else {
      const cardY = findFreeY(desiredY, cardH, occupiedRight)
      card.x = frameRightX + LINE_GAP; card.y = cardY
      occupiedRight.push({ y: cardY, h: cardH })
      const ncx = Math.round(nodeBounds.x + nodeBounds.width), ccx = card.x
      const ccy = Math.round(cardY + cardH / 2)
      const line = figma.createLine(); line.name = `${TAG_PREFIX}Line ${i + 1}`
      line.strokeWeight = 1; line.strokes = [{ type: 'SOLID', color, opacity: 0.6 }]; line.dashPattern = [4, 3]
      figma.currentPage.appendChild(line)
      const dx = ccx - ncx, dy = ccy - nodeMidY, len = Math.sqrt(dx * dx + dy * dy), angle = Math.atan2(dy, dx)
      line.resize(len, 0); line.x = ncx; line.y = nodeMidY; line.rotation = -angle * (180 / Math.PI)
      created.push(line)
      const dot = figma.createEllipse(); dot.name = `${TAG_PREFIX}Dot ${i + 1}`; dot.resize(6, 6); dot.fills = [{ type: 'SOLID', color }]
      figma.currentPage.appendChild(dot); dot.x = ncx - 3; dot.y = nodeMidY - 3; created.push(dot)
    }
    created.push(card)
  }
  return { created, shown: pinItems.length, total: items.length }
}

// ─── Report Sheets ───
// One sheet per element/property category (not per priority) — "Color
// (hardcoded and not-in-system)" lives together, alongside its own
// Icons/Background/Border/Text & Typography/Radius sheets, plus a dedicated
// Components sheet for anything not sourced from the Amino library.

async function createSummarySheet(brandInfo: BrandInfo, critCount: number, warnCount: number, infoCount: number, componentCount: number): Promise<FrameNode> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' })

  const SHEET_W = 700
  const sheet = figma.createFrame()
  sheet.name = `${TAG_PREFIX}Audit Summary`
  sheet.resize(SHEET_W, 1)
  sheet.layoutMode = 'VERTICAL'
  sheet.primaryAxisSizingMode = 'AUTO'
  sheet.paddingTop = 28; sheet.paddingBottom = 28; sheet.paddingLeft = 28; sheet.paddingRight = 28
  sheet.itemSpacing = 14
  sheet.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  sheet.cornerRadius = 16
  sheet.strokes = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 } }]; sheet.strokeWeight = 1
  sheet.clipsContent = false

  const title = figma.createText()
  title.fontName = { family: 'Inter', style: 'Bold' }; title.characters = 'Amino Helps — Design Audit Report'
  title.fontSize = 20; title.fills = [{ type: 'SOLID', color: { r: 0.08, g: 0.08, b: 0.08 } }]
  sheet.appendChild(title)

  if (brandInfo.modes.length > 0) {
    const modeBox = figma.createFrame()
    modeBox.name = `${TAG_PREFIX}Modes`; modeBox.layoutMode = 'VERTICAL'
    modeBox.primaryAxisSizingMode = 'AUTO'; modeBox.counterAxisSizingMode = 'AUTO'
    modeBox.paddingTop = 10; modeBox.paddingBottom = 10; modeBox.paddingLeft = 14; modeBox.paddingRight = 14
    modeBox.itemSpacing = 4; modeBox.cornerRadius = 10
    modeBox.fills = [{ type: 'SOLID', color: { r: 0.96, g: 0.96, b: 0.98 } }]
    sheet.appendChild(modeBox); modeBox.layoutAlign = 'STRETCH'

    const brandLbl = figma.createText()
    brandLbl.fontName = { family: 'Inter', style: 'Bold' }; brandLbl.characters = `Brand: ${brandInfo.brandName}`
    brandLbl.fontSize = 14; brandLbl.fills = [{ type: 'SOLID', color: { r: 0.15, g: 0.3, b: 0.7 } }]
    modeBox.appendChild(brandLbl)

    const modeSummary = figma.createText()
    modeSummary.fontName = { family: 'Inter', style: 'Regular' }
    const uniqueModes = [...new Set(brandInfo.modes.map(m => m.modeName))]
    modeSummary.characters = `Active modes: ${uniqueModes.join(', ')}`
    modeSummary.fontSize = 11; modeSummary.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.5 } }]
    modeBox.appendChild(modeSummary)
  }

  const summaryText = figma.createText()
  summaryText.fontName = { family: 'Inter', style: 'Medium' }
  summaryText.characters = `Total: ${critCount + warnCount + infoCount} issues  |  Critical: ${critCount}  |  Warning: ${warnCount}  |  Info: ${infoCount}  |  Components flagged: ${componentCount}`
  summaryText.fontSize = 13; summaryText.fills = [{ type: 'SOLID', color: { r: 0.25, g: 0.25, b: 0.25 } }]
  summaryText.textAutoResize = 'HEIGHT'
  sheet.appendChild(summaryText); summaryText.layoutAlign = 'STRETCH'

  const note = figma.createText()
  note.fontName = { family: 'Inter', style: 'Regular' }
  note.characters = 'Full lists below: one sheet per element type (Icons, Background, Border, Text & Typography, Radius, Color), plus a dedicated Components sheet for anything not sourced from the Amino library.'
  note.fontSize = 11; note.fills = [{ type: 'SOLID', color: { r: 0.55, g: 0.55, b: 0.55 } }]
  note.textAutoResize = 'HEIGHT'
  sheet.appendChild(note); note.layoutAlign = 'STRETCH'

  const footer = figma.createText()
  footer.fontName = { family: 'Inter', style: 'Regular' }
  footer.characters = `Generated by Amino Helps  •  ${new Date().toLocaleDateString()}  •  Amino Design System`
  footer.fontSize = 10; footer.fills = [{ type: 'SOLID', color: { r: 0.6, g: 0.6, b: 0.6 } }]
  sheet.appendChild(footer)

  return sheet
}

async function createCategorySheet(categoryIssues: Issue[], category: Category, issueIndex: Map<Issue, number>): Promise<FrameNode> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' })

  const SHEET_W = 700
  const SHEET_CAP = 300
  const displayIssues = categoryIssues.slice(0, SHEET_CAP)
  const accent = CATEGORY_COLORS[category]

  const sheet = figma.createFrame()
  sheet.name = `${TAG_PREFIX}${category}`
  sheet.resize(SHEET_W, 1)
  sheet.layoutMode = 'VERTICAL'
  sheet.primaryAxisSizingMode = 'AUTO'
  sheet.paddingTop = 28; sheet.paddingBottom = 28; sheet.paddingLeft = 28; sheet.paddingRight = 28
  sheet.itemSpacing = 10
  sheet.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  sheet.cornerRadius = 16
  sheet.strokes = [{ type: 'SOLID', color: accent }]
  sheet.strokeWeight = 1.5
  sheet.clipsContent = false

  const title = figma.createText()
  title.fontName = { family: 'Inter', style: 'Bold' }
  title.characters = categoryIssues.length > SHEET_CAP
    ? `${category} — showing ${SHEET_CAP} of ${categoryIssues.length}`
    : `${category} (${categoryIssues.length})`
  title.fontSize = 18
  title.fills = [{ type: 'SOLID', color: accent }]
  sheet.appendChild(title)

  if (displayIssues.length === 0) {
    const empty = figma.createText()
    empty.fontName = { family: 'Inter', style: 'Regular' }
    empty.characters = `No ${category} issues found — clean on this check.`
    empty.fontSize = 12
    empty.fills = [{ type: 'SOLID', color: { r: 0.3, g: 0.55, b: 0.35 } }]
    sheet.appendChild(empty)
    return sheet
  }

  for (let i = 0; i < displayIssues.length; i++) {
    const issue = displayIssues[i]
    const num = issueIndex.get(issue) ?? i + 1

    const row = figma.createFrame()
    row.name = `${TAG_PREFIX}Row ${category} ${num}`; row.layoutMode = 'VERTICAL'; row.primaryAxisSizingMode = 'AUTO'
    row.paddingTop = 8; row.paddingBottom = 8; row.paddingLeft = 12; row.paddingRight = 12
    row.itemSpacing = 3; row.cornerRadius = 8
    row.fills = i % 2 === 0 ? [{ type: 'SOLID', color: { r: 0.98, g: 0.98, b: 0.99 } }] : []
    sheet.appendChild(row); row.layoutAlign = 'STRETCH'

    const line1 = figma.createText()
    line1.fontName = { family: 'Inter', style: 'Bold' }
    line1.characters = `#${num}  [${issue.priority.toUpperCase()}]  ${issue.node && !issue.node.removed ? issue.node.name : '(removed)'}`
    line1.fontSize = 11; line1.fills = [{ type: 'SOLID', color: PRIORITY_COLORS[issue.priority] }]
    line1.textAutoResize = 'WIDTH_AND_HEIGHT'; row.appendChild(line1); line1.layoutAlign = 'STRETCH'

    const line2 = figma.createText()
    line2.fontName = { family: 'Inter', style: 'Regular' }; line2.characters = `Issue: ${issue.issue}`
    line2.fontSize = 11; line2.fills = [{ type: 'SOLID', color: { r: 0.35, g: 0.35, b: 0.35 } }]
    line2.textAutoResize = 'WIDTH_AND_HEIGHT'; row.appendChild(line2); line2.layoutAlign = 'STRETCH'

    const line3 = figma.createText()
    line3.fontName = { family: 'Inter', style: 'Medium' }; line3.characters = `Fix: ${issue.solution}`
    line3.fontSize = 11; line3.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.35, b: 0.7 } }]
    line3.textAutoResize = 'WIDTH_AND_HEIGHT'; row.appendChild(line3); line3.layoutAlign = 'STRETCH'
  }

  return sheet
}

async function createComponentsSheet(flags: ComponentFlag[], componentIndex: Map<ComponentFlag, number>): Promise<FrameNode> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' })

  const SHEET_W = 700
  const sheet = figma.createFrame()
  sheet.name = `${TAG_PREFIX}Components`
  sheet.resize(SHEET_W, 1)
  sheet.layoutMode = 'VERTICAL'
  sheet.primaryAxisSizingMode = 'AUTO'
  sheet.paddingTop = 28; sheet.paddingBottom = 28; sheet.paddingLeft = 28; sheet.paddingRight = 28
  sheet.itemSpacing = 10
  sheet.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  sheet.cornerRadius = 16
  sheet.strokes = [{ type: 'SOLID', color: COMPONENT_COLOR }]
  sheet.strokeWeight = 1.5
  sheet.clipsContent = false

  const title = figma.createText()
  title.fontName = { family: 'Inter', style: 'Bold' }
  title.characters = `Components (${flags.length})`
  title.fontSize = 18
  title.fills = [{ type: 'SOLID', color: COMPONENT_COLOR }]
  sheet.appendChild(title)

  const subtitle = figma.createText()
  subtitle.fontName = { family: 'Inter', style: 'Regular' }
  subtitle.characters = 'Component instances not sourced from the Amino library — local, broken/unresolvable, or detached.'
  subtitle.fontSize = 11
  subtitle.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }]
  subtitle.textAutoResize = 'HEIGHT'
  sheet.appendChild(subtitle)
  subtitle.layoutAlign = 'STRETCH'

  if (flags.length === 0) {
    const empty = figma.createText()
    empty.fontName = { family: 'Inter', style: 'Regular' }
    empty.characters = 'No off-system components found.'
    empty.fontSize = 12
    empty.fills = [{ type: 'SOLID', color: { r: 0.3, g: 0.55, b: 0.35 } }]
    sheet.appendChild(empty)
    return sheet
  }

  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]
    const num = componentIndex.get(flag) ?? i + 1
    const row = figma.createFrame()
    row.name = `${TAG_PREFIX}Row Components ${num}`; row.layoutMode = 'VERTICAL'; row.primaryAxisSizingMode = 'AUTO'
    row.paddingTop = 8; row.paddingBottom = 8; row.paddingLeft = 12; row.paddingRight = 12
    row.itemSpacing = 3; row.cornerRadius = 8
    row.fills = i % 2 === 0 ? [{ type: 'SOLID', color: { r: 0.98, g: 0.97, b: 0.99 } }] : []
    sheet.appendChild(row); row.layoutAlign = 'STRETCH'

    const line1 = figma.createText()
    line1.fontName = { family: 'Inter', style: 'Bold' }
    line1.characters = `#${num}  ${flag.node && !flag.node.removed ? flag.node.name : '(removed)'}`
    line1.fontSize = 11; line1.fills = [{ type: 'SOLID', color: { r: 0.12, g: 0.12, b: 0.12 } }]
    line1.textAutoResize = 'WIDTH_AND_HEIGHT'; row.appendChild(line1); line1.layoutAlign = 'STRETCH'

    const line2 = figma.createText()
    line2.fontName = { family: 'Inter', style: 'Regular' }; line2.characters = flag.detail
    line2.fontSize = 11; line2.fills = [{ type: 'SOLID', color: { r: 0.35, g: 0.35, b: 0.35 } }]
    line2.textAutoResize = 'WIDTH_AND_HEIGHT'; row.appendChild(line2); line2.layoutAlign = 'STRETCH'

    const line3 = figma.createText()
    line3.fontName = { family: 'Inter', style: 'Medium' }; line3.characters = `Fix: ${flag.recommendation}`
    line3.fontSize = 11; line3.fills = [{ type: 'SOLID', color: COMPONENT_COLOR }]
    line3.textAutoResize = 'WIDTH_AND_HEIGHT'; row.appendChild(line3); line3.layoutAlign = 'STRETCH'
  }

  return sheet
}

// ─── Clear ───

async function clearAllGeneratedNodes(): Promise<number> {
  let count = 0
  const toRemove: SceneNode[] = []
  for (const child of figma.currentPage.children) {
    if (child.name.startsWith(TAG_PREFIX)) { toRemove.push(child); count++ }
  }
  for (const node of toRemove) node.remove()
  return count
}

// Re-auditing one frame shouldn't wipe another frame's report — only the
// nodes tagged for THIS target get cleared; everything else stays until
// the user explicitly hits Clear all.
async function clearGeneratedNodesForTarget(targetId: string): Promise<number> {
  let count = 0
  const toRemove: SceneNode[] = []
  for (const child of figma.currentPage.children) {
    if (child.name.startsWith(TAG_PREFIX) && child.getPluginData(TARGET_ID_KEY) === targetId) {
      toRemove.push(child); count++
    }
  }
  for (const node of toRemove) node.remove()
  return count
}

// ─── Main Actions ───

async function runAuditAction(params: Params): Promise<void> {
  const target = figma.currentPage.selection.length > 0 ? figma.currentPage.selection[0] : null
  if (!target) { figma.notify('Select a frame to audit', { timeout: 3000 }); return }

  await clearGeneratedNodesForTarget(target.id)
  const { issues, brandInfo, componentFlags } = await runAudit(params)

  if (issues.length === 0 && componentFlags.length === 0) {
    figma.notify('No issues found — aligned with Amino Design System!', { timeout: 3000 }); return
  }

  const critCount = issues.filter(i => i.priority === 'critical').length
  const warnCount = issues.filter(i => i.priority === 'warning').length
  const infoCount = issues.filter(i => i.priority === 'info').length

  const order: Record<Priority, number> = { critical: 0, warning: 1, info: 2 }
  const byCategory = new Map<Category, Issue[]>(CATEGORY_ORDER.map(c => [c, []]))
  for (const issue of issues) byCategory.get(issue.category)!.push(issue)
  const issueIndex = new Map<Issue, number>()
  for (const category of CATEGORY_ORDER) {
    const sorted = [...byCategory.get(category)!].sort((a, b) => order[a.priority] - order[b.priority])
    sorted.forEach((issue, idx) => issueIndex.set(issue, idx + 1))
    byCategory.set(category, sorted)
  }
  const componentIndex = new Map<ComponentFlag, number>()
  componentFlags.forEach((flag, idx) => componentIndex.set(flag, idx + 1))

  const pinItems = buildPinItems(issues, componentFlags, issueIndex, componentIndex)

  const targetBounds = target.absoluteBoundingBox
  let pinsShown = 0
  let pinsTotal = 0
  const generatedNodes: SceneNode[] = []
  if (targetBounds && pinItems.length > 0) {
    const pinResult = await placeCommentPins(pinItems, targetBounds)
    pinsShown = pinResult.shown
    pinsTotal = pinResult.total
    generatedNodes.push(...pinResult.created)
  }

  const summarySheet = await createSummarySheet(brandInfo, critCount, warnCount, infoCount, componentFlags.length)
  const categorySheets: FrameNode[] = []
  for (const category of CATEGORY_ORDER) {
    categorySheets.push(await createCategorySheet(byCategory.get(category)!, category, issueIndex))
  }
  const componentsSheet = await createComponentsSheet(componentFlags, componentIndex)
  const sheets = [summarySheet, ...categorySheets, componentsSheet]

  const baseX = targetBounds ? Math.round(targetBounds.x + targetBounds.width + 280) : 0
  const baseY = targetBounds ? Math.round(targetBounds.y) : 0
  const SHEET_GAP = 32
  let cursorY = baseY
  for (const sheet of sheets) {
    figma.currentPage.appendChild(sheet)
    sheet.x = baseX
    sheet.y = cursorY
    cursorY += sheet.height + SHEET_GAP
    generatedNodes.push(sheet)
  }

  for (const node of generatedNodes) node.setPluginData(TARGET_ID_KEY, target.id)

  const pinNote = pinsShown < pinsTotal ? ` Canvas pins show ${pinsShown} of ${pinsTotal} (balanced across categories) — full lists in the sheets.` : ''
  figma.notify(`Amino Helps: ${issues.length} issues (${critCount} critical, ${warnCount} warning, ${infoCount} info) + ${componentFlags.length} components flagged.${pinNote}`, { timeout: 6000 })
  figma.currentPage.selection = [target, summarySheet]
  figma.viewport.scrollAndZoomIntoView([target, summarySheet])
}

// ─── UI Setup ───

function pushActionStates(): void {
  const sel = figma.currentPage.selection
  const enabled = sel.length > 0
  const label = enabled ? `Audit "${sel[0].name.slice(0, 18)}"` : 'Select a frame'
  figma.ui.postMessage({
    type: 'action-state',
    actions: {
      audit: { enabled, label },
      clear: { enabled: true, label: 'Clear all' },
    },
  })
}

figma.showUI(__uiFiles__["ui"], { width: 280, height: 480 })
pushActionStates()
figma.on('selectionchange', () => { if (!isExecuting) pushActionStates() })

figma.ui.onmessage = (msg: { type: string; id?: string; params?: Partial<Params>; height?: number }) => {
  if (msg.type === 'resize' && msg.height) {
    figma.ui.resize(280, Math.max(120, Math.min(600, Math.round(msg.height))))
    return
  }
  if (msg.type === 'action') {
    if (msg.id === 'audit') {
      latestParams = { ...DEFAULTS, ...msg.params }
      isExecuting = true
      runAuditAction(latestParams).catch(e => figma.notify(String(e), { error: true })).finally(() => { isExecuting = false; pushActionStates() })
    }
    if (msg.id === 'clear') {
      clearAllGeneratedNodes().then(count => {
        figma.notify(count > 0 ? `Cleared ${count} items` : 'Nothing to clear', { timeout: 3000 })
        pushActionStates()
      })
    }
  }
}
