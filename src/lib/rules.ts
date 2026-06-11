export type FinishedMatch = {
  homeTeam: string
  awayTeam: string
  /** Score at end of regulation/extra-time, EXCLUDING penalty shootout. */
  homeScore: number
  awayScore: number
  status: 'FINISHED'
}

export type EliminationReason = 'lost' | 'no_pick'

export type SettleInput = {
  matchDate: string
  hasMatches: boolean
  deadlinePassed: boolean
  participants: { id: string; status: 'alive' | 'eliminated' }[]
  picks: { participantId: string; team: string; match: FinishedMatch | null }[]
}

export type Elimination = { participantId: string; reason: EliminationReason; date: string }

/** A team survives if it won or drew (penalty-shootout result is ignored). */
export function teamSurvives(m: FinishedMatch, team: string): boolean {
  const isHome = m.homeTeam === team
  const isAway = m.awayTeam === team
  if (!isHome && !isAway) throw new Error(`Team ${team} not in match`)
  const own = isHome ? m.homeScore : m.awayScore
  const opp = isHome ? m.awayScore : m.homeScore
  return own >= opp
}

/** Compute the eliminations produced by settling a single match day. Pure + idempotent. */
export function settleDay(input: SettleInput): Elimination[] {
  const out: Elimination[] = []
  const pickByPid = new Map(input.picks.map((p) => [p.participantId, p]))

  for (const participant of input.participants) {
    if (participant.status !== 'alive') continue
    const pick = pickByPid.get(participant.id)

    if (!pick) {
      if (input.hasMatches && input.deadlinePassed) {
        out.push({ participantId: participant.id, reason: 'no_pick', date: input.matchDate })
      }
      continue
    }
    if (pick.match && pick.match.status === 'FINISHED') {
      if (!teamSurvives(pick.match, pick.team)) {
        out.push({ participantId: participant.id, reason: 'lost', date: input.matchDate })
      }
    }
    // pick with no finished match → pending, no action
  }
  return out
}

/** Winner(s) = the longest survivors. Shared on ties. [] while undecided. */
export function decideWinners(
  participants: { id: string; status: 'alive' | 'eliminated'; eliminatedDate: string | null }[],
  tournamentOver: boolean,
): string[] {
  const alive = participants.filter((p) => p.status === 'alive')
  if (alive.length > 0) {
    return tournamentOver ? alive.map((p) => p.id) : []
  }
  // everyone eliminated → those eliminated on the latest date share the title
  const dates = participants.map((p) => p.eliminatedDate).filter((d): d is string => d !== null)
  if (dates.length === 0) return []
  const last = dates.reduce((a, b) => (a >= b ? a : b))
  return participants.filter((p) => p.eliminatedDate === last).map((p) => p.id)
}

/** Lives each participant starts with. Lose one per failed day; out at zero. */
export const STARTING_LIVES = 3

/** Derive a participant's standing from the dates on which they lost a life. */
export function computeStanding(lossDates: string[]): {
  lives: number
  eliminated: boolean
  eliminatedDate: string | null
} {
  const lives = Math.max(0, STARTING_LIVES - lossDates.length)
  const eliminated = lossDates.length >= STARTING_LIVES
  // the day they hit zero = the STARTING_LIVES-th loss, chronologically
  const eliminatedDate = eliminated ? [...lossDates].sort()[STARTING_LIVES - 1] : null
  return { lives, eliminated, eliminatedDate }
}
