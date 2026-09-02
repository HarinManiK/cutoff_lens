# Architecture

Next.js 16 App Router, React 19, TypeScript strict. Styling is hand-written CSS in
`src/app/globals.css` using CSS variables — Tailwind is configured but barely used, so
follow the existing plain-CSS class conventions rather than adding utility classes.

## Layout

```
src/app/
  page.tsx                            Exam grid
  exams/jee-advanced/page.tsx         Thin wrapper around the explorer
  api/cutoffs/jee-advanced/
    route.ts                          The cutoff query
    datasets/route.ts                 Which year/round pairs exist
    insights/route.ts                 Per college-branch panel data
src/components/
  JeeAdvancedExplorer.tsx             All filter state
  InsightPanel.tsx                    The slide-over panel
src/lib/
  display.ts                          JoSAA string wrangling and sort order
  search.ts                           Client-side search with branch aliases
  branch-groups.ts                    Regex bulk-select groups
  insights.ts                         Ranking and trend computation
  rounds.ts                           Final round per year
  local-cutoffs.ts                    CSV parsing
  datasets.ts                         Dataset discovery across both sources
  supabase-server.ts                  Client factory, null when unconfigured
  supabase-rows.ts                    Paging around the PostgREST row cap
  content/institutes.ts               Institute profiles
  content/provenance.ts               The Fact<T> type
```

## The dual data source

Data has two interchangeable sources, chosen per request:

- **Supabase** when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set. All reads go
  through the `cutoff_results` view. RLS is on with no policies, so only the service-role
  key works, and only server-side.
- **Local CSV** otherwise — `src/lib/local-cutoffs.ts` parses `data/*.csv` in-process.

`createServerSupabaseClient()` returns `null` when unconfigured, and **every caller must
handle that by falling back to CSV**. The `meta.source` field on API responses
(`"supabase"` vs `"local-csv"`) tells you which path served a request — check it when a
result surprises you.

The two paths are meant to return identical rows. They drift silently when only one is
exercised, which is why the PR checklist asks about both.

### The PostgREST row cap

PostgREST silently caps responses at 1000 rows, overriding any higher `.limit()`. A
truncated result is indistinguishable from a complete one, and for cutoff data that means
answering confidently from half the evidence. Read multi-row Supabase results through
`fetchAllRows()` in `src/lib/supabase-rows.ts` rather than a bare `.limit()`.

### CSV bundling

CSVs are read via a path built at runtime, which Next's tracing cannot see.
`outputFileTracingIncludes` in `next.config.ts` keeps them in the serverless bundle.
Removing it silently breaks production while dev keeps working.

## Key modules

**`src/lib/display.ts`** holds all JoSAA string wrangling: gender mapping (`Gender-Neutral`
to `Male`), institute name shortening, degree/duration/type parsing, and the hardcoded IIT
ordering used as the primary sort key. Put new formatting here, not in components.

**`src/components/JeeAdvancedExplorer.tsx`** is one large client component holding all
filter state. Filter options are cross-filtered: each dropdown's options come from rows
matching every *other* selection, with effects that prune selections which become invalid.
The sticky table header offsets by a `--filter-height` CSS variable the component keeps in
sync, because the filter bar's height changes as fields wrap.

**`src/lib/content/provenance.ts`** defines `Fact<T>`, which carries a `provenance`
discriminator plus source and date. This is deliberate: making provenance part of the type
means a fact cannot be added without declaring what backs it. `notPublished()` renders a gap
explicitly rather than letting an absent number disappear.

## Status

The AI counsellor was deliberately removed to be rebuilt cleanly. The previous grounded
implementation is worth reading before rewriting — it had rank/category extraction from
natural language, a data-authority system prompt, scope guards, and a deterministic non-LLM
fallback:

```bash
git show 1ff1212:src/lib/ai/jee-advanced.ts
```

```bash
git show b1934a8:src/app/api/ai/chat/route.ts
```

When it returns it must respect the selected year/round rather than assuming a fixed round,
and must never answer eligibility questions from model memory.
