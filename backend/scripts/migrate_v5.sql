-- ============================================================
-- OmliveStream — Migration v5: Contact submissions
-- Run this after v4 in Supabase SQL editor
-- ============================================================

-- Contact form submissions (public)
create table if not exists contact_submissions (
  id          uuid primary key,
  name        varchar(120)      not null,
  email       varchar(255)      not null,
  message     text              not null,
  status      varchar(20)       not null default 'unread' check (status in ('unread','read','replied')),
  ip_address  varchar(45),
  read_at     timestamptz,
  replied_at  timestamptz,
  created_at  timestamptz       not null default now()
);

create index if not exists idx_contact_submissions_status     on contact_submissions (status);
create index if not exists idx_contact_submissions_created_at on contact_submissions (created_at desc);
create index if not exists idx_contact_submissions_email      on contact_submissions (email);

-- RLS: only service role can read (admin dashboard queries via service role)
alter table contact_submissions enable row level security;
