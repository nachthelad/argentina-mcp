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

export function toPublicReason(value: z.infer<typeof originReason>): z.infer<typeof reason> {
  return value.kind === 'feria' ? { ...value, kind: 'court_recess' } : value
}

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

const days = z.number().int().min(-3660).max(3660)
export const addDaysInput = businessDayInput.extend({ days })
const nextDayData = businessDayInput.extend({ next_date: date })
const addedDaysData = addDaysInput.extend({ result_date: date })
export const nextDayOutput = z.object({ data: nextDayData, ...provenance })
export const addedDaysOutput = z.object({ data: addedDaysData, ...provenance })

const originMove = z.object({ date, jurisdiction, calendar: originCalendar, ...provenance })
export const originNextDay = originMove.extend({ next_business_day: date })
export const originAddedDays = originMove.extend({ days, result: date })

const courtScope = z.enum(['national_calendar', 'national_federal_caba', 'buenos_aires_provincial'])
export const deadlineInput = z.strictObject({
  notification_date: date,
  days: days.min(1),
  jurisdiction,
  court_scope: z.enum([...courtScope.options, 'tsj_caba']).optional(),
})
const skipped = z.object({ date, reasons: z.array(reason) })
const originSkipped = skipped.extend({ reasons: z.array(originReason) })
export function toPublicSkipped(value: z.infer<typeof originSkipped>) {
  return { date: value.date, reasons: value.reasons.map(toPublicReason) }
}

const grace = z.object({
  date,
  hours: z.number().int().positive(),
  skipped: z.array(skipped),
  source_url: officialUrl,
  legal_reference: z.string(),
})
const deadlineData = z.object({
  notification_date: date,
  days: days.min(1),
  jurisdiction,
  court_scope: courtScope,
  deadline: date,
  skipped: z.array(skipped),
  grace,
})
export const deadlineOutput = z.object({ data: deadlineData, ...provenance })
export const originDeadline = deadlineData.extend({
  skipped: z.array(originSkipped),
  grace: grace.extend({ skipped: z.array(originSkipped) }),
  ...provenance,
})
