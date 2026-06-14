export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3 text-sm">
          <span className="font-bold">⚽ Prode</span>
          <span className="h-4 w-48 animate-pulse rounded bg-zinc-800" />
        </div>
      </div>
      <main className="mx-auto max-w-4xl space-y-2 p-4">
        <div className="mb-3 h-6 w-32 animate-pulse rounded bg-zinc-800" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-11 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900" />
        ))}
      </main>
    </>
  );
}
