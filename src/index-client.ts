import { z } from 'zod'

export const unsupportedIndexMessage = 'ICL is not available. Commercial redistribution is pending BCRA authorization.'

export class IndexError extends Error {
  constructor(
    readonly code:
      | 'unsupported_index'
      | 'index_origin_unavailable'
      | 'index_origin_invalid'
      | 'observation_not_found'
      | 'invalid_date'
      | 'invalid_range'
      | 'invalid_amount'
      | 'invalid_index',
    message: string,
  ) {
    super(message)
  }
}

const knownErrors = {
  invalid_date: 'The date or period is not valid.',
  invalid_range: 'The start must be on or before the end.',
  invalid_amount: 'The amount must be a positive decimal.',
  invalid_index: 'The index is not supported.',
} as const

export function createIndexClient(options: {
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
      throw new IndexError('index_origin_unavailable', 'The index origin is not configured.')
    }
    if (base.protocol === 'https:' && !options.secret) {
      throw new IndexError('index_origin_unavailable', 'The index origin is not configured.')
    }

    const url = new URL(path, base)
    if (Object.keys(params).length > 0) url.search = new URLSearchParams(params).toString()
    let response: Response
    try {
      response = await send(url, {
        headers: options.secret ? { 'X-Internal-API-Key': options.secret } : {},
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      })
    } catch {
      throw new IndexError('index_origin_unavailable', 'The index origin could not be reached.')
    }

    const body: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      const parsed = z.object({
        error: z.object({ code: z.string().optional(), missing: z.string().optional() }),
      }).safeParse(body)
      const code = parsed.success ? parsed.data.error.code : undefined
      const missing = parsed.success ? parsed.data.error.missing : undefined
      if (code === 'index_not_licensed') throw new IndexError('unsupported_index', unsupportedIndexMessage)
      if (code === 'observation_not_found') {
        throw new IndexError(
          'observation_not_found',
          missing ? `No observation is available for ${missing}.` : 'No observation is available for the requested date.',
        )
      }
      if (code === 'invalid_date' || code === 'invalid_range' || code === 'invalid_amount') {
        throw new IndexError(code, knownErrors[code])
      }
      if (code === 'invalid_index' || code === 'index_not_found') throw new IndexError('invalid_index', knownErrors.invalid_index)
      if (response.status === 401 || response.status === 503 || response.status >= 500) {
        throw new IndexError('index_origin_unavailable', 'The index origin could not serve the request.')
      }
      throw new IndexError('index_origin_invalid', 'The index origin returned an unexpected response.')
    }
    const parsedBody = schema.safeParse(body)
    if (!parsedBody.success) throw new IndexError('index_origin_invalid', 'The index origin returned an unexpected response.')
    return parsedBody.data
  }
}
