// ux-audit — hands the selected Figma frame off to Claude Code's
// `ux-design-audit` skill.
//
// The audit itself needs LLM judgment + web search, so it cannot run inside
// the Figma sandbox. This plugin's only job is to build the correct shareable
// frame link and a canned prompt, so the hand-off is one click instead of
// "copy link to selection" + typing the prompt by hand.

const UI_WIDTH = 340
const UI_INITIAL_HEIGHT = 380
const UI_MIN_HEIGHT = 160
const UI_MAX_HEIGHT = 600

const PROMPT_PREFIX = 'Run a ux-design-audit on this Figma frame: '

type StatusKind = 'ready' | 'empty' | 'multi' | 'no-file-key'

interface CopyStateMessage {
  type: 'copy-state'
  status: { kind: StatusKind; title: string; body: string }
  /** Full text the Copy button writes to the clipboard. '' when nothing to copy. */
  prompt: string
  actions: {
    copy: { enabled: boolean; label: string }
    copyPrefix: { visible: boolean; label: string }
  }
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

function computeState(): CopyStateMessage {
  const selection = figma.currentPage.selection

  if (selection.length === 0) {
    return {
      type: 'copy-state',
      status: {
        kind: 'empty',
        title: 'Select a frame',
        body: 'Click one frame (or component/group) on the canvas and its audit prompt will appear here.',
      },
      prompt: '',
      actions: {
        copy: { enabled: false, label: 'Select a frame' },
        copyPrefix: { visible: false, label: 'Copy prompt text only' },
      },
    }
  }

  if (selection.length > 1) {
    return {
      type: 'copy-state',
      status: {
        kind: 'multi',
        title: selection.length + ' layers selected',
        body: 'A UX audit runs on one screen at a time. Deselect until exactly one frame is selected.',
      },
      prompt: '',
      actions: {
        copy: { enabled: false, label: 'Select just one frame' },
        copyPrefix: { visible: false, label: 'Copy prompt text only' },
      },
    }
  }

  const node = selection[0]
  const fileKey = figma.fileKey

  if (!fileKey) {
    return {
      type: 'copy-state',
      status: {
        kind: 'no-file-key',
        title: 'No shareable link for this file',
        body: 'Figma only exposes this file key to dev-mode and org-private plugins. Copy the prompt text below, then right-click the frame in Figma, choose "Copy link to selection", and paste the link at the end.',
      },
      prompt: PROMPT_PREFIX,
      actions: {
        copy: { enabled: false, label: 'Link unavailable' },
        copyPrefix: { visible: true, label: 'Copy prompt text only' },
      },
    }
  }

  const url = buildFrameUrl(fileKey, figma.root.name, node.id)
  return {
    type: 'copy-state',
    status: {
      kind: 'ready',
      title: node.name,
      body: node.type.toLowerCase().replace(/_/g, ' ') + ' · node ' + toUrlNodeId(node.id),
    },
    prompt: PROMPT_PREFIX + url,
    actions: {
      copy: { enabled: true, label: 'Copy Audit Prompt' },
      copyPrefix: { visible: false, label: 'Copy prompt text only' },
    },
  }
}

function pushState(): void {
  figma.ui.postMessage(computeState())
}

// ─── UI setup ───

figma.showUI(__uiFiles__['ui'], {
  width: UI_WIDTH,
  height: UI_INITIAL_HEIGHT,
  title: 'UX Audit hand-off',
})
pushState()
figma.on('selectionchange', pushState)

figma.ui.onmessage = (msg: { type: string; height?: number; ok?: boolean }) => {
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
      figma.notify('Audit prompt copied — paste it into Claude Code', { timeout: 2500 })
    } else {
      figma.notify('Could not copy automatically — select the text in the plugin window and press Cmd/Ctrl+C', {
        error: true,
        timeout: 4000,
      })
    }
  }
}
