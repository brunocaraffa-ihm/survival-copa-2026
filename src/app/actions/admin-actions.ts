'use server'

import { revalidatePath } from 'next/cache'
import { currentParticipant } from '@/lib/session'
import { hashPassword, generatePassword } from '@/lib/auth'
import { db } from '@/db/client'
import { participants } from '@/db/schema'
import { setMatchResult } from '@/db/queries'

async function requireAdmin() {
  const me = await currentParticipant()
  if (!me || !me.isAdmin) throw new Error('forbidden')
  return me
}

export async function createParticipant(name: string, username: string): Promise<{ username: string; password: string }> {
  await requireAdmin()
  const password = generatePassword()
  const passwordHash = await hashPassword(password)
  await db.insert(participants).values({ name, username: username.toLowerCase(), passwordHash })
  revalidatePath('/admin')
  return { username: username.toLowerCase(), password }
}

export async function overrideResult(matchId: string, homeScore: number, awayScore: number): Promise<void> {
  await requireAdmin()
  await setMatchResult(matchId, homeScore, awayScore)
  revalidatePath('/admin')
}
