import Link from "next/link";
import { ne } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import Nav from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function ComparePage() {
  const user = await requireUser();
  const others = await db.query.users.findMany({ where: ne(users.id, user.id) });
  return (
    <>
      <Nav name={user.name} isAdmin={user.isAdmin} />
      <main className="mx-auto max-w-2xl p-4">
        <h1 className="mb-4 text-xl font-bold">Compare predictions</h1>
        <div className="space-y-2">
          {others.map((o) => (
            <Link key={o.id} href={`/compare/${o.username}`}
              className="block rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 hover:border-zinc-600">
              {o.name} →
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
