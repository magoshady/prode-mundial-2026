/* Run with: tsx --env-file=.env.local scripts/check-darkhorse.ts */
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { bonusPicks, users } from "../src/db/schema";

async function main() {
  const rows = await db
    .select({
      name: users.name,
      username: users.username,
      darkHorse: bonusPicks.darkHorseTeam,
    })
    .from(users)
    .leftJoin(bonusPicks, eq(bonusPicks.userId, users.id))
    .orderBy(users.name);

  const missing = rows.filter((r) => !r.darkHorse);

  console.log(`Total players: ${rows.length}`);
  console.log(`Picked a dark horse: ${rows.length - missing.length}`);
  console.log(`Missing: ${missing.length}`);
  console.log("");
  for (const r of rows) {
    console.log(`${r.darkHorse ? "✅" : "❌"}  ${r.name.padEnd(22)} ${r.darkHorse ?? "—"}`);
  }
}

main();
