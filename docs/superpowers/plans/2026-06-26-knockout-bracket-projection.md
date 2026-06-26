# Knockout Bracket Projection (Prévia dos Confrontos) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Project the World Cup knockout bracket (which teams cross in the Round of 32, then the winner-ref skeleton through the Final) from the CURRENT group standings, using the official FIFA bracket + Annex C best-third allocation.

**Architecture:** Two validated data files already exist and are committed: `src/lib/wc2026-bracket.json` (R32 pairings, third eligibility, 495-row Annex C, propagation tree) and `src/lib/wc2026-groups.ts` (`WC2026_GROUPS`, exact DB team names). A typed accessor wraps them. `computeGroupStandings` (pure) ranks each group from stored scores; `projectBracket` (pure) picks the 8 best thirds, looks up Annex C, and resolves every R32 slot into a team. A server action serializes it; a `/chaveamento` page renders it. Read-only — does not touch picks/settlement.

**Tech Stack:** Next.js 16 (App Router, server actions), Drizzle/Postgres (read-only here), Vitest (`@`→`src`). `resolveJsonModule` is enabled.

---

## File Structure

- `src/lib/wc2026.ts` (**create**) — typed accessor over the JSON + groups; helpers `groupOf`, `annexCLookup`.
- `src/lib/wc2026.test.ts` (**create**) — guard tests on the data (counts, bijections, coverage).
- `src/lib/standings.ts` (**create**) — `computeGroupStandings` (pure).
- `src/lib/standings.test.ts` (**create**).
- `src/lib/bracket-projection.ts` (**create**) — `projectBracket` (pure).
- `src/lib/bracket-projection.test.ts` (**create**).
- `src/app/actions/bracket-actions.ts` (**create**) — `getBracketProjection()` server action.
- `src/app/chaveamento/page.tsx` (**create**) — the bracket page.
- `src/app/page.tsx` (**modify**) — add a link to `/chaveamento`.

---

## Task 1: Typed accessor over the bracket data + guard tests

**Files:**
- Create: `src/lib/wc2026.ts`
- Test: `src/lib/wc2026.test.ts`

Context: `src/lib/wc2026-bracket.json` shape (already committed):
```jsonc
{
  "r32": [ { "match": 73, "slot1": "2A", "slot2": "2B" },
           { "match": 74, "slot1": "1E", "slot2": "3rd:A/B/C/D/F" }, ... 16 ],
  "thirdSlots": ["E","I","A","L","D","G","B","K"],
  "thirdEligibility": { "E": ["A","B","C","D","F"], ... },
  "annexC": [ { "groups": ["E","F","G","H","I","J","K","L"],
               "assign": { "E":"F","I":"G","A":"E","L":"K","D":"I","G":"H","B":"J","K":"L" } }, ... 495 ],
  "propagation": { "r16": [ {"match":89,"from":[74,77]}, ...8 ],
                   "qf": [ {"match":97,"from":[89,90]}, ...4 ],
                   "sf": [ {"match":101,"from":[97,98]}, ...2 ],
                   "third": {"match":103,"fromLosers":[101,102]},
                   "final": {"match":104,"from":[101,102]} } }
```
`assign` keys are winner-slot group letters; values are the third's group letter. `WC2026_GROUPS` from `wc2026-groups.ts` maps each `GroupLetter` to its 4 exact DB team names.

- [ ] **Step 1: Write the failing test** — `src/lib/wc2026.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { WC2026_GROUPS } from './wc2026-groups'
import { R32, THIRD_SLOTS, ANNEX_C, PROPAGATION, groupOf, annexCLookup } from './wc2026'

describe('wc2026 data', () => {
  it('has 16 R32 pairings and 495 Annex C rows', () => {
    expect(R32.length).toBe(16)
    expect(ANNEX_C.length).toBe(495)
    expect(THIRD_SLOTS).toEqual(['E', 'I', 'A', 'L', 'D', 'G', 'B', 'K'])
  })
  it('groups cover exactly 48 distinct teams', () => {
    const all = Object.values(WC2026_GROUPS).flat()
    expect(all.length).toBe(48)
    expect(new Set(all).size).toBe(48)
  })
  it('groupOf maps a team to its letter, or null', () => {
    const someTeam = WC2026_GROUPS.A[0]
    expect(groupOf(someTeam)).toBe('A')
    expect(groupOf('Atlantis')).toBeNull()
  })
  it('annexCLookup returns the bijection for a known qualifying set', () => {
    const first = ANNEX_C[0]
    const got = annexCLookup([...first.groups])
    expect(got).toEqual(first.assign)
  })
  it('annexCLookup is order-independent on the input set', () => {
    const first = ANNEX_C[0]
    const shuffled = [...first.groups].reverse()
    expect(annexCLookup(shuffled)).toEqual(first.assign)
  })
  it('annexCLookup returns null for a non-qualifying-size set', () => {
    expect(annexCLookup(['A', 'B'])).toBeNull()
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run src/lib/wc2026.test.ts`
Expected: FAIL — `Cannot find module './wc2026'`.

- [ ] **Step 3: Implement** — `src/lib/wc2026.ts`

```ts
import bracket from './wc2026-bracket.json'
import { WC2026_GROUPS, type GroupLetter } from './wc2026-groups'

export type R32Pairing = { match: number; slot1: string; slot2: string }
export type AnnexCEntry = { groups: GroupLetter[]; assign: Record<string, string> }
export type PropMatch = { match: number; from: number[] }

export const R32: R32Pairing[] = bracket.r32
export const THIRD_SLOTS: GroupLetter[] = bracket.thirdSlots as GroupLetter[]
export const THIRD_ELIGIBILITY: Record<string, string[]> = bracket.thirdEligibility
export const ANNEX_C: AnnexCEntry[] = bracket.annexC as AnnexCEntry[]
export const PROPAGATION = bracket.propagation as {
  r16: PropMatch[]
  qf: PropMatch[]
  sf: PropMatch[]
  third: { match: number; fromLosers: number[] }
  final: { match: number; from: number[] }
}

/** The group letter a team belongs to, or null if not a group-stage team. */
export function groupOf(team: string): GroupLetter | null {
  for (const [letter, teams] of Object.entries(WC2026_GROUPS) as [GroupLetter, string[]][]) {
    if (teams.includes(team)) return letter
  }
  return null
}

/** Annex C assignment (winner-slot letter → third's group letter) for the set of
 *  8 groups whose thirds qualified. Order-independent. Null if not exactly a row. */
export function annexCLookup(qualifyingGroups: string[]): Record<string, string> | null {
  const key = [...qualifyingGroups].sort().join('')
  const row = ANNEX_C.find((e) => [...e.groups].sort().join('') === key)
  return row ? row.assign : null
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx vitest run src/lib/wc2026.test.ts`
Expected: PASS (6).

- [ ] **Step 5: Commit**

```bash
git add src/lib/wc2026.ts src/lib/wc2026.test.ts
git commit -m "feat(SURV-27): typed accessor over WC2026 bracket data"
```

---

## Task 2: `computeGroupStandings` (pure)

**Files:**
- Create: `src/lib/standings.ts`
- Test: `src/lib/standings.test.ts`

Ordering rule (FIFA): points → goal difference → goals for → head-to-head (points, then GD, then GF, computed over only the matches between the still-tied teams) → fallback alphabetical (flagged `tiebreakUncertain`). Only FINISHED matches count. Penalties are irrelevant in the group stage.

- [ ] **Step 1: Write the failing test** — `src/lib/standings.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { computeGroupStandings, type StandingMatch } from './standings'
import { WC2026_GROUPS } from './wc2026-groups'

// Build finished group matches for one group from a compact spec.
function gm(home: string, away: string, hs: number, as: number): StandingMatch {
  return { stage: 'GROUP_STAGE', homeTeam: home, awayTeam: away, homeScore: hs, awayScore: as, status: 'FINISHED' }
}

describe('computeGroupStandings', () => {
  it('orders a group by points, then GD, then GF', () => {
    const [a, b, c, d] = WC2026_GROUPS.A
    const matches: StandingMatch[] = [
      gm(a, b, 3, 0), // a +3
      gm(c, d, 1, 1),
      gm(a, c, 1, 0), // a +1
      gm(b, d, 2, 2),
      gm(a, d, 0, 0), // a draw
      gm(b, c, 0, 0),
    ]
    const groups = computeGroupStandings(matches)
    const groupA = groups.find((g) => g.letter === 'A')!
    expect(groupA.rows[0].team).toBe(a) // 7 pts
    expect(groupA.rows.map((r) => r.team)).toHaveLength(4)
    expect(groupA.rows[0].points).toBe(7)
  })

  it('breaks a points+GD tie by goals scored', () => {
    // a and b both finish 7 pts, GD +2; a scored more (5 vs 3) → a ahead.
    // (Two teams tied on points in a 4-team group necessarily drew head-to-head,
    //  so GF is the deciding criterion here; head-to-head only separates 3+ way ties.)
    const [a, b, c, d] = WC2026_GROUPS.B
    const matches: StandingMatch[] = [
      gm(a, b, 1, 1),            // a & b draw
      gm(a, c, 2, 1), gm(a, d, 2, 1), // a: GD +2, GF 5
      gm(b, c, 1, 0), gm(b, d, 1, 0), // b: GD +2, GF 3
      gm(c, d, 0, 0),
    ]
    const g = computeGroupStandings(matches).find((x) => x.letter === 'B')!
    expect(g.rows[0].points).toBe(7)
    expect(g.rows[1].points).toBe(7)
    expect(g.rows[0].team).toBe(a) // more goals scored
    expect(g.rows[1].team).toBe(b)
  })

  it('treats an all-zero (unplayed) group as a stable alphabetical order flagged uncertain', () => {
    const groups = computeGroupStandings([])
    const g = groups.find((x) => x.letter === 'C')!
    expect(g.rows).toHaveLength(4)
    expect(g.rows.every((r) => r.played === 0)).toBe(true)
    expect(g.tiebreakUncertain).toBe(true)
  })

  it('returns all 12 groups', () => {
    expect(computeGroupStandings([]).map((g) => g.letter).sort()).toEqual(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'],
    )
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run src/lib/standings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/lib/standings.ts`

```ts
import { WC2026_GROUPS, type GroupLetter } from './wc2026-groups'

export type StandingMatch = {
  stage: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string
}

export type TeamRow = {
  team: string
  played: number
  won: number
  drawn: number
  lost: number
  gf: number
  ga: number
  gd: number
  points: number
}

export type GroupStanding = {
  letter: GroupLetter
  rows: TeamRow[] // ordered 1st..4th
  /** True if any position was separated only by the alphabetical fallback. */
  tiebreakUncertain: boolean
}

function emptyRow(team: string): TeamRow {
  return { team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 }
}

function accumulate(rows: Map<string, TeamRow>, m: StandingMatch): void {
  const h = rows.get(m.homeTeam)
  const a = rows.get(m.awayTeam)
  if (!h || !a || m.homeScore === null || m.awayScore === null) return
  h.played++; a.played++
  h.gf += m.homeScore; h.ga += m.awayScore
  a.gf += m.awayScore; a.ga += m.homeScore
  if (m.homeScore > m.awayScore) { h.won++; a.lost++; h.points += 3 }
  else if (m.homeScore < m.awayScore) { a.won++; h.lost++; a.points += 3 }
  else { h.drawn++; a.drawn++; h.points++; a.points++ }
  h.gd = h.gf - h.ga; a.gd = a.gf - a.ga
}

/** Mini-table over only the matches played BETWEEN the given teams. */
function headToHead(teams: string[], matches: StandingMatch[]): Map<string, TeamRow> {
  const set = new Set(teams)
  const sub = new Map(teams.map((t) => [t, emptyRow(t)]))
  for (const m of matches) {
    if (set.has(m.homeTeam) && set.has(m.awayTeam)) accumulate(sub, m)
  }
  return sub
}

function cmpOverall(a: TeamRow, b: TeamRow): number {
  return b.points - a.points || b.gd - a.gd || b.gf - a.gf
}

export function computeGroupStandings(matches: StandingMatch[]): GroupStanding[] {
  const finished = matches.filter((m) => m.stage === 'GROUP_STAGE' && m.status === 'FINISHED')
  const out: GroupStanding[] = []

  for (const [letter, teams] of Object.entries(WC2026_GROUPS) as [GroupLetter, string[]][]) {
    const rows = new Map(teams.map((t) => [t, emptyRow(t)]))
    const teamSet = new Set(teams)
    const groupMatches = finished.filter((m) => teamSet.has(m.homeTeam) && teamSet.has(m.awayTeam))
    for (const m of groupMatches) accumulate(rows, m)

    let uncertain = false
    const ordered = [...rows.values()].sort((a, b) => {
      const base = cmpOverall(a, b)
      if (base !== 0) return base
      // tied on points/GD/GF → head-to-head among all teams currently tied with them
      const tied = [...rows.values()].filter((r) => cmpOverall(r, a) === 0).map((r) => r.team)
      if (tied.length > 1) {
        const h2h = headToHead(tied, groupMatches)
        const ha = h2h.get(a.team)!, hb = h2h.get(b.team)!
        const hc = cmpOverall(ha, hb)
        if (hc !== 0) return hc
      }
      uncertain = true
      return a.team < b.team ? -1 : 1 // stable alphabetical fallback (flagged)
    })

    out.push({ letter, rows: ordered, tiebreakUncertain: uncertain })
  }
  return out
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx vitest run src/lib/standings.test.ts`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add src/lib/standings.ts src/lib/standings.test.ts
git commit -m "feat(SURV-27): computeGroupStandings from stored scores"
```

---

## Task 3: `projectBracket` (pure)

**Files:**
- Create: `src/lib/bracket-projection.ts`
- Test: `src/lib/bracket-projection.test.ts`

- [ ] **Step 1: Write the failing test** — `src/lib/bracket-projection.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { projectBracket } from './bracket-projection'
import { computeGroupStandings, type StandingMatch } from './standings'
import { WC2026_GROUPS } from './wc2026-groups'

// Make every group fully decided with a clean 1>2>3>4 by points (no ties),
// so the bracket resolves deterministically.
function decidedFixtures(): StandingMatch[] {
  const ms: StandingMatch[] = []
  for (const teams of Object.values(WC2026_GROUPS)) {
    const [t1, t2, t3, t4] = teams
    // t1 beats all, t2 beats t3 & t4, t3 beats t4 → 1>2>3>4
    ms.push({ stage: 'GROUP_STAGE', homeTeam: t1, awayTeam: t2, homeScore: 1, awayScore: 0, status: 'FINISHED' })
    ms.push({ stage: 'GROUP_STAGE', homeTeam: t1, awayTeam: t3, homeScore: 1, awayScore: 0, status: 'FINISHED' })
    ms.push({ stage: 'GROUP_STAGE', homeTeam: t1, awayTeam: t4, homeScore: 1, awayScore: 0, status: 'FINISHED' })
    ms.push({ stage: 'GROUP_STAGE', homeTeam: t2, awayTeam: t3, homeScore: 1, awayScore: 0, status: 'FINISHED' })
    ms.push({ stage: 'GROUP_STAGE', homeTeam: t2, awayTeam: t4, homeScore: 1, awayScore: 0, status: 'FINISHED' })
    ms.push({ stage: 'GROUP_STAGE', homeTeam: t3, awayTeam: t4, homeScore: 1, awayScore: 0, status: 'FINISHED' })
  }
  return ms
}

describe('projectBracket', () => {
  it('resolves all 16 R32 matches into concrete teams', () => {
    const standings = computeGroupStandings(decidedFixtures())
    const b = projectBracket(standings)
    expect(b.r32).toHaveLength(16)
    for (const m of b.r32) {
      expect(m.a.kind).toBe('team')
      expect(m.b.kind).toBe('team')
    }
  })

  it('resolves a winner-vs-runner-up match correctly (match 73 = 2A vs 2B)', () => {
    const standings = computeGroupStandings(decidedFixtures())
    const b = projectBracket(standings)
    const m73 = b.r32.find((m) => m.match === 73)!
    const a2 = standings.find((g) => g.letter === 'A')!.rows[1].team
    const b2 = standings.find((g) => g.letter === 'B')!.rows[1].team
    expect([m73.a.team, m73.b.team].sort()).toEqual([a2, b2].sort())
  })

  it('picks exactly 8 qualifying thirds', () => {
    const b = projectBracket(computeGroupStandings(decidedFixtures()))
    expect(b.qualifyingThirds).toHaveLength(8)
  })

  it('a third-slot resolves to the third place of an eligible group', () => {
    const standings = computeGroupStandings(decidedFixtures())
    const b = projectBracket(standings)
    // match 74 = 1E vs a best third; its b-slot must be some group's 3rd-place team
    const m74 = b.r32.find((m) => m.match === 74)!
    const thirds = standings.map((g) => g.rows[2].team)
    expect(thirds).toContain(m74.b.team)
  })

  it('builds the later-round skeleton as winner refs', () => {
    const b = projectBracket(computeGroupStandings(decidedFixtures()))
    expect(b.later.find((m) => m.match === 89)).toBeTruthy()
    expect(b.later.find((m) => m.match === 104)).toBeTruthy() // final
    const m89 = b.later.find((m) => m.match === 89)!
    expect(m89.a.kind).toBe('winner')
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx vitest run src/lib/bracket-projection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `src/lib/bracket-projection.ts`

```ts
import { R32, ANNEX_C, PROPAGATION, annexCLookup, type R32Pairing } from './wc2026'
import type { GroupStanding } from './standings'
import type { GroupLetter } from './wc2026-groups'

export type Slot =
  | { kind: 'team'; team: string; from: string }
  | { kind: 'winner'; ofMatch: number }
  | { kind: 'pending'; label: string }

export type ProjMatch = { match: number; round: 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final'; a: Slot; b: Slot }

export type ProjectedBracket = {
  provisional: boolean
  qualifyingThirds: GroupLetter[]
  r32: ProjMatch[]
  later: ProjMatch[]
}

/** Rank the 12 third-placed teams and return the 8 best group letters (sorted). */
function bestEightThirds(standings: GroupStanding[]): GroupLetter[] {
  const thirds = standings.map((g) => ({ letter: g.letter, row: g.rows[2] }))
  thirds.sort((a, b) => b.row.points - a.row.points || b.row.gd - a.row.gd || b.row.gf - a.row.gf || (a.letter < b.letter ? -1 : 1))
  return thirds.slice(0, 8).map((t) => t.letter).sort()
}

function byLetter(standings: GroupStanding[]): Record<string, GroupStanding> {
  return Object.fromEntries(standings.map((g) => [g.letter, g]))
}

export function projectBracket(standings: GroupStanding[]): ProjectedBracket {
  const groups = byLetter(standings)
  const qualifying = bestEightThirds(standings)
  const assign = annexCLookup(qualifying) // winner-letter -> third-letter

  const resolve = (slot: string): Slot => {
    // "1X" winner, "2X" runner-up
    const pos = slot[0]
    const letter = slot[1] as GroupLetter
    if (pos === '1') return { kind: 'team', team: groups[letter].rows[0].team, from: slot }
    if (pos === '2') return { kind: 'team', team: groups[letter].rows[1].team, from: slot }
    return { kind: 'pending', label: slot }
  }

  const r32: ProjMatch[] = R32.map((p: R32Pairing) => {
    let a = resolve(p.slot1)
    let b = resolve(p.slot2)
    // a "3rd:..." slot pairs with the winner in the other slot; Annex C says which third.
    for (const [slot, raw] of [[a, p.slot1], [b, p.slot2]] as [Slot, string][]) {
      if (slot.kind !== 'pending') continue
      const winnerSlot = raw === p.slot1 ? p.slot2 : p.slot1 // the "1X" partner
      const winnerLetter = winnerSlot[1]
      const thirdLetter = assign?.[winnerLetter] as GroupLetter | undefined
      const resolved: Slot = thirdLetter
        ? { kind: 'team', team: groups[thirdLetter].rows[2].team, from: `3${thirdLetter}` }
        : { kind: 'pending', label: raw }
      if (raw === p.slot1) a = resolved
      else b = resolved
    }
    return { match: p.match, round: 'r32', a, b }
  })

  const later: ProjMatch[] = []
  const ref = (m: number): Slot => ({ kind: 'winner', ofMatch: m })
  for (const m of PROPAGATION.r16) later.push({ match: m.match, round: 'r16', a: ref(m.from[0]), b: ref(m.from[1]) })
  for (const m of PROPAGATION.qf) later.push({ match: m.match, round: 'qf', a: ref(m.from[0]), b: ref(m.from[1]) })
  for (const m of PROPAGATION.sf) later.push({ match: m.match, round: 'sf', a: ref(m.from[0]), b: ref(m.from[1]) })
  later.push({ match: PROPAGATION.third.match, round: 'third', a: ref(PROPAGATION.third.fromLosers[0]), b: ref(PROPAGATION.third.fromLosers[1]) })
  later.push({ match: PROPAGATION.final.match, round: 'final', a: ref(PROPAGATION.final.from[0]), b: ref(PROPAGATION.final.from[1]) })

  const provisional = standings.some((g) => g.tiebreakUncertain || g.rows.some((r) => r.played < 3))
  return { provisional, qualifyingThirds: qualifying, r32, later }
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx vitest run src/lib/bracket-projection.test.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit**

```bash
git add src/lib/bracket-projection.ts src/lib/bracket-projection.test.ts
git commit -m "feat(SURV-27): projectBracket resolves R32 crossings from standings"
```

---

## Task 4: Server action `getBracketProjection`

**Files:**
- Create: `src/app/actions/bracket-actions.ts`

Context: `@/db/queries` exports `getAllMatches()` returning rows with `stage, homeTeam, awayTeam, homeScore, awayScore, status`. `@/lib/session` exports `currentParticipant()`.

- [ ] **Step 1: Implement** — `src/app/actions/bracket-actions.ts`

```ts
'use server'

import { currentParticipant } from '@/lib/session'
import { getAllMatches } from '@/db/queries'
import { computeGroupStandings, type StandingMatch, type GroupStanding } from '@/lib/standings'
import { projectBracket, type ProjectedBracket } from '@/lib/bracket-projection'

export type BracketView = { groups: GroupStanding[]; bracket: ProjectedBracket } | null

/** Current group standings + the projected knockout bracket. Read-only. */
export async function getBracketProjection(): Promise<BracketView> {
  const me = await currentParticipant()
  if (!me) return null

  const all = await getAllMatches()
  const matches: StandingMatch[] = all.map((m) => ({
    stage: m.stage,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    status: m.status,
  }))
  const groups = computeGroupStandings(matches)
  const bracket = projectBracket(groups)
  return { groups, bracket }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/actions/bracket-actions.ts
git commit -m "feat(SURV-27): getBracketProjection server action"
```

---

## Task 5: `/chaveamento` page + dashboard link

**Files:**
- Create: `src/app/chaveamento/page.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Implement the page** — `src/app/chaveamento/page.tsx`

```tsx
export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentParticipant } from '@/lib/session'
import { getBracketProjection } from '@/app/actions/bracket-actions'
import type { Slot, ProjMatch } from '@/lib/bracket-projection'

const ROUND_LABEL: Record<ProjMatch['round'], string> = {
  r32: '16avos', r16: 'Oitavas', qf: 'Quartas', sf: 'Semifinal', third: '3º lugar', final: 'Final',
}

function slotText(s: Slot): string {
  if (s.kind === 'team') return s.team
  if (s.kind === 'winner') return `Vencedor M${s.ofMatch}`
  return s.label.startsWith('3rd:') ? `3º (${s.label.slice(4)})` : s.label
}

export default async function ChaveamentoPage() {
  const me = await currentParticipant()
  if (!me) redirect('/login')
  const data = await getBracketProjection()

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Chaveamento (prévia)</h1>
        <Link href="/" className="text-sm underline">← voltar</Link>
      </div>

      {!data ? (
        <p className="text-gray-600">Indisponível.</p>
      ) : (
        <>
          <p className="mb-4 rounded bg-amber-100 p-3 text-center text-sm">
            ⚠️ Projeção não-oficial, com base nas classificações atuais
            {data.bracket.provisional ? ' (grupos ainda em andamento — pode mudar muito)' : ''}.
          </p>

          <section className="mb-6">
            <h2 className="mb-2 font-semibold">16avos de final</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {data.bracket.r32.map((m) => (
                <li key={m.match} className="flex items-center justify-between rounded border p-2">
                  <span className="text-xs text-gray-400">M{m.match}</span>
                  <span className="flex-1 px-2 text-right">{slotText(m.a)}</span>
                  <span className="px-1 text-gray-400">×</span>
                  <span className="flex-1 px-2">{slotText(m.b)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Fases seguintes</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {data.bracket.later.map((m) => (
                <li key={m.match} className="flex items-center justify-between rounded border p-2">
                  <span className="w-20 text-xs text-gray-400">{ROUND_LABEL[m.round]} M{m.match}</span>
                  <span className="flex-1 px-2 text-right">{slotText(m.a)}</span>
                  <span className="px-1 text-gray-400">×</span>
                  <span className="flex-1 px-2">{slotText(m.b)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-6">
            <h2 className="mb-2 font-semibold">Classificação dos grupos</h2>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {data.groups.map((g) => (
                <div key={g.letter} className="rounded border p-2">
                  <div className="mb-1 font-medium">Grupo {g.letter}</div>
                  <ol className="list-decimal pl-4">
                    {g.rows.map((r) => (
                      <li key={r.team} className="flex justify-between gap-2">
                        <span className="truncate">{r.team}</span>
                        <span className="shrink-0 text-gray-500">{r.points}pts {r.gd >= 0 ? '+' : ''}{r.gd}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  )
}
```

- [ ] **Step 2: Add a link from the dashboard** — `src/app/page.tsx`

Find the existing results link block:
```tsx
      <p className="mb-4 text-center">
        <Link href="/resultados" className="text-sm font-medium text-blue-600 underline">
          📊 Ver palpites de todos &amp; resultados →
        </Link>
      </p>
```
Replace with (adds a second link):
```tsx
      <p className="mb-4 flex flex-col gap-1 text-center">
        <Link href="/resultados" className="text-sm font-medium text-blue-600 underline">
          📊 Ver palpites de todos &amp; resultados →
        </Link>
        <Link href="/chaveamento" className="text-sm font-medium text-blue-600 underline">
          🗺️ Ver prévia do chaveamento →
        </Link>
      </p>
```

- [ ] **Step 3: Verify the whole project**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc 0 errors; all vitest pass; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/chaveamento/page.tsx src/app/page.tsx
git commit -m "feat(SURV-27): chaveamento page with projected crossings"
```

---

## Final verification

- [ ] Run `npx tsc --noEmit && npm test && npm run build` — all green.
- [ ] Sanity-run against live data (read-only): a throwaway tsx script calling `computeGroupStandings(await getAllMatches())` + `projectBracket(...)` to eyeball that the 16 R32 crossings resolve to real team names and look plausible. Delete the script after.

---

## Spec coverage check

- Group standings from stored scores (pts→GD→GF→H2H, fallback flagged) → Task 2.
- Best-8 thirds + Annex C allocation → Tasks 1, 3.
- R32 crossings resolved to teams; later rounds as winner refs → Task 3.
- "Projeção não-oficial" badges + provisional flag → Tasks 3, 5.
- Read-only page wired to live data → Tasks 4, 5.
- Fair-play/lots limitation surfaced as `tiebreakUncertain` → Task 2 (flag) + provisional badge.
- Official-override (spec §3.4): SIMPLIFIED — once groups finish, the projection equals the official result, so no per-match override is implemented; the provisional badge communicates pre-finish uncertainty. Noted as an intentional scope reduction.
