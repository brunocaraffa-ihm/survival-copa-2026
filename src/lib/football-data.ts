export type ApiMatch = {
  id: number
  utcDate: string
  status: string
  stage: string
  homeTeam: { name: string | null }
  awayTeam: { name: string | null }
  score: {
    duration: string
    fullTime: { home: number | null; away: number | null }
    penalties: { home: number | null; away: number | null }
  }
}

export type MappedMatch = {
  externalId: string
  utcKickoff: Date
  status: 'SCHEDULED' | 'IN_PLAY' | 'FINISHED'
  /** Competition stage, e.g. GROUP_STAGE, LAST_32, FINAL. */
  stage: string
  homeTeam: string
  awayTeam: string
  /** Regulation/ET score, penalties excluded. Null until finished. */
  homeScore: number | null
  awayScore: number | null
}

function normStatus(s: string): MappedMatch['status'] {
  if (s === 'FINISHED') return 'FINISHED'
  if (s === 'IN_PLAY' || s === 'PAUSED') return 'IN_PLAY'
  return 'SCHEDULED'
}

/** Map one football-data.org match. fullTime already EXCLUDES penalties in their model. */
export function mapApiMatch(m: ApiMatch): MappedMatch {
  const status = normStatus(m.status)
  return {
    externalId: String(m.id),
    utcKickoff: new Date(m.utcDate),
    status,
    stage: m.stage,
    homeTeam: m.homeTeam.name ?? 'TBD',
    awayTeam: m.awayTeam.name ?? 'TBD',
    homeScore: status === 'FINISHED' ? m.score.fullTime.home : null,
    awayScore: status === 'FINISHED' ? m.score.fullTime.away : null,
  }
}

const BASE = 'https://api.football-data.org/v4'

/** Fetch World Cup matches in a UTC date window. Requires FOOTBALL_DATA_TOKEN. */
export async function fetchWorldCupMatches(token: string, dateFrom: string, dateTo: string): Promise<MappedMatch[]> {
  const res = await fetch(`${BASE}/competitions/WC/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
    headers: { 'X-Auth-Token': token },
  })
  if (!res.ok) throw new Error(`football-data ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { matches: ApiMatch[] }
  return data.matches.map(mapApiMatch)
}
