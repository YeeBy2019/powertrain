// Dev-only proxy for the optional LLM console. Not part of the production build:
// configureServer() is never called by `vite build`, so GitHub Pages stays static.
// Node's built-in fetch cannot reach the outside world on some Windows machines;
// curl can. Try fetch briefly, then fall back to curl.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function safeBase(raw) {
  const value = String(raw || '').trim()
  if (!/^https?:\/\/[^\s]+$/.test(value)) return null
  return value.replace(/\/$/, '')
}

async function viaFetch(base, key, body) {
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body,
    signal: AbortSignal.timeout(5000),
  })
  return { status: response.status, text: await response.text() }
}

async function viaCurl(base, key, body) {
  const marker = '\n__PW_HTTP_STATUS__'
  const args = [
    '-sS', '--max-time', '60', '-X', 'POST',
    '-H', 'Content-Type: application/json',
    '-H', `Authorization: Bearer ${key}`,
    '--data-binary', body,
    '-w', `${marker}%{http_code}`,
    `${base}/chat/completions`,
  ]
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 4 * 1024 * 1024, windowsHide: true })
  const at = stdout.lastIndexOf(marker)
  if (at < 0) return { status: 200, text: stdout }
  return {
    status: Number(stdout.slice(at + marker.length).trim()),
    text: stdout.slice(0, at),
  }
}

function llmProxy() {
  return {
    name: 'powertrain-llm-proxy',
    configureServer(server) {
      server.middlewares.use('/api/llm/chat/completions', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: { message: 'POST required' } }))
          return
        }
        const base = safeBase(req.headers['x-llm-base'])
        const key = String(req.headers['x-llm-key'] || '')
        if (!base || !key) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: { message: 'Missing x-llm-base or x-llm-key' } }))
          return
        }
        let body
        try {
          body = await readBody(req)
          JSON.parse(body) // fail early on malformed input
        } catch (error) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: { message: `Invalid request body: ${error.message}` } }))
          return
        }
        let result
        try {
          result = await viaFetch(base, key, body)
        } catch (fetchError) {
          try {
            result = await viaCurl(base, key, body)
          } catch (curlError) {
            res.statusCode = 502
            res.end(JSON.stringify({ error: { message: `Upstream unreachable: ${curlError.message}` } }))
            return
          }
        }
        res.statusCode = result.status
        res.end(result.text)
      })
    },
  }
}

export default { plugins: [llmProxy()] }
