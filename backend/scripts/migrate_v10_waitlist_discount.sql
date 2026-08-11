-- ─────────────────────────────────────────────────────────────────
-- v10 — waitlist discount: 5% (was 50%), tracked per billing cycle
--
-- Run AFTER migrate_v9_performance.sql.
--
-- Three things change:
--
--  1. The discount rate drops from 50% to 5%. The rate itself lives in
--     discount_codes.discount_pct, but discount_type carried it in the name
--     ('six_month_50pct') and a CHECK constraint pinned that spelling, so the
--     rate could not be changed without a migration. Renamed to the
--     rate-agnostic 'six_month_pct' so the next change is a one-line edit.
--
--  2. subscriptions gains discount_cycles_remaining / discount_pct. Paystack
--     charges a fixed amount per subscription; it has no concept of "5% off
--     the first six charges". So we count the cycles ourselves: the webhook
--     decrements on each successful charge and stops discounting at zero.
--
--  3. discount_codes gains redeemed_by_reference, which makes redemption
--     idempotent — a replayed Paystack webhook can no longer burn a second
--     code, and the partial unique index makes double-spend impossible at the
--     database level rather than by hoping two requests don't interleave.
-- ─────────────────────────────────────────────────────────────────

begin;

-- ── 1. Rate-agnostic discount_type ───────────────────────────────
alter table discount_codes drop constraint if exists discount_codes_discount_type_check;

update discount_codes
   set discount_type = 'six_month_pct'
 where discount_type = 'six_month_50pct';

alter table discount_codes
  add constraint discount_codes_discount_type_check
  check (discount_type in ('first_month_free', 'six_month_pct'));

-- Existing unredeemed codes were minted at 50%. They were never chargeable —
-- /subscribe ignored discountCode entirely, so not one of them has ever
-- reduced a payment — and the advertised offer is now 5%. Reprice them so the
-- code, the email that carried it and the charge all agree.
update discount_codes
   set discount_pct = 5
 where discount_type = 'six_month_pct'
   and is_used = false;

-- ── 2. Per-cycle discount tracking on the subscription ───────────
alter table subscriptions
  add column if not exists discount_cycles_remaining integer not null default 0,
  add column if not exists discount_pct              integer,
  add column if not exists discount_code             text;

comment on column subscriptions.discount_cycles_remaining is
  'Billing cycles still entitled to discount_pct off. Decremented by the Paystack charge.success handler; 0 means charge full price.';

-- ── 3. Idempotent, race-free redemption ──────────────────────────
alter table discount_codes
  add column if not exists redeemed_by_reference text;

comment on column discount_codes.redeemed_by_reference is
  'Paystack transaction reference that consumed this code. Lets a replayed webhook recognise its own earlier redemption instead of rejecting or double-spending.';

-- A code may be redeemed by exactly one reference. Partial, so the many
-- unredeemed rows (all NULL) do not collide with each other.
create unique index if not exists idx_discount_redeemed_ref
  on discount_codes(redeemed_by_reference)
  where redeemed_by_reference is not null;

create index if not exists idx_discounts_unused
  on discount_codes(user_id) where is_used = false;

commit;
