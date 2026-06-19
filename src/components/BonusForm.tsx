"use client";

import { useActionState } from "react";
import { saveBonusPicks, type FormState } from "@/app/actions";

type Props = {
  teams: string[];
  underdogs: readonly string[];
  goldenBootCandidates: string[];
  current: { champion: string | null; goldenBoot: string | null; darkHorse: string | null };
  lock: { champion: boolean; goldenBoot: boolean; darkHorse: boolean };
};

function Select({ name, label, options, value, locked }: {
  name: string; label: string; options: readonly string[]; value: string | null; locked: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      {locked ? (
        <span className="rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-zinc-300">
          {value ?? "—"} <span className="text-xs text-zinc-500">🔒 fijo</span>
        </span>
      ) : (
        <select name={name} defaultValue={value ?? ""} className="rounded border border-zinc-700 bg-zinc-900 px-3 py-2">
          <option value="">— elegir —</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
    </label>
  );
}

export default function BonusForm({ teams, underdogs, goldenBootCandidates, current, lock }: Props) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveBonusPicks, undefined);
  const allLocked = lock.champion && lock.goldenBoot && lock.darkHorse;
  return (
    <form action={action} className="space-y-4">
      <Select name="champion" label="🏆 Campeón (+5)" options={teams} value={current.champion} locked={lock.champion} />
      <Select name="goldenBoot" label="👟 Botín de Oro (+3)" options={goldenBootCandidates} value={current.goldenBoot} locked={lock.goldenBoot} />
      <Select name="darkHorse" label="🐴 Tapado (hasta +25)" options={underdogs} value={current.darkHorse} locked={lock.darkHorse} />
      {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
      {!allLocked ? (
        <button disabled={pending} className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50">
          {pending ? "Guardando…" : "Guardar"}
        </button>
      ) : (
        <p className="text-xs text-zinc-500">Tus 3 elecciones quedaron fijas. No se pueden cambiar.</p>
      )}
    </form>
  );
}
