import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import fc from 'fast-check'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { z } from 'zod'
import { createCalendarClient } from '../src/calendar-client.js'
import { addedDaysOutput, businessDayOutput, nextDayOutput } from '../src/calendar-contract.js'
import { createApp } from '../src/index.js'

const origin = process.env.FERIADOS_PROPERTY_ORIGIN ?? 'http://127.0.0.1:3001'
const app = createApp({ calendarClient: createCalendarClient({ baseUrl: origin }) })
const client = new Client({ name: 'calendar-properties', version: '0.1.0' })
const query = fc.record({
  // Stay far enough from the dataset edges for both offsets and January recesses.
  date: fc.date({ min: new Date('2026-03-01'), max: new Date('2027-11-30'), noInvalidDate: true })
    .map((value) => value.toISOString().slice(0, 10)),
  jurisdiction: fc.constantFrom('AR', 'AR-C', 'AR-B'),
  calendar: fc.constantFrom('general', 'banking', 'judicial'),
})
const positiveOffset = fc.integer({ min: 1, max: 10 })
const samples = { numRuns: 40 }

beforeAll(async () => {
  const response = await fetch(new URL('/health', origin), { signal: AbortSignal.timeout(2000) })
  expect(response.ok, 'Start feriados-ar-api on port 3001 or set FERIADOS_PROPERTY_ORIGIN.').toBe(true)
  await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: (input, init) => Promise.resolve(app.request(input, init)),
  }))
})

afterAll(() => client.close())

async function call<T>(name: string, arguments_: Record<string, unknown>, schema: z.ZodType<{ data: T }>) {
  const result = await client.callTool({ name, arguments: arguments_ })
  expect(result.isError ?? false, JSON.stringify(result.content)).toBe(false)
  return schema.parse(result.structuredContent).data
}

const add = (input: Record<string, unknown>, days: number) =>
  call('add_business_days', { ...input, days }, addedDaysOutput)
const isBusinessDay = (input: Record<string, unknown>) => call('is_business_day', input, businessDayOutput)

it('keeps the starting date when adding zero', async () => {
  await fc.assert(fc.asyncProperty(query, async (input) => {
    expect((await add(input, 0)).result_date).toBe(input.date)
  }), samples)
})

it('matches the next business day to adding one', async () => {
  await fc.assert(fc.asyncProperty(query, async (input) => {
    expect((await call('next_business_day', input, nextDayOutput)).next_date).toBe((await add(input, 1)).result_date)
  }), samples)
})

it('lands on a business date for either direction of a nonzero offset', async () => {
  await fc.assert(fc.asyncProperty(query, positiveOffset, fc.boolean(), async (input, offset, reverse) => {
    const date = (await add(input, reverse ? -offset : offset)).result_date
    expect((await isBusinessDay({ ...input, date })).is_business_day).toBe(true)
  }), samples)
})

it('recovers a business starting date when reversing the move', async () => {
  await fc.assert(fc.asyncProperty(query, positiveOffset, async (input, offset) => {
    const { next_date: date } = await call('next_business_day', input, nextDayOutput)
    const forward = await add({ ...input, date }, offset)
    expect((await add({ ...input, date: forward.result_date }, -offset)).result_date).toBe(date)
  }), samples)
})

it('crosses a covered year and rejects a gap in coverage', async () => {
  const input = { date: '2026-12-31', jurisdiction: 'AR', calendar: 'general' }
  expect((await call('next_business_day', input, nextDayOutput)).next_date).toBe('2027-01-04')
  const gap = await client.callTool({ name: 'next_business_day', arguments: { ...input, date: '2027-12-31' } })
  expect(gap.isError).toBe(true)
  expect(JSON.stringify(gap.content)).toContain('coverage_unavailable')
  const recessGap = await client.callTool({
    name: 'add_business_days',
    arguments: { date: '2026-02-01', jurisdiction: 'AR', calendar: 'judicial', days: -1 },
  })
  expect(recessGap.isError).toBe(true)
  expect(JSON.stringify(recessGap.content)).toContain('2025')
})
