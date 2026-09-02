# Data

## The rules that must not be broken

These are correctness rules, not preferences. Getting one wrong gives a student a
dangerously wrong answer about their own future.

1. **Preparatory ranks are never shown.** Ranks ending in `P` are preparatory. Store them,
   flag `is_preparatory`, and filter them out of every user-facing result.
2. **The rank basis depends on the seat type.** OPEN uses CRL rank. Other categories use
   category rank. PwD seat types use PwD rank. Mixing these up is the single most damaging
   bug this project can ship.
3. **"Within reach" means `closingRankNumber >= studentRank`.**

## Adding a counselling round

Drop the official CSV into `data/` named exactly:

```
jee_advanced_<year>_round_<round>_IITs.csv
```

For example, `jee_advanced_2026_round_5_IITs.csv`. Year and round are parsed from the
filename; files that do not match the pattern are ignored silently.

Keep the official JoSAA headers, unchanged:

```
Institute,Academic Program Name,Quota,Seat Type,Gender,Opening Rank,Closing Rank
```

**Parsed rows are cached in module scope, so restart the dev server after adding a file.**

`GET /api/cutoffs/jee-advanced/datasets` lists what was discovered, and the Year and Round
selectors under **More filters** are populated from it.

### Then, if you use Supabase

```bash
npm run import:jee-advanced
```

With no arguments the importer picks up every matching CSV in `data/`, reading year, round
and institute type from each filename. Pass explicit paths to import a subset:

```bash
npm run import:jee-advanced -- data/jee_advanced_2026_round_5_IITs.csv
```

Each file is hashed into `counselling_sources.source_sha256`, so re-running the importer
skips anything already loaded rather than duplicating it.

## Current data

| Year | Rounds |
| --- | --- |
| 2024 | 1 to 5 |
| 2025 | 1 to 6 |
| 2026 | 1 to 5 |

IIT seats only, all under the `AI` (all-India) quota.

## Schema

The schema is generic over exam, year, round and institute type, so another exam is a data
problem rather than a rewrite.

```
exams                 slug, name
counselling_sources   exam_id, year, round, institute_type, source_file_name,
                      source_sha256 (unique), row_count
institutes            name (unique)
programs              name (unique)
cutoffs               source_id, exam_id, institute_id, program_id, year, round,
                      quota, seat_type, gender,
                      opening_rank_raw, closing_rank_raw,
                      opening_rank_number, closing_rank_number,
                      is_preparatory
```

`cutoff_results` is the flattened view every read goes through. It is
`security_invoker = on` so it cannot be used to read around row-level security — see
[SECURITY.md](../SECURITY.md).

## Institute facts

Facts about institutes live in `src/lib/content/institutes.ts` and are typed as `Fact<T>`
from `src/lib/content/provenance.ts`. Every one carries its provenance:

| Provenance | Meaning |
| --- | --- |
| `official` | Published by the institute itself. Requires a link, and a date it refers to. |
| `derived` | Computed from the JoSAA rows this site already holds. |
| `unofficial` | A named third party. Shown, but visibly marked as not from the institute. |
| `not-published` | Checked for and absent. Displayed as a gap rather than quietly omitted. |

Search results for IIT placement data are dominated by aggregators, and their numbers become
indistinguishable from official ones the moment they are copied into a card. Do not add a
number without saying what backs it. If the institute does not publish it, `notPublished()`
with a note is the correct answer — not a plausible figure from elsewhere.
