# Sitemaps Amino Backend

A single Vercel serverless endpoint (`POST /api/generate`) that lets the
`sitemaps-amino` Figma plugin discover a website's page structure. This
does the actual fetching server-side because Figma plugin UI iframes can
only reach domains listed in `manifest.json`'s `networkAccess.allowedDomains`
— arbitrary user-supplied websites can't be fetched directly from the plugin.

## How it works

1. Parse and validate the website URL the plugin sends.
2. Try `sitemap.xml` / `sitemap_index.xml` first (`lib/sitemap.ts`) — fast,
   and respects what the site actually publishes. Recurses into sitemap
   indexes, dedupes/canonicalizes URLs, and builds a hierarchy from path
   segments (`lib/tree.ts`) since a flat URL list carries no parent info.
3. If no usable sitemap is found, fall back to crawling
   (`lib/crawler.ts`): BFS same-origin links from the homepage, bounded by
   depth, page count, and a wall-clock time budget — the hierarchy here is
   just each page's first-seen parent link.
4. Return a `SitemapResult` (flat node list + `source`/`truncated`/`warnings`)
   to the plugin, which lays it out and draws it on the Figma canvas.

## Deploy

```bash
npm install
npx vercel link      # or: npx vercel (first deploy prompts to link/create a project)
npx vercel env add SITEMAP_SHARED_SECRET
npx vercel --prod
```

- **`SITEMAP_SHARED_SECRET`** — any long random string
  (`openssl rand -hex 32`). The only abuse control on this public endpoint —
  the plugin sends it as the `x-sitemap-secret` header.

After deploying, copy the deployment's domain into
`sitemaps-amino/manifest.json`'s `networkAccess.allowedDomains` and
`sitemaps-amino/code.ts`'s `BACKEND_URL`, rebuild the plugin, and reload it
in Figma.

## Local development

```bash
npm install
npx vercel dev
```

Then:

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -H "x-sitemap-secret: <your secret>" \
  -d '{"url":"https://example.com"}'
```

Optional body fields: `maxDepth` (default 3, hard cap 6) and `maxPages`
(default 300, hard cap 500).

## Type-checking

```bash
npm run typecheck
```

## Notes

- No headless browser — link/title extraction uses `cheerio` against the raw
  HTML, which is enough for server-rendered sites but won't discover pages
  only reachable via client-side-rendered navigation.
- The crawl fallback stops at an internal ~90s time budget (under the 120s
  `maxDuration`) and returns whatever was gathered with `truncated: true`
  rather than let Vercel kill the function with no response.
