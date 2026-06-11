'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyPassword, createSession } from '@/lib/auth'
import { SESSION_COOKIE } from '@/lib/session'
import { getParticipantByUsername } from '@/db/queries'

export async function login(_prev: unknown, formData: FormData): Promise<{ error?: string }> {
  const username = String(formData.get('username') ?? '').trim().toLowerCase()
  const password = String(formData.get('password') ?? '')
  const participant = await getParticipantByUsername(username)
  if (!participant || !(await verifyPassword(password, participant.passwordHash))) {
    return { error: 'Usuário ou senha inválidos' }
  }
  const token = await createSession(participant.id, process.env.SESSION_SECRET!)
  const store = await cookies()
  store.set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 60, path: '/' })
  redirect('/')
}

export async function logout(): Promise<void> {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
  redirect('/login')
}
