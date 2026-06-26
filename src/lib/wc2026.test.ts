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
