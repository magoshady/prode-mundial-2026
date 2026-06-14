import Link from "next/link";
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
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Player</th>
              <th className="px-2 py-2 text-right">Exact (3)</th>
              <th className="px-2 py-2 text-right">Outcome (1)</th>
              <th className="px-2 py-2 text-right">Points</th>
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
                  <td className="px-2 py-3 text-right text-base font-bold">{r.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </main>
    </>
  );
}
