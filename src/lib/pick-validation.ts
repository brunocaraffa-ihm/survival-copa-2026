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
