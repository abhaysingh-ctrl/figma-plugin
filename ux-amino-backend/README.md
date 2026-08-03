# UX Amino Backend

A single Vercel serverless endpoint (`POST /api/audit`) that lets the `ux-amino`
Figma plugin run a full UX audit automatically instead of the manual
copy-prompt-into-Claude-Code hand-off.

## Why this exists

The `ux-design-audit` skill (typography, spacing, components, copy,
information architecture, 12 UX laws, WCAG accessibility — all cited to real
sources) only runs inside Claude Code/claude.ai, which can't be triggered
programmatically by a third party. This service replicates that skill's
workflow directly against the Anthropic API:

1. Parse the Figma frame URL the plugin sends.
2. Fetch the frame's structure, a screenshot, and component metadata from the
   **Figma REST API** (`lib/figma.ts`) — the server-side equivalent of the
   `get_metadata`/`get_design_context` MCP tools.
3. Send that data to Claude (`lib/anthropic.ts`) with the audit rubric ported
   from the skill (`lib/prompt.ts`) as the system prompt, plus Anthropic's
   hosted `web_search` tool so it can cite real NN/g/Baymard/WCAG sources.
4. Return the finished markdown report to the plugin in one response.

## Deploy

```bash
npm install
npx vercel link      # or: npx vercel (first deploy prompts to link/create a project)
npx vercel env add FIGMA_TOKEN
npx vercel env add ANTHROPIC_API_KEY
npx vercel env add AUDIT_SHARED_SECRET
npx vercel env add ANTHROPIC_MODEL   # optional, defaults to claude-sonnet-5
npx vercel --prod
```

- **`FIGMA_TOKEN`** — a Figma personal access token scoped to
  `file_content:read` and `file_metadata:read` only (no write scopes needed).
  Figma no longer issues non-expiring tokens, so plan to rotate this.
- **`ANTHROPIC_API_KEY`** — from console.anthropic.com. This service bills
  per audit (~$0.35–0.90/run on the default model; see the architecture plan
  for the estimate).
- **`AUDIT_SHARED_SECRET`** — any long random string
  (`openssl rand -hex 32`). The only abuse control on this public endpoint —
  the plugin sends it as the `x-audit-secret` header.

After deploying, copy the deployment's domain into
`ux-amino/manifest.json`'s `networkAccess.allowedDomains`, rebuild the
plugin, and reload it in Figma.

## Local development

```bash
npm install
npx vercel dev
```

Then `curl -X POST http://localhost:3000/api/audit -H "x-audit-secret: <your secret>" -H "Content-Type: application/json" -d '{"url":"https://www.figma.com/design/<fileKey>/<name>?node-id=<id>"}'`.

## Type-checking

```bash
npm run typecheck
```

## Notes

- The Figma Variables API (`get_variable_defs`'s REST equivalent) is
  Enterprise-plan only, so it's deliberately not used. The audit's
  component-consistency check instead compares `componentId`/`componentSetId`
  against `GET /v1/files/:key/components`, which works on every plan.
- No streaming: Vercel's default 300s function timeout comfortably covers
  the expected 30–120s run, so the endpoint just waits for the complete
  report and returns it in one response. See the plugin's `ui.html` for the
  loading-state UI this implies.
