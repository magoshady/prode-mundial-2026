"use client";

import { useActionState } from "react";
import { adminUpdateResult } from "@/app/actions";
import type { FormState } from "@/app/actions";

type Props = {
  matchId: number; label: string; kickoff: string;
  homeScore: number | null; awayScore: number | null; status: string;
};

export default function AdminMatchRow({ matchId, label, kickoff, homeScore, awayScore, status }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(adminUpdateResult.bind(null, matchId), undefined);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
      <span className="w-32 shrink-0 text-xs text-zinc-500">{kickoff}</span>
      <span className="min-w-0 flex-1">{label}</span>
      <input name="home" type="number" min={0} max={99} defaultValue={homeScore ?? ""} className="w-12 rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-center" />
      <input name="away" type="number" min={0} max={99} defaultValue={awayScore ?? ""} className="w-12 rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-center" />
      <select name="status" defaultValue={status} className="rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5">
        {["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "FINISHED"].map((s) => <option key={s}>{s}</option>)}
      </select>
      <button disabled={pending} className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-semibold hover:bg-emerald-600 disabled:opacity-50">
        {pending ? "..." : "Save"}
      </button>
      {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
    </form>
  );
}
