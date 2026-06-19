import { notFound } from "next/navigation";
import { asc, eq, or } from "drizzle-orm";
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

  const rows = visible.map((m) => {
    const mine = find(me.id, m.id);
    const theirs = find(them.id, m.id);
    const scoreable = isScoreable(m);
    const result = scoreable ? { home: m.homeScore!, away: m.awayScore! } : null;
    const myPts = result ? predictionPoints(mine ? { home: mine.homeScore, away: mine.awayScore } : null, result) : null;
    const theirPts = result ? predictionPoints(theirs ? { home: theirs.homeScore, away: theirs.awayScore } : null, result) : null;
    return { m, mine, theirs, myPts, theirPts };
  });
  const myTotal = rows.reduce((s, r) => s + (r.myPts ?? 0), 0);
  const theirTotal = rows.reduce((s, r) => s + (r.theirPts ?? 0), 0);

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
