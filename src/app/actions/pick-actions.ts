'use server'

import { revalidatePath } from 'next/cache'
import { currentParticipant } from '@/lib/session'
import { validatePick } from '@/lib/pick-validation'
import { brtDateString, earliestKickoff, isPastDeadline } from '@/lib/tz'
import {
  getMatchesByDate,
  getTeamsUsedBy,
  upsertPick,
  deletePick,
  getMatchesFrom,
  getPicksFrom,
  getPicksByDate,
} from '@/db/queries'

function todayBrt(): string {
  return brtDateString(new Date())
}

/**
 * Full upcoming schedule (today onward), one entry per match day. A living
 * participant can set/change a pick for any day until that day's deadline.
 * Others' picks for a day are only revealed after that day's deadline.
 */
export async function getSchedule() {
  const me = await currentParticipant()
  if (!me) return null

  const today = todayBrt()
  const upcomingMatches = await getMatchesFrom(today)
  const upcomingPicks = await getPicksFrom(today)
  const teamsUsed = await getTeamsUsedBy(me.id)
  const now = new Date()

  const byDate = new Map<string, typeof upcomingMatches>()
  for (const m of upcomingMatches) {
    const arr = byDate.get(m.matchDate) ?? []
    arr.push(m)
    byDate.set(m.matchDate, arr)
  }

  const days = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, dayMatches]) => {
      const deadlineDate = earliestKickoff(dayMatches.map((m) => new Date(m.utcKickoff)))
      const deadlinePassed = deadlineDate ? isPastDeadline(now, deadlineDate) : false
      const dayPicks = upcomingPicks.filter((p) => p.matchDate === date)
      const myPick = dayPicks.find((p) => p.participantId === me.id)?.team ?? null
      // visibility: others' picks only after this day's deadline
      const visiblePicks = deadlinePassed ? dayPicks : dayPicks.filter((p) => p.participantId === me.id)
      const pickableTeams = [
        ...new Set(dayMatches.flatMap((m) => [m.homeTeam, m.awayTeam]).filter((t) => t !== 'TBD')),
      ]
      return {
        date,
        deadline: deadlineDate?.toISOString() ?? null,
        deadlinePassed,
        matches: dayMatches.map((m) => ({
          id: m.id,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          utcKickoff: m.utcKickoff.toISOString(),
        })),
        pickableTeams,
        myPick,
        picks: visiblePicks.map((p) => ({ participantId: p.participantId, team: p.team })),
      }
    })

  return { me, teamsUsed, days }
}

export async function submitPick(_prev: unknown, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const me = await currentParticipant()
  if (!me) return { error: 'Não autenticado' }

  const chosenTeam = String(formData.get('team') ?? '')
  const date = String(formData.get('matchDate') ?? '')
  if (!date) return { error: 'invalid_date' }

  const dayMatches = await getMatchesByDate(date)
  const deadline = earliestKickoff(dayMatches.map((m) => new Date(m.utcKickoff)))
  const deadlinePassed = deadline ? isPastDeadline(new Date(), deadline) : true
  const teamsPlayingThatDay = dayMatches.flatMap((m) => [m.homeTeam, m.awayTeam]).filter((t) => t !== 'TBD')

  // Exclude the team currently picked for THIS day — replacing it is allowed.
  // Every other day's team stays blocked (no reusing a team across the tournament).
  const myPickThisDay = (await getPicksByDate(date)).find((p) => p.participantId === me.id)?.team ?? null
  const teamsAlreadyUsed = (await getTeamsUsedBy(me.id)).filter((t) => t !== myPickThisDay)

  const result = validatePick({
    isAlive: me.status === 'alive',
    deadlinePassed,
    teamsPlayingToday: teamsPlayingThatDay,
    teamsAlreadyUsed,
    chosenTeam,
  })
  if (!result.ok) return { error: result.error }

  const match = dayMatches.find((m) => m.homeTeam === chosenTeam || m.awayTeam === chosenTeam)!
  try {
    await upsertPick({ participantId: me.id, matchDate: date, team: chosenTeam, matchId: match.id })
  } catch (err) {
    // DB-level guard: unique (participant, team) violation = team already used elsewhere.
    const e = err as { code?: string; cause?: { code?: string }; message?: string }
    const code = e.code ?? e.cause?.code
    if (code === '23505' || /no_repeat_team|duplicate key/i.test(e.message ?? '')) {
      return { error: 'team_already_used' }
    }
    throw err
  }
  revalidatePath('/')
  return { ok: true }
}

export async function clearPick(formData: FormData): Promise<void> {
  const me = await currentParticipant()
  if (!me) return

  const date = String(formData.get('matchDate') ?? '')
  if (!date) return

  const dayMatches = await getMatchesByDate(date)
  const deadline = earliestKickoff(dayMatches.map((m) => new Date(m.utcKickoff)))
  const deadlinePassed = deadline ? isPastDeadline(new Date(), deadline) : true
  if (deadlinePassed) return

  await deletePick(me.id, date)
  revalidatePath('/')
}
