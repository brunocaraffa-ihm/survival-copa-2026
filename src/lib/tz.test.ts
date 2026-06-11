import { describe, it, expect } from 'vitest'
import { brtDateString, matchDayKey, earliestKickoff, isPastDeadline, datesInclusive } from './tz'

describe('brtDateString', () => {
  it('returns the calendar date in Brasília time', () => {
    // 2026-06-12 00:30 UTC is still 2026-06-11 21:30 in Brasília (UTC-3)
    expect(brtDateString(new Date('2026-06-12T00:30:00Z'))).toBe('2026-06-11')
  })
  it('handles a daytime UTC kickoff', () => {
    expect(brtDateString(new Date('2026-06-11T19:00:00Z'))).toBe('2026-06-11')
  })
})

describe('matchDayKey', () => {
  it('keeps daytime/evening games on their own day', () => {
    // 2026-06-11T19:00:00Z = 16:00 BRT on the 11th
    expect(matchDayKey(new Date('2026-06-11T19:00:00Z'))).toBe('2026-06-11')
  })
  it('groups small-hours games with the previous day', () => {
    // 2026-06-14T04:00:00Z = 01:00 BRT on the 14th → belongs to the 13th
    expect(matchDayKey(new Date('2026-06-14T04:00:00Z'))).toBe('2026-06-13')
  })
})

describe('earliestKickoff', () => {
  it('returns the earliest of several kickoffs', () => {
    const a = new Date('2026-06-11T22:00:00Z')
    const b = new Date('2026-06-11T19:00:00Z')
    const c = new Date('2026-06-11T20:30:00Z')
    expect(earliestKickoff([a, b, c])?.toISOString()).toBe(b.toISOString())
  })
  it('returns null for an empty list', () => {
    expect(earliestKickoff([])).toBeNull()
  })
})

describe('isPastDeadline', () => {
  it('is true when now is at or after the deadline', () => {
    const dl = new Date('2026-06-11T19:00:00Z')
    expect(isPastDeadline(new Date('2026-06-11T19:00:00Z'), dl)).toBe(true)
    expect(isPastDeadline(new Date('2026-06-11T19:00:01Z'), dl)).toBe(true)
  })
  it('is false before the deadline', () => {
    const dl = new Date('2026-06-11T19:00:00Z')
    expect(isPastDeadline(new Date('2026-06-11T18:59:59Z'), dl)).toBe(false)
  })
})

describe('datesInclusive', () => {
  it('lists calendar dates inclusively', () => {
    expect(datesInclusive('2026-06-11', '2026-06-13')).toEqual(['2026-06-11', '2026-06-12', '2026-06-13'])
  })
  it('returns a single date when start equals end', () => {
    expect(datesInclusive('2026-07-19', '2026-07-19')).toEqual(['2026-07-19'])
  })
})
