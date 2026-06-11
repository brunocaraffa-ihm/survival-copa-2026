import { describe, it, expect } from 'vitest'
import { teamSurvives, settleDay, decideWinners, computeStanding, phaseOf } from './rules'
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
  it('does not eliminate no_pick before the deadline has passed', () => {
    const out = settleDay({ ...base, deadlinePassed: false, picks: [] })
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

describe('phaseOf', () => {
  it('group stage is the group phase', () => {
    expect(phaseOf('GROUP_STAGE')).toBe('group')
  })
  it('every knockout stage is the knockout phase', () => {
    expect(phaseOf('LAST_32')).toBe('knockout')
    expect(phaseOf('LAST_16')).toBe('knockout')
    expect(phaseOf('FINAL')).toBe('knockout')
  })
})

describe('computeStanding', () => {
  it('starts with 3 lives and no losses', () => {
    expect(computeStanding([])).toEqual({ lives: 3, eliminated: false, eliminatedDate: null })
  })
  it('loses one life per loss day', () => {
    expect(computeStanding(['2026-06-12'])).toEqual({ lives: 2, eliminated: false, eliminatedDate: null })
    expect(computeStanding(['2026-06-12', '2026-06-15'])).toEqual({ lives: 1, eliminated: false, eliminatedDate: null })
  })
  it('eliminates at the third loss, dated on the day lives hit zero', () => {
    expect(computeStanding(['2026-06-12', '2026-06-20', '2026-06-15'])).toEqual({
      lives: 0,
      eliminated: true,
      eliminatedDate: '2026-06-20',
    })
  })
})
