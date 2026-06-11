'use client'
import { useActionState } from 'react'
import { submitPick } from '@/app/actions/pick-actions'

type M = { id: string; homeTeam: string; awayTeam: string }
const ERROR_PT: Record<string, string> = {
  eliminated: 'Você está eliminado.',
  deadline_passed: 'O deadline já passou.',
  not_playing_today: 'Esse time não joga hoje.',
  team_already_used: 'Você já usou esse time.',
}

export function PickForm({ matches, teamsUsed, currentPick }: { matches: M[]; teamsUsed: string[]; currentPick: string | null }) {
  const [state, formAction, pending] = useActionState(submitPick, {})
  const teams = Array.from(new Set(matches.flatMap((m) => [m.homeTeam, m.awayTeam])))
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <select name="team" defaultValue={currentPick ?? ''} className="rounded border p-2" required>
        <option value="" disabled>escolha um time…</option>
        {teams.map((t) => (
          <option key={t} value={t} disabled={teamsUsed.includes(t) && t !== currentPick}>
            {t} {teamsUsed.includes(t) ? '(já usado)' : ''}
          </option>
        ))}
      </select>
      {state?.error && <p className="text-sm text-red-600">{ERROR_PT[state.error] ?? state.error}</p>}
      {state?.ok && <p className="text-sm text-green-600">Palpite salvo!</p>}
      <button disabled={pending} className="rounded bg-black p-2 text-white disabled:opacity-50">
        {pending ? 'Salvando…' : currentPick ? 'Trocar palpite' : 'Confirmar palpite'}
      </button>
    </form>
  )
}
