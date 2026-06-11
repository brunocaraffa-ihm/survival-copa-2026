'use client'
import { useState } from 'react'
import { createParticipant, overrideResult } from '@/app/actions/admin-actions'

type P = { id: string; name: string; username: string }
type M = { id: string; homeTeam: string; awayTeam: string; status: string }

export function AdminPanel({ participants, todayMatches }: { participants: P[]; todayMatches: M[] }) {
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null)

  async function addPlayer(formData: FormData) {
    const name = String(formData.get('name'))
    const username = String(formData.get('username'))
    setCreated(await createParticipant(name, username))
  }
  async function setResult(formData: FormData) {
    await overrideResult(String(formData.get('matchId')), Number(formData.get('home')), Number(formData.get('away')))
  }

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-2 font-semibold">Cadastrar participante</h2>
        <form action={addPlayer} className="flex gap-2">
          <input name="name" placeholder="nome" className="rounded border p-2" required />
          <input name="username" placeholder="usuário" className="rounded border p-2" required />
          <button className="rounded bg-black px-3 text-white">criar</button>
        </form>
        {created && (
          <p className="mt-2 rounded bg-yellow-100 p-2 text-sm">
            Senha de <b>{created.username}</b>: <code>{created.password}</code> — anote e envie!
          </p>
        )}
        <ul className="mt-3 text-sm">{participants.map((p) => <li key={p.id}>{p.name} (@{p.username})</li>)}</ul>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Resultado manual (hoje)</h2>
        {todayMatches.length === 0 && <p className="text-sm text-gray-600">Sem jogos hoje.</p>}
        {todayMatches.map((m) => (
          <form key={m.id} action={setResult} className="mb-2 flex items-center gap-2 text-sm">
            <input type="hidden" name="matchId" value={m.id} />
            <span className="w-40 text-right">{m.homeTeam}</span>
            <input name="home" type="number" min="0" className="w-14 rounded border p-1" required />
            <span>x</span>
            <input name="away" type="number" min="0" className="w-14 rounded border p-1" required />
            <span className="w-40">{m.awayTeam}</span>
            <button className="rounded bg-black px-2 py-1 text-white">salvar</button>
          </form>
        ))}
      </section>
    </div>
  )
}
