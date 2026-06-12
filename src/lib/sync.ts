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
