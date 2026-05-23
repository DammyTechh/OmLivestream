-- ─────────────────────────────────────────────────────────────────
-- Avatar uploads — one-time Supabase setup
-- Run ONCE in your Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "Avatars are public"            on storage.objects;
drop policy if exists "Authenticated avatar uploads"  on storage.objects;
drop policy if exists "Authenticated avatar updates"  on storage.objects;
drop policy if exists "Authenticated avatar deletes"  on storage.objects;
drop policy if exists "Service role avatar all"       on storage.objects;

-- Service role (used by your backend with SUPABASE_SERVICE_ROLE_KEY) bypasses RLS,
-- but adding an explicit policy makes intent clear and works if you switch keys.
create policy "Service role avatar all"
  on storage.objects
  using (bucket_id = 'avatars')
  with check (bucket_id = 'avatars');

create policy "Avatars are public"
  on storage.objects for select
  to public
  using (bucket_id = 'avatars');

create policy "Authenticated avatar uploads"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars');

create policy "Authenticated avatar updates"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars');

create policy "Authenticated avatar deletes"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars');

do $$ begin raise notice '✅ Avatar bucket ready'; end $$;
