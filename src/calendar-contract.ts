import { z } from 'zod'

export const date = z.iso.date().describe('Civil date in YYYY-MM-DD format.')
export const jurisdiction = z.enum(['AR', 'AR-C', 'AR-B']).describe('Nation, Buenos Aires City, or Buenos Aires Province.')
export const calendar = z.enum(['general', 'banking', 'judicial'])
const originCalendar = z.enum(['general', 'bancario', 'judicial'])

export function toOriginCalendar(value: z.infer<typeof calendar>) {
  return value === 'banking' ? 'bancario' : value
}

const officialUrl = z.url({ protocol: /^https$/ })
const holidayType = z.enum(['inamovible', 'trasladable', 'puente', 'no_laborable', 'asueto'])
const citation = {
  source_url: officialUrl,
  legal_reference: z.string().nullable(),
}

export const provenance = {
  ...citation,
  sources: z.array(z.object({
    role: z.enum(['calendar', 'holiday', 'court_recess', 'deadline_rule', 'grace_rule']),
    ...citation,
  })).min(1),
}

const weekend = z.object({
  kind: z.literal('weekend'),
  weekday: z.enum(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']),
})
const closedHoliday = z.object({
  kind: z.literal('holiday'),
  date,
  name: z.string(),
  type: holidayType,
  source_url: officialUrl,
  legal_reference: z.string(),
})
const courtRecess = z.object({
  kind: z.literal('feria'),
  date,
  name: z.string(),
  start: date,
  end: date,
  source_url: officialUrl,
  legal_reference: z.string(),
})
const originReason = z.discriminatedUnion('kind', [weekend, closedHoliday, courtRecess])
const reason = z.discriminatedUnion('kind', [weekend, closedHoliday, courtRecess.extend({ kind: z.literal('court_recess') })])

const holiday = z.object({
  date,
  name: z.string(),
  type: holidayType,
  jurisdictions: z.array(z.string()),
  calendars: z.array(calendar),
  source_url: officialUrl,
  legal_reference: z.string(),
})
const originHoliday = holiday.extend({ calendars: z.array(originCalendar) })

export const businessDayInput = z.strictObject({ date, jurisdiction, calendar })
const businessDayData = z.object({
  date,
  jurisdiction,
  calendar,
  is_business_day: z.boolean(),
  reasons: z.array(reason),
})
export const businessDayOutput = z.object({ data: businessDayData, ...provenance })
export const originBusinessDay = businessDayData.extend({
  calendar: originCalendar,
  reasons: z.array(originReason),
  ...provenance,
})

const year = z.number().int().min(1000).max(9999)
export const holidaysInput = z.strictObject({ year, jurisdiction })
const holidaysData = z.object({
  year,
  jurisdiction,
  count: z.number().int().nonnegative(),
  holidays: z.array(holiday),
})
export const holidaysOutput = z.object({ data: holidaysData, ...provenance })
export const originHolidays = holidaysData.extend({ holidays: z.array(originHoliday), ...provenance })
