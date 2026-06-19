import { redirect } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { matches, meta } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { adminSetBonusResults, adminSync } from "@/app/actions";
import { GOLDEN_BOOT_CANDIDATES } from "@/lib/bonus";
import Nav from "@/components/Nav";
import AdminMatchRow from "@/components/AdminMatchRow";

export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires",
});

export default async function AdminPage() {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/");
  const [all, lastSync, resultRows] = await Promise.all([
    db.query.matches.findMany({ orderBy: [asc(matches.kickoffUtc), asc(matches.id)] }),
    db.query.meta.findFirst({ where: eq(meta.key, "last_synced_at") }),
    db.query.meta.findMany({ where: inArray(meta.key, ["champion_team", "golden_boot_winner"]) }),
  ]);
  const metaMap = Object.fromEntries(resultRows.map((r) => [r.key, r.value]));
  const teams = [...new Set(all.flatMap((m) => [m.homeTeam, m.awayTeam].filter(Boolean) as string[]))].sort();
  return (
    <>
      <Nav name={user.name} isAdmin />
      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">Admin</h1>
          <form action={adminSync}>
            <button className="rounded bg-sky-700 px-3 py-1 text-sm font-semibold hover:bg-sky-600">Sync now</button>
          </form>
          <span className="text-xs text-zinc-500">
            Last synced: {lastSync ? fmt.format(new Date(lastSync.value)) : "never"}
          </span>
        </div>
        <p className="text-xs text-zinc-500">Manual edits are overwritten by the next sync — use them only when the API is wrong or lagging.</p>

        <form action={adminSetBonusResults} className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Champion (team)</span>
            <select name="championTeam" defaultValue={metaMap["champion_team"] ?? ""} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1">
              <option value="">— none —</option>
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Golden Boot (player)</span>
            <select name="goldenBootWinner" defaultValue={metaMap["golden_boot_winner"] ?? ""} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1">
              <option value="">— none —</option>
              {GOLDEN_BOOT_CANDIDATES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <button className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-600">Save results</button>
        </form>

        <div className="space-y-1.5">
          {all.map((m) => (
            <AdminMatchRow key={m.id} matchId={m.id}
              label={`${m.homeTeam ?? "TBD"} vs ${m.awayTeam ?? "TBD"} (${m.stage})`}
              kickoff={fmt.format(m.kickoffUtc)}
              homeScore={m.homeScore} awayScore={m.awayScore} status={m.status} />
          ))}
        </div>
      </main>
    </>
  );
}
