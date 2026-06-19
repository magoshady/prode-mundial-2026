/* Seals ONE secret double-points match from the final group round. Idempotent.
   Run once before 2026-06-24. Logs nothing identifying. */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { meta } from "../src/db/schema";
import { lastRoundCandidates, pickDoubleMatch, type DoubleCandidate } from "../src/lib/double";

async function main() {
  const existing = await db.query.meta.findFirst({ where: eq(meta.key, "double_match_id") });
  if (existing) {
    console.log("Double game already sealed. Nothing to do.");
    return;
  }

  const res = await fetch("https://api.football-data.org/v4/competitions/WC/matches", {
    headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN! },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`football-data.org responded ${res.status}`);
  const data = (await res.json()) as { matches: { id: number; stage: string; matchday: number; utcDate: string }[] };

  const candidates: DoubleCandidate[] = data.matches.map((m) => ({ id: m.id, stage: m.stage, matchday: m.matchday }));
  const lastRound = lastRoundCandidates(candidates);

  // Fairness: refuse to pick if any last-round game has already kicked off.
  const now = Date.now();
  const started = data.matches.some(
    (m) => lastRound.find((c) => c.id === m.id) && new Date(m.utcDate).getTime() <= now,
  );
  if (started) throw new Error("A last-round game has already started — cannot seal fairly.");

  const chosen = pickDoubleMatch(lastRound, Math.random);
  if (!chosen) throw new Error("No last-round candidates found.");

  await db.insert(meta).values({ key: "double_match_id", value: String(chosen.id) });
  console.log(`Double game sealed (1 of ${lastRound.length} candidates). Shhh. 🤫`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
