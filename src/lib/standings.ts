import { WC2026_GROUPS, type GroupLetter } from './wc2026-groups'

export type StandingMatch = {
  stage: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string
}

export type TeamRow = {
  team: string
  played: number
  won: number
  drawn: number
  lost: number
  gf: number
  ga: number
  gd: number
  points: number
}

export type GroupStanding = {
  letter: GroupLetter
  rows: TeamRow[] // ordered 1st..4th
  /** True if any position was separated only by the alphabetical fallback. */
  tiebreakUncertain: boolean
}

function emptyRow(team: string): TeamRow {
  return { team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 }
}

function accumulate(rows: Map<string, TeamRow>, m: StandingMatch): void {
  const h = rows.get(m.homeTeam)
  const a = rows.get(m.awayTeam)
  if (!h || !a || m.homeScore === null || m.awayScore === null) return
  h.played++; a.played++
  h.gf += m.homeScore; h.ga += m.awayScore
  a.gf += m.awayScore; a.ga += m.homeScore
  if (m.homeScore > m.awayScore) { h.won++; a.lost++; h.points += 3 }
  else if (m.homeScore < m.awayScore) { a.won++; h.lost++; a.points += 3 }
  else { h.drawn++; a.drawn++; h.points++; a.points++ }
  h.gd = h.gf - h.ga; a.gd = a.gf - a.ga
}

/** Mini-table over only the matches played BETWEEN the given teams. */
function headToHead(teams: string[], matches: StandingMatch[]): Map<string, TeamRow> {
  const set = new Set(teams)
  const sub = new Map(teams.map((t) => [t, emptyRow(t)]))
  for (const m of matches) {
    if (set.has(m.homeTeam) && set.has(m.awayTeam)) accumulate(sub, m)
  }
  return sub
}

function cmpOverall(a: TeamRow, b: TeamRow): number {
  return b.points - a.points || b.gd - a.gd || b.gf - a.gf
}

export function computeGroupStandings(matches: StandingMatch[]): GroupStanding[] {
  const finished = matches.filter((m) => m.stage === 'GROUP_STAGE' && m.status === 'FINISHED')
  const out: GroupStanding[] = []

  for (const [letter, teams] of Object.entries(WC2026_GROUPS) as [GroupLetter, string[]][]) {
    const rows = new Map(teams.map((t) => [t, emptyRow(t)]))
    const teamSet = new Set(teams)
    const groupMatches = finished.filter((m) => teamSet.has(m.homeTeam) && teamSet.has(m.awayTeam))
    for (const m of groupMatches) accumulate(rows, m)

    let uncertain = false
    const ordered = [...rows.values()].sort((a, b) => {
      const base = cmpOverall(a, b)
      if (base !== 0) return base
      const tied = [...rows.values()].filter((r) => cmpOverall(r, a) === 0).map((r) => r.team)
      if (tied.length > 1) {
        const h2h = headToHead(tied, groupMatches)
        const ha = h2h.get(a.team)!, hb = h2h.get(b.team)!
        const hc = cmpOverall(ha, hb)
        if (hc !== 0) return hc
      }
      uncertain = true
      return a.team < b.team ? -1 : 1
    })

    out.push({ letter, rows: ordered, tiebreakUncertain: uncertain })
  }
  return out
}
