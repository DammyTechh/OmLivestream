-- ─────────────────────────────────────────────────────────────────
-- Recordings storage — one-time Supabase setup
-- Run ONCE in your Supabase SQL Editor.
--
-- Without this, every broadcast records and remuxes correctly and then fails
-- at the last step with:
--
--     "Bucket not found" · statusCode 404 · code: NoSuchBucket
--     msg: "Recording upload failed"
--
-- The live stream is unaffected — only the saved copy is lost.
-- ─────────────────────────────────────────────────────────────────

-- PRIVATE, unlike the avatars bucket.
--
-- A public bucket makes every object readable by anyone who can guess or
-- share the URL. Avatars are meant to be seen; a recording may be a church
-- service, a paid course, or an internal briefing, and the person who made it
-- did not agree to publish it to anyone holding a link.
--
-- The backend uses the service-role key, which bypasses RLS, so it can still
-- write here and mint short-lived signed URLs for playback.
insert into storage.buckets (id, name, public, file_size_limit)
values (
  'recordings',
  'recordings',
  false,
  -- 5 GB. A two-hour 1080p broadcast at the encoder's 4500 kbps lands near
  -- 4 GB, so this leaves headroom without allowing an unbounded upload.
  5368709120
)
on conflict (id) do update
  set public          = false,
      file_size_limit = excluded.file_size_limit;

drop policy if exists "Service role recordings all"    on storage.objects;
drop policy if exists "Owners read own recordings"     on storage.objects;
drop policy if exists "Owners delete own recordings"   on storage.objects;

-- The backend's key bypasses RLS, but stating the intent explicitly means this
-- keeps working if the key type ever changes.
create policy "Service role recordings all"
  on storage.objects
  using (bucket_id = 'recordings')
  with check (bucket_id = 'recordings');

-- Objects are stored as `{userId}/{streamId}/recording.mp4`, so the first path
-- segment is the owner. Comparing it to auth.uid() means a signed-in user can
-- reach their own recordings and no one else's, even if a URL leaks.
create policy "Owners read own recordings"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Owners delete own recordings"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

do $$ begin raise notice '✅ Recordings bucket ready (private, 5 GB limit)'; end $$;
