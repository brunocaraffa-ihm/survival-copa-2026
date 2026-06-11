export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { currentParticipant } from '@/lib/session'
import { getTodayBoard } from '@/app/actions/pick-actions'
import { listParticipants, countMatches } from '@/db/queries'
import { decideWinners } from '@/lib/rules'
import { PickForm } from '@/app/_components/PickForm'
import { logout } from '@/app/actions/auth-actions'

export default async function Dashboard() {
  const me = await currentParticipant()
  if (!me) redirect('/login')
  const board = await getTodayBoard()
  const everyone = await listParticipants()

  const counts = await countMatches()
  const aliveCount = everyone.filter((p) => p.status === 'alive').length
  const tournamentOver = (counts.total > 0 && counts.finished === counts.total) || (everyone.length > 1 && aliveCount <= 1)
  const winnerIds = decideWinners(
    everyone.map((p) => ({ id: p.id, status: p.status, eliminatedDate: p.eliminatedDate })),
    tournamentOver,
  )
  const winnerNames = everyone.filter((p) => winnerIds.includes(p.id)).map((p) => p.name)
  const pot = everyone.length * 50

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Survival Copa 2026</h1>
        <form action={logout}><button className="text-sm underline">sair ({me.name})</button></form>
      </div>

      <p className="mb-6 rounded bg-amber-100 p-3 text-center font-semibold">
        💰 Prêmio: R$ {pot} <span className="font-normal text-sm text-amber-800">(R$ 50 de cada · {everyone.length} participantes · leva quem sobreviver mais)</span>
      </p>

      {winnerNames.length > 0 && (
        <p className="mb-6 rounded bg-green-100 p-3 text-center font-semibold">
          🏆 {winnerNames.length > 1 ? 'Campeões' : 'Campeão'}: {winnerNames.join(', ')}
        </p>
      )}

      {me.status === 'eliminated' ? (
        <p className="mb-6 rounded bg-red-100 p-3">Você foi eliminado em {me.eliminatedDate} ({me.eliminatedReason}).</p>
      ) : board && board.matches.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 font-semibold">Palpite de hoje ({board.date})</h2>
          <p className="mb-2 text-sm text-gray-600">
            Deadline: {board.deadline ? new Date(board.deadline).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + ' (Brasília)' : '—'}
          </p>
          {board.deadlinePassed ? (
            <p className="text-sm">Palpites travados.</p>
          ) : (
            <PickForm
              matches={board.matches.map((m) => ({ id: m.id, homeTeam: m.homeTeam, awayTeam: m.awayTeam }))}
              teamsUsed={board.teamsUsed}
              currentPick={board.picks.find((p) => p.participantId === me.id)?.team ?? null}
            />
          )}
        </section>
      ) : (
        <p className="mb-6 text-gray-600">Nenhum jogo hoje. Descanse.</p>
      )}

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Palpites de hoje</h2>
        <ul className="text-sm">
          {everyone.map((p) => {
            const pick = board?.picks.find((x) => x.participantId === p.id)
            const hidden = !board?.deadlinePassed && p.id !== me.id
            return (
              <li key={p.id} className="flex justify-between border-b py-1">
                <span>{p.name}</span>
                <span>{hidden ? '🔒 oculto' : (pick?.team ?? '—')}</span>
              </li>
            )
          })}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Ranking</h2>
        <ul className="text-sm">
          {everyone.map((p) => (
            <li key={p.id} className="flex justify-between border-b py-1">
              <span>{p.name}</span>
              <span>{p.status === 'alive' ? '🟢 vivo' : `❌ caiu ${p.eliminatedDate ?? ''}`}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
