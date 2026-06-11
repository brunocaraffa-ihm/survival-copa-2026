import { formatInTimeZone } from 'date-fns-tz'

export const TZ = 'America/Sao_Paulo'

/** Calendar date (YYYY-MM-DD) of a UTC instant, in Brasília time. */
export function brtDateString(utc: Date): string {
  return formatInTimeZone(utc, TZ, 'yyyy-MM-dd')
}

/**
 * The "match day" a kickoff belongs to. Days run 06:00 BRT → 06:00 BRT, so a
 * game in the small hours (e.g. 01:00 BRT) is grouped with the previous evening
 * instead of starting a near-empty calendar day.
 */
export function matchDayKey(utc: Date): string {
  return brtDateString(new Date(utc.getTime() - 6 * 60 * 60 * 1000))
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

/** Inclusive list of calendar date strings 'YYYY-MM-DD' from start to end. */
export function datesInclusive(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(`${start}T12:00:00Z`)
  const last = new Date(`${end}T12:00:00Z`)
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
