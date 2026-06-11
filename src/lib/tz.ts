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
