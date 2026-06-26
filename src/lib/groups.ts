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
