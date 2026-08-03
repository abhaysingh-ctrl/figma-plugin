# UX Amino

A Figma plugin that runs a holistic UX audit — typography, spacing, icon
style, components, copy vs. brand voice, information architecture, 12 named
UX laws, and WCAG accessibility, each finding cited to NN/g, Baymard,
Growth.Design, or a WCAG success criterion — on the selected frame.

Select a single frame and click **Run UX Audit**. The plugin sends the frame
to the [`ux-amino-backend`](../ux-amino-backend) service, which fetches the
frame's real structure/styles/screenshot from the Figma REST API and runs the
`ux-design-audit` rubric against the Anthropic API (with web search enabled,
so citations are real sources, not guesses). The finished markdown report
renders directly in the plugin panel — no manual copy-paste, no separate
Claude Code session.

That audit needs LLM judgment and live web search, so it can't run inside
Figma's plugin sandbox — the backend does the actual work; this plugin just
prepares the request and displays the result.

**Fallback:** if the backend call fails, times out, or you'd rather avoid the
API cost for a given run, click **Copy prompt for Claude Code instead** to
get the same audit the manual way — paste it into a Claude Code session with
the Figma MCP server connected.

For Amino design-system token compliance instead, use the sibling
`amino-help` plugin.

## Setup

This plugin needs a deployed backend to run audits automatically:

1. Deploy [`ux-amino-backend`](../ux-amino-backend) (see its README) and note
   the deployed domain.
2. Update `manifest.json`'s `networkAccess.allowedDomains` and the
   `BACKEND_URL` constant in `code.ts` to that domain.
3. Update the `AUDIT_SHARED_SECRET` constant in `ui.html` to match the
   backend's `AUDIT_SHARED_SECRET` environment variable.
4. Rebuild (`npm run build`) and reload the plugin in Figma.

Without a deployed backend, **Run UX Audit** will fail — use the **Copy
prompt for Claude Code instead** fallback until it's set up.

## Build & run locally

```bash
npm install
npm run build        # esbuild -> code.js
```

Then in Figma desktop: **Plugins → Development → Import plugin from manifest…**
and pick `ux-amino/manifest.json`. `code.js` is gitignored, so always build
before importing.

## Notes

- `manifest.json` sets `"enablePrivatePluginApi": true` because `figma.fileKey`
  (needed to build the share link) is only exposed to dev-mode and org-private
  plugins. If the file key is unavailable, both the automated audit and the
  manual hand-off need it — the plugin says so and offers the "Copy link to
  selection" workaround.
- `editorType` is `["figma"]` only — the `figma.com/design/...` link form applies
  to design files, not FigJam/Slides/Buzz.
- `networkAccess.allowedDomains` is scoped to the deployed backend only — no
  other network access is used.
