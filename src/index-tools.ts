import type { McpServer } from '@modelcontextprotocol/server'
import { IndexError, unsupportedIndexMessage, type createIndexClient } from './index-client.js'
import {
  adjustInput, adjustOutput, getIndexInput, getIndexOutput, originAdjustment, originPoint, originSeries, toProvenance,
} from './index-contract.js'
import { readTool } from './tools.js'

const annotations = { readOnlyHint: true, openWorldHint: true }

function monthEnd(period: string) {
  const last = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate()
  return `${period}-${String(last).padStart(2, '0')}`
}

function asDate(value: string, end: boolean) {
  return value.length === 7 ? (end ? monthEnd(value) : `${value}-01`) : value
}

function publicObservation(row: { date: string, period?: string, value: string }) {
  return { date: row.date, ...(row.period ? { period: row.period } : {}), value: row.value }
}

export function registerIndexTools(server: McpServer, read: ReturnType<typeof createIndexClient>) {
  server.registerTool('get_index', {
    title: 'Read an Argentine index',
    description: 'Read CER, UVA, UVI, or a national or regional IPC for one date, one month, or an inclusive range. Values stay decimal strings. ICL returns unsupported_index.',
    inputSchema: getIndexInput,
    outputSchema: getIndexOutput,
    annotations,
  }, (input) => readTool(async () => {
    if (input.index === 'ICL') throw new IndexError('unsupported_index', unsupportedIndexMessage)
    const ranged = input.from !== undefined || input.to !== undefined
    const modes = Number(input.date !== undefined) + Number(input.period !== undefined) + Number(ranged)
    if (modes !== 1 || (input.from === undefined) !== (input.to === undefined)) {
      throw new IndexError('invalid_date', 'Provide a date, a period, or both from and to.')
    }
    if (input.date) {
      const point = await read(`/v1/indexes/${input.index}/on/${input.date}`, {}, originPoint)
      return {
        data: {
          index: point.code, frequency: point.frequency, date: input.date,
          observations: [publicObservation(point)],
        },
        ...toProvenance(point.source),
      }
    }
    const bounds = input.period
      ? { from: `${input.period}-01`, to: monthEnd(input.period) }
      : input.from && input.to
        ? { from: asDate(input.from, false), to: asDate(input.to, true) }
        : undefined
    if (!bounds) throw new IndexError('invalid_date', 'Provide a date, a period, or both from and to.')
    const series = await read(`/v1/indexes/${input.index}`, bounds, originSeries)
    return {
      data: {
        index: series.code,
        frequency: series.frequency,
        ...(input.period ? { period: input.period } : { from: input.from, to: input.to }),
        observations: series.observations.map(publicObservation),
      },
      ...toProvenance(series.source),
    }
  }))

  server.registerTool('adjust_amount_by_index', {
    title: 'Adjust an amount by an Argentine index',
    description: 'Adjust a positive decimal amount between two dates or months by CER, UVA, UVI, or an IPC. The result is a decimal string rounded half up to cents. ICL returns unsupported_index.',
    inputSchema: adjustInput,
    outputSchema: adjustOutput,
    annotations,
  }, (input) => readTool(async () => {
    if (input.index === 'ICL') throw new IndexError('unsupported_index', unsupportedIndexMessage)
    const { adjustedAmount, source, ...adjustment } = await read('/v1/adjust', input, originAdjustment)
    return { data: { ...adjustment, adjusted_amount: adjustedAmount }, ...toProvenance(source) }
  }))
}
