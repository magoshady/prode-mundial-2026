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
