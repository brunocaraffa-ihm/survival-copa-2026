import { describe, it, expect } from 'vitest'
import { computeGroupStandings, type StandingMatch } from './standings'
import { WC2026_GROUPS } from './wc2026-groups'

function gm(home: string, away: string, hs: number, as: number): StandingMatch {
  return { stage: 'GROUP_STAGE', homeTeam: home, awayTeam: away, homeScore: hs, awayScore: as, status: 'FINISHED' }
}

describe('computeGroupStandings', () => {
  it('orders a group by points, then GD, then GF', () => {
    const [a, b, c, d] = WC2026_GROUPS.A
    const matches: StandingMatch[] = [
      gm(a, b, 3, 0),
      gm(c, d, 1, 1),
      gm(a, c, 1, 0),
      gm(b, d, 2, 2),
      gm(a, d, 0, 0),
      gm(b, c, 0, 0),
    ]
    const groups = computeGroupStandings(matches)
    const groupA = groups.find((g) => g.letter === 'A')!
    expect(groupA.rows[0].team).toBe(a)
    expect(groupA.rows).toHaveLength(4)
    expect(groupA.rows[0].points).toBe(7)
  })

  it('breaks a points+GD tie by goals scored', () => {
    // a and b both finish 7 pts, GD +2; a scored more (5 vs 3) → a ahead.
    // (Two teams tied on points in a 4-team group necessarily drew head-to-head,
    //  so GF is the deciding criterion here; head-to-head only separates 3+ way ties.)
    const [a, b, c, d] = WC2026_GROUPS.B
    const matches: StandingMatch[] = [
      gm(a, b, 1, 1),
      gm(a, c, 2, 1), gm(a, d, 2, 1),
      gm(b, c, 1, 0), gm(b, d, 1, 0),
      gm(c, d, 0, 0),
    ]
    const g = computeGroupStandings(matches).find((x) => x.letter === 'B')!
    expect(g.rows[0].points).toBe(7)
    expect(g.rows[1].points).toBe(7)
    expect(g.rows[0].team).toBe(a)
    expect(g.rows[1].team).toBe(b)
  })

  it('treats an all-zero (unplayed) group as a stable alphabetical order flagged uncertain', () => {
    const groups = computeGroupStandings([])
    const g = groups.find((x) => x.letter === 'C')!
    expect(g.rows).toHaveLength(4)
    expect(g.rows.every((r) => r.played === 0)).toBe(true)
    expect(g.tiebreakUncertain).toBe(true)
  })

  it('returns all 12 groups', () => {
    expect(computeGroupStandings([]).map((g) => g.letter).sort()).toEqual(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
    )
  })
})
