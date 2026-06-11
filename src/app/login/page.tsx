import { LoginForm } from '@/app/_components/LoginForm'
import { currentParticipant } from '@/lib/session'
import { redirect } from 'next/navigation'

export default async function LoginPage() {
  if (await currentParticipant()) redirect('/')
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="mb-6 text-2xl font-bold">Survival Copa 2026</h1>
      <LoginForm />
    </main>
  )
}
