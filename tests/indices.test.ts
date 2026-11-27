import { serve } from '@hono/node-server'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import fc from 'fast-check'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createCalendarClient } from '../src/calendar-client.js'
import { createIndexClient } from '../src/index-client.js'
import { adjustOutput, getIndexOutput } from '../src/index-contract.js'
import { createApp } from '../src/index.js'

const monetary = {
  organization: 'Banco Central de la República Argentina',
  publisher: 'Subsecretaría de Programación Macroeconómica',
  datasetUrl: 'https://www.datos.gob.ar/dataset/sspm-cer-uva-uvi',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
}
const ipcSource = {
  organization: 'Instituto Nacional de Estadística y Censos',
  publisher: 'Subsecretaría de Programación Macroeconómica',
  datasetUrl: 'https://datos.gob.ar/dataset/sspm-indice-precios-al-consumidor-nacional-ipc-base-diciembre-2016',
  license: 'CC BY 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
}
const monetaryProvenance = {
  source_url: monetary.datasetUrl,
  legal_reference: monetary.organization,
  sources: [
    { role: 'dataset', source_url: monetary.datasetUrl, legal_reference: monetary.organization },
    { role: 'license', source_url: monetary.licenseUrl, legal_reference: monetary.license },
  ],
}
const ipcProvenance = {
  source_url: ipcSource.datasetUrl,
  legal_reference: ipcSource.organization,
  sources: [
    { role: 'dataset', source_url: ipcSource.datasetUrl, legal_reference: ipcSource.organization },
    { role: 'license', source_url: ipcSource.licenseUrl, legal_reference: ipcSource.license },
  ],
}

function decimal(value: string) {
  const [whole = '0', fraction = ''] = value.split('.')
  return { units: BigInt(whole + fraction), scale: 10n ** BigInt(fraction.length) }
}

function rounded(numerator: bigint, denominator: bigint, places: number) {
  const absolute = numerator < 0n ? -numerator : numerator
  const scaled = absolute * 10n ** BigInt(places)
  const units = (2n * scaled + denominator) / (2n * denominator)
  const digits = units.toString().padStart(places + 1, '0')
  const sign = numerator < 0n && units !== 0n ? '-' : ''
  return sign + digits.slice(0, -places) + '.' + digits.slice(-places)
}

function ratioText(numerator: bigint, denominator: bigint) {
  if (numerator === 0n) return '0'
  const magnitude = (numerator < 0n ? -numerator : numerator).toString().length
  const places = 18 + Math.max(0, denominator.toString().length - magnitude)
  return rounded(numerator, denominator, places).replace(/0+$/, '').replace(/\.$/, '')
}

function adjustAmount(amount: string, start: string, end: string) {
  const first = decimal(start)
  const last = decimal(end)
  const numerator = last.units * first.scale
  const denominator = first.units * last.scale
  const money = decimal(amount)
  return {
    factor: ratioText(numerator, denominator),
    adjustedAmount: rounded(money.units * numerator, money.scale * denominator, 2),
  }
}

function cents(value: string) {
  const [whole = '0', fraction = ''] = value.split('.')
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2))
}

function roundTripCents(start: string, end: string) {
  const first = decimal(start)
  const last = decimal(end)
  const left = first.units * last.scale
  const right = last.units * first.scale
  const larger = left > right ? left : right
  const smaller = left > right ? right : left
  return (larger + 3n * smaller - 1n) / (2n * smaller)
}

function centsText(value: number) {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`
}

const calendarClient = createCalendarClient({
  baseUrl: 'https://calendar.example/',
  secret: 'calendar-secret',
  fetch: async () => Response.json({}),
})

async function withMcp(upstream: typeof fetch, check: (client: Client) => Promise<void>) {
  const app = createApp({
    calendarClient,
    indexClient: createIndexClient({ baseUrl: 'https://indices.example/', secret: 'index-secret', fetch: upstream }),
  })
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  const client = new Client({ name: 'argentina-mcp-test', version: '0.2.0' })
  try {
    if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an HTTP server.')
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)))
    await check(client)
  } finally {
    await client.close()
    server.close()
  }
}

describe('index tools', () => {
  it('reads a UVA value and adjusts an IPC amount without numeric drift', async () => {
    const upstream = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input))
      expect(new Headers(init?.headers).get('x-internal-api-key')).toBe('index-secret')
      if (url.pathname === '/v1/indexes/UVA/on/2016-04-01') {
        return Response.json({
          code: 'UVA', frequency: 'daily', date: '2016-04-01', value: '14.05',
          importedAt: '2026-11-17T18:00:00.000Z', source: monetary,
        })
      }
      if (url.pathname === '/v1/indexes/IPC' && url.searchParams.get('from') === '2017-01-01') {
        expect(url.searchParams.get('to')).toBe('2017-01-31')
        return Response.json({
          code: 'IPC', frequency: 'monthly', source: ipcSource,
          observations: [{ date: '2017-01-01', period: '2017-01', value: '101.5859', importedAt: '2026-11-17T18:00:00.000Z' }],
        })
      }
      if (url.pathname === '/v1/indexes/CER') {
        expect(url.searchParams.get('from')).toBe('2016-04-01')
        expect(url.searchParams.get('to')).toBe('2016-04-02')
        return Response.json({
          code: 'CER', frequency: 'daily', source: monetary,
          observations: [
            { date: '2016-04-01', value: '5.5900', importedAt: '2026-11-17T18:00:00.000Z' },
            { date: '2016-04-02', value: '5.6000', importedAt: '2026-11-17T18:00:00.000Z' },
          ],
        })
      }
      expect(url.pathname).toBe('/v1/adjust')
      expect(url.searchParams.get('index')).toBe('IPC')
      expect(url.searchParams.get('amount')).toBe('10000.00')
      expect(url.searchParams.get('from')).toBe('2016-12')
      expect(url.searchParams.get('to')).toBe('2017-01')
      return Response.json({
        index: 'IPC', amount: '10000.00', factor: '1.015859', adjustedAmount: '10158.59',
        from: { period: '2016-12', value: '100.0' }, to: { period: '2017-01', value: '101.5859' },
        source: ipcSource,
      })
    })
    await withMcp(upstream, async (client) => {
      const { tools } = await client.listTools()
      for (const name of ['get_index', 'adjust_amount_by_index']) {
        const tool = tools.find((item) => item.name === name)
        expect(tool?.annotations?.readOnlyHint).toBe(true)
        expect(tool?.outputSchema).toBeTruthy()
      }

      const uva = await client.callTool({ name: 'get_index', arguments: { index: 'UVA', date: '2016-04-01' } })
      expect(uva.isError ?? false).toBe(false)
      expect(uva.structuredContent).toEqual({
        data: {
          index: 'UVA', frequency: 'daily', date: '2016-04-01',
          observations: [{ date: '2016-04-01', value: '14.05' }],
        },
        ...monetaryProvenance,
      })
      expect(getIndexOutput.parse(uva.structuredContent).data.observations[0]?.value).toBe('14.05')
      expect(uva.content).toContainEqual({ type: 'text', text: JSON.stringify(uva.structuredContent) })

      const month = await client.callTool({ name: 'get_index', arguments: { index: 'IPC', period: '2017-01' } })
      expect(month.structuredContent).toMatchObject({
        data: { index: 'IPC', period: '2017-01', observations: [{ period: '2017-01', value: '101.5859' }] },
        ...ipcProvenance,
      })

      const range = await client.callTool({
        name: 'get_index', arguments: { index: 'CER', from: '2016-04-01', to: '2016-04-02' },
      })
      expect(range.structuredContent).toMatchObject({
        data: { observations: [{ value: '5.5900' }, { value: '5.6000' }] },
        source_url: monetary.datasetUrl,
      })

      const adjusted = await client.callTool({
        name: 'adjust_amount_by_index',
        arguments: { index: 'IPC', amount: '10000.00', from: '2016-12', to: '2017-01' },
      })
      expect(adjusted.structuredContent).toEqual({
        data: {
          index: 'IPC', amount: '10000.00', factor: '1.015859', adjusted_amount: '10158.59',
          from: { period: '2016-12', value: '100.0' }, to: { period: '2017-01', value: '101.5859' },
        },
        ...ipcProvenance,
      })
      expect(adjustOutput.parse(adjusted.structuredContent).data.adjusted_amount).toBe('10158.59')
      expect(adjusted.content).toContainEqual({ type: 'text', text: JSON.stringify(adjusted.structuredContent) })
    })
  })

  it('returns unsupported_index for ICL without calling the origin', async () => {
    const upstream = vi.fn<typeof fetch>()
    await withMcp(upstream, async (client) => {
      for (const call of [
        { name: 'get_index', arguments: { index: 'ICL', date: '2024-01-01' } },
        { name: 'adjust_amount_by_index', arguments: { index: 'ICL', amount: '10.00', from: '2024-01-01', to: '2024-02-01' } },
      ]) {
        const result = await client.callTool(call)
        expect(result.isError).toBe(true)
        expect(result.content).toEqual([expect.objectContaining({
          text: expect.stringContaining('"code":"unsupported_index"'),
        })])
      }
      expect(upstream).not.toHaveBeenCalled()
    })
  })

  it.each([
    ['observation_not_found', () => Response.json({
      error: { code: 'observation_not_found', message: 'No UVA observation for 2016-04-02.', missing: '2016-04-02' },
      source: monetary,
    }, { status: 404 })],
    ['unsupported_index', () => Response.json({
      error: { code: 'index_not_licensed', message: 'Commercial redistribution of ICL is pending authorization.' },
      source: monetary,
    }, { status: 403 })],
    ['index_origin_unavailable', () => Response.json({}, { status: 401 })],
    ['index_origin_invalid', () => Response.json({ code: 'UVA', frequency: 'daily', date: '2016-04-01', value: 14.05, source: monetary })],
  ])('returns a tool error for %s', async (code, response) => {
    await withMcp(async () => response(), async (client) => {
      const result = await client.callTool({ name: 'get_index', arguments: { index: 'UVA', date: '2016-04-01' } })
      expect(result.isError).toBe(true)
      expect(result.content).toEqual([expect.objectContaining({ text: expect.stringContaining(code) })])
    })
  })

  it('reports an unconfigured index origin', async () => {
    const app = createApp({ calendarClient, indexClient: createIndexClient({}) })
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
    const client = new Client({ name: 'argentina-mcp-test', version: '0.2.0' })
    try {
      if (!server.listening) await new Promise<void>((resolve) => server.once('listening', resolve))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Expected an HTTP server.')
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`)))
      const result = await client.callTool({ name: 'get_index', arguments: { index: 'UVA', date: '2016-04-01' } })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result.content)).toContain('index_origin_unavailable')
    } finally {
      await client.close()
      server.close()
    }
  })
})

describe('adjustment properties', () => {
  const startDate = '2020-01-01'
  const endDate = '2020-06-01'
  const levels = { start: '1.0000', end: '1.0000' }
  const upstream = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input))
    const amount = url.searchParams.get('amount') ?? ''
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const start = from === startDate ? levels.start : levels.end
    const end = to === startDate ? levels.start : levels.end
    const calculated = adjustAmount(amount, start, end)
    return Response.json({
      index: 'UVA', amount, factor: calculated.factor, adjustedAmount: calculated.adjustedAmount,
      from: { date: from, value: start }, to: { date: to, value: end }, source: monetary,
    })
  })
  const app = createApp({
    calendarClient,
    indexClient: createIndexClient({ baseUrl: 'https://indices.example/', secret: 'index-secret', fetch: upstream }),
  })
  const client = new Client({ name: 'index-properties', version: '0.2.0' })
  const money = (min: number, max: number) => fc.integer({ min, max }).map((value) => (
    `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`
  ))
  const level = fc.integer({ min: 1, max: 9_999_999 }).map((value) => {
    const text = value.toString().padStart(5, '0')
    return `${text.slice(0, -4).replace(/^0+(?=\d)/, '')}.${text.slice(-4)}`.replace(/0+$/, '').replace(/\.$/, '')
  })
  const boundedLevel = fc.integer({ min: 100, max: 1_000_000 }).chain((start) => fc.tuple(
    fc.constant(start),
    fc.integer({ min: Math.max(100, Math.floor(start / 20)), max: Math.min(1_000_000, start * 20) }),
  )).map(([start, end]) => [centsText(start), centsText(end)] as const)

  beforeAll(async () => {
    await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
      fetch: (input, init) => Promise.resolve(app.request(input, init)),
    }))
  })

  afterAll(() => client.close())

  async function adjust(amount: string, from: string, to: string) {
    const result = await client.callTool({
      name: 'adjust_amount_by_index', arguments: { index: 'UVA', amount, from, to },
    })
    expect(result.isError ?? false, JSON.stringify(result.content)).toBe(false)
    return adjustOutput.parse(result.structuredContent).data
  }

  it('matches the published IPC and UVA examples', () => {
    expect(adjustAmount('10000.00', '100.0', '101.5859').adjustedAmount).toBe('10158.59')
    expect(adjustAmount('10000', '14.05', '14.41').adjustedAmount).toBe('10256.23')
  })

  it('keeps the original amount when the dates are the same', async () => {
    await fc.assert(fc.asyncProperty(money(1, 50_000_000), level, async (amount, start) => {
      levels.start = start
      levels.end = start
      expect((await adjust(amount, startDate, startDate)).adjusted_amount).toBe(amount)
    }), { numRuns: 40 })
  })

  it('returns the original amount within rounding after adjusting back', async () => {
    await fc.assert(fc.asyncProperty(money(100, 50_000_000), boundedLevel, async (amount, [start, end]) => {
      levels.start = start
      levels.end = end
      const forward = await adjust(amount, startDate, endDate)
      expect(forward.adjusted_amount).toBe(adjustAmount(amount, start, end).adjustedAmount)
      expect(forward.amount).toBe(amount)
      const back = await adjust(forward.adjusted_amount, endDate, startDate)
      const delta = cents(back.adjusted_amount) - cents(amount)
      const limit = roundTripCents(start, end)
      expect(delta <= limit && delta >= -limit).toBe(true)
    }), { numRuns: 40 })
  })
})
