# Prode Mundial 2026

Private World Cup 2026 prediction pool for 5 friends.

## Rules
- Predict the score of every match before kickoff (knockouts: once both teams are known).
- 3 pts exact score · 1 pt correct outcome · 0 otherwise. Knockouts judged on the 90-minute result.
- Nobody sees anyone else's prediction until the match kicks off.
- Tiebreaker: more exact scores.

## Stack
Next.js (App Router) · Neon Postgres + Drizzle · Tailwind · Vercel.
Results auto-sync from football-data.org every 10 minutes (Vercel cron).

## Environment variables
| Var | Where | What |
|-----|-------|------|
| `DATABASE_URL` | local + Vercel | Neon Postgres connection string |
| `FOOTBALL_DATA_TOKEN` | local + Vercel | football-data.org API token |
| `SESSION_SECRET` | local + Vercel | random hex (`openssl rand -hex 32`) |
| `CRON_SECRET` | Vercel only | random hex; Vercel sends it as Bearer token to `/api/sync` |

## Setup
1. Create a Neon database (Vercel → Storage → Neon) and put `DATABASE_URL` in `.env.local`.
2. `npm install`
3. `npm run db:push` — create tables
4. `npm run seed` — fixture + users (prints the generated passwords ONCE) + backfilled predictions
5. `npm run dev`

## Deploy
Import the GitHub repo in Vercel, set the four env vars, deploy. The cron in `vercel.json` keeps results fresh.
