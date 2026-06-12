# Prode World Cup 2026 — Design

A private World Cup 2026 prediction pool ("prode") for 5 friends, deployed on Vercel.

## Users

| Name | Username | Role |
|------|----------|------|
| Rodrigo Candi | rodrigo | admin |
| Leo Murillo | leo | player |
| Pablo Zerbinatti | pablo | player |
| Atu Waker | atu | player |
| Martin Prado | martin | player |

Random passwords are generated at seed time, stored as bcrypt hashes, and delivered to Rodrigo out of band. Security is intentionally minimal (friends-only joke app), but passwords are never stored or committed in plaintext.

## Stack

- **Next.js** (App Router, TypeScript) + **Tailwind CSS**, UI in English
- **Neon Postgres** (free tier, provisioned via Vercel marketplace) with **Drizzle ORM**
- **Auth:** username + password against seeded users; signed session cookie (JWT via `jose`, `SESSION_SECRET` env var). No registration, no password reset.
- **Hosting:** Vercel (Hobby), repo on GitHub

## Data model

- `users` — id, name, username, password_hash, is_admin
- `matches` — id (= football-data.org match id), stage (`GROUP_STAGE`, `LAST_32`, `LAST_16`, `QUARTER_FINALS`, `SEMI_FINALS`, `THIRD_PLACE`, `FINAL`), group (nullable), kickoff_utc, status, home_team, away_team (nullable while TBD), home_score, away_score (90-minute/full-time score)
- `predictions` — user_id, match_id, home_score, away_score, updated_at; unique (user_id, match_id)
- `meta` — key/value (e.g. `last_synced_at`)

Points are computed on the fly (5 users × 104 matches is trivial); no stored score table to drift out of sync.

## Fixture & results sync (football-data.org)

- Source: `GET /v4/competitions/WC/matches` with `X-Auth-Token` header. Token verified working; lives in `.env.local` locally and Vercel env vars in prod — never committed.
- All 104 matches seeded up front. Knockout matches arrive as TBD teams and are filled in by sync as qualifiers are decided — this covers "populate round of 32/16/quarters/semis/third place/final" automatically.
- **Lazy sync:** Vercel Hobby crons are daily-only, so any authenticated page load triggers a background re-sync if `last_synced_at` is older than 10 minutes. Sync upserts team names, kickoff times, status, and scores.
- Respect rate limits: free tier is 10 requests/minute; check `x-requests-available-minute` response header and skip sync when exhausted (per football-data.org's guidance).
- Admin fallback: "Sync now" button plus manual result editing.

## Predictions & visibility

- Each match: predict home/away goals (integers ≥ 0). Editable until kickoff, locked at kickoff — **enforced server-side** by comparing `kickoff_utc` to server time.
- Other players' predictions are only included in API responses for matches whose kickoff is in the past. Before that, the server never sends them — no client-side-only hiding.
- Knockout predictions open as soon as both real teams are known, close at kickoff (round-by-round prediction).

## Scoring

- **3 points** — exact score (90-minute result)
- **1 point** — correct outcome (home win / draw / away win) but not exact
- **0 points** — wrong outcome or no prediction
- Knockout matches are judged on the 90-minute result; a predicted draw in a knockout match is valid and scores against the 90-minute draw.
- Leaderboard tiebreaker: more exact (3-point) hits ranks higher; still tied → shared position.

## Pages

- `/login` — username + password
- `/` (fixture) — matches grouped by stage and date; inline prediction inputs for open matches; result, own prediction, and points earned for played matches
- `/leaderboard` — total points, exact-hit count, rank
- `/compare/[username]` — for each played match: their prediction vs. my prediction vs. actual result, with points each earned; totals at the top
- `/admin` (Rodrigo only) — sync now, edit any match result, backfill predictions

## Backfill (pre-app matches)

The group used another app before this one existed. Rodrigo will provide the results and everyone's predictions for matches already played; these are inserted via the admin backfill page (select match + enter all 5 players' predictions) so history and points carry over. Locked matches accept backfilled predictions only via admin.

## Error handling

- football-data.org down or rate-limited: app serves last-synced data; sync failures are silent for players, visible in admin.
- Invalid prediction input (negative, non-integer, after kickoff): rejected server-side with a clear message.
- Unauthenticated requests redirect to `/login`.

## Testing

- Unit tests for the scoring function (exact / outcome / miss / missing prediction / knockout draw cases) and the lock/visibility rules — these are the correctness-critical pieces.
- Manual smoke test for pages and sync (5-user joke app; no e2e suite).

## Out of scope

- Password reset, registration, email
- Bonus questions (champion, top scorer)
- Real-time/live minute-by-minute scores
- Mobile app (the site is responsive; that's enough)
