import type { Metadata } from "next";
import { LoginForm } from "@/components/LoginForm";

export const metadata: Metadata = {
  title: "Sign in · OddsLens",
  description: "Sign in to browse historical half totals",
};

const notes = [
  { label: "Halves", value: "1H and 2H totals" },
  { label: "Lines", value: "Alternate totals" },
  { label: "Scope", value: "European leagues" },
];

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-16">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 h-[680px] w-[680px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-400/10" />
        <div className="absolute left-1/2 top-1/2 h-[480px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-400/15" />
        <div className="absolute left-1/2 top-1/2 h-[280px] w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-400/[0.22]" />
        <div className="absolute left-1/2 top-[18%] h-64 w-64 -translate-x-1/2 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />
      </div>

      <main className="relative w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-400/15 ring-1 ring-emerald-400/40">
            <span className="h-3.5 w-3.5 rounded-full bg-emerald-400 shadow-[0_0_16px_#34d399]" />
          </span>
          <div>
            <p className="text-lg font-semibold tracking-wide text-white">OddsLens</p>
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Half totals</p>
          </div>
        </div>

        <section className="rounded-3xl border border-white/10 bg-[#0c1622]/80 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-8">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-300/80">
            Private access
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Sign in to open the board
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Historical first and second half alternate totals for European football leagues.
            The match board stays closed until you sign in.
          </p>

          <LoginForm />
        </section>

        <ul className="mt-6 grid gap-2 sm:grid-cols-3">
          {notes.map((note) => (
            <li
              key={note.label}
              className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3"
            >
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{note.label}</p>
              <p className="mt-1 text-xs leading-5 text-slate-300">{note.value}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
