import { pgTable, uuid, text, boolean, integer, timestamp, date, unique } from 'drizzle-orm/pg-core'

export const participants = pgTable('participants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  status: text('status', { enum: ['alive', 'eliminated'] }).notNull().default('alive'),
  eliminatedDate: date('eliminated_date'),
  eliminatedReason: text('eliminated_reason', { enum: ['lost', 'no_pick'] }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const matches = pgTable('matches', {
  id: uuid('id').defaultRandom().primaryKey(),
  externalId: text('external_id').unique(),
  utcKickoff: timestamp('utc_kickoff', { withTimezone: true }).notNull(),
  matchDate: date('match_date').notNull(), // Brasília calendar date
  stage: text('stage').notNull().default('group'),
  homeTeam: text('home_team').notNull(),
  awayTeam: text('away_team').notNull(),
  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  status: text('status', { enum: ['SCHEDULED', 'IN_PLAY', 'FINISHED'] }).notNull().default('SCHEDULED'),
})

export const picks = pgTable(
  'picks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    participantId: uuid('participant_id').notNull().references(() => participants.id),
    matchDate: date('match_date').notNull(),
    team: text('team').notNull(),
    matchId: uuid('match_id').notNull().references(() => matches.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    onePerDay: unique('one_pick_per_day').on(t.participantId, t.matchDate),
    noRepeatTeam: unique('no_repeat_team').on(t.participantId, t.team),
  }),
)
