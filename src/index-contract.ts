import { z } from 'zod'

const officialUrl = z.url({ protocol: /^https$/ })
const decimalText = z.string().regex(/^\d+(?:\.\d+)?$/)
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe('Month in YYYY-MM format.')
const dayOrMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/)
  .describe('Civil date YYYY-MM-DD or month YYYY-MM.')
const citation = { source_url: officialUrl, legal_reference: z.string().min(1) }

export const indexCode = z.enum([
  'CER', 'UVA', 'UVI', 'ICL',
  'IPC', 'IPC-GBA', 'IPC-PAMPEANA', 'IPC-NEA', 'IPC-NOA', 'IPC-CUYO', 'IPC-PATAGONIA',
]).describe('CER, UVA, UVI, national IPC, or a regional IPC. ICL is not available.')

export const indexProvenance = {
  ...citation,
  sources: z.array(z.object({
    role: z.enum(['dataset', 'license']),
    ...citation,
  })).min(1),
}

export const originSource = z.object({
  organization: z.string().min(1),
  publisher: z.string().min(1),
  datasetUrl: officialUrl,
  license: z.string().min(1),
  licenseUrl: officialUrl,
})

export function toProvenance(source: z.infer<typeof originSource>) {
  return {
    source_url: source.datasetUrl,
    legal_reference: source.organization,
    sources: [
      { role: 'dataset' as const, source_url: source.datasetUrl, legal_reference: source.organization },
      { role: 'license' as const, source_url: source.licenseUrl, legal_reference: source.license },
    ],
  }
}

const frequency = z.enum(['daily', 'monthly'])
const observation = z.object({
  date: z.iso.date(),
  period: month.optional(),
  value: decimalText,
})

export const getIndexInput = z.strictObject({
  index: indexCode,
  date: z.iso.date().optional().describe('Single civil date. Monthly indexes use the month of this date.'),
  period: month.optional().describe('Single month. Daily indexes return every stored day in that month.'),
  from: dayOrMonth.optional().describe('Inclusive range start.'),
  to: dayOrMonth.optional().describe('Inclusive range end.'),
}).superRefine((value, ctx) => {
  const ranged = value.from !== undefined || value.to !== undefined
  const modes = Number(value.date !== undefined) + Number(value.period !== undefined) + Number(ranged)
  if (modes !== 1 || (value.from === undefined) !== (value.to === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Provide a date, a period, or both from and to.' })
  }
})

export const getIndexOutput = z.object({
  data: z.object({
    index: indexCode,
    frequency,
    date: z.iso.date().optional(),
    period: month.optional(),
    from: dayOrMonth.optional(),
    to: dayOrMonth.optional(),
    observations: z.array(observation),
  }),
  ...indexProvenance,
})

export const originPoint = observation.extend({
  code: indexCode,
  frequency,
  importedAt: z.string(),
  source: originSource,
})

export const originSeries = z.object({
  code: indexCode,
  frequency,
  observations: z.array(observation.extend({ importedAt: z.string() })),
  source: originSource,
})

const level = z.union([
  z.object({ date: z.iso.date(), value: decimalText }),
  z.object({ period: month, value: decimalText }),
])
const adjustedAmount = z.string().regex(/^\d+\.\d{2}$/)

export const adjustInput = z.strictObject({
  index: indexCode,
  amount: z.string().regex(/^\d+(?:\.\d+)?$/).refine((value) => /[1-9]/.test(value))
    .describe('Positive decimal amount. Use a period as the separator.'),
  from: dayOrMonth,
  to: dayOrMonth,
})

const adjustment = z.object({
  index: indexCode,
  amount: decimalText,
  from: level,
  to: level,
  factor: decimalText,
  adjusted_amount: adjustedAmount,
})

export const adjustOutput = z.object({ data: adjustment, ...indexProvenance })
export const originAdjustment = adjustment.omit({ adjusted_amount: true }).extend({
  adjustedAmount,
  source: originSource,
})
