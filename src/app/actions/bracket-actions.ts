'use server'

import { currentParticipant } from '@/lib/session'
import { getAllMatches } from '@/db/queries'
import { computeGroupStandings, type StandingMatch, type GroupStanding } from '@/lib/standings'
import { projectBracket, type ProjectedBracket } from '@/lib/bracket-projection'

export type BracketView = { groups: GroupStanding[]; bracket: ProjectedBracket } | null

/** Current group standings + the projected knockout bracket. Read-only. */
export async function getBracketProjection(): Promise<BracketView> {
  const me = await currentParticipant()
  if (!me) return null

  const all = await getAllMatches()
  const matches: StandingMatch[] = all.map((m) => ({
    stage: m.stage,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    status: m.status,
  }))
  const groups = computeGroupStandings(matches)
  const bracket = projectBracket(groups)
  return { groups, bracket }
}
