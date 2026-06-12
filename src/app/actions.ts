"use server";

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { matches, predictions, users } from "@/db/schema";
import { createSession, destroySession, requireUser } from "@/lib/auth";
import { isOpenForPrediction } from "@/lib/rules";
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
  const home = Number(formData.get("home"));
  const away = Number(formData.get("away"));
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home > 99 || away > 99) {
    return { error: "Scores must be whole numbers between 0 and 99" };
  }
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match || !isOpenForPrediction(match, new Date())) {
    return { error: "Predictions are closed for this match" };
  }
  await db.insert(predictions)
    .values({ userId: user.id, matchId, homeScore: home, awayScore: away, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [predictions.userId, predictions.matchId],
      set: { homeScore: home, awayScore: away, updatedAt: new Date() },
    });
  revalidatePath("/");
  return undefined;
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
