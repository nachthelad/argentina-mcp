import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'

const LIMIT = 60
const WINDOW_SECONDS = 60
const COUNT_REQUEST = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { count, redis.call('TTL', KEYS[1]) }
`
const counterResult = z.object({ result: z.tuple([z.number().int().positive(), z.number().int().nonnegative()]) })

export function createRateLimiter(options: {
  url?: string
  token?: string
  environment?: string
  fetch?: typeof fetch
  warn?: (event: { event: string; request_id: string; error_type: string }) => void
}) {
  const send = options.fetch ?? fetch
  const warn = options.warn ?? ((event) => console.warn(JSON.stringify(event)))

  return async function retryAfter(request: Request): Promise<number | undefined> {
    const requestId = request.headers.get('x-vercel-id') ?? randomUUID()
    try {
      if (!options.url || !options.token) {
        if (!options.environment) return
        throw new Error('MissingRedisConfiguration')
      }
      const address = options.environment
        ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim()
        : '127.0.0.1'
      if (!address || !isIP(address)) throw new Error('MissingClientIp')
      const ipHash = createHash('sha256').update(address).digest('hex')
      const key = `argentina-mcp:${options.environment ?? 'local'}:request:${ipHash}`
      const response = await send(options.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['EVAL', COUNT_REQUEST, 1, key, WINDOW_SECONDS]),
        signal: AbortSignal.timeout(500),
        redirect: 'error',
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('RedisHttpError')
      const { result: [count, ttl] } = counterResult.parse(await response.json())
      return count > LIMIT ? Math.max(1, ttl) : undefined
    } catch (error) {
      const knownErrors = ['MissingRedisConfiguration', 'MissingClientIp', 'RedisHttpError']
      const errorType = error instanceof Error && knownErrors.includes(error.message) ? error.message
        : error instanceof Error ? error.name : 'UnknownError'
      warn({ event: 'rate_limiter_unavailable', request_id: requestId, error_type: errorType })
    }
  }
}
