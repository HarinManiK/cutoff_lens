# Deployment

## Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `SUPABASE_URL` | No | Project URL. Set it together with the key below, or not at all. |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Server-only key. Bypasses all row-level security. |

Both unset is a valid, fully working configuration: the app falls back to parsing the CSVs
in `data/`. That is what makes `npm install && npm run dev` work with no setup.

**The service-role key must never gain a `NEXT_PUBLIC_` prefix**, appear in a client
component, or be committed. It belongs in `.env.local` locally and in the deployment
platform's environment settings in production. See [SECURITY.md](../SECURITY.md).

Copy `.env.example` to `.env.local` to start:

```bash
cp .env.example .env.local
```

## Supabase setup

1. Create a Supabase project.
2. Run the migrations in order, in the SQL editor:
   - `supabase/migrations/001_init.sql`
   - `supabase/migrations/002_lock_down_public_access.sql`
3. Fill `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
4. Import the data:

```bash
npm run import:jee-advanced
```

The second migration is not optional. It closes a real hole: `cutoff_results` defaulted to
`SECURITY DEFINER`, so anyone with the public anon key could read every row through the view
even though RLS correctly blocked the base tables.

After any DDL change, re-run the Supabase advisor. The five "RLS enabled, no policy" INFO
notices are the intended posture; a new `SECURITY DEFINER` view is not.

## Deploying to Vercel

The project builds with no configuration beyond the environment variables above.

```bash
vercel
```

Two things to keep in mind:

- **`outputFileTracingIncludes` in `next.config.ts` must stay.** The CSVs are read via a
  path built at runtime, which Next's tracing cannot see. Remove it and the local-CSV
  fallback breaks in production while dev keeps working — a failure mode that will not
  show up until it is live.
- The three API routes are `force-dynamic`, so they are server-rendered per request. Only
  the two pages prerender.

## Verifying a deploy

Hit the datasets endpoint and check `meta.source`:

```bash
curl -s https://cutofflens.vercel.app/api/cutoffs/jee-advanced/datasets
```

`"supabase"` means the database is configured and reachable. `"local-csv"` means it fell
back — which is a working state, but if you expected Supabase, the credentials are missing
or wrong.
