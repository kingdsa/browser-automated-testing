import { describe, expect, it } from 'vitest'
import { isContextLengthError } from '../../../server/src/requirements/context'

describe('requirement context errors', () => {
  it('recognizes common gateway context overflow errors', () => {
    expect(
      isContextLengthError({
        status: 400,
        code: 'context_length_exceeded',
        message: 'maximum context length is 32768 tokens',
      }),
    ).toBe(true)
    expect(isContextLengthError(new Error('JSON syntax error'))).toBe(false)
  })
})
