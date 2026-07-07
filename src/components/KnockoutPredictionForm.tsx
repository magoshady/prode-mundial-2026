"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useActionState } from "react";
import { savePrediction, setBombita } from "@/app/actions";
import type { FormState } from "@/app/actions";
import { argentinaRoast, knockoutOutcomeHint } from "@/lib/knockout";

type Props = {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  stage: string;
  home: number | null;
  away: number | null;
  etHome: number | null;
  etAway: number | null;
  penAdvance: "HOME" | "AWAY" | null;
  showBombita?: boolean;
  bombitaChecked?: boolean;
  bombitaDisabled?: boolean;
};

export default function KnockoutPredictionForm(p: Props) {
  const action = savePrediction.bind(null, p.matchId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, undefined);

  const [h, setH] = useState(p.home?.toString() ?? "");
  const [a, setA] = useState(p.away?.toString() ?? "");
  const [eh, setEh] = useState(p.etHome?.toString() ?? "");
  const [ea, setEa] = useState(p.etAway?.toString() ?? "");
  const [pen, setPen] = useState<"HOME" | "AWAY" | "">(p.penAdvance ?? "");

  // 💣 is an instant toggle backed by its own server action, not the forecast Save. The
  // checked state is the single server-side truth (p.bombitaChecked); useOptimistic shows
  // the click immediately, then reconciles to the server after the action revalidates. So
  // selecting a new match re-renders the old card with bombitaChecked=false and it un-ticks —
  // only one 💣 can ever be selected.
  const [bombita, setOptimisticBombita] = useOptimistic(!!p.bombitaChecked);
  const [bombitaPending, startBombita] = useTransition();
  const toggleBombita = (want: boolean) => {
    startBombita(async () => {
      setOptimisticBombita(want);
      await setBombita(p.matchId, want);
    });
  };

  const drawAt90 = h !== "" && a !== "" && h === a;
  const drawAtET = drawAt90 && eh !== "" && ea !== "" && eh === ea;

  const num = (v: string) => (v === "" ? null : Number(v));
  const hint = knockoutOutcomeHint({
    home: num(h),
    away: num(a),
    etHome: num(eh),
    etAway: num(ea),
    penAdvance: pen === "" ? null : pen,
    homeTeam: p.homeTeam,
    awayTeam: p.awayTeam,
  });
  const roast = argentinaRoast({
    home: num(h),
    away: num(a),
    etHome: num(eh),
    etAway: num(ea),
    penAdvance: pen === "" ? null : pen,
    homeTeam: p.homeTeam,
    awayTeam: p.awayTeam,
    stage: p.stage,
  });

  const numInput = "w-12 rounded border border-zinc-600 bg-zinc-800 px-1 py-0.5 text-center";

  return (
    <div className="flex flex-col gap-1.5">
    <form action={formAction} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <input name="home" type="number" min={0} max={99} required value={h} onChange={(e) => setH(e.target.value)} className={numInput} />
        <span className="text-zinc-500">-</span>
        <input name="away" type="number" min={0} max={99} required value={a} onChange={(e) => setA(e.target.value)} className={numInput} />
        <span className="text-xs text-zinc-500">90&apos;</span>
        <button disabled={pending} className="ml-1 rounded bg-emerald-700 px-2 py-0.5 text-xs font-semibold transition hover:bg-emerald-600 active:scale-95 disabled:opacity-50">
          {pending ? "..." : p.home !== null ? "Update" : "Save"}
        </button>
      </div>

      {drawAt90 && (
        <div className="flex items-center gap-1.5">
          <input name="etHome" type="number" min={0} max={99} required value={eh} onChange={(e) => setEh(e.target.value)} className={numInput} />
          <span className="text-zinc-500">-</span>
          <input name="etAway" type="number" min={0} max={99} required value={ea} onChange={(e) => setEa(e.target.value)} className={numInput} />
          <span className="text-xs text-zinc-500">after extra time</span>
        </div>
      )}

      {drawAtET && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-zinc-500">Penalties — who advances?</span>
          <label className="flex items-center gap-1">
            <input type="radio" name="penAdvance" value="HOME" required checked={pen === "HOME"} onChange={() => setPen("HOME")} />
            {p.homeTeam}
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="penAdvance" value="AWAY" required checked={pen === "AWAY"} onChange={() => setPen("AWAY")} />
            {p.awayTeam}
          </label>
        </div>
      )}

      {hint && (
        <span className={`text-xs ${hint.tone === "warn" ? "text-amber-400" : "text-zinc-400"}`}>
          {hint.text}
        </span>
      )}

      {roast && (
        <span className="text-sm font-bold uppercase text-red-500">{roast}</span>
      )}

      {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
    </form>

      {p.showBombita && (
        <label className={`flex items-center gap-1.5 text-xs ${p.bombitaDisabled ? "opacity-50" : "cursor-pointer"}`}>
          <input
            type="checkbox" checked={bombita} disabled={p.bombitaDisabled || bombitaPending}
            onChange={(e) => toggleBombita(e.target.checked)}
          />
          <span className="font-semibold">💣 Bombita</span>
          <span className="text-zinc-500">— doble o nada en los 90&apos;</span>
        </label>
      )}
    </div>
  );
}
