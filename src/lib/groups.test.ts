import { describe, it, expect } from 'vitest'
import { buildPickGroups, type PickGroupMatch } from './groups'

let _id = 0
function m(stage: string, home: string, away: string, kickoffIso: string, matchDate: string): PickGroupMatch {
  return { id: `m${_id++}`, stage, homeTeam: home, awayTeam: away, utcKickoff: new Date(kickoffIso), matchDate }
}

// 2 group-stage days, then a full knockout bracket (16 + 8 + 4 + 2 + 1 + 1 third-place).
function knockoutFixtures(): PickGroupMatch[] {
  const out: PickGroupMatch[] = []
  const day = (n: number) => `2026-07-${String(n).padStart(2, '0')}`
  // group stage
  out.push(m('GROUP_STAGE', 'A', 'B', '2026-06-11T16:00:00Z', '2026-06-11'))
  out.push(m('GROUP_STAGE', 'C', 'D', '2026-06-11T19:00:00Z', '2026-06-11'))
  out.push(m('GROUP_STAGE', 'E', 'F', '2026-06-12T16:00:00Z', '2026-06-12'))
  // LAST_32: 16 games
  for (let i = 0; i < 16; i++) out.push(m('LAST_32', `R32H${i}`, `R32A${i}`, `2026-07-0${1 + Math.floor(i / 8)}T${10 + (i % 8)}:00:00Z`, day(1 + Math.floor(i / 8))))
  // LAST_16: 8 games
  for (let i = 0; i < 8; i++) out.push(m('LAST_16', `R16H${i}`, `R16A${i}`, `2026-07-0${5 + Math.floor(i / 4)}T${10 + (i % 4)}:00:00Z`, day(5 + Math.floor(i / 4))))
  // QUARTER_FINALS: 4 games
  for (let i = 0; i < 4; i++) out.push(m('QUARTER_FINALS', `QFH${i}`, `QFA${i}`, `2026-07-${String(9 + Math.floor(i / 2)).padStart(2, '0')}T${10 + (i % 2)}:00:00Z`, day(9 + Math.floor(i / 2))))
  // SEMI_FINALS: 2 games
  for (let i = 0; i < 2; i++) out.push(m('SEMI_FINALS', `SFH${i}`, `SFA${i}`, `2026-07-1${4 + i}T18:00:00Z`, day(14 + i)))
  // THIRD_PLACE: 1 game (excluded)
  out.push(m('THIRD_PLACE', 'T1', 'T2', '2026-07-17T18:00:00Z', '2026-07-17'))
  // FINAL: 1 game
  out.push(m('FINAL', 'F1', 'F2', '2026-07-19T18:00:00Z', '2026-07-19'))
  return out
}

describe('buildPickGroups', () => {
  it('group stage = one group per match day, labelled Match Day N', () => {
    const groups = buildPickGroups(knockoutFixtures()).filter((g) => g.phase === 'group')
    expect(groups.map((g) => g.label)).toEqual(['Match Day 1', 'Match Day 2'])
    expect(groups[0].key).toBe('g:2026-06-11')
    expect(groups[0].teams.sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('produces exactly 10 knockout groups in the 4/4/2/2/1 shape, excluding 3rd place', () => {
    const ko = buildPickGroups(knockoutFixtures()).filter((g) => g.phase === 'knockout')
    expect(ko.length).toBe(10)
    const labels = ko.map((g) => g.label)
    expect(labels).toEqual([
      '16avos · Grupo 1', '16avos · Grupo 2', '16avos · Grupo 3', '16avos · Grupo 4',
      'Oitavas · Grupo 1', 'Oitavas · Grupo 2',
      'Quartas · Grupo 1', 'Quartas · Grupo 2',
      'Semifinal',
      'Final',
    ])
    expect(ko.find((g) => g.label === '16avos · Grupo 1')!.matchIds.length).toBe(4)
    expect(ko.find((g) => g.label === 'Quartas · Grupo 1')!.matchIds.length).toBe(2)
    expect(ko.find((g) => g.label === 'Final')!.matchIds.length).toBe(1)
  })

  it('never includes the third-place match in any group', () => {
    const all = buildPickGroups(knockoutFixtures())
    expect(all.some((g) => g.teams.includes('T1') || g.teams.includes('T2'))).toBe(false)
  })

  it('keys are stable and groups are ordered by earliest kickoff', () => {
    const all = buildPickGroups(knockoutFixtures())
    expect(all.map((g) => g.order)).toEqual([...all.map((_, i) => i)])
    expect(all[0].key).toBe('g:2026-06-11')
    expect(all[all.length - 1].key).toBe('k:FINAL:1')
  })

  it('excludes TBD placeholders from a group\'s teams', () => {
    const groups = buildPickGroups([
      m('LAST_32', 'Brazil', 'TBD', '2026-07-01T10:00:00Z', '2026-07-01'),
    ])
    expect(groups[0].teams).toEqual(['Brazil'])
  })
})
