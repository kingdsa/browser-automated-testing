export class ContextLengthError extends Error {
  readonly code = 'context_length_exceeded'

  constructor(message: string) {
    super(message)
    this.name = 'ContextLengthError'
  }
}

export function isContextLengthError(error: unknown): boolean {
  const record = error as { status?: unknown; code?: unknown; message?: unknown } | null
  const status = Number(record?.status)
  const code = String(record?.code || '')
  const message = String(record?.message || error || '')
  return (
    status === 413 ||
    /context[_ -]?length|maximum context|context window|prompt.{0,20}(too long|large)|too many input tokens|input token limit/i.test(
      `${code} ${message}`,
    )
  )
}
