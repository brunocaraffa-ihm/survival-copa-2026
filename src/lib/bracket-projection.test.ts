import { describe, it, expect } from 'vitest'
import { projectBracket } from './bracket-projection'
import { computeGroupStandings, type StandingMatch } from './standings'
import { WC2026_GROUPS } from './wc2026-groups'

// Every group fully decided with a clean 1>2>3>4 by points (no ties).
function decidedFixtures(): StandingMatch[] {
  const ms: StandingMatch[] = []
  for (const teams of Object.values(WC2026_GROUPS)) {
    const [t1, t2, t3, t4] = teams
    ms.push({ stage: 'GROUP_STAGE', homeTeam: t1, awayTeam: t2, homeScore: 1, awayScore: 0, status: 'FINISHED' })
    ms.push({ stage: 'GROUP_STAGE', homeTeam: t1, awayTeam: t3, homeScore: 1, awayScore: 0, status: 'FINISHED' })
    ms.push({ stage: 'GROUP_STAGE', homeTeam: t1, awayTeam: t4, homeScore: 1, awayScore: 0, status: 'FINISHED' })
    ms.push({ stage: 'GROUP_STAGE', homeTeam: t2, awayTeam: t3, homeScore: 1, awayScore: 0, status: 'FINISHED' })
    ms.push({ stage: 'GROUP_STAGE', homeTeam: t2, awayTeam: t4, homeScore: 1, awayScore: 0, status: 'FINISHED' })
    ms.push({ stage: 'GROUP_STAGE', homeTeam: t3, awayTeam: t4, homeScore: 1, awayScore: 0, status: 'FINISHED' })
  }
  return ms
}

describe('projectBracket', () => {
  it('resolves all 16 R32 matches into concrete teams', () => {
    const b = projectBracket(computeGroupStandings(decidedFixtures()))
    expect(b.r32).toHaveLength(16)
    for (const m of b.r32) {
      expect(m.a.kind).toBe('team')
      expect(m.b.kind).toBe('team')
    }
  })

  it('resolves match 73 = 2A vs 2B', () => {
    const standings = computeGroupStandings(decidedFixtures())
    const b = projectBracket(standings)
    const m73 = b.r32.find((m) => m.match === 73)!
    const a2 = standings.find((g) => g.letter === 'A')!.rows[1].team
    const b2 = standings.find((g) => g.letter === 'B')!.rows[1].team
    expect([m73.a, m73.b].map((s) => (s.kind === 'team' ? s.team : '')).sort()).toEqual([a2, b2].sort())
  })

  it('picks exactly 8 qualifying thirds', () => {
    const b = projectBracket(computeGroupStandings(decidedFixtures()))
    expect(b.qualifyingThirds).toHaveLength(8)
  })

  it('a third-slot resolves to some group third place', () => {
    const standings = computeGroupStandings(decidedFixtures())
    const b = projectBracket(standings)
    const m74 = b.r32.find((m) => m.match === 74)!
    const thirds = standings.map((g) => g.rows[2].team)
    const bTeam = m74.b.kind === 'team' ? m74.b.team : null
    expect(thirds).toContain(bTeam)
  })

  it('builds the later-round skeleton as winner refs', () => {
    const b = projectBracket(computeGroupStandings(decidedFixtures()))
    const m89 = b.later.find((m) => m.match === 89)!
    expect(m89.a.kind).toBe('winner')
    expect(b.later.find((m) => m.match === 104)).toBeTruthy()
  })
})
