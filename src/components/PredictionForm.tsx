"use client";

import { useActionState } from "react";
import { savePrediction } from "@/app/actions";
import type { FormState } from "@/app/actions";

export default function PredictionForm({
  matchId, home, away,
}: { matchId: number; home: number | null; away: number | null }) {
  const action = savePrediction.bind(null, matchId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, undefined);
  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input name="home" type="number" min={0} max={99} required defaultValue={home ?? ""}
        className="w-12 rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-center" />
      <span className="text-zinc-500">-</span>
      <input name="away" type="number" min={0} max={99} required defaultValue={away ?? ""}
        className="w-12 rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-center" />
      <button disabled={pending}
        className="rounded bg-emerald-700 px-2 py-0.5 text-xs font-semibold transition hover:bg-emerald-600 active:scale-95 disabled:opacity-50">
        {pending ? "..." : home !== null ? "Update" : "Save"}
      </button>
      {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
    </form>
  );
}
