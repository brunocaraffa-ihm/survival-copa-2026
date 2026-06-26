export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentParticipant } from '@/lib/session'
import { getResults, type PickOutcome } from '@/app/actions/pick-actions'

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
}

function outcomeLabel(phase: 'group' | 'knockout', outcome: PickOutcome): string {
  if (outcome === 'survived') return phase === 'knockout' ? '✅ classificou' : '✅ sobreviveu'
  if (outcome === 'eliminated') return phase === 'knockout' ? '💀 eliminado' : '❌ caiu'
  if (outcome === 'no_pick') return '❌ não palpitou'
  return '⏳ aguardando'
}

export default async function ResultsPage() {
  const me = await currentParticipant()
  if (!me) redirect('/login')
  const data = await getResults()

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Resultados</h1>
        <Link href="/" className="text-sm underline">
          ← voltar
        </Link>
      </div>

      {!data || data.days.length === 0 ? (
        <p className="text-gray-600">Ainda não começou nenhum grupo.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {data.days.map((day) => (
            <li key={day.groupKey} className="rounded border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">{day.label}</span>
                <span className="text-xs text-gray-600">{day.deadlinePassed ? '🔓 liberado' : '🔒'}</span>
              </div>

              {day.rows === null ? (
                <p className="text-sm text-gray-500">
                  🔒 Abre quando o primeiro jogo começar{day.deadline ? ` (${fmtTime(day.deadline)} Brasília)` : ''}.
                </p>
              ) : (
                <ul className="text-sm">
                  {day.rows.map((r) => (
                    <li key={r.name} className="flex items-center justify-between gap-2 border-b py-1">
                      <span className="min-w-0">
                        <span className="font-medium">{r.name}</span>{' '}
                        <span className="text-gray-600">{r.team ?? '—'}</span>
                        {r.matchLabel && <span className="block text-xs text-gray-400">{r.matchLabel}</span>}
                      </span>
                      <span className="shrink-0">{outcomeLabel(day.phase, r.outcome)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
