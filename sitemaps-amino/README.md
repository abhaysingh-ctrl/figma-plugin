# Sitemaps Amino

A Figma plugin that draws a visual sitemap — a tree diagram of boxes and
connectors showing parent → child page structure — on the canvas, from a
single website URL.

Enter a URL and click **Generate Sitemap**. The plugin sends the URL to the
[`sitemaps-amino-backend`](../sitemaps-amino-backend) service, which tries
`sitemap.xml` first (fast, respects what the site publishes) and falls back
to crawling same-domain links from the homepage if none exists. The backend
does the actual fetching because Figma plugin UI iframes can only reach
domains listed in `manifest.json`'s `networkAccess.allowedDomains` — an
arbitrary user-supplied website can't be fetched directly from the plugin.

The returned page list is laid out as a top-down tree (root at top, one box
per page, straight connector lines to each child) and drawn directly onto
the current page.

## Setup

This plugin needs a deployed backend to generate sitemaps:

1. Deploy [`sitemaps-amino-backend`](../sitemaps-amino-backend) (see its
   README) and note the deployed domain.
2. Update `manifest.json`'s `networkAccess.allowedDomains` and the
   `BACKEND_URL` constant in `code.ts` to that domain.
3. Update the `SITEMAP_SHARED_SECRET` constant in `ui.html` to match the
   backend's `SITEMAP_SHARED_SECRET` environment variable.
4. Rebuild (`npm run build`) and reload the plugin in Figma.

Without a deployed backend, **Generate Sitemap** will fail.

## Build & run locally

```bash
npm install
npm run build        # esbuild -> code.js
```

Then in Figma desktop: **Plugins → Development → Import plugin from manifest…**
and pick `sitemaps-amino/manifest.json`. `code.js` is gitignored, so always
build before importing.

## Notes

- `editorType` is `["figma"]` only. `figma.createConnector()` (a real
  connector node with anchors) is FigJam-only, so connectors here are drawn
  as plain rotated `LineNode`s between each parent's bottom-center and each
  child's top-center.
- Large or flat sites are capped (300 pages by default, 500 hard ceiling;
  30 children per parent, with a synthetic "+N more" node for the rest) so
  the canvas stays readable and the backend's crawl has a bounded runtime.
- `networkAccess.allowedDomains` is scoped to the deployed backend only — no
  other network access is used.
