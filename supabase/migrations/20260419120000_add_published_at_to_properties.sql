-- Applicant chat / share links are allowed only when published_at is set (see app logic).
alter table public.properties
  add column if not exists published_at timestamptz;

comment on column public.properties.published_at is 'When set, applicant chat is enabled for this property. Cleared when config becomes invalid.';
