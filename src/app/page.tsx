import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { matches, meta } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isOpenForPrediction, isScoreable, othersVisible } from "@/lib/rules";
import { predictionPoints } from "@/lib/scoring";
import { knockoutPoints, knockoutPredictionDetail, knockoutScoreLabel, toKnockoutPrediction, toKnockoutResult } from "@/lib/knockout";
import { isDoubleRevealed } from "@/lib/double";
import Nav from "@/components/Nav";
import MatchRow, { type OtherPred } from "@/components/MatchRow";

export const dynamic = "force-dynamic";

const STAGE_ORDER = ["GROUP_STAGE", "LAST_32", "LAST_16", "QUARTER_FINALS", "SEMI_FINALS", "THIRD_PLACE", "FINAL"];
const STAGE_LABEL: Record<string, string> = {
  GROUP_STAGE: "Group Stage", LAST_32: "Round of 32", LAST_16: "Round of 16",
  QUARTER_FINALS: "Quarter-finals", SEMI_FINALS: "Semi-finals", THIRD_PLACE: "Third Place", FINAL: "Final",
};
const fmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires",
});

// Matches whose kickoff is more than this many hours in the past are tucked
// into a collapsed "Past matches" dropdown so the live/upcoming games stay on top.
const PAST_THRESHOLD_MS = 30 * 60 * 60 * 1000;

export default async function FixturePage() {
  const user = await requireUser();
  const now = new Date();
  const [all, allUsers, allPreds, doubleRow] = await Promise.all([
    db.query.matches.findMany({ orderBy: [asc(matches.kickoffUtc), asc(matches.id)] }),
    db.query.users.findMany(),
    db.query.predictions.findMany(),
    db.query.meta.findFirst({ where: eq(meta.key, "double_match_id") }),
  ]);
  const doubleMatchId = doubleRow?.value ? Number(doubleRow.value) : null;

  const myPreds = allPreds.filter((p) => p.userId === user.id);
  const predByMatch = new Map(myPreds.map((p) => [p.matchId, p]));
  const predsByMatch = new Map<number, typeof allPreds>();
  for (const p of allPreds) {
    const arr = predsByMatch.get(p.matchId) ?? [];
    arr.push(p);
    predsByMatch.set(p.matchId, arr);
  }

  type Match = (typeof all)[number];
  const isPast = (m: Match) => now.getTime() - m.kickoffUtc.getTime() > PAST_THRESHOLD_MS;
  const past = all.filter(isPast);
  const current = all.filter((m) => !isPast(m));

  const groupByStage = (items: Match[]) =>
    STAGE_ORDER.map((s) => ({ stage: s, items: items.filter((m) => m.stage === s) }))
      .filter((g) => g.items.length > 0);

  const renderMatch = (m: Match) => {
    const pred = predByMatch.get(m.id) ?? null;
    const open = isOpenForPrediction(m, now);
    const scoreable = isScoreable(m);
    const result = scoreable ? { home: m.homeScore!, away: m.awayScore! } : null;

    const knockout = m.stage !== "GROUP_STAGE";
    const koResult = knockout
      ? toKnockoutResult({ regHome: m.regularTimeHome, regAway: m.regularTimeAway, etHome: m.extraTimeHome, etAway: m.extraTimeAway, duration: m.duration, winner: m.winner })
      : null;

    const koPts = (row: { homeScore: number; awayScore: number; etHomeScore: number | null; etAwayScore: number | null; penAdvance: string | null } | null) =>
      koResult ? knockoutPoints(row ? toKnockoutPrediction(row) : null, koResult).total : null;

    const finalScoreLabel = knockout && m.status === "FINISHED"
      ? knockoutScoreLabel({ regHome: m.regularTimeHome, regAway: m.regularTimeAway, etHome: m.extraTimeHome, etAway: m.extraTimeAway, penHome: m.penaltiesHome, penAway: m.penaltiesAway, duration: m.duration })
      : null;

    const myPts = knockout
      ? koPts(pred)
      : result
        ? predictionPoints(pred ? { home: pred.homeScore, away: pred.awayScore } : null, result)
        : null;

    // Everyone's picks are revealed once the match kicks off.
    let others: OtherPred[] | null = null;
    if (othersVisible(m, now)) {
      const matchPreds = predsByMatch.get(m.id) ?? [];
      others = allUsers.map((u) => {
        const p = matchPreds.find((x) => x.userId === u.id) ?? null;
        return {
          name: u.name,
          isMe: u.id === user.id,
          home: p?.homeScore ?? null,
          away: p?.awayScore ?? null,
          pts: knockout
            ? koPts(p ?? null)
            : result ? predictionPoints(p ? { home: p.homeScore, away: p.awayScore } : null, result) : null,
          detail: knockout && p
            ? knockoutPredictionDetail(p, m.homeTeam ?? "Home", m.awayTeam ?? "Away")
            : null,
        };
      });
      others.sort((a, b) => (b.pts ?? -1) - (a.pts ?? -1) || a.name.localeCompare(b.name));
    }

    return (
      <MatchRow
        key={m.id}
        matchId={m.id}
        dateLabel={fmt.format(m.kickoffUtc)}
        groupLabel={m.groupName ? m.groupName.replace("_", " ") : null}
        homeTeam={m.homeTeam ?? "TBD"}
        awayTeam={m.awayTeam ?? "TBD"}
        status={m.status}
        homeScore={m.homeScore}
        awayScore={m.awayScore}
        open={open}
        scoreable={scoreable}
        mine={pred ? { home: pred.homeScore, away: pred.awayScore } : null}
        myPts={myPts}
        others={others}
        double={isDoubleRevealed(m.id, doubleMatchId, m.status)}
        knockout={knockout}
        stage={m.stage}
        finalScoreLabel={finalScoreLabel}
        mineEtHome={pred?.etHomeScore ?? null}
        mineEtAway={pred?.etAwayScore ?? null}
        minePenAdvance={(pred?.penAdvance as "HOME" | "AWAY" | null) ?? null}
      />
    );
  };

  const renderStages = (items: Match[]) =>
    groupByStage(items).map(({ stage, items }) => (
      <section key={stage}>
        <h2 className="mb-3 text-lg font-bold">{STAGE_LABEL[stage] ?? stage}</h2>
        <div className="space-y-1.5">{items.map(renderMatch)}</div>
      </section>
    ));

  return (
    <>
      <Nav name={user.name} isAdmin={user.isAdmin} />
      <main className="mx-auto max-w-4xl space-y-8 p-4">
        {past.length > 0 && (
          <details className="rounded-lg border border-black/10 dark:border-white/15">
            <summary className="cursor-pointer list-none px-4 py-3 text-lg font-bold [&::-webkit-details-marker]:hidden">
              <span className="mr-1 inline-block transition-transform [details[open]_&]:rotate-90">›</span>
              Past matches ({past.length})
            </summary>
            <div className="space-y-8 px-4 pb-4">{renderStages(past)}</div>
          </details>
        )}
        {renderStages(current)}
      </main>
    </>
  );
}
