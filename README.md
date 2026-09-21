# OddsLens

Football odds analytics dashboard for historical first- and second-half alternate totals (`alternate_totals_h1`, `alternate_totals_h2`) across the Big 5 leagues.

Historical half-totals from [The Odds API](https://the-odds-api.com/) are available as **~5 minute snapshots**, queried one match at a time. Each snapshot costs **10 credits per market** for one bookmaker. OddsLens fetches on demand, shows the estimated cost first, and caches every snapshot in local SQLite so repeats are free.

## Setup

1. Copy `.env.example` to `.env` and set `ODDS_API_KEY`.
2. Install and run:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The API key is used only in Next.js server routes. Completed-match lists for the last 3 days cost 2 credits per league per calendar day and are cached; upcoming fixtures are free.

## Stack

- Next.js 15 (App Router) + TypeScript + Tailwind
- SQLite via `better-sqlite3` (`data/oddslens.db`)
- Recharts for Over-line movement
