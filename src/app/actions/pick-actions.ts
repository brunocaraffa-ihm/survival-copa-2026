'use server'

import { revalidatePath } from 'next/cache'
import { currentParticipant } from '@/lib/session'
import { validatePick } from '@/lib/pick-validation'
import { teamSurvives, teamAdvanced, phaseOf } from '@/lib/rules'
import { buildPickGroups } from '@/lib/groups'
import { earliestKickoff, isPastDeadline, matchDayKey } from '@/lib/tz'
import {
  getUsedTeamPhases,
  upsertPick,
  deletePick,
  getPicksFrom,
  getPicksByGroup,
  getAllMatches,
  listParticipants,
} from '@/db/queries'

function todayBrt(): string {
  return matchDayKey(new Date())
}

/** Load every match once and build the full list of pick groups. */
async function loadGroups() {
  const allMatches = await getAllMatches()
  const matchById = new Map(allMatches.map((m) => [m.id, m]))
  const groups = buildPickGroups(
    allMatches.map((m) => ({
      id: m.id, stage: m.stage, homeTeam: m.homeTeam, awayTeam: m.awayTeam,
      utcKickoff: m.utcKickoff, matchDate: m.matchDate,
    })),
  )
  return { matchById, groups }
}

/**
 * Full upcoming schedule (today onward), one entry per pick group. A living
 * participant can set/change a pick for any group until that group's deadline.
 * Others' picks for a group are only revealed after that group's deadline.
 */
export async function getSchedule() {
  const me = await currentParticipant()
  if (!me) return null

  const today = todayBrt()
  const { matchById, groups } = await loadGroups()
  const upcomingPicks = await getPicksFrom('2026-06-11')
  const usedTeamPhases = await getUsedTeamPhases(me.id)
  const teamsUsedByPhase = {
    group: usedTeamPhases.filter((u) => u.phase === 'group').map((u) => u.team),
    knockout: usedTeamPhases.filter((u) => u.phase === 'knockout').map((u) => u.team),
  }
  const now = new Date()

  const days = groups
    .filter((g) => g.matchIds.some((id) => matchById.get(id)!.matchDate >= today))
    .map((g) => {
      const ms = g.matchIds.map((id) => matchById.get(id)!)
      const deadlineDate = earliestKickoff(ms.map((m) => new Date(m.utcKickoff)))
      const deadlinePassed = deadlineDate ? isPastDeadline(now, deadlineDate) : false
      const groupPicks = upcomingPicks.filter((p) => p.groupKey === g.key)
      const myPick = groupPicks.find((p) => p.participantId === me.id)?.team ?? null
      const visiblePicks = deadlinePassed ? groupPicks : groupPicks.filter((p) => p.participantId === me.id)
      const pickable = g.teams.map((team) => ({ team, phase: g.phase }))
      const usedThisPhase = g.phase === 'knockout' ? teamsUsedByPhase.knockout : teamsUsedByPhase.group
      const noOptions =
        g.phase === 'knockout' && pickable.length > 0 && pickable.every((t) => usedThisPhase.includes(t.team) && t.team !== myPick)
      return {
        groupKey: g.key,
        date: ms[0].matchDate,
        label: g.label,
        phase: g.phase,
        deadline: deadlineDate?.toISOString() ?? null,
        deadlinePassed,
        matches: ms.map((m) => ({ id: m.id, homeTeam: m.homeTeam, awayTeam: m.awayTeam, utcKickoff: m.utcKickoff.toISOString() })),
        pickable,
        noOptions,
        myPick,
        picks: visiblePicks.map((p) => ({ participantId: p.participantId, team: p.team })),
      }
    })

  return { me, teamsUsedByPhase, days }
}

export async function submitPick(_prev: unknown, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const me = await currentParticipant()
  if (!me) return { error: 'Não autenticado' }

  const chosenTeam = String(formData.get('team') ?? '')
  const groupKey = String(formData.get('groupKey') ?? '')
  if (!groupKey) return { error: 'invalid_group' }

  const { matchById, groups } = await loadGroups()
  const group = groups.find((g) => g.key === groupKey)
  if (!group) return { error: 'invalid_group' }
  const groupMatches = group.matchIds.map((id) => matchById.get(id)!)

  const deadline = earliestKickoff(groupMatches.map((m) => new Date(m.utcKickoff)))
  const deadlinePassed = deadline ? isPastDeadline(new Date(), deadline) : true

  const match = groupMatches.find((m) => m.homeTeam === chosenTeam || m.awayTeam === chosenTeam)
  if (!match) return { error: 'not_playing_today' }
  const phase = phaseOf(match.stage)

  const myPickThisGroup = (await getPicksByGroup(groupKey)).find((p) => p.participantId === me.id)?.team ?? null
  const teamsAlreadyUsed = (await getUsedTeamPhases(me.id))
    .filter((u) => u.phase === phase && u.team !== myPickThisGroup)
    .map((u) => u.team)

  const result = validatePick({
    isAlive: me.status === 'alive',
    deadlinePassed,
    teamsPlayingToday: group.teams,
    teamsAlreadyUsed,
    chosenTeam,
  })
  if (!result.ok) return { error: result.error }

  try {
    await upsertPick({ participantId: me.id, matchDate: match.matchDate, groupKey, team: chosenTeam, matchId: match.id, phase })
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string }; message?: string }
    const code = e.code ?? e.cause?.code
    if (code === '23505' || /no_repeat_team|duplicate key/i.test(e.message ?? '')) return { error: 'team_already_used' }
    throw err
  }
  revalidatePath('/')
  return { ok: true }
}

export async function clearPick(formData: FormData): Promise<void> {
  const me = await currentParticipant()
  if (!me) return
  const groupKey = String(formData.get('groupKey') ?? '')
  if (!groupKey) return

  const { matchById, groups } = await loadGroups()
  const group = groups.find((g) => g.key === groupKey)
  if (!group) return
  const deadline = earliestKickoff(group.matchIds.map((id) => new Date(matchById.get(id)!.utcKickoff)))
  if (deadline && isPastDeadline(new Date(), deadline)) return

  await deletePick(me.id, groupKey)
  revalidatePath('/')
}

export type PickOutcome = 'survived' | 'eliminated' | 'pending' | 'no_pick'

/**
 * Results view: for every pick group up to today, who picked what and whether
 * they survived/advanced. A group's picks unlock only once its first game has
 * started (deadline passed) — before that, `rows` is null (locked).
 */
export async function getResults() {
  const me = await currentParticipant()
  if (!me) return null

  const today = todayBrt()
  const { matchById, groups } = await loadGroups()
  const allPicks = await getPicksFrom('2026-06-11')
  const everyone = await listParticipants()
  const now = new Date()

  const days = groups
    .filter((g) => g.matchIds.some((id) => matchById.get(id)!.matchDate <= today))
    .sort((a, b) => b.order - a.order)
    .map((g) => {
      const ms = g.matchIds.map((id) => matchById.get(id)!)
      const deadlineDate = earliestKickoff(ms.map((m) => new Date(m.utcKickoff)))
      const deadlinePassed = deadlineDate ? isPastDeadline(now, deadlineDate) : false
      const groupPicks = allPicks.filter((p) => p.groupKey === g.key)

      const rows = !deadlinePassed
        ? null
        : everyone.map((p) => {
            const pick = groupPicks.find((x) => x.participantId === p.id)
            if (!pick) return { name: p.name, team: null, outcome: 'no_pick' as PickOutcome, matchLabel: null as string | null }
            const m = ms.find((x) => x.homeTeam === pick.team || x.awayTeam === pick.team)
            let outcome: PickOutcome = 'pending'
            let matchLabel: string | null = null
            if (m && m.status === 'FINISHED' && m.homeScore !== null && m.awayScore !== null) {
              if (g.phase === 'knockout') {
                const adv = teamAdvanced(
                  { homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeScore: m.homeScore, awayScore: m.awayScore, homePenalties: m.homePenalties, awayPenalties: m.awayPenalties },
                  pick.team,
                )
                outcome = adv === null ? 'pending' : adv ? 'survived' : 'eliminated'
              } else {
                outcome = teamSurvives({ homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeScore: m.homeScore, awayScore: m.awayScore, status: 'FINISHED' }, pick.team) ? 'survived' : 'eliminated'
              }
              const pens = m.homePenalties !== null && m.awayPenalties !== null ? ` (${m.homePenalties}-${m.awayPenalties} pen)` : ''
              matchLabel = `${m.homeTeam} ${m.homeScore}–${m.awayScore} ${m.awayTeam}${pens}`
            }
            return { name: p.name, team: pick.team, outcome, matchLabel }
          })

      return { groupKey: g.key, label: g.label, phase: g.phase, deadline: deadlineDate?.toISOString() ?? null, deadlinePassed, rows }
    })

  return { days }
}
