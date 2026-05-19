alter table public.sessions
  add column answered_question_ids jsonb not null default '[]';
