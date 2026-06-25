export type FinishedMatch = {
  homeTeam: string
  awayTeam: string
  /** Score at end of regulation/extra-time, EXCLUDING penalty shootout. */
  homeScore: number
  awayScore: number
  status: 'FINISHED'
}

/** A team survives if it won or drew (penalty-shootout result is ignored). */
export function teamSurvives(m: FinishedMatch, team: string): boolean {
  const isHome = m.homeTeam === team
  const isAway = m.awayTeam === team
  if (!isHome && !isAway) throw new Error(`Team ${team} not in match`)
  const own = isHome ? m.homeScore : m.awayScore
  const opp = isHome ? m.awayScore : m.homeScore
  return own >= opp
}

/** A knockout match's score + penalties (penalties null until/unless a shootout happened). */
export type AdvanceMatch = {
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  homePenalties: number | null
  awayPenalties: number | null
}

/** Did `team` advance? true = advanced, false = eliminated, null = undecided
 *  (drew in regulation/ET with no penalty result yet). */
export function teamAdvanced(m: AdvanceMatch, team: string): boolean | null {
  const isHome = m.homeTeam === team
  const isAway = m.awayTeam === team
  if (!isHome && !isAway) throw new Error(`Team ${team} not in match`)
  const own = isHome ? m.homeScore : m.awayScore
  const opp = isHome ? m.awayScore : m.homeScore
  if (own > opp) return true
  if (own < opp) return false
  const ownP = isHome ? m.homePenalties : m.awayPenalties
  const oppP = isHome ? m.awayPenalties : m.homePenalties
  if (ownP === null || oppP === null) return null
  return ownP > oppP
}

export type Reason = 'lost' | 'no_pick' | 'no_options'

/** A finished match with penalties — used by settlement for both phases. */
export type SettleMatch = {
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  homePenalties: number | null
  awayPenalties: number | null
  status: 'FINISHED'
}

export type SettleGroupInput = {
  groupKey: string
  /** Representative date for the loss event (group deadline date in BRT). */
  date: string
  phase: Phase
  hasMatches: boolean
  deadlinePassed: boolean
  /** Alive participants only. */
  participants: { id: string }[]
  /** Each pick's chosen team and that team's match (finished, or null = pending). */
  picks: { participantId: string; team: string; match: SettleMatch | null }[]
  /** Knockout only: non-TBD teams in this group. */
  groupTeams?: string[]
  /** Knockout only: teams each participant already used in the knockout phase. */
  usedKnockoutTeams?: Map<string, string[]>
}

export type LossEvent = { participantId: string; reason: Reason; date: string; groupKey: string }

/** Settle one pick group. Pure + idempotent (callers dedupe by groupKey). */
export function settleGroup(input: SettleGroupInput): LossEvent[] {
  const out: LossEvent[] = []
  const pickByPid = new Map(input.picks.map((p) => [p.participantId, p]))
  const ev = (participantId: string, reason: Reason): LossEvent => ({
    participantId, reason, date: input.date, groupKey: input.groupKey,
  })

  for (const participant of input.participants) {
    const pick = pickByPid.get(participant.id)

    if (!pick) {
      if (!input.hasMatches || !input.deadlinePassed) continue
      if (input.phase === 'knockout') {
        const used = input.usedKnockoutTeams?.get(participant.id) ?? []
        const available = (input.groupTeams ?? []).filter((t) => !used.includes(t))
        out.push(ev(participant.id, available.length === 0 ? 'no_options' : 'no_pick'))
      } else {
        out.push(ev(participant.id, 'no_pick'))
      }
      continue
    }

    if (!pick.match || pick.match.status !== 'FINISHED') continue // pending

    if (input.phase === 'knockout') {
      const advanced = teamAdvanced(pick.match, pick.team)
      if (advanced === null) continue // shootout result not in yet → pending
      if (!advanced) out.push(ev(participant.id, 'lost'))
    } else {
      if (!teamSurvives(pick.match, pick.team)) out.push(ev(participant.id, 'lost'))
    }
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

/** Tournament phase. No-repeat-team resets between phases (group → knockout). */
export type Phase = 'group' | 'knockout'

/** Map a competition stage (GROUP_STAGE, LAST_32, …, FINAL) to a phase. */
export function phaseOf(stage: string): Phase {
  return stage === 'GROUP_STAGE' ? 'group' : 'knockout'
}

/** Lives each participant starts with. Lose one per failed day; out at zero. */
export const STARTING_LIVES = 3

/** Derive a participant's standing from their reason-tagged loss/elimination events. */
export function computeStanding(events: { date: string; reason: Reason }[]): {
  lives: number
  eliminated: boolean
  eliminatedDate: string | null
} {
  const lifeLossDates = events.filter((e) => e.reason === 'lost' || e.reason === 'no_pick').map((e) => e.date).sort()
  const lives = Math.max(0, STARTING_LIVES - lifeLossDates.length)
  const zeroDate = lifeLossDates.length >= STARTING_LIVES ? lifeLossDates[STARTING_LIVES - 1] : null
  const hardDates = events.filter((e) => e.reason === 'no_options').map((e) => e.date).sort()
  const hardDate = hardDates.length > 0 ? hardDates[0] : null
  const candidates = [zeroDate, hardDate].filter((d): d is string => d !== null).sort()
  const eliminatedDate = candidates.length > 0 ? candidates[0] : null
  return { lives, eliminated: eliminatedDate !== null, eliminatedDate }
}
