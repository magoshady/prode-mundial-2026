import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { matches, meta, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isScoreable, othersVisible } from "@/lib/rules";
import { goalsOff, predictionPoints } from "@/lib/scoring";
import { knockoutPoints, toKnockoutPrediction, toKnockoutResult } from "@/lib/knockout";
import { computeStandings } from "@/lib/standings";
import { PER_MATCH_BONUS_FROM } from "@/lib/bonus";
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
  const [all, allUsers, allPreds, picks, metaRows] = await Promise.all([
    db.query.matches.findMany({ orderBy: [asc(matches.kickoffUtc), asc(matches.id)] }),
    db.query.users.findMany(),
    db.query.predictions.findMany(),
    db.query.bonusPicks.findMany(),
    db.query.meta.findMany({ where: inArray(meta.key, ["champion_team", "golden_boot_winner", "double_match_id"]) }),
  ]);
  const metaMap = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
  // Headline total comes from the same standings the leaderboard uses, so they reconcile.
  const standing = computeStandings(allUsers, all, allPreds, {
    picks,
    championTeam: metaMap["champion_team"] ?? null,
    goldenBootWinner: metaMap["golden_boot_winner"] ?? null,
    doubleMatchId: metaMap["double_match_id"] ? Number(metaMap["double_match_id"]) : null,
    perMatchBonusFrom: PER_MATCH_BONUS_FROM,
  }).find((r) => r.userId === player.id);
  const total = standing?.points ?? 0;
  const exact = standing?.exact ?? 0;
  const outcomes = standing?.outcomes ?? 0;
  const offTotal = standing?.goalsOff ?? 0;
  const bonusTotal = standing?.bonus.total ?? 0;

  // Same visibility rule as compare: predictions only show once the match kicks off.
  const visible = all.filter((m) => othersVisible(m, now));
  const predByMatch = new Map(allPreds.filter((p) => p.userId === player.id).map((p) => [p.matchId, p]));

  const matchRows = visible.map((m) => {
    const pred = predByMatch.get(m.id) ?? null;
    const scoreable = isScoreable(m);

    if (m.stage !== "GROUP_STAGE") {
      const koResult = toKnockoutResult({ regHome: m.regularTimeHome, regAway: m.regularTimeAway, etHome: m.extraTimeHome, etAway: m.extraTimeAway, duration: m.duration, winner: m.winner });
      const koPred = pred ? toKnockoutPrediction({ homeScore: pred.homeScore, awayScore: pred.awayScore, etHomeScore: pred.etHomeScore, etAwayScore: pred.etAwayScore, penAdvance: pred.penAdvance }) : null;
      const pts = koResult ? knockoutPoints(koPred, koResult).total : null;
      const predLabel = pred
        ? `${pred.homeScore}-${pred.awayScore}${pred.etHomeScore !== null ? ` (${pred.etHomeScore}-${pred.etAwayScore} aet${pred.penAdvance ? `, pen ${pred.penAdvance === "HOME" ? m.homeTeam : m.awayTeam}` : ""})` : ""}`
        : null;
      const resultLabel = koResult
        ? `${koResult.reg.home}-${koResult.reg.away}${koResult.etAgg ? ` (${koResult.etAgg.home}-${koResult.etAgg.away} aet)` : ""}`
        : (m.regularTimeHome !== null ? `${m.regularTimeHome}-${m.regularTimeAway}` : "—");
      return { m, predLabel, resultLabel, pts, off: null as number | null };
    }

    const predPair = pred ? { home: pred.homeScore, away: pred.awayScore } : null;
    const result = { home: m.homeScore!, away: m.awayScore! };
    const pts = scoreable ? predictionPoints(predPair, result) : null;
    const off = scoreable ? goalsOff(predPair, result) : null;
    const predLabel = pred ? `${pred.homeScore}-${pred.awayScore}` : null;
    const resultLabel = m.homeScore !== null ? `${m.homeScore}-${m.awayScore}` : "—";
    return { m, predLabel, resultLabel, pts, off };
  });

  return (
    <>
      <Nav name={me.name} isAdmin={me.isAdmin} />
      <main className="mx-auto max-w-3xl p-4">
        <h1 className="mb-1 text-xl font-bold">{player.name}{player.id === me.id && " (you)"}</h1>
        <p className="mb-4 text-sm text-zinc-400">
          {total} pts · {exact} exact · {outcomes} outcomes · {bonusTotal} bonus · {offTotal} goals off
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-700 text-left text-zinc-400">
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Match</th>
              <th className="px-2 py-2 text-center">Result</th>
              <th className="px-2 py-2 text-center">Prediction</th>
              <th className="px-2 py-2 text-right">Pts</th>
              <th className="px-2 py-2 text-right">Off</th>
            </tr>
          </thead>
          <tbody>
            {matchRows.map(({ m, predLabel, resultLabel, pts, off }) => (
              <tr key={m.id} className="border-b border-zinc-800">
                <td className="px-2 py-3 text-xs text-zinc-500">{fmt.format(m.kickoffUtc)}</td>
                <td className="px-2 py-3">{m.homeTeam} vs {m.awayTeam}</td>
                <td className="px-2 py-3 text-center">
                  {resultLabel}
                  {(m.status === "IN_PLAY" || m.status === "PAUSED") && <span className="ml-1 text-xs text-amber-400">LIVE</span>}
                </td>
                <td className="px-2 py-3 text-center">{predLabel ?? "—"}</td>
                <td className="px-2 py-3 text-right">
                  {pts !== null && (
                    <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${pts === 0 ? "bg-zinc-700" : pts <= 2 ? "bg-amber-700" : "bg-emerald-700"}`}>
                      {pts}
                    </span>
                  )}
                </td>
                <td className="px-2 py-3 text-right text-zinc-400">{off !== null ? off : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {matchRows.length === 0 && <p className="text-sm text-zinc-500">No matches have kicked off yet.</p>}
        <p className="mt-4 text-sm">
          <Link href="/leaderboard" className="inline-block text-zinc-400 transition hover:text-white active:opacity-60">← Back to leaderboard</Link>
        </p>
      </main>
    </>
  );
}
