import bracket from './wc2026-bracket.json'
import { WC2026_GROUPS, type GroupLetter } from './wc2026-groups'

export type R32Pairing = { match: number; slot1: string; slot2: string }
export type AnnexCEntry = { groups: GroupLetter[]; assign: Record<string, string> }
export type PropMatch = { match: number; from: number[] }

export const R32: R32Pairing[] = bracket.r32 as R32Pairing[]
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
