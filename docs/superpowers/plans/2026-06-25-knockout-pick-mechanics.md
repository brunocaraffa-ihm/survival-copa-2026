# Knockout Pick Mechanics (Groups of 4) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the knockout phase's per-Match-Day picking with fixed-size pick groups (16avos 4×4, oitavas 2×4, quartas 2×2, semi 1×2, final 1×1), where a pick survives only if the team **advances**, lives carry over, running out of eligible teams eliminates, and the champion-picker wins the tiebreak.

**Architecture:** A pure `buildPickGroups(matches)` function unifies both phases into an ordered list of pick groups keyed by a stable `groupKey`. Picks and life-losses are keyed by `groupKey` (group stage: `groupKey = matchDate`, so behavior is unchanged). Settlement, schedule, results, and winner logic all consume pick groups and branch on `phase`. Penalties are captured to detect knockout advancement.

**Tech Stack:** Next.js 16 (App Router, server actions), Drizzle ORM + Postgres (`drizzle-kit push`, no migration files), Vitest (pure unit tests, `@` → `src` alias).

---

## File Structure

- `src/lib/groups.ts` (**create**) — `PickGroup` type, knockout stage config, `buildPickGroups(matches)`.
- `src/lib/groups.test.ts` (**create**) — tests for `buildPickGroups`.
- `src/lib/rules.ts` (**modify**) — add `teamAdvanced`, `SettleMatch`, `Reason`; replace `settleDay`→`settleGroup`; refactor `computeStanding`; extend `decideWinners`.
- `src/lib/rules.test.ts` (**modify**) — update tests for the changed signatures + new behaviors.
- `src/lib/football-data.ts` (**modify**) — capture penalties in `mapApiMatch`/`MappedMatch`.
- `src/lib/football-data.test.ts` (**modify**) — assert penalty capture.
- `src/db/schema.ts` (**modify**) — `picks.groupKey`, `life_losses.groupKey` + `no_options`, `matches` penalties, constraint swaps.
- `src/scripts/backfill-groupkey.ts` (**create**) — one-off backfill `groupKey = matchDate` for existing rows.
- `src/db/queries.ts` (**modify**) — group-keyed pick/loss helpers, penalty setter, all-matches/all-picks helpers.
- `src/app/actions/pick-actions.ts` (**modify**) — `getSchedule`/`submitPick`/`getResults` by pick group.
- `src/app/api/cron/settle/route.ts` (**modify**) — settle by pick group, phase-aware, champion.
- `src/app/actions/admin-actions.ts` (**modify**) — `overrideResult` accepts penalties.
- `src/app/_components/AdminPanel.tsx` (**modify**) — optional penalty inputs.
- `src/app/page.tsx` (**modify**) — render pick groups, extended winner call.
- `src/app/_components/DayPickForm.tsx` (**modify**) — accept `groupKey`/label, knockout copy, no-options state.
- `src/app/resultados/page.tsx` (**modify**) — group labels + advance/eliminated outcomes.

---

## Task 1: `buildPickGroups` + knockout stage config

**Files:**
- Create: `src/lib/groups.ts`
- Test: `src/lib/groups.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/groups.test.ts
import { describe, it, expect } from 'vitest'
import { buildPickGroups, type PickGroupMatch } from './groups'

let _id = 0
function m(stage: string, home: string, away: string, kickoffIso: string, matchDate: string): PickGroupMatch {
  return { id: `m${_id++}`, stage, homeTeam: home, awayTeam: away, utcKickoff: new Date(kickoffIso), matchDate }
}

// 2 group-stage days, then a full knockout bracket (16 + 8 + 4 + 2 + 1 + 1 third-place).
function knockoutFixtures(): PickGroupMatch[] {
  const out: PickGroupMatch[] = []
  const day = (n: number) => `2026-07-${String(n).padStart(2, '0')}`
  // group stage
  out.push(m('GROUP_STAGE', 'A', 'B', '2026-06-11T16:00:00Z', '2026-06-11'))
  out.push(m('GROUP_STAGE', 'C', 'D', '2026-06-11T19:00:00Z', '2026-06-11'))
  out.push(m('GROUP_STAGE', 'E', 'F', '2026-06-12T16:00:00Z', '2026-06-12'))
  // LAST_32: 16 games
  for (let i = 0; i < 16; i++) out.push(m('LAST_32', `R32H${i}`, `R32A${i}`, `2026-07-0${1 + Math.floor(i / 8)}T${10 + (i % 8)}:00:00Z`, day(1 + Math.floor(i / 8))))
  // LAST_16: 8 games
  for (let i = 0; i < 8; i++) out.push(m('LAST_16', `R16H${i}`, `R16A${i}`, `2026-07-0${5 + Math.floor(i / 4)}T${10 + (i % 4)}:00:00Z`, day(5 + Math.floor(i / 4))))
  // QUARTER_FINALS: 4 games
  for (let i = 0; i < 4; i++) out.push(m('QUARTER_FINALS', `QFH${i}`, `QFA${i}`, `2026-07-${String(9 + Math.floor(i / 2)).padStart(2, '0')}T${10 + (i % 2)}:00:00Z`, day(9 + Math.floor(i / 2))))
  // SEMI_FINALS: 2 games
  for (let i = 0; i < 2; i++) out.push(m('SEMI_FINALS', `SFH${i}`, `SFA${i}`, `2026-07-1${4 + i}T18:00:00Z`, day(14 + i)))
  // THIRD_PLACE: 1 game (excluded)
  out.push(m('THIRD_PLACE', 'T1', 'T2', '2026-07-17T18:00:00Z', '2026-07-17'))
  // FINAL: 1 game
  out.push(m('FINAL', 'F1', 'F2', '2026-07-19T18:00:00Z', '2026-07-19'))
  return out
}

describe('buildPickGroups', () => {
  it('group stage = one group per match day, labelled Match Day N', () => {
    const groups = buildPickGroups(knockoutFixtures()).filter((g) => g.phase === 'group')
    expect(groups.map((g) => g.label)).toEqual(['Match Day 1', 'Match Day 2'])
    expect(groups[0].key).toBe('g:2026-06-11')
    expect(groups[0].teams.sort()).toEqual(['A', 'B', 'C', 'D'])
  })

  it('produces exactly 10 knockout groups in the 4/4/2/2/1 shape, excluding 3rd place', () => {
    const ko = buildPickGroups(knockoutFixtures()).filter((g) => g.phase === 'knockout')
    expect(ko.length).toBe(10)
    const labels = ko.map((g) => g.label)
    expect(labels).toEqual([
      '16avos · Grupo 1', '16avos · Grupo 2', '16avos · Grupo 3', '16avos · Grupo 4',
      'Oitavas · Grupo 1', 'Oitavas · Grupo 2',
      'Quartas · Grupo 1', 'Quartas · Grupo 2',
      'Semifinal',
      'Final',
    ])
    expect(ko.find((g) => g.label === '16avos · Grupo 1')!.matchIds.length).toBe(4)
    expect(ko.find((g) => g.label === 'Quartas · Grupo 1')!.matchIds.length).toBe(2)
    expect(ko.find((g) => g.label === 'Final')!.matchIds.length).toBe(1)
  })

  it('never includes the third-place match in any group', () => {
    const all = buildPickGroups(knockoutFixtures())
    expect(all.some((g) => g.teams.includes('T1') || g.teams.includes('T2'))).toBe(false)
  })

  it('keys are stable and groups are ordered by earliest kickoff', () => {
    const all = buildPickGroups(knockoutFixtures())
    expect(all.map((g) => g.order)).toEqual([...all.map((_, i) => i)])
    expect(all[0].key).toBe('g:2026-06-11')
    expect(all[all.length - 1].key).toBe('k:FINAL:1')
  })

  it('excludes TBD placeholders from a group\'s teams', () => {
    const groups = buildPickGroups([
      m('LAST_32', 'Brazil', 'TBD', '2026-07-01T10:00:00Z', '2026-07-01'),
    ])
    expect(groups[0].teams).toEqual(['Brazil'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/groups.test.ts`
Expected: FAIL — `Cannot find module './groups'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/groups.ts
import { phaseOf, type Phase } from './rules'

export type PickGroupMatch = {
  id: string
  stage: string
  homeTeam: string
  awayTeam: string
  utcKickoff: Date
  matchDate: string
}

export type PickGroup = {
  key: string
  phase: Phase
  label: string
  order: number
  matchIds: string[]
  teams: string[]
}

/** Knockout stages in bracket order with the pick-group size for each.
 *  THIRD_PLACE is intentionally absent → no group, no pick.
 *  NOTE: confirm `LAST_32` is football-data's label for the round of 32. */
const KO_STAGES: { stage: string; size: number; label: string }[] = [
  { stage: 'LAST_32', size: 4, label: '16avos' },
  { stage: 'LAST_16', size: 4, label: 'Oitavas' },
  { stage: 'QUARTER_FINALS', size: 2, label: 'Quartas' },
  { stage: 'SEMI_FINALS', size: 2, label: 'Semifinal' },
  { stage: 'FINAL', size: 1, label: 'Final' },
]

function teamsOf(ms: PickGroupMatch[]): string[] {
  const set = new Set<string>()
  for (const m of ms) {
    if (m.homeTeam !== 'TBD') set.add(m.homeTeam)
    if (m.awayTeam !== 'TBD') set.add(m.awayTeam)
  }
  return [...set]
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Build the ordered list of pick groups across both phases. Pure. */
export function buildPickGroups(matches: PickGroupMatch[]): PickGroup[] {
  type Interim = Omit<PickGroup, 'order'> & { minKick: number }
  const interim: Interim[] = []
  const minKick = (ms: PickGroupMatch[]) => Math.min(...ms.map((m) => m.utcKickoff.getTime()))

  // group stage → one group per match day
  const byDate = new Map<string, PickGroupMatch[]>()
  for (const m of matches) {
    if (phaseOf(m.stage) !== 'group') continue
    const arr = byDate.get(m.matchDate) ?? []
    arr.push(m)
    byDate.set(m.matchDate, arr)
  }
  ;[...byDate.keys()].sort().forEach((date, i) => {
    const ms = byDate.get(date)!
    interim.push({
      key: `g:${date}`, phase: 'group', label: `Match Day ${i + 1}`,
      matchIds: ms.map((m) => m.id), teams: teamsOf(ms), minKick: minKick(ms),
    })
  })

  // knockout → chunk each stage by kickoff order
  for (const cfg of KO_STAGES) {
    const stageMatches = matches
      .filter((m) => m.stage === cfg.stage)
      .sort((a, b) => a.utcKickoff.getTime() - b.utcKickoff.getTime())
    if (stageMatches.length === 0) continue
    const chunks = chunk(stageMatches, cfg.size)
    chunks.forEach((ms, i) => {
      interim.push({
        key: `k:${cfg.stage}:${i + 1}`,
        phase: 'knockout',
        label: chunks.length === 1 ? cfg.label : `${cfg.label} · Grupo ${i + 1}`,
        matchIds: ms.map((m) => m.id), teams: teamsOf(ms), minKick: minKick(ms),
      })
    })
  }

  return interim
    .sort((a, b) => a.minKick - b.minKick)
    .map(({ minKick: _m, ...g }, order) => ({ ...g, order }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/groups.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/lib/groups.ts src/lib/groups.test.ts
git commit -m "feat(SURV-26): buildPickGroups unifies match days and knockout groups"
```

---

## Task 2: `teamAdvanced` (knockout survival via penalties)

**Files:**
- Modify: `src/lib/rules.ts`
- Test: `src/lib/rules.test.ts`

- [ ] **Step 1: Write the failing test** — append to `src/lib/rules.test.ts`

```ts
import { teamAdvanced } from './rules'

describe('teamAdvanced', () => {
  const ko = (h: string, a: string, hs: number, as: number, hp: number | null = null, ap: number | null = null) => ({
    homeTeam: h, awayTeam: a, homeScore: hs, awayScore: as, homePenalties: hp, awayPenalties: ap,
  })
  it('advances on a regulation/ET win', () => {
    expect(teamAdvanced(ko('Brazil', 'Serbia', 2, 0), 'Brazil')).toBe(true)
    expect(teamAdvanced(ko('Brazil', 'Serbia', 2, 0), 'Serbia')).toBe(false)
  })
  it('a draw decided on penalties: winner advances, loser does not', () => {
    expect(teamAdvanced(ko('Brazil', 'Croatia', 1, 1, 4, 2), 'Brazil')).toBe(true)
    expect(teamAdvanced(ko('Brazil', 'Croatia', 1, 1, 4, 2), 'Croatia')).toBe(false)
  })
  it('a draw with no penalties recorded is undecided (null)', () => {
    expect(teamAdvanced(ko('Brazil', 'Croatia', 1, 1), 'Brazil')).toBeNull()
  })
  it('throws if the team is not in the match', () => {
    expect(() => teamAdvanced(ko('Brazil', 'Croatia', 1, 0), 'France')).toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rules.test.ts -t teamAdvanced`
Expected: FAIL — `teamAdvanced is not a function`.

- [ ] **Step 3: Add the implementation** — in `src/lib/rules.ts`, after `teamSurvives`

```ts
/** A knockout match's score + penalties (penalties null until/unless a shootout happened). */
export type AdvanceMatch = {
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  homePenalties: number | null
  awayPenalties: number | null
}

/** Did `team` advance? true = advanced, false = eliminated, null = undecided
 *  (drew in regulation/ET with no penalty result yet). */
export function teamAdvanced(m: AdvanceMatch, team: string): boolean | null {
  const isHome = m.homeTeam === team
  const isAway = m.awayTeam === team
  if (!isHome && !isAway) throw new Error(`Team ${team} not in match`)
  const own = isHome ? m.homeScore : m.awayScore
  const opp = isHome ? m.awayScore : m.homeScore
  if (own > opp) return true
  if (own < opp) return false
  const ownP = isHome ? m.homePenalties : m.awayPenalties
  const oppP = isHome ? m.awayPenalties : m.homePenalties
  if (ownP === null || oppP === null) return null
  return ownP > oppP
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/rules.test.ts -t teamAdvanced`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules.ts src/lib/rules.test.ts
git commit -m "feat(SURV-26): teamAdvanced decides knockout survival incl. penalties"
```

---

## Task 3: `settleGroup` (phase-aware, no_options) replaces `settleDay`

**Files:**
- Modify: `src/lib/rules.ts`
- Test: `src/lib/rules.test.ts`

- [ ] **Step 1: Replace the `settleDay` test block** — in `src/lib/rules.test.ts`, delete the entire `describe('settleDay', …)` block and the `SettleInput` import, and add this block:

```ts
import { settleGroup } from './rules'
import type { SettleGroupInput } from './rules'

describe('settleGroup — group phase (draw saves)', () => {
  const base: SettleGroupInput = {
    groupKey: 'g:2026-06-11', date: '2026-06-11', phase: 'group',
    hasMatches: true, deadlinePassed: true,
    participants: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    picks: [
      { participantId: 'p1', team: 'Brazil', match: { homeTeam: 'Brazil', awayTeam: 'Serbia', homeScore: 2, awayScore: 0, homePenalties: null, awayPenalties: null, status: 'FINISHED' } },
      { participantId: 'p2', team: 'Mexico', match: { homeTeam: 'Mexico', awayTeam: 'Argentina', homeScore: 0, awayScore: 2, homePenalties: null, awayPenalties: null, status: 'FINISHED' } },
      // p3 no pick
    ],
  }
  it('loses a life on a losing pick', () => {
    expect(settleGroup(base)).toContainEqual({ participantId: 'p2', reason: 'lost', date: '2026-06-11', groupKey: 'g:2026-06-11' })
  })
  it('a draw does NOT cost a life in the group phase', () => {
    const out = settleGroup({ ...base, picks: [{ participantId: 'p1', team: 'Brazil', match: { homeTeam: 'Brazil', awayTeam: 'Croatia', homeScore: 1, awayScore: 1, homePenalties: null, awayPenalties: null, status: 'FINISHED' } }] })
    expect(out.find((e) => e.participantId === 'p1')).toBeUndefined()
  })
  it('no pick after deadline = no_pick', () => {
    expect(settleGroup(base)).toContainEqual({ participantId: 'p3', reason: 'no_pick', date: '2026-06-11', groupKey: 'g:2026-06-11' })
  })
  it('no no_pick when the group has no matches or before the deadline', () => {
    expect(settleGroup({ ...base, hasMatches: false, picks: [] }).length).toBe(0)
    expect(settleGroup({ ...base, deadlinePassed: false, picks: [] }).length).toBe(0)
  })
  it('leaves a pending pick (match not finished) alone', () => {
    const out = settleGroup({ ...base, picks: [{ participantId: 'p1', team: 'Brazil', match: null }] })
    expect(out.find((e) => e.participantId === 'p1')).toBeUndefined()
  })
})

describe('settleGroup — knockout phase (must advance)', () => {
  const base: SettleGroupInput = {
    groupKey: 'k:LAST_32:1', date: '2026-07-01', phase: 'knockout',
    hasMatches: true, deadlinePassed: true,
    groupTeams: ['Brazil', 'Serbia', 'France', 'Mexico'],
    usedKnockoutTeams: new Map([['p3', ['Brazil', 'Serbia', 'France', 'Mexico']]]),
    participants: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
    picks: [
      { participantId: 'p1', team: 'Brazil', match: { homeTeam: 'Brazil', awayTeam: 'Serbia', homeScore: 1, awayScore: 1, homePenalties: 4, awayPenalties: 2, status: 'FINISHED' } },
      { participantId: 'p2', team: 'France', match: { homeTeam: 'France', awayTeam: 'Mexico', homeScore: 1, awayScore: 1, homePenalties: 2, awayPenalties: 4, status: 'FINISHED' } },
      // p3 no pick, and has used every team in the group
    ],
  }
  it('a draw won on penalties advances → no life lost', () => {
    expect(settleGroup(base).find((e) => e.participantId === 'p1')).toBeUndefined()
  })
  it('a draw lost on penalties → loses a life', () => {
    expect(settleGroup(base)).toContainEqual({ participantId: 'p2', reason: 'lost', date: '2026-07-01', groupKey: 'k:LAST_32:1' })
  })
  it('no pick + every group team already used → no_options', () => {
    expect(settleGroup(base)).toContainEqual({ participantId: 'p3', reason: 'no_options', date: '2026-07-01', groupKey: 'k:LAST_32:1' })
  })
  it('no pick but an eligible team remains → no_pick (not no_options)', () => {
    const out = settleGroup({ ...base, usedKnockoutTeams: new Map([['p3', ['Brazil', 'Serbia']]]) })
    expect(out).toContainEqual({ participantId: 'p3', reason: 'no_pick', date: '2026-07-01', groupKey: 'k:LAST_32:1' })
  })
  it('a draw with no penalties yet leaves the pick pending', () => {
    const out = settleGroup({ ...base, picks: [{ participantId: 'p1', team: 'Brazil', match: { homeTeam: 'Brazil', awayTeam: 'Serbia', homeScore: 1, awayScore: 1, homePenalties: null, awayPenalties: null, status: 'FINISHED' } }] })
    expect(out.find((e) => e.participantId === 'p1')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rules.test.ts`
Expected: FAIL — `settleGroup is not a function` (and the old `settleDay`/`SettleInput` references are gone).

- [ ] **Step 3: Replace `settleDay` in `src/lib/rules.ts`** — delete `EliminationReason`, `SettleInput`, `Elimination`, and `settleDay`; add:

```ts
export type Reason = 'lost' | 'no_pick' | 'no_options'

/** A finished match with penalties — used by settlement for both phases. */
export type SettleMatch = {
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  homePenalties: number | null
  awayPenalties: number | null
  status: 'FINISHED'
}

export type SettleGroupInput = {
  groupKey: string
  /** Representative date for the loss event (group deadline date in BRT). */
  date: string
  phase: Phase
  hasMatches: boolean
  deadlinePassed: boolean
  /** Alive participants only. */
  participants: { id: string }[]
  /** Each pick's chosen team and that team's match (finished, or null = pending). */
  picks: { participantId: string; team: string; match: SettleMatch | null }[]
  /** Knockout only: non-TBD teams in this group. */
  groupTeams?: string[]
  /** Knockout only: teams each participant already used in the knockout phase. */
  usedKnockoutTeams?: Map<string, string[]>
}

export type LossEvent = { participantId: string; reason: Reason; date: string; groupKey: string }

/** Settle one pick group. Pure + idempotent (callers dedupe by groupKey). */
export function settleGroup(input: SettleGroupInput): LossEvent[] {
  const out: LossEvent[] = []
  const pickByPid = new Map(input.picks.map((p) => [p.participantId, p]))
  const ev = (participantId: string, reason: Reason): LossEvent => ({
    participantId, reason, date: input.date, groupKey: input.groupKey,
  })

  for (const participant of input.participants) {
    const pick = pickByPid.get(participant.id)

    if (!pick) {
      if (!input.hasMatches || !input.deadlinePassed) continue
      if (input.phase === 'knockout') {
        const used = input.usedKnockoutTeams?.get(participant.id) ?? []
        const available = (input.groupTeams ?? []).filter((t) => !used.includes(t))
        out.push(ev(participant.id, available.length === 0 ? 'no_options' : 'no_pick'))
      } else {
        out.push(ev(participant.id, 'no_pick'))
      }
      continue
    }

    if (!pick.match || pick.match.status !== 'FINISHED') continue // pending

    if (input.phase === 'knockout') {
      const advanced = teamAdvanced(pick.match, pick.team)
      if (advanced === null) continue // shootout result not in yet → pending
      if (!advanced) out.push(ev(participant.id, 'lost'))
    } else {
      if (!teamSurvives(pick.match, pick.team)) out.push(ev(participant.id, 'lost'))
    }
  }
  return out
}
```

Note: `teamSurvives` already reads only the score fields, so passing a `SettleMatch` to it is fine.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/rules.test.ts`
Expected: PASS for both `settleGroup` blocks.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules.ts src/lib/rules.test.ts
git commit -m "feat(SURV-26): settleGroup replaces settleDay (phase-aware + no_options)"
```

---

## Task 4: `computeStanding` takes reason-tagged events

**Files:**
- Modify: `src/lib/rules.ts`
- Test: `src/lib/rules.test.ts`

- [ ] **Step 1: Replace the `computeStanding` test block** — swap the existing `describe('computeStanding', …)` for:

```ts
describe('computeStanding', () => {
  const loss = (date: string) => ({ date, reason: 'lost' as const })
  it('starts with 3 lives', () => {
    expect(computeStanding([])).toEqual({ lives: 3, eliminated: false, eliminatedDate: null })
  })
  it('loses one life per life-loss event', () => {
    expect(computeStanding([loss('2026-06-12')])).toEqual({ lives: 2, eliminated: false, eliminatedDate: null })
  })
  it('eliminates at the third loss, dated when lives hit zero', () => {
    expect(computeStanding([loss('2026-06-12'), loss('2026-06-20'), loss('2026-06-15')])).toEqual({
      lives: 0, eliminated: true, eliminatedDate: '2026-06-20',
    })
  })
  it('no_options eliminates immediately without spending a life', () => {
    expect(computeStanding([{ date: '2026-07-05', reason: 'no_options' }])).toEqual({
      lives: 3, eliminated: true, eliminatedDate: '2026-07-05',
    })
  })
  it('eliminatedDate is the earliest of zero-day and no_options', () => {
    const out = computeStanding([loss('2026-06-12'), loss('2026-06-13'), loss('2026-06-14'), { date: '2026-07-01', reason: 'no_options' }])
    expect(out.eliminatedDate).toBe('2026-06-14')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rules.test.ts -t computeStanding`
Expected: FAIL — `no_options` cases and the new event shape error.

- [ ] **Step 3: Replace `computeStanding` in `src/lib/rules.ts`**

```ts
/** Derive a participant's standing from their reason-tagged loss/elimination events. */
export function computeStanding(events: { date: string; reason: Reason }[]): {
  lives: number
  eliminated: boolean
  eliminatedDate: string | null
} {
  const lifeLossDates = events.filter((e) => e.reason === 'lost' || e.reason === 'no_pick').map((e) => e.date).sort()
  const lives = Math.max(0, STARTING_LIVES - lifeLossDates.length)
  const zeroDate = lifeLossDates.length >= STARTING_LIVES ? lifeLossDates[STARTING_LIVES - 1] : null
  const hardDates = events.filter((e) => e.reason === 'no_options').map((e) => e.date).sort()
  const hardDate = hardDates.length > 0 ? hardDates[0] : null
  const candidates = [zeroDate, hardDate].filter((d): d is string => d !== null).sort()
  const eliminatedDate = candidates.length > 0 ? candidates[0] : null
  return { lives, eliminated: eliminatedDate !== null, eliminatedDate }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/rules.test.ts -t computeStanding`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules.ts src/lib/rules.test.ts
git commit -m "feat(SURV-26): computeStanding consumes reason-tagged events (no_options)"
```

---

## Task 5: `decideWinners` — champion > lives > last-eliminated

**Files:**
- Modify: `src/lib/rules.ts`
- Test: `src/lib/rules.test.ts`

- [ ] **Step 1: Replace the `decideWinners` test block**

```ts
describe('decideWinners', () => {
  const part = (id: string, opts: Partial<{ eliminated: boolean; eliminatedDate: string | null; lives: number; finalPick: string | null }> = {}) => ({
    id, eliminated: opts.eliminated ?? false, eliminatedDate: opts.eliminatedDate ?? null,
    lives: opts.lives ?? 3, finalPick: opts.finalPick ?? null,
  })

  it('no winners while alive players remain and the tournament is ongoing', () => {
    expect(decideWinners({ participants: [part('a'), part('b', { eliminated: true, eliminatedDate: '2026-06-20' })], championTeam: null, tournamentOver: false })).toEqual([])
  })
  it('champion-picker wins outright, even with fewer lives', () => {
    const out = decideWinners({
      participants: [part('a', { lives: 1, finalPick: 'Brazil' }), part('b', { lives: 3, finalPick: 'France' })],
      championTeam: 'Brazil', tournamentOver: true,
    })
    expect(out).toEqual(['a'])
  })
  it('without a champion-picker, most lives wins (shared on ties)', () => {
    const out = decideWinners({
      participants: [part('a', { lives: 2, finalPick: 'X' }), part('b', { lives: 2, finalPick: 'Y' }), part('c', { lives: 1 })],
      championTeam: 'Brazil', tournamentOver: true,
    }).sort()
    expect(out).toEqual(['a', 'b'])
  })
  it('multiple champion-pickers share', () => {
    const out = decideWinners({
      participants: [part('a', { lives: 3, finalPick: 'Brazil' }), part('b', { lives: 1, finalPick: 'Brazil' })],
      championTeam: 'Brazil', tournamentOver: true,
    }).sort()
    expect(out).toEqual(['a', 'b'])
  })
  it('everyone eliminated → last to fall share', () => {
    const out = decideWinners({
      participants: [part('a', { eliminated: true, eliminatedDate: '2026-07-10' }), part('b', { eliminated: true, eliminatedDate: '2026-07-10' }), part('c', { eliminated: true, eliminatedDate: '2026-06-30' })],
      championTeam: 'Brazil', tournamentOver: true,
    }).sort()
    expect(out).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rules.test.ts -t decideWinners`
Expected: FAIL — new object-arg signature not yet supported.

- [ ] **Step 3: Replace `decideWinners` in `src/lib/rules.ts`**

```ts
/** Winner(s) at tournament end. Champion-picker trumps all; else most lives;
 *  else (nobody alive) the latest-eliminated share. [] while undecided. */
export function decideWinners(input: {
  participants: { id: string; eliminated: boolean; eliminatedDate: string | null; lives: number; finalPick: string | null }[]
  championTeam: string | null
  tournamentOver: boolean
}): string[] {
  const { participants, championTeam, tournamentOver } = input
  const alive = participants.filter((p) => !p.eliminated)

  if (alive.length > 0) {
    if (!tournamentOver) return []
    if (championTeam) {
      const champs = alive.filter((p) => p.finalPick === championTeam)
      if (champs.length > 0) return champs.map((p) => p.id)
    }
    const maxLives = Math.max(...alive.map((p) => p.lives))
    return alive.filter((p) => p.lives === maxLives).map((p) => p.id)
  }

  const dates = participants.map((p) => p.eliminatedDate).filter((d): d is string => d !== null)
  if (dates.length === 0) return []
  const last = dates.reduce((a, b) => (a >= b ? a : b))
  return participants.filter((p) => p.eliminatedDate === last).map((p) => p.id)
}
```

- [ ] **Step 4: Run the whole rules suite**

Run: `npx vitest run src/lib/rules.test.ts`
Expected: PASS (teamSurvives, teamAdvanced, settleGroup ×2, phaseOf, computeStanding, decideWinners).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules.ts src/lib/rules.test.ts
git commit -m "feat(SURV-26): decideWinners adds champion>lives>last tiebreak"
```

---

## Task 6: Capture penalties in `mapApiMatch`

**Files:**
- Modify: `src/lib/football-data.ts`
- Test: `src/lib/football-data.test.ts`

- [ ] **Step 1: Add a failing test** — append to `src/lib/football-data.test.ts`

```ts
import { mapApiMatch, type ApiMatch } from './football-data'

function apiMatch(over: Partial<ApiMatch> = {}): ApiMatch {
  return {
    id: 1, utcDate: '2026-07-01T16:00:00Z', status: 'FINISHED', stage: 'LAST_32',
    homeTeam: { name: 'Brazil' }, awayTeam: { name: 'Croatia' },
    score: { duration: 'PENALTY_SHOOTOUT', fullTime: { home: 1, away: 1 }, penalties: { home: 4, away: 2 } },
    ...over,
  }
}

describe('mapApiMatch penalties', () => {
  it('captures penalties when finished', () => {
    const m = mapApiMatch(apiMatch())
    expect(m.homePenalties).toBe(4)
    expect(m.awayPenalties).toBe(2)
  })
  it('penalties are null when not finished', () => {
    const m = mapApiMatch(apiMatch({ status: 'SCHEDULED', score: { duration: 'REGULAR', fullTime: { home: null, away: null }, penalties: { home: null, away: null } } }))
    expect(m.homePenalties).toBeNull()
    expect(m.awayPenalties).toBeNull()
  })
})
```

(If `football-data.test.ts` has no `describe`/`it` import yet, add `import { describe, it, expect } from 'vitest'` at the top.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/football-data.test.ts -t penalties`
Expected: FAIL — `homePenalties` is undefined on the mapped result.

- [ ] **Step 3: Update `src/lib/football-data.ts`** — add the two fields to `MappedMatch` and set them in `mapApiMatch`

In `MappedMatch`, after `awayScore`:

```ts
  /** Shootout score, null unless a knockout tie was decided on penalties. */
  homePenalties: number | null
  awayPenalties: number | null
```

In `mapApiMatch`'s returned object, after `awayScore: …`:

```ts
    homePenalties: status === 'FINISHED' ? m.score.penalties.home : null,
    awayPenalties: status === 'FINISHED' ? m.score.penalties.away : null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/football-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/football-data.ts src/lib/football-data.test.ts
git commit -m "feat(SURV-26): capture penalty scores from football-data"
```

---

## Task 7: Schema + backfill (groupKey, penalties, no_options)

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/scripts/backfill-groupkey.ts`

> Drizzle uses `drizzle-kit push` (no migration files). To stay safe with the live group-stage data, add columns nullable first, backfill, then tighten + swap constraints.

- [ ] **Step 1: Add nullable columns + penalties + no_options** — edit `src/db/schema.ts`

`matches`: after `awayScore`:

```ts
  homePenalties: integer('home_penalties'),
  awayPenalties: integer('away_penalties'),
```

`picks`: add the column (keep existing uniques for now):

```ts
    groupKey: text('group_key'),
```

`life_losses`: add the column and extend the reason enum:

```ts
    groupKey: text('group_key'),
    reason: text('reason', { enum: ['lost', 'no_pick', 'no_options'] }).notNull(),
```

- [ ] **Step 2: Push the additive changes**

Run: `npm run db:push`
Expected: drizzle adds `group_key` (nullable) to `picks` and `life_losses`, and `home_penalties`/`away_penalties` to `matches`. Confirm any prompts. (The `reason` enum is type-level only — no DB change.)

- [ ] **Step 3: Write the backfill script** — `src/scripts/backfill-groupkey.ts`

Existing rows are all group stage, where the pick group == the match day, so `group_key = 'g:' || match_date`. Use drizzle's `sql` template (a plain string is not a valid `db.execute` argument with postgres-js):

```ts
import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '@/db/client'

async function main() {
  await db.execute(sql`UPDATE picks SET group_key = 'g:' || match_date WHERE group_key IS NULL`)
  await db.execute(sql`UPDATE life_losses SET group_key = 'g:' || match_date WHERE group_key IS NULL`)
  console.log('Backfilled group_key on picks and life_losses.')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 4: Add an npm script and run the backfill** — in `package.json` `scripts`, add:

```json
    "backfill:groupkey": "tsx src/scripts/backfill-groupkey.ts",
```

Run: `npm run backfill:groupkey`
Expected: `Backfilled group_key on picks and life_losses.` (Safe to re-run — only touches NULLs.)

- [ ] **Step 5: Tighten to NOT NULL + swap unique constraints** — edit `src/db/schema.ts`

`picks` column → `groupKey: text('group_key').notNull(),` and replace the `onePerDay` unique:

```ts
  (t) => ({
    onePerGroup: unique('one_pick_per_group').on(t.participantId, t.groupKey),
    noRepeatTeamPerPhase: unique('no_repeat_team_phase').on(t.participantId, t.team, t.phase),
  }),
```

`life_losses` column → `groupKey: text('group_key').notNull(),` and replace its unique:

```ts
  (t) => ({
    oneLossPerGroup: unique('one_loss_per_group').on(t.participantId, t.groupKey),
  }),
```

- [ ] **Step 6: Push the tightening**

Run: `npm run db:push`
Expected: drizzle sets `group_key` NOT NULL, drops `one_pick_per_day`/`one_loss_per_day`, creates `one_pick_per_group`/`one_loss_per_group`. Confirm prompts.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/scripts/backfill-groupkey.ts package.json
git commit -m "feat(SURV-26): schema groupKey + penalties + no_options, with backfill"
```

---

## Task 8: Query helpers for groups, penalties, champion

**Files:**
- Modify: `src/db/queries.ts`

- [ ] **Step 1: Update `upsertPick` to key by groupKey** — replace the `upsertPick` body's delete + the input type

```ts
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
```

- [ ] **Step 2: Update `deletePick` to key by groupKey**

```ts
/** Remove a participant's pick for a given group (used to free a team before its deadline). */
export async function deletePick(participantId: string, groupKey: string) {
  await db.delete(picks).where(and(eq(picks.participantId, participantId), eq(picks.groupKey, groupKey)))
}
```

- [ ] **Step 3: Update `recordLifeLoss` to take groupKey + the wider reason**

```ts
/** Record one life event for a group; idempotent via unique (participant, groupKey). */
export async function recordLifeLoss(input: {
  participantId: string
  matchDate: string
  groupKey: string
  reason: 'lost' | 'no_pick' | 'no_options'
}) {
  await db.insert(lifeLosses).values(input).onConflictDoNothing()
}
```

- [ ] **Step 4: Update `setMatchResult` / add penalty support**

```ts
export async function setMatchResult(
  matchId: string,
  homeScore: number,
  awayScore: number,
  homePenalties: number | null = null,
  awayPenalties: number | null = null,
) {
  await db.update(matches).set({ homeScore, awayScore, homePenalties, awayPenalties, status: 'FINISHED' }).where(eq(matches.id, matchId))
}
```

- [ ] **Step 5: Add an all-matches helper** (used by cron + actions to build groups)

```ts
/** Every match, ordered by kickoff — used to build pick groups across the tournament. */
export async function getAllMatches() {
  return db.select().from(matches).orderBy(matches.utcKickoff)
}
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: errors ONLY in not-yet-updated callers (`pick-actions.ts`, `cron/settle/route.ts`, `admin-actions.ts`) — those are the next tasks. No errors inside `queries.ts` itself.

- [ ] **Step 7: Commit**

```bash
git add src/db/queries.ts
git commit -m "feat(SURV-26): query helpers keyed by groupKey + penalty result"
```

---

## Task 9: Server actions — schedule, submit, results by pick group

**Files:**
- Modify: `src/app/actions/pick-actions.ts`

- [ ] **Step 1: Rewrite `getSchedule` to group by `PickGroup`** — replace the function body

```ts
export async function getSchedule() {
  const me = await currentParticipant()
  if (!me) return null

  const today = todayBrt()
  const allMatches = await getAllMatches()
  const groups = buildPickGroups(
    allMatches.map((m) => ({
      id: m.id, stage: m.stage, homeTeam: m.homeTeam, awayTeam: m.awayTeam,
      utcKickoff: m.utcKickoff, matchDate: m.matchDate,
    })),
  )
  const matchById = new Map(allMatches.map((m) => [m.id, m]))
  const upcomingPicks = await getPicksFrom('2026-06-11')
  const usedTeamPhases = await getUsedTeamPhases(me.id)
  const teamsUsedByPhase = {
    group: usedTeamPhases.filter((u) => u.phase === 'group').map((u) => u.team),
    knockout: usedTeamPhases.filter((u) => u.phase === 'knockout').map((u) => u.team),
  }
  const now = new Date()

  // future + current groups only (a group is "upcoming" if it has a match today or later)
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
      // no-options only when teams ARE defined (pickable non-empty) yet all are already used
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
```

Update the imports at the top of the file: add `getAllMatches` to the `@/db/queries` import, add `import { buildPickGroups } from '@/lib/groups'`, and remove now-unused `getMatchesFrom`, `getAllMatchDays` if no longer referenced (verify with tsc in Step 5).

- [ ] **Step 2: Rewrite `submitPick`** — resolve the chosen match's group, dedupe by groupKey

```ts
export async function submitPick(_prev: unknown, formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const me = await currentParticipant()
  if (!me) return { error: 'Não autenticado' }

  const chosenTeam = String(formData.get('team') ?? '')
  const groupKey = String(formData.get('groupKey') ?? '')
  if (!groupKey) return { error: 'invalid_group' }

  const allMatches = await getAllMatches()
  const groups = buildPickGroups(
    allMatches.map((m) => ({ id: m.id, stage: m.stage, homeTeam: m.homeTeam, awayTeam: m.awayTeam, utcKickoff: m.utcKickoff, matchDate: m.matchDate })),
  )
  const group = groups.find((g) => g.key === groupKey)
  if (!group) return { error: 'invalid_group' }
  const matchById = new Map(allMatches.map((m) => [m.id, m]))
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
```

- [ ] **Step 3: Add `getPicksByGroup` to queries** — in `src/db/queries.ts`

```ts
export async function getPicksByGroup(groupKey: string) {
  return db.select().from(picks).where(eq(picks.groupKey, groupKey))
}
```

- [ ] **Step 4: Rewrite `clearPick`** — key by groupKey

```ts
export async function clearPick(formData: FormData): Promise<void> {
  const me = await currentParticipant()
  if (!me) return
  const groupKey = String(formData.get('groupKey') ?? '')
  if (!groupKey) return

  const allMatches = await getAllMatches()
  const groups = buildPickGroups(
    allMatches.map((m) => ({ id: m.id, stage: m.stage, homeTeam: m.homeTeam, awayTeam: m.awayTeam, utcKickoff: m.utcKickoff, matchDate: m.matchDate })),
  )
  const group = groups.find((g) => g.key === groupKey)
  if (!group) return
  const matchById = new Map(allMatches.map((m) => [m.id, m]))
  const deadline = earliestKickoff(group.matchIds.map((id) => new Date(matchById.get(id)!.utcKickoff)))
  if (deadline && isPastDeadline(new Date(), deadline)) return

  await deletePick(me.id, groupKey)
  revalidatePath('/')
}
```

- [ ] **Step 5: Rewrite `getResults`** — group by `PickGroup`, knockout uses `teamAdvanced`

```ts
export async function getResults() {
  const me = await currentParticipant()
  if (!me) return null

  const today = todayBrt()
  const allMatches = await getAllMatches()
  const groups = buildPickGroups(
    allMatches.map((m) => ({ id: m.id, stage: m.stage, homeTeam: m.homeTeam, awayTeam: m.awayTeam, utcKickoff: m.utcKickoff, matchDate: m.matchDate })),
  )
  const matchById = new Map(allMatches.map((m) => [m.id, m]))
  const allPicks = await getPicksFrom('2026-06-11')
  const everyone = await listParticipants()
  const now = new Date()

  const days = groups
    .filter((g) => g.matchIds.some((id) => matchById.get(id)!.matchDate <= today))
    .sort((a, b) => b.order - a.order) // most recent first
    .map((g) => {
      const ms = g.matchIds.map((id) => matchById.get(id)!)
      const deadlineDate = earliestKickoff(ms.map((m) => new Date(m.utcKickoff)))
      const deadlinePassed = deadlineDate ? isPastDeadline(now, deadlineDate) : false
      const groupPicks = allPicks.filter((p) => p.groupKey === g.key)

      const rows = !deadlinePassed ? null : everyone.map((p) => {
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
```

Update imports: add `teamAdvanced` to the `@/lib/rules` import; add `getAllMatches` to `@/db/queries`.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `page.tsx`, `resultados/page.tsx`, `DayPickForm.tsx`, `cron/settle/route.ts`, `admin-actions.ts` (later tasks). `pick-actions.ts` itself clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/actions/pick-actions.ts src/db/queries.ts
git commit -m "feat(SURV-26): schedule/submit/results operate on pick groups"
```

---

## Task 10: Settlement cron — settle by pick group

**Files:**
- Modify: `src/app/api/cron/settle/route.ts`

- [ ] **Step 1: Replace the settlement section (the `// 2) Settle …` loop)** with a group-based loop

```ts
  // 2) Settle every pick group whose deadline has passed.
  const participants = await listParticipants()
  const now = new Date()

  const allMatches = await getAllMatches()
  const matchById = new Map(allMatches.map((m) => [m.id, m]))
  const groups = buildPickGroups(
    allMatches.map((m) => ({ id: m.id, stage: m.stage, homeTeam: m.homeTeam, awayTeam: m.awayTeam, utcKickoff: m.utcKickoff, matchDate: m.matchDate })),
  )
  const allPicks = await getPicksFrom('2026-06-11')

  // loss/elimination events per participant, seeded from existing rows
  const lossEvents = new Map<string, { date: string; reason: 'lost' | 'no_pick' | 'no_options'; groupKey: string }[]>()
  for (const p of participants) lossEvents.set(p.id, [])
  for (const row of await getAllLifeLosses()) {
    const arr = lossEvents.get(row.participantId)
    if (arr && !arr.some((e) => e.groupKey === row.groupKey)) arr.push({ date: row.matchDate, reason: row.reason, groupKey: row.groupKey })
  }

  for (const g of groups) {
    try {
      const ms = g.matchIds.map((id) => matchById.get(id)!)
      const deadlineDate = earliestKickoff(ms.map((m) => new Date(m.utcKickoff)))
      const deadlinePassed = deadlineDate ? isPastDeadline(now, deadlineDate) : false
      if (!deadlinePassed) continue
      const repDate = deadlineDate ? matchDayKey(deadlineDate) : ms[0].matchDate

      const groupPicks = allPicks.filter((p) => p.groupKey === g.key)
      // alive = still has lives AND not hard-eliminated, as of events so far
      const alive = participants.filter((p) => {
        const ev = lossEvents.get(p.id) ?? []
        return !computeStanding(ev).eliminated
      })
      const usedKnockoutTeams = new Map(
        alive.map((p) => [p.id, allPicks.filter((pk) => pk.participantId === p.id && pk.phase === 'knockout').map((pk) => pk.team)]),
      )

      const events = settleGroup({
        groupKey: g.key,
        date: repDate,
        phase: g.phase,
        hasMatches: true,
        deadlinePassed,
        groupTeams: g.teams,
        usedKnockoutTeams,
        participants: alive.map((p) => ({ id: p.id })),
        picks: groupPicks.map((pk) => {
          const m = matchById.get(pk.matchId)
          const finished: SettleMatch | null =
            m && m.status === 'FINISHED' && m.homeScore !== null && m.awayScore !== null
              ? { homeTeam: m.homeTeam, awayTeam: m.awayTeam, homeScore: m.homeScore, awayScore: m.awayScore, homePenalties: m.homePenalties, awayPenalties: m.awayPenalties, status: 'FINISHED' }
              : null
          return { participantId: pk.participantId, team: pk.team, match: finished }
        }),
      })

      for (const e of events) {
        const arr = lossEvents.get(e.participantId)!
        if (!arr.some((x) => x.groupKey === e.groupKey)) arr.push({ date: e.date, reason: e.reason, groupKey: e.groupKey })
        await recordLifeLoss({ participantId: e.participantId, matchDate: e.date, groupKey: e.groupKey, reason: e.reason })
      }
    } catch (err) {
      console.error(`settlement failed for group ${g.key}, continuing`, err)
    }
  }
```

- [ ] **Step 2: Update the materialize-status section (`// 3)`)** to use event objects

```ts
  // 3) Materialize elimination status from the standings (for ranking/winner).
  const standings = participants.map((p) => {
    const events = lossEvents.get(p.id) ?? []
    const standing = computeStanding(events)
    return { p, events, standing }
  })
  for (const { p, events, standing } of standings) {
    if (standing.eliminated && p.status !== 'eliminated') {
      const reason = events.find((e) => e.date === standing.eliminatedDate)?.reason ?? 'lost'
      const mapped = reason === 'no_options' ? 'lost' : reason // participants.eliminatedReason enum is ['lost','no_pick']
      await eliminateParticipant(p.id, standing.eliminatedDate!, mapped)
    }
  }
```

(The `participants.eliminatedReason` column enum stays `['lost','no_pick']`; `no_options` maps to `'lost'` for display only — the authoritative reason lives in `life_losses`.)

- [ ] **Step 3: Fix imports** — top of the cron file

Replace the rules import with: `import { settleGroup, computeStanding, type SettleMatch } from '@/lib/rules'`
Add: `import { buildPickGroups } from '@/lib/groups'`
From `@/db/queries`, add `getAllMatches`, `getPicksFrom`; remove `getMatchesByDate`, `getPicksByDate` if now unused.
From `@/lib/tz`, keep `matchDayKey`, `earliestKickoff`, `isPastDeadline`; remove `datesInclusive` if unused.
Remove the now-unused `STARTING_LIVES`/`FinishedMatch` imports if no longer referenced (verify in Step 4).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `page.tsx`, `resultados/page.tsx`, `DayPickForm.tsx`, `admin-actions.ts`. Cron file clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/settle/route.ts
git commit -m "feat(SURV-26): settle by pick group with phase-aware rules"
```

---

## Task 11: Admin — penalty inputs

**Files:**
- Modify: `src/app/actions/admin-actions.ts`
- Modify: `src/app/_components/AdminPanel.tsx`

- [ ] **Step 1: Extend `overrideResult`** — `src/app/actions/admin-actions.ts`

```ts
export async function overrideResult(
  matchId: string,
  homeScore: number,
  awayScore: number,
  homePenalties: number | null = null,
  awayPenalties: number | null = null,
): Promise<void> {
  await requireAdmin()
  await setMatchResult(matchId, homeScore, awayScore, homePenalties, awayPenalties)
  revalidatePath('/admin')
}
```

- [ ] **Step 2: Add optional penalty fields to the result form** — `src/app/_components/AdminPanel.tsx`, replace `setResult` and the form row

```tsx
  async function setResult(formData: FormData) {
    const hp = formData.get('homePen')
    const ap = formData.get('awayPen')
    await overrideResult(
      String(formData.get('matchId')),
      Number(formData.get('home')),
      Number(formData.get('away')),
      hp === null || hp === '' ? null : Number(hp),
      ap === null || ap === '' ? null : Number(ap),
    )
  }
```

In the JSX form row, after the away-score input/team, add penalty inputs:

```tsx
            <input name="homePen" type="number" min="0" placeholder="pen" className="w-12 rounded border p-1" />
            <span className="text-xs text-gray-400">pen</span>
            <input name="awayPen" type="number" min="0" placeholder="pen" className="w-12 rounded border p-1" />
```

(Place these before the `salvar` button. Penalties are optional — leave blank for group-stage games.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `page.tsx`, `resultados/page.tsx`, `DayPickForm.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/admin-actions.ts src/app/_components/AdminPanel.tsx
git commit -m "feat(SURV-26): admin can record penalty shootout results"
```

---

## Task 12: UI — dashboard, pick form, results

**Files:**
- Modify: `src/app/_components/DayPickForm.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/resultados/page.tsx`

- [ ] **Step 1: Update `DayPickForm` props to use `groupKey` + label/phase**

In `DayPickForm.tsx`, change the props type and the hidden field name from `matchDate`/`date` to `groupKey`. Replace `date` prop with `groupKey: string`; in both the submit form and the clear form, render `<input type="hidden" name="groupKey" value={groupKey} />` instead of the `matchDate` field. Keep the `pickable`/`teamsUsedByPhase`/`currentPick` logic as-is (the per-phase used-teams disabling is unchanged).

- [ ] **Step 2: Update the dashboard's schedule rendering** — `src/app/page.tsx`

In the `schedule.days.map((day) => …)` block:
- Key the `<li>` by `day.groupKey`.
- Replace the `Match Day {day.matchDayNumber}` header with `{day.label}` and keep the `· {fmtDay(day.date)}` suffix.
- Pass `groupKey={day.groupKey}` to `<DayPickForm>` instead of `date={day.date}`.
- Add a no-options branch: when `!day.deadlinePassed && !meStanding.eliminated && day.phase === 'knockout' && day.noOptions`, render `<p className="text-sm text-red-600">Sem times disponíveis neste grupo — você está fora. 💀</p>` instead of the pick form.

The branch order inside each day becomes:
```tsx
{day.deadlinePassed ? (
  /* reveal everyone's picks (unchanged) */
) : meStanding.eliminated ? (
  /* eliminated copy (unchanged) */
) : day.noOptions ? (
  <p className="text-sm text-red-600">Sem times disponíveis neste grupo — você está fora. 💀</p>
) : day.pickable.length > 0 ? (
  <DayPickForm groupKey={day.groupKey} pickable={day.pickable} teamsUsedByPhase={schedule.teamsUsedByPhase} currentPick={day.myPick} />
) : (
  <p className="text-sm text-gray-500">⏳ times ainda não definidos</p>
)}
```

- [ ] **Step 3: Update the winner computation in `page.tsx`** — feed the new `decideWinners` signature

Replace the `standingOf`/`winnerIds` block:

```tsx
  const losses = await getAllLifeLosses()
  const eventsByPid = new Map<string, { date: string; reason: 'lost' | 'no_pick' | 'no_options' }[]>()
  for (const l of losses) {
    const a = eventsByPid.get(l.participantId) ?? []
    a.push({ date: l.matchDate, reason: l.reason })
    eventsByPid.set(l.participantId, a)
  }
  const standingOf = (id: string) => computeStanding(eventsByPid.get(id) ?? [])

  // champion + each participant's final-group pick (for the tiebreak)
  const allMatches = await getAllMatches()
  const groups = buildPickGroups(allMatches.map((m) => ({ id: m.id, stage: m.stage, homeTeam: m.homeTeam, awayTeam: m.awayTeam, utcKickoff: m.utcKickoff, matchDate: m.matchDate })))
  const finalGroup = groups.find((g) => g.key.startsWith('k:FINAL'))
  const finalMatch = finalGroup ? allMatches.find((m) => m.id === finalGroup.matchIds[0]) : undefined
  let championTeam: string | null = null
  if (finalMatch && finalMatch.status === 'FINISHED' && finalMatch.homeScore !== null && finalMatch.awayScore !== null) {
    const adv = teamAdvanced({ homeTeam: finalMatch.homeTeam, awayTeam: finalMatch.awayTeam, homeScore: finalMatch.homeScore, awayScore: finalMatch.awayScore, homePenalties: finalMatch.homePenalties, awayPenalties: finalMatch.awayPenalties }, finalMatch.homeTeam)
    if (adv !== null) championTeam = adv ? finalMatch.homeTeam : finalMatch.awayTeam
  }
  const allPicks = await getPicksFrom('2026-06-11')
  const finalPickOf = (id: string) => (finalGroup ? allPicks.find((p) => p.groupKey === finalGroup.key && p.participantId === id)?.team ?? null : null)

  const aliveCount = everyone.filter((p) => !standingOf(p.id).eliminated).length
  const tournamentOver = (counts.total > 0 && counts.finished === counts.total) || (everyone.length > 1 && aliveCount <= 1)
  const winnerIds = decideWinners({
    participants: everyone.map((p) => {
      const s = standingOf(p.id)
      return { id: p.id, eliminated: s.eliminated, eliminatedDate: s.eliminatedDate, lives: s.lives, finalPick: finalPickOf(p.id) }
    }),
    championTeam,
    tournamentOver,
  })
```

Update `page.tsx` imports: add `teamAdvanced` to `@/lib/rules`; add `buildPickGroups` from `@/lib/groups`; add `getAllMatches`, `getPicksFrom` to `@/db/queries`. Remove the old `fmtDay`-only helpers only if unused (keep `fmtDay`, still used).

- [ ] **Step 4: Update `resultados/page.tsx`** — use `label`/`phase` and the new outcome copy

The results page maps `results.days`. Replace any `Match Day {day.matchDayNumber}` with `{day.label}`. The outcome rendering (`survived`/`eliminated`/`pending`/`no_pick`) stays, but for knockout the `survived` label should read "classificou ✅" and `eliminated` "eliminado 💀". Drive copy off `day.phase`:

```tsx
const outcomeLabel = (phase: 'group' | 'knockout', outcome: PickOutcome): string => {
  if (outcome === 'survived') return phase === 'knockout' ? 'classificou ✅' : 'sobreviveu ✅'
  if (outcome === 'eliminated') return phase === 'knockout' ? 'eliminado 💀' : 'perdeu 💀'
  if (outcome === 'no_pick') return 'sem palpite'
  return 'pendente'
}
```

Use `outcomeLabel(day.phase, row.outcome)` where the outcome text is shown. (Import `PickOutcome` type from `@/app/actions/pick-actions` if not already.)

- [ ] **Step 5: Full typecheck + tests + build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean, all vitest suites PASS, `next build` succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/_components/DayPickForm.tsx src/app/resultados/page.tsx
git commit -m "feat(SURV-26): dashboard + results render pick groups and knockout outcomes"
```

---

## Final verification

- [ ] **Run the full suite**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Manual smoke (optional, needs DB):** load `/` as a participant; group-stage Match Days look identical to before; once knockout fixtures exist (or are seeded), knockout shows "16avos · Grupo 1" with the 4 games and a single team pick; `/resultados` shows "classificou/eliminado"; `/admin` shows penalty inputs.

---

## Spec coverage check

- Group structure 4/4/2/2/1, 3rd place excluded → Task 1 (`buildPickGroups` + test).
- Advance rule incl. penalties → Tasks 2, 6 (`teamAdvanced`, penalty capture).
- Lives carry over, `no_options` immediate elimination → Tasks 3, 4 (`settleGroup`, `computeStanding`).
- Champion > lives > last-eliminated → Task 5 (`decideWinners`).
- Settlement by group → Task 10.
- Schema + backfill (live data safe) → Task 7.
- UI (schedule, results, admin penalties, no-options) → Tasks 9, 11, 12.
- Out of scope: bracket projection → sibling spec/plan.
