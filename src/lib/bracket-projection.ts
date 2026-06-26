import { R32, PROPAGATION, annexCLookup, type R32Pairing } from './wc2026'
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

/** Rank the 12 third-placed teams; return the 8 best group letters (sorted). */
function bestEightThirds(standings: GroupStanding[]): GroupLetter[] {
  const thirds = standings.map((g) => ({ letter: g.letter, row: g.rows[2] }))
  thirds.sort(
    (a, b) =>
      b.row.points - a.row.points ||
      b.row.gd - a.row.gd ||
      b.row.gf - a.row.gf ||
      (a.letter < b.letter ? -1 : 1),
  )
  return thirds.slice(0, 8).map((t) => t.letter).sort()
}

function byLetter(standings: GroupStanding[]): Record<string, GroupStanding> {
  return Object.fromEntries(standings.map((g) => [g.letter, g]))
}

export function projectBracket(standings: GroupStanding[]): ProjectedBracket {
  const groups = byLetter(standings)
  const qualifying = bestEightThirds(standings)
  const assign = annexCLookup(qualifying) // winner-letter -> third-letter

  const resolveWinnerOrRunnerUp = (slot: string): Slot => {
    const pos = slot[0]
    const letter = slot[1] as GroupLetter
    if (pos === '1') return { kind: 'team', team: groups[letter].rows[0].team, from: slot }
    if (pos === '2') return { kind: 'team', team: groups[letter].rows[1].team, from: slot }
    return { kind: 'pending', label: slot }
  }

  const r32: ProjMatch[] = R32.map((p: R32Pairing) => {
    let a = resolveWinnerOrRunnerUp(p.slot1)
    let b = resolveWinnerOrRunnerUp(p.slot2)
    // A "3rd:..." slot is paired with the "1X" winner in the other slot; Annex C
    // says which group's third goes there.
    const a3 = a.kind === 'pending'
    const b3 = b.kind === 'pending'
    if (a3 || b3) {
      const winnerSlot = a3 ? p.slot2 : p.slot1
      const winnerLetter = winnerSlot[1]
      const thirdLetter = assign?.[winnerLetter] as GroupLetter | undefined
      const resolved: Slot = thirdLetter
        ? { kind: 'team', team: groups[thirdLetter].rows[2].team, from: `3${thirdLetter}` }
        : { kind: 'pending', label: a3 ? p.slot1 : p.slot2 }
      if (a3) a = resolved
      else b = resolved
    }
    return { match: p.match, round: 'r32', a, b }
  })

  const ref = (m: number): Slot => ({ kind: 'winner', ofMatch: m })
  const later: ProjMatch[] = []
  for (const m of PROPAGATION.r16) later.push({ match: m.match, round: 'r16', a: ref(m.from[0]), b: ref(m.from[1]) })
  for (const m of PROPAGATION.qf) later.push({ match: m.match, round: 'qf', a: ref(m.from[0]), b: ref(m.from[1]) })
  for (const m of PROPAGATION.sf) later.push({ match: m.match, round: 'sf', a: ref(m.from[0]), b: ref(m.from[1]) })
  later.push({ match: PROPAGATION.third.match, round: 'third', a: ref(PROPAGATION.third.fromLosers[0]), b: ref(PROPAGATION.third.fromLosers[1]) })
  later.push({ match: PROPAGATION.final.match, round: 'final', a: ref(PROPAGATION.final.from[0]), b: ref(PROPAGATION.final.from[1]) })

  const provisional = standings.some((g) => g.tiebreakUncertain || g.rows.some((r) => r.played < 3))
  return { provisional, qualifyingThirds: qualifying, r32, later }
}
