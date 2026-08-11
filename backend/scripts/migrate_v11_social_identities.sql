-- ─────────────────────────────────────────────────────────────────
-- v11 — social sign-in identities
--
-- Run AFTER migrate_v10_waitlist_discount.sql.
--
-- Social sign-in previously matched an incoming profile to an account by
-- email alone. That does not work, because half the providers never disclose
-- one: Instagram Basic Display returns no email at any scope, TikTok exposes
-- none to third parties, and Facebook omits it for phone-number-only
-- accounts. Every sign-in through those providers would either fail outright
-- or mint a fresh account, so a returning user could never get back into the
-- one they already had.
--
-- The provider's own user id is the stable key — it survives the user
-- changing their email, which the email obviously does not. This table holds
-- that mapping.
-- ─────────────────────────────────────────────────────────────────

create table if not exists social_identities (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references users(id) on delete cascade,
  provider         text not null check (provider in ('google','facebook','instagram','tiktok','twitch')),
  -- The provider's own id for this person. Opaque; formats differ per provider.
  provider_user_id text not null,
  -- What the provider said the email was at link time. Informational only:
  -- users.email remains the address we actually send to.
  email            text,
  last_login_at    timestamptz,
  created_at       timestamptz not null default now(),

  -- One account per provider identity. This is the constraint the upsert in
  -- upsertSocialUser() targets, so it is load-bearing rather than defensive:
  -- without it a repeat sign-in inserts a duplicate row instead of touching
  -- last_login_at.
  unique (provider, provider_user_id)
);

-- The read on every social sign-in is by (provider, provider_user_id), which
-- the unique constraint above already indexes. This one covers the other
-- direction: listing a user's linked accounts on the settings page.
create index if not exists idx_social_identities_user on social_identities(user_id);

-- RLS on with no policy, matching otp_codes in migrate.sql. The backend uses
-- the service role key, which bypasses RLS; anything holding only the anon
-- key has no business reading which accounts a person has linked.
alter table social_identities enable row level security;

-- ── Backfill ─────────────────────────────────────────────────────
-- Nothing to backfill. The old code path could never complete an exchange
-- (it redeemed provider codes through supabase.auth.exchangeCodeForSession,
-- which only understands codes Supabase itself issued), so no account was
-- ever created through social sign-in. Any user row that exists came in via
-- email OTP and will link its identity on first successful social sign-in.

-- ── Verify ───────────────────────────────────────────────────────
-- select count(*) from social_identities;
-- \d social_identities
