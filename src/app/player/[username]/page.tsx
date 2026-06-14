import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { matches, predictions, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isScoreable, othersVisible } from "@/lib/rules";
import { predictionPoints } from "@/lib/scoring";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", timeZone: "America/Argentina/Buenos_Aires",
});

export default async function PlayerPage({ params }: { params: Promise<{ username: string }> }) {
  const me = await requireUser();
  const { username } = await params;
  const player = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (!player) notFound();

  const now = new Date();
  const all = await db.query.matches.findMany({ orderBy: [asc(matches.kickoffUtc), asc(matches.id)] });
  // Same visibility rule as compare: predictions only show once the match kicks off.
  const visible = all.filter((m) => othersVisible(m, now));
  const preds = await db.query.predictions.findMany({ where: eq(predictions.userId, player.id) });
  const predByMatch = new Map(preds.map((p) => [p.matchId, p]));

  let total = 0, exact = 0, outcomes = 0;
  const rows = visible.map((m) => {
    const pred = predByMatch.get(m.id) ?? null;
    const pts = isScoreable(m)
      ? predictionPoints(pred ? { home: pred.homeScore, away: pred.awayScore } : null, { home: m.homeScore!, away: m.awayScore! })
      : null;
    total += pts ?? 0;
    if (pts === 3) exact++;
    if (pts === 1) outcomes++;
    return { m, pred, pts };
  });

  return (
    <>
      <Nav name={me.name} isAdmin={me.isAdmin} />
      <main className="mx-auto max-w-3xl p-4">
        <h1 className="mb-1 text-xl font-bold">{player.name}{player.id === me.id && " (you)"}</h1>
        <p className="mb-4 text-sm text-zinc-400">
          {total} pts · {exact} exact · {outcomes} outcomes · played matches only
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-left text-zinc-400">
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Match</th>
              <th className="px-2 py-2 text-center">Result</th>
              <th className="px-2 py-2 text-center">Prediction</th>
              <th className="px-2 py-2 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, pred, pts }) => (
              <tr key={m.id} className="border-b border-zinc-800">
                <td className="px-2 py-3 text-xs text-zinc-500">{fmt.format(m.kickoffUtc)}</td>
                <td className="px-2 py-3">{m.homeTeam} vs {m.awayTeam}</td>
                <td className="px-2 py-3 text-center">
                  {m.homeScore !== null ? `${m.homeScore}-${m.awayScore}` : "—"}
                  {(m.status === "IN_PLAY" || m.status === "PAUSED") && <span className="ml-1 text-xs text-amber-400">LIVE</span>}
                </td>
                <td className="px-2 py-3 text-center">{pred ? `${pred.homeScore}-${pred.awayScore}` : "—"}</td>
                <td className="px-2 py-3 text-right">
                  {pts !== null && (
                    <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${pts === 3 ? "bg-emerald-700" : pts === 1 ? "bg-amber-700" : "bg-zinc-700"}`}>
                      {pts}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="text-sm text-zinc-500">No matches have kicked off yet.</p>}
        <p className="mt-4 text-sm">
          <Link href="/leaderboard" className="inline-block text-zinc-400 transition hover:text-white active:opacity-60">← Back to leaderboard</Link>
        </p>
      </main>
    </>
  );
}
