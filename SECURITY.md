# Security Policy

## Reporting a vulnerability

Please report privately through GitHub, not in a public issue:

**[Open a private security advisory](https://github.com/HarinManiK/cutoff_lens/security/advisories/new)**

Include what you found, how to reproduce it, and what an attacker could reach with it. You
can expect an initial response within a week. Please give a reasonable window to ship a fix
before disclosing publicly.

## Supported versions

This is a single deployed application rather than a released library. Only the currently
deployed `main` is supported — fixes land there.

## Security posture

Useful context if you are looking at this project.

### Secrets

`SUPABASE_SERVICE_ROLE_KEY` bypasses all row-level security and is **server-side only**. It
must never gain a `NEXT_PUBLIC_` prefix, appear in a client component, or be committed.
`.env.local` is gitignored. If a key is ever exposed, rotate it in the Supabase dashboard
first and clean up history second.

### Database

The database is deny-by-default:

- Row-level security is enabled on every table, with no policies
- `anon` and `authenticated` hold no grants, and default privileges are revoked, so tables
  added later inherit the same posture
- `cutoff_results` is `security_invoker = on`, so the view cannot be used to read around RLS
- Every read is server-side through the service-role key

The Supabase advisor reports five "RLS enabled, no policy" INFO notices. Those are the
intended posture, not findings. Re-run the advisor after any DDL, though — a new
`SECURITY DEFINER` view would reopen the hole that
`supabase/migrations/002_lock_down_public_access.sql` closed.

### Data sensitivity

Cutoff Lens holds no user accounts and no personal data. The rank a student types is used to
build one query and is never stored or transmitted anywhere beyond that request. The cutoff
figures themselves are public JoSAA publications.
