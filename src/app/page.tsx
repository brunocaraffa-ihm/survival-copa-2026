export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { currentParticipant } from '@/lib/session'
import { getSchedule } from '@/app/actions/pick-actions'
import { listParticipants, countMatches, getAllLifeLosses } from '@/db/queries'
import { decideWinners, computeStanding, STARTING_LIVES } from '@/lib/rules'
import { DayPickForm } from '@/app/_components/DayPickForm'
import { logout } from '@/app/actions/auth-actions'

function hearts(lives: number): string {
  return '❤️'.repeat(lives) + '🤍'.repeat(Math.max(0, STARTING_LIVES - lives))
}

function fmtDay(date: string): string {
  const [, m, d] = date.split('-')
  return `${d}/${m}`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function Dashboard() {
  const me = await currentParticipant()
  if (!me) redirect('/login')

  const schedule = await getSchedule()
  const everyone = await listParticipants()
  const counts = await countMatches()
  const losses = await getAllLifeLosses()

  const lossDatesByPid = new Map<string, string[]>()
  for (const l of losses) {
    const a = lossDatesByPid.get(l.participantId) ?? []
    a.push(l.matchDate)
    lossDatesByPid.set(l.participantId, a)
  }
  const standingOf = (id: string) => computeStanding(lossDatesByPid.get(id) ?? [])
  const nameOf = (id: string) => everyone.find((p) => p.id === id)?.name ?? '?'

  const aliveCount = everyone.filter((p) => !standingOf(p.id).eliminated).length
  const tournamentOver =
    (counts.total > 0 && counts.finished === counts.total) || (everyone.length > 1 && aliveCount <= 1)
  const winnerIds = decideWinners(
    everyone.map((p) => {
      const s = standingOf(p.id)
      return { id: p.id, status: s.eliminated ? ('eliminated' as const) : ('alive' as const), eliminatedDate: s.eliminatedDate }
    }),
    tournamentOver,
  )
  const winnerNames = everyone.filter((p) => winnerIds.includes(p.id)).map((p) => p.name)

  const pot = everyone.length * 50
  const meStanding = standingOf(me.id)

  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Survival Copa 2026</h1>
        <form action={logout}>
          <button className="text-sm underline">sair ({me.name})</button>
        </form>
      </div>

      <p className="mb-4 rounded bg-amber-100 p-3 text-center font-semibold">
        💰 Prêmio: R$ {pot}{' '}
        <span className="text-sm font-normal text-amber-800">
          (R$ 50 de cada · {everyone.length} participantes · {STARTING_LIVES} vidas cada)
        </span>
      </p>

      <p className="mb-4 text-center text-lg">
        Suas vidas: {hearts(meStanding.lives)} <span className="text-sm text-gray-600">({meStanding.lives}/{STARTING_LIVES})</span>
      </p>

      {winnerNames.length > 0 && (
        <p className="mb-6 rounded bg-green-100 p-3 text-center font-semibold">
          🏆 {winnerNames.length > 1 ? 'Campeões' : 'Campeão'}: {winnerNames.join(', ')}
        </p>
      )}

      {meStanding.eliminated && (
        <p className="mb-6 rounded bg-red-100 p-3 text-center">Você ficou sem vidas e está fora. 💀</p>
      )}

      <section className="mb-6">
        <h2 className="mb-2 font-semibold">Jogos &amp; palpites</h2>
        {!schedule || schedule.days.length === 0 ? (
          <p className="text-gray-600">Nenhum jogo pela frente.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {schedule.days.map((day) => (
              <li key={day.date} className="rounded border p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium">{fmtDay(day.date)}</span>
                  <span className="text-xs text-gray-600">
                    {day.deadline ? `fecha ${fmtTime(day.deadline)} (Brasília)` : ''}{' '}
                    {day.deadlinePassed ? '🔒' : '🟢'}
                  </span>
                </div>
                <p className="mb-2 text-xs text-gray-500">
                  {day.matches.map((m) => `${m.homeTeam} x ${m.awayTeam}`).join(' · ')}
                </p>

                {day.deadlinePassed ? (
                  <ul className="text-sm">
                    {everyone.map((p) => {
                      const pick = day.picks.find((x) => x.participantId === p.id)
                      return (
                        <li key={p.id} className="flex justify-between border-b py-0.5">
                          <span>{p.name}</span>
                          <span>{pick?.team ?? '—'}</span>
                        </li>
                      )
                    })}
                  </ul>
                ) : meStanding.eliminated ? (
                  <p className="text-sm text-gray-500">
                    {day.myPick ? `Seu palpite: ${day.myPick}` : 'Você está fora.'}
                  </p>
                ) : day.pickableTeams.length > 0 ? (
                  <DayPickForm
                    date={day.date}
                    pickableTeams={day.pickableTeams}
                    teamsUsed={schedule.teamsUsed}
                    currentPick={day.myPick}
                  />
                ) : (
                  <p className="text-sm text-gray-500">⏳ times ainda não definidos</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Ranking</h2>
        <ul className="text-sm">
          {everyone
            .map((p) => ({ p, s: standingOf(p.id) }))
            .sort((a, b) => b.s.lives - a.s.lives)
            .map(({ p, s }) => (
              <li key={p.id} className="flex items-center justify-between border-b py-1">
                <span>
                  {p.name} {p.id === me.id ? '(você)' : ''}
                </span>
                <span>
                  {s.eliminated ? `💀 fora (${s.eliminatedDate ?? ''})` : `${hearts(s.lives)}`}
                </span>
              </li>
            ))}
        </ul>
        <p className="mt-2 text-xs text-gray-500">Vidas de cada um ficam visíveis pra todos.</p>
      </section>
    </main>
  )
}
