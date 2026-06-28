export type MatchFacts = {
  homeTeam: string
  awayTeam: string
  status: 'SCHEDULED' | 'IN_PLAY' | 'FINISHED'
  homeScore: number | null
  awayScore: number | null
  homePenalties: number | null
  awayPenalties: number | null
}

/**
 * Merge an incoming feed update onto the stored row, monotonically.
 *
 * The football-data feed flaps during the group→knockout transition: a stale
 * response can report TBD teams or revert a finished result. We never downgrade
 * a known team back to TBD, and never overwrite a FINISHED result with a
 * non-finished one. Pure so it can be unit-tested.
 */
export function monotonicMatchMerge<T extends MatchFacts>(prev: MatchFacts, incoming: T): T {
  return {
    ...incoming,
    homeTeam: incoming.homeTeam === 'TBD' && prev.homeTeam !== 'TBD' ? prev.homeTeam : incoming.homeTeam,
    awayTeam: incoming.awayTeam === 'TBD' && prev.awayTeam !== 'TBD' ? prev.awayTeam : incoming.awayTeam,
    ...(prev.status === 'FINISHED' && incoming.status !== 'FINISHED'
      ? {
          status: prev.status,
          homeScore: prev.homeScore,
          awayScore: prev.awayScore,
          homePenalties: prev.homePenalties,
          awayPenalties: prev.awayPenalties,
        }
      : {}),
  }
}
