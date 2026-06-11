import { cookies } from 'next/headers'
import { readSession } from './auth'
import { getParticipantById } from '@/db/queries'

const COOKIE = 'survival_session'

export async function currentParticipant() {
  const store = await cookies()
  const token = store.get(COOKIE)?.value
  if (!token) return null
  const session = await readSession(token, process.env.SESSION_SECRET!)
  if (!session) return null
  return getParticipantById(session.participantId)
}

export const SESSION_COOKIE = COOKIE
