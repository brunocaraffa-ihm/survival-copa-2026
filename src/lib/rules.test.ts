import { describe, it, expect } from 'vitest'
import { teamSurvives, settleDay, decideWinners } from './rules'
import type { FinishedMatch, SettleInput } from './rules'

const match = (h: string, a: string, hs: number, as: number): FinishedMatch => ({
  homeTeam: h, awayTeam: a, homeScore: hs, awayScore: as, status: 'FINISHED',
})

describe('teamSurvives', () => {
  it('survives on a win', () => {
    expect(teamSurvives(match('Brazil', 'Serbia', 2, 0), 'Brazil')).toBe(true)
  })
  it('survives on a draw (even if penalties would be lost — score excludes penalties)', () => {
    expect(teamSurvives(match('Brazil', 'Croatia', 1, 1), 'Brazil')).toBe(true)
  })
  it('is eliminated on a loss', () => {
    expect(teamSurvives(match('Brazil', 'Germany', 1, 7), 'Brazil')).toBe(false)
  })
  it('works for the away team', () => {
    expect(teamSurvives(match('Mexico', 'Argentina', 0, 2), 'Argentina')).toBe(true)
    expect(teamSurvives(match('Mexico', 'Argentina', 0, 2), 'Mexico')).toBe(false)
  })
})

describe('settleDay', () => {
  const base: SettleInput = {
    matchDate: '2026-06-11',
    hasMatches: true,
    deadlinePassed: true,
    participants: [
      { id: 'p1', status: 'alive' },
      { id: 'p2', status: 'alive' },
      { id: 'p3', status: 'alive' },
      { id: 'p4', status: 'eliminated' },
    ],
    picks: [
      { participantId: 'p1', team: 'Brazil', match: match('Brazil', 'Serbia', 2, 0) },
      { participantId: 'p2', team: 'Mexico', match: match('Mexico', 'Argentina', 0, 2) },
      // p3 has no pick
    ],
  }

  it('eliminates a losing pick with reason lost', () => {
    const out = settleDay(base)
    expect(out).toContainEqual({ participantId: 'p2', reason: 'lost', date: '2026-06-11' })
  })
  it('eliminates an alive participant with no pick as no_pick', () => {
    const out = settleDay(base)
    expect(out).toContainEqual({ participantId: 'p3', reason: 'no_pick', date: '2026-06-11' })
  })
  it('does not eliminate a surviving pick', () => {
    const out = settleDay(base)
    expect(out.find((e) => e.participantId === 'p1')).toBeUndefined()
  })
  it('never re-eliminates an already-eliminated participant', () => {
    const out = settleDay(base)
    expect(out.find((e) => e.participantId === 'p4')).toBeUndefined()
  })
  it('does not eliminate no_pick when the day has no matches', () => {
    const out = settleDay({ ...base, hasMatches: false, picks: [] })
    expect(out.find((e) => e.reason === 'no_pick')).toBeUndefined()
  })
  it('leaves a pick pending when its match is not finished yet', () => {
    const out = settleDay({
      ...base,
      picks: [{ participantId: 'p1', team: 'Brazil', match: null }],
    })
    expect(out.find((e) => e.participantId === 'p1')).toBeUndefined()
  })
  it('is idempotent: re-running on already-eliminated yields no new eliminations', () => {
    const afterFirst: SettleInput = {
      ...base,
      participants: [
        { id: 'p1', status: 'alive' },
        { id: 'p2', status: 'eliminated' },
        { id: 'p3', status: 'eliminated' },
        { id: 'p4', status: 'eliminated' },
      ],
    }
    const out = settleDay(afterFirst)
    expect(out).toEqual([])
  })
})

describe('decideWinners', () => {
  const p = (id: string, status: 'alive' | 'eliminated', date: string | null) => ({
    id, status, eliminatedDate: date,
  })
  it('returns no winners while the tournament is ongoing and people are alive', () => {
    expect(decideWinners([p('a', 'alive', null), p('b', 'eliminated', '2026-06-20')], false)).toEqual([])
  })
  it('returns all survivors as shared winners when the tournament is over', () => {
    expect(
      decideWinners([p('a', 'alive', null), p('b', 'alive', null), p('c', 'eliminated', '2026-07-01')], true).sort(),
    ).toEqual(['a', 'b'])
  })
  it('when everyone is out, the last to fall share the title', () => {
    expect(
      decideWinners(
        [p('a', 'eliminated', '2026-07-10'), p('b', 'eliminated', '2026-07-10'), p('c', 'eliminated', '2026-06-30')],
        false,
      ).sort(),
    ).toEqual(['a', 'b'])
  })
})
