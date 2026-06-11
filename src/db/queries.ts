import { and, eq, gte } from 'drizzle-orm'
import { db } from './client'
import { participants, matches, picks, lifeLosses } from './schema'

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

export async function getPicksByDate(matchDate: string) {
  return db.select().from(picks).where(eq(picks.matchDate, matchDate))
}

/** All matches from a given Brasília date onward (today + future), ordered by kickoff. */
export async function getMatchesFrom(fromDate: string) {
  return db.select().from(matches).where(gte(matches.matchDate, fromDate)).orderBy(matches.utcKickoff)
}

/** Distinct match-day keys across the whole tournament, ascending — used for "Match Day N". */
export async function getAllMatchDays(): Promise<string[]> {
  const rows = await db.selectDistinct({ d: matches.matchDate }).from(matches).orderBy(matches.matchDate)
  return rows.map((r) => r.d)
}

/** All picks from a given Brasília date onward (today + future). */
export async function getPicksFrom(fromDate: string) {
  return db.select().from(picks).where(gte(picks.matchDate, fromDate))
}

/** Remove a participant's pick for a given day (used to free a team before its deadline). */
export async function deletePick(participantId: string, matchDate: string) {
  await db.delete(picks).where(and(eq(picks.participantId, participantId), eq(picks.matchDate, matchDate)))
}

/** Upsert a pick (replace the participant's pick for that day). Atomic: if the
 *  insert violates the no-repeat-team constraint, the delete rolls back so the
 *  participant keeps their previous pick for the day. */
export async function upsertPick(input: {
  participantId: string
  matchDate: string
  team: string
  matchId: string
  phase: 'group' | 'knockout'
}) {
  await db.transaction(async (tx) => {
    await tx.delete(picks).where(and(eq(picks.participantId, input.participantId), eq(picks.matchDate, input.matchDate)))
    await tx.insert(picks).values(input)
  })
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
  status: 'SCHEDULED' | 'IN_PLAY' | 'FINISHED'
}) {
  if (m.externalId) {
    const existing = await db.select().from(matches).where(eq(matches.externalId, m.externalId)).limit(1)
    if (existing[0]) {
      await db.update(matches).set(m).where(eq(matches.externalId, m.externalId))
      return
    }
  }
  await db.insert(matches).values(m)
}

export async function setMatchResult(matchId: string, homeScore: number, awayScore: number) {
  await db.update(matches).set({ homeScore, awayScore, status: 'FINISHED' }).where(eq(matches.id, matchId))
}

export async function countMatches(): Promise<{ total: number; finished: number }> {
  const rows = await db.select({ status: matches.status }).from(matches)
  return { total: rows.length, finished: rows.filter((r) => r.status === 'FINISHED').length }
}

/** Record one life lost on a day; idempotent via the unique (participant, day) constraint. */
export async function recordLifeLoss(participantId: string, matchDate: string, reason: 'lost' | 'no_pick') {
  await db.insert(lifeLosses).values({ participantId, matchDate, reason }).onConflictDoNothing()
}

/** All life-loss rows (participant + day + reason). Used to derive lives/standings. */
export async function getAllLifeLosses() {
  return db.select().from(lifeLosses)
}
