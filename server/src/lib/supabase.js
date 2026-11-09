import { createClient } from '@supabase/supabase-js';
import env from '../config/env.js';

/**
 * Supabase clients.
 *  - `supabaseAnon`  : used for Supabase Auth flows (sign-in, session verification).
 *  - `supabaseAdmin` : server-only client using the SERVICE ROLE key.
 *                      This key must never reach the browser.
 *
 * Both are `null` until Supabase is configured through environment variables.
 */
export const supabaseAnon = env.supabaseConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

export const supabaseAdmin = env.serviceRoleConfigured
  ? createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

export default { supabaseAnon, supabaseAdmin };
