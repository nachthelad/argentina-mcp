import { z } from 'zod'

export class CalendarError extends Error {
  constructor(
    readonly code: 'coverage_unavailable' | 'calendar_origin_unavailable' | 'calendar_origin_invalid' | 'unsupported_court_scope',
    message: string,
  ) {
    super(message)
  }
}

export function createCalendarClient(options: {
  baseUrl?: string
  secret?: string
  fetch?: typeof fetch
}) {
  const send = options.fetch ?? fetch
  return async function read<T>(
    path: string,
    params: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const base = options.baseUrl && URL.parse(options.baseUrl)
    if (!base || (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1')) {
      throw new CalendarError('calendar_origin_unavailable', 'The calendar origin is not configured.')
    }
    if (base.protocol === 'https:' && !options.secret) {
      throw new CalendarError('calendar_origin_unavailable', 'The calendar origin is not configured.')
    }

    const url = new URL(path, base)
    url.search = new URLSearchParams({ ...params, include_evidence: 'true' }).toString()
    let response: Response
    try {
      response = await send(url, {
        headers: options.secret ? { 'X-Internal-API-Key': options.secret } : {},
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      })
    } catch {
      throw new CalendarError('calendar_origin_unavailable', 'The calendar origin could not be reached.')
    }
    if (!response.ok && response.status !== 400) {
      throw new CalendarError('calendar_origin_unavailable', 'The calendar origin could not serve the request.')
    }

    const body: unknown = await response.json().catch(() => undefined)
    if (response.status === 400) {
      const parsedError = z.object({ error: z.object({ code: z.string().optional(), message: z.string() }) }).safeParse(body)
      if (parsedError.success) {
        const { code, message } = parsedError.data.error
        if (code === 'unsupported_court_scope') {
          throw new CalendarError(code, 'The calendar does not support that court scope for the selected jurisdiction.')
        }
        const coverage = /^No holiday data for (\d{4})\./.exec(message)
        if (coverage) throw new CalendarError('coverage_unavailable', `Holiday data is unavailable for ${coverage[1]}.`)
      }
    }
    const parsed = schema.safeParse(body)
    if (!response.ok || !parsed.success) {
      throw new CalendarError('calendar_origin_invalid', 'The calendar origin returned an unexpected response.')
    }
    return parsed.data
  }
}
