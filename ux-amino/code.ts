// UX Amino — runs the `ux-design-audit` rubric on the selected Figma frame
// automatically via a backend service (see ux-amino-backend/), and falls
// back to copying a Claude Code hand-off prompt if that call can't be made.
//
// The skill needs LLM judgment + live web search to cite real sources (NN/g,
// Baymard, Growth.Design, WCAG), which can't run inside the Figma sandbox —
// the backend replicates it via the raw Anthropic API instead.

const UI_WIDTH = 360
const UI_INITIAL_HEIGHT = 460
const UI_MIN_HEIGHT = 200
const UI_MAX_HEIGHT = 720

const PROMPT_PREFIX = 'Run a ux-design-audit on this Figma frame: '

// Must match manifest.json's networkAccess.allowedDomains and the deployed
// ux-amino-backend/ domain. Update all three together after deploying.
const BACKEND_URL = 'https://ux-amino-backend.vercel.app/api/audit'

type StateKind = 'empty' | 'multi' | 'no-file-key' | 'ready'

interface StateMessage {
  type: 'state'
  kind: StateKind
  title: string
  body: string
  /** Frame share URL the backend audits. '' when there's nothing to audit. */
  frameUrl: string
  /** Manual Claude Code hand-off text, for the fallback path. */
  prompt: string
  backendUrl: string
  primary: { enabled: boolean; label: string }
  /** Shown only in the no-file-key state, as a fallback. */
  secondary: { visible: boolean; label: string }
}

// ─── URL construction ───

/** Figma slugifies file names in share links: "My File! v2" -> "My-File-v2". */
function slugifyFileName(name: string): string {
  const slug = name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return slug.length > 0 ? encodeURIComponent(slug) : 'Untitled'
}

/**
 * Node ids use ':' internally ("123:456", or "I12:34;56:78" inside an
 * instance) but '-' in share URLs. Semicolons are kept as-is by Figma.
 */
function toUrlNodeId(nodeId: string): string {
  return nodeId.replace(/:/g, '-')
}

function buildFrameUrl(fileKey: string, fileName: string, nodeId: string): string {
  return (
    'https://www.figma.com/design/' +
    fileKey +
    '/' +
    slugifyFileName(fileName) +
    '?node-id=' +
    toUrlNodeId(nodeId)
  )
}

// ─── State ───

function computeState(): StateMessage {
  const selection = figma.currentPage.selection

  if (selection.length === 0) {
    return {
      type: 'state',
      kind: 'empty',
      title: 'Select a frame',
      body: 'Click one frame, component, or group on the canvas to run its UX audit.',
      frameUrl: '',
      prompt: '',
      backendUrl: BACKEND_URL,
      primary: { enabled: false, label: 'Select a frame' },
      secondary: { visible: false, label: 'Copy prompt for Claude Code instead' },
    }
  }

  if (selection.length > 1) {
    return {
      type: 'state',
      kind: 'multi',
      title: selection.length + ' layers selected',
      body: 'A UX audit runs on one screen at a time. Deselect until exactly one frame is selected.',
      frameUrl: '',
      prompt: '',
      backendUrl: BACKEND_URL,
      primary: { enabled: false, label: 'Select just one frame' },
      secondary: { visible: false, label: 'Copy prompt for Claude Code instead' },
    }
  }

  const node = selection[0]
  const fileKey = figma.fileKey

  if (!fileKey) {
    return {
      type: 'state',
      kind: 'no-file-key',
      title: 'No shareable link for this file',
      body: 'Figma only exposes this file key to dev-mode and org-private plugins, so the automated audit and the manual hand-off both need it. Right-click the frame, choose "Copy link to selection", and paste the ux-design-audit prompt yourself in Claude Code.',
      frameUrl: '',
      prompt: PROMPT_PREFIX,
      backendUrl: BACKEND_URL,
      primary: { enabled: false, label: 'Link unavailable' },
      secondary: { visible: true, label: 'Copy prompt text only' },
    }
  }

  const url = buildFrameUrl(fileKey, figma.root.name, node.id)
  return {
    type: 'state',
    kind: 'ready',
    title: node.name,
    body: node.type.toLowerCase().replace(/_/g, ' ') + ' · node ' + toUrlNodeId(node.id),
    frameUrl: url,
    prompt: PROMPT_PREFIX + url,
    backendUrl: BACKEND_URL,
    primary: { enabled: true, label: 'Run UX Audit' },
    secondary: { visible: true, label: 'Copy prompt for Claude Code instead' },
  }
}

function pushState(): void {
  figma.ui.postMessage(computeState())
}

// ─── UI setup ───

figma.showUI(__uiFiles__['ui'], {
  width: UI_WIDTH,
  height: UI_INITIAL_HEIGHT,
  title: 'UX Amino',
})
pushState()
figma.on('selectionchange', pushState)

figma.ui.onmessage = (msg: { type: string; height?: number; ok?: boolean; message?: string }) => {
  if (msg.type === 'resize' && typeof msg.height === 'number') {
    figma.ui.resize(
      UI_WIDTH,
      Math.max(UI_MIN_HEIGHT, Math.min(UI_MAX_HEIGHT, Math.round(msg.height))),
    )
    return
  }

  if (msg.type === 'ready') {
    pushState()
    return
  }

  if (msg.type === 'copied') {
    if (msg.ok) {
      figma.notify('Prompt copied — paste it into Claude Code', { timeout: 2500 })
    } else {
      figma.notify('Could not copy automatically — select the text in the plugin window and press Cmd/Ctrl+C', {
        error: true,
        timeout: 4000,
      })
    }
    return
  }

  if (msg.type === 'audit-success') {
    figma.notify('UX audit complete', { timeout: 2500 })
    return
  }

  if (msg.type === 'audit-error') {
    figma.notify(msg.message || 'The audit request failed', { error: true, timeout: 5000 })
  }
}
