import { and, eq, gte } from 'drizzle-orm'
import { db } from './client'
import { participants, matches, picks, lifeLosses } from './schema'
import { monotonicMatchMerge } from '@/lib/match-merge'

export async function getParticipantByUsername(username: string) {
  const rows = await db.select().from(participants).where(eq(participants.username, username)).limit(1)
  return rows[0] ?? null
}

export async function getParticipantById(id: string) {
  const rows = await db.select().from(participants).where(eq(participants.id, id)).limit(1)
  return rows[0] ?? null
}

export async function listParticipants() {
  return db.select().from(participants).orderBy(participants.name)
}

export async function getMatchesByDate(matchDate: string) {
  return db.select().from(matches).where(eq(matches.matchDate, matchDate))
}

/** Teams a participant has already used, each with the phase it was used in. */
export async function getUsedTeamPhases(participantId: string): Promise<{ team: string; phase: 'group' | 'knockout' }[]> {
  return db.select({ team: picks.team, phase: picks.phase }).from(picks).where(eq(picks.participantId, participantId))
}

/** All picks from a given Brasília date onward (today + future). */
export async function getPicksFrom(fromDate: string) {
  return db.select().from(picks).where(gte(picks.matchDate, fromDate))
}

/** Remove a participant's pick for a given group (used to free a team before its deadline). */
export async function deletePick(participantId: string, groupKey: string) {
  await db.delete(picks).where(and(eq(picks.participantId, participantId), eq(picks.groupKey, groupKey)))
}

/** Upsert a pick (replace the participant's pick for that group). Atomic: if the
 *  insert violates the no-repeat-team constraint, the delete rolls back so the
 *  participant keeps their previous pick for the group. */
export async function upsertPick(input: {
  participantId: string
  matchDate: string
  groupKey: string
  team: string
  matchId: string
  phase: 'group' | 'knockout'
}) {
  await db.transaction(async (tx) => {
    await tx.delete(picks).where(and(eq(picks.participantId, input.participantId), eq(picks.groupKey, input.groupKey)))
    await tx.insert(picks).values(input)
  })
}

export async function getPicksByGroup(groupKey: string) {
  return db.select().from(picks).where(eq(picks.groupKey, groupKey))
}

export async function eliminateParticipant(id: string, date: string, reason: 'lost' | 'no_pick') {
  await db
    .update(participants)
    .set({ status: 'eliminated', eliminatedDate: date, eliminatedReason: reason })
    .where(eq(participants.id, id))
}

export async function upsertMatch(m: {
  externalId: string | null
  utcKickoff: Date
  matchDate: string
  stage: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  homePenalties?: number | null
  awayPenalties?: number | null
  status: 'SCHEDULED' | 'IN_PLAY' | 'FINISHED'
}) {
  const row = { ...m, homePenalties: m.homePenalties ?? null, awayPenalties: m.awayPenalties ?? null }
  if (m.externalId) {
    const existing = await db.select().from(matches).where(eq(matches.externalId, m.externalId)).limit(1)
    if (existing[0]) {
      const merged = monotonicMatchMerge(existing[0], row)
      await db.update(matches).set(merged).where(eq(matches.externalId, m.externalId))
      return
    }
  }
  await db.insert(matches).values(row)
}

export async function setMatchResult(
  matchId: string,
  homeScore: number,
  awayScore: number,
  homePenalties: number | null = null,
  awayPenalties: number | null = null,
) {
  await db.update(matches).set({ homeScore, awayScore, homePenalties, awayPenalties, status: 'FINISHED' }).where(eq(matches.id, matchId))
}

/** Every match, ordered by kickoff — used to build pick groups across the tournament. */
export async function getAllMatches() {
  return db.select().from(matches).orderBy(matches.utcKickoff)
}

export async function countMatches(): Promise<{ total: number; finished: number }> {
  const rows = await db.select({ status: matches.status }).from(matches)
  return { total: rows.length, finished: rows.filter((r) => r.status === 'FINISHED').length }
}

/** Record one life event for a group; idempotent via unique (participant, groupKey). */
export async function recordLifeLoss(input: {
  participantId: string
  matchDate: string
  groupKey: string
  reason: 'lost' | 'no_pick' | 'no_options'
}) {
  await db.insert(lifeLosses).values(input).onConflictDoNothing()
}

/** All life-loss rows (participant + day + reason). Used to derive lives/standings. */
export async function getAllLifeLosses() {
  return db.select().from(lifeLosses)
}
