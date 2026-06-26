import { describe, it, expect } from 'vitest'
import { teamSurvives, settleGroup, decideWinners, computeStanding, phaseOf, teamAdvanced } from './rules'
import type { FinishedMatch, SettleGroupInput } from './rules'

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

describe('settleGroup — group phase (draw saves)', () => {
  const base: SettleGroupInput = {
    groupKey: 'g:2026-06-11', date: '2026-06-11', phase: 'group',
    hasMatches: true, deadlinePassed: true,
    participants: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    picks: [
      { participantId: 'p1', team: 'Brazil', match: { homeTeam: 'Brazil', awayTeam: 'Serbia', homeScore: 2, awayScore: 0, homePenalties: null, awayPenalties: null, status: 'FINISHED' } },
      { participantId: 'p2', team: 'Mexico', match: { homeTeam: 'Mexico', awayTeam: 'Argentina', homeScore: 0, awayScore: 2, homePenalties: null, awayPenalties: null, status: 'FINISHED' } },
      // p3 no pick
    ],
  }
  it('loses a life on a losing pick', () => {
    expect(settleGroup(base)).toContainEqual({ participantId: 'p2', reason: 'lost', date: '2026-06-11', groupKey: 'g:2026-06-11' })
  })
  it('a draw does NOT cost a life in the group phase', () => {
    const out = settleGroup({ ...base, picks: [{ participantId: 'p1', team: 'Brazil', match: { homeTeam: 'Brazil', awayTeam: 'Croatia', homeScore: 1, awayScore: 1, homePenalties: null, awayPenalties: null, status: 'FINISHED' } }] })
    expect(out.find((e) => e.participantId === 'p1')).toBeUndefined()
  })
  it('no pick after deadline = no_pick', () => {
    expect(settleGroup(base)).toContainEqual({ participantId: 'p3', reason: 'no_pick', date: '2026-06-11', groupKey: 'g:2026-06-11' })
  })
  it('no no_pick when the group has no matches or before the deadline', () => {
    expect(settleGroup({ ...base, hasMatches: false, picks: [] }).length).toBe(0)
    expect(settleGroup({ ...base, deadlinePassed: false, picks: [] }).length).toBe(0)
  })
  it('leaves a pending pick (match not finished) alone', () => {
    const out = settleGroup({ ...base, picks: [{ participantId: 'p1', team: 'Brazil', match: null }] })
    expect(out.find((e) => e.participantId === 'p1')).toBeUndefined()
  })
})

describe('settleGroup — knockout phase (must advance)', () => {
  const base: SettleGroupInput = {
    groupKey: 'k:LAST_32:1', date: '2026-07-01', phase: 'knockout',
    hasMatches: true, deadlinePassed: true,
    groupTeams: ['Brazil', 'Serbia', 'France', 'Mexico'],
    usedKnockoutTeams: new Map([['p3', ['Brazil', 'Serbia', 'France', 'Mexico']]]),
    participants: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    picks: [
      { participantId: 'p1', team: 'Brazil', match: { homeTeam: 'Brazil', awayTeam: 'Serbia', homeScore: 1, awayScore: 1, homePenalties: 4, awayPenalties: 2, status: 'FINISHED' } },
      { participantId: 'p2', team: 'France', match: { homeTeam: 'France', awayTeam: 'Mexico', homeScore: 1, awayScore: 1, homePenalties: 2, awayPenalties: 4, status: 'FINISHED' } },
      // p3 no pick, and has used every team in the group
    ],
  }
  it('a draw won on penalties advances → no life lost', () => {
    expect(settleGroup(base).find((e) => e.participantId === 'p1')).toBeUndefined()
  })
  it('a draw lost on penalties → loses a life', () => {
    expect(settleGroup(base)).toContainEqual({ participantId: 'p2', reason: 'lost', date: '2026-07-01', groupKey: 'k:LAST_32:1' })
  })
  it('no pick + every group team already used → no_options', () => {
    expect(settleGroup(base)).toContainEqual({ participantId: 'p3', reason: 'no_options', date: '2026-07-01', groupKey: 'k:LAST_32:1' })
  })
  it('no pick but an eligible team remains → no_pick (not no_options)', () => {
    const out = settleGroup({ ...base, usedKnockoutTeams: new Map([['p3', ['Brazil', 'Serbia']]]) })
    expect(out).toContainEqual({ participantId: 'p3', reason: 'no_pick', date: '2026-07-01', groupKey: 'k:LAST_32:1' })
  })
  it('a draw with no penalties yet leaves the pick pending', () => {
    const out = settleGroup({ ...base, picks: [{ participantId: 'p1', team: 'Brazil', match: { homeTeam: 'Brazil', awayTeam: 'Serbia', homeScore: 1, awayScore: 1, homePenalties: null, awayPenalties: null, status: 'FINISHED' } }] })
    expect(out.find((e) => e.participantId === 'p1')).toBeUndefined()
  })
})

describe('decideWinners', () => {
  const part = (id: string, opts: Partial<{ eliminated: boolean; eliminatedDate: string | null; lives: number; finalPick: string | null }> = {}) => ({
    id, eliminated: opts.eliminated ?? false, eliminatedDate: opts.eliminatedDate ?? null,
    lives: opts.lives ?? 3, finalPick: opts.finalPick ?? null,
  })

  it('no winners while alive players remain and the tournament is ongoing', () => {
    expect(decideWinners({ participants: [part('a'), part('b', { eliminated: true, eliminatedDate: '2026-06-20' })], championTeam: null, tournamentOver: false })).toEqual([])
  })
  it('champion-picker wins outright, even with fewer lives', () => {
    const out = decideWinners({
      participants: [part('a', { lives: 1, finalPick: 'Brazil' }), part('b', { lives: 3, finalPick: 'France' })],
      championTeam: 'Brazil', tournamentOver: true,
    })
    expect(out).toEqual(['a'])
  })
  it('without a champion-picker, most lives wins (shared on ties)', () => {
    const out = decideWinners({
      participants: [part('a', { lives: 2, finalPick: 'X' }), part('b', { lives: 2, finalPick: 'Y' }), part('c', { lives: 1 })],
      championTeam: 'Brazil', tournamentOver: true,
    }).sort()
    expect(out).toEqual(['a', 'b'])
  })
  it('multiple champion-pickers share', () => {
    const out = decideWinners({
      participants: [part('a', { lives: 3, finalPick: 'Brazil' }), part('b', { lives: 1, finalPick: 'Brazil' })],
      championTeam: 'Brazil', tournamentOver: true,
    }).sort()
    expect(out).toEqual(['a', 'b'])
  })
  it('everyone eliminated → last to fall share', () => {
    const out = decideWinners({
      participants: [part('a', { eliminated: true, eliminatedDate: '2026-07-10' }), part('b', { eliminated: true, eliminatedDate: '2026-07-10' }), part('c', { eliminated: true, eliminatedDate: '2026-06-30' })],
      championTeam: 'Brazil', tournamentOver: true,
    }).sort()
    expect(out).toEqual(['a', 'b'])
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
  const loss = (date: string) => ({ date, reason: 'lost' as const })
  it('starts with 3 lives', () => {
    expect(computeStanding([])).toEqual({ lives: 3, eliminated: false, eliminatedDate: null })
  })
  it('loses one life per life-loss event', () => {
    expect(computeStanding([loss('2026-06-12')])).toEqual({ lives: 2, eliminated: false, eliminatedDate: null })
  })
  it('eliminates at the third loss, dated when lives hit zero', () => {
    expect(computeStanding([loss('2026-06-12'), loss('2026-06-20'), loss('2026-06-15')])).toEqual({
      lives: 0, eliminated: true, eliminatedDate: '2026-06-20',
    })
  })
  it('no_options eliminates immediately without spending a life', () => {
    expect(computeStanding([{ date: '2026-07-05', reason: 'no_options' }])).toEqual({
      lives: 3, eliminated: true, eliminatedDate: '2026-07-05',
    })
  })
  it('eliminatedDate is the earliest of zero-day and no_options', () => {
    const out = computeStanding([loss('2026-06-12'), loss('2026-06-13'), loss('2026-06-14'), { date: '2026-07-01', reason: 'no_options' }])
    expect(out.eliminatedDate).toBe('2026-06-14')
  })
})

describe('teamAdvanced', () => {
  const ko = (h: string, a: string, hs: number, as: number, hp: number | null = null, ap: number | null = null) => ({
    homeTeam: h, awayTeam: a, homeScore: hs, awayScore: as, homePenalties: hp, awayPenalties: ap,
  })
  it('advances on a regulation/ET win', () => {
    expect(teamAdvanced(ko('Brazil', 'Serbia', 2, 0), 'Brazil')).toBe(true)
    expect(teamAdvanced(ko('Brazil', 'Serbia', 2, 0), 'Serbia')).toBe(false)
  })
  it('a draw decided on penalties: winner advances, loser does not', () => {
    expect(teamAdvanced(ko('Brazil', 'Croatia', 1, 1, 4, 2), 'Brazil')).toBe(true)
    expect(teamAdvanced(ko('Brazil', 'Croatia', 1, 1, 4, 2), 'Croatia')).toBe(false)
  })
  it('a draw with no penalties recorded is undecided (null)', () => {
    expect(teamAdvanced(ko('Brazil', 'Croatia', 1, 1), 'Brazil')).toBeNull()
  })
  it('throws if the team is not in the match', () => {
    expect(() => teamAdvanced(ko('Brazil', 'Croatia', 1, 0), 'France')).toThrow()
  })
})
