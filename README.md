# Indian Exams

Counselling cutoff explorer for Indian entrance exams.

## Current Scope

- JEE Advanced
- IIT cutoffs only
- Every JoSAA round present in `data/` (see below); the explorer defaults to 2025 Round 5
- Preparatory-rank rows are stored by the importer but hidden from user-facing results

## Adding a Counselling Round

Drop the official CSV into `data/` using exactly this name:

```
jee_advanced_<year>_round_<round>_IITs.csv
```

For example `jee_advanced_2025_round_1_IITs.csv`. The year and round are read from the
filename, so a file that does not match the pattern is ignored. `GET
/api/cutoffs/jee-advanced/datasets` lists what was discovered, and the Year and Round
selectors under **More filters** are populated from it.

The CSV must keep the official JoSAA column headers: `Institute`, `Academic Program Name`,
`Quota`, `Seat Type`, `Gender`, `Opening Rank`, `Closing Rank`.

Parsed rows are cached in memory, so **restart the dev server after adding a file**.

## Local Development

```bash
npm install
npm run dev
```

When Supabase credentials are not configured the app reads the CSVs in `data/` directly, so it runs with no setup.

## Supabase Setup

1. Create a Supabase project.
2. Run `supabase/migrations/001_init.sql` in the Supabase SQL editor.
3. Copy `.env.example` to `.env.local`.
4. Fill:

```bash
SUPABASE_URL="https://your-project-ref.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

5. Import the official CSV:

```bash
npm run import:jee-advanced:2025:r5
```

The importer stores raw rank strings and derived numeric rank fields. Rows with a `P` suffix are marked as preparatory and are not shown in the public explorer.
