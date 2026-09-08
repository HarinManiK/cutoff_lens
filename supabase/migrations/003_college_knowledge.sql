-- College knowledge base for the AI counsellor.
-- One row = one sourced claim. Chat reads only this table (plus cutoffs),
-- never the live web. Every row carries provenance so the UI can render
-- source chips and freshness states.
--
-- coverage: verified | partial | missing | not_published
--   verified     - opened the source, fact confirmed
--   partial      - source confirms part (e.g. overall median but no branch median)
--   missing      - expected source not found yet, retry later
--   not_published- institute does not publish this (honest unknown, do not retry as if it will appear)

create table if not exists public.college_facts (
  id uuid primary key default gen_random_uuid(),
  institute text not null,
  topic text not null,
  subtype text not null default '',
  claim text not null,
  data jsonb not null default '{}'::jsonb,
  source_url text not null,
  source_title text not null default '',
  publisher text not null default '',
  published_ay text not null default '',
  source_page text not null default '',
  format text not null default 'html',
  coverage text not null default 'verified',
  retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (institute, topic, subtype, source_url)
);

create index if not exists college_facts_institute_idx
  on public.college_facts (institute);
create index if not exists college_facts_topic_idx
  on public.college_facts (topic);

alter table public.college_facts enable row level security;

-- Same deny-by-default posture as 002: service-role only, server-side reads.
revoke all on table public.college_facts from anon, authenticated;
