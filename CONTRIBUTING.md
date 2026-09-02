# Contributing

Thanks for taking the time. This project has one unusual rule that matters more than any
style guideline, so it comes first.

## The one rule

**Never present output with more certainty than the data supports.**

Cutoff Lens shows what happened in official JoSAA rounds. It does not predict, score
chances, or rank a student's odds. Most of the sites in this space do, because confidence
converts — that is exactly the thing this project is not. A change that makes the output
look more certain than the underlying rounds justify will be turned down even if it is
well built.

If a fact about an institute cannot be traced to a source, it does not go in. If an
institute does not publish something, the panel says so rather than quietly omitting it.

## Getting set up

```bash
git clone https://github.com/HarinManiK/cutoff_lens.git
cd cutoff_lens
npm install
npm run dev
```

No environment variables are needed. With no Supabase credentials configured the app parses
the CSVs in `data/` in-process, which is the path most contributors will work against.

## Before you open a PR

```bash
npm run typecheck
npm run lint
npm run build
```

All three must pass — CI runs exactly these. If `typecheck` complains about a route that no
longer exists, that is a stale `.next/types` artifact: re-run `build` and check again before
chasing it.

Check your change against the **local-CSV** path at minimum. If it touches a query or the
schema, check it against Supabase too — the two paths are meant to return the same rows, and
they drift silently when only one is exercised.

## Branches and commits

`main` is protected. Work on a branch and open a pull request:

```bash
git switch -c fix/sticky-header-offset
```

Commits follow Conventional Commits, matching the existing history:

```
feat(filters): give More filters its own row and make it findable
fix(table): keep the sticky header pinned to the filter bar
style(filters): align mobile filters and size them for a thumb
refactor(filters): move Institution and Branch into More filters
docs(readme): document the data correction workflow
```

Scopes in use: `filters`, `table`, `insights`, `data`, `db`, `css`, `readme`. Add one if
none fits. Write the subject as what the change does for a user, not what you edited.

## Code conventions

- **TypeScript strict**, `@/*` maps to `src/*`
- **Plain CSS** in `src/app/globals.css` using CSS variables. Tailwind is configured but
  barely used — follow the existing class conventions rather than adding utility classes
- **String formatting lives in `src/lib/display.ts`**, not in components. Gender mapping,
  institute name shortening, degree parsing and the IIT display order are all there
- **Server-only secrets are never prefixed `NEXT_PUBLIC_`.** The service-role key bypasses
  all row-level security
- **Read multi-row Supabase results through `fetchAllRows()`** in `src/lib/supabase-rows.ts`.
  PostgREST silently caps responses at 1000 rows and a truncated result is indistinguishable
  from a complete one, which for cutoff data means answering confidently from half the evidence

## Data rules that must not be broken

These are correctness rules, not preferences. Getting one wrong gives a student a
dangerously wrong answer about their own future.

- Ranks ending in `P` are **preparatory**. Store them, flag `is_preparatory`, and never show
  them in user-facing results.
- **OPEN uses CRL rank. Other categories use category rank. PwD seat types use PwD rank.**
- A row is "within reach" when `closingRankNumber >= studentRank`.

## Adding a counselling round

See [docs/data.md](docs/data.md). Short version: drop the CSV into `data/` named exactly
`jee_advanced_<year>_round_<round>_IITs.csv`, keep the official JoSAA headers, and restart
the dev server — parsed rows are cached in module scope.

## Reporting things

- **A wrong number** — [data correction issue](https://github.com/HarinManiK/cutoff_lens/issues/new?template=data_correction.yml).
  Include the official source. This is the most valuable kind of report this project gets.
- **A bug** — [bug report](https://github.com/HarinManiK/cutoff_lens/issues/new?template=bug_report.yml), with the exact filter selection.
- **A vulnerability** — privately, via [SECURITY.md](SECURITY.md). Not a public issue.

## Code of conduct

Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).
