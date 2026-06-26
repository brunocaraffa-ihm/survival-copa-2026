# Deploy (100% free)

## 1. Supabase (Postgres)
1. Create a project at supabase.com (free tier).
2. Project Settings → Database → Connection string → **URI** (use the pooler, port 6543).
3. Put it in `.env` as `DATABASE_URL`.

## 2. Local setup
```bash
cp .env.example .env   # fill DATABASE_URL, SESSION_SECRET, CRON_SECRET, FOOTBALL_DATA_TOKEN
npm install
npm run db:push        # create tables in Supabase
npm run seed:fixtures  # load the WC schedule (needs FOOTBALL_DATA_TOKEN)
```

## 3. Create the admin (bruno)
Run a one-off Node/tsx snippet or temporarily allow open admin creation. Simplest: insert via Supabase SQL editor using a bcrypt hash, or run:
```bash
npx tsx -e "import('dotenv/config').then(async()=>{const {hashPassword,generatePassword}=await import('./src/lib/auth.ts');const {db}=await import('./src/db/client.ts');const {participants}=await import('./src/db/schema.ts');const pw=generatePassword();await db.insert(participants).values({name:'Bruno',username:'bruno',isAdmin:true,passwordHash:await hashPassword(pw)});console.log('bruno senha:',pw);process.exit(0)})"
```
Save the printed password. Log in as `bruno`, then add the others (rato, bitu, bigode, pedropaulo) from `/admin`.

## 4. Vercel
1. Push the repo to GitHub.
2. Import into Vercel (free Hobby plan).
3. Add env vars: `DATABASE_URL`, `SESSION_SECRET`, `CRON_SECRET`, `FOOTBALL_DATA_TOKEN`.
4. Deploy. The cron in `vercel.json` runs every 2h and settles results.

### 4b. Auto-deploy on push (GitHub Actions)
`.github/workflows/deploy.yml` deploys production on every push to `main`
(and on manual trigger via the Actions tab → "Run workflow"). One-time setup:
1. Create a token: Vercel → Account Settings → Tokens → create (scope: the team/project).
2. GitHub repo → Settings → Secrets and variables → Actions → New repository secret:
   name `VERCEL_TOKEN`, value = the token.
3. The org/project IDs are already in the workflow (from `.vercel/project.json`).
   Env vars (`DATABASE_URL`, etc.) are pulled from the Vercel project at deploy time —
   no need to duplicate them as GitHub secrets.

To publish the current `main` immediately after adding the secret, run the workflow
manually from the Actions tab (no new commit needed). If Vercel's own Git integration
is also connected, you may get duplicate deploys — disable it under Vercel → Settings → Git
if you prefer Actions to be the only deployer.

## 5. Manual results fallback
If the API misses a game, go to `/admin` and enter the score manually — the next cron run settles it. Draw (incl. penalty losses) survives.
