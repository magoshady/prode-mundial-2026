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
