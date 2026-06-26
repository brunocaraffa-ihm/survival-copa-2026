import 'dotenv/config'
import { sql } from 'drizzle-orm'
import { db } from '@/db/client'

async function main() {
  await db.execute(sql`UPDATE picks SET group_key = 'g:' || match_date WHERE group_key IS NULL`)
  await db.execute(sql`UPDATE life_losses SET group_key = 'g:' || match_date WHERE group_key IS NULL`)
  console.log('Backfilled group_key on picks and life_losses.')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
