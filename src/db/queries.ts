import { and, eq, inArray } from 'drizzle-orm'
import { db } from './client'
import { participants, matches, picks } from './schema'

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

export async function getTeamsUsedBy(participantId: string): Promise<string[]> {
  const rows = await db.select({ team: picks.team }).from(picks).where(eq(picks.participantId, participantId))
  return rows.map((r) => r.team)
}

export async function getPicksByDate(matchDate: string) {
  return db.select().from(picks).where(eq(picks.matchDate, matchDate))
}

export async function getPickFor(participantId: string, matchDate: string) {
  const rows = await db
    .select()
    .from(picks)
    .where(and(eq(picks.participantId, participantId), eq(picks.matchDate, matchDate)))
    .limit(1)
  return rows[0] ?? null
}

/** Upsert a pick (replace the participant's pick for that day). */
export async function upsertPick(input: { participantId: string; matchDate: string; team: string; matchId: string }) {
  await db.delete(picks).where(and(eq(picks.participantId, input.participantId), eq(picks.matchDate, input.matchDate)))
  await db.insert(picks).values(input)
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

export async function getMatchesByIds(ids: string[]) {
  if (ids.length === 0) return []
  return db.select().from(matches).where(inArray(matches.id, ids))
}
