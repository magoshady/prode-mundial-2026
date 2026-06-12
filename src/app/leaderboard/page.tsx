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
