# Prode World Cup 2026 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Private World Cup 2026 prediction pool for 5 friends: seeded logins, full fixture auto-synced from football-data.org, kickoff-locked hidden predictions, 3/1/0 scoring, leaderboard, head-to-head compare, admin page. Deployed on Vercel (Pro) by Rodrigo.

**Architecture:** Single Next.js App Router app. Neon Postgres via Drizzle ORM (neon-http driver). Server actions for all mutations; server components read the DB directly. Pure functions in `src/lib` hold all correctness-critical rules (scoring, locking, visibility, standings) and are unit-tested with Vitest. A Vercel cron hits `/api/sync` every 10 minutes.

**Tech Stack:** Next.js 15 (TS, Tailwind v4), drizzle-orm + drizzle-kit, @neondatabase/serverless, bcryptjs, jose, vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-06-12-prode-world-cup-design.md`

**Env vars:** `DATABASE_URL`, `FOOTBALL_DATA_TOKEN` (already in `.env.local`), `SESSION_SECRET`, `CRON_SECRET` (Vercel only).

**File structure:**

```
src/db/schema.ts            # Drizzle tables: users, matches, predictions, meta
src/db/index.ts             # db client (neon-http)
src/lib/scoring.ts          # predictionPoints (pure)
src/lib/rules.ts            # isOpenForPrediction / othersVisible / isScoreable (pure)
src/lib/standings.ts        # computeStandings (pure)
src/lib/auth.ts             # JWT cookie session, getCurrentUser, requireUser
src/lib/sync.ts             # football-data fetch + bulk upsert
src/app/actions.ts          # server actions: login, logout, savePrediction, adminUpdateResult, adminSync
src/app/api/sync/route.ts   # cron endpoint
src/app/login/page.tsx
src/app/page.tsx            # fixture
src/app/leaderboard/page.tsx
src/app/compare/page.tsx + src/app/compare/[username]/page.tsx
src/app/admin/page.tsx
src/components/Nav.tsx, PredictionForm.tsx, AdminMatchRow.tsx
scripts/seed.ts             # users + passwords + matches + backfill
tests in src/lib/*.test.ts
vercel.json, README.md, drizzle.config.ts
```

---

### Task 1: Scaffold Next.js app

**Files:** Create entire Next.js skeleton; Modify `.gitignore` (already covers `.next/`, `node_modules/`, `.env*.local`).

- [ ] **Step 1: Scaffold into temp dir and merge** (project dir name has spaces, create-next-app rejects it in place)

```bash
cd "/Users/rodrigocandi/Coding Projects/Prode World Cup 2026"
npx -y create-next-app@latest webapp-tmp --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --no-turbopack
rsync -a webapp-tmp/ . --exclude .git --exclude .gitignore
rm -rf webapp-tmp
```

Then set `"name": "prode-mundial-2026"` in `package.json`.

- [ ] **Step 2: Install dependencies**

```bash
npm i drizzle-orm @neondatabase/serverless bcryptjs jose
npm i -D drizzle-kit vitest tsx dotenv @types/bcryptjs
```

- [ ] **Step 3: Add scripts to package.json**

```json
"test": "vitest run",
"seed": "tsx --env-file=.env.local scripts/seed.ts",
"db:push": "drizzle-kit push"
```

- [ ] **Step 4: Verify build** — `npm run build` → succeeds.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: scaffold Next.js app"`

---

### Task 2: Database schema + client

**Files:** Create `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`.

- [ ] **Step 1: Write `src/db/schema.ts`**

```ts
import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
});

export const matches = pgTable("matches", {
  id: integer("id").primaryKey(), // football-data.org match id
  stage: text("stage").notNull(), // GROUP_STAGE | LAST_32 | LAST_16 | QUARTER_FINALS | SEMI_FINALS | THIRD_PLACE | FINAL
  groupName: text("group_name"),
  kickoffUtc: timestamp("kickoff_utc", { withTimezone: true }).notNull(),
  status: text("status").notNull(), // SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED ...
  homeTeam: text("home_team"),
  awayTeam: text("away_team"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
});

export const predictions = pgTable(
  "predictions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id),
    matchId: integer("match_id").notNull().references(() => matches.id),
    homeScore: integer("home_score").notNull(),
    awayScore: integer("away_score").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("predictions_user_match").on(t.userId, t.matchId)],
);

export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
```

- [ ] **Step 2: Write `src/db/index.ts`**

```ts
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
```

- [ ] **Step 3: Write `drizzle.config.ts`**

```ts
import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

- [ ] **Step 4: Typecheck** — `npx tsc --noEmit` → no errors. (No DB available yet; `db:push` runs later once Neon exists.)

- [ ] **Step 5: Commit** — `git commit -m "feat: drizzle schema and db client"`

---

### Task 3: Scoring rules (TDD)

**Files:** Create `src/lib/scoring.ts`, `src/lib/scoring.test.ts`.

- [ ] **Step 1: Write failing tests `src/lib/scoring.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { predictionPoints } from "./scoring";

describe("predictionPoints", () => {
  it("gives 3 for exact score", () => {
    expect(predictionPoints({ home: 2, away: 0 }, { home: 2, away: 0 })).toBe(3);
  });
  it("gives 1 for correct winner, wrong score", () => {
    expect(predictionPoints({ home: 1, away: 0 }, { home: 2, away: 0 })).toBe(1);
    expect(predictionPoints({ home: 0, away: 3 }, { home: 1, away: 2 })).toBe(1);
  });
  it("gives 1 for correct draw, wrong score", () => {
    expect(predictionPoints({ home: 1, away: 1 }, { home: 2, away: 2 })).toBe(1);
  });
  it("gives 3 for exact draw", () => {
    expect(predictionPoints({ home: 0, away: 0 }, { home: 0, away: 0 })).toBe(3);
  });
  it("gives 0 for wrong outcome", () => {
    expect(predictionPoints({ home: 1, away: 1 }, { home: 2, away: 1 })).toBe(0);
    expect(predictionPoints({ home: 2, away: 0 }, { home: 0, away: 1 })).toBe(0);
  });
  it("gives 0 for missing prediction", () => {
    expect(predictionPoints(null, { home: 1, away: 0 })).toBe(0);
    expect(predictionPoints(undefined, { home: 1, away: 0 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/lib/scoring.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/scoring.ts`**

```ts
export type ScorePair = { home: number; away: number };

/** 3 = exact score, 1 = correct outcome (win/draw/loss), 0 = miss or no prediction. */
export function predictionPoints(pred: ScorePair | null | undefined, result: ScorePair): 0 | 1 | 3 {
  if (!pred) return 0;
  if (pred.home === result.home && pred.away === result.away) return 3;
  if (Math.sign(pred.home - pred.away) === Math.sign(result.home - result.away)) return 1;
  return 0;
}
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat: scoring function with tests"`

---

### Task 4: Lock & visibility rules (TDD)

**Files:** Create `src/lib/rules.ts`, `src/lib/rules.test.ts`.

- [ ] **Step 1: Write failing tests `src/lib/rules.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { isOpenForPrediction, isScoreable, othersVisible } from "./rules";

const base = {
  kickoffUtc: new Date("2026-06-20T18:00:00Z"),
  homeTeam: "Argentina",
  awayTeam: "Brazil",
  status: "TIMED",
  homeScore: null as number | null,
  awayScore: null as number | null,
};
const before = new Date("2026-06-20T17:59:00Z");
const after = new Date("2026-06-20T18:00:00Z");

describe("isOpenForPrediction", () => {
  it("open before kickoff with both teams known", () => {
    expect(isOpenForPrediction(base, before)).toBe(true);
  });
  it("locked at/after kickoff", () => {
    expect(isOpenForPrediction(base, after)).toBe(false);
  });
  it("locked while teams TBD (knockouts)", () => {
    expect(isOpenForPrediction({ ...base, homeTeam: null }, before)).toBe(false);
    expect(isOpenForPrediction({ ...base, awayTeam: null }, before)).toBe(false);
  });
});

describe("othersVisible", () => {
  it("hidden before kickoff", () => expect(othersVisible(base, before)).toBe(false));
  it("visible from kickoff", () => expect(othersVisible(base, after)).toBe(true));
});

describe("isScoreable", () => {
  it("only FINISHED matches with scores count", () => {
    expect(isScoreable({ ...base, status: "FINISHED", homeScore: 2, awayScore: 0 })).toBe(true);
    expect(isScoreable({ ...base, status: "IN_PLAY", homeScore: 1, awayScore: 0 })).toBe(false);
    expect(isScoreable({ ...base, status: "FINISHED" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run** → FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/rules.ts`**

```ts
export type MatchLike = {
  kickoffUtc: Date;
  homeTeam: string | null;
  awayTeam: string | null;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
};

/** Predictable: both teams known and kickoff not reached. Enforced server-side. */
export function isOpenForPrediction(m: Pick<MatchLike, "kickoffUtc" | "homeTeam" | "awayTeam">, now: Date): boolean {
  return Boolean(m.homeTeam && m.awayTeam) && now.getTime() < m.kickoffUtc.getTime();
}

/** Other players' predictions are revealed once the match kicks off. */
export function othersVisible(m: Pick<MatchLike, "kickoffUtc">, now: Date): boolean {
  return now.getTime() >= m.kickoffUtc.getTime();
}

/** A match awards points only when finished with a recorded score. */
export function isScoreable(m: Pick<MatchLike, "status" | "homeScore" | "awayScore">): boolean {
  return m.status === "FINISHED" && m.homeScore !== null && m.awayScore !== null;
}
```

- [ ] **Step 4: Run tests** → PASS. Run full suite `npm test` → all pass.

- [ ] **Step 5: Commit** — `git commit -m "feat: prediction lock and visibility rules"`

---

### Task 5: Standings computation (TDD)

**Files:** Create `src/lib/standings.ts`, `src/lib/standings.test.ts`.

- [ ] **Step 1: Write failing tests `src/lib/standings.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { computeStandings } from "./standings";

const users = [
  { id: 1, name: "A", username: "a" },
  { id: 2, name: "B", username: "b" },
  { id: 3, name: "C", username: "c" },
];
const m = (id: number, h: number, a: number) => ({
  id, status: "FINISHED", homeScore: h, awayScore: a,
  kickoffUtc: new Date("2026-06-11T19:00:00Z"), homeTeam: "X", awayTeam: "Y",
});
const p = (userId: number, matchId: number, h: number, a: number) => ({ userId, matchId, homeScore: h, awayScore: a });

describe("computeStandings", () => {
  it("totals points and exact hits, sorts by points then exacts", () => {
    const rows = computeStandings(users, [m(10, 2, 0), m(11, 1, 1)], [
      p(1, 10, 2, 0), p(1, 11, 0, 0), // A: 3 + 1 = 4, 1 exact
      p(2, 10, 1, 0), p(2, 11, 1, 1), // B: 1 + 3 = 4, 1 exact
      p(3, 10, 0, 1),                 // C: 0, no prediction for 11 = 0
    ]);
    expect(rows.map((r) => r.points)).toEqual([4, 4, 0]);
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(1); // tied on points AND exacts -> shared rank
    expect(rows[2].rank).toBe(3);
  });
  it("breaks point ties by exact count", () => {
    const rows = computeStandings(users.slice(0, 2), [m(10, 2, 0), m(11, 3, 0), m(12, 1, 0)], [
      p(1, 10, 2, 0),                 // A: 3 (1 exact)
      p(2, 10, 1, 0), p(2, 11, 2, 0), p(2, 12, 2, 0), // B: 1+1+1 = 3 (0 exact)
    ]);
    expect(rows[0].username).toBe("a");
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(2);
  });
  it("ignores unfinished matches", () => {
    const live = { ...m(10, 1, 0), status: "IN_PLAY" };
    const rows = computeStandings(users.slice(0, 1), [live], [p(1, 10, 1, 0)]);
    expect(rows[0].points).toBe(0);
  });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement `src/lib/standings.ts`**

```ts
import { isScoreable, type MatchLike } from "./rules";
import { predictionPoints } from "./scoring";

type UserLite = { id: number; name: string; username: string };
type PredLite = { userId: number; matchId: number; homeScore: number; awayScore: number };
type MatchRow = MatchLike & { id: number };

export type StandingRow = {
  userId: number;
  name: string;
  username: string;
  points: number;
  exact: number;
  outcomes: number; // 1-point hits
  rank: number;
};

export function computeStandings(users: UserLite[], matches: MatchRow[], preds: PredLite[]): StandingRow[] {
  const finished = matches.filter(isScoreable);
  const byUserMatch = new Map(preds.map((p) => [`${p.userId}:${p.matchId}`, p]));

  const rows = users.map((u) => {
    let points = 0, exact = 0, outcomes = 0;
    for (const m of finished) {
      const p = byUserMatch.get(`${u.id}:${m.id}`);
      const pts = predictionPoints(
        p ? { home: p.homeScore, away: p.awayScore } : null,
        { home: m.homeScore!, away: m.awayScore! },
      );
      points += pts;
      if (pts === 3) exact++;
      if (pts === 1) outcomes++;
    }
    return { userId: u.id, name: u.name, username: u.username, points, exact, outcomes, rank: 0 };
  });

  rows.sort((a, b) => b.points - a.points || b.exact - a.exact || a.name.localeCompare(b.name));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.points === r.points && prev.exact === r.exact ? prev.rank : i + 1;
  });
  return rows;
}
```

- [ ] **Step 4: Run** `npm test` → all pass.

- [ ] **Step 5: Commit** — `git commit -m "feat: standings computation with tiebreaker"`

---

### Task 6: Auth (session + login/logout)

**Files:** Create `src/lib/auth.ts`, `src/app/login/page.tsx`, `src/app/actions.ts` (login/logout only for now).

- [ ] **Step 1: Write `src/lib/auth.ts`**

```ts
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

const COOKIE = "prode_session";
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET!);

export async function createSession(userId: number) {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("60d")
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 60,
    path: "/",
  });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export async function getCurrentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const uid = Number(payload.uid);
    return (await db.query.users.findFirst({ where: eq(users.id, uid) })) ?? null;
  } catch {
    return null;
  }
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
```

- [ ] **Step 2: Write `src/app/actions.ts`** (login/logout; later tasks append more actions)

```ts
"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, destroySession } from "@/lib/auth";

export type FormState = { error?: string } | undefined;

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const user = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "Wrong username or password" };
  }
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
```

- [ ] **Step 3: Write `src/app/login/page.tsx`** (client form via useActionState)

```tsx
"use client";

import { useActionState } from "react";
import { login } from "../actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={action} className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-8">
        <h1 className="text-center text-2xl font-bold">⚽ Prode WC 2026</h1>
        <input
          name="username" placeholder="Username" autoComplete="username" required
          className="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2"
        />
        <input
          name="password" type="password" placeholder="Password" autoComplete="current-password" required
          className="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2"
        />
        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
        <button disabled={pending} className="w-full rounded-lg bg-emerald-600 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50">
          {pending ? "..." : "Log in"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Set dark base styles** — in `src/app/layout.tsx` set `<body className="bg-zinc-950 text-zinc-100 antialiased">` (replace font classNames as needed) and update `metadata` to `{ title: "Prode WC 2026" }`. Remove default `page.tsx` content later (Task 9). Generate a `SESSION_SECRET` and append to `.env.local`: `openssl rand -hex 32`.

- [ ] **Step 5: Verify** — `npx tsc --noEmit` passes; `npm run build` passes.

- [ ] **Step 6: Commit** — `git commit -m "feat: cookie session auth and login page"`

---### Task 7: Results sync + cron endpoint

**Files:** Create `src/lib/sync.ts`, `src/app/api/sync/route.ts`.

- [ ] **Step 1: Write `src/lib/sync.ts`**

```ts
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { matches, meta } from "@/db/schema";

const API = "https://api.football-data.org/v4/competitions/WC/matches";

type FDMatch = {
  id: number;
  stage: string;
  group: string | null;
  utcDate: string;
  status: string;
  homeTeam: { name: string | null };
  awayTeam: { name: string | null };
  score: { fullTime: { home: number | null; away: number | null } };
};

export async function syncMatches(): Promise<{ count: number }> {
  const res = await fetch(API, {
    headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN! },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`football-data.org responded ${res.status}`);
  const data = (await res.json()) as { matches: FDMatch[] };

  const rows = data.matches.map((m) => ({
    id: m.id,
    stage: m.stage,
    groupName: m.group,
    kickoffUtc: new Date(m.utcDate),
    status: m.status,
    homeTeam: m.homeTeam.name,
    awayTeam: m.awayTeam.name,
    homeScore: m.score.fullTime.home,
    awayScore: m.score.fullTime.away,
  }));

  await db.insert(matches).values(rows).onConflictDoUpdate({
    target: matches.id,
    set: {
      stage: sql`excluded.stage`,
      groupName: sql`excluded.group_name`,
      kickoffUtc: sql`excluded.kickoff_utc`,
      status: sql`excluded.status`,
      homeTeam: sql`excluded.home_team`,
      awayTeam: sql`excluded.away_team`,
      homeScore: sql`excluded.home_score`,
      awayScore: sql`excluded.away_score`,
    },
  });

  await db.insert(meta)
    .values({ key: "last_synced_at", value: new Date().toISOString() })
    .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } });

  return { count: rows.length };
}
```

- [ ] **Step 2: Write `src/app/api/sync/route.ts`** (Vercel cron sends `Authorization: Bearer $CRON_SECRET`)

```ts
import { syncMatches } from "@/lib/sync";

export async function GET(req: Request) {
  if (process.env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    return Response.json(await syncMatches());
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` passes. (Live test happens in Task 13 once the DB exists.)

- [ ] **Step 4: Commit** — `git commit -m "feat: football-data sync and cron endpoint"`

---

### Task 8: Seed script (users, passwords, matches, backfill)

**Files:** Create `scripts/seed.ts`.

- [ ] **Step 1: Write `scripts/seed.ts`**

```ts
/* Run with: npm run seed  (needs DATABASE_URL + FOOTBALL_DATA_TOKEN in .env.local) */
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";
import { db } from "../src/db";
import { matches, predictions, users } from "../src/db/schema";
import { syncMatches } from "../src/lib/sync";

const WORDS = [
  "golazo", "asado", "mate", "vamos", "crack", "tribuna", "pelota", "gambeta",
  "mundial", "campeon", "offside", "penal", "birra", "fulbo", "tablon", "potrero",
];
const randomPassword = () => `${WORDS[randomInt(WORDS.length)]}-${WORDS[randomInt(WORDS.length)]}-${randomInt(10, 100)}`;

const PLAYERS = [
  { name: "Rodrigo Candi", username: "rodrigo", isAdmin: true },
  { name: "Leo Murillo", username: "leo", isAdmin: false },
  { name: "Pablo Zerbinatti", username: "pablo", isAdmin: false },
  { name: "Atu Waker", username: "atu", isAdmin: false },
  { name: "Martin Prado", username: "martin", isAdmin: false },
];

// Pre-app matches played in the old prode. Synthetic scorelines reproducing real points.
// MEX 2-0 RSA (id 537327), KOR 2-1 CZE (id 537328).
const BACKFILL: Record<string, Array<{ matchId: number; home: number; away: number }>> = {
  atu:     [{ matchId: 537327, home: 2, away: 0 }, { matchId: 537328, home: 1, away: 1 }],
  martin:  [{ matchId: 537327, home: 2, away: 0 }, { matchId: 537328, home: 1, away: 1 }],
  rodrigo: [{ matchId: 537327, home: 1, away: 0 }, { matchId: 537328, home: 1, away: 1 }],
  pablo:   [{ matchId: 537327, home: 1, away: 0 }, { matchId: 537328, home: 1, away: 1 }],
  leo:     [{ matchId: 537327, home: 1, away: 1 }, { matchId: 537328, home: 1, away: 1 }],
};

async function main() {
  console.log("Syncing fixture from football-data.org...");
  const { count } = await syncMatches();
  console.log(`  ${count} matches upserted.`);

  const credentials: Array<[string, string]> = [];
  for (const p of PLAYERS) {
    const existing = await db.query.users.findFirst({ where: eq(users.username, p.username) });
    if (existing) {
      console.log(`  user ${p.username} already exists, skipping`);
      continue;
    }
    const password = randomPassword();
    await db.insert(users).values({ ...p, passwordHash: await bcrypt.hash(password, 10) });
    credentials.push([p.username, password]);
  }

  console.log("Backfilling pre-app predictions...");
  for (const [username, preds] of Object.entries(BACKFILL)) {
    const u = await db.query.users.findFirst({ where: eq(users.username, username) });
    if (!u) throw new Error(`missing user ${username}`);
    for (const pr of preds) {
      const match = await db.query.matches.findFirst({ where: eq(matches.id, pr.matchId) });
      if (!match) throw new Error(`missing match ${pr.matchId}`);
      const existing = await db.query.predictions.findFirst({
        where: and(eq(predictions.userId, u.id), eq(predictions.matchId, pr.matchId)),
      });
      if (!existing) {
        await db.insert(predictions).values({ userId: u.id, matchId: pr.matchId, homeScore: pr.home, awayScore: pr.away });
      }
    }
  }

  if (credentials.length) {
    console.log("\n=== CREDENTIALS (save these, they are not stored in plaintext) ===");
    for (const [u, p] of credentials) console.log(`  ${u.padEnd(10)} ${p}`);
  }
  console.log("\nSeed complete.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` passes (script execution deferred to Task 13 when DB exists).

- [ ] **Step 3: Commit** — `git commit -m "feat: seed script with users, passwords, and backfill"`

---

### Task 9: Nav + fixture page + prediction saving

**Files:** Create `src/components/Nav.tsx`, `src/components/PredictionForm.tsx`; Replace `src/app/page.tsx`; Modify `src/app/layout.tsx`, `src/app/actions.ts` (append `savePrediction`).

- [ ] **Step 1: Append `savePrediction` to `src/app/actions.ts`**

```ts
// ...append below logout(); add these imports at top:
// import { revalidatePath } from "next/cache";
// import { matches, predictions } from "@/db/schema";  (merge with existing users import)
// import { requireUser } from "@/lib/auth";  (merge with existing auth import)
// import { isOpenForPrediction } from "@/lib/rules";

export async function savePrediction(matchId: number, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const home = Number(formData.get("home"));
  const away = Number(formData.get("away"));
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home > 99 || away > 99) {
    return { error: "Scores must be whole numbers between 0 and 99" };
  }
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match || !isOpenForPrediction(match, new Date())) {
    return { error: "Predictions are closed for this match" };
  }
  await db.insert(predictions)
    .values({ userId: user.id, matchId, homeScore: home, awayScore: away, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [predictions.userId, predictions.matchId],
      set: { homeScore: home, awayScore: away, updatedAt: new Date() },
    });
  revalidatePath("/");
  return undefined;
}
```

- [ ] **Step 2: Write `src/components/Nav.tsx`**

```tsx
import Link from "next/link";
import { logout } from "@/app/actions";

export default function Nav({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  return (
    <nav className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3 text-sm">
        <Link href="/" className="font-bold">⚽ Prode</Link>
        <Link href="/" className="text-zinc-300 hover:text-white">Fixture</Link>
        <Link href="/leaderboard" className="text-zinc-300 hover:text-white">Leaderboard</Link>
        <Link href="/compare" className="text-zinc-300 hover:text-white">Compare</Link>
        {isAdmin && <Link href="/admin" className="text-zinc-300 hover:text-white">Admin</Link>}
        <span className="ml-auto text-zinc-400">{name}</span>
        <form action={logout}>
          <button className="text-zinc-400 hover:text-white">Log out</button>
        </form>
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: Write `src/components/PredictionForm.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { savePrediction } from "@/app/actions";
import type { FormState } from "@/app/actions";

export default function PredictionForm({
  matchId, home, away,
}: { matchId: number; home: number | null; away: number | null }) {
  const action = savePrediction.bind(null, matchId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, undefined);
  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input name="home" type="number" min={0} max={99} required defaultValue={home ?? ""}
        className="w-12 rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-center" />
      <span className="text-zinc-500">-</span>
      <input name="away" type="number" min={0} max={99} required defaultValue={away ?? ""}
        className="w-12 rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-center" />
      <button disabled={pending}
        className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-semibold hover:bg-emerald-600 disabled:opacity-50">
        {pending ? "..." : home !== null ? "Update" : "Save"}
      </button>
      {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
    </form>
  );
}
```

- [ ] **Step 4: Replace `src/app/page.tsx`** (fixture)

```tsx
import { asc } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { matches, predictions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isOpenForPrediction, isScoreable } from "@/lib/rules";
import { predictionPoints } from "@/lib/scoring";
import Nav from "@/components/Nav";
import PredictionForm from "@/components/PredictionForm";

export const dynamic = "force-dynamic";

const STAGE_ORDER = ["GROUP_STAGE", "LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"];
const STAGE_LABEL: Record<string, string> = {
  GROUP_STAGE: "Group Stage", LAST_32: "Round of 32", LAST_16: "Round of 16",
  QUARTER_FINALS: "Quarter-finals", SEMI_FINALS: "Semi-finals", THIRD_PLACE: "Third Place", FINAL: "Final",
};
const fmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires",
});

export default async function FixturePage() {
  const user = await requireUser();
  const now = new Date();
  const [all, myPreds] = await Promise.all([
    db.query.matches.findMany({ orderBy: [asc(matches.kickoffUtc), asc(matches.id)] }),
    db.query.predictions.findMany({ where: eq(predictions.userId, user.id) }),
  ]);
  const predByMatch = new Map(myPreds.map((p) => [p.matchId, p]));

  const stages = STAGE_ORDER.map((s) => ({ stage: s, items: all.filter((m) => m.stage === s) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <Nav name={user.name} isAdmin={user.isAdmin} />
      <main className="mx-auto max-w-4xl space-y-8 p-4">
        {stages.map(({ stage, items }) => (
          <section key={stage}>
            <h2 className="mb-3 text-lg font-bold">{STAGE_LABEL[stage] ?? stage}</h2>
            <div className="space-y-1.5">
              {items.map((m) => {
                const pred = predByMatch.get(m.id) ?? null;
                const open = isOpenForPrediction(m, now);
                const scoreable = isScoreable(m);
                const pts = scoreable
                  ? predictionPoints(pred ? { home: pred.homeScore, away: pred.awayScore } : null, { home: m.homeScore!, away: m.awayScore! })
                  : null;
                return (
                  <div key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
                    <span className="w-28 shrink-0 text-xs text-zinc-500">
                      {fmt.format(m.kickoffUtc)}
                      {m.groupName && <span className="block">{m.groupName.replace("_", " ")}</span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      {m.homeTeam ?? "TBD"} <span className="text-zinc-500">vs</span> {m.awayTeam ?? "TBD"}
                      {m.status === "IN_PLAY" || m.status === "PAUSED" ? (
                        <span className="ml-2 font-bold text-amber-400">{m.homeScore}-{m.awayScore} LIVE</span>
                      ) : m.status === "FINISHED" ? (
                        <span className="ml-2 font-bold">{m.homeScore}-{m.awayScore}</span>
                      ) : null}
                    </span>
                    {open ? (
                      <PredictionForm matchId={m.id} home={pred?.homeScore ?? null} away={pred?.awayScore ?? null} />
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="text-zinc-400">
                          {pred ? `You: ${pred.homeScore}-${pred.awayScore}` : "No prediction"}
                        </span>
                        {pts !== null && (
                          <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${pts === 3 ? "bg-emerald-700" : pts === 1 ? "bg-amber-700" : "bg-zinc-700"}`}>
                            {pts} pts
                          </span>
                        )}
                        {!scoreable && <span className="text-xs text-zinc-600">🔒</span>}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
```

- [ ] **Step 5: Verify** — `npm run build` passes.

- [ ] **Step 6: Commit** — `git commit -m "feat: fixture page with inline predictions"`

---

### Task 10: Leaderboard page

**Files:** Create `src/app/leaderboard/page.tsx`.

- [ ] **Step 1: Write `src/app/leaderboard/page.tsx`**

```tsx
import { db } from "@/db";
import { requireUser } from "@/lib/auth";
import { computeStandings } from "@/lib/standings";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const user = await requireUser();
  const [allUsers, allMatches, allPreds] = await Promise.all([
    db.query.users.findMany(),
    db.query.matches.findMany(),
    db.query.predictions.findMany(),
  ]);
  const rows = computeStandings(allUsers, allMatches, allPreds);

  return (
    <>
      <Nav name={user.name} isAdmin={user.isAdmin} />
      <main className="mx-auto max-w-2xl p-4">
        <h1 className="mb-4 text-xl font-bold">Leaderboard</h1>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-left text-zinc-400">
              <th className="py-2">#</th><th>Player</th>
              <th className="text-right">Exact (3)</th>
              <th className="text-right">Outcome (1)</th>
              <th className="text-right">Points</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.userId} className={`border-b border-zinc-800 ${r.userId === user.id ? "bg-zinc-900 font-semibold" : ""}`}>
                <td className="py-2">{r.rank}</td>
                <td>{r.name}</td>
                <td className="text-right">{r.exact}</td>
                <td className="text-right">{r.outcomes}</td>
                <td className="text-right text-base font-bold">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
```

- [ ] **Step 2: Verify** — `npm run build` passes.

- [ ] **Step 3: Commit** — `git commit -m "feat: leaderboard page"`

---

### Task 11: Compare pages

**Files:** Create `src/app/compare/page.tsx`, `src/app/compare/[username]/page.tsx`.

- [ ] **Step 1: Write `src/app/compare/page.tsx`** (player picker)

```tsx
import Link from "next/link";
import { ne } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function ComparePage() {
  const user = await requireUser();
  const others = await db.query.users.findMany({ where: ne(users.id, user.id) });
  return (
    <>
      <Nav name={user.name} isAdmin={user.isAdmin} />
      <main className="mx-auto max-w-2xl p-4">
        <h1 className="mb-4 text-xl font-bold">Compare predictions</h1>
        <div className="space-y-2">
          {others.map((o) => (
            <Link key={o.id} href={`/compare/${o.username}`}
              className="block rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 hover:border-zinc-600">
              {o.name} →
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 2: Write `src/app/compare/[username]/page.tsx`**

```tsx
import { notFound } from "next/navigation";
import { asc, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { matches, predictions, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isScoreable, othersVisible } from "@/lib/rules";
import { predictionPoints } from "@/lib/scoring";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function CompareUserPage({ params }: { params: Promise<{ username: string }> }) {
  const me = await requireUser();
  const { username } = await params;
  const them = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (!them || them.id === me.id) notFound();

  const now = new Date();
  const all = await db.query.matches.findMany({ orderBy: [asc(matches.kickoffUtc), asc(matches.id)] });
  // Visibility rule: only matches that have kicked off. Their prediction is never exposed earlier.
  const visible = all.filter((m) => othersVisible(m, now));
  const preds = await db.query.predictions.findMany({
    where: or(eq(predictions.userId, me.id), eq(predictions.userId, them.id)),
  });
  const find = (uid: number, mid: number) => preds.find((p) => p.userId === uid && p.matchId === mid) ?? null;

  let myTotal = 0, theirTotal = 0;
  const rows = visible.map((m) => {
    const mine = find(me.id, m.id);
    const theirs = find(them.id, m.id);
    const scoreable = isScoreable(m);
    const result = scoreable ? { home: m.homeScore!, away: m.awayScore! } : null;
    const myPts = result ? predictionPoints(mine ? { home: mine.homeScore, away: mine.awayScore } : null, result) : null;
    const theirPts = result ? predictionPoints(theirs ? { home: theirs.homeScore, away: theirs.awayScore } : null, result) : null;
    myTotal += myPts ?? 0;
    theirTotal += theirPts ?? 0;
    return { m, mine, theirs, myPts, theirPts };
  });

  const Pts = ({ v }: { v: number | null }) =>
    v === null ? null : (
      <span className={`ml-1 rounded px-1 text-xs font-bold ${v === 3 ? "bg-emerald-700" : v === 1 ? "bg-amber-700" : "bg-zinc-700"}`}>{v}</span>
    );

  return (
    <>
      <Nav name={me.name} isAdmin={me.isAdmin} />
      <main className="mx-auto max-w-3xl p-4">
        <h1 className="mb-1 text-xl font-bold">You vs {them.name}</h1>
        <p className="mb-4 text-sm text-zinc-400">You {myTotal} — {theirTotal} {them.name.split(" ")[0]} (played matches only)</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-left text-zinc-400">
              <th className="py-2">Match</th><th>Result</th><th>You</th><th>{them.name.split(" ")[0]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, mine, theirs, myPts, theirPts }) => (
              <tr key={m.id} className="border-b border-zinc-800">
                <td className="py-2">{m.homeTeam} vs {m.awayTeam}</td>
                <td>{m.homeScore !== null ? `${m.homeScore}-${m.awayScore}` : "—"}{(m.status === "IN_PLAY" || m.status === "PAUSED") && <span className="ml-1 text-xs text-amber-400">LIVE</span>}</td>
                <td>{mine ? `${mine.homeScore}-${mine.awayScore}` : "—"}<Pts v={myPts} /></td>
                <td>{theirs ? `${theirs.homeScore}-${theirs.awayScore}` : "—"}<Pts v={theirPts} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
```

- [ ] **Step 3: Verify** — `npm run build` passes.

- [ ] **Step 4: Commit** — `git commit -m "feat: head-to-head compare pages"`

---

### Task 12: Admin page

**Files:** Create `src/app/admin/page.tsx`, `src/components/AdminMatchRow.tsx`; Modify `src/app/actions.ts` (append `adminSync`, `adminUpdateResult`).

- [ ] **Step 1: Append admin actions to `src/app/actions.ts`** (add `meta` to schema imports, `syncMatches` import from `@/lib/sync`)

```ts
export async function adminSync(): Promise<void> {
  const user = await requireUser();
  if (!user.isAdmin) return;
  await syncMatches();
  revalidatePath("/", "layout");
}

export async function adminUpdateResult(matchId: number, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user.isAdmin) return { error: "Not allowed" };
  const rawHome = String(formData.get("home") ?? "").trim();
  const rawAway = String(formData.get("away") ?? "").trim();
  const status = String(formData.get("status") ?? "");
  const home = rawHome === "" ? null : Number(rawHome);
  const away = rawAway === "" ? null : Number(rawAway);
  const valid = (v: number | null) => v === null || (Number.isInteger(v) && v >= 0 && v <= 99);
  if (!valid(home) || !valid(away)) return { error: "Invalid score" };
  if (!["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "FINISHED"].includes(status)) return { error: "Invalid status" };
  await db.update(matches)
    .set({ homeScore: home, awayScore: away, status })
    .where(eq(matches.id, matchId));
  revalidatePath("/", "layout");
  return undefined;
}
```

- [ ] **Step 2: Write `src/components/AdminMatchRow.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { adminUpdateResult } from "@/app/actions";
import type { FormState } from "@/app/actions";

type Props = {
  matchId: number; label: string; kickoff: string;
  homeScore: number | null; awayScore: number | null; status: string;
};

export default function AdminMatchRow({ matchId, label, kickoff, homeScore, awayScore, status }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(adminUpdateResult.bind(null, matchId), undefined);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
      <span className="w-32 shrink-0 text-xs text-zinc-500">{kickoff}</span>
      <span className="min-w-0 flex-1">{label}</span>
      <input name="home" type="number" min={0} max={99} defaultValue={homeScore ?? ""} className="w-12 rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-center" />
      <input name="away" type="number" min={0} max={99} defaultValue={awayScore ?? ""} className="w-12 rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-center" />
      <select name="status" defaultValue={status} className="rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5">
        {["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "FINISHED"].map((s) => <option key={s}>{s}</option>)}
      </select>
      <button disabled={pending} className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-semibold hover:bg-emerald-600 disabled:opacity-50">
        {pending ? "..." : "Save"}
      </button>
      {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
    </form>
  );
}
```

- [ ] **Step 3: Write `src/app/admin/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { matches, meta } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { adminSync } from "@/app/actions";
import Nav from "@/components/Nav";
import AdminMatchRow from "@/components/AdminMatchRow";

export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires",
});

export default async function AdminPage() {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/");
  const [all, lastSync] = await Promise.all([
    db.query.matches.findMany({ orderBy: [asc(matches.kickoffUtc), asc(matches.id)] }),
    db.query.meta.findFirst({ where: eq(meta.key, "last_synced_at") }),
  ]);
  return (
    <>
      <Nav name={user.name} isAdmin />
      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">Admin</h1>
          <form action={adminSync}>
            <button className="rounded bg-sky-700 px-3 py-1 text-sm font-semibold hover:bg-sky-600">Sync now</button>
          </form>
          <span className="text-xs text-zinc-500">
            Last synced: {lastSync ? fmt.format(new Date(lastSync.value)) : "never"}
          </span>
        </div>
        <p className="text-xs text-zinc-500">Manual edits are overwritten by the next sync — use them only when the API is wrong or lagging.</p>
        <div className="space-y-1.5">
          {all.map((m) => (
            <AdminMatchRow key={m.id} matchId={m.id}
              label={`${m.homeTeam ?? "TBD"} vs ${m.awayTeam ?? "TBD"} (${m.stage})`}
              kickoff={fmt.format(m.kickoffUtc)}
              homeScore={m.homeScore} awayScore={m.awayScore} status={m.status} />
          ))}
        </div>
      </main>
    </>
  );
}
```

- [ ] **Step 4: Verify** — `npm run build` passes, `npm test` all green.

- [ ] **Step 5: Commit** — `git commit -m "feat: admin page with sync and result editing"`

---

### Task 13: Deployment config, README, end-to-end verification

**Files:** Create `vercel.json`, replace `README.md`.

- [ ] **Step 1: Write `vercel.json`**

```json
{
  "crons": [{ "path": "/api/sync", "schedule": "*/10 * * * *" }]
}
```

- [ ] **Step 2: Replace `README.md`**

```markdown
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
```

- [ ] **Step 3: Full local verification (requires `DATABASE_URL` in `.env.local`)**

Run, in order, expecting success on each:

```bash
npm test               # all unit tests pass
npm run db:push        # tables created in Neon
npm run seed           # 104 matches, 5 users + printed passwords, 10 backfill predictions
npm run build          # production build OK
npm run dev            # manual smoke test below
```

Manual smoke test: log in as rodrigo → fixture shows group stage with MEX 2-0 RSA finished and points badge (1 pt) → leaderboard shows Atu/Martin 3, Rodrigo/Pablo 1, Leo 0 → compare vs Martin shows both predictions for played matches → admin page loads, Sync now works → log in as leo in private window → cannot see Rodrigo's prediction for any future match anywhere.

- [ ] **Step 4: Commit and push**

```bash
git add -A && git commit -m "feat: vercel cron config and README"
git push
```

---

### Post-deploy checklist (Rodrigo + Claude together)

1. Rodrigo: create Neon DB in Vercel, import repo, set `DATABASE_URL`, `FOOTBALL_DATA_TOKEN`, `SESSION_SECRET`, `CRON_SECRET` env vars, deploy.
2. Rodrigo: paste `DATABASE_URL` to Claude (or run `npm run db:push && npm run seed` himself).
3. Claude: run `db:push` + `seed` against the production DB; deliver the 5 generated passwords to Rodrigo in chat.
4. Verify the deployed site: log in, check fixture/leaderboard/compare, confirm `/api/sync` cron runs (Vercel → Cron Jobs → logs).
