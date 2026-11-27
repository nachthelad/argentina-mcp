import { serve } from '@hono/node-server'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { describe, expect, it, vi } from 'vitest'
import { createCalendarClient } from '../src/calendar-client.js'
import { createApp } from '../src/index.js'

const law = 'https://www.argentina.gob.ar/normativa/nacional/ley-27399-281835/texto'
const bank = 'https://www.bcra.gob.ar/consulta-feriados-bancarios-2026/'
const lawSource = { role: 'calendar', source_url: law, legal_reference: 'Ley 27.399' }
const bankSource = { role: 'calendar', source_url: bank, legal_reference: null }
const date = '2026-03-23'
const bankingInput = { date, jurisdiction: 'AR', calendar: 'banking' }
const holiday = {
  date: '2026-05-25', name: 'Día de la Revolución de Mayo', type: 'inamovible',
  jurisdictions: ['AR'], calendars: ['general', 'bancario', 'judicial'],
  source_url: law, legal_reference: 'Ley 27.399',
}

function calendarFixture() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input))
    if (url.pathname === '/v1/holidays') {
      return Response.json({
        year: 2026, jurisdiction: 'AR-B', count: 1, holidays: [holiday],
        source_url: law, legal_reference: 'Ley 27.399', sources: [lawSource],
      })
    }
    const bankClosing = url.searchParams.get('calendar') === 'bancario'
    return Response.json({
      date, jurisdiction: 'AR', calendar: bankClosing ? 'bancario' : 'general',
      is_business_day: !bankClosing, reasons: [],
      source_url: bankClosing ? bank : law, legal_reference: bankClosing ? null : 'Ley 27.399',
      sources: [bankClosing ? bankSource : lawSource],
    })
  })
}

async function withMcp(
  upstream: typeof fetch,
  check: (client: Client) => Promise<void>,
) {
  const app = createApp({
    calendarClient: createCalendarClient({ baseUrl: 'https://origin.example/', secret: 'fixture-secret', fetch: upstream }),
  })
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 })
  const client = new Client({ name: 'argentina-mcp-test', version: '0.1.0' })
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

describe('public Streamable HTTP MCP', () => {
  it('discovers the calendar tools and calls them with the SDK', async () => {
    const upstream = calendarFixture()
    await withMcp(upstream, async (client) => {
      const { tools } = await client.listTools()
      expect(tools.map((tool) => tool.name)).toEqual([
        'is_business_day', 'list_holidays', 'next_business_day', 'add_business_days', 'judicial_deadline',
        'get_index', 'adjust_amount_by_index',
      ])
      expect(tools.every((tool) => tool.annotations?.readOnlyHint && tool.outputSchema)).toBe(true)

      const banking = await client.callTool({ name: 'is_business_day', arguments: bankingInput })
      expect(banking.structuredContent).toMatchObject({
        data: { ...bankingInput, is_business_day: false }, source_url: bank,
      })
      expect(banking.content).toContainEqual({ type: 'text', text: JSON.stringify(banking.structuredContent) })
      const query = new URL(String(upstream.mock.calls[0]?.[0]))
      expect(query.searchParams.get('calendar')).toBe('bancario')
      expect(query.searchParams.get('include_evidence')).toBe('true')
      expect(new Headers(upstream.mock.calls[0]?.[1]?.headers).get('x-internal-api-key')).toBe('fixture-secret')

      const result = await client.callTool({ name: 'list_holidays', arguments: { year: 2026, jurisdiction: 'AR-B' } })
      expect(result.structuredContent).toMatchObject({
        data: { holidays: [{ ...holiday, calendars: ['general', 'banking', 'judicial'] }] }, source_url: law,
      })
    })
  })

  it.each([
    ['coverage_unavailable', () => Response.json({ error: { message: 'No holiday data for 2025. Seeded years: 2026.' } }, { status: 400 })],
    ['calendar_origin_unavailable', () => Response.json({}, { status: 401 })],
    ['calendar_origin_invalid', () => Response.json({ is_business_day: true })],
  ])('returns a tool error for %s', async (code, response) => {
    await withMcp(async () => response(), async (client) => {
      const result = await client.callTool({ name: 'is_business_day', arguments: bankingInput })
      expect(result.isError).toBe(true)
      expect(result.content).toEqual([expect.objectContaining({ text: expect.stringContaining(code) })])
    })
  })

  it('maps the next business day and signed offsets without changing their citations', async () => {
    const upstream = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      const common = {
        date: '2026-02-13', calendar: 'general', jurisdiction: 'AR',
        source_url: law, legal_reference: 'Ley 27.399', sources: [lawSource],
      }
      if (url.pathname === '/v1/next-business-day') {
        return Response.json({ ...common, next_business_day: '2026-02-18' })
      }
      expect(url.searchParams.get('days')).toBe('-1')
      return Response.json({ ...common, days: -1, result: '2026-02-12' })
    })
    await withMcp(upstream, async (client) => {
      const input = { date: '2026-02-13', jurisdiction: 'AR', calendar: 'general' }
      const next = await client.callTool({ name: 'next_business_day', arguments: input })
      const added = await client.callTool({ name: 'add_business_days', arguments: { ...input, days: -1 } })
      expect(next.structuredContent).toMatchObject({ data: { ...input, next_date: '2026-02-18' }, sources: [lawSource] })
      expect(added.structuredContent).toMatchObject({ data: { ...input, days: -1, result_date: '2026-02-12' }, sources: [lawSource] })
    })
  })

  it('preserves the deadline scope and translates court recess reasons', async () => {
    const upstream = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input))
      expect(url.pathname).toBe('/v1/judicial/deadline')
      expect(url.searchParams.get('date')).toBe('2026-07-17')
      if (url.searchParams.get('court_scope') === 'tsj_caba') {
        return Response.json({ error: { code: 'unsupported_court_scope', message: 'Scope unsupported.' } }, { status: 400 })
      }
      const court = 'https://www.argentina.gob.ar/normativa/nacional/ley-17454-16547/actualizacion'
      const recess = 'https://www.csjn.gov.ar/documentos/descargar?ID=159534'
      return Response.json({
        notification_date: '2026-07-17', days: 1, jurisdiction: 'AR-C', court_scope: 'national_federal_caba',
        deadline: '2026-08-03',
        skipped: [{ date: '2026-07-20', reasons: [{
          kind: 'feria', date: '2026-07-20', name: 'Feria judicial de invierno', start: '2026-07-20', end: '2026-07-31',
          source_url: recess, legal_reference: 'Acordada CSJN 11/2026',
        }] }],
        grace: { date: '2026-08-04', hours: 2, skipped: [], source_url: court, legal_reference: 'CPCCN, art. 124' },
        source_url: court, legal_reference: 'CPCCN, art. 156',
        sources: [{ role: 'deadline_rule', source_url: court, legal_reference: 'CPCCN, art. 156' }],
      })
    })
    await withMcp(upstream, async (client) => {
      const arguments_ = { notification_date: '2026-07-17', jurisdiction: 'AR-C', days: 1 }
      const result = await client.callTool({ name: 'judicial_deadline', arguments: arguments_ })
      expect(result.structuredContent).toMatchObject({
        data: {
          court_scope: 'national_federal_caba', deadline: '2026-08-03', grace: { hours: 2, date: '2026-08-04' },
          skipped: [{ reasons: [{ kind: 'court_recess', legal_reference: 'Acordada CSJN 11/2026' }] }],
        },
      })
      const unsupported = await client.callTool({ name: 'judicial_deadline', arguments: { ...arguments_, court_scope: 'tsj_caba' } })
      expect(unsupported.isError).toBe(true)
      expect(unsupported.content).toEqual([expect.objectContaining({ text: expect.stringContaining('unsupported_court_scope') })])
    })
  })
})
