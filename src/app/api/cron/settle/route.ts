import { NextRequest, NextResponse } from 'next/server'
import { matchDayKey, earliestKickoff, isPastDeadline } from '@/lib/tz'
import { settleGroup, computeStanding, type SettleMatch } from '@/lib/rules'
import { buildPickGroups } from '@/lib/groups'
import { fetchWorldCupMatches } from '@/lib/football-data'
import {
  listParticipants,
  getAllMatches,
  getPicksFrom,
  upsertMatch,
  eliminateParticipant,
  recordLifeLoss,
  getAllLifeLosses,
} from '@/db/queries'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 1) Refresh results from the API (best-effort; admin override is the safety net).
  const token = process.env.FOOTBALL_DATA_TOKEN
  if (token) {
    try {
      const fetched = await fetchWorldCupMatches(token, '2026-06-11', '2026-07-19')
      for (const m of fetched) {
        await upsertMatch({
          externalId: m.externalId,
          utcKickoff: m.utcKickoff,
          matchDate: matchDayKey(m.utcKickoff),
          stage: m.stage,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          homePenalties: m.homePenalties,
          awayPenalties: m.awayPenalties,
          status: m.status,
        })
      }
    } catch (err) {
      console.error('football-data fetch failed, relying on stored/overridden results', err)
    }
  }

  // 2) Settle every pick group whose deadline has passed.
  // Each failed group costs one life (max one per group, idempotent via the DB
  // unique constraint and the in-memory groupKey set). A participant is out at
  // 0 lives, or immediately on a knockout group with no eligible team (no_options).
  const participants = await listParticipants()
  const now = new Date()

  const allMatches = await getAllMatches()
  const matchById = new Map(allMatches.map((m) => [m.id, m]))
  const groups = buildPickGroups(
    allMatches.map((m) => ({ id: m.id, stage: m.stage, homeTeam: m.homeTeam, awayTeam: m.awayTeam, utcKickoff: m.utcKickoff, matchDate: m.matchDate })),
  )
  const allPicks = await getPicksFrom('2026-06-11')

  // loss/elimination events per participant (date + reason + groupKey), seeded from existing rows
  const lossEvents = new Map<string, { date: string; reason: 'lost' | 'no_pick' | 'no_options'; groupKey: string }[]>()
  for (const p of participants) lossEvents.set(p.id, [])
  for (const row of await getAllLifeLosses()) {
    const arr = lossEvents.get(row.participantId)
    if (arr && !arr.some((e) => e.groupKey === row.groupKey)) arr.push({ date: row.matchDate, reason: row.reason, groupKey: row.groupKey })
  }

  for (const g of groups) {
    try {
      const ms = g.matchIds.map((id) => matchById.get(id)!)
      const deadlineDate = earliestKickoff(ms.map((m) => new Date(m.utcKickoff)))
      const deadlinePassed = deadlineDate ? isPastDeadline(now, deadlineDate) : false
      if (!deadlinePassed) continue
      const repDate = deadlineDate ? matchDayKey(deadlineDate) : ms[0].matchDate

      const groupPicks = allPicks.filter((p) => p.groupKey === g.key)
      // only those who still have lives (and aren't hard-eliminated) play
      const alive = participants.filter((p) => !computeStanding(lossEvents.get(p.id) ?? []).eliminated)
      const usedKnockoutTeams = new Map(
        alive.map((p) => [p.id, allPicks.filter((pk) => pk.participantId === p.id && pk.phase === 'knockout').map((pk) => pk.team)]),
      )

      const events = settleGroup({
        groupKey: g.key,
        date: repDate,
        phase: g.phase,
        hasMatches: true,
        deadlinePassed,
        groupTeams: g.teams,
        usedKnockoutTeams,
        participants: alive.map((p) => ({ id: p.id })),
        picks: groupPicks.map((pk) => {
          const m = matchById.get(pk.matchId)
          const finished: SettleMatch | null =
            m && m.status === 'FINISHED' && m.homeScore !== null && m.awayScore !== null
              ? { homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeScore: m.homeScore, awayScore: m.awayScore, homePenalties: m.homePenalties, awayPenalties: m.awayPenalties, status: 'FINISHED' }
              : null
          return { participantId: pk.participantId, team: pk.team, match: finished }
        }),
      })

      for (const e of events) {
        const arr = lossEvents.get(e.participantId)!
        if (!arr.some((x) => x.groupKey === e.groupKey)) arr.push({ date: e.date, reason: e.reason, groupKey: e.groupKey })
        await recordLifeLoss({ participantId: e.participantId, matchDate: e.date, groupKey: e.groupKey, reason: e.reason })
      }
    } catch (err) {
      console.error(`settlement failed for group ${g.key}, continuing`, err)
    }
  }

  // 3) Materialize elimination status from the standings (for ranking/winner).
  const standings = participants.map((p) => {
    const events = lossEvents.get(p.id) ?? []
    const standing = computeStanding(events)
    return { p, events, standing }
  })
  for (const { p, events, standing } of standings) {
    if (standing.eliminated && p.status !== 'eliminated') {
      const reason = events.find((e) => e.date === standing.eliminatedDate)?.reason ?? 'lost'
      // participants.eliminatedReason enum is ['lost','no_pick']; no_options shows as lost
      const mapped = reason === 'no_options' ? 'lost' : reason
      await eliminateParticipant(p.id, standing.eliminatedDate!, mapped)
    }
  }

  return NextResponse.json({
    ok: true,
    standings: standings.map(({ p, standing }) => ({ id: p.id, lives: standing.lives, eliminated: standing.eliminated })),
  })
}
