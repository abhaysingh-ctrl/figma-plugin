import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import handler from './api/generate'

loadDotEnv()

const port = Number(process.env.PORT ?? 3300)

function loadDotEnv(): void {
  const path = '.env'
  if (!existsSync(path)) return

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match || process.env[match[1]]) continue
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      if (!body) return resolve(undefined)
      try { resolve(JSON.parse(body)) } catch { resolve(undefined) }
    })
    req.on('error', reject)
  })
}

createServer(async (req, res) => {
  const body = await readBody(req)
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string): void { res.setHeader(name, value) },
    status(code: number) { this.statusCode = code; return this },
    json(value: unknown): void {
      res.statusCode = this.statusCode
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(value))
    },
    end(): void { res.statusCode = this.statusCode; res.end() },
  }

  await handler({
    method: req.method,
    headers: req.headers,
    body,
  } as never, response as never)
}).listen(port, () => {
  console.log(`Sitemaps Amino backend listening at http://localhost:${port}`)
  console.log(`POST http://localhost:${port}/api/generate`)
})
