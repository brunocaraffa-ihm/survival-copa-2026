import { describe, it, expect } from 'vitest'
import { monotonicMatchMerge } from './match-merge'

const base = {
  homeTeam: 'TBD',
  awayTeam: 'TBD',
  status: 'SCHEDULED' as const,
  homeScore: null,
  awayScore: null,
  homePenalties: null,
  awayPenalties: null,
}

describe('monotonicMatchMerge', () => {
  it('fills in real teams over previous TBD', () => {
    const m = monotonicMatchMerge(base, { ...base, homeTeam: 'Brazil', awayTeam: 'Japan' })
    expect(m.homeTeam).toBe('Brazil')
    expect(m.awayTeam).toBe('Japan')
  })

  it('keeps known teams when a stale feed reverts them to TBD', () => {
    const prev = { ...base, homeTeam: 'Brazil', awayTeam: 'Japan' }
    const m = monotonicMatchMerge(prev, { ...base, homeTeam: 'TBD', awayTeam: 'TBD' })
    expect(m.homeTeam).toBe('Brazil')
    expect(m.awayTeam).toBe('Japan')
  })

  it('keeps one side when only that side is known', () => {
    const prev = { ...base, homeTeam: 'Germany', awayTeam: 'TBD' }
    const m = monotonicMatchMerge(prev, { ...base, homeTeam: 'TBD', awayTeam: 'Mexico' })
    expect(m.homeTeam).toBe('Germany')
    expect(m.awayTeam).toBe('Mexico')
  })

  it('preserves a FINISHED result against a non-finished downgrade', () => {
    const prev = { ...base, homeTeam: 'Brazil', awayTeam: 'Japan', status: 'FINISHED' as const, homeScore: 2, awayScore: 1 }
    const m = monotonicMatchMerge(prev, { ...base, homeTeam: 'Brazil', awayTeam: 'Japan' })
    expect(m.status).toBe('FINISHED')
    expect(m.homeScore).toBe(2)
    expect(m.awayScore).toBe(1)
  })

  it('still applies a fresh FINISHED result with new scores', () => {
    const prev = { ...base, homeTeam: 'Brazil', awayTeam: 'Japan', status: 'SCHEDULED' as const }
    const incoming = { ...base, homeTeam: 'Brazil', awayTeam: 'Japan', status: 'FINISHED' as const, homeScore: 3, awayScore: 0 }
    const m = monotonicMatchMerge(prev, incoming)
    expect(m.status).toBe('FINISHED')
    expect(m.homeScore).toBe(3)
    expect(m.awayScore).toBe(0)
  })
})
