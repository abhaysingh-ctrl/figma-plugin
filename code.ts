// Amino Helps — Standalone Figma Plugin
// Audits design layers against Amino Design System tokens, styles, and variables.

type Priority = 'critical' | 'warning' | 'info'
type Issue = {
  node: SceneNode
  issue: string
  category: string
  priority: Priority
  solution: string
  dsToken: string
}
type ModeInfo = { collectionName: string; modeName: string }
type BrandInfo = { brandName: string; modes: ModeInfo[]; collectionIds: Set<string> }
type OffSystemFlag = {
  node: SceneNode
  kind: 'Component' | 'Token'
  detail: string
  recommendation: string
}
type Params = {
  checkColors: boolean
  checkText: boolean
  checkSpacing: boolean
  checkDetached: boolean
  checkRadius: boolean
}

const TAG_PREFIX = '@@AminoHelps@@'
const DEFAULTS: Params = { checkColors: true, checkText: true, checkSpacing: true, checkDetached: true, checkRadius: true }
let latestParams: Params = DEFAULTS
let isExecuting = false

const PRIORITY_COLORS: Record<Priority, { r: number; g: number; b: number }> = {
  critical: { r: 0.88, g: 0.17, b: 0.17 },
  warning: { r: 0.93, g: 0.58, b: 0.07 },
  info: { r: 0.18, g: 0.46, b: 0.88 },
}

const AMINO_RADII = [2, 4, 8, 12, 16, 24, 32, 40, 48, 64]

// ─── Mode Detection ───

async function getActiveModes(rootNode: SceneNode): Promise<BrandInfo> {
  const modes: ModeInfo[] = []
  if (!('resolvedVariableModes' in rootNode)) return { brandName: 'Unknown', modes, collectionIds: new Set() }
  const resolvedModes = (rootNode as FrameNode).resolvedVariableModes
  if (!resolvedModes) return { brandName: 'Unknown', modes, collectionIds: new Set() }
  const collectionIds = new Set(Object.keys(resolvedModes))
  const modeNameCounts: Record<string, number> = {}
  for (const collectionId of Object.keys(resolvedModes)) {
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

async function scanOffSystem(node: SceneNode, recognizedCollectionIds: Set<string>): Promise<OffSystemFlag[]> {
  const flags: OffSystemFlag[] = []
  const bound = node.boundVariables
  if (bound) {
    const aliasesToCheck: { alias: VariableAlias; property: string }[] = []
    if (Array.isArray(bound.fills)) aliasesToCheck.push(...bound.fills.map(a => ({ alias: a, property: 'Fill' })))
    if (Array.isArray(bound.strokes)) aliasesToCheck.push(...(bound.strokes as VariableAlias[]).map(a => ({ alias: a, property: 'Stroke' })))
    if (bound.topLeftRadius) aliasesToCheck.push({ alias: bound.topLeftRadius as VariableAlias, property: 'Corner radius' })
    for (const { alias, property } of aliasesToCheck) {
      if (!alias || !alias.id) continue
      try {
        const { variable, deprecated, otherSystem } = await checkTokenIdentity(alias, recognizedCollectionIds)
        if (!variable) continue
        if (deprecated) {
          flags.push({ node, kind: 'Token', detail: `${property} uses deprecated token: ${variable.name}`, recommendation: 'Migrate off this Old Tokens reference to its current Amino equivalent' })
        } else if (otherSystem) {
          flags.push({ node, kind: 'Token', detail: `${property} uses a token from an unrecognized collection: ${variable.name}`, recommendation: 'Confirm this token is meant to be here — it is not part of the brand collections driving this file' })
        }
      } catch { /* skip */ }
    }
  }
  if (node.type === 'INSTANCE') {
    try {
      const main = await node.getMainComponentAsync()
      if (!main) {
        flags.push({ node, kind: 'Component', detail: 'Instance’s source component could not be resolved (deleted or unavailable)', recommendation: 'Re-link this instance to a valid Amino library component' })
      } else if (main.remote === false) {
        flags.push({ node, kind: 'Component', detail: `Instance of a locally-defined component, not a library component: "${main.name}"`, recommendation: 'Replace with an instance of the equivalent Amino library component' })
      }
    } catch { /* skip */ }
  }
  return flags
}

// ─── Element Role & Token Mapping ───

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

async function checkTokenMapping(node: SceneNode): Promise<Issue[]> {
  const issues: Issue[] = []
  if (!node.boundVariables) return issues
  const role = detectElementRole(node)
  if (role === 'unknown') return issues
  const allowedTokens = ROLE_ALLOWED_TOKENS[role]
  const roleLabel = ROLE_LABELS[role]
  const suggested = ROLE_SUGGESTED_TOKEN[role]

  const fillBindings = node.boundVariables.fills
  if (fillBindings && Array.isArray(fillBindings)) {
    for (const alias of fillBindings) {
      if (!alias || !alias.id) continue
      try {
        const variable = await figma.variables.getVariableByIdAsync(alias.id)
        if (!variable) continue
        const tokenCat = classifyTokenName(variable.name)
        if (tokenCat === 'unknown') continue
        if (!allowedTokens.includes(tokenCat)) {
          issues.push({
            node, issue: `${roleLabel} fill using ${tokenCat} token: ${variable.name}`,
            category: 'Token Mapping', priority: 'critical', dsToken: suggested,
            solution: `${roleLabel} should use ${allowedTokens.join('/')} token → ${suggested}`
          })
        }
      } catch { /* skip */ }
    }
  }

  const strokeBindings = node.boundVariables.strokes
  if (strokeBindings && Array.isArray(strokeBindings)) {
    for (const alias of strokeBindings as VariableAlias[]) {
      if (!alias || !alias.id) continue
      try {
        const variable = await figma.variables.getVariableByIdAsync(alias.id)
        if (!variable) continue
        const tokenCat = classifyTokenName(variable.name)
        if (tokenCat === 'unknown') continue
        if (tokenCat !== 'border') {
          issues.push({
            node, issue: `Stroke using ${tokenCat} token: ${variable.name}`,
            category: 'Token Mapping', priority: 'warning', dsToken: 'Semantic/Borders/border-05',
            solution: `Strokes should use border token → Semantic/Borders/border-05`
          })
        }
      } catch { /* skip */ }
    }
  }
  return issues
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

async function runAudit(params: Params): Promise<{ issues: Issue[]; brandInfo: BrandInfo; offSystemFlags: OffSystemFlag[] }> {
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
  const offSystemFlags: OffSystemFlag[] = []

  for (const node of allNodes) {
    offSystemFlags.push(...await scanOffSystem(node, brandInfo.collectionIds))

    if (params.checkColors && 'fills' in node) {
      const fills = (node as GeometryMixin).fills
      if (Array.isArray(fills)) {
        const hasBound = node.boundVariables && node.boundVariables.fills && node.boundVariables.fills.length > 0
        const hasStyle = 'fillStyleId' in node && (node as MinimalFillsMixin).fillStyleId && (node as MinimalFillsMixin).fillStyleId !== ''
        if (!hasBound && !hasStyle) {
          for (const f of fills) {
            if (f.type === 'SOLID' && f.visible !== false) {
              const hex = '#' + [f.color.r, f.color.g, f.color.b].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
              const token = suggestColorToken(node as SceneNode, false)
              issues.push({ node: node as SceneNode, issue: `Hardcoded fill: ${hex}`, category: 'Color', priority: 'critical', dsToken: token, solution: `Use Amino token → ${token}` })
            }
          }
        }
      }
    }

    if (params.checkColors && 'strokes' in node) {
      const strokes = (node as MinimalStrokesMixin).strokes
      if (Array.isArray(strokes)) {
        const hasBound = node.boundVariables && node.boundVariables.strokes && (node.boundVariables.strokes as VariableAlias[]).length > 0
        const hasStyle = 'strokeStyleId' in node && (node as MinimalStrokesMixin).strokeStyleId && (node as MinimalStrokesMixin).strokeStyleId !== ''
        if (!hasBound && !hasStyle) {
          for (const s of strokes) {
            if (s.type === 'SOLID' && s.visible !== false) {
              const hex = '#' + [s.color.r, s.color.g, s.color.b].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('')
              const token = suggestColorToken(node as SceneNode, true)
              issues.push({ node: node as SceneNode, issue: `Hardcoded stroke: ${hex}`, category: 'Color', priority: 'warning', dsToken: token, solution: `Use Amino token → ${token}` })
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
        issues.push({ node, issue: `No text style (${fontSize}px)`, category: 'Typography', priority: 'critical', dsToken: suggested, solution: `Apply Amino style → ${suggested}` })
      }
    }

    if (params.checkRadius && 'cornerRadius' in node) {
      const n = node as RectangleNode
      if (typeof n.cornerRadius === 'number' && n.cornerRadius > 0) {
        const hasBound = n.boundVariables && n.boundVariables.topLeftRadius
        if (!hasBound && !AMINO_RADII.includes(n.cornerRadius)) {
          const closest = findClosestRadius(n.cornerRadius)
          issues.push({ node: node as SceneNode, issue: `Non-standard radius: ${n.cornerRadius}px`, category: 'Radius', priority: 'info', dsToken: `Primitive/Radius/radius-${closest}`, solution: `Use Amino token → Primitive/Radius/radius-${closest} (${closest}px)` })
        }
      }
    }

    if (params.checkDetached && node.type === 'FRAME') {
      const frame = node as FrameNode
      const pluginData = frame.getPluginData('defn')
      if (pluginData && pluginData.includes('detached')) {
        issues.push({ node, issue: 'Detached component', category: 'Component', priority: 'critical', dsToken: 'Original Amino component', solution: 'Re-attach to original Amino library component' })
      }
    }

    if (params.checkColors) {
      const mappingIssues = await checkTokenMapping(node)
      issues.push(...mappingIssues)
    }
  }

  issues.sort((a, b) => {
    const order: Record<Priority, number> = { critical: 0, warning: 1, info: 2 }
    return order[a.priority] - order[b.priority]
  })

  return { issues, brandInfo, offSystemFlags }
}

// ─── Display Selection ───
// Truncating a priority-sorted list with a flat count lets high-priority issues
// crowd out lower ones entirely (e.g. 30+ criticals means warnings/infos never show).
// Selecting per-priority guarantees every present priority tier is represented.
function selectBalancedByPriority(issues: Issue[], capPerPriority: number): Issue[] {
  const counts: Record<Priority, number> = { critical: 0, warning: 0, info: 0 }
  const selected: Issue[] = []
  for (const issue of issues) {
    if (counts[issue.priority] < capPerPriority) {
      selected.push(issue)
      counts[issue.priority]++
    }
  }
  return selected
}

// ─── Annotation Cards (both sides) ───

async function placeCommentPins(issues: Issue[], targetBounds: Rect): Promise<{ created: SceneNode[]; shown: number; total: number }> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
  const created: SceneNode[] = []
  const CARD_W = 220
  const CARD_GAP = 6
  const LINE_GAP = 24
  const frameLeftX = Math.round(targetBounds.x)
  const frameRightX = Math.round(targetBounds.x + targetBounds.width)
  const frameMidX = Math.round(targetBounds.x + targetBounds.width / 2)
  const PIN_CAP_PER_PRIORITY = 10
  const pinIssues = selectBalancedByPriority(issues, PIN_CAP_PER_PRIORITY)
  const originalIndex = new Map<Issue, number>()
  issues.forEach((iss, idx) => originalIndex.set(iss, idx + 1))
  const limit = pinIssues.length
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

  for (let i = 0; i < limit; i++) {
    const issue = pinIssues[i]
    const num = originalIndex.get(issue) ?? i + 1
    const node = issue.node
    if (!node || node.removed) continue
    const nodeBounds = node.absoluteBoundingBox
    if (!nodeBounds) continue
    const color = PRIORITY_COLORS[issue.priority]
    const nodeMidX = Math.round(nodeBounds.x + nodeBounds.width / 2)
    const isLeft = nodeMidX < frameMidX
    const PAD = 8
    const TEXT_W = CARD_W - PAD * 2

    const headerText = figma.createText()
    headerText.fontName = { family: 'Inter', style: 'Bold' }
    headerText.characters = `#${num}  ${issue.priority.toUpperCase()} — ${issue.category}`
    headerText.fontSize = 10
    headerText.fills = [{ type: 'SOLID', color }]
    headerText.resize(TEXT_W, headerText.height)
    headerText.textAutoResize = 'HEIGHT'

    const layerText = figma.createText()
    layerText.fontName = { family: 'Inter', style: 'Medium' }
    layerText.characters = `Layer: ${node.name.slice(0, 35)}`
    layerText.fontSize = 9
    layerText.fills = [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5 } }]
    layerText.resize(TEXT_W, layerText.height)
    layerText.textAutoResize = 'HEIGHT'

    const issueText = figma.createText()
    issueText.fontName = { family: 'Inter', style: 'Regular' }
    issueText.characters = issue.issue || 'No description'
    issueText.fontSize = 10
    issueText.fills = [{ type: 'SOLID', color: { r: 0.2, g: 0.2, b: 0.2 } }]
    issueText.resize(TEXT_W, issueText.height)
    issueText.textAutoResize = 'HEIGHT'

    const tokenText = figma.createText()
    tokenText.fontName = { family: 'Inter', style: 'Medium' }
    tokenText.characters = issue.solution || 'Check Amino DS'
    tokenText.fontSize = 9
    tokenText.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.38, b: 0.72 } }]
    tokenText.resize(TEXT_W, tokenText.height)
    tokenText.textAutoResize = 'HEIGHT'

    const gap = 2
    const totalH = PAD + headerText.height + gap + layerText.height + gap + issueText.height + gap + tokenText.height + PAD

    const card = figma.createFrame()
    card.name = `${TAG_PREFIX}#${i + 1}`
    card.resize(CARD_W, totalH)
    card.cornerRadius = 6
    card.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
    card.strokes = [{ type: 'SOLID', color }]
    card.strokeWeight = 1.5
    card.strokeAlign = 'INSIDE'
    card.effects = [{ type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 1 }, radius: 4, spread: 0, visible: true, blendMode: 'NORMAL', boundVariables: {} }]
    card.clipsContent = false
    figma.currentPage.appendChild(card)

    card.appendChild(headerText); headerText.x = PAD; headerText.y = PAD
    let yPos = PAD + headerText.height + gap
    card.appendChild(layerText); layerText.x = PAD; layerText.y = yPos
    yPos += layerText.height + gap
    card.appendChild(issueText); issueText.x = PAD; issueText.y = yPos
    yPos += issueText.height + gap
    card.appendChild(tokenText); tokenText.x = PAD; tokenText.y = yPos

    const nodeMidY = Math.round(nodeBounds.y + nodeBounds.height / 2)
    const cardH = totalH
    const desiredY = nodeMidY - cardH / 2

    if (isLeft) {
      const cardY = findFreeY(desiredY, cardH, occupiedLeft)
      card.x = frameLeftX - LINE_GAP - CARD_W; card.y = cardY
      occupiedLeft.push({ y: cardY, h: cardH })
      const ncx = Math.round(nodeBounds.x), ccx = card.x + CARD_W
      const ccy = Math.round(cardY + cardH / 2)
      const line = figma.createLine(); line.name = `${TAG_PREFIX}Line #${i + 1}`
      line.strokeWeight = 1; line.strokes = [{ type: 'SOLID', color, opacity: 0.6 }]; line.dashPattern = [4, 3]
      figma.currentPage.appendChild(line)
      const dx = ncx - ccx, dy = nodeMidY - ccy, len = Math.sqrt(dx * dx + dy * dy), angle = Math.atan2(dy, dx)
      line.resize(len, 0); line.x = ccx; line.y = ccy; line.rotation = -angle * (180 / Math.PI)
      created.push(line)
      const dot = figma.createEllipse(); dot.name = `${TAG_PREFIX}Dot #${i + 1}`; dot.resize(6, 6); dot.fills = [{ type: 'SOLID', color }]
      figma.currentPage.appendChild(dot); dot.x = ncx - 3; dot.y = nodeMidY - 3; created.push(dot)
    } else {
      const cardY = findFreeY(desiredY, cardH, occupiedRight)
      card.x = frameRightX + LINE_GAP; card.y = cardY
      occupiedRight.push({ y: cardY, h: cardH })
      const ncx = Math.round(nodeBounds.x + nodeBounds.width), ccx = card.x
      const ccy = Math.round(cardY + cardH / 2)
      const line = figma.createLine(); line.name = `${TAG_PREFIX}Line #${i + 1}`
      line.strokeWeight = 1; line.strokes = [{ type: 'SOLID', color, opacity: 0.6 }]; line.dashPattern = [4, 3]
      figma.currentPage.appendChild(line)
      const dx = ccx - ncx, dy = ccy - nodeMidY, len = Math.sqrt(dx * dx + dy * dy), angle = Math.atan2(dy, dx)
      line.resize(len, 0); line.x = ncx; line.y = nodeMidY; line.rotation = -angle * (180 / Math.PI)
      created.push(line)
      const dot = figma.createEllipse(); dot.name = `${TAG_PREFIX}Dot #${i + 1}`; dot.resize(6, 6); dot.fills = [{ type: 'SOLID', color }]
      figma.currentPage.appendChild(dot); dot.x = ncx - 3; dot.y = nodeMidY - 3; created.push(dot)
    }
    created.push(card)
  }
  return { created, shown: pinIssues.length, total: issues.length }
}

// ─── Report Sheets ───
// One sheet per priority — a single grouped table let Critical bury Warning
// and Info under it visually; separate sheets give each its own space. A
// dedicated Off-System sheet holds anything not part of Amino at all
// (foreign/local components, deprecated or unrecognized tokens) so it never
// mixes with ordinary token-compliance findings.

async function createSummarySheet(brandInfo: BrandInfo, critCount: number, warnCount: number, infoCount: number, offSystemCount: number): Promise<FrameNode> {
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
  summaryText.characters = `Total: ${critCount + warnCount + infoCount} issues  |  Critical: ${critCount}  |  Warning: ${warnCount}  |  Info: ${infoCount}  |  Off-system flags: ${offSystemCount}`
  summaryText.fontSize = 13; summaryText.fills = [{ type: 'SOLID', color: { r: 0.25, g: 0.25, b: 0.25 } }]
  summaryText.textAutoResize = 'HEIGHT'
  sheet.appendChild(summaryText); summaryText.layoutAlign = 'STRETCH'

  const note = figma.createText()
  note.fontName = { family: 'Inter', style: 'Regular' }
  note.characters = 'Full lists below: one sheet per priority, plus a dedicated Off-System sheet for anything not part of the Amino design system.'
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

async function createPrioritySheet(priorityIssues: Issue[], priority: Priority, originalIndex: Map<Issue, number>): Promise<FrameNode> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' })

  const SHEET_W = 700
  const SHEET_CAP = 300
  const displayIssues = priorityIssues.slice(0, SHEET_CAP)

  const sheet = figma.createFrame()
  sheet.name = `${TAG_PREFIX}${priority[0].toUpperCase()}${priority.slice(1)} Issues`
  sheet.resize(SHEET_W, 1)
  sheet.layoutMode = 'VERTICAL'
  sheet.primaryAxisSizingMode = 'AUTO'
  sheet.paddingTop = 28; sheet.paddingBottom = 28; sheet.paddingLeft = 28; sheet.paddingRight = 28
  sheet.itemSpacing = 10
  sheet.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  sheet.cornerRadius = 16
  sheet.strokes = [{ type: 'SOLID', color: PRIORITY_COLORS[priority] }]
  sheet.strokeWeight = 1.5
  sheet.clipsContent = false

  const title = figma.createText()
  title.fontName = { family: 'Inter', style: 'Bold' }
  title.characters = priorityIssues.length > SHEET_CAP
    ? `${priority.toUpperCase()} Issues — showing ${SHEET_CAP} of ${priorityIssues.length}`
    : `${priority.toUpperCase()} Issues (${priorityIssues.length})`
  title.fontSize = 18
  title.fills = [{ type: 'SOLID', color: PRIORITY_COLORS[priority] }]
  sheet.appendChild(title)

  if (displayIssues.length === 0) {
    const empty = figma.createText()
    empty.fontName = { family: 'Inter', style: 'Regular' }
    empty.characters = `No ${priority} issues found — clean on this check.`
    empty.fontSize = 12
    empty.fills = [{ type: 'SOLID', color: { r: 0.3, g: 0.55, b: 0.35 } }]
    sheet.appendChild(empty)
    return sheet
  }

  for (let i = 0; i < displayIssues.length; i++) {
    const issue = displayIssues[i]
    const num = originalIndex.get(issue) ?? i + 1

    const row = figma.createFrame()
    row.name = `${TAG_PREFIX}Row ${num}`; row.layoutMode = 'VERTICAL'; row.primaryAxisSizingMode = 'AUTO'
    row.paddingTop = 8; row.paddingBottom = 8; row.paddingLeft = 12; row.paddingRight = 12
    row.itemSpacing = 3; row.cornerRadius = 8
    row.fills = i % 2 === 0 ? [{ type: 'SOLID', color: { r: 0.98, g: 0.98, b: 0.99 } }] : []
    sheet.appendChild(row); row.layoutAlign = 'STRETCH'

    const line1 = figma.createText()
    line1.fontName = { family: 'Inter', style: 'Bold' }
    line1.characters = `#${num}  ${issue.node && !issue.node.removed ? issue.node.name : '(removed)'}`
    line1.fontSize = 11; line1.fills = [{ type: 'SOLID', color: { r: 0.12, g: 0.12, b: 0.12 } }]
    line1.textAutoResize = 'WIDTH_AND_HEIGHT'; row.appendChild(line1); line1.layoutAlign = 'STRETCH'

    const line2 = figma.createText()
    line2.fontName = { family: 'Inter', style: 'Regular' }; line2.characters = `Issue: ${issue.issue}  |  Category: ${issue.category}`
    line2.fontSize = 11; line2.fills = [{ type: 'SOLID', color: { r: 0.35, g: 0.35, b: 0.35 } }]
    line2.textAutoResize = 'WIDTH_AND_HEIGHT'; row.appendChild(line2); line2.layoutAlign = 'STRETCH'

    const line3 = figma.createText()
    line3.fontName = { family: 'Inter', style: 'Medium' }; line3.characters = `Fix: ${issue.solution}`
    line3.fontSize = 11; line3.fills = [{ type: 'SOLID', color: { r: 0.1, g: 0.35, b: 0.7 } }]
    line3.textAutoResize = 'WIDTH_AND_HEIGHT'; row.appendChild(line3); line3.layoutAlign = 'STRETCH'
  }

  return sheet
}

async function createOffSystemSheet(flags: OffSystemFlag[]): Promise<FrameNode> {
  await figma.loadFontAsync({ family: 'Inter', style: 'Regular' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Bold' })
  await figma.loadFontAsync({ family: 'Inter', style: 'Medium' })

  const SHEET_W = 700
  const OFFSYS_COLOR = { r: 0.5, g: 0.15, b: 0.55 }
  const sheet = figma.createFrame()
  sheet.name = `${TAG_PREFIX}Off-System Flags`
  sheet.resize(SHEET_W, 1)
  sheet.layoutMode = 'VERTICAL'
  sheet.primaryAxisSizingMode = 'AUTO'
  sheet.paddingTop = 28; sheet.paddingBottom = 28; sheet.paddingLeft = 28; sheet.paddingRight = 28
  sheet.itemSpacing = 10
  sheet.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }]
  sheet.cornerRadius = 16
  sheet.strokes = [{ type: 'SOLID', color: OFFSYS_COLOR }]
  sheet.strokeWeight = 1.5
  sheet.clipsContent = false

  const title = figma.createText()
  title.fontName = { family: 'Inter', style: 'Bold' }
  title.characters = `Off-System Flags (${flags.length})`
  title.fontSize = 18
  title.fills = [{ type: 'SOLID', color: OFFSYS_COLOR }]
  sheet.appendChild(title)

  const subtitle = figma.createText()
  subtitle.fontName = { family: 'Inter', style: 'Regular' }
  subtitle.characters = 'Components not sourced from the Amino library, and elements bound to deprecated or unrecognized (non-Amino) tokens.'
  subtitle.fontSize = 11
  subtitle.fills = [{ type: 'SOLID', color: { r: 0.4, g: 0.4, b: 0.4 } }]
  subtitle.textAutoResize = 'HEIGHT'
  sheet.appendChild(subtitle)
  subtitle.layoutAlign = 'STRETCH'

  if (flags.length === 0) {
    const empty = figma.createText()
    empty.fontName = { family: 'Inter', style: 'Regular' }
    empty.characters = 'No off-system components or tokens found.'
    empty.fontSize = 12
    empty.fills = [{ type: 'SOLID', color: { r: 0.3, g: 0.55, b: 0.35 } }]
    sheet.appendChild(empty)
    return sheet
  }

  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i]
    const row = figma.createFrame()
    row.name = `${TAG_PREFIX}OffSys Row ${i + 1}`; row.layoutMode = 'VERTICAL'; row.primaryAxisSizingMode = 'AUTO'
    row.paddingTop = 8; row.paddingBottom = 8; row.paddingLeft = 12; row.paddingRight = 12
    row.itemSpacing = 3; row.cornerRadius = 8
    row.fills = i % 2 === 0 ? [{ type: 'SOLID', color: { r: 0.98, g: 0.97, b: 0.99 } }] : []
    sheet.appendChild(row); row.layoutAlign = 'STRETCH'

    const line1 = figma.createText()
    line1.fontName = { family: 'Inter', style: 'Bold' }
    line1.characters = `#${i + 1}  [${flag.kind}] ${flag.node && !flag.node.removed ? flag.node.name : '(removed)'}`
    line1.fontSize = 11; line1.fills = [{ type: 'SOLID', color: { r: 0.12, g: 0.12, b: 0.12 } }]
    line1.textAutoResize = 'WIDTH_AND_HEIGHT'; row.appendChild(line1); line1.layoutAlign = 'STRETCH'

    const line2 = figma.createText()
    line2.fontName = { family: 'Inter', style: 'Regular' }; line2.characters = flag.detail
    line2.fontSize = 11; line2.fills = [{ type: 'SOLID', color: { r: 0.35, g: 0.35, b: 0.35 } }]
    line2.textAutoResize = 'WIDTH_AND_HEIGHT'; row.appendChild(line2); line2.layoutAlign = 'STRETCH'

    const line3 = figma.createText()
    line3.fontName = { family: 'Inter', style: 'Medium' }; line3.characters = `Fix: ${flag.recommendation}`
    line3.fontSize = 11; line3.fills = [{ type: 'SOLID', color: OFFSYS_COLOR }]
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

// ─── Main Actions ───

async function runAuditAction(params: Params): Promise<void> {
  const target = figma.currentPage.selection.length > 0 ? figma.currentPage.selection[0] : null
  if (!target) { figma.notify('Select a frame to audit', { timeout: 3000 }); return }

  await clearAllGeneratedNodes()
  const { issues, brandInfo, offSystemFlags } = await runAudit(params)

  if (issues.length === 0 && offSystemFlags.length === 0) {
    figma.notify('No issues found — aligned with Amino Design System!', { timeout: 3000 }); return
  }

  const targetBounds = target.absoluteBoundingBox
  let pinsShown = 0
  let pinsTotal = 0
  if (targetBounds && issues.length > 0) {
    const pinResult = await placeCommentPins(issues, targetBounds)
    pinsShown = pinResult.shown
    pinsTotal = pinResult.total
  }

  const critIssues = issues.filter(i => i.priority === 'critical')
  const warnIssues = issues.filter(i => i.priority === 'warning')
  const infoIssues = issues.filter(i => i.priority === 'info')
  const originalIndex = new Map<Issue, number>()
  issues.forEach((iss, idx) => originalIndex.set(iss, idx + 1))

  const summarySheet = await createSummarySheet(brandInfo, critIssues.length, warnIssues.length, infoIssues.length, offSystemFlags.length)
  const critSheet = await createPrioritySheet(critIssues, 'critical', originalIndex)
  const warnSheet = await createPrioritySheet(warnIssues, 'warning', originalIndex)
  const infoSheet = await createPrioritySheet(infoIssues, 'info', originalIndex)
  const offSystemSheet = await createOffSystemSheet(offSystemFlags)
  const sheets = [summarySheet, critSheet, warnSheet, infoSheet, offSystemSheet]

  const baseX = targetBounds ? Math.round(targetBounds.x + targetBounds.width + 280) : 0
  const baseY = targetBounds ? Math.round(targetBounds.y) : 0
  const SHEET_GAP = 32
  let cursorY = baseY
  for (const sheet of sheets) {
    figma.currentPage.appendChild(sheet)
    sheet.x = baseX
    sheet.y = cursorY
    cursorY += sheet.height + SHEET_GAP
  }

  const pinNote = pinsShown < pinsTotal ? ` Canvas pins show ${pinsShown} of ${pinsTotal} issues (balanced across priorities) — full list in the report.` : ''
  figma.notify(`Amino Helps: ${issues.length} issues — ${critIssues.length} critical, ${warnIssues.length} warning, ${infoIssues.length} info, ${offSystemFlags.length} off-system.${pinNote}`, { timeout: 6000 })
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
