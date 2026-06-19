import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { meta } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { computeStandings } from "@/lib/standings";
import { PER_MATCH_BONUS_FROM } from "@/lib/bonus";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const user = await requireUser();
  const [allUsers, allMatches, allPreds, picks, metaRows] = await Promise.all([
    db.query.users.findMany(),
    db.query.matches.findMany(),
    db.query.predictions.findMany(),
    db.query.bonusPicks.findMany(),
    db.query.meta.findMany({ where: inArray(meta.key, ["champion_team", "golden_boot_winner", "double_match_id"]) }),
  ]);
  const metaMap = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
  const rows = computeStandings(allUsers, allMatches, allPreds, {
    picks,
    championTeam: metaMap["champion_team"] ?? null,
    goldenBootWinner: metaMap["golden_boot_winner"] ?? null,
    doubleMatchId: metaMap["double_match_id"] ? Number(metaMap["double_match_id"]) : null,
    perMatchBonusFrom: PER_MATCH_BONUS_FROM,
  });

  return (
    <>
      <Nav name={user.name} isAdmin={user.isAdmin} />
      <main className="mx-auto max-w-2xl p-4">
        <h1 className="mb-1 text-xl font-bold">Leaderboard</h1>
        <p className="mb-4 text-xs text-zinc-500">Goal Acc. = total goals off from the real scores (lower is better).</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-left text-zinc-400">
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Player</th>
              <th className="px-2 py-2 text-right">Exact (3)</th>
              <th className="px-2 py-2 text-right">Outcome (1)</th>
              <th className="px-2 py-2 text-right">Bonus</th>
              <th className="px-2 py-2 text-right">Points</th>
              <th className="px-2 py-2 text-right">Goal Acc.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const lastRank = rows[rows.length - 1].rank;
              const badge = r.rank === 1 ? "🏆" : r.rank === lastRank ? "😢" : r.rank;
              return (
                <tr key={r.userId} className={`border-b border-zinc-800 ${r.userId === user.id ? "bg-zinc-900 font-semibold" : ""}`}>
                  <td className="px-2 py-3 text-center">{badge}</td>
                  <td className="px-2 py-3">
                    <Link href={`/player/${r.username}`} className="inline-block transition hover:underline active:opacity-60">{r.name}</Link>
                  </td>
                  <td className="px-2 py-3 text-right">{r.exact}</td>
                  <td className="px-2 py-3 text-right">{r.outcomes}</td>
                  <td className="px-2 py-3 text-right text-zinc-400">{r.bonus.total || "—"}</td>
                  <td className="px-2 py-3 text-right text-base font-bold">{r.points}</td>
                  <td className="px-2 py-3 text-right text-zinc-400">{r.goalsOff}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </main>
    </>
  );
}
