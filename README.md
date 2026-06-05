# Indian Exams

Counselling cutoff explorer for Indian entrance exams.

## Current Scope

- JEE Advanced
- 2025 JoSAA Round 5
- IIT cutoffs only
- Preparatory-rank rows are stored by the importer but hidden from user-facing results

## Local Development

```bash
npm install
npm run dev
```

The app uses `data/jee_advanced_2025_round_5_IITs.csv` as a local preview source when Supabase credentials are not configured.

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
