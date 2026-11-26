import { expect, it, vi } from 'vitest'
import { createCalendarClient } from '../src/calendar-client.js'
import { createApp } from '../src/index.js'
import { createRateLimiter } from '../src/rate-limit.js'

const headers = { 'x-vercel-forwarded-for': '203.0.113.1', 'x-vercel-id': 'vercel-test-id' }
const redis = { url: 'https://redis.example/', token: 'fixture-token', environment: 'preview' }
const discovery = {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'fixture', version: '1' } },
  }),
}

it('counts per IP and returns 429 and Retry-After only after the 60th request', async () => {
  const calls = new Map<string, number>()
  const retryAfter = createRateLimiter({
    ...redis,
    fetch: async (_, init) => {
      const [command, , , key, window] = JSON.parse(String(init?.body))
      expect(command).toBe('EVAL')
      expect(window).toBe(60)
      const count = (calls.get(key) ?? 0) + 1
      calls.set(key, count)
      return Response.json({ result: [count, 30] })
    },
  })
  const app = createApp({ retryAfter })
  for (let index = 0; index < 59; index++) {
    expect(await retryAfter(new Request('https://mcp.example/mcp', { headers }))).toBeUndefined()
  }
  expect((await app.request('/mcp', discovery)).status).toBe(200)
  const rejected = await app.request('/mcp', discovery)
  expect(rejected.status).toBe(429)
  expect(rejected.headers.get('retry-after')).toBe('30')
  const other = { ...discovery, headers: { ...discovery.headers, 'x-vercel-forwarded-for': '203.0.113.2' } }
  expect((await app.request('/mcp', other)).status).toBe(200)
  calls.clear()
  expect((await app.request('/mcp', discovery)).status).toBe(200)
})

it.each(['outage', 'timeout'])('fails open and logs the Redis %s', async (failure) => {
  const warn = vi.fn()
  const retryAfter = createRateLimiter({
    ...redis,
    warn,
    fetch: async (_, init) => {
      if (failure === 'outage') return Response.json({}, { status: 503 })
      const signal = init?.signal
      return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
    },
  })
  const source_url = 'https://www.argentina.gob.ar/feriados'
  const upstream = vi.fn<typeof fetch>(async () => Response.json({
    date: '2026-02-13', jurisdiction: 'AR', calendar: 'general', is_business_day: true,
    reasons: [], source_url, legal_reference: null,
    sources: [{ role: 'calendar', source_url, legal_reference: null }],
  }))
  const calendarClient = createCalendarClient({
    baseUrl: 'https://origin.example', secret: 'fixture-token', fetch: upstream,
  })
  const response = await createApp({ retryAfter, calendarClient }).request('/mcp', {
    ...discovery,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'is_business_day', arguments: { date: '2026-02-13', jurisdiction: 'AR', calendar: 'general' } },
    }),
  })
  expect(response.status).toBe(200)
  expect(upstream).toHaveBeenCalledOnce()
  expect(await response.text()).toContain(source_url)
  expect(warn).toHaveBeenCalledExactlyOnceWith({
    event: 'rate_limiter_unavailable',
    request_id: 'vercel-test-id',
    error_type: failure === 'timeout' ? 'TimeoutError' : 'RedisHttpError',
  })
})
