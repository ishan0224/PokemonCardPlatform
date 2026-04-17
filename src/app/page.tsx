import Link from "next/link";

export default function HomePage() {
  return (
    <section className="grid gap-6 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm md:grid-cols-2">
      <div>
        <p className="inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-rose-700">
          Live drops
        </p>
        <h1 className="mt-3 text-4xl font-black leading-tight text-slate-950">Rip packs. Reveal cards. Move fast.</h1>
        <p className="mt-4 text-sm leading-6 text-slate-600">
          PullVault is a collectible-first platform for high-tension card drops. Buy into live inventory, open packs, and
          reveal every slot one by one with market value feedback.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/drops"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-700"
          >
            Browse Drops
          </Link>
          <Link
            href="/register"
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:border-slate-500 hover:bg-slate-50"
          >
            Create Account
          </Link>
        </div>
      </div>

      <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-rose-700 p-5 text-white">
        <h2 className="text-xl font-black">P0 Demo Path</h2>
        <ol className="mt-4 space-y-3 text-sm">
          <li>1. Register or log in.</li>
          <li>2. Wait for an active drop.</li>
          <li>3. Buy a tier and secure your pack.</li>
          <li>4. Open and reveal each slot.</li>
        </ol>
      </div>
    </section>
  );
}
