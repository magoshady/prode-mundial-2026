import { logout } from "@/app/actions";
import NavLink from "@/components/NavLink";

export default function Nav({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  return (
    <nav className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3 text-sm">
        <NavLink href="/" className="font-bold">⚽ Prode</NavLink>
        <NavLink href="/" className="text-zinc-300 hover:text-white">Fixture</NavLink>
        <NavLink href="/leaderboard" className="text-zinc-300 hover:text-white">Leaderboard</NavLink>
        <NavLink href="/compare" className="text-zinc-300 hover:text-white">Compare</NavLink>
        <NavLink href="/bonus" className="text-zinc-300 hover:text-white">Bonus</NavLink>
        {isAdmin && <NavLink href="/admin" className="text-zinc-300 hover:text-white">Admin</NavLink>}
        <span className="ml-auto text-zinc-400">{name}</span>
        <form action={logout}>
          <button className="transition active:opacity-60 text-zinc-400 hover:text-white">Log out</button>
        </form>
      </div>
    </nav>
  );
}
