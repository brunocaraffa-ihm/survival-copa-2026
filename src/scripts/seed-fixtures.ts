import 'dotenv/config'
import { fetchWorldCupMatches } from '@/lib/football-data'
import { matchDayKey } from '@/lib/tz'
import { upsertMatch } from '@/db/queries'

async function main() {
  const token = process.env.FOOTBALL_DATA_TOKEN
  if (!token) {
    console.error('No FOOTBALL_DATA_TOKEN set. Add fixtures manually via /admin, or set the token and re-run.')
    process.exit(1)
  }
  const matches = await fetchWorldCupMatches(token, '2026-06-11', '2026-07-19')
  for (const m of matches) {
    await upsertMatch({
      externalId: m.externalId,
      utcKickoff: m.utcKickoff,
      matchDate: matchDayKey(m.utcKickoff),
      stage: 'group',
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      status: m.status,
    })
  }
  console.log(`Seeded ${matches.length} matches.`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
