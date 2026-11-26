import { Hono } from 'hono'
import { createMcpHandler } from 'mcp-handler'
import { createCalendarClient } from './calendar-client.js'
import { createRateLimiter } from './rate-limit.js'
import { registerCalendarTools } from './tools.js'

export function createApp(options: {
  calendarClient?: ReturnType<typeof createCalendarClient>
  retryAfter?: ReturnType<typeof createRateLimiter>
} = {}) {
  const app = new Hono()
  const calendarClient = options.calendarClient ?? createCalendarClient({
    baseUrl: process.env.FERIADOS_API_BASE_URL,
    secret: process.env.FERIADOS_API_INTERNAL_SECRET,
  })
  const retryAfter = options.retryAfter ?? createRateLimiter({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
    environment: process.env.VERCEL_ENV,
  })
  const handler = createMcpHandler((server) => registerCalendarTools(server, calendarClient), {
    serverInfo: { name: 'argentina-mcp', version: '0.1.0' },
  })

  app.get('/health', (context) => context.json({ status: 'ok' }))
  app.all('/mcp', async (context) => {
    const request = context.req.raw
    const origin = request.headers.get('origin')
    if (origin && origin !== new URL(request.url).origin) {
      return context.json({ error: 'invalid_origin' }, 403)
    }
    const seconds = await retryAfter(request)
    if (seconds !== undefined) {
      return context.json({ error: 'rate_limit_exceeded' }, 429, {
        'Retry-After': String(seconds),
        'Cache-Control': 'no-store',
      })
    }
    return handler(request)
  })
  return app
}

export default createApp()
