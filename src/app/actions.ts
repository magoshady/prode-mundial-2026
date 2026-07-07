"use server";

import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { bonusPicks, matches, meta, predictions, users } from "@/db/schema";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { isOpenForPrediction } from "@/lib/rules";
import { normalizeKnockoutPrediction, type AdvanceSide } from "@/lib/knockout";
import { GOLDEN_BOOT_CANDIDATES, bombitaWindowOpen, nextBombita, picksDeadlinePassed, UNDERDOG_TEAMS } from "@/lib/bonus";
import { syncMatches } from "@/lib/sync";

export type FormState = { error?: string } | undefined;

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const user = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { error: "Wrong username or password" };
  }
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function savePrediction(matchId: number, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match || !isOpenForPrediction(match, new Date())) {
    return { error: "Predictions are closed for this match" };
  }

  const num = (key: string): number | null => {
    const raw = String(formData.get(key) ?? "").trim();
    return raw === "" ? null : Number(raw);
  };
  const penRaw = String(formData.get("penAdvance") ?? "").trim();

  const result = normalizeKnockoutPrediction({
    isKnockout: match.stage !== "GROUP_STAGE",
    home: Number(formData.get("home")),
    away: Number(formData.get("away")),
    etHome: num("etHome"),
    etAway: num("etAway"),
    penAdvance: penRaw === "HOME" || penRaw === "AWAY" ? (penRaw as AdvanceSide) : null,
  });
  if (!result.ok) return { error: result.error };
  const v = result.value;

  await db.insert(predictions)
    .values({ userId: user.id, matchId, homeScore: v.homeScore, awayScore: v.awayScore, etHomeScore: v.etHomeScore, etAwayScore: v.etAwayScore, penAdvance: v.penAdvance, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [predictions.userId, predictions.matchId],
      set: { homeScore: v.homeScore, awayScore: v.awayScore, etHomeScore: v.etHomeScore, etAwayScore: v.etAwayScore, penAdvance: v.penAdvance, updatedAt: new Date() },
    });

  revalidatePath("/");
  return undefined;
}

/**
 * 💣 bombita — its own instant toggle, independent of the forecast save. There is only
 * ever ONE: ticking a QF sets/moves it here; unticking the current one clears it. Guarded
 * so it only lands on an open QF, and refuses any change once your bombita has locked
 * (its match kicked off). Revalidates so every QF card reflects the single selection.
 */
export async function setBombita(matchId: number, want: boolean): Promise<void> {
  const user = await requireUser();
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match || !bombitaWindowOpen(match, new Date())) return;

  const existing = await db.query.bonusPicks.findFirst({ where: eq(bonusPicks.userId, user.id) });
  const curId = existing?.bombitaMatchId ?? null;
  if (curId !== null) {
    const curMatch = await db.query.matches.findFirst({ where: eq(matches.id, curId) });
    const curLocked = !!curMatch && new Date().getTime() >= curMatch.kickoffUtc.getTime();
    if (curLocked) return; // a locked bombita cannot be moved or cleared
  }

  const next = nextBombita(curId, matchId, want);
  await db.insert(bonusPicks)
    .values({ userId: user.id, bombitaMatchId: next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: bonusPicks.userId, set: { bombitaMatchId: next, updatedAt: new Date() } });
  revalidatePath("/");
}

export async function adminSync(): Promise<void> {
  const user = await requireUser();
  if (!user.isAdmin) return;
  await syncMatches();
  revalidatePath("/", "layout");
}

export async function adminUpdateResult(matchId: number, _prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  if (!user.isAdmin) return { error: "Not allowed" };
  const rawHome = String(formData.get("home") ?? "").trim();
  const rawAway = String(formData.get("away") ?? "").trim();
  const status = String(formData.get("status") ?? "");
  const home = rawHome === "" ? null : Number(rawHome);
  const away = rawAway === "" ? null : Number(rawAway);
  const valid = (v: number | null) => v === null || (Number.isInteger(v) && v >= 0 && v <= 99);
  if (!valid(home) || !valid(away)) return { error: "Invalid score" };
  if (!["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "FINISHED"].includes(status)) return { error: "Invalid status" };
  await db.update(matches)
    .set({ homeScore: home, awayScore: away, status })
    .where(eq(matches.id, matchId));
  revalidatePath("/", "layout");
  return undefined;
}

export async function saveBonusPicks(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const [allMatches, existing, deadlineRow] = await Promise.all([
    db.query.matches.findMany(),
    db.query.bonusPicks.findFirst({ where: eq(bonusPicks.userId, user.id) }),
    db.query.meta.findFirst({ where: eq(meta.key, "bonus_picks_deadline") }),
  ]);
  const now = new Date();
  const deadline = deadlineRow?.value ? new Date(deadlineRow.value) : null;
  if (picksDeadlinePassed(deadline, now)) {
    return { error: "Se cerró la ventana de 24h — las elecciones están bloqueadas." };
  }

  const champion = String(formData.get("champion") ?? "").trim() || null;
  const goldenBoot = String(formData.get("goldenBoot") ?? "").trim() || null;
  const darkHorse = String(formData.get("darkHorse") ?? "").trim() || null;

  // Each pick is final once set: keep the stored value and ignore any change. Only validate
  // (and accept) fields the user is still allowed to set.
  const teamNames = new Set(
    allMatches.flatMap((m) => [m.homeTeam, m.awayTeam].filter(Boolean) as string[]),
  );
  if (existing?.championTeam == null && champion && !teamNames.has(champion)) return { error: "Unknown champion pick" };
  if (existing?.darkHorseTeam == null && darkHorse && !UNDERDOG_TEAMS.includes(darkHorse)) return { error: "Dark horse must be from the underdog pool" };
  if (existing?.goldenBootPlayer == null && goldenBoot && !GOLDEN_BOOT_CANDIDATES.includes(goldenBoot)) return { error: "Unknown golden boot pick" };

  const finalChampion = existing?.championTeam ?? champion;
  const finalGoldenBoot = existing?.goldenBootPlayer ?? goldenBoot;
  const finalDarkHorse = existing?.darkHorseTeam ?? darkHorse;

  await db.insert(bonusPicks)
    .values({ userId: user.id, championTeam: finalChampion, goldenBootPlayer: finalGoldenBoot, darkHorseTeam: finalDarkHorse, updatedAt: now })
    .onConflictDoUpdate({
      target: bonusPicks.userId,
      set: { championTeam: finalChampion, goldenBootPlayer: finalGoldenBoot, darkHorseTeam: finalDarkHorse, updatedAt: now },
    });
  revalidatePath("/bonus");
  return undefined;
}

export async function adminSetBonusResults(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (!user.isAdmin) return;
  const champion = String(formData.get("championTeam") ?? "").trim();
  const goldenBoot = String(formData.get("goldenBootWinner") ?? "").trim();
  const upsert = async (key: string, value: string) => {
    if (!value) return;
    await db.insert(meta).values({ key, value })
      .onConflictDoUpdate({ target: meta.key, set: { value: sql`excluded.value` } });
  };
  await upsert("champion_team", champion);
  await upsert("golden_boot_winner", goldenBoot);
  revalidatePath("/", "layout");
}
