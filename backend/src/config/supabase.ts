import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import type { Database } from '../types/database';

/** Public client — anon key, RLS enforced. Use on protected routes after JWT verify. */
export const supabase = createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);

/** Admin client — service role, bypasses RLS. NEVER expose to frontend. */
export const supabaseAdmin = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
