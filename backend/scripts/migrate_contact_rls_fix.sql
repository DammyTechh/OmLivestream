-- ============================================================
-- OmliveStream — Fix contact_submissions RLS for admin reads
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

-- The contact_submissions table has RLS enabled but no policy
-- that allows the service role used by the backend to SELECT.
-- This causes the admin contact inbox to return an error.

-- Step 1: Allow service role full access (backend uses service role key)
CREATE POLICY IF NOT EXISTS "service_role_all"
  ON contact_submissions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Step 2: Also allow anon INSERT so the public contact form still works
-- (only if not already present from migrate_v5)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'contact_submissions' AND policyname = 'anon_insert'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "anon_insert"
        ON contact_submissions
        FOR INSERT
        TO anon, authenticated
        WITH CHECK (true)
    $policy$;
  END IF;
END $$;

-- Step 3: Verify policies
SELECT policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'contact_submissions';
