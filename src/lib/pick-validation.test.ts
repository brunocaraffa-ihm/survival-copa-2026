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
