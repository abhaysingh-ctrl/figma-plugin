import type { VercelRequest, VercelResponse } from '@vercel/node'
import { parseFigmaUrl, fetchFrameData } from '../lib/figma'
import { runAudit } from '../lib/anthropic'

export const config = { maxDuration: 300 }

function setCors(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-audit-secret')
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  setCors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const expectedSecret = process.env.AUDIT_SHARED_SECRET
  if (expectedSecret && req.headers['x-audit-secret'] !== expectedSecret) {
    res.status(401).json({ error: 'Invalid or missing audit secret' })
    return
  }

  const url = (req.body as { url?: unknown } | undefined)?.url
  if (typeof url !== 'string' || url.length === 0) {
    res.status(400).json({ error: 'Request body must include a Figma frame url' })
    return
  }

  try {
    const { fileKey, nodeId } = parseFigmaUrl(url)
    const data = await fetchFrameData(fileKey, nodeId)
    const rawName = new URL(url).pathname.split('/').pop() || 'Screen'
    const screenName = decodeURIComponent(rawName)
    const report = await runAudit(data, screenName)
    res.status(200).json({ report })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    res.status(502).json({ error: message })
  }
}
