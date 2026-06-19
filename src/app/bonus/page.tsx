import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { meta } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { computeStandings } from "@/lib/standings";
import { allPicksSubmitted, GOLDEN_BOOT_CANDIDATES, isFieldLocked, PER_MATCH_BONUS_FROM, picksDeadlinePassed, UNDERDOG_TEAMS } from "@/lib/bonus";
import Nav from "@/components/Nav";
import BonusForm from "@/components/BonusForm";

export const dynamic = "force-dynamic";

export default async function BonusPage() {
  const user = await requireUser();
  const [allUsers, allMatches, allPreds, picks, metaRows] = await Promise.all([
    db.query.users.findMany(),
    db.query.matches.findMany(),
    db.query.predictions.findMany(),
    db.query.bonusPicks.findMany(),
    db.query.meta.findMany({ where: inArray(meta.key, ["champion_team", "golden_boot_winner", "double_match_id", "bonus_picks_deadline"]) }),
  ]);

  const metaMap = Object.fromEntries(metaRows.map((r) => [r.key, r.value]));
  const now = new Date();
  const deadline = metaMap["bonus_picks_deadline"] ? new Date(metaMap["bonus_picks_deadline"]) : null;
  const deadlinePassed = picksDeadlinePassed(deadline, now);
  const teams = [...new Set(allMatches.flatMap((m) => [m.homeTeam, m.awayTeam].filter(Boolean) as string[]))].sort();
  const mine = picks.find((p) => p.userId === user.id) ?? null;
  const lock = {
    champion: isFieldLocked(mine?.championTeam ?? null, deadline, now),
    goldenBoot: isFieldLocked(mine?.goldenBootPlayer ?? null, deadline, now),
    darkHorse: isFieldLocked(mine?.darkHorseTeam ?? null, deadline, now),
  };
  const deadlineLabel = deadline
    ? new Intl.DateTimeFormat("es-AR", {
        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
        timeZone: "America/Argentina/Buenos_Aires",
      }).format(deadline)
    : null;

  // Reveal everyone's picks only once all have submitted (or the window closed) — no copying.
  const reveal = allPicksSubmitted(allUsers.map((u) => u.id), picks) || deadlinePassed;
  const picksByUser = new Map(picks.map((p) => [p.userId, p]));
  const revealRows = allUsers
    .map((u) => ({ name: u.name, p: picksByUser.get(u.id) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const rows = computeStandings(allUsers, allMatches, allPreds, {
    picks,
    championTeam: metaMap["champion_team"] ?? null,
    goldenBootWinner: metaMap["golden_boot_winner"] ?? null,
    doubleMatchId: metaMap["double_match_id"] ? Number(metaMap["double_match_id"]) : null,
    perMatchBonusFrom: PER_MATCH_BONUS_FROM,
  });
  const myRow = rows.find((r) => r.userId === user.id);

  return (
    <>
      <Nav name={user.name} isAdmin={user.isAdmin} />
      <main className="mx-auto max-w-2xl space-y-6 p-4">
        <h1 className="text-xl font-bold">Bonus</h1>

        {deadlineLabel && (
          <p className={`text-sm ${deadlinePassed ? "text-red-400" : "text-amber-400"}`}>
            {deadlinePassed
              ? "⛔ Se cerró la ventana para elegir Campeón / Botín / Tapado."
              : `⏳ Tenés hasta el ${deadlineLabel} para elegir. Cada elección queda fija al guardarla.`}
          </p>
        )}

        <BonusForm
          teams={teams}
          underdogs={UNDERDOG_TEAMS}
          goldenBootCandidates={GOLDEN_BOOT_CANDIDATES}
          current={{ champion: mine?.championTeam ?? null, goldenBoot: mine?.goldenBootPlayer ?? null, darkHorse: mine?.darkHorseTeam ?? null }}
          lock={lock}
        />

        {myRow && (
          <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm">
            <h2 className="mb-2 font-bold">Tus puntos bonus</h2>
            <ul className="space-y-1 text-zinc-300">
              <li>Valla invicta + Cojones (por partido): <b>{myRow.bonus.perMatch}</b></li>
              <li>Campeón: <b>{myRow.bonus.champion}</b></li>
              <li>Botín de Oro: <b>{myRow.bonus.goldenBoot}</b></li>
              <li>Tapado: <b>{myRow.bonus.darkHorse}</b></li>
              <li className="border-t border-zinc-800 pt-1">Total bonus: <b>{myRow.bonus.total}</b></li>
            </ul>
          </section>
        )}

        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm">
          <h2 className="mb-2 font-bold">Las elecciones de todos</h2>
          {reveal ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-zinc-700 text-zinc-400">
                    <th className="py-2 pr-3">Jugador</th>
                    <th className="py-2 pr-3">🏆 Campeón</th>
                    <th className="py-2 pr-3">👟 Botín</th>
                    <th className="py-2">🐴 Tapado</th>
                  </tr>
                </thead>
                <tbody>
                  {revealRows.map(({ name, p }) => (
                    <tr key={name} className={`border-b border-zinc-800 ${name === user.name ? "font-semibold text-zinc-100" : "text-zinc-300"}`}>
                      <td className="py-2 pr-3">{name}{name === user.name && " (vos)"}</td>
                      <td className="py-2 pr-3">{p?.championTeam ?? "—"}</td>
                      <td className="py-2 pr-3">{p?.goldenBootPlayer ?? "—"}</td>
                      <td className="py-2">{p?.darkHorseTeam ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-zinc-500">🔒 Se revelan cuando todos hayan elegido sus 3 (o cierre la ventana de 24h). Sin espiar.</p>
          )}
        </section>

        <section className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
          <h2 className="mb-2 font-bold">Cómo se puntúa</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li><b>🧤 Valla invicta:</b> +1 por cada arco en cero acertado (0-0 acertado = +2).</li>
            <li><b>😤 Cojones:</b> solo si clavás el resultado exacto — 0-3 goles +0, 4-6 +1, 7+ +2.</li>
            <li><b>🏆 Campeón:</b> +5 si acertás el campeón del Mundial.</li>
            <li><b>👟 Botín de Oro:</b> +3 si acertás el goleador del torneo.</li>
            <li><b>🐴 Tapado:</b> suma por ronda alcanzada — grupos +2, 16avos +2, 8vos +3, 4tos +3, semis +5, gana la final +10 (máx 25).</li>
            <li><b>⭐ Partido doble secreto:</b> un partido al azar de la última fecha de grupos vale el doble. Se revela al terminar.</li>
            <li className="text-zinc-500">Valla invicta y Cojones cuentan desde Brasil–Haití en adelante.</li>
          </ul>
        </section>
      </main>
    </>
  );
}
