import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/** Readable random password, e.g. "k7m2p9qx". */
export function generatePassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export async function createSession(participantId: string, secret: string): Promise<string> {
  return new SignJWT({ participantId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('60d')
    .sign(new TextEncoder().encode(secret))
}

export async function readSession(token: string, secret: string): Promise<{ participantId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
    if (typeof payload.participantId !== 'string') return null
    return { participantId: payload.participantId }
  } catch {
    return null
  }
}
