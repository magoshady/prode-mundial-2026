"use client";

import { useState } from "react";
import PredictionForm from "@/components/PredictionForm";
import KnockoutPredictionForm from "@/components/KnockoutPredictionForm";

export type OtherPred = {
  name: string;
  isMe: boolean;
  home: number | null;
  away: number | null;
  pts: number | null;
  /** Knockout ET/penalty plan, e.g. "1-1 a.e.t., Morocco on pens"; null when none. */
  detail?: string | null;
};

type Props = {
  matchId: number;
  dateLabel: string;
  groupLabel: string | null;
  homeTeam: string;
  awayTeam: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  open: boolean;
  scoreable: boolean;
  mine: { home: number; away: number } | null;
  myPts: number | null;
  /** Everyone's predictions, or null while still hidden (before kickoff). */
  others: OtherPred[] | null;
  /** Revealed only after the secret double-points match has finished. */
  double?: boolean;
  /** True for knockout-stage matches: use the progressive form and the multi-layer badge. */
  knockout?: boolean;
  /** Match stage, e.g. "LAST_32"; used for the Argentina roast easter egg. */
  stage?: string;
  /** Knockout prefill for the form. */
  mineEtHome?: number | null;
  mineEtAway?: number | null;
  minePenAdvance?: "HOME" | "AWAY" | null;
  /** Pre-formatted final score for knockouts, e.g. "1-1 (2-2 a.e.t., 4-3 pen.)". */
  finalScoreLabel?: string | null;
};

function Badge({ v }: { v: number }) {
  const tone = v === 0 ? "bg-zinc-700" : v <= 2 ? "bg-amber-700" : "bg-emerald-700";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${tone}`}>{v} pts</span>;
}

export default function MatchRow({
  matchId, dateLabel, groupLabel, homeTeam, awayTeam, status, homeScore, awayScore,
  open, scoreable, mine, myPts, others, double,
  knockout, stage, mineEtHome, mineEtAway, minePenAdvance, finalScoreLabel,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = others !== null && others.length > 0;
  const live = status === "IN_PLAY" || status === "PAUSED";

  const matchInfo = (
    <>
      <span className="w-28 shrink-0 text-xs text-zinc-500">
        {dateLabel}
        {groupLabel && <span className="block">{groupLabel}</span>}
      </span>
      <span className="min-w-0 flex-1">
        {homeTeam} <span className="text-zinc-500">vs</span> {awayTeam}
        {double && (
          <span className="ml-2 rounded bg-fuchsia-700 px-1.5 py-0.5 text-xs font-bold">⭐ DOBLE</span>
        )}
        {live ? (
          <span className="ml-2 font-bold text-amber-400">{homeScore}-{awayScore} LIVE</span>
        ) : status === "FINISHED" ? (
          <span className="ml-2 font-bold">{finalScoreLabel ?? `${homeScore}-${awayScore}`}</span>
        ) : null}
      </span>
    </>
  );

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 text-sm">
      {open ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
          {matchInfo}
          {knockout ? (
            <KnockoutPredictionForm
              matchId={matchId} homeTeam={homeTeam} awayTeam={awayTeam} stage={stage ?? ""}
              home={mine?.home ?? null} away={mine?.away ?? null}
              etHome={mineEtHome ?? null} etAway={mineEtAway ?? null} penAdvance={minePenAdvance ?? null}
            />
          ) : (
            <PredictionForm matchId={matchId} home={mine?.home ?? null} away={mine?.away ?? null} />
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => canExpand && setExpanded((v) => !v)}
          aria-expanded={canExpand ? expanded : undefined}
          disabled={!canExpand}
          className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-left transition-colors enabled:cursor-pointer enabled:hover:bg-zinc-800/50 enabled:active:bg-zinc-800"
        >
          {matchInfo}
          <span className="flex items-center gap-2">
            <span className="text-zinc-400">
              {mine ? `You: ${mine.home}-${mine.away}` : "No prediction"}
            </span>
            {myPts !== null && <Badge v={myPts} />}
            {!scoreable && <span className="text-xs text-zinc-600">🔒</span>}
            {canExpand && (
              <svg
                viewBox="0 0 20 20" fill="currentColor" aria-hidden
                className={`h-4 w-4 text-zinc-500 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
              >
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
              </svg>
            )}
          </span>
        </button>
      )}

      {expanded && others && (
        <div className="border-t border-zinc-800 bg-zinc-950/40 px-3 py-2">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Everyone&apos;s picks
          </p>
          <ul className="space-y-1">
            {others.map((o) => (
              <li key={o.name}>
                <div className="flex items-center gap-2">
                  <span className={`min-w-0 flex-1 truncate ${o.isMe ? "font-semibold text-zinc-200" : "text-zinc-400"}`}>
                    {o.name}{o.isMe && " (you)"}
                  </span>
                  <span className="tabular-nums text-zinc-300">
                    {o.home !== null ? `${o.home}-${o.away}` : "—"}
                  </span>
                  {o.pts !== null && <Badge v={o.pts} />}
                </div>
                {o.detail && (
                  <p className="pl-3 text-xs text-zinc-500">↳ {o.detail}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
