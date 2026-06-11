import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, generatePassword, createSession, readSession } from './auth'

const SECRET = 'test-secret-test-secret-test-secret-32'

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('hunter2')
    expect(await verifyPassword('hunter2', hash)).toBe(true)
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })
})

describe('generatePassword', () => {
  it('returns a non-trivial readable password', () => {
    const pw = generatePassword()
    expect(pw).toMatch(/^[a-z0-9]{8,}$/)
    expect(pw).not.toEqual(generatePassword())
  })
})

describe('session token', () => {
  it('round-trips the participant id', async () => {
    const token = await createSession('p-123', SECRET)
    expect(await readSession(token, SECRET)).toEqual({ participantId: 'p-123' })
  })
  it('returns null for a tampered/invalid token', async () => {
    expect(await readSession('garbage', SECRET)).toBeNull()
  })
})
