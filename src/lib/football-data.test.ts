import { describe, it, expect } from 'vitest'
import { mapApiMatch } from './football-data'

describe('mapApiMatch', () => {
  it('maps a finished group match using full-time score', () => {
    const m = mapApiMatch({
      id: 1, utcDate: '2026-06-11T19:00:00Z', status: 'FINISHED', stage: 'GROUP_STAGE',
      homeTeam: { name: 'Brazil' }, awayTeam: { name: 'Serbia' },
      score: { duration: 'REGULAR', fullTime: { home: 2, away: 0 }, penalties: { home: null, away: null } },
    })
    expect(m).toMatchObject({
      externalId: '1', homeTeam: 'Brazil', awayTeam: 'Serbia',
      homeScore: 2, awayScore: 0, status: 'FINISHED', stage: 'GROUP_STAGE',
    })
    expect(m.utcKickoff.toISOString()).toBe('2026-06-11T19:00:00.000Z')
  })

  it('excludes penalties: a shootout win maps to a draw', () => {
    const m = mapApiMatch({
      id: 64, utcDate: '2026-07-19T19:00:00Z', status: 'FINISHED', stage: 'FINAL',
      homeTeam: { name: 'Brazil' }, awayTeam: { name: 'France' },
      score: { duration: 'PENALTY_SHOOTOUT', fullTime: { home: 1, away: 1 }, penalties: { home: 4, away: 3 } },
    })
    expect(m.homeScore).toBe(1)
    expect(m.awayScore).toBe(1)
  })

  it('maps a not-yet-finished match', () => {
    const m = mapApiMatch({
      id: 2, utcDate: '2026-06-12T16:00:00Z', status: 'SCHEDULED', stage: 'GROUP_STAGE',
      homeTeam: { name: 'Spain' }, awayTeam: { name: 'Japan' },
      score: { duration: 'REGULAR', fullTime: { home: null, away: null }, penalties: { home: null, away: null } },
    })
    expect(m.status).toBe('SCHEDULED')
    expect(m.homeScore).toBeNull()
  })
})
