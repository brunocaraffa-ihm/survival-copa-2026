export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentParticipant } from '@/lib/session'
import { getBracketProjection } from '@/app/actions/bracket-actions'
import type { Slot, ProjMatch } from '@/lib/bracket-projection'

const ROUND_LABEL: Record<ProjMatch['round'], string> = {
  r32: '16avos', r16: 'Oitavas', qf: 'Quartas', sf: 'Semifinal', third: '3º lugar', final: 'Final',
}

function slotText(s: Slot): string {
  if (s.kind === 'team') return s.team
  if (s.kind === 'winner') return `Vencedor M${s.ofMatch}`
  return s.label.startsWith('3rd:') ? `3º (${s.label.slice(4)})` : s.label
}

export default async function ChaveamentoPage() {
  const me = await currentParticipant()
  if (!me) redirect('/login')
  const data = await getBracketProjection()

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Chaveamento (prévia)</h1>
        <Link href="/" className="text-sm underline">← voltar</Link>
      </div>

      {!data ? (
        <p className="text-gray-600">Indisponível.</p>
      ) : (
        <>
          <p className="mb-4 rounded bg-amber-100 p-3 text-center text-sm">
            ⚠️ Projeção não-oficial, com base nas classificações atuais
            {data.bracket.provisional ? ' (grupos ainda em andamento — pode mudar muito)' : ''}.
          </p>

          <section className="mb-6">
            <h2 className="mb-2 font-semibold">16avos de final</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {data.bracket.r32.map((m) => (
                <li key={m.match} className="flex items-center justify-between rounded border p-2">
                  <span className="text-xs text-gray-400">M{m.match}</span>
                  <span className="flex-1 px-2 text-right">{slotText(m.a)}</span>
                  <span className="px-1 text-gray-400">×</span>
                  <span className="flex-1 px-2">{slotText(m.b)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-semibold">Fases seguintes</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {data.bracket.later.map((m) => (
                <li key={m.match} className="flex items-center justify-between rounded border p-2">
                  <span className="w-20 text-xs text-gray-400">{ROUND_LABEL[m.round]} M{m.match}</span>
                  <span className="flex-1 px-2 text-right">{slotText(m.a)}</span>
                  <span className="px-1 text-gray-400">×</span>
                  <span className="flex-1 px-2">{slotText(m.b)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-6">
            <h2 className="mb-2 font-semibold">Classificação dos grupos</h2>
            <div className="grid grid-cols-2 gap-3 text-xs">
              {data.groups.map((g) => (
                <div key={g.letter} className="rounded border p-2">
                  <div className="mb-1 font-medium">Grupo {g.letter}</div>
                  <ol className="list-decimal pl-4">
                    {g.rows.map((r) => (
                      <li key={r.team} className="flex justify-between gap-2">
                        <span className="truncate">{r.team}</span>
                        <span className="shrink-0 text-gray-500">{r.points}pts {r.gd >= 0 ? '+' : ''}{r.gd}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  )
}
