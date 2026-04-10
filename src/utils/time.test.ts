import { describe, expect, it } from 'vitest'
import { formatTs, minutesAgo } from '@/utils/time'

describe('time utils', () => {
  it('formatTs handles empty', () => {
    expect(formatTs(null)).toBe('—')
    expect(formatTs(undefined)).toBe('—')
  })

  it('minutesAgo returns null for invalid', () => {
    expect(minutesAgo(null)).toBeNull()
    expect(minutesAgo('not-a-date')).toBeNull()
  })
})
