import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

export interface ProxyConfig {
  upstreamBaseUrl: string
  apiKey: string
}

export interface ProxyOutcome {
  status: number
  model: string | null
  promptChars: number
  completionChars: number
  latencyMs: number
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function modelFromBody(body: Buffer): string | null {
  if (body.length === 0) return null
  try {
    const parsed = JSON.parse(body.toString('utf8')) as { model?: unknown }
    return typeof parsed.model === 'string' ? parsed.model : null
  } catch {
    return null
  }
}

function sendUpstreamError(response: ServerResponse, message: string): void {
  if (response.headersSent) {
    response.destroy()
    return
  }
  response.statusCode = 502
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ error: message }))
}

/**
 * Forwards one request to the upstream (DeepSeek) API, swapping the caller's
 * bearer token for the gateway's own key, and streams the response through.
 * The returned outcome describes the exchange for usage accounting.
 */
export async function proxyRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: ProxyConfig,
): Promise<ProxyOutcome> {
  const started = Date.now()
  const body = await readBody(request)
  const model = modelFromBody(body)

  const upstreamUrl = new URL(request.url ?? '/', withTrailingSlash(config.upstreamBaseUrl)).toString()
  const forwardedHeaders: Record<string, string> = { authorization: `Bearer ${config.apiKey}` }
  const contentType = request.headers['content-type']
  if (contentType !== undefined) forwardedHeaders['content-type'] = String(contentType)
  const accept = request.headers['accept']
  if (accept !== undefined) forwardedHeaders.accept = String(accept)

  let upstream: Response
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: forwardedHeaders,
      body: body.length > 0 ? new Uint8Array(body) : undefined,
      redirect: 'manual',
    })
  } catch (error) {
    sendUpstreamError(response, `upstream unreachable: ${messageFrom(error)}`)
    return {
      status: 502,
      model,
      promptChars: body.length,
      completionChars: 0,
      latencyMs: Date.now() - started,
    }
  }

  response.statusCode = upstream.status
  const upstreamType = upstream.headers.get('content-type')
  if (upstreamType !== null) response.setHeader('content-type', upstreamType)

  let completionChars = 0
  if (upstream.body === null) {
    response.end()
    return { status: upstream.status, model, promptChars: body.length, completionChars, latencyMs: Date.now() - started }
  }

  await new Promise<void>((resolve) => {
    const onDone = (): void => resolve()
    response.once('finish', onDone)
    response.once('close', onDone)
    const stream = Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream)
    stream.on('data', (chunk: Buffer) => {
      completionChars += chunk.length
    })
    stream.on('error', () => response.destroy())
    stream.pipe(response)
  })

  return { status: upstream.status, model, promptChars: body.length, completionChars, latencyMs: Date.now() - started }
}

function withTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
