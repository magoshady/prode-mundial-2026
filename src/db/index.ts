import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type Db = ReturnType<typeof drizzle<typeof schema>>;

// Lazy so importing this module never throws at build time (DATABASE_URL is
// only present at runtime / in environments where the DB exists).
let _db: Db | undefined;
function getDb(): Db {
  return (_db ??= drizzle(neon(process.env.DATABASE_URL!), { schema }));
}

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const value = getDb()[prop as keyof Db];
    return typeof value === "function" ? value.bind(getDb()) : value;
  },
});
