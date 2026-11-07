// ============================================================
// CountsFor — API Client
// Course data comes only from the catalog bundled with the frontend
// (data/courses.json, refreshed by the scraper).
// ============================================================

const LOCAL_DATA = 'data/courses.json';

function _bundledDataUrl(path) {
  const meta = typeof document !== 'undefined'
    ? document.querySelector('meta[name="cf-build"]')
    : null;
  const tag = (meta && meta.getAttribute('content')) || 'dev';
  return `${path}?v=${encodeURIComponent(tag)}`;
}

const _cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 min

async function _get(url) {
  if (_cache.has(url)) {
    const c = _cache.get(url);
    if (Date.now() - c.ts < CACHE_TTL) return c.data;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  const data = await res.json();
  _cache.set(url, { data, ts: Date.now() });
  return data;
}

// ── Main exported function ───────────────────────────────────
// Throws when the catalog cannot be loaded; App.loadData() catches it and
// shows the "Failed to load data" message.
async function fetchAllCourses() {
  let data;
  try {
    data = await _get(_bundledDataUrl(LOCAL_DATA));
  } catch (e) {
    throw new Error(`Could not load ${LOCAL_DATA} (${e.message})`);
  }
  const courses = (data && data.courses) || [];
  if (courses.length === 0) throw new Error(`${LOCAL_DATA} has no courses.`);
  return courses;
}

// ============================================================
// CountsFor Backend client — auth, flags, wishlist
// ============================================================
// The Python backend lives in /backend (routes are listed in README.md,
// section 10). Dev: http://localhost:5050 ; production: the Render URL. Override at runtime by setting window.CF_BACKEND_URL before
// app.js loads.

// Backend URL resolution, in priority order:
//   1. localStorage 'cf_backend_override' — manual escape hatch for odd setups
//      (e.g. localhost frontend against the production backend)
//   2. window.CF_BACKEND_URL — set before this script loads
//   3. localhost/127.0.0.1 hostname — local Flask dev server on :5050, so the
//      committed production meta never needs hand-editing for local dev
//   4. <meta name="cf-backend-url"> — the deployed production URL
//   5. hardcoded fallback
function getBackendUrl() {
  try {
    const override = (localStorage.getItem('cf_backend_override') || '').trim();
    if (override) return override.replace(/\/$/, '');
  } catch (e) { /* storage blocked — fall through */ }
  if (typeof window !== 'undefined' && window.CF_BACKEND_URL) {
    return String(window.CF_BACKEND_URL).replace(/\/$/, '');
  }
  const host = (typeof location !== 'undefined' ? location.hostname : '');
  if (host === 'localhost' || host === '127.0.0.1' || host === '') {
    // 5050, not 5000 — macOS AirPlay Receiver squats on 5000.
    return 'http://localhost:5050';
  }
  const meta = typeof document !== 'undefined'
    ? document.querySelector('meta[name="cf-backend-url"]')
    : null;
  const fromMeta = (meta && meta.getAttribute('content') || '').trim();
  if (fromMeta) return fromMeta.replace(/\/$/, '');
  return 'https://countsfor-summer-26.onrender.com';
}

/** True when index.html sets a production backend URL (not demo-only GH Pages). */
function isBackendConfigured() {
  const meta = typeof document !== 'undefined'
    ? document.querySelector('meta[name="cf-backend-url"]')
    : null;
  return !!(meta && (meta.getAttribute('content') || '').trim());
}

const CF_BACKEND_URL = getBackendUrl();

const CF_AUTH_TOKEN_KEY = 'cf_auth_token';

// Two buckets on purpose. localStorage survives a browser restart and backs the
// "Keep me signed in" opt-in; sessionStorage dies with the tab and is the default.
// Read checks localStorage first so a remembered session wins.
function getAuthToken() {
  try {
    return localStorage.getItem(CF_AUTH_TOKEN_KEY)
      || sessionStorage.getItem(CF_AUTH_TOKEN_KEY)
      || '';
  } catch { return ''; }
}

// Writes to whichever bucket already holds a token, so refreshed tokens do not
// silently downgrade a remembered session to a tab-only one.
function saveAuthToken(token) {
  if (!token) return;
  try {
    if (localStorage.getItem(CF_AUTH_TOKEN_KEY)) {
      localStorage.setItem(CF_AUTH_TOKEN_KEY, token);
      return;
    }
  } catch {}
  try { sessionStorage.setItem(CF_AUTH_TOKEN_KEY, token); } catch {}
}

// Must clear BOTH, or signing out leaves a 30-day token behind and the user
// cannot actually log out.
function clearAuthToken() {
  try { sessionStorage.removeItem(CF_AUTH_TOKEN_KEY); } catch {}
  try { localStorage.removeItem(CF_AUTH_TOKEN_KEY); } catch {}
}

// Public Google OAuth client ID. Set this in index.html via
// `<meta name="cf-google-client-id" content="…">` so it can ship to the
// browser without a build step. Falls back to the empty string (which
// triggers a clear UI error rather than silently breaking).
function getGoogleClientId() {
  const meta = typeof document !== 'undefined'
    ? document.querySelector('meta[name="cf-google-client-id"]')
    : null;
  return (meta && meta.getAttribute('content')) || '';
}

// Generic fetch wrapper:
//   - Always sends credentials so the session cookie is included.
//   - JSON in, JSON out (where applicable).
//   - Returns { ok, status, data, error } — never throws on HTTP errors so
//     callers can branch on status.
async function apiFetch(path, opts = {}) {
  const url = CF_BACKEND_URL.replace(/\/$/, '') + path;
  const init = {
    method: opts.method || 'GET',
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  };
  // Never hang forever on a cold-starting backend. Default covers a full
  // Render free-tier wake; callers with a local fallback pass something short.
  const timeoutMs = opts.timeoutMs || 75000;
  if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
    init.signal = AbortSignal.timeout(timeoutMs);
  }
  const authToken = getAuthToken();
  if (authToken) init.headers['Authorization'] = 'Bearer ' + authToken;
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return {
      ok: false,
      status: 0,
      error: timedOut ? 'timeout' : 'network',
      message: timedOut ? 'The server took too long to respond.' : e.message,
      data: null,
    };
  }
  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch { data = null; }
  }
  if (data && data.auth_token) saveAuthToken(data.auth_token);
  return {
    ok: res.ok,
    status: res.status,
    data,
    error: (!res.ok && data && data.error) || (res.ok ? null : 'http_' + res.status),
    message: (data && data.message) || null,
  };
}

// ── Auth ─────────────────────────────────────────────────────
async function apiSignInWithGoogle(credential) {
  return apiFetch('/api/auth/google', { method: 'POST', body: { credential } });
}
async function apiRegister(body) {
  return apiFetch('/api/auth/register', { method: 'POST', body });
}
async function apiLogin(body) {
  return apiFetch('/api/auth/login', { method: 'POST', body });
}
async function apiForgotPassword(email) {
  return apiFetch('/api/auth/forgot-password', { method: 'POST', body: { email } });
}
async function apiResetPassword(body) {
  return apiFetch('/api/auth/reset-password', { method: 'POST', body });
}
async function apiLogout()  {
  const r = await apiFetch('/api/auth/logout', { method: 'POST' });
  clearAuthToken();
  return r;
}
async function apiGetMe()   { return apiFetch('/api/me'); }
async function apiPatchMe(patch) {
  return apiFetch('/api/me', { method: 'PATCH', body: patch });
}

// ── Users (admin / area head) ────────────────────────────────
async function apiListUsers(query = '') {
  return apiFetch('/api/users' + (query ? '?' + query : ''));
}
async function apiPatchUser(id, patch) {
  return apiFetch('/api/users/' + encodeURIComponent(id), { method: 'PATCH', body: patch });
}

// ── Admin console ────────────────────────────────────────────
async function apiAdminOverview() {
  return apiFetch('/api/admin/overview');
}
async function apiAdminInsights(semester = '') {
  return apiFetch('/api/admin/insights' + (semester ? '?semester=' + encodeURIComponent(semester) : ''));
}
async function apiAdminSignIns(days = 7) {
  return apiFetch('/api/admin/sign-ins?days=' + encodeURIComponent(days));
}
async function apiAdminActivity(query = '') {
  return apiFetch('/api/admin/activity' + (query ? '?' + query : ''));
}

// ── Course catalog edits (read: everyone, write: admin) ──────
async function apiGetCourseOverrides() {
  // Short timeout: the catalog renders without edits rather than waiting on a cold backend.
  return apiFetch('/api/courses/overrides', { timeoutMs: 10000 });
}
async function apiAddCourse(body) {
  return apiFetch('/api/courses/overrides', { method: 'POST', body });
}
async function apiEditCourse(code, body) {
  return apiFetch('/api/courses/overrides/' + encodeURIComponent(code), { method: 'PATCH', body });
}
async function apiArchiveCourse(code) {
  return apiFetch('/api/courses/overrides/' + encodeURIComponent(code) + '/archive', { method: 'POST', body: {} });
}
async function apiRestoreCourse(code) {
  return apiFetch('/api/courses/overrides/' + encodeURIComponent(code) + '/restore', { method: 'POST', body: {} });
}
async function apiRevertCourse(code) {
  return apiFetch('/api/courses/overrides/' + encodeURIComponent(code), { method: 'DELETE' });
}

async function apiListStaffDirectory() {
  return apiFetch('/api/directory/entries');
}
async function apiAddStaffMember(body) {
  return apiFetch('/api/directory/entries', { method: 'POST', body });
}
async function apiUpsertDirectoryByEmail(body) {
  return apiFetch('/api/directory/entries/by-email', { method: 'PATCH', body });
}
async function apiRevokeDirectoryAccess(body) {
  return apiFetch('/api/directory/entries/revoke', { method: 'POST', body });
}
async function apiDeleteDirectoryEntry(id) {
  return apiFetch('/api/directory/entries/' + encodeURIComponent(id), { method: 'DELETE' });
}

async function fetchMinorCourses() {
  try {
    const res = await fetch('data/minor_courses.json');
    if (!res.ok) throw new Error('minor courses missing');
    return await res.json();
  } catch {
    return {};
  }
}

// ── Flags ────────────────────────────────────────────────────
async function apiCreateFlag(flag)        { return apiFetch('/api/flags', { method: 'POST', body: flag }); }
async function apiListFlags(query = '')   { return apiFetch('/api/flags' + (query ? '?' + query : '')); }
async function apiUpdateFlag(id, patch)   { return apiFetch('/api/flags/' + encodeURIComponent(id), { method: 'PATCH', body: patch }); }

// ── Wishlist ─────────────────────────────────────────────────
async function apiGetWishlist()                 { return apiFetch('/api/wishlist'); }
async function apiGetWishlistRoster()           { return apiFetch('/api/wishlist/roster'); }
async function apiAddWishlist(course_code, note) {
  const body = { course_code };
  if (note !== undefined) body.note = note;
  return apiFetch('/api/wishlist', { method: 'POST', body });
}
async function apiUpdateWishlistNote(course_code, note) {
  return apiFetch('/api/wishlist/' + encodeURIComponent(course_code), { method: 'PATCH', body: { note } });
}
async function apiRemoveWishlist(course_code)   { return apiFetch('/api/wishlist/' + encodeURIComponent(course_code), { method: 'DELETE' }); }

// ── Search analytics (peer popularity by major) ───────────────
async function apiRecordCourseSearch(course_code, semester_code) {
  return apiFetch('/api/search-analytics/events', {
    method: 'POST',
    body: { course_code, semester_code },
  });
}
async function apiGetPopularCourses(program, semester, limit) {
  const q = new URLSearchParams({ program, semester, limit: String(limit || 5) });
  // Short leash — the home screen already shows a local fallback list.
  return apiFetch('/api/search-analytics/popular?' + q.toString(), { timeoutMs: 8000 });
}

// ── Schedule plans (share + inbox) ────────────────────────────
async function apiGetPlans() {
  return apiFetch('/api/plans');
}
async function apiSharePlan(body) {
  return apiFetch('/api/plans/share', { method: 'POST', body });
}
async function apiCreatePlanShareLink(body) {
  return apiFetch('/api/plans/share-link', { method: 'POST', body });
}
async function apiAcceptPlanShare(token) {
  return apiFetch('/api/plans/accept-share', { method: 'POST', body: { token } });
}
