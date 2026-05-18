-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ── Properties ────────────────────────────────────────────────────────────────
create table public.properties (
  id          uuid        not null default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id),
  title       text        not null default 'New Property' unique,
  description text        not null default '',
  slug        text        not null unique,
  status      text        not null default 'draft' check (status in ('draft', 'published')),
  fields      jsonb       not null default '[]',
  questions   jsonb       not null default '[]',
  rules       jsonb       not null default '[]',
  variables   jsonb       not null default '[]',
  links       jsonb       not null default '[]',
  ai_instructions jsonb   not null default '{"style": "", "examples": []}',
  published_state jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint properties_pkey primary key (id)
);

-- ── Sessions ──────────────────────────────────────────────────────────────────
create table public.sessions (
  id                       uuid        not null default gen_random_uuid(),
  property_id              uuid        references public.properties (id),
  listing_title            text        not null,
  status                   text        not null default 'in_progress'
                             check (status in ('in_progress', 'qualified', 'rejected', 'review')),
  answers                  jsonb       not null default '{}',
  question_path            jsonb       not null default '[]',
  message_count            integer     not null default 0,
  off_topic_count          integer     not null default 0,
  qualified_follow_up_count integer    not null default 0,
  clarification_pending    boolean     not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint sessions_pkey primary key (id)
);

-- ── Messages ──────────────────────────────────────────────────────────────────
create table public.messages (
  id         uuid        not null default gen_random_uuid(),
  session_id uuid        not null references public.sessions (id),
  role       text        not null check (role in ('user', 'assistant')),
  content    text        not null,
  extracted  jsonb,
  created_at timestamptz not null default now(),
  constraint messages_pkey primary key (id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index sessions_property_id_idx on public.sessions (property_id);
create index messages_session_id_idx  on public.messages (session_id);
create index properties_user_id_idx   on public.properties (user_id);

-- ── updated_at trigger ────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger properties_updated_at
  before update on public.properties
  for each row execute procedure public.set_updated_at();

create trigger sessions_updated_at
  before update on public.sessions
  for each row execute procedure public.set_updated_at();

-- ── Row-level security ────────────────────────────────────────────────────────
alter table public.properties enable row level security;
alter table public.sessions   enable row level security;
alter table public.messages   enable row level security;

-- Properties: owners can do everything
create policy "owners can manage their properties"
  on public.properties for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Sessions: property owner can read; anyone can insert (applicants start sessions)
create policy "owners can read sessions for their properties"
  on public.sessions for select
  using (
    property_id in (
      select id from public.properties where user_id = auth.uid()
    )
  );

create policy "anyone can create a session"
  on public.sessions for insert
  with check (true);

create policy "session participant can update their session"
  on public.sessions for update
  using (true);

-- Messages: same access pattern as sessions
create policy "owners can read messages for their properties"
  on public.messages for select
  using (
    session_id in (
      select s.id from public.sessions s
      join public.properties p on p.id = s.property_id
      where p.user_id = auth.uid()
    )
  );

create policy "anyone can insert messages"
  on public.messages for insert
  with check (true);
