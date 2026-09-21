import Link from "next/link";

export default function NotFound() {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-12 text-center">
      <h1 className="text-xl font-semibold text-white">Match not found</h1>
      <p className="mt-2 text-sm text-slate-400">
        Load fixtures from the home page first so this event can be cached locally.
      </p>
      <Link
        href="/"
        className="mt-4 inline-block rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950"
      >
        Back to matches
      </Link>
    </div>
  );
}
