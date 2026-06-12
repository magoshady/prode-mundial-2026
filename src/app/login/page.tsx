"use client";

import { useActionState } from "react";
import { login } from "../actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={action} className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-700 bg-zinc-900 p-8">
        <h1 className="text-center text-2xl font-bold">⚽ Prode WC 2026</h1>
        <input
          name="username" placeholder="Username" autoComplete="username" required
          className="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2"
        />
        <input
          name="password" type="password" placeholder="Password" autoComplete="current-password" required
          className="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2"
        />
        {state?.error && <p className="text-sm text-red-400">{state.error}</p>}
        <button disabled={pending} className="w-full rounded-lg bg-emerald-600 py-2 font-semibold hover:bg-emerald-500 disabled:opacity-50">
          {pending ? "..." : "Log in"}
        </button>
      </form>
    </main>
  );
}
