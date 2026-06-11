import { NextRequest, NextResponse } from 'next/server'
import { brtDateString, earliestKickoff, isPastDeadline } from '@/lib/tz'
import { settleDay, type FinishedMatch } from '@/lib/rules'
import { fetchWorldCupMatches } from '@/lib/football-data'
import {
  listParticipants,
  getMatchesByDate,
  getPicksByDate,
  upsertMatch,
  eliminateParticipant,
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
      const today = brtDateString(new Date())
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
      void today
    } catch (err) {
      console.error('football-data fetch failed, relying on stored/overridden results', err)
    }
  }

  // 2) Settle every day from the start up to today (idempotent).
  const participants = await listParticipants()
  const start = new Date('2026-06-11T00:00:00Z')
  const now = new Date()
  const eliminations: { participantId: string; reason: 'lost' | 'no_pick'; date: string }[] = []

  for (let d = new Date(start); d <= now; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = brtDateString(d)
    const dayMatches = await getMatchesByDate(date)
    if (dayMatches.length === 0) continue
    const deadline = earliestKickoff(dayMatches.map((m) => new Date(m.utcKickoff)))
    const deadlinePassed = deadline ? isPastDeadline(now, deadline) : false
    const dayPicks = await getPicksByDate(date)
    const matchById = new Map(dayMatches.map((m) => [m.id, m]))

    const result = settleDay({
      matchDate: date,
      hasMatches: true,
      deadlinePassed,
      participants: participants.map((p) => ({ id: p.id, status: p.status })),
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
      await eliminateParticipant(e.participantId, e.date, e.reason)
      // reflect in local copy so later days see them as already eliminated (idempotency)
      const p = participants.find((x) => x.id === e.participantId)
      if (p) p.status = 'eliminated'
      eliminations.push(e)
    }
  }

  return NextResponse.json({ ok: true, eliminations })
}
