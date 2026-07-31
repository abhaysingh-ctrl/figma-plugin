# UX Audit

A one-button Figma plugin that hands the selected frame off to Claude Code's
`ux-design-audit` skill. Select a single frame, click **Copy Audit Prompt**, and
the plugin puts a ready-to-paste prompt on your clipboard:
`Run a ux-design-audit on this Figma frame: https://www.figma.com/design/<fileKey>/<fileName>?node-id=<nodeId>`.

Paste that into a Claude Code session that has the Figma MCP server connected and
the holistic UX review (typography, spacing, accessibility/WCAG, UX laws,
information architecture, copy) runs there — those checks need LLM judgment and
web search, so they can't run inside Figma's sandbox. The plugin's only job is to
build the correct node-scoped share link and the prompt text so the hand-off is
one click instead of "copy link to selection" plus typing.

## Build & run locally

```bash
npm install
npm run build        # tsc -p tsconfig.json  ->  code.js
```

Then in Figma desktop: **Plugins → Development → Import plugin from manifest…**
and pick `ux-audit/manifest.json`. `code.js` is gitignored, so always build
before importing.

## Notes

- `manifest.json` sets `"enablePrivatePluginApi": true` because `figma.fileKey`
  (needed to build the share link) is only exposed to dev-mode and org-private
  plugins. If the file key is unavailable, the plugin says so and offers to copy
  just the prompt text so you can paste your own "Copy link to selection" URL.
- `editorType` is `["figma"]` only — the `figma.com/design/...` link form applies
  to design files, not FigJam/Slides/Buzz.
- No network access is used; the clipboard write is local.
