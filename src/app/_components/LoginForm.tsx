'use client'
import { useActionState } from 'react'
import { login } from '@/app/actions/auth-actions'

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, {})
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input name="username" placeholder="usuário" autoCapitalize="none" className="rounded border p-2" required />
      <input name="password" type="password" placeholder="senha" className="rounded border p-2" required />
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button disabled={pending} className="rounded bg-black p-2 text-white disabled:opacity-50">
        {pending ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}
