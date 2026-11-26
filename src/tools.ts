import type { McpServer } from '@modelcontextprotocol/server'
import { CalendarError, type createCalendarClient } from './calendar-client.js'
import {
  businessDayInput, businessDayOutput, holidaysInput, holidaysOutput,
  originBusinessDay, originHolidays, toOriginCalendar,
} from './calendar-contract.js'

export function toolResult<T extends Record<string, unknown>>(value: T) {
  return { structuredContent: value, content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

export async function calendarTool<T extends Record<string, unknown>>(run: () => Promise<T>) {
  try {
    return toolResult(await run())
  } catch (error) {
    if (!(error instanceof CalendarError)) throw error
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: { code: error.code, message: error.message },
          source_url: null,
          legal_reference: null,
          sources: [],
        }),
      }],
    }
  }
}

const annotations = { readOnlyHint: true, openWorldHint: true }

export function registerCalendarTools(server: McpServer, read: ReturnType<typeof createCalendarClient>) {
  server.registerTool('is_business_day', {
    title: 'Check an Argentine business day',
    description: 'Check a civil date in the general, banking, or judicial calendar for a supported Argentine jurisdiction.',
    inputSchema: businessDayInput,
    outputSchema: businessDayOutput,
    annotations,
  }, (input) => calendarTool(async () => {
    const { source_url, legal_reference, sources, reasons, is_business_day } = await read(
      '/v1/is-business-day',
      { ...input, calendar: toOriginCalendar(input.calendar) },
      originBusinessDay,
    )
    return {
      data: {
        ...input,
        is_business_day,
        reasons: reasons.map((reason) => reason.kind === 'feria' ? { ...reason, kind: 'court_recess' as const } : reason),
      },
      source_url, legal_reference, sources,
    }
  }))

  server.registerTool('list_holidays', {
    title: 'List Argentine holidays',
    description: 'List holidays and non-working days for a year and jurisdiction, including inherited national holidays and official citations.',
    inputSchema: holidaysInput,
    outputSchema: holidaysOutput,
    annotations,
  }, (input) => calendarTool(async () => {
    const { source_url, legal_reference, sources, count, holidays } = await read(
      '/v1/holidays',
      { year: String(input.year), jurisdiction: input.jurisdiction },
      originHolidays,
    )
    return {
      data: {
        ...input,
        count,
        holidays: holidays.map((holiday) => ({
          ...holiday,
          calendars: holiday.calendars.map((value) => value === 'bancario' ? 'banking' as const : value),
        })),
      },
      source_url, legal_reference, sources,
    }
  }))
}
