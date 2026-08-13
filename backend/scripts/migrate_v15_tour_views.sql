-- ════════════════════════════════════════════════════════════════════
--  v15 — first-run dashboard tour counter
-- ════════════════════════════════════════════════════════════════════
--
-- The dashboard now ships a guided walkthrough for new users. It should play
-- for a user's first few login sessions and then stop on its own, rather than
-- greeting them on every visit forever.
--
-- `tour_views` records how many sessions the walkthrough has been shown in.
-- The frontend calls POST /users/me/tour/viewed once per session while the
-- tour is still active, and the service increments this up to a hard ceiling
-- of 3 (three sessions: sign-up plus the next two logins). "Skip all tips"
-- pins it straight to 3. Once it reads 3 the tour never plays again — on any
-- device, because the count lives here rather than in the browser.
--
-- Safe to run repeatedly and safe to run against the live table:
--   • `add column if not exists` is a no-op if it already ran.
--   • NOT NULL DEFAULT 0 on Postgres 11+ is a metadata-only change — it does
--     not rewrite the table or take a long lock, so existing rows are not
--     touched beyond adopting the default.
--
-- Deliberately NOT back-filled to 3 for existing accounts: the intent is that
-- everyone currently on the platform also gets to discover the new dashboard
-- up to three times, and it lets the change be verified on a real, existing
-- login. If you would rather only brand-new sign-ups ever see it, run the
-- commented back-fill at the bottom once, right after this.

alter table users
  add column if not exists tour_views smallint not null default 0;

comment on column users.tour_views is
  'Login sessions the first-run dashboard walkthrough has played in. Capped at 3 in application code; 3 means retired. Set to 3 by "Skip all tips".';

-- Optional: retire the tour for everyone who already had an account, so only
-- new sign-ups ever see it. Leave commented unless that is what you want.
-- update users set tour_views = 3 where created_at < now();
