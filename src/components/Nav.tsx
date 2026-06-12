import Link from "next/link";
import { logout } from "@/app/actions";

export default function Nav({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  return (
    <nav className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3 text-sm">
        <Link href="/" className="font-bold">⚽ Prode</Link>
        <Link href="/" className="text-zinc-300 hover:text-white">Fixture</Link>
        <Link href="/leaderboard" className="text-zinc-300 hover:text-white">Leaderboard</Link>
        <Link href="/compare" className="text-zinc-300 hover:text-white">Compare</Link>
        {isAdmin && <Link href="/admin" className="text-zinc-300 hover:text-white">Admin</Link>}
        <span className="ml-auto text-zinc-400">{name}</span>
        <form action={logout}>
          <button className="text-zinc-400 hover:text-white">Log out</button>
        </form>
      </div>
    </nav>
  );
}
