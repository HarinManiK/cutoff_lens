-- The cutoff_results view defaulted to SECURITY DEFINER, so it ran as its owner and
-- ignored RLS on the underlying tables. Anyone holding the public anon key could read
-- every cutoff row through it, even though RLS correctly blocked the base tables.
alter view public.cutoff_results set (security_invoker = on);

-- Least privilege: every read is server-side through the service-role key, which bypasses
-- both grants and RLS. The anon and authenticated roles need nothing here, and Supabase's
-- defaults had granted them SELECT/INSERT/UPDATE/DELETE/TRUNCATE on every table and view.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Stop the same hole reappearing when tables are added for future exams.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- rls_auto_enable() is a SECURITY DEFINER event-trigger helper. Event triggers fire as the
-- definer regardless of grants, so removing public EXECUTE costs nothing and closes the
-- advisor's "callable via /rest/v1/rpc" finding.
revoke all on function public.rls_auto_enable() from anon, authenticated, public;
