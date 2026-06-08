/* =========================================================
 * auth.js — Supabase auth client + thin wrapper functions.
 *
 * Responsibilities:
 *   - Lazy-load the Supabase UMD bundle (vendor/supabase.js) on first use,
 *     so users who never sign in don't pay the bundle's ~30KB gzipped cost.
 *   - Singleton Supabase client (one per page lifetime).
 *   - Expose simple sign-in/sign-out/state functions.
 *   - Emit auth-state changes to subscribers (used by app.js to swap
 *     the header chip and by cloud-sync.js to start/stop syncing).
 *
 * Public API (all functions tolerate the "not configured" case — they
 * return safe no-op values so the rest of the app stays operational
 * even if SUPABASE_URL / SUPABASE_ANON_KEY are blank):
 *
 *   await ready()                      → boolean — config present + SDK loaded
 *   await signInWithMagicLink(email)   → { ok, error? }
 *   await signInWithGoogle()           → { ok, error? }
 *   await signOut()                    → void
 *   currentUser()                      → user object or null
 *   onAuthChange(fn)                   → unsubscribe()
 *   getClient()                        → SupabaseClient or null
 * ========================================================= */

import { SUPABASE_URL, SUPABASE_ANON_KEY, CLOUD_ENABLED } from "./supabase-config.js";

let client = null;
let user = null;
let loadPromise = null;
const listeners = new Set();

/* Inject vendor/supabase.js as a classic script (NOT a module) so that
 * `var supabase = (function(){...})()` at the top of the bundle attaches
 * to `window.supabase`. ES-module imports of the UMD would scope it and
 * we'd never see the global. Only loads once; subsequent calls await the
 * same promise. */
function loadSdk() {
  if (window.supabase) return Promise.resolve(window.supabase);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/supabase.js";
    s.async = true;
    s.onload = () => {
      if (window.supabase) resolve(window.supabase);
      else reject(new Error("supabase bundle loaded but window.supabase is missing"));
    };
    s.onerror = () => reject(new Error("failed to load vendor/supabase.js"));
    document.head.appendChild(s);
  });
  return loadPromise;
}

async function ensureClient() {
  if (!CLOUD_ENABLED) return null;
  if (client) return client;
  const sdk = await loadSdk();
  client = sdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,    // picks up #access_token=... on magic-link return
      storage: window.localStorage,
    },
  });

  // Seed cached user from any existing session, then wire up updates.
  const { data: sessionData } = await client.auth.getSession();
  user = sessionData?.session?.user || null;

  client.auth.onAuthStateChange((event, session) => {
    user = session?.user || null;
    for (const fn of listeners) {
      try { fn(user, event); } catch (e) { console.error("auth listener error:", e); }
    }
  });

  return client;
}

/* Returns true when both config values are filled in AND the SDK has loaded.
 * Callers that just want to know "can we show auth UI" should use CLOUD_ENABLED
 * directly from supabase-config.js — that's synchronous and avoids the SDK load. */
export async function ready() {
  if (!CLOUD_ENABLED) return false;
  await ensureClient();
  return !!client;
}

export function isCloudEnabled() {
  return CLOUD_ENABLED;
}

export function getClient() {
  return client;
}

export function currentUser() {
  return user;
}

/* Subscribe to auth-state changes. The callback receives (user, event)
 * where event is one of "SIGNED_IN", "SIGNED_OUT", "TOKEN_REFRESHED", etc.
 * Also fires immediately with the current user (or null) so consumers
 * don't need a separate initial read. */
export function onAuthChange(fn) {
  listeners.add(fn);
  // Fire once with the current cached user. When cloud is configured, defer
  // the synthetic INITIAL fire until ensureClient has loaded the restored
  // session — otherwise the account chip paints "Sign in" for a beat before
  // flipping to the user's email on the real onAuthStateChange callback.
  const fireInitial = () => {
    try { fn(user, "INITIAL"); } catch (e) { console.error("auth listener init error:", e); }
  };
  if (CLOUD_ENABLED) {
    ensureClient().then(fireInitial, fireInitial);
  } else {
    Promise.resolve().then(fireInitial);
  }
  return () => listeners.delete(fn);
}

/* Boot the client in the background so onAuthStateChange + cached user
 * are available shortly after page load — without forcing the SDK load
 * on first paint. Called from app.js once during init. */
export function boot() {
  if (!CLOUD_ENABLED) return;
  // Don't await; let it happen in the background.
  ensureClient().catch((e) => console.warn("auth boot failed:", e));
}

export async function signInWithMagicLink(email) {
  if (!CLOUD_ENABLED) return { ok: false, error: "Cloud not configured" };
  const c = await ensureClient();
  if (!c) return { ok: false, error: "Auth client unavailable" };
  const { error } = await c.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname,
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function signInWithGoogle() {
  if (!CLOUD_ENABLED) return { ok: false, error: "Cloud not configured" };
  const c = await ensureClient();
  if (!c) return { ok: false, error: "Auth client unavailable" };
  const { error } = await c.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: window.location.origin + window.location.pathname,
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function signOut() {
  if (!CLOUD_ENABLED) return;
  const c = await ensureClient();
  if (!c) return;
  await c.auth.signOut();
}
