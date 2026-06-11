'use client'

import { useActionState } from 'react'
import { submitPick, clearPick } from '@/app/actions/pick-actions'

const ERROR_PT: Record<string, string> = {
  eliminated: 'Você está sem vidas.',
  deadline_passed: 'O deadline já passou.',
  not_playing_today: 'Esse time não joga nesse dia.',
  team_already_used: 'Você já usou esse time.',
  invalid_date: 'Data inválida.',
}

export function DayPickForm({
  date,
  pickableTeams,
  teamsUsed,
  currentPick,
}: {
  date: string
  pickableTeams: string[]
  teamsUsed: string[]
  currentPick: string | null
}) {
  const [state, formAction, pending] = useActionState(submitPick, {} as { error?: string; ok?: boolean })

  return (
    <div className="flex flex-col gap-1">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="matchDate" value={date} />
        <select name="team" defaultValue={currentPick ?? ''} className="rounded border p-2" required>
          <option value="" disabled>
            escolha um time…
          </option>
          {pickableTeams.map((t) => (
            <option key={t} value={t} disabled={teamsUsed.includes(t) && t !== currentPick}>
              {t}
              {teamsUsed.includes(t) ? ' (já usado)' : ''}
            </option>
          ))}
        </select>
        <button disabled={pending} className="rounded bg-black px-3 py-2 text-white disabled:opacity-50">
          {pending ? '…' : currentPick ? 'Trocar' : 'Confirmar'}
        </button>
      </form>
      {currentPick && (
        <form action={clearPick}>
          <input type="hidden" name="matchDate" value={date} />
          <button className="text-xs text-red-600 underline">limpar palpite ({currentPick})</button>
        </form>
      )}
      {state?.error && <p className="text-sm text-red-600">{ERROR_PT[state.error] ?? state.error}</p>}
      {state?.ok && <p className="text-sm text-green-600">Palpite salvo!</p>}
    </div>
  )
}
