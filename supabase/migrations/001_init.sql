create extension if not exists pgcrypto;

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.counselling_sources (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  year integer not null,
  round integer not null,
  institute_type text not null,
  source_file_name text not null,
  source_sha256 text not null unique,
  row_count integer not null default 0,
  imported_at timestamptz not null default now(),
  unique (exam_id, year, round, institute_type, source_file_name)
);

create table if not exists public.institutes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.cutoffs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.counselling_sources(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  institute_id uuid not null references public.institutes(id) on delete restrict,
  program_id uuid not null references public.programs(id) on delete restrict,
  year integer not null,
  round integer not null,
  quota text not null,
  seat_type text not null,
  gender text not null,
  opening_rank_raw text not null,
  closing_rank_raw text not null,
  opening_rank_number integer not null,
  closing_rank_number integer not null,
  is_preparatory boolean not null default false,
  created_at timestamptz not null default now(),
  unique (
    source_id,
    institute_id,
    program_id,
    quota,
    seat_type,
    gender,
    opening_rank_raw,
    closing_rank_raw
  )
);

create index if not exists cutoffs_lookup_idx
  on public.cutoffs (exam_id, year, round, seat_type, gender, is_preparatory, closing_rank_number);

create index if not exists cutoffs_institute_idx
  on public.cutoffs (institute_id);

create index if not exists cutoffs_program_idx
  on public.cutoffs (program_id);

create or replace view public.cutoff_results as
select
  c.id,
  e.slug as exam_slug,
  e.name as exam_name,
  c.year,
  c.round,
  i.name as institute,
  p.name as program,
  c.quota,
  c.seat_type,
  c.gender,
  c.opening_rank_raw,
  c.closing_rank_raw,
  c.opening_rank_number,
  c.closing_rank_number,
  c.is_preparatory,
  s.source_file_name,
  s.source_sha256
from public.cutoffs c
join public.exams e on e.id = c.exam_id
join public.institutes i on i.id = c.institute_id
join public.programs p on p.id = c.program_id
join public.counselling_sources s on s.id = c.source_id;

alter table public.exams enable row level security;
alter table public.counselling_sources enable row level security;
alter table public.institutes enable row level security;
alter table public.programs enable row level security;
alter table public.cutoffs enable row level security;
