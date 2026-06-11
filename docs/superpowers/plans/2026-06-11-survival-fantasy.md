# Survival Fantasy (Copa 2026) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a free, web-hosted survival pool for the 2026 World Cup where friends log in with admin-generated passwords, submit one no-lose team pick per match day (draw survives), and the last survivor wins.

**Architecture:** Next.js (App Router, TypeScript) deployed on Vercel, with Postgres on Supabase via Drizzle ORM. All game rules (timezone, survival outcome, pick validation, settlement) are **pure functions** developed with TDD. Auth is a closed-group username+password with a signed JWT cookie. Results come automatically from the football-data.org free API via a Vercel Cron job, with a mandatory admin manual-override safety net.

**Tech Stack:** Next.js 15, TypeScript, Drizzle ORM + `postgres` (postgres-js), Supabase Postgres, `bcryptjs`, `jose` (JWT), `date-fns` + `date-fns-tz`, Vitest, Tailwind CSS, Vercel Cron.

**Timezone:** All game days/deadlines computed in `America/Sao_Paulo`. Kickoffs stored in UTC.

**Participants (seed):** rato, bitu, bruno (admin), bigode, pedropaulo.

---

## File Structure

```
survival/
├── package.json, tsconfig.json, next.config.ts, vitest.config.ts
├── drizzle.config.ts, vercel.json, .env.example
├── src/
│   ├── lib/
│   │   ├── tz.ts            + tz.test.ts          (timezone: BRT date, deadline)
│   │   ├── rules.ts         + rules.test.ts       (survival engine, settlement, winners)
│   │   ├── pick-validation.ts + pick-validation.test.ts
│   │   ├── auth.ts          + auth.test.ts        (hash, verify, password gen, JWT session)
│   │   └── football-data.ts + football-data.test.ts (API → match mapping)
│   ├── db/
│   │   ├── schema.ts        (drizzle tables)
│   │   ├── client.ts        (postgres connection singleton)
│   │   └── queries.ts       (typed data access)
│   ├── app/
│   │   ├── layout.tsx, globals.css
│   │   ├── page.tsx                 (player dashboard)
│   │   ├── login/page.tsx
│   │   ├── admin/page.tsx
│   │   ├── actions/
│   │   │   ├── auth-actions.ts      (login/logout)
│   │   │   ├── pick-actions.ts      (submit pick, read day picks w/ visibility)
│   │   │   └── admin-actions.ts     (create participants, override result)
│   │   └── api/cron/settle/route.ts
│   └── scripts/seed-fixtures.ts     (seed WC schedule into matches)
└── docs/DEPLOY.md
```

**Principle:** rules live in `src/lib/*` as pure, dependency-free functions (fully unit-tested). DB and HTTP are thin shells around them.

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore` (exists), `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`

- [ ] **Step 1: Scaffold Next.js app non-interactively**

Run from the project root (it already contains `docs/` and `.git/`):
```bash
npx create-next-app@latest . --ts --app --tailwind --eslint --src-dir --import-alias "@/*" --no-turbopack --use-npm --yes
```
If it refuses because the directory is non-empty, scaffold in a temp dir and copy:
```bash
npx create-next-app@latest /tmp/survival-scaffold --ts --app --tailwind --eslint --src-dir --import-alias "@/*" --no-turbopack --use-npm --yes
cp -r /tmp/survival-scaffold/{package.json,tsconfig.json,next.config.*,postcss.config.*,eslint.config.*,next-env.d.ts,src,public} .
rm -rf /tmp/survival-scaffold
```

- [ ] **Step 2: Install runtime + dev dependencies**

```bash
npm install drizzle-orm postgres bcryptjs jose date-fns date-fns-tz
npm install -D drizzle-kit vitest @types/bcryptjs tsx
```

- [ ] **Step 3: Add Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
})
```

- [ ] **Step 4: Add npm scripts**

In `package.json`, add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest",
"db:generate": "drizzle-kit generate",
"db:push": "drizzle-kit push",
"seed:fixtures": "tsx src/scripts/seed-fixtures.ts"
```

- [ ] **Step 5: Verify build tooling runs**

Run: `npm run test`
Expected: Vitest runs and reports "No test files found" (exit 0) — confirms config is valid.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(SURV-2): scaffold next.js app with vitest and core deps"
```

---

## Task 1: Timezone utility (TDD)

**Files:**
- Create: `src/lib/tz.ts`
- Test: `src/lib/tz.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tz.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { brtDateString, earliestKickoff, isPastDeadline } from './tz'

describe('brtDateString', () => {
  it('returns the calendar date in Brasília time', () => {
    // 2026-06-12 00:30 UTC is still 2026-06-11 21:30 in Brasília (UTC-3)
    expect(brtDateString(new Date('2026-06-12T00:30:00Z'))).toBe('2026-06-11')
  })
  it('handles a daytime UTC kickoff', () => {
    expect(brtDateString(new Date('2026-06-11T19:00:00Z'))).toBe('2026-06-11')
  })
})

describe('earliestKickoff', () => {
  it('returns the earliest of several kickoffs', () => {
    const a = new Date('2026-06-11T22:00:00Z')
    const b = new Date('2026-06-11T19:00:00Z')
    const c = new Date('2026-06-11T20:30:00Z')
    expect(earliestKickoff([a, b, c])?.toISOString()).toBe(b.toISOString())
  })
  it('returns null for an empty list', () => {
    expect(earliestKickoff([])).toBeNull()
  })
})

describe('isPastDeadline', () => {
  it('is true when now is at or after the deadline', () => {
    const dl = new Date('2026-06-11T19:00:00Z')
    expect(isPastDeadline(new Date('2026-06-11T19:00:00Z'), dl)).toBe(true)
    expect(isPastDeadline(new Date('2026-06-11T19:00:01Z'), dl)).toBe(true)
  })
  it('is false before the deadline', () => {
    const dl = new Date('2026-06-11T19:00:00Z')
    expect(isPastDeadline(new Date('2026-06-11T18:59:59Z'), dl)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tz.test.ts`
Expected: FAIL — `Failed to resolve import "./tz"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/tz.ts`:
```ts
import { formatInTimeZone } from 'date-fns-tz'

export const TZ = 'America/Sao_Paulo'

/** Calendar date (YYYY-MM-DD) of a UTC instant, in Brasília time. */
export function brtDateString(utc: Date): string {
  return formatInTimeZone(utc, TZ, 'yyyy-MM-dd')
}

/** Earliest kickoff among a day's matches; the daily pick deadline. */
export function earliestKickoff(kickoffs: Date[]): Date | null {
  if (kickoffs.length === 0) return null
  return kickoffs.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b))
}

/** True once `now` reaches or passes the deadline. */
export function isPastDeadline(now: Date, deadline: Date): boolean {
  return now.getTime() >= deadline.getTime()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/tz.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tz.ts src/lib/tz.test.ts
git commit -m "feat(SURV-3): add brasilia timezone and deadline helpers"
```

---

## Task 2: Survival rules engine (TDD)

This is the heart of the game. Pure functions, no I/O.

**Files:**
- Create: `src/lib/rules.ts`
- Test: `src/lib/rules.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/rules.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { teamSurvives, settleDay, decideWinners } from './rules'
import type { FinishedMatch, SettleInput } from './rules'

const match = (h: string, a: string, hs: number, as: number): FinishedMatch => ({
  homeTeam: h, awayTeam: a, homeScore: hs, awayScore: as, status: 'FINISHED',
})

describe('teamSurvives', () => {
  it('survives on a win', () => {
    expect(teamSurvives(match('Brazil', 'Serbia', 2, 0), 'Brazil')).toBe(true)
  })
  it('survives on a draw (even if penalties would be lost — score excludes penalties)', () => {
    expect(teamSurvives(match('Brazil', 'Croatia', 1, 1), 'Brazil')).toBe(true)
  })
  it('is eliminated on a loss', () => {
    expect(teamSurvives(match('Brazil', 'Germany', 1, 7), 'Brazil')).toBe(false)
  })
  it('works for the away team', () => {
    expect(teamSurvives(match('Mexico', 'Argentina', 0, 2), 'Argentina')).toBe(true)
    expect(teamSurvives(match('Mexico', 'Argentina', 0, 2), 'Mexico')).toBe(false)
  })
})

describe('settleDay', () => {
  const base: SettleInput = {
    matchDate: '2026-06-11',
    hasMatches: true,
    deadlinePassed: true,
    participants: [
      { id: 'p1', status: 'alive' },
      { id: 'p2', status: 'alive' },
      { id: 'p3', status: 'alive' },
      { id: 'p4', status: 'eliminated' },
    ],
    picks: [
      { participantId: 'p1', team: 'Brazil', match: match('Brazil', 'Serbia', 2, 0) },
      { participantId: 'p2', team: 'Mexico', match: match('Mexico', 'Argentina', 0, 2) },
      // p3 has no pick
    ],
  }

  it('eliminates a losing pick with reason lost', () => {
    const out = settleDay(base)
    expect(out).toContainEqual({ participantId: 'p2', reason: 'lost', date: '2026-06-11' })
  })
  it('eliminates an alive participant with no pick as no_pick', () => {
    const out = settleDay(base)
    expect(out).toContainEqual({ participantId: 'p3', reason: 'no_pick', date: '2026-06-11' })
  })
  it('does not eliminate a surviving pick', () => {
    const out = settleDay(base)
    expect(out.find((e) => e.participantId === 'p1')).toBeUndefined()
  })
  it('never re-eliminates an already-eliminated participant', () => {
    const out = settleDay(base)
    expect(out.find((e) => e.participantId === 'p4')).toBeUndefined()
  })
  it('does not eliminate no_pick when the day has no matches', () => {
    const out = settleDay({ ...base, hasMatches: false, picks: [] })
    expect(out.find((e) => e.reason === 'no_pick')).toBeUndefined()
  })
  it('leaves a pick pending when its match is not finished yet', () => {
    const out = settleDay({
      ...base,
      picks: [{ participantId: 'p1', team: 'Brazil', match: null }],
    })
    expect(out.find((e) => e.participantId === 'p1')).toBeUndefined()
  })
  it('is idempotent: re-running on already-eliminated yields no new eliminations', () => {
    const afterFirst: SettleInput = {
      ...base,
      participants: [
        { id: 'p1', status: 'alive' },
        { id: 'p2', status: 'eliminated' },
        { id: 'p3', status: 'eliminated' },
        { id: 'p4', status: 'eliminated' },
      ],
    }
    const out = settleDay(afterFirst)
    expect(out).toEqual([])
  })
})

describe('decideWinners', () => {
  const p = (id: string, status: 'alive' | 'eliminated', date: string | null) => ({
    id, status, eliminatedDate: date,
  })
  it('returns no winners while the tournament is ongoing and people are alive', () => {
    expect(decideWinners([p('a', 'alive', null), p('b', 'eliminated', '2026-06-20')], false)).toEqual([])
  })
  it('returns all survivors as shared winners when the tournament is over', () => {
    expect(
      decideWinners([p('a', 'alive', null), p('b', 'alive', null), p('c', 'eliminated', '2026-07-01')], true).sort(),
    ).toEqual(['a', 'b'])
  })
  it('when everyone is out, the last to fall share the title', () => {
    expect(
      decideWinners(
        [p('a', 'eliminated', '2026-07-10'), p('b', 'eliminated', '2026-07-10'), p('c', 'eliminated', '2026-06-30')],
        false,
      ).sort(),
    ).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rules.test.ts`
Expected: FAIL — cannot resolve `./rules`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/rules.ts`:
```ts
export type FinishedMatch = {
  homeTeam: string
  awayTeam: string
  /** Score at end of regulation/extra-time, EXCLUDING penalty shootout. */
  homeScore: number
  awayScore: number
  status: 'FINISHED'
}

export type EliminationReason = 'lost' | 'no_pick'

export type SettleInput = {
  matchDate: string
  hasMatches: boolean
  deadlinePassed: boolean
  participants: { id: string; status: 'alive' | 'eliminated' }[]
  picks: { participantId: string; team: string; match: FinishedMatch | null }[]
}

export type Elimination = { participantId: string; reason: EliminationReason; date: string }

/** A team survives if it won or drew (penalty-shootout result is ignored). */
export function teamSurvives(m: FinishedMatch, team: string): boolean {
  const isHome = m.homeTeam === team
  const isAway = m.awayTeam === team
  if (!isHome && !isAway) throw new Error(`Team ${team} not in match`)
  const own = isHome ? m.homeScore : m.awayScore
  const opp = isHome ? m.awayScore : m.homeScore
  return own >= opp
}

/** Compute the eliminations produced by settling a single match day. Pure + idempotent. */
export function settleDay(input: SettleInput): Elimination[] {
  const out: Elimination[] = []
  const pickByPid = new Map(input.picks.map((p) => [p.participantId, p]))

  for (const participant of input.participants) {
    if (participant.status !== 'alive') continue
    const pick = pickByPid.get(participant.id)

    if (!pick) {
      if (input.hasMatches && input.deadlinePassed) {
        out.push({ participantId: participant.id, reason: 'no_pick', date: input.matchDate })
      }
      continue
    }
    if (pick.match && pick.match.status === 'FINISHED') {
      if (!teamSurvives(pick.match, pick.team)) {
        out.push({ participantId: participant.id, reason: 'lost', date: input.matchDate })
      }
    }
    // pick with no finished match → pending, no action
  }
  return out
}

/** Winner(s) = the longest survivors. Shared on ties. [] while undecided. */
export function decideWinners(
  participants: { id: string; status: 'alive' | 'eliminated'; eliminatedDate: string | null }[],
  tournamentOver: boolean,
): string[] {
  const alive = participants.filter((p) => p.status === 'alive')
  if (alive.length > 0) {
    return tournamentOver ? alive.map((p) => p.id) : []
  }
  // everyone eliminated → those eliminated on the latest date share the title
  const dates = participants.map((p) => p.eliminatedDate).filter((d): d is string => d !== null)
  if (dates.length === 0) return []
  const last = dates.reduce((a, b) => (a >= b ? a : b))
  return participants.filter((p) => p.eliminatedDate === last).map((p) => p.id)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/rules.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules.ts src/lib/rules.test.ts
git commit -m "feat(SURV-4): add survival rules engine (settle + winners)"
```

---

## Task 3: Pick validation (TDD)

**Files:**
- Create: `src/lib/pick-validation.ts`
- Test: `src/lib/pick-validation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/pick-validation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { validatePick } from './pick-validation'

const base = {
  isAlive: true,
  deadlinePassed: false,
  teamsPlayingToday: ['Brazil', 'Serbia'],
  teamsAlreadyUsed: ['Germany'],
  chosenTeam: 'Brazil',
}

describe('validatePick', () => {
  it('accepts a valid pick', () => {
    expect(validatePick(base)).toEqual({ ok: true })
  })
  it('rejects when the participant is eliminated', () => {
    expect(validatePick({ ...base, isAlive: false })).toEqual({ ok: false, error: 'eliminated' })
  })
  it('rejects after the deadline', () => {
    expect(validatePick({ ...base, deadlinePassed: true })).toEqual({ ok: false, error: 'deadline_passed' })
  })
  it('rejects a team not playing today', () => {
    expect(validatePick({ ...base, chosenTeam: 'France' })).toEqual({ ok: false, error: 'not_playing_today' })
  })
  it('rejects a team already used', () => {
    expect(validatePick({ ...base, chosenTeam: 'Brazil', teamsAlreadyUsed: ['Brazil'] })).toEqual({
      ok: false, error: 'team_already_used',
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pick-validation.test.ts`
Expected: FAIL — cannot resolve `./pick-validation`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/pick-validation.ts`:
```ts
export type PickValidationInput = {
  isAlive: boolean
  deadlinePassed: boolean
  teamsPlayingToday: string[]
  teamsAlreadyUsed: string[]
  chosenTeam: string
}

export type PickValidationResult =
  | { ok: true }
  | { ok: false; error: 'eliminated' | 'deadline_passed' | 'not_playing_today' | 'team_already_used' }

export function validatePick(input: PickValidationInput): PickValidationResult {
  if (!input.isAlive) return { ok: false, error: 'eliminated' }
  if (input.deadlinePassed) return { ok: false, error: 'deadline_passed' }
  if (!input.teamsPlayingToday.includes(input.chosenTeam)) return { ok: false, error: 'not_playing_today' }
  if (input.teamsAlreadyUsed.includes(input.chosenTeam)) return { ok: false, error: 'team_already_used' }
  return { ok: true }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pick-validation.test.ts`
Expected: PASS (5 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pick-validation.ts src/lib/pick-validation.test.ts
git commit -m "feat(SURV-5): add pick validation rules"
```

---

## Task 4: Auth helpers (TDD)

**Files:**
- Create: `src/lib/auth.ts`
- Test: `src/lib/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, generatePassword, createSession, readSession } from './auth'

const SECRET = 'test-secret-test-secret-test-secret-32'

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('hunter2')
    expect(await verifyPassword('hunter2', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})

describe('generatePassword', () => {
  it('returns a non-trivial readable password', () => {
    const pw = generatePassword()
    expect(pw).toMatch(/^[a-z0-9]{8,}$/)
    expect(pw).not.toEqual(generatePassword())
  })
})

describe('session token', () => {
  it('round-trips the participant id', async () => {
    const token = await createSession('p-123', SECRET)
    expect(await readSession(token, SECRET)).toEqual({ participantId: 'p-123' })
  })
  it('returns null for a tampered/invalid token', async () => {
    expect(await readSession('garbage', SECRET)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: FAIL — cannot resolve `./auth`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/auth.ts`:
```ts
import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/** Readable random password, e.g. "k7m2p9qx". */
export function generatePassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export async function createSession(participantId: string, secret: string): Promise<string> {
  return new SignJWT({ participantId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('60d')
    .sign(new TextEncoder().encode(secret))
}

export async function readSession(token: string, secret: string): Promise<{ participantId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
    if (typeof payload.participantId !== 'string') return null
    return { participantId: payload.participantId }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.test.ts
git commit -m "feat(SURV-6): add auth helpers (bcrypt + jwt session)"
```

---

## Task 5: football-data.org match mapping (TDD)

Maps the API's nested score model to our penalty-excluded `FinishedMatch`. A knockout decided only on penalties maps to a draw (both survive). The network call is isolated; only the mapping is unit-tested.

**Files:**
- Create: `src/lib/football-data.ts`
- Test: `src/lib/football-data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/football-data.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mapApiMatch } from './football-data'

describe('mapApiMatch', () => {
  it('maps a finished group match using full-time score', () => {
    const m = mapApiMatch({
      id: 1, utcDate: '2026-06-11T19:00:00Z', status: 'FINISHED',
      homeTeam: { name: 'Brazil' }, awayTeam: { name: 'Serbia' },
      score: { duration: 'REGULAR', fullTime: { home: 2, away: 0 }, penalties: { home: null, away: null } },
    })
    expect(m).toMatchObject({
      externalId: '1', homeTeam: 'Brazil', awayTeam: 'Serbia',
      homeScore: 2, awayScore: 0, status: 'FINISHED',
    })
    expect(m.utcKickoff.toISOString()).toBe('2026-06-11T19:00:00.000Z')
  })

  it('excludes penalties: a shootout win maps to a draw', () => {
    const m = mapApiMatch({
      id: 64, utcDate: '2026-07-19T19:00:00Z', status: 'FINISHED',
      homeTeam: { name: 'Brazil' }, awayTeam: { name: 'France' },
      score: { duration: 'PENALTY_SHOOTOUT', fullTime: { home: 1, away: 1 }, penalties: { home: 4, away: 3 } },
    })
    expect(m.homeScore).toBe(1)
    expect(m.awayScore).toBe(1)
  })

  it('maps a not-yet-finished match', () => {
    const m = mapApiMatch({
      id: 2, utcDate: '2026-06-12T16:00:00Z', status: 'SCHEDULED',
      homeTeam: { name: 'Spain' }, awayTeam: { name: 'Japan' },
      score: { duration: 'REGULAR', fullTime: { home: null, away: null }, penalties: { home: null, away: null } },
    })
    expect(m.status).toBe('SCHEDULED')
    expect(m.homeScore).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/football-data.test.ts`
Expected: FAIL — cannot resolve `./football-data`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/football-data.ts`:
```ts
export type ApiMatch = {
  id: number
  utcDate: string
  status: string
  homeTeam: { name: string | null }
  awayTeam: { name: string | null }
  score: {
    duration: string
    fullTime: { home: number | null; away: number | null }
    penalties: { home: number | null; away: number | null }
  }
}

export type MappedMatch = {
  externalId: string
  utcKickoff: Date
  status: 'SCHEDULED' | 'IN_PLAY' | 'FINISHED'
  homeTeam: string
  awayTeam: string
  /** Regulation/ET score, penalties excluded. Null until finished. */
  homeScore: number | null
  awayScore: number | null
}

function normStatus(s: string): MappedMatch['status'] {
  if (s === 'FINISHED') return 'FINISHED'
  if (s === 'IN_PLAY' || s === 'PAUSED') return 'IN_PLAY'
  return 'SCHEDULED'
}

/** Map one football-data.org match. fullTime already EXCLUDES penalties in their model. */
export function mapApiMatch(m: ApiMatch): MappedMatch {
  const status = normStatus(m.status)
  return {
    externalId: String(m.id),
    utcKickoff: new Date(m.utcDate),
    status,
    homeTeam: m.homeTeam.name ?? 'TBD',
    awayTeam: m.awayTeam.name ?? 'TBD',
    homeScore: status === 'FINISHED' ? m.score.fullTime.home : null,
    awayScore: status === 'FINISHED' ? m.score.fullTime.away : null,
  }
}

const BASE = 'https://api.football-data.org/v4'

/** Fetch World Cup matches in a UTC date window. Requires FOOTBALL_DATA_TOKEN. */
export async function fetchWorldCupMatches(token: string, dateFrom: string, dateTo: string): Promise<MappedMatch[]> {
  const res = await fetch(`${BASE}/competitions/WC/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
    headers: { 'X-Auth-Token': token },
  })
  if (!res.ok) throw new Error(`football-data ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as { matches: ApiMatch[] }
  return data.matches.map(mapApiMatch)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/football-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/football-data.ts src/lib/football-data.test.ts
git commit -m "feat(SURV-7): add football-data match mapping and fetch"
```

---

## Task 6: Database schema + client

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `drizzle.config.ts`, `.env.example`

- [ ] **Step 1: Define the Drizzle schema**

Create `src/db/schema.ts`:
```ts
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
```

- [ ] **Step 2: Create the DB client singleton**

Create `src/db/client.ts`:
```ts
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is not set')

const client = postgres(connectionString, { prepare: false })
export const db = drizzle(client, { schema })
```

- [ ] **Step 3: Create drizzle config + env example**

Create `drizzle.config.ts`:
```ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
} satisfies Config
```

Create `.env.example`:
```
# Supabase → Project Settings → Database → Connection string (URI), use the pooler (port 6543)
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres"
# Random 32+ char string for signing session cookies
SESSION_SECRET="change-me-to-a-long-random-string"
# football-data.org free API token (https://www.football-data.org/client/register)
FOOTBALL_DATA_TOKEN=""
# Shared secret protecting the cron endpoint
CRON_SECRET="change-me-too"
```

- [ ] **Step 4: Verify the schema compiles**

Run: `npx tsc --noEmit`
Expected: no type errors from `src/db/*`.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/client.ts drizzle.config.ts .env.example
git commit -m "feat(SURV-8): add drizzle schema, db client, env example"
```

---

## Task 7: Data access queries

Thin typed wrappers over Drizzle, consumed by actions and the cron. Verified manually against a real Supabase DB in Task 13.

**Files:**
- Create: `src/db/queries.ts`

- [ ] **Step 1: Implement queries**

Create `src/db/queries.ts`:
```ts
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat(SURV-9): add typed data-access queries"
```

---

## Task 8: Session helper + auth actions

**Files:**
- Create: `src/lib/session.ts`, `src/app/actions/auth-actions.ts`

- [ ] **Step 1: Add a server-side session reader**

Create `src/lib/session.ts`:
```ts
import { cookies } from 'next/headers'
import { readSession } from './auth'
import { getParticipantById } from '@/db/queries'

const COOKIE = 'survival_session'

export async function currentParticipant() {
  const store = await cookies()
  const token = store.get(COOKIE)?.value
  if (!token) return null
  const session = await readSession(token, process.env.SESSION_SECRET!)
  if (!session) return null
  return getParticipantById(session.participantId)
}

export const SESSION_COOKIE = COOKIE
```

- [ ] **Step 2: Add login/logout server actions**

Create `src/app/actions/auth-actions.ts`:
```ts
'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyPassword, createSession } from '@/lib/auth'
import { SESSION_COOKIE } from '@/lib/session'
import { getParticipantByUsername } from '@/db/queries'

export async function login(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const username = String(formData.get('username') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const participant = await getParticipantByUsername(username)
  if (!participant || !(await verifyPassword(password, participant.passwordHash))) {
    return { error: 'Usuário ou senha inválidos' }
  }
  const token = await createSession(participant.id, process.env.SESSION_SECRET!)
  const store = await cookies()
  store.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 60, path: '/' })
  redirect('/')
}

export async function logout(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
  redirect('/login')
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/session.ts src/app/actions/auth-actions.ts
git commit -m "feat(SURV-10): add session reader and login/logout actions"
```

---

## Task 9: Pick + admin actions

Glue: combine queries + pure rules to enforce deadline/visibility/validation server-side.

**Files:**
- Create: `src/app/actions/pick-actions.ts`, `src/app/actions/admin-actions.ts`

- [ ] **Step 1: Pick actions (submit + visibility-aware read)**

Create `src/app/actions/pick-actions.ts`:
```ts
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
```

- [ ] **Step 2: Admin actions (create participants + override result)**

Create `src/app/actions/admin-actions.ts`:
```ts
'use server'

import { revalidatePath } from 'next/cache'
import { currentParticipant } from '@/lib/session'
import { hashPassword, generatePassword } from '@/lib/auth'
import { db } from '@/db/client'
import { participants } from '@/db/schema'
import { setMatchResult } from '@/db/queries'

async function requireAdmin() {
  const me = await currentParticipant()
  if (!me || !me.isAdmin) throw new Error('forbidden')
  return me
}

export async function createParticipant(name: string, username: string): Promise<{ username: string; password: string }> {
  await requireAdmin()
  const password = generatePassword()
  const passwordHash = await hashPassword(password)
  await db.insert(participants).values({ name, username: username.toLowerCase(), passwordHash })
  revalidatePath('/admin')
  return { username: username.toLowerCase(), password }
}

export async function overrideResult(matchId: string, homeScore: number, awayScore: number): Promise<void> {
  await requireAdmin()
  await setMatchResult(matchId, homeScore, awayScore)
  revalidatePath('/admin')
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/pick-actions.ts src/app/actions/admin-actions.ts
git commit -m "feat(SURV-11): add pick and admin server actions"
```

---

## Task 10: Settlement cron endpoint

Fetches results, updates matches, settles each unsettled day with `settleDay`, then recomputes winners. Idempotent and protected by `CRON_SECRET`.

**Files:**
- Create: `src/app/api/cron/settle/route.ts`, `vercel.json`

- [ ] **Step 1: Implement the cron route**

Create `src/app/api/cron/settle/route.ts`:
```ts
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
```

- [ ] **Step 2: Configure the Vercel cron**

Create `vercel.json`:
```json
{
  "crons": [
    { "path": "/api/cron/settle", "schedule": "0 */2 * * *" }
  ]
}
```
> Note: Vercel cron calls the path with a `Bearer $CRON_SECRET` header only if you also set it. Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` env var is set. Confirm in Vercel docs during deploy (Task 13).

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/cron/settle/route.ts" vercel.json
git commit -m "feat(SURV-12): add idempotent settlement cron endpoint"
```

---

## Task 11: UI — login, dashboard, admin

Minimal, responsive Tailwind UI. Server Components fetch data; small Client Components handle the forms.

**Files:**
- Modify: `src/app/layout.tsx`, `src/app/page.tsx`
- Create: `src/app/login/page.tsx`, `src/app/admin/page.tsx`, `src/app/_components/PickForm.tsx`, `src/app/_components/LoginForm.tsx`, `src/app/_components/AdminPanel.tsx`

- [ ] **Step 1: Login page**

Create `src/app/login/page.tsx`:
```tsx
import { LoginForm } from '@/app/_components/LoginForm'
import { currentParticipant } from '@/lib/session'
import { redirect } from 'next/navigation'

export default async function LoginPage() {
  if (await currentParticipant()) redirect('/')
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-6 text-2xl font-bold">Survival Copa 2026</h1>
      <LoginForm />
    </main>
  )
}
```

Create `src/app/_components/LoginForm.tsx`:
```tsx
'use client'
import { useActionState } from 'react'
import { login } from '@/app/actions/auth-actions'

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, {})
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input name="username" placeholder="usuário" autoCapitalize="none" className="rounded border p-2" required />
      <input name="password" type="password" placeholder="senha" className="rounded border p-2" required />
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className="rounded bg-black p-2 text-white disabled:opacity-50">
        {pending ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Dashboard page**

Replace `src/app/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
import { currentParticipant } from '@/lib/session'
import { getTodayBoard } from '@/app/actions/pick-actions'
import { listParticipants } from '@/db/queries'
import { PickForm } from '@/app/_components/PickForm'
import { logout } from '@/app/actions/auth-actions'

export default async function Dashboard() {
  const me = await currentParticipant()
  if (!me) redirect('/login')
  const board = await getTodayBoard()
  const everyone = await listParticipants()

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Survival Copa 2026</h1>
        <form action={logout}><button className="text-sm underline">sair ({me.name})</button></form>
      </div>

      {me.status === 'eliminated' ? (
        <p className="mb-6 rounded bg-red-100 p-3">Você foi eliminado em {me.eliminatedDate} ({me.eliminatedReason}).</p>
      ) : board && board.matches.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 font-semibold">Palpite de hoje ({board.date})</h2>
          <p className="mb-2 text-sm text-gray-600">
            Deadline: {board.deadline ? new Date(board.deadline).toLocaleString('pt-BR') : '—'}
          </p>
          {board.deadlinePassed ? (
            <p className="text-sm">Palpites travados.</p>
          ) : (
            <PickForm
              matches={board.matches.map((m) => ({ id: m.id, homeTeam: m.homeTeam, awayTeam: m.awayTeam }))}
              teamsUsed={board.teamsUsed}
              currentPick={board.picks.find((p) => p.participantId === me.id)?.team ?? null}
            />
          )}
        </section>
      ) : (
        <p className="mb-6 text-gray-600">Nenhum jogo hoje. Descanse.</p>
      )}

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Palpites de hoje</h2>
        <ul className="text-sm">
          {everyone.map((p) => {
            const pick = board?.picks.find((x) => x.participantId === p.id)
            const hidden = !board?.deadlinePassed && p.id !== me.id
            return (
              <li key={p.id} className="flex justify-between border-b py-1">
                <span>{p.name}</span>
                <span>{hidden ? '🔒 oculto' : (pick?.team ?? '—')}</span>
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Ranking</h2>
        <ul className="text-sm">
          {everyone.map((p) => (
            <li key={p.id} className="flex justify-between border-b py-1">
              <span>{p.name}</span>
              <span>{p.status === 'alive' ? '🟢 vivo' : `❌ caiu ${p.eliminatedDate ?? ''}`}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
```

- [ ] **Step 3: Pick form client component**

Create `src/app/_components/PickForm.tsx`:
```tsx
'use client'
import { useActionState } from 'react'
import { submitPick } from '@/app/actions/pick-actions'

type M = { id: string; homeTeam: string; awayTeam: string }
const ERROR_PT: Record<string, string> = {
  eliminated: 'Você está eliminado.',
  deadline_passed: 'O deadline já passou.',
  not_playing_today: 'Esse time não joga hoje.',
  team_already_used: 'Você já usou esse time.',
}

export function PickForm({ matches, teamsUsed, currentPick }: { matches: M[]; teamsUsed: string[]; currentPick: string | null }) {
  const [state, formAction, pending] = useActionState(submitPick, {})
  const teams = Array.from(new Set(matches.flatMap((m) => [m.homeTeam, m.awayTeam])))
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <select name="team" defaultValue={currentPick ?? ''} className="rounded border p-2" required>
        <option value="" disabled>escolha um time…</option>
        {teams.map((t) => (
          <option key={t} value={t} disabled={teamsUsed.includes(t) && t !== currentPick}>
            {t} {teamsUsed.includes(t) ? '(já usado)' : ''}
          </option>
        ))}
      </select>
      {state?.error && <p className="text-sm text-red-600">{ERROR_PT[state.error] ?? state.error}</p>}
      {state?.ok && <p className="text-sm text-green-600">Palpite salvo!</p>}
      <button disabled={pending} className="rounded bg-black p-2 text-white disabled:opacity-50">
        {pending ? 'Salvando…' : currentPick ? 'Trocar palpite' : 'Confirmar palpite'}
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Admin page + panel**

Create `src/app/admin/page.tsx`:
```tsx
import { redirect } from 'next/navigation'
import { currentParticipant } from '@/lib/session'
import { listParticipants, getMatchesByDate } from '@/db/queries'
import { brtDateString } from '@/lib/tz'
import { AdminPanel } from '@/app/_components/AdminPanel'

export default async function AdminPage() {
  const me = await currentParticipant()
  if (!me) redirect('/login')
  if (!me.isAdmin) redirect('/')
  const everyone = await listParticipants()
  const today = brtDateString(new Date())
  const todayMatches = await getMatchesByDate(today)
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Admin</h1>
      <AdminPanel
        participants={everyone.map((p) => ({ id: p.id, name: p.name, username: p.username }))}
        todayMatches={todayMatches.map((m) => ({ id: m.id, homeTeam: m.homeTeam, awayTeam: m.awayTeam, status: m.status }))}
      />
    </main>
  )
}
```

Create `src/app/_components/AdminPanel.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { createParticipant, overrideResult } from '@/app/actions/admin-actions'

type P = { id: string; name: string; username: string }
type M = { id: string; homeTeam: string; awayTeam: string; status: string }

export function AdminPanel({ participants, todayMatches }: { participants: P[]; todayMatches: M[] }) {
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null)

  async function addPlayer(formData: FormData) {
    const name = String(formData.get('name'))
    const username = String(formData.get('username'))
    setCreated(await createParticipant(name, username))
  }
  async function setResult(formData: FormData) {
    await overrideResult(String(formData.get('matchId')), Number(formData.get('home')), Number(formData.get('away')))
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-2 font-semibold">Cadastrar participante</h2>
        <form action={addPlayer} className="flex gap-2">
          <input name="name" placeholder="nome" className="rounded border p-2" required />
          <input name="username" placeholder="usuário" className="rounded border p-2" required />
          <button className="rounded bg-black px-3 text-white">criar</button>
        </form>
        {created && (
          <p className="mt-2 rounded bg-yellow-100 p-2 text-sm">
            Senha de <b>{created.username}</b>: <code>{created.password}</code> — anote e envie!
          </p>
        )}
        <ul className="mt-3 text-sm">{participants.map((p) => <li key={p.id}>{p.name} (@{p.username})</li>)}</ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Resultado manual (hoje)</h2>
        {todayMatches.length === 0 && <p className="text-sm text-gray-600">Sem jogos hoje.</p>}
        {todayMatches.map((m) => (
          <form key={m.id} action={setResult} className="mb-2 flex items-center gap-2 text-sm">
            <input type="hidden" name="matchId" value={m.id} />
            <span className="w-40 text-right">{m.homeTeam}</span>
            <input name="home" type="number" min="0" className="w-14 rounded border p-1" required />
            <span>x</span>
            <input name="away" type="number" min="0" className="w-14 rounded border p-1" required />
            <span className="w-40">{m.awayTeam}</span>
            <button className="rounded bg-black px-2 py-1 text-white">salvar</button>
          </form>
        ))}
      </section>
    </div>
  )
}
```

- [ ] **Step 5: Verify it compiles and builds**

Run: `npx tsc --noEmit && npm run build`
Expected: type check passes; Next build succeeds (DB calls are not executed at build time because pages are dynamic — if build tries to statically render, add `export const dynamic = 'force-dynamic'` to `page.tsx` and `admin/page.tsx`).

- [ ] **Step 6: Commit**

```bash
git add src/app
git commit -m "feat(SURV-13): add login, dashboard, and admin UI"
```

---

## Task 12: Fixture seeding script

Seeds the full 2026 World Cup schedule into `matches` so the app works even before/without the API. Uses football-data if a token is present; otherwise instructs manual entry.

**Files:**
- Create: `src/scripts/seed-fixtures.ts`

- [ ] **Step 1: Implement the seed script**

Create `src/scripts/seed-fixtures.ts`:
```ts
import 'dotenv/config'
import { fetchWorldCupMatches } from '@/lib/football-data'
import { brtDateString } from '@/lib/tz'
import { upsertMatch } from '@/db/queries'

async function main() {
  const token = process.env.FOOTBALL_DATA_TOKEN
  if (!token) {
    console.error('No FOOTBALL_DATA_TOKEN set. Add fixtures manually via /admin, or set the token and re-run.')
    process.exit(1)
  }
  const matches = await fetchWorldCupMatches(token, '2026-06-11', '2026-07-19')
  for (const m of matches) {
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
  console.log(`Seeded ${matches.length} matches.`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Add dotenv for the script**

Run: `npm install -D dotenv`

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/seed-fixtures.ts package.json package-lock.json
git commit -m "feat(SURV-14): add world cup fixture seeding script"
```

---

## Task 13: Deploy + bootstrap docs

**Files:**
- Create: `docs/DEPLOY.md`

- [ ] **Step 1: Write the deploy guide**

Create `docs/DEPLOY.md`:
```markdown
# Deploy (100% free)

## 1. Supabase (Postgres)
1. Create a project at supabase.com (free tier).
2. Project Settings → Database → Connection string → **URI** (use the pooler, port 6543).
3. Put it in `.env` as `DATABASE_URL`.

## 2. Local setup
```bash
cp .env.example .env   # fill DATABASE_URL, SESSION_SECRET, CRON_SECRET, FOOTBALL_DATA_TOKEN
npm install
npm run db:push        # create tables in Supabase
npm run seed:fixtures  # load the WC schedule (needs FOOTBALL_DATA_TOKEN)
```

## 3. Create the admin (bruno)
Run a one-off Node/tsx snippet or temporarily allow open admin creation. Simplest: insert via Supabase SQL editor using a bcrypt hash, or run:
```bash
npx tsx -e "import('dotenv/config').then(async()=>{const {hashPassword,generatePassword}=await import('./src/lib/auth.ts');const {db}=await import('./src/db/client.ts');const {participants}=await import('./src/db/schema.ts');const pw=generatePassword();await db.insert(participants).values({name:'Bruno',username:'bruno',isAdmin:true,passwordHash:await hashPassword(pw)});console.log('bruno senha:',pw);process.exit(0)})"
```
Save the printed password. Log in as `bruno`, then add the others (rato, bitu, bigode, pedropaulo) from `/admin`.

## 4. Vercel
1. Push the repo to GitHub.
2. Import into Vercel (free Hobby plan).
3. Add env vars: `DATABASE_URL`, `SESSION_SECRET`, `CRON_SECRET`, `FOOTBALL_DATA_TOKEN`.
4. Deploy. The cron in `vercel.json` runs every 2h and settles results.

## 5. Manual results fallback
If the API misses a game, go to `/admin` and enter the score manually — the next cron run settles it. Draw (incl. penalty losses) survives.
```

- [ ] **Step 2: Run the full test suite**

Run: `npm run test`
Expected: all unit tests (tz, rules, pick-validation, auth, football-data) PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs(SURV-15): add free deployment and bootstrap guide"
```

---

## Self-Review Notes

- **Spec coverage:** rules (Task 2), deadline/timezone (Task 1), visibility (Task 9 `getTodayBoard`), no-repeat + 1/day (Task 6 unique constraints + Task 3), no-pick elimination (Task 2/10), auto results + manual override (Tasks 5/10/9-admin), winner sharing (Task 2 `decideWinners`), auth with generated passwords (Tasks 4/9-admin), free hosting (Task 13). All spec sections map to a task.
- **Manual-only verification:** DB queries (Task 7), UI (Task 11), and live deploy (Task 13) are verified by `tsc`/`build`/manual run rather than automated tests — acceptable since all game logic is pure and unit-tested.
- **Open follow-up at execution time:** confirm football-data.org free tier actually serves competition `WC`; if not, rely on manual fixture entry via `/admin` (the design already treats the API as non-critical).
```
