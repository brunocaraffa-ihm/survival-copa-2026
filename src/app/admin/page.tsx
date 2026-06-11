export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { currentParticipant } from '@/lib/session'
import { listParticipants, getMatchesByDate } from '@/db/queries'
import { brtDateString } from '@/lib/tz'
import { AdminPanel } from '@/app/_components/AdminPanel'

export default async function AdminPage() {
  const me = await currentParticipant()
  if (!me) redirect('/login')
  if (!me.isAdmin) redirect('/')
  const everyone = await listParticipants()
  const today = brtDateString(new Date())
  const todayMatches = await getMatchesByDate(today)
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Admin</h1>
      <AdminPanel
        participants={everyone.map((p) => ({ id: p.id, name: p.name, username: p.username }))}
        todayMatches={todayMatches.map((m) => ({ id: m.id, homeTeam: m.homeTeam, awayTeam: m.awayTeam, status: m.status }))}
      />
    </main>
  )
}
