import { NextRequest, NextResponse } from 'next/server'
import { brtDateString, datesInclusive, earliestKickoff, isPastDeadline } from '@/lib/tz'
import { settleDay, computeStanding, STARTING_LIVES, type FinishedMatch } from '@/lib/rules'
import { fetchWorldCupMatches } from '@/lib/football-data'
import {
  listParticipants,
  getMatchesByDate,
  getPicksByDate,
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
          matchDate: brtDateString(m.utcKickoff),
          stage: 'group',
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          status: m.status,
        })
      }
    } catch (err) {
      console.error('football-data fetch failed, relying on stored/overridden results', err)
    }
  }

  // 2) Settle every day from the start up to today.
  // Each failed day costs one life (max one per day, idempotent via the DB
  // unique constraint and the in-memory date-set). A participant is out at 0 lives.
  const participants = await listParticipants()
  const now = new Date()
  const today = brtDateString(now)

  // loss events per participant (date + reason), seeded from existing rows
  const lossEvents = new Map<string, { date: string; reason: 'lost' | 'no_pick' }[]>()
  for (const p of participants) lossEvents.set(p.id, [])
  for (const row of await getAllLifeLosses()) {
    const arr = lossEvents.get(row.participantId)
    if (arr && !arr.some((e) => e.date === row.matchDate)) arr.push({ date: row.matchDate, reason: row.reason })
  }

  for (const date of datesInclusive('2026-06-11', today)) {
    try {
      const dayMatches = await getMatchesByDate(date)
      if (dayMatches.length === 0) continue
      const deadline = earliestKickoff(dayMatches.map((m) => new Date(m.utcKickoff)))
      const deadlinePassed = deadline ? isPastDeadline(now, deadline) : false
      const dayPicks = await getPicksByDate(date)
      const matchById = new Map(dayMatches.map((m) => [m.id, m]))

      // only those who still have lives play
      const alive = participants.filter((p) => (lossEvents.get(p.id)?.length ?? 0) < STARTING_LIVES)

      const result = settleDay({
        matchDate: date,
        hasMatches: true,
        deadlinePassed,
        participants: alive.map((p) => ({ id: p.id, status: 'alive' as const })),
        picks: dayPicks.map((pk) => {
          const m = matchById.get(pk.matchId)
          const finished: FinishedMatch | null =
            m && m.status === 'FINISHED' && m.homeScore !== null && m.awayScore !== null
              ? { homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeScore: m.homeScore, awayScore: m.awayScore, status: 'FINISHED' }
              : null
          return { participantId: pk.participantId, team: pk.team, match: finished }
        }),
      })

      for (const e of result) {
        const arr = lossEvents.get(e.participantId)!
        if (!arr.some((x) => x.date === e.date)) arr.push({ date: e.date, reason: e.reason })
        await recordLifeLoss(e.participantId, e.date, e.reason)
      }
    } catch (err) {
      console.error(`settlement failed for ${date}, continuing`, err)
    }
  }

  // 3) Materialize elimination status from the standings (for ranking/winner).
  const standings = participants.map((p) => {
    const events = lossEvents.get(p.id) ?? []
    const standing = computeStanding(events.map((e) => e.date))
    return { p, events, standing }
  })
  for (const { p, events, standing } of standings) {
    if (standing.eliminated && p.status !== 'eliminated') {
      const reason = events.find((e) => e.date === standing.eliminatedDate)?.reason ?? 'lost'
      await eliminateParticipant(p.id, standing.eliminatedDate!, reason)
    }
  }

  return NextResponse.json({
    ok: true,
    standings: standings.map(({ p, standing }) => ({ id: p.id, lives: standing.lives, eliminated: standing.eliminated })),
  })
}
