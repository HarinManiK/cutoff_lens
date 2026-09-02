## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem being solved. Link the issue with "Closes #123" if there is one. -->

## How to check it

<!-- The steps a reviewer takes to see it working: which page, which filters, what to look for. -->

## Checklist

- [ ] `npm run typecheck`, `npm run lint` and `npm run build` all pass locally
- [ ] Checked against the **local-CSV** path (no Supabase env set), which is the default
- [ ] Checked against **Supabase** as well, if the change touches a query or the schema
- [ ] No secret is committed, and no server-only key gained a `NEXT_PUBLIC_` prefix

## If this touches cutoff data or the numbers shown

- [ ] Preparatory (`P`-suffixed) ranks stay hidden from user-facing results
- [ ] The right rank basis is used: CRL for OPEN, category rank for reserved seat types, PwD rank for PwD seat types
- [ ] Nothing is presented with more certainty than the data supports — this is "a better guess, not a prediction"
- [ ] Any new fact about an institute carries its provenance and a source
