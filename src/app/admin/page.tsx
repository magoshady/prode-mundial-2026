import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { matches, meta } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { adminSync } from "@/app/actions";
import Nav from "@/components/Nav";
import AdminMatchRow from "@/components/AdminMatchRow";

export const dynamic = "force-dynamic";

const fmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires",
});

export default async function AdminPage() {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/");
  const [all, lastSync] = await Promise.all([
    db.query.matches.findMany({ orderBy: [asc(matches.kickoffUtc), asc(matches.id)] }),
    db.query.meta.findFirst({ where: eq(meta.key, "last_synced_at") }),
  ]);
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
