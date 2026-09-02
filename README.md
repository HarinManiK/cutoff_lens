<div align="center">

<img src="public/logo.png" alt="" width="88" />

# Cutoff Lens

**A better guess, not a prediction.**

Counselling cutoff explorer for Indian entrance exams. Enter a rank, category and gender,
and see which colleges and branches were actually within reach — based on official JoSAA data.

[![CI](https://github.com/HarinManiK/cutoff_lens/actions/workflows/ci.yml/badge.svg)](https://github.com/HarinManiK/cutoff_lens/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)

[Live site](https://cutofflens.vercel.app) · [Report a data error](https://github.com/HarinManiK/cutoff_lens/issues/new?template=data_correction.yml) · [Contributing](CONTRIBUTING.md)

</div>

---

## Why this exists

Most rank predictors are lead-generation funnels for paid counselling. They present a
confident-looking number because confidence converts, not because the data supports it.

Cutoff Lens shows what actually happened: the real opening and closing ranks from official
JoSAA rounds, filtered to the seats a given rank could have taken. It does not score your
chances, and it does not tell you what will happen next year. **Honesty is the feature** —
every number traces back to an official round, and every fact about an institute carries
its source, including the ones where the answer is "the institute does not publish this."

## Features

- **Rank-aware results** — a row is shown when its closing rank is at or beyond the rank entered
- **Correct rank basis per category** — CRL for OPEN, category rank for reserved seat types, PwD rank for PwD seats
- **Cross-filtered facets** — institution, branch, degree, duration and course type, each narrowed by the others
- **Branch bulk-select** — pick "All Computer / AI / Data / Computing" instead of ticking fifteen boxes
- **Alias-aware search** — `cse`, `mnc`, `ece`, `mech` all resolve to the right programmes
- **Per-branch insight panel** — where a branch sits among its institute's branches, how the closing rank moved across rounds and years, and the same seat at every category
- **Sourced institute facts** — placement and research figures shown with provenance, never laundered from an aggregator into a bare number
- **Runs with zero setup** — with no database configured it reads the CSVs in `data/` directly

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. No environment variables, no database — the local-CSV path
serves everything out of `data/`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run import:jee-advanced` | Load `data/*.csv` into Supabase |

Run `typecheck`, `lint` and `build` before opening a PR. CI runs all three.

## Documentation

| Document | What is in it |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | How the app is put together, and the dual data source |
| [docs/data.md](docs/data.md) | Adding a counselling round, and the data rules that must not be broken |
| [docs/deployment.md](docs/deployment.md) | Supabase setup, environment variables and deploying |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Workflow, conventions and what a good PR looks like |
| [SECURITY.md](SECURITY.md) | Reporting a vulnerability, and the database security posture |

## Current scope

JEE Advanced, IIT seats only. Every JoSAA round present in `data/` is selectable — currently
2024 R1–R5, 2025 R1–R6 and 2026 R1–R5 — and the explorer opens on the latest.

The schema and importer are already generic over exam, year, round and institute type, so
adding another exam is a data problem rather than a rewrite.

## Data and attribution

The cutoff CSVs in `data/` are official Joint Seat Allocation Authority (JoSAA) publications,
included here as source data. They are not covered by this project's MIT licence — JoSAA is
the authority for those figures, and the ones shown here are only as correct as the round
they came from.

If a number looks wrong, [open a data correction](https://github.com/HarinManiK/cutoff_lens/issues/new?template=data_correction.yml)
with the official source. That is the single most useful contribution to this project.

## Licence

[MIT](LICENSE) © Harin Mani
