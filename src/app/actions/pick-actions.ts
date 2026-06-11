'use server'

import { revalidatePath } from 'next/cache'
import { currentParticipant } from '@/lib/session'
import { validatePick } from '@/lib/pick-validation'
import { brtDateString, earliestKickoff, isPastDeadline } from '@/lib/tz'
import { getMatchesByDate, getTeamsUsedBy, upsertPick, getPicksByDate } from '@/db/queries'

function todayBrt(): string {
  return brtDateString(new Date())
}

export async function getTodayBoard() {
  const me = await currentParticipant()
  if (!me) return null
  const date = todayBrt()
  const dayMatches = await getMatchesByDate(date)
  const deadline = earliestKickoff(dayMatches.map((m) => new Date(m.utcKickoff)))
  const deadlinePassed = deadline ? isPastDeadline(new Date(), deadline) : false
  const used = await getTeamsUsedBy(me.id)

  const allPicks = await getPicksByDate(date)
  // visibility: others' picks only after the deadline
  const visiblePicks = deadlinePassed ? allPicks : allPicks.filter((p) => p.participantId === me.id)

  return {
    me,
    date,
    deadline: deadline?.toISOString() ?? null,
    deadlinePassed,
    matches: dayMatches,
    teamsUsed: used,
    picks: visiblePicks,
  }
}

export async function submitPick(_prev: unknown, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const me = await currentParticipant()
  if (!me) return { error: 'Não autenticado' }

  const chosenTeam = String(formData.get('team') ?? '')
  const date = todayBrt()
  const dayMatches = await getMatchesByDate(date)
  const deadline = earliestKickoff(dayMatches.map((m) => new Date(m.utcKickoff)))
  const deadlinePassed = deadline ? isPastDeadline(new Date(), deadline) : true
  const teamsPlayingToday = dayMatches.flatMap((m) => [m.homeTeam, m.awayTeam])
  const teamsAlreadyUsed = await getTeamsUsedBy(me.id)

  const result = validatePick({
    isAlive: me.status === 'alive',
    deadlinePassed,
    teamsPlayingToday,
    teamsAlreadyUsed,
    chosenTeam,
  })
  if (!result.ok) return { error: result.error }

  const match = dayMatches.find((m) => m.homeTeam === chosenTeam || m.awayTeam === chosenTeam)!
  await upsertPick({ participantId: me.id, matchDate: date, team: chosenTeam, matchId: match.id })
  revalidatePath('/')
  return { ok: true }
}
