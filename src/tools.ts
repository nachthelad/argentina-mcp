import type { McpServer } from '@modelcontextprotocol/server'
import { CalendarError, type createCalendarClient } from './calendar-client.js'
import { IndexError } from './index-client.js'
import {
  businessDayInput, businessDayOutput, holidaysInput, holidaysOutput,
  originBusinessDay, originHolidays, toOriginCalendar, toPublicReason,
  addDaysInput, addedDaysOutput, nextDayOutput, deadlineInput, deadlineOutput,
  originNextDay, originAddedDays, originDeadline, toPublicSkipped,
} from './calendar-contract.js'

export function toolResult<T extends Record<string, unknown>>(value: T) {
  return { structuredContent: value, content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

export async function readTool<T extends Record<string, unknown>>(run: () => Promise<T>) {
  try {
    return toolResult(await run())
  } catch (error) {
    if (!(error instanceof CalendarError) && !(error instanceof IndexError)) throw error
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
  }, (input) => readTool(async () => {
    const { source_url, legal_reference, sources, reasons, is_business_day } = await read(
      '/v1/is-business-day',
      { ...input, calendar: toOriginCalendar(input.calendar) },
      originBusinessDay,
    )
    return {
      data: {
        ...input,
        is_business_day,
        reasons: reasons.map(toPublicReason),
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
  }, (input) => readTool(async () => {
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

  server.registerTool('next_business_day', {
    title: 'Find the next Argentine business day',
    description: 'Find the first business day strictly after a civil date in the selected Argentine calendar.',
    inputSchema: businessDayInput,
    outputSchema: nextDayOutput,
    annotations,
  }, (input) => readTool(async () => {
    const { next_business_day, source_url, legal_reference, sources } = await read(
      '/v1/next-business-day',
      { ...input, calendar: toOriginCalendar(input.calendar) },
      originNextDay,
    )
    return { data: { ...input, next_date: next_business_day }, source_url, legal_reference, sources }
  }))

  server.registerTool('add_business_days', {
    title: 'Add Argentine business days',
    description: 'Move forward or backward by business days. Zero returns the starting date even if it is not a business day.',
    inputSchema: addDaysInput,
    outputSchema: addedDaysOutput,
    annotations,
  }, (input) => readTool(async () => {
    const { result, source_url, legal_reference, sources } = await read(
      '/v1/business-days/add',
      { ...input, calendar: toOriginCalendar(input.calendar), days: String(input.days) },
      originAddedDays,
    )
    return { data: { ...input, result_date: result }, source_url, legal_reference, sources }
  }))

  server.registerTool('judicial_deadline', {
    title: 'Calculate an Argentine judicial deadline',
    description: 'Count judicial business days after notification and return the deadline, grace period, and documented court scope. The AR scope covers the national calendar; individual federal courts may have their own recesses.',
    inputSchema: deadlineInput,
    outputSchema: deadlineOutput,
    annotations,
  }, ({ notification_date, days, jurisdiction, court_scope }) => readTool(async () => {
    const { source_url, legal_reference, sources, grace, skipped, ...deadline } = await read(
      '/v1/judicial/deadline',
      { date: notification_date, days: String(days), jurisdiction, ...(court_scope ? { court_scope } : {}) },
      originDeadline,
    )
    return {
      data: {
        ...deadline, skipped: skipped.map(toPublicSkipped),
        grace: { ...grace, skipped: grace.skipped.map(toPublicSkipped) },
      },
      source_url, legal_reference, sources,
    }
  }))
}
