/* =========================================================
 * supabase-config.js — paste your Supabase project URL + anon key here.
 *
 * Where to find these values:
 *   1. Sign in at https://supabase.com
 *   2. Open your project
 *   3. Project Settings (gear icon, bottom left) → API
 *   4. Copy "Project URL"        → paste into SUPABASE_URL
 *   5. Copy "anon public" key    → paste into SUPABASE_ANON_KEY
 *
 * The anon key is safe to commit to a public repo. It's a PUBLISHABLE
 * client identifier; row-level security policies on the database
 * enforce that each signed-in user can only read/write their own rows.
 *
 * Until you fill these in, the app behaves exactly as before — local
 * storage only, no account UI shown. The Sign in button activates
 * automatically the moment both values are non-empty.
 * ========================================================= */

export const SUPABASE_URL = "https://mljzmdsenocheowstjks.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_SYp_vOM2hC3t-7puboyQKg_c0ZxXiDc";

/* Computed: true when both values are set. Used by auth.js to decide
 * whether to render the account UI at all. */
export const CLOUD_ENABLED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
