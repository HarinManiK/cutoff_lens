# Cutoff Lens

Counselling cutoff explorer for Indian entrance exams. A student enters rank + category +
gender and sees which colleges and branches were actually within reach, based on official
JoSAA data.

**Guiding principle: "a better guess, not a prediction."** Never present output with more
certainty than the data supports. This is the product's differentiator — most rank
predictors are lead-generation funnels for paid counselling. Honesty is the feature.

Current scope is JEE Advanced / IITs. The schema and importer are already generic over
exam, year, round and institute type, so more exams are a data problem, not a rewrite.

## Commands

```bash
npm run dev        # localhost:3000
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
```

Run `typecheck`, `lint` and `build` before declaring work done. If `typecheck` complains
about a route that no longer exists, it is a stale `.next/types` artifact — re-run `build`
and check again before chasing it.

## Architecture

Next.js 16 App Router, React 19, TypeScript strict. Styling is hand-written CSS in
`src/app/globals.css` using CSS variables — Tailwind is configured but barely used, so
follow the existing plain-CSS class conventions rather than adding utility classes.

Data has two interchangeable sources, chosen at request time:

- **Supabase** when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. All reads go
  through the `cutoff_results` view. RLS is on with no policies, so only the service-role
  key works, and only server-side.
- **Local CSV** otherwise — `src/lib/local-cutoffs.ts` parses `data/*.csv` in-process.

`createServerSupabaseClient()` returns `null` when unconfigured, and every caller must
handle that by falling back to CSV. The `meta.source` field on API responses (`"supabase"`
vs `"local-csv"`) tells you which path served a request.

Key modules:

- `src/lib/display.ts` — all JoSAA string wrangling: gender mapping (`"Gender-Neutral"` ↔
  `"Male"`), institute name shortening, degree/duration/type parsing, and the hardcoded IIT
  ordering used as the primary sort key. Put new formatting here, not in components.
- `src/lib/search.ts` — client-side search with a branch alias table (`cse`, `mnc`, `ece`).
- `src/lib/branch-groups.ts` — regex bulk-select groups for the Branch filter.
- `src/components/JeeAdvancedExplorer.tsx` — one large client component holding all filter
  state. Filter options are cross-filtered: each dropdown's options come from rows matching
  every *other* selection, with effects that prune selections that become invalid.

## Adding a counselling round

Drop the CSV into `data/` named exactly:

```
jee_advanced_<year>_round_<round>_IITs.csv
```

Year and round are parsed from the filename; files that don't match are ignored. Keep the
official JoSAA headers: `Institute`, `Academic Program Name`, `Quota`, `Seat Type`,
`Gender`, `Opening Rank`, `Closing Rank`.

**Parsed rows are cached in module scope — restart the dev server after adding a file.**

## Data rules

- Ranks ending in `P` are preparatory. Store them, flag `is_preparatory`, and **never**
  show them in user-facing results.
- OPEN uses CRL rank; other categories use category rank; PwD seat types use PwD rank.
  Mixing these up gives a student a dangerously wrong answer.
- A row is "within reach" when `closingRankNumber >= studentRank`.

## Conventions

- `@/*` maps to `src/*`.
- Server-only secrets must never be prefixed `NEXT_PUBLIC_`. The service-role key bypasses
  all RLS — `.env.local` and deployment env only, never committed.
- The database is deny-by-default: RLS is on with no policies, `anon` and `authenticated`
  hold no grants, and `cutoff_results` is `security_invoker = on` so it cannot be used to
  read around RLS. Every read is server-side via the service-role key. Adding a table for a
  new exam inherits this, since default privileges are revoked too. The advisor's five
  "RLS enabled, no policy" INFO notices are the intended posture, not a finding — but
  re-run `get_advisors` after any DDL, since a new SECURITY DEFINER view would reopen it.
- **PostgREST silently caps responses at 1000 rows**, overriding any higher `.limit()`. A
  truncated result is indistinguishable from a complete one, and for cutoff data that means
  answering confidently from half the evidence. Read multi-row Supabase results through
  `fetchAllRows()` in `src/lib/supabase-rows.ts` rather than a bare `.limit()`.
- CSVs are read via a path built at runtime, which Next's tracing cannot see.
  `outputFileTracingIncludes` in `next.config.ts` keeps them in the serverless bundle;
  removing it silently breaks production while dev keeps working.

## Status

The AI counsellor was deliberately removed to be rebuilt cleanly. The previous grounded
implementation is worth reading before rewriting — it had rank/category extraction from
natural language, a data-authority system prompt, scope guards, and a deterministic
non-LLM fallback:

```bash
git show 1ff1212:src/lib/ai/jee-advanced.ts   # context builder + prompt
git show b1934a8:src/app/api/ai/chat/route.ts # how it was wired, with citations
```

When it returns it must respect the selected year/round rather than assuming 2025 Round 5,
and must never answer eligibility questions from model memory.
