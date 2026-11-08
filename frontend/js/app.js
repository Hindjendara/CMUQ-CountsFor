// ============================================================
// CountsFor — Main Application (Progressive Disclosure)
// ============================================================

const HOME_POPULAR_COURSES = ['15-122', '21-120', '36-200', '67-250', '82-112'];
const HOME_SEARCH_CHIPS = ['15-122', 'Contextual Thinking', 'Intercultural and Global Inquiry', 'Probability'];
const HOME_RECENT_MAPPINGS = [
  { courses: '82-101 to 82-142', label: 'Modern Languages → IS/BA/BS/CS GenEd', major: 'IS', path: 'GenEd---GenEd---Foundations---Intercultural and Global Inquiry' },
  { courses: '79-286', label: 'Movers & Shakers → IS Contextual Thinking', major: 'IS', path: 'GenEd---GenEd---Foundations---Contextual Thinking' },
];

const App = {
  // State
  courses: [],
  courseIndex: {},
  trees: {},          // { CS: tree, IS: tree, BA: tree, BS: tree }
  treeSections: {},   // { CS: { degree, gened }, ... }

  layoutMode: 'focused', // 'focused' | 'split'
  activeMajor: 'CS',
  selectedCourse: null,
  treeSearchQuery: '',
  locationFilter: 'all', // 'all' | 'qatar' | 'pittsburgh'
  activeSemester: 'F26',
  modalityFilter: 'all', // 'all' | 'in_person' | 'remote' | 'hybrid'
  minorCourseList: {},
  theme: loadStore('cf_theme', 'light'),
  expandedNodes: new Set(),
  highlightedPath: null,
  mobileLens: 'lookup', // 'lookup' | 'map'

  profile: null,

  // ── Init ──────────────────────────────────────────────────
  // Auth-aware boot:
  //   1. GET /api/me — if 200 with a complete profile, route to main app.
  //   2. If 200 but profile is incomplete (missing role/program), show the
  //      existing onboarding flow but PATCH /api/me on completion.
  //   3. If 401, render the login screen.
  //   4. If the backend is unreachable, fall back to localStorage demo mode
  //      so the GH-Pages-only deploy keeps working.
  authedUser: null,             // server-confirmed user, or null in demo mode
  authMode: 'demo',             // 'authed' | 'demo' | 'login'
  isGuest: false,               // deliberate guest session (sessionStorage cf_guest)
  serverFlags: [],
  _pendingSharePlanToken: null,
  async init() {
    this.applyTheme();

    const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
    const sharePlanTok = params.get('share_plan') || '';
    if (sharePlanTok) this._pendingSharePlanToken = sharePlanTok;
    const resetTok = params.get('token') || params.get('reset') || '';
    if (resetTok) {
      const qs = params.get('token')
        ? `token=${encodeURIComponent(resetTok)}`
        : `reset=${encodeURIComponent(resetTok)}`;
      location.href = `index.html?${qs}`;
      return;
    }

    // Guest mode — entered deliberately from the landing. Skips the /api/me
    // probe (a sleeping free-tier backend would stall the guest for ~30s)
    // and boots straight into localStorage-only demo mode.
    if (this._readGuestFlag()) {
      this.isGuest = true;
      this.authMode = 'demo';
      this.profile = loadProfile() || { role: 'student', primary: 'CS', secondary: null, scope: null };
      try { saveProfile(this.profile); } catch (e) { /* keep going with the in-memory profile */ }
      this._afterAuthed();
      return;
    }

    const me = await apiGetMe();
    if (me.ok) {
      this._afterSignIn(me.data);
      return;
    }

    if (me.status === 0) {
      if (isBackendConfigured()) {
        this._redirectToLogin();
        return;
      }
      // No backend configured — demo mode preserves the public GH-Pages experience.
      this.authMode = 'demo';
      this.profile = loadProfile();
      if (!this.profile) {
        this.renderOnboarding(false);
        return;
      }
      this._afterAuthed();
      return;
    }

    // 401 / 403 / etc. — send to Heritage landing for sign-in.
    if (isBackendConfigured()) {
      this._redirectToLogin();
      return;
    }

    this.authMode = 'demo';
    this.profile = loadProfile();
    if (!this.profile) {
      this.renderOnboarding(false);
      return;
    }
    this._afterAuthed();
  },

  _redirectToLogin() {
    if (this._pendingSharePlanToken) {
      try { sessionStorage.setItem('cf_pending_share_plan', this._pendingSharePlanToken); } catch {}
      location.href = 'index.html?share_plan=' + encodeURIComponent(this._pendingSharePlanToken);
      return;
    }
    location.href = 'index.html';
  },

  _restorePendingSharePlan() {
    if (this._pendingSharePlanToken) return;
    try {
      const stored = sessionStorage.getItem('cf_pending_share_plan');
      if (stored) {
        this._pendingSharePlanToken = stored;
        sessionStorage.removeItem('cf_pending_share_plan');
        return;
      }
    } catch {}
    try {
      const tok = new URLSearchParams(location.search).get('share_plan');
      if (tok) this._pendingSharePlanToken = tok;
    } catch {}
  },

  _afterAuthed() {
    if (this.profile && this.profile.primary && this.profile.primary !== 'AS') {
      this.activeMajor = this.profile.primary;
    }
    this.renderShell();
    this.bindGlobalEvents();
    // Best-effort one-time migration of localStorage data (idempotent on the
    // server — duplicate IDs / course codes return existing rows).
    this._syncLocalToServer();
    this._restorePendingSharePlan();
    this._loadServerPlans().then(() => this._handlePendingSharePlanLink());
    this.loadData();
  },

  // Push any local-only flags / wishlist entries to the backend after sign-in.
  // The server endpoints are idempotent so re-running this is safe.
  async _syncLocalToServer() {
    if (this.authMode !== 'authed' || !this.authedUser) return;
    const roleGroup = this.authedUser.role_group
      || (this.authedUser.role === 'student' ? 'student' : 'faculty');
    const role = this.authedUser.role;
    const synced = loadStore('cf_synced', false);

    // Flags — faculty / admin only (server assigns role_group; never trust client storage)
    if (roleGroup === 'faculty' && role !== 'student' && !synced) {
      const flags = this._getFlags();
      for (const f of flags) {
        const r = await apiCreateFlag(f);
        if (!r.ok && r.status !== 200 && r.status !== 201) {
          // Keep the local copy and bail — don't mark synced.
          return;
        }
      }
    }

    // Wishlist — student only
    if (roleGroup === 'student' && role === 'student' && !synced) {
      const items = this._getWishlistItems();
      for (const item of items) {
        await apiAddWishlist(item.course_code, item.note);
      }
      // Pull the canonical server list back so future renders reflect any
      // additions from another device.
      const r = await apiGetWishlist();
      if (r.ok && Array.isArray(r.data.items)) {
        this._saveWishlistItems(r.data.items.map(i => ({
          course_code: i.course_code,
          note: i.note || '',
        })));
      }
    }

    if (this.authMode === 'authed') {
      await this._loadServerFlags();
    }

    saveStore('cf_synced', true);
  },

  async _loadServerFlags() {
    if (this.authMode !== 'authed') return;
    const r = await apiListFlags('limit=200');
    if (r.ok && Array.isArray(r.data.items)) {
      this.serverFlags = r.data.items;
    }
  },

  _needsOnboarding(u) {
    if (!u || !u.role) return true;
    if (!u.profile_completed) return true;
    if (getRoleGroup(u) === 'student' && !u.primary_program) return true;
    if (getRoleGroup(u) !== 'student' && (!u.department || !u.primary_program)) return true;
    return false;
  },

  _hydrateProfileFromServer(u) {
    // Mirror the server user into the legacy `this.profile` shape so the
    // rest of the app keeps working unchanged.
    if (!u) { this.profile = null; return; }
    const scope = u.advisor_scope || null;
    let primary = u.primary_program || null;
    let secondary = null;
    let secondaries = Array.isArray(u.minor_codes) ? u.minor_codes.filter(Boolean) : [];
    if (!secondaries.length && u.minor_code) secondaries = [u.minor_code];
    secondary = secondaries[0] || null;
    // Advisor-minor scope stores the minor code in `primary` (per profile.js).
    if (u.role === 'advisor' && scope === 'minor' && u.minor_code) {
      primary = u.minor_code;
      secondary = null;
      secondaries = [];
    }
    this.profile = {
      role: u.role,
      primary,
      secondary,
      secondaries,
      scope,
    };
    // Server is source of truth in authed mode — keep localStorage aligned.
    if (this.authMode === 'authed' && u.profile_completed && validateProfile(this.profile)) {
      try { saveProfile(this.profile); } catch {}
    }
  },

  // ── Theme ─────────────────────────────────────────────────
  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.theme);
    const btn = document.getElementById('themeBtn');
    if (btn) btn.textContent = this.theme === 'dark' ? '☀️' : '🌙';
  },
  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    saveStore('cf_theme', this.theme);
    this.applyTheme();
  },

  // ── Data Loading ──────────────────────────────────────────
  /** Load the scraped catalog, apply admin course edits, then index and build trees. */
  async _prepareCatalog() {
    const courses = await fetchAllCourses();
    let overrides = [];
    if (isBackendConfigured()) {
      const r = await apiGetCourseOverrides();
      if (r.ok && r.data) overrides = r.data.items || [];
      else console.warn('[CountsFor] Course edits unavailable; showing the scraped catalog.', r.error);
    }
    const applied = applyCourseOverrides(courses, overrides);
    this.courses = applied.courses;
    this._archivedCourses = applied.archived;
    this.courseIndex = buildCourseIndex(this.courses);
    if (!this.minorCourseList) {
      try {
        this.minorCourseList = await fetchMinorCourses();
      } catch {
        this.minorCourseList = {};
      }
    }

    // Profile-aware annotations
    annotateDoubleCounters(this.courses, this.profile, this.minorCourseList);
    annotateMultiProgram(this.courses);

    // Build trees for each major
    for (const m of MAJOR_ORDER) {
      const raw = buildRequirementTree(this.courses, m);
      this.trees[m] = normalizeTree(raw, m, 0);
      this.treeSections[m] = splitTreeSections(this.trees[m], m);
    }
  },

  async loadData() {
    const body = document.getElementById('leftBody');
    const rBody = document.getElementById('rightBody');
    if (body) body.innerHTML = '<div class="empty-state"><div class="spinner"></div><div class="empty-text" style="margin-top:12px">Loading 1,700+ courses…</div></div>';
    if (rBody) rBody.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';

    try {
      await this._prepareCatalog();

      // Auto-expand first level of the default major
      this.autoExpandFirstLevel(this.activeMajor);

      // The navbar is rendered before the catalog finishes loading, so the semester
      // picker was built from an empty course list. Refresh it now that we know which
      // semesters actually have offerings.
      this._refreshSemesterOptions();

      this.renderLeftEmpty();
      this.renderTree();
    } catch (err) {
      console.error(err);
      // Look #leftBody up again: renderLeftEmpty() may have re-rendered the shell.
      const failBody = document.getElementById('leftBody');
      if (failBody) failBody.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-text">Failed to load data: ${esc(err.message)}</div></div>`;
    }
  },

  autoExpandFirstLevel(major) {
    const sections = this.treeSections[major];
    if (!sections) return;
    for (const node of [...sections.degree, ...sections.gened]) {
      this.expandedNodes.add(major + '::' + node.path);
    }
    // GenEd → Foundations → leaf categories (e.g. IGI) visible without extra clicks
    for (const node of sections.gened || []) {
      this._expandTreePaths(major, node, 3);
    }
  },

  _expandTreePaths(major, node, maxDepth, depth = 0) {
    if (!node || depth > maxDepth) return;
    if (node.path) this.expandedNodes.add(major + '::' + node.path);
    for (const child of node.children || []) {
      this._expandTreePaths(major, child, maxDepth, depth + 1);
    }
  },

  // ══════════════════════════════════════════════════════════
  // ONBOARDING
  // ══════════════════════════════════════════════════════════

  _onboardingState: {
    role: null,
    roleGroup: null,
    scope: null,
    primary: null,
    secondary: null,
    secondaries: [],
    isEdit: false,
  },

  renderOnboarding(isEdit) {
    // Self-service onboarding is STUDENT-ONLY. Faculty/staff roles come from
    // the seed file or an admin (users.py), never self-selection — so a
    // student can't claim to be faculty. Rostered/seeded faculty and admins
    // arrive with a complete profile and skip this screen entirely; editRole()
    // also blocks them.
    const p = this.profile;
    const keepStudent = !!(p && p.role === 'student');
    this._onboardingState = {
      role:         'student',
      roleGroup:    'student',
      scope:        null,
      primary:      keepStudent ? p.primary : null,
      secondary:    keepStudent ? (getProfileMinors(p)[0] || null) : null,
      secondaries:  keepStudent ? getProfileMinors(p) : [],
      isEdit: !!isEdit,
    };
    this._renderOnboardingScreen();
  },

  _renderOnboardingScreen() {
    const s = this._onboardingState;

    // Self-service onboarding is student-only (see renderOnboarding): always
    // show the major picker, and the minor picker once a major is chosen.
    const majorSel       = (m) => s.primary === m ? 'selected' : '';

    const showMajorPicker = true;
    const showASOption    = false;             // students never pick Arts & Sciences
    const showMinorSelect = !!s.primary;

    // Validation — drives Continue button enablement.
    const candidate = {
      role: s.role,
      primary: s.primary,
      secondary: s.secondaries[0] || null,
      secondaries: s.roleGroup === 'student' ? s.secondaries : [],
      scope: s.scope,
    };
    const valid = !!s.role && validateProfile(candidate);

    const cancelHtml = s.isEdit
      ? '<button class="onboarding-cancel" onclick="App._cancelOnboarding()">Cancel</button>'
      : '';

    const majorBtns = MAJOR_LIST.map(p => {
      const pending = isProgramDataPending(p) ? '<span class="ob-pill-pending">data soon</span>' : '';
      return `<button class="ob-pill ${majorSel(p)}" onclick="App._obPickMajor('${p}')">${p}${pending}<span class="ob-pill-sub">${this._programFullName(p)}</span></button>`;
    }).join('');

    let asOptionHtml = '';
    if (showASOption) {
      const isASSelected = s.primary === 'AS';
      asOptionHtml = `<button class="ob-pill ob-pill-wide ${isASSelected ? 'selected' : ''}" onclick="App._obPickMajor('AS')">Arts &amp; Sciences<span class="ob-pill-sub">Cross-program grouping</span></button>`;
    }

    // Minor(s) — multi-add for students; single select for advisor-minor scope
    const studentMinors = s.secondaries || [];
    const minorPickOptions = MINOR_LIST.filter(m => {
      if (s.roleGroup !== 'student') return true;
      if (MAJOR_TO_MINOR_CODE[s.primary] === m.code) return false;
      return !studentMinors.includes(m.code);
    }).map(m => `<option value="${m.code}">${esc(m.label)}</option>`).join('');

    const minorChips = studentMinors.map(mc => `
      <span class="ob-minor-chip">${esc(getMinorLabel(mc))}
        <button type="button" class="ob-minor-chip-x" aria-label="Remove minor" onclick="App._obRemoveMinor('${mc}')">×</button>
      </span>`).join('');

    const advisorMinorOptions = MINOR_LIST.map(m => {
      const sel = s.primary === m.code ? 'selected' : '';
      return `<option value="${m.code}" ${sel}>${esc(m.label)}</option>`;
    }).join('');

    const majorLabel = 'MAJORING IN';

    document.getElementById('app').innerHTML = `
      <div class="auth-page auth-page-compact">
        <main class="auth-page-main auth-page-main--solo">
          <div class="auth-page-card">
            <div class="auth-panel-head">
              <p class="auth-panel-eyebrow">Almost there</p>
              <h2 class="auth-panel-title">Your major &amp; minor</h2>
              <p class="auth-panel-lead">We'll show you the courses that matter for your degree.</p>
            </div>

      ${showMajorPicker ? `
        <div class="ob-section">
          <div class="ob-section-label">${majorLabel}</div>
          <div class="ob-row-majors">${majorBtns}</div>
          ${asOptionHtml}
        </div>
      ` : ''}

      ${showMinorSelect && s.roleGroup === 'student' ? `
        <div class="ob-section">
          <div class="ob-section-label">MINOR(S) <span class="ob-optional">(optional)</span></div>
          ${minorChips ? `<div class="ob-minor-chips">${minorChips}</div>` : ''}
          <div class="ob-select-wrap ob-minor-add-row">
            <select class="ob-select" id="obMinorPick" onchange="App._obAddMinor(this.value); this.value='';">
              <option value="">Add a minor…</option>
              ${minorPickOptions}
            </select>
          </div>
        </div>
      ` : ''}

      ${showMinorSelect && s.roleGroup !== 'student' ? `
        <div class="ob-section">
          <div class="ob-section-label">WHICH MINOR</div>
          <div class="ob-select-wrap">
            <select class="ob-select" onchange="App._obPickMinor(this.value)">
              <option value="" ${!s.primary ? 'selected' : ''}>Choose a minor</option>
              ${advisorMinorOptions}
            </select>
          </div>
        </div>
      ` : ''}

      <button class="onboarding-continue auth-submit" ${valid ? '' : 'disabled'} onclick="App._finishOnboarding()">Continue →</button>
          </div>
        </main>
        ${cancelHtml}
      </div>`;
  },

  _programFullName(p) {
    return PROGRAM_FULL_NAME[p] || p;
  },

  _obPickMajor(program) {
    const s = this._onboardingState;
    s.primary = program;
    if (s.roleGroup === 'student') {
      const blocked = MAJOR_TO_MINOR_CODE[s.primary];
      s.secondaries = (s.secondaries || []).filter(mc => mc !== blocked);
      s.secondary = s.secondaries[0] || null;
    }
    this._renderOnboardingScreen();
  },

  _obAddMinor(code) {
    const s = this._onboardingState;
    if (!code || s.roleGroup !== 'student') return;
    if (MAJOR_TO_MINOR_CODE[s.primary] === code) return;
    s.secondaries = s.secondaries || [];
    if (s.secondaries.includes(code)) return;
    s.secondaries.push(code);
    s.secondary = s.secondaries[0] || null;
    this._renderOnboardingScreen();
  },

  _obRemoveMinor(code) {
    const s = this._onboardingState;
    s.secondaries = (s.secondaries || []).filter(mc => mc !== code);
    s.secondary = s.secondaries[0] || null;
    this._renderOnboardingScreen();
  },

  _obPickMinor(value) {
    const s = this._onboardingState;
    const v = value || null;
    if (s.roleGroup === 'student') s.secondary = v;
    this._renderOnboardingScreen();
  },

  async _finishOnboarding() {
    const s = this._onboardingState;
    const minors = s.roleGroup === 'student' ? (s.secondaries || []) : [];
    const profile = {
      role:      s.role,
      primary:   s.primary,
      secondary: minors[0] || null,
      secondaries: minors,
      scope:     s.role === 'advisor' ? s.scope : null,
    };
    if (!validateProfile(profile)) {
      console.error('invalid profile, refusing to save', profile);
      return;
    }
    saveProfile(profile);

    // If signed in, persist to the backend too (source of truth in authed mode).
    if (this.authMode === 'authed') {
      // Map onboarding state → server schema. Advisor-minor stores minor in
      // `primary` locally; on the server we keep them in separate columns.
      const serverPatch = { role: profile.role };
      if (profile.role === 'advisor' && profile.scope === 'minor') {
        serverPatch.advisor_scope = 'minor';
        serverPatch.minor_code = profile.primary;
        serverPatch.primary_program = null;
      } else if (profile.role === 'advisor') {
        serverPatch.advisor_scope = profile.scope;
        serverPatch.primary_program = profile.primary;
        serverPatch.minor_code = null;
      } else if (profile.role === 'student') {
        serverPatch.primary_program = profile.primary;
        serverPatch.minor_codes = getProfileMinors(profile);
        serverPatch.minor_code = null;
        serverPatch.advisor_scope = null;
      } else {
        serverPatch.primary_program = profile.primary;
        serverPatch.minor_code = null;
        serverPatch.advisor_scope = null;
      }
      // Admin role is env-driven — store program context without changing role.
      if (this.authedUser && this.authedUser.role === 'admin') {
        delete serverPatch.role;
      }
      const r = await apiPatchMe(serverPatch);
      if (!r.ok) {
        showToast('Could not save profile to the server. Using local copy.');
      } else {
        this.authedUser = r.data;
        this._hydrateProfileFromServer(r.data);
      }
    }

    const wasEdit = s.isEdit;
    this.profile = profile;
    if (this.profile.primary && this.profile.primary !== 'AS' && MAJOR_LIST.includes(this.profile.primary)) {
      this.activeMajor = this.profile.primary;
    }

    this.renderShell();
    this.bindGlobalEvents();

    if (wasEdit) {
      annotateDoubleCounters(this.courses, this.profile, this.minorCourseList);
      this.renderLeftEmpty();
      this.renderTree();
    } else {
      this.loadData();
    }
  },

  // ══════════════════════════════════════════════════════════
  // AUTH — sign-in result, guest mode, sign-out
  // ══════════════════════════════════════════════════════════

  _afterSignIn(user) {
    this.authedUser = user;
    this.authMode = 'authed';
    // Server is source of truth for role / role_group — UI branches via isFaculty(profile).
    if (this._needsOnboarding(user)) {
      clearProfile();
      this.profile = null;
      this.renderOnboarding(false);
      return;
    }
    this._hydrateProfileFromServer(user);
    this._afterAuthed();
  },

  _readGuestFlag() {
    try { return sessionStorage.getItem('cf_guest') === '1'; } catch { return false; }
  },

  // Guest → landing to sign in. Keeps cf_flags / cf_wishlist so the existing
  // _syncLocalToServer migration picks them up after a real sign-in.
  exitGuest() {
    try { sessionStorage.removeItem('cf_guest'); } catch {}
    location.href = 'index.html';
  },

  // Guest-only view switcher: flips the local profile between a student and
  // a cross-program faculty demo persona. Never touches the server.
  setGuestRole(kind) {
    if (!this.isGuest) return;
    const current = this.profile || {};
    const profile = kind === 'faculty'
      ? { role: 'professor', primary: 'AS', secondary: null, scope: null }
      : {
          role: 'student',
          primary: (current.role === 'student' && current.primary) || 'CS',
          secondary: current.role === 'student' ? (current.secondary || null) : null,
          scope: null,
        };
    try { saveProfile(profile); } catch {}
    this.profile = profile;
    if (profile.primary && profile.primary !== 'AS' && MAJOR_LIST.includes(profile.primary)) {
      this.activeMajor = profile.primary;
    }
    annotateDoubleCounters(this.courses, this.profile, this.minorCourseList);
    this.renderShell();
    this.bindGlobalEvents();
    this._refreshSemesterOptions();
    this.renderLeftEmpty();
    this.renderTree();
    showToast(kind === 'faculty'
      ? 'Faculty view. You can flag course issues (saved locally in guest mode).'
      : 'Student view. You can save courses to a wishlist.');
  },

  async signOut() {
    // Best-effort sync of any locally-saved-but-unsynced data BEFORE we
    // clear it. If the user is offline / backend unreachable, the sync
    // attempt will just no-op and we proceed to local cleanup.
    if (this.authMode === 'authed' && this.authedUser) {
      try { await this._syncLocalToServer(); } catch {}
    }

    await apiLogout();
    if (typeof clearAuthToken === 'function') clearAuthToken();
    // Belt and braces in case api.js did not load. Both buckets, because a
    // "Keep me signed in" token lives in localStorage and would otherwise survive
    // sign-out for its full 30 days.
    try { sessionStorage.removeItem('cf_auth_token'); } catch {}
    try { localStorage.removeItem('cf_auth_token'); } catch {}
    clearProfile();
    // Clear per-user local caches so a different account on the same browser
    // doesn't inherit them. The cf_synced flag must reset for next sign-in.
    try {
      localStorage.removeItem('cf_synced');
      localStorage.removeItem('cf_flags');
      localStorage.removeItem('cf_wishlist');
      sessionStorage.removeItem('cf_guest');
    } catch {}
    this.authedUser = null;
    this.authMode = 'login';
    this.profile = null;
    this.selectedCourse = null;
    location.href = 'index.html';
  },

  _cancelOnboarding() {
    if (!this._onboardingState.isEdit) return;  // not allowed during first-run
    this.renderShell();
    this.bindGlobalEvents();
    this.renderLeftEmpty();
    this.renderTree();
  },

  _roleBadgeHtml() {
    const p = this.profile;
    if (!p) return '';
    const PROGRAM_LABEL = { CS: 'CS', IS: 'IS', BA: 'BA', BS: 'BS', AI: 'AI', GS: 'GS', AS: 'A&S' };
    const meta = ROLE_META[p.role];
    const roleLabel = meta ? meta.label : p.role;

    // Admin — distinct badge, no program affiliation
    if (p.role === 'admin') {
      return `
        <button class="role-badge rb-ah" onclick="App.editRole()" title="Click to change role">
          <span class="rb-segment rb-primary">Admin <span class="rb-suffix">· Curriculum data</span></span>
          <span class="rb-edit-hint">Edit</span>
        </button>`;
    }

    // Area Head with no specific major (legacy "all programs" path)
    if (p.role === 'area_head' && (!p.primary || p.primary === 'AS')) {
      return `
        <button class="role-badge rb-ah" onclick="App.editRole()" title="Click to change role">
          <span class="rb-segment rb-primary">${esc(roleLabel)} <span class="rb-suffix">· All programs</span></span>
          <span class="rb-edit-hint">Edit</span>
        </button>`;
    }

    // Professor teaching A&S (cross-program faculty)
    if (p.role === 'professor' && p.primary === 'AS') {
      return `
        <button class="role-badge rb-as" onclick="App.editRole()" title="Click to change role">
          <span class="rb-segment rb-primary">Arts &amp; Sciences <span class="rb-suffix">· Faculty</span></span>
          <span class="rb-edit-hint">Edit</span>
        </button>`;
    }

    const primaryLower = (p.primary || '').toLowerCase();
    const secondaryLower = (p.secondary || '').toLowerCase();

    // Student with one or more minors
    const studentMinors = getProfileMinors(p);
    if (p.role === 'student' && studentMinors.length) {
      const cls = 'rb-' + primaryLower + (studentMinors.length === 1 ? '-' + studentMinors[0] : '-multi');
      if (studentMinors.length === 1) {
        const minorLabel = getMinorLabel(studentMinors[0]);
        return `
        <button class="role-badge rb-${primaryLower} ${cls}" onclick="App.editRole()" title="Click to change role">
          <span class="rb-segment rb-primary">${PROGRAM_LABEL[p.primary]} <span class="rb-suffix">major</span></span>
          <span class="rb-divider"></span>
          <span class="rb-segment rb-secondary">${esc(minorLabel)} <span class="rb-suffix">minor</span></span>
          <span class="rb-edit-hint">Edit</span>
        </button>`;
      }
      const minorLabels = studentMinors.map(mc => esc(getMinorLabel(mc))).join('<span class="rb-minor-sep"> · </span>');
      return `
        <button class="role-badge rb-${primaryLower} ${cls}" onclick="App.editRole()" title="Click to change role">
          <span class="rb-segment rb-primary">${PROGRAM_LABEL[p.primary]} <span class="rb-suffix">major</span></span>
          <span class="rb-divider"></span>
          <span class="rb-segment rb-secondary rb-secondary-compact">${minorLabels} <span class="rb-suffix">minors</span></span>
          <span class="rb-edit-hint">Edit</span>
        </button>`;
    }

    // Advisor — scope-aware badge
    if (p.role === 'advisor') {
      const scopeLabel = getAdvisorScopeLabel(p.scope);
      let targetLabel;
      if (p.scope === 'major' && p.primary) {
        targetLabel = `${PROGRAM_LABEL[p.primary]} Advisor`;
      } else if (p.scope === 'minor' && p.primary) {
        targetLabel = `${esc(getMinorLabel(p.primary))} minor advisor`;
      } else if (p.scope === 'arts_sciences') {
        targetLabel = 'Arts &amp; Sciences Advisor';
      } else {
        targetLabel = 'Advisor <span class="rb-suffix">· All programs</span>';
      }
      const cls = (p.scope === 'major' && p.primary) ? 'rb-' + p.primary.toLowerCase() : 'rb-ah';
      return `
        <button class="role-badge ${cls}" onclick="App.editRole()" title="Click to change role">
          <span class="rb-segment rb-primary">${targetLabel}</span>
          <span class="rb-edit-hint">Edit</span>
        </button>`;
    }

    // Faculty-with-assigned-program (not "major")
    if (isFaculty(p) && p.primary && getRoleGroup(p) !== 'student') {
      const progLabel = getProgramLabel(p.primary) || p.primary;
      return `
        <button class="role-badge rb-${primaryLower}" onclick="App.editRole()" title="Click to change role">
          <span class="rb-segment rb-primary">${esc(progLabel)} <span class="rb-suffix">${esc(roleLabel)}</span></span>
          <span class="rb-edit-hint">Edit</span>
        </button>`;
    }

    // Plain student (no minor) — fallback
    return `
      <button class="role-badge rb-${primaryLower}" onclick="App.editRole()" title="Click to change role">
        <span class="rb-segment rb-primary">${PROGRAM_LABEL[p.primary]} <span class="rb-suffix">major</span></span>
        <span class="rb-edit-hint">Edit</span>
      </button>`;
  },

  editRole() {
    // Admins and faculty have server-assigned roles (ADMIN_EMAILS / seed file
    // / users.py) and can't self-edit them. Show a non-destructive notice
    // instead of walking them through a student-only flow that would fail on
    // PATCH. Only students reach the editable onboarding.
    if (this.authedUser && this.authedUser.role === 'admin') {
      showToast('Admin role is managed via the ADMIN_EMAILS env var on the server.');
      return;
    }
    if (this.isGuest && isFaculty(this.profile)) {
      showToast('Use the Student/Faculty toggle in the guest bar to switch views.');
      return;
    }
    if (isFaculty(this.profile)) {
      showToast('Your role is set by the CountsFor admin. Contact them to change it.');
      return;
    }
    this.renderOnboarding(true);
  },

  _visibleMajors() {
    const vm = computeViewMode(this.profile);
    if (vm === 'cross-program') {
      const p = this.profile;
      // Advisor with minor scope: highlight the analogous major (if any).
      let leadMajor = null;
      if (p && p.role === 'advisor' && p.scope === 'minor') {
        leadMajor = MINOR_CODE_TO_MAJOR[p.primary] || null;
      } else if (p && p.primary && p.primary !== 'AS' && MAJOR_ORDER.includes(p.primary)) {
        leadMajor = p.primary;
      }
      if (leadMajor) return [leadMajor, ...MAJOR_ORDER.filter(m => m !== leadMajor)];
      return MAJOR_ORDER.slice();
    }
    if (vm === 'focused-dual') {
      const minorMajor = getMinorAsMajorCode(this.profile);
      return minorMajor ? [this.profile.primary, minorMajor] : [this.profile.primary];
    }
    if (vm === 'focused-single') return [this.profile.primary];
    return MAJOR_ORDER.slice();
  },

  _guestBannerHtml() {
    const fac = isFaculty(this.profile);
    return `
      <div class="guest-banner" role="status">
        <span class="guest-banner-badge">Guest mode</span>
        <span class="guest-banner-text">Exploring as</span>
        <div class="guest-banner-toggle">
          <button class="guest-role-btn ${!fac ? 'active' : ''}" onclick="App.setGuestRole('student')">Student</button>
          <button class="guest-role-btn ${fac ? 'active' : ''}" onclick="App.setGuestRole('faculty')">Faculty</button>
        </div>
        <span class="guest-banner-note">Saved locally on this device only</span>
        <button class="guest-banner-signin" onclick="App.exitGuest()">Sign in →</button>
      </div>`;
  },

  // ── Shell Rendering ───────────────────────────────────────
  renderShell() {
    const isSplit = this.layoutMode === 'split';
    const hasCourse = !!this.selectedCourse;
    const showPlanSearch = this._homeView === 'plan' && canUseSchedulePlan(this.profile);

    const headerHtml = (hasCourse || showPlanSearch) ? `
      <div class="panel-header">
        <div class="search-row">
          <div class="search-wrapper">
            <span class="search-icon">🔍</span>
            <input type="text" class="search-input" id="courseSearch" placeholder="${showPlanSearch && !hasCourse ? 'Search courses to add to your schedule…' : 'Try &quot;15-122&quot; or &quot;Probability&quot;'}" autocomplete="off" />
            <button type="button" class="search-clear" data-clear="courseSearch" aria-label="Clear search" hidden>&times;</button>
            <div class="typeahead" id="typeahead"></div>
          </div>
          <button class="explore-btn-inline" id="exploreInlineBtn" onclick="App.enterExplorer()" style="display:none;" title="Open requirement map"><span aria-hidden="true">🗂</span> <span class="explore-btn-inline-label">Explore other courses</span></button>
        </div>
      </div>
    ` : '';

    document.getElementById('app').innerHTML = `
      ${this.isGuest ? this._guestBannerHtml() : ''}
      <nav class="navbar">
        <div class="navbar-left-group">
          <div class="navbar-brand" onclick="App.reset()"><img class="navbar-scotty" src="assets/img/scotty-head.png" alt="" aria-hidden="true" /><span class="navbar-wordmark">CountsFor</span></div>
          ${this._roleBadgeHtml()}
          ${this._navbarWishlistHtml()}
          ${this._navbarPlanHtml()}
        </div>
        <div class="navbar-right">
          <div class="navbar-filters-wrap">
            <button type="button" class="navbar-filters-toggle" id="filtersToggle" onclick="App.toggleFiltersPopover()" aria-expanded="false" aria-controls="navbarFiltersPanel">Filters ▾</button>
            <div class="navbar-filters navbar-filters-panel" id="navbarFiltersPanel">
              <div class="navbar-semester">
                <label class="sr-only" for="semesterSelect">Semester</label>
                <select id="semesterSelect" class="semester-select" onchange="App.setSemester(this.value)">
                  ${availableSemesterOptions(this.courses, this.activeSemester).map(s => `<option value="${s.code}" ${this.activeSemester===s.code?'selected':''}>${esc(s.label)}</option>`).join('')}
                </select>
              </div>
              <div class="navbar-location-toggle">
                <button class="loc-btn ${this.locationFilter==='all'?'active':''}" onclick="App.setLocation('all')">All</button>
                <button class="loc-btn ${this.locationFilter==='qatar'?'active':''}" onclick="App.setLocation('qatar')">🇶🇦 Qatar</button>
                <button class="loc-btn ${this.locationFilter==='pittsburgh'?'active':''}" onclick="App.setLocation('pittsburgh')">🇺🇸 Pittsburgh</button>
              </div>
              <div class="navbar-modality-toggle">
                ${MODALITY_OPTIONS.map(m => `<button class="mod-btn ${this.modalityFilter===m.id?'active':''}" onclick="App.setModalityFilter('${m.id}')">${esc(m.label)}</button>`).join('')}
              </div>
            </div>
          </div>
          <button class="theme-toggle" id="themeBtn" onclick="App.toggleTheme()" title="Toggle theme">${this.theme==='dark'?'☀️':'🌙'}</button>
          ${canManageUsers(this.authedUser) ? '<button class="nav-admin" onclick="App.showAdminConsole()" title="Users, faculty access, flags, insights and the activity log">Admin</button>' : ''}
          ${(canFlagCourses(this.profile) && this.authMode === 'authed' && !canManageUsers(this.authedUser)) ? '<button class="nav-admin" onclick="App.showFlagReview()" title="Review and resolve course flags">Flag review</button>' : ''}
          ${(isFaculty(this.profile) && this.authMode === 'authed') ? '<button class="nav-admin" onclick="App.showStudentFavorites()" title="View student saved courses and notes">Student favorites</button>' : ''}
          ${this.authMode === 'authed' ? '<button class="nav-signout" onclick="App.signOut()" title="Sign out" aria-label="Sign out">Sign out</button>' : ''}
        </div>
      </nav>

      <div class="mobile-lens-toggle ${isSplit?'split-active':''}" id="mobileLensToggle">
        <button class="mobile-lens-btn ${this.mobileLens==='lookup'?'active':''}" onclick="App.setMobileLens('lookup')">🔍 Course Lookup</button>
        <button class="mobile-lens-btn ${this.mobileLens==='map'?'active':''}" onclick="App.setMobileLens('map')">🗂 Requirement Map</button>
      </div>

      <div class="main-layout ${isSplit?'layout-split':'layout-focused'}" id="mainLayout">
        <div class="panel panel-left ${isSplit && this.mobileLens==='map'?'hidden-mobile':''}" id="panelLeft">
          ${headerHtml}
          <div class="panel-body" id="leftBody"></div>
        </div>

        <div class="panel-resizer" id="panelResizer" role="separator" aria-orientation="vertical" aria-label="Resize panels, drag left or right" tabindex="0">
          <span class="panel-resizer-grip" aria-hidden="true"></span>
        </div>

        <div class="panel panel-right ${isSplit && this.mobileLens==='lookup'?'hidden-mobile':''}" id="panelRight">
          <div class="major-tabs" id="majorTabs">
            <div class="major-tabs-scroll">
              ${this._renderMajorTabs()}
            </div>
            <button class="panel-close" onclick="App.exitExplorer()" title="Close">&times;</button>
          </div>
          <div class="tree-search">
            <input type="text" id="treeSearchInput" placeholder="Filter requirements…" />
            <button type="button" class="search-clear" data-clear="treeSearchInput" aria-label="Clear filter" hidden>&times;</button>
          </div>
          <div class="panel-body" id="rightBody"></div>
        </div>
      </div>
      ${(canManageDirectory(this.profile) && this.authMode === 'authed') ? `
        <button type="button" class="directory-fab" onclick="App.toggleDirectoryPanel()" title="Directory: view and add faculty">📋 Directory</button>
        <div id="directoryPanelRoot" class="directory-panel-root" hidden></div>
      ` : ''}
    `;
    this.applyTheme();
    this._initPanelResizer();
    this._syncDirectoryFabLayout();
    if (this.courses && this.courses.length) {
      this._refreshSemesterOptions();
    }
  },

  _syncDirectoryFabLayout() {
    const onHome = !!document.querySelector('.home-foot');
    const onSplit = this.layoutMode === 'split';
    document.body.classList.toggle('view-home', onHome);
    document.body.classList.toggle('view-split', onSplit);
    const fab = document.querySelector('.directory-fab');
    if (!fab) return;
    if (onHome && !onSplit) {
      fab.style.bottom = window.innerWidth <= 768 ? '116px' : '96px';
    } else {
      fab.style.bottom = '';
    }
  },

  _initPanelResizer() {
    const resizer = document.getElementById('panelResizer');
    const layout = document.getElementById('mainLayout');
    if (!resizer || !layout) return;

    const saved = loadStore('cf_split_left_px', null);
    if (saved && Number(saved) > 0) {
      layout.style.setProperty('--split-left-width', saved + 'px');
    }
    if (resizer._panelResizeBound) return;

    const minPanel = 280;
    const resizerWidth = 12;
    let dragging = false;

    const clampSplit = (px) => {
      const max = layout.getBoundingClientRect().width - minPanel - resizerWidth;
      return Math.max(minPanel, Math.min(max, px));
    };

    const applySplit = (px) => {
      const clamped = clampSplit(px);
      layout.style.setProperty('--split-left-width', clamped + 'px');
      return clamped;
    };

    const onMove = (clientX) => {
      if (!dragging || this.layoutMode !== 'split') return;
      const rect = layout.getBoundingClientRect();
      applySplit(clientX - rect.left);
    };

    const stopDrag = () => {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove('is-dragging');
      document.body.classList.remove('is-resizing-panels');
      const val = layout.style.getPropertyValue('--split-left-width');
      const px = parseInt(val, 10);
      if (px > 0) saveStore('cf_split_left_px', px);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', stopDrag);
      document.removeEventListener('pointercancel', stopDrag);
    };

    const onPointerMove = (e) => {
      if (e.pointerId !== resizer._dragPointerId) return;
      e.preventDefault();
      onMove(e.clientX);
    };

    const startDrag = (e) => {
      if (this.layoutMode !== 'split' || window.innerWidth <= 860) return;
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      resizer._dragPointerId = e.pointerId;
      resizer.classList.add('is-dragging');
      document.body.classList.add('is-resizing-panels');
      onMove(e.clientX);
      try { resizer.setPointerCapture(e.pointerId); } catch {}
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', stopDrag);
      document.addEventListener('pointercancel', stopDrag);
    };

    resizer._panelResizeBound = true;

    resizer.addEventListener('pointerdown', startDrag);

    resizer.addEventListener('keydown', (e) => {
      if (this.layoutMode !== 'split') return;
      const step = e.shiftKey ? 48 : 16;
      const current = parseInt(layout.style.getPropertyValue('--split-left-width'), 10)
        || Math.round(layout.getBoundingClientRect().width * 0.42);
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const px = applySplit(current - step);
        saveStore('cf_split_left_px', px);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const px = applySplit(current + step);
        saveStore('cf_split_left_px', px);
      }
    });

    resizer.addEventListener('dblclick', () => {
      layout.style.removeProperty('--split-left-width');
      saveStore('cf_split_left_px', null);
    });
  },

  // ── Events ────────────────────────────────────────────────
  // Show the × clear button only while its search input has text
  _syncSearchClear(input) {
    if (!input || !input.id) return;
    const btn = document.querySelector(`.search-clear[data-clear="${input.id}"]`);
    if (btn) btn.hidden = !input.value;
  },

  _globalEventsBound: false,
  bindGlobalEvents() {
    if (this._globalEventsBound) return;
    this._globalEventsBound = true;
    document.addEventListener('input', (e) => {
      if (e.target.id === 'homeSearch') {
        this._setHomeSearchLoading(true);
        this.handleUnifiedSearch(e.target.value);
      }
      if (e.target.id === 'courseSearch') this.handleSearch(e.target.value);
      if (e.target.id === 'treeSearchInput') {
        this.treeSearchQuery = e.target.value.trim().toLowerCase();
        this.renderTree();
      }
      this._syncSearchClear(e.target);
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.id === 'homeSearch') this.handleUnifiedSearchKeydown(e);
      if (e.target.id === 'courseSearch') this.handleSearchKeydown(e);
    });

    document.addEventListener('click', (e) => {
      const clearBtn = e.target.closest('.search-clear');
      if (clearBtn) {
        const input = document.getElementById(clearBtn.getAttribute('data-clear'));
        if (input) {
          input.value = '';
          // Route through the delegated input handler so results/tree reset too
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        }
        return;
      }
      // Close typeaheads if clicking outside any search bar
      const insideSearch = e.target.closest('.search-wrapper, .home-hero-search');
      if (!insideSearch) {
        const ta = document.getElementById('typeahead');
        if (ta) ta.classList.remove('visible');
        const hta = document.getElementById('homeTypeahead');
        if (hta) hta.classList.remove('visible');
      }

      if (!e.target.closest('.home-dock, .home-dock-pill')) {
        document.querySelectorAll('.home-dock-pill.open').forEach(p => p.classList.remove('open'));
      }

      if (!e.target.closest('.navbar-filters-wrap')) {
        const pop = document.getElementById('navbarFiltersPanel');
        const toggle = document.getElementById('filtersToggle');
        if (pop) pop.classList.remove('open');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
      }

      // Per-row action buttons (wishlist / flag) — intercept BEFORE course-row click
      // so toggling the bookmark or opening the flag modal doesn't also navigate.
      const actionBtn = e.target.closest('[data-action]');
      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;
        const code = actionBtn.dataset.courseCode;
        if (action === 'download-req') {
          this.downloadRequirementExcel(actionBtn.dataset.treeMajor, actionBtn.dataset.treePath);
          return;
        }
        if (action === 'wishlist') this.toggleWishlist(code);
        if (action === 'flag')     this.openFlagModal(code);
        if (action === 'plan-toggle-section') {
          this.togglePlanSection(code, actionBtn.dataset.semesterCode, actionBtn.dataset.section, actionBtn.dataset.campus);
        }
        if (action === 'plan-remove-section') {
          this.removePlanSection(code, actionBtn.dataset.semesterCode, actionBtn.dataset.section, actionBtn.dataset.campus);
        }
        if (action === 'plan-remove') this.removeFromPlan(actionBtn.dataset.planId);
        if (action === 'plan-add-first') this.addFirstSectionToPlan(code);
        if (action === 'plan-open') this.openPlanDetail(actionBtn.dataset.planId);
        if (action === 'plan-create') this.createNewPlan();
        if (action === 'plan-delete') this.deletePlan(actionBtn.dataset.planId);
        if (action === 'plan-rename') this._promptRenamePlan(actionBtn.dataset.planId);
        if (action === 'plan-share') this.openSharePlanModal(actionBtn.dataset.planId);
        return;
      }

      // Handle cf-row clicks — enter explorer and navigate to the requirement
      const cfRow = e.target.closest('[data-nav-major]');
      if (cfRow) {
        const major = cfRow.dataset.navMajor;
        const path = cfRow.dataset.navPath;
        if (major && path) this.enterExplorer(major, path);
      }

      // Handle tree node toggle via data attributes
      const treeRow = e.target.closest('[data-tree-path]');
      if (treeRow && !e.target.closest('.tr-leaf')) {
        const major = treeRow.dataset.treeMajor;
        const path = treeRow.dataset.treePath;
        if (major && path) this.toggleNode(major, path);
      }

      // Handle tree course click (not wishlist note rows — those reuse course codes)
      const treeCourse = e.target.closest('[data-course-code]');
      if (treeCourse && !e.target.closest('[data-action]') && !e.target.closest('.wl-view')) {
        this.selectCourseFromTree(treeCourse.dataset.courseCode);
      }
    });

    // ESC closes modals / overlays
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeFlagModal();
        this.closeSharePlanModal();
        this.closeDirectoryPanel();
      }
    });
  },

  _filterParams() {
    return {
      semesterCode: this.activeSemester,
      locationFilter: this.locationFilter,
      modalityFilter: this.modalityFilter,
    };
  },

  /**
   * Rebuild the semester <select> in place from the loaded catalog. Done as a
   * targeted DOM update rather than a full navbar re-render so open panels and
   * focus are left alone.
   */
  _refreshSemesterOptions() {
    const sel = document.getElementById('semesterSelect');
    if (!sel) return;
    const opts = availableSemesterOptions(this.courses, this.activeSemester);
    if (this.activeSemester !== 'all' && !opts.some(s => s.code === this.activeSemester) && opts.length) {
      this.activeSemester = opts[1]?.code || opts[0].code;
    }
    sel.innerHTML = opts
      .map(s => `<option value="${s.code}" ${this.activeSemester === s.code ? 'selected' : ''}>${esc(s.label)}</option>`)
      .join('');
  },

  _campusFilterLabel() {
    if (this.locationFilter === 'qatar') return 'Qatar only';
    if (this.locationFilter === 'pittsburgh') return 'Pittsburgh only';
    return 'All campuses';
  },

  _modalityFilterLabel() {
    const hit = MODALITY_OPTIONS.find(m => m.id === this.modalityFilter);
    return hit ? hit.label : 'All';
  },

  /** Human-readable list of the filters currently narrowing results. */
  _activeFilterSummary() {
    const parts = [semesterLabel(this.activeSemester)];
    if (this.locationFilter !== 'all') parts.push(this._campusFilterLabel());
    if (this.modalityFilter !== 'all') parts.push(this._modalityFilterLabel());
    return parts;
  },

  // Search respects semester + campus + modality (same as requirement tree).
  // Retired numbers and Qatar-only courses not offered in Qatar never show.
  coursePassesSearchFilter(course) {
    if (!course || isCourseHidden(course)) return false;
    return courseHasMatchingOffering(course, this._filterParams());
  },

  /** Requirement tree respects semester + campus + modality. */
  coursePassesTreeFilter(course) {
    if (!course || isCourseHidden(course)) return false;
    return courseHasMatchingOffering(course, this._filterParams());
  },

  /** True when two stored course codes name the same course (old numbers resolve). */
  _sameCourse(a, b) {
    return sameCourseCode(this.courseIndex || {}, a, b);
  },

  _rankCourseCodeResults(results, qNorm) {
    return results.slice().sort((a, b) => {
      const ac = a.course_code.replace(/-/g, '').toLowerCase();
      const bc = b.course_code.replace(/-/g, '').toLowerCase();
      const aPref = ac.startsWith(qNorm) ? 0 : ac.includes(qNorm) ? 1 : 2;
      const bPref = bc.startsWith(qNorm) ? 0 : bc.includes(qNorm) ? 1 : 2;
      if (aPref !== bPref) return aPref - bPref;
      return ac.localeCompare(bc);
    });
  },

  _searchResultLimit(query) {
    const t = (query || '').trim();
    if (/^\d{1,2}-?\d{0,3}$/.test(t)) return 20;
    return 8;
  },

  _ensureExactCourseInResults(results, query) {
    const code = normalizeCourseCode((query || '').trim());
    if (!/^\d{1,2}-\d{2,4}$/.test(code)) return results;
    // An old number finds its current course; hidden courses stay hidden.
    const hit = lookupCourse(this.courseIndex, code);
    if (!hit || isCourseHidden(hit)) return results;
    const rest = results.filter(c => c.course_code !== hit.course_code);
    return [hit, ...rest];
  },

  setSemester(code) {
    this.activeSemester = code;
    this._refreshFilters();
    if (this._homeView === 'home') this._loadPopularCourses();
    if (this._homeView === 'plan') {
      if (this._planDetailId) this.openPlanDetail(this._planDetailId);
      else this.showPlanView();
    }
    showToast('Showing ' + semesterLabel(code));
  },

  setModalityFilter(mod) {
    this.modalityFilter = mod;
    document.querySelectorAll('.mod-btn').forEach(b => {
      b.classList.toggle('active', b.textContent.trim() === (MODALITY_OPTIONS.find(m => m.id === mod) || {}).label);
    });
    this._refreshFilters();
    const label = (MODALITY_OPTIONS.find(m => m.id === mod) || {}).label || mod;
    showToast('Modality: ' + label);
  },

  _refreshFilters() {
    if (this.selectedCourse) {
      if (!this.filterByLocation(this.selectedCourse) && (this.locationFilter !== 'all' || this.modalityFilter !== 'all')) {
        this.renderCourseCard(this.selectedCourse);
      } else {
        this.renderCourseCard(this.selectedCourse);
      }
    }
    this.renderTree();
  },

  // ── Location filter ───────────────────────────────────────
  setLocation(loc) {
    this.locationFilter = loc;
    document.querySelectorAll('.loc-btn').forEach(b => {
      b.classList.toggle('active', b.textContent.includes(loc === 'all' ? 'All' : loc === 'qatar' ? 'Qatar' : 'Pittsburgh'));
    });
    this._refreshFilters();
    showToast(loc === 'all' ? 'Showing all campuses' : loc === 'qatar' ? 'Showing Qatar only' : 'Showing Pittsburgh only');
  },

  filterByLocation(courseOrLeaf) {
    if (!courseOrLeaf) return true;
    const full = lookupCourse(this.courseIndex, courseOrLeaf.course_code || courseOrLeaf.code) || courseOrLeaf;
    return courseHasMatchingOffering(full, this._filterParams());
  },

  // ── Mobile lens toggle ────────────────────────────────────
  setMobileLens(lens) {
    this.mobileLens = lens;
    document.querySelectorAll('.mobile-lens-btn').forEach(b => {
      b.classList.toggle('active', (lens === 'lookup' && b.textContent.includes('Lookup')) || (lens === 'map' && b.textContent.includes('Map')));
    });
    document.getElementById('panelLeft').classList.toggle('hidden-mobile', lens === 'map');
    document.getElementById('panelRight').classList.toggle('hidden-mobile', lens === 'lookup');
  },

  reset() {
    this.selectedCourse = null;
    this._planDetailId = null;
    this._planCourseReturn = null;
    if (this.layoutMode === 'split') {
      this.exitExplorer();   // resets internal flags; the DOM mutations it makes get rebuilt by renderShell()
    }
    const input = document.getElementById('courseSearch');
    if (input) input.value = '';
    this.renderShell();        // re-render shell so the panel-header disappears
    this.renderLeftEmpty();
  },

  // ── Explorer Mode (progressive disclosure) ─────────────────
  enterExplorer(major, path) {
    if (this.layoutMode === 'split') {
      // Already in split mode — just navigate
      if (major && path) this.navigateToReqNode(major, path);
      return;
    }
    this.layoutMode = 'split';
    const layout = document.getElementById('mainLayout');
    if (layout) {
      layout.classList.remove('layout-focused');
      layout.classList.add('layout-split');
    }
    // Show mobile toggle
    const mobileToggle = document.getElementById('mobileLensToggle');
    if (mobileToggle) mobileToggle.classList.add('split-active');
    // Show right panel
    const rightPanel = document.getElementById('panelRight');
    if (rightPanel) rightPanel.style.display = 'flex';
    this._initPanelResizer();
    // Hide inline explore button in split mode
    const explBtn = document.getElementById('exploreInlineBtn');
    if (explBtn) explBtn.style.display = 'none';
    // Render tree if not yet rendered
    this.renderTree();
    this._syncDirectoryFabLayout();
    // Navigate to specific node if provided
    if (major && path) {
      setTimeout(() => this.navigateToReqNode(major, path), 100);
    }
  },

  exitExplorer() {
    this.layoutMode = 'focused';
    const layout = document.getElementById('mainLayout');
    if (layout) {
      layout.classList.remove('layout-split');
      layout.classList.add('layout-focused');
    }
    // Force-hide right panel so it doesn't leak below
    const rightPanel = document.getElementById('panelRight');
    if (rightPanel) rightPanel.style.display = 'none';
    // Hide mobile toggle
    const mobileToggle = document.getElementById('mobileLensToggle');
    if (mobileToggle) mobileToggle.classList.remove('split-active');
    // Ensure left panel is visible
    const leftPanel = document.getElementById('panelLeft');
    if (leftPanel) leftPanel.classList.remove('hidden-mobile');
    // Re-render the course card to show the Explore button again
    if (this.selectedCourse) this.renderCourseCard(this.selectedCourse);
    this._syncDirectoryFabLayout();
  },

  // ══════════════════════════════════════════════════════════
  // LEFT PANEL — COURSE LOOKUP
  // ══════════════════════════════════════════════════════════

  _searchIdx: -1,
  _searchResults: [],

  handleSearch: debounce(function(query) {
    const ta = document.getElementById('typeahead');
    if (!ta) return;
    const raw = query.trim();
    const q = raw.toLowerCase().replace(/-/g, '');
    if (q.length < 2) { ta.classList.remove('visible'); return; }

    let results = App.courses.filter(c => {
      const code = c.course_code.replace(/-/g, '').toLowerCase();
      const name = (c.course_name || '').toLowerCase();
      if (code.includes(q) || name.includes(q)) return true;
      // Search requirement paths and category names
      if (c.requirements) {
        for (const majorCode of MAJOR_ORDER) {
          const reqs = c.requirements[majorCode] || [];
          for (const req of reqs) {
            if (req.requirement && req.requirement.toLowerCase().includes(q)) return true;
          }
        }
      }
      // Search department name
      const dept = getDeptName(c.course_code).toLowerCase();
      if (dept.includes(q)) return true;
      return false;
    });

    // Semester + campus + modality
    results = results.filter(c => App.coursePassesSearchFilter(c));
    results = App._rankCourseCodeResults(results, q);
    results = App._ensureExactCourseInResults(results, raw);

    results = results.slice(0, App._searchResultLimit(query));
    App._searchResults = results;
    App._searchIdx = -1;

    if (results.length === 0) {
      ta.innerHTML = '<div class="typeahead-item" style="cursor:default;color:var(--text-tertiary);font-size:0.8rem;">No courses found</div>';
    } else {
      ta.innerHTML = results.map((c, i) => {
        // Show matching context for requirement/category searches
        let matchHint = '';
        const codeMatch = c.course_code.replace(/-/g, '').toLowerCase().includes(q);
        const nameMatch = (c.course_name || '').toLowerCase().includes(q);
        if (!codeMatch && !nameMatch && c.requirements) {
          for (const majorCode of MAJOR_ORDER) {
            const reqs = c.requirements[majorCode] || [];
            for (const req of reqs) {
              if (req.requirement && req.requirement.toLowerCase().includes(q)) {
                matchHint = '<span class="typeahead-hint">' + majorCode + ': ' + esc(requirementLeafLabel(req.requirement)) + '</span>';
                break;
              }
            }
            if (matchHint) break;
          }
        }
        const vm = computeViewMode(App.profile);
        let dcTag = '';
        if (vm === 'focused-dual' && c._doubleCounter) {
          const mm = getMinorAsMajorCode(App.profile);
          if (mm) dcTag = '<span class="tr-leaf-tag tr-leaf-tag-' + mm.toLowerCase() + '" style="margin-left:6px">' + mm + '</span>';
        }
        const inPlan = App._homeView === 'plan' && typeof canUseSchedulePlan === 'function' && canUseSchedulePlan(App.profile);
        const planBtn = inPlan
          ? `<button type="button" class="typeahead-plan-btn" data-action="plan-add-first" data-course-code="${esc(c.course_code)}" onclick="event.stopPropagation(); App.addFirstSectionToPlan('${esc(c.course_code)}')">+ Plan</button>`
          : '';
        return '<div class="typeahead-item typeahead-item-row" data-idx="' + i + '" onclick="App.selectSearchResult(' + i + ')">' +
          '<span class="typeahead-item-main">' +
          '<span class="typeahead-code">' + esc(c.course_code) + '</span>' +
          '<span class="typeahead-name">' + esc(c.course_name) + '</span>' +
          matchHint +
          dcTag +
          '</span>' +
          '<span class="typeahead-units">' + (c.units || '?') + ' u</span>' +
          planBtn +
        '</div>';
      }).join('');
    }
    ta.classList.add('visible');
  }, 180),

  handleSearchKeydown(e) {
    const ta = document.getElementById('typeahead');
    if (!ta || !ta.classList.contains('visible')) return;
    const items = ta.querySelectorAll('.typeahead-item[data-idx]');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._searchIdx = Math.min(this._searchIdx + 1, items.length - 1);
      items.forEach((it, i) => it.classList.toggle('focused', i === this._searchIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._searchIdx = Math.max(this._searchIdx - 1, 0);
      items.forEach((it, i) => it.classList.toggle('focused', i === this._searchIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this._searchIdx >= 0 && this._searchIdx < this._searchResults.length) {
        this.selectSearchResult(this._searchIdx);
      } else if (this._searchResults.length > 0) {
        this.selectSearchResult(0);
      }
    } else if (e.key === 'Escape') {
      ta.classList.remove('visible');
    }
  },

  _beginPlanCourseBrowse() {
    if (this._homeView !== 'plan') return;
    this._planCourseReturn = { planId: this._planDetailId || null };
  },

  _returnFromPlanCourseBrowse() {
    const ret = this._planCourseReturn;
    this._planCourseReturn = null;
    this.selectedCourse = null;
    const ta = document.getElementById('typeahead');
    if (ta) ta.classList.remove('visible');
    const input = document.getElementById('courseSearch');
    if (input) {
      input.value = '';
      this._syncSearchClear(input);
    }
    this.renderShell();
    if (this._homeView !== 'plan') this._homeView = 'plan';
    if (ret && ret.planId) this.openPlanDetail(ret.planId);
    else this.showPlanView();
  },

  _planBackLinkHtml() {
    if (this._planCourseReturn) {
      const plan = this._planCourseReturn.planId
        ? this._getPlanRecord(this._planCourseReturn.planId)
        : null;
      const label = plan ? `Back to ${plan.name}` : 'Back to schedules';
      return `<button type="button" class="dc-back-link" onclick="App._returnFromPlanCourseBrowse()">${esc(label)}</button>`;
    }
    return '';
  },

  _selectCourse(course) {
    if (this._homeView === 'plan') this._beginPlanCourseBrowse();
    if (!course) return;
    this._recordCourseSearch(course.course_code);
    const wasEmpty = !this.selectedCourse;
    this.selectedCourse = course;
    if (wasEmpty) this.renderShell();
    const input = document.getElementById('courseSearch');
    if (input) {
      input.value = course.course_code;
      this._syncSearchClear(input);
    }
    this.renderCourseCard(course);
  },

  selectSearchResult(idx) {
    const course = this._searchResults[idx];
    if (!course) return;
    const ta = document.getElementById('typeahead');
    if (ta) ta.classList.remove('visible');
    this._selectCourse(course);
  },

  // ── Category index (used by the unified home search) ──────
  _categoryIndex: null,
  _categoryResults: [],

  _buildCategoryIndex() {
    if (this._categoryIndex) return this._categoryIndex;
    const seen = new Map();
    for (const c of this.courses) {
      if (!c.requirements || isCourseHidden(c)) continue;
      for (const major of MAJOR_ORDER) {
        const reqs = c.requirements[major] || [];
        for (const req of reqs) {
          const path = req.requirement;
          if (!path) continue;
          const key = major + '|' + path;
          if (!seen.has(key)) {
            const parts = path.split('---');
            seen.set(key, {
              major,
              path,
              parts,
              leaf: parts[parts.length - 1],
              // What people see; leaf stays the raw segment for matching.
              label: requirementLeafLabel(path),
              count: 0
            });
          }
          seen.get(key).count++;
        }
      }
    }
    this._categoryIndex = Array.from(seen.values());
    return this._categoryIndex;
  },

  selectCategoryResult(idx) {
    const r = this._categoryResults[idx];
    if (!r) return;
    this.enterExplorer(r.major, r.path);
  },

  toggleFiltersPopover() {
    const panel = document.getElementById('navbarFiltersPanel');
    const toggle = document.getElementById('filtersToggle');
    if (!panel || !toggle) return;
    const open = panel.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  },

  // ── Unified home search (courses + categories) ────────────
  _unifiedResults: [],
  _unifiedIdx: -1,
  _unifiedBrowseMajor: 'CS',

  _isCourseCodeQuery(q) {
    const t = q.trim();
    return /^\d{1,2}-?\d{0,4}$/.test(t) || /^\d{2}-\d{3}/.test(t);
  },

  _setHomeSearchLoading(on) {
    const sp = document.getElementById('homeSearchSpinner');
    const wrap = document.querySelector('.home-hero-search');
    if (sp) sp.hidden = !on;
    if (wrap) wrap.classList.toggle('is-loading', !!on);
  },

  handleUnifiedSearch: debounce(function(query) {
    const ta = document.getElementById('homeTypeahead');
    if (!ta) return;
    App._setHomeSearchLoading(false);

    const q = query.trim().toLowerCase();
    const qNorm = q.replace(/-/g, '');
    if (q.length < 2) { ta.classList.remove('visible'); return; }

    const codeQuery = App._isCourseCodeQuery(query);
    let courseResults = App.courses.filter(c => {
      const code = c.course_code.replace(/-/g, '').toLowerCase();
      const name = (c.course_name || '').toLowerCase();
      if (code.includes(qNorm) || name.includes(q)) return true;
      const dept = getDeptName(c.course_code).toLowerCase();
      return dept.includes(q);
    }).filter(c => App.coursePassesSearchFilter(c));

    if (!codeQuery) {
      courseResults = courseResults.filter(c => {
        if (c.course_code.replace(/-/g, '').toLowerCase().includes(qNorm)) return true;
        if ((c.course_name || '').toLowerCase().includes(q)) return true;
        return false;
      });
    }

    courseResults = App._ensureExactCourseInResults(courseResults, query);
    courseResults = App._rankCourseCodeResults(courseResults, qNorm);
    const limit = App._searchResultLimit(query);
    courseResults = courseResults.slice(0, limit);
    App._searchResults = courseResults;

    const idx = App._buildCategoryIndex();
    let catResults = idx.filter(entry => {
      if (entry.leaf.toLowerCase().includes(q) || entry.label.toLowerCase().includes(q)) return true;
      return entry.parts.some(p => p.toLowerCase().includes(q));
    });
    const leafHit = e => (e.leaf.toLowerCase().includes(q) || e.label.toLowerCase().includes(q)) ? 0 : 1;
    catResults.sort((a, b) => {
      const aLeaf = leafHit(a);
      const bLeaf = leafHit(b);
      if (aLeaf !== bLeaf) return aLeaf - bLeaf;
      return b.count - a.count;
    });
    catResults = catResults.slice(0, 6);
    App._categoryResults = catResults;

    const flat = [];
    courseResults.forEach((c, i) => flat.push({ kind: 'course', idx: i }));
    catResults.forEach((r, i) => flat.push({ kind: 'category', idx: i }));
    App._unifiedResults = flat;
    App._unifiedIdx = -1;

    if (flat.length === 0) {
      const bm = App._unifiedBrowseMajor || 'CS';
      ta.innerHTML = '<div class="typeahead-empty">No matches, try the <button type="button" class="typeahead-browse-link" onclick="App.enterExplorer(\'' + bm + '\')">category browser</button></div>';
    } else {
      let html = '';
      if (courseResults.length) {
        html += '<div class="typeahead-group-label">Courses</div>';
        html += courseResults.map((c, i) => {
          return '<div class="typeahead-item" data-unified-idx="' + flat.findIndex(f => f.kind === 'course' && f.idx === i) + '" onclick="App.selectUnifiedResult(' + flat.findIndex(f => f.kind === 'course' && f.idx === i) + ')">' +
            '<span class="typeahead-code">' + esc(c.course_code) + '</span>' +
            '<span class="typeahead-name">' + esc(c.course_name) + '</span>' +
            '<span class="typeahead-units">' + (c.units || '?') + ' u</span>' +
          '</div>';
        }).join('');
      }
      if (catResults.length) {
        html += '<div class="typeahead-group-label">Categories</div>';
        html += catResults.map((r, i) => {
          const uidx = flat.findIndex(f => f.kind === 'category' && f.idx === i);
          return '<div class="typeahead-item" data-unified-idx="' + uidx + '" onclick="App.selectUnifiedResult(' + uidx + ')">' +
            '<span class="typeahead-cat-major typeahead-cat-major-' + r.major.toLowerCase() + '">' + r.major + '</span>' +
            '<span class="typeahead-name"><strong>' + esc(r.label) + '</strong></span>' +
            '<span class="typeahead-units">' + r.count + ' ' + (r.count === 1 ? 'course' : 'courses') + '</span>' +
          '</div>';
        }).join('');
      }
      ta.innerHTML = html;
    }
    ta.classList.add('visible');
  }, 180),

  handleUnifiedSearchKeydown(e) {
    const ta = document.getElementById('homeTypeahead');
    if (!ta || !ta.classList.contains('visible')) return;
    const items = ta.querySelectorAll('.typeahead-item[data-unified-idx]');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._unifiedIdx = Math.min(this._unifiedIdx + 1, items.length - 1);
      items.forEach((it, i) => it.classList.toggle('focused', i === this._unifiedIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._unifiedIdx = Math.max(this._unifiedIdx - 1, 0);
      items.forEach((it, i) => it.classList.toggle('focused', i === this._unifiedIdx));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this._unifiedIdx >= 0 && this._unifiedIdx < this._unifiedResults.length) {
        this.selectUnifiedResult(this._unifiedIdx);
      } else if (this._unifiedResults.length > 0) {
        this.selectUnifiedResult(0);
      }
    } else if (e.key === 'Escape') {
      ta.classList.remove('visible');
    }
  },

  selectUnifiedResult(uidx) {
    const item = this._unifiedResults[uidx];
    if (!item) return;
    const ta = document.getElementById('homeTypeahead');
    if (ta) ta.classList.remove('visible');
    if (item.kind === 'course') {
      this.selectSearchResult(item.idx);
      const input = document.getElementById('homeSearch');
      const course = this._searchResults[item.idx];
      if (input && course) input.value = course.course_code;
    } else {
      this.selectCategoryResult(item.idx);
      const input = document.getElementById('homeSearch');
      const cat = this._categoryResults[item.idx];
      if (input && cat) input.value = cat.label;
    }
  },

  runHomeSearchChip(text) {
    const input = document.getElementById('homeSearch');
    if (!input) return;
    input.value = text;
    input.focus();
    this._setHomeSearchLoading(true);
    this.handleUnifiedSearch(text);
  },

  toggleHomeDock(kind) {
    const pill = document.querySelector('.home-dock-pill[data-dock="' + kind + '"]');
    if (!pill) return;
    const wasOpen = pill.classList.contains('open');
    document.querySelectorAll('.home-dock-pill.open').forEach(p => p.classList.remove('open'));
    if (!wasOpen) pill.classList.add('open');
  },

  _refreshHomeDock() {
    if (this._homeView !== 'home') return;
    const slot = document.getElementById('homeDock');
    if (!slot) return;
    const html = this._renderHomeDock();
    if (!html) {
      slot.innerHTML = '';
      slot.classList.remove('has-dock');
    } else {
      slot.innerHTML = html;
      slot.classList.add('has-dock');
    }
  },

  renderLeftEmpty() {
    // No main shell on screen (onboarding or login): leave that screen alone.
    if (!document.getElementById('leftBody')) return;
    const wasPlan = this._homeView === 'plan';
    const hadCourse = !!this.selectedCourse;
    this._homeView = 'home';
    this._planDetailId = null;
    this._planCourseReturn = null;
    this.selectedCourse = null;
    // renderShell() replaces all of #app, so look #leftBody up only after it.
    // An element captured before it is detached and the panel would stay blank.
    if (wasPlan || hadCourse) this.renderShell();
    const el = document.getElementById('leftBody');
    if (!el) return;
    const explBtn = document.getElementById('exploreInlineBtn');
    if (explBtn) explBtn.style.display = 'none';
    el.innerHTML = this._renderHome();
    // Faculty home — flag queue summary; students — flagged courses read-only
    if (canFlagCourses(this.profile) && this.authMode === 'authed') {
      this._loadMyFlagsSummary();
    } else if (isStudent(this.profile) && this.authMode === 'authed') {
      this._loadStudentFlagsSummary();
    }
    this._loadPopularCourses();
    this._syncDirectoryFabLayout();
  },

  _popularProgram() {
    const p = this.profile && this.profile.primary;
    return (p && p !== 'AS') ? p : 'CS';
  },

  _localSearchStoreKey() {
    return 'cf_search_counts_' + this._popularProgram() + '_' + this.activeSemester;
  },

  _bumpLocalSearchCount(courseCode) {
    const code = normalizeCourseCode(courseCode);
    if (!code) return;
    const key = this._localSearchStoreKey();
    const counts = loadStore(key, {}) || {};
    counts[code] = (counts[code] || 0) + 1;
    saveStore(key, counts);
  },

  _getLocalPopularCourses(limit) {
    const counts = loadStore(this._localSearchStoreKey(), {}) || {};
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit || 5)
      .map(([code, count]) => ({ course_code: code, search_count: count }));
  },

  _recentSearchRecorded: {},

  _recordCourseSearch(courseCode) {
    const code = normalizeCourseCode(courseCode);
    if (!code) return;

    const now = Date.now();
    const last = this._recentSearchRecorded[code] || 0;
    if (now - last < 60000) return;
    this._recentSearchRecorded[code] = now;

    this._bumpLocalSearchCount(code);

    if (isStudent(this.profile) && this.authMode === 'authed') {
      apiRecordCourseSearch(code, this.activeSemester).catch(() => {});
    }

    if (this._homeView === 'home') {
      this._loadPopularCourses();
    }
  },

  async _loadPopularCourses() {
    const listEl = document.getElementById('homePopularList');
    const subEl = document.getElementById('homePopularSub');
    const cardEl = document.getElementById('homePopularCard');
    if (!listEl || !cardEl) return;

    const program = this._popularProgram();
    const semester = this.activeSemester;
    const limit = 5;

    // Sync pass: refresh from local/static immediately (semester or program
    // may have changed) — the card is never in a loading state.
    const local = this._getLocalPopularCourses(limit);
    const fallback = local.length ? local
      : HOME_POPULAR_COURSES.map(code => ({ course_code: code, search_count: 0 }));
    const fallbackRows = this._popularRowsHtml(fallback);
    if (fallbackRows.length) {
      cardEl.hidden = false;
      listEl.innerHTML = fallbackRows.join('');
      if (subEl) subEl.textContent = this._popularSubText(false, program);
    } else {
      cardEl.hidden = true;
    }

    // Async pass: upgrade in place when real peer data arrives.
    if (semester === 'all') return;
    const r = await apiGetPopularCourses(program, semester, limit);
    if (!r.ok || !r.data || !Array.isArray(r.data.items) || !r.data.items.length) return;
    // Stale-response guards: user may have switched semester or left home.
    if (this.activeSemester !== semester) return;
    const list = document.getElementById('homePopularList');
    if (!list) return;
    const rows = this._popularRowsHtml(r.data.items);
    if (!rows.length) return;
    list.innerHTML = rows.join('');
    const sub = document.getElementById('homePopularSub');
    if (sub) sub.textContent = this._popularSubText(true, program);
  },

  _renderHome() {
    const vm = computeViewMode(this.profile);
    const p = this.profile && this.profile.primary;
    const minorMajor = getMinorAsMajorCode(this.profile);

    const lead = 'See what it counts for: View every major requirement and General Education category it fulfills, side by side.';

    let browseSub;
    if (vm === 'focused-dual') browseSub = `${p} + ${minorMajor} requirement tree`;
    else if (vm === 'focused-single') browseSub = `${p} requirement tree`;
    else browseSub = `CS · IS · BA · BS requirement tree`;

    const browseMajor = (vm === 'cross-program') ? this.activeMajor : (p || this.activeMajor);
    this._unifiedBrowseMajor = browseMajor;

    const chipsHtml = HOME_SEARCH_CHIPS.map(c =>
      // Single-quote the JS string — JSON.stringify's double quotes would
      // terminate the double-quoted onclick attribute and kill the handler.
      `<button type="button" class="home-chip" onclick="App.runHomeSearchChip('${c.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')">${esc(c)}</button>`
    ).join('');

    const dockHtml = this._renderHomeDock();
    const quickStartHtml = this._renderQuickStart(browseMajor);

    return `
      <div class="home-page">
        <div class="home-main">
          <div class="home-main-spacer" aria-hidden="true"></div>
          <section class="home-hero" aria-label="Course search">
            <header class="home-hero-head">
              <h1 class="home-hero-title">Find a course.</h1>
              <span class="home-hero-accent" aria-hidden="true"></span>
              <p class="home-hero-lead">${lead}</p>
            </header>

            <div class="home-hero-search">
              <span class="home-search-icon" aria-hidden="true">🔍</span>
              <input type="search" class="home-search-input" id="homeSearch" placeholder="Search a course number, title, or category, e.g. 15-122 or Probability" autocomplete="off" enterkeyhint="search" />
              <button type="button" class="search-clear" data-clear="homeSearch" aria-label="Clear search" hidden>&times;</button>
              <span class="home-search-spinner" id="homeSearchSpinner" hidden aria-hidden="true"></span>
              <div class="typeahead home-typeahead" id="homeTypeahead"></div>
            </div>

            <div class="home-chips" aria-label="Example searches">${chipsHtml}</div>

            <div class="home-ghost-actions">
              <button type="button" class="home-primary-btn" onclick="App.enterExplorer('${browseMajor}')" title="Browse ${browseSub}">
                <span>Browse ${browseSub}</span>
              </button>
              ${canUseSchedulePlan(this.profile) ? `
              <button type="button" class="home-ghost-btn" onclick="App.showPlanView()" title="Build a weekly schedule from course sections">
                ${this._iconCalendar()}
                <span>Plan your schedule</span>
              </button>` : ''}
            </div>

            <div class="home-dock-slot ${dockHtml ? 'has-dock' : ''}" id="homeDock">${dockHtml}</div>
          </section>

          ${quickStartHtml}

          <div class="home-main-spacer home-main-spacer-bottom" aria-hidden="true"></div>
        </div>

        <footer class="home-foot">
          <a class="home-foot-logo" href="https://www.qatar.cmu.edu/" target="_blank" rel="noopener" aria-label="Carnegie Mellon University Qatar">
            <img src="assets/img/cmuq-wordmark.png" alt="" />
          </a>
          <span class="home-foot-note">A curriculum explorer for the CMU-Q community.</span>
        </footer>
      </div>
    `;
  },

  _renderHomeDock() {
    const pills = [];

    if (isStudent(this.profile)) {
      const saved = this._getWishlistItems();
      if (saved.length) {
        const items = saved.map(i => {
          const c = lookupCourse(this.courseIndex, i.course_code);
          const name = c ? c.course_name : '';
          return `<button type="button" class="home-dock-item" onclick="App.selectCourseFromTree('${esc(i.course_code)}')">${esc(i.course_code)}${name ? ' · ' + esc(name) : ''}</button>`;
        }).join('');
        pills.push(`
          <div class="home-dock-pill" data-dock="saved">
            <button type="button" class="home-dock-pill-btn" onclick="App.toggleHomeDock('saved')">
              ${this._iconBookmarkFilled()} <span>Saved ${saved.length}</span>
            </button>
            <div class="home-dock-drop">${items}<button type="button" class="home-dock-all" onclick="App.showWishlistView()">Open saved list</button></div>
          </div>`);
      }

      if (this.authMode === 'authed') {
        const st = this._studentFlagsState;
        if (st && st.loaded && (st.items || []).length) {
          const flags = st.items;
          const items = flags.map(f =>
            `<button type="button" class="home-dock-item" onclick="App.showStudentFlagsView()">${esc(f.course_code)}</button>`
          ).join('');
          pills.push(`
            <div class="home-dock-pill" data-dock="flagged">
              <button type="button" class="home-dock-pill-btn" onclick="App.toggleHomeDock('flagged')">
                <span aria-hidden="true">⚑</span> <span>Flagged ${flags.length}</span>
              </button>
              <div class="home-dock-drop">${items}<button type="button" class="home-dock-all" onclick="App.showStudentFlagsView()">View all</button></div>
            </div>`);
        }
      }
    }

    if (canFlagCourses(this.profile) && this.authMode === 'authed') {
      const st = this._myFlagsState;
      if (st && st.loaded && !st.error && st.counts) {
        const pending = st.counts.pending || 0;
        if (pending > 0) {
          const items = (st.items || []).filter(f => f.status === 'pending').slice(0, 8).map(f =>
            `<button type="button" class="home-dock-item" onclick="App.showFlagReview()">${esc(f.course_code)}</button>`
          ).join('');
          pills.push(`
            <div class="home-dock-pill" data-dock="flags">
              <button type="button" class="home-dock-pill-btn" onclick="App.toggleHomeDock('flags')">
                <span aria-hidden="true">⚑</span> <span>Flags ${pending}</span>
              </button>
              <div class="home-dock-drop">${items}<button type="button" class="home-dock-all" onclick="App.showFlagReview()">Review queue</button></div>
            </div>`);
        }
      }
    }

    if (!pills.length) return '';
    return `<nav class="home-dock" aria-label="Saved and flagged">${pills.join('')}</nav>`;
  },

  _getIsGenedCategories() {
    const idx = this._buildCategoryIndex();
    const seen = new Set();
    const out = [];
    for (const e of idx) {
      if (e.major !== 'IS' || !e.path.includes('GenEd')) continue;
      const key = e.path;
      if (seen.has(key)) continue;
      seen.add(key);
      if (e.parts.length >= 4) out.push(e);
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  },

  _popularRowsHtml(items) {
    return items.map(item => {
      const c = lookupCourse(this.courseIndex, item.course_code);
      if (!c || isCourseHidden(c)) return '';
      return `<li><button type="button" class="home-qs-link" onclick="App.selectCourseFromTree('${esc(c.course_code)}')"><span class="home-qs-code">${esc(c.course_code)}</span>${esc(c.course_name)}</button></li>`;
    }).filter(Boolean);
  },

  _popularSubText(peerScope, program) {
    if (peerScope) return `Top among ${program} students this semester`;
    if (this.authMode === 'authed') return `Suggested courses. Be the first ${program} student to explore`;
    return 'Suggested starter courses';
  },

  _renderQuickStart(browseMajor) {
    // Popular renders its local/static fallback synchronously — no loading
    // state exists; _loadPopularCourses upgrades in place if peer data lands.
    const local = this._getLocalPopularCourses(5);
    const items = local.length ? local
      : HOME_POPULAR_COURSES.map(code => ({ course_code: code, search_count: 0 }));
    const rows = this._popularRowsHtml(items);

    const popularCard = rows.length ? `
      <article class="home-qs-card" id="homePopularCard">
        <h3 class="home-qs-title">Popular this semester</h3>
        <p class="home-qs-sub" id="homePopularSub">${esc(this._popularSubText(false, this._popularProgram()))}</p>
        <ul class="home-qs-list" id="homePopularList">${rows.join('')}</ul>
      </article>` : '';

    const recentCard = HOME_RECENT_MAPPINGS.length ? `
      <article class="home-qs-card">
        <h3 class="home-qs-title">Recently updated mappings</h3>
        <ul class="home-qs-list">
          ${HOME_RECENT_MAPPINGS.map(m =>
            `<li><button type="button" class="home-qs-link" onclick="App.enterExplorer('${m.major}', '${esc(m.path).replace(/'/g, "\\'")}')"><span class="home-qs-code">${esc(m.courses)}</span>${esc(m.label)}</button></li>`
          ).join('')}
        </ul>
      </article>` : '';

    const gened = this._getIsGenedCategories();
    const bandHtml = gened.length ? `
      <nav class="home-gened-band" aria-label="GenEd categories">
        ${gened.slice(0, 12).map(g =>
          `<button type="button" class="home-qs-chip" onclick="App.enterExplorer('IS', '${esc(g.path).replace(/'/g, "\\'")}')">${esc(g.label)}</button>`
        ).join('')}
      </nav>` : '';

    const grid = [popularCard, recentCard].filter(Boolean).join('');
    if (!bandHtml && !grid) return '';
    return `<section class="home-quickstart" aria-label="Quick start">
      <h2 class="home-quickstart-label">Quick start</h2>
      ${bandHtml}
      ${grid ? `<div class="home-quickstart-grid">${grid}</div>` : ''}
    </section>`;
  },

  _navbarWishlistHtml() {
    if (!isStudent(this.profile)) return '';
    const count = this._getWishlist().length;
    const countChip = count > 0 ? `<span class="nav-wish-count">${count}</span>` : '';
    const label = count > 0 ? 'Saved' : 'Save courses';
    return `
      <button class="nav-wish" onclick="App.showWishlistView()" title="View your saved courses" aria-label="View saved courses">
        ${this._iconBookmarkFilled()}
        <span class="nav-wish-label">${label}</span>
        ${countChip}
      </button>`;
  },

  _navbarPlanHtml() {
    if (!canUseSchedulePlan(this.profile)) return '';
    const store = this._loadPlansStore();
    const planCount = (store.plans || []).length;
    const active = this._ensureActivePlan(false);
    const planned = active ? this._getPlanItemsForSemester(this.activeSemester, active.id) : [];
    const count = active ? this._countPlannedSections(this.activeSemester, active.id) : 0;
    const units = this._planUnitsTotal(planned);
    const countChip = planCount > 0 ? `<span class="nav-plan-count">${planCount}</span>` : '';
    const label = planCount > 1
      ? `${planCount} schedules`
      : (count > 0 ? `Plan · ${units || '?'}u` : 'Plan schedule');
    return `
      <button class="nav-plan" onclick="App.showPlanView()" title="Your schedule plans" aria-label="Your schedule plans">
        ${this._iconCalendar()}
        <span class="nav-plan-label">${label}</span>
        ${countChip}
      </button>`;
  },

  _refreshNavPlanCount() {
    const btn = document.querySelector('.nav-plan');
    if (!btn) return;
    const store = this._loadPlansStore();
    const planCount = (store.plans || []).length;
    const active = this._ensureActivePlan(false);
    const planned = active ? this._getPlanItemsForSemester(this.activeSemester, active.id) : [];
    const count = active ? this._countPlannedSections(this.activeSemester, active.id) : 0;
    const units = this._planUnitsTotal(planned);
    const existing = btn.querySelector('.nav-plan-count');
    const label = btn.querySelector('.nav-plan-label');
    if (planCount > 0) {
      if (label) label.textContent = planCount > 1 ? `${planCount} schedules` : (count > 0 ? `Plan · ${units || '?'}u` : 'Plan schedule');
      if (existing) existing.textContent = String(planCount);
      else btn.insertAdjacentHTML('beforeend', `<span class="nav-plan-count">${planCount}</span>`);
    } else {
      if (label) label.textContent = 'Plan schedule';
      if (existing) existing.remove();
    }
  },

  // Refresh just the navbar count without re-rendering the whole shell.
  _refreshNavWishCount() {
    const btn = document.querySelector('.nav-wish');
    if (!btn) return;
    const count = this._getWishlist().length;
    const existing = btn.querySelector('.nav-wish-count');
    const label = btn.querySelector('.nav-wish-label');
    if (count > 0) {
      if (label) label.textContent = 'Saved';
      if (existing) existing.textContent = String(count);
      else btn.insertAdjacentHTML('beforeend', `<span class="nav-wish-count">${count}</span>`);
    } else {
      if (label) label.textContent = 'Save courses';
      if (existing) existing.remove();
    }
  },

  // ── Faculty flag queue (all faculty + admin) ───────────────
  _myFlagsState: null,
  _studentFlagsState: null,

  async _loadStudentFlagsSummary() {
    const r = await apiListFlags('limit=100');
    if (!r.ok) {
      this._studentFlagsState = { loaded: true, items: [] };
    } else {
      this._studentFlagsState = { loaded: true, items: (r.data && r.data.items) || [] };
      this.serverFlags = this._studentFlagsState.items;
    }
    if (this._homeView === 'home') {
      this._refreshHomeDock();
    }
  },

  async _loadMyFlagsSummary() {
    const r = await apiListFlags('limit=200');
    if (!r.ok) {
      this._myFlagsState = { loaded: true, error: true, counts: summarizeFlagsByStatus([]), items: [] };
    } else {
      const items = (r.data && r.data.items) || [];
      this._myFlagsState = { loaded: true, error: false, counts: summarizeFlagsByStatus(items), items };
    }
    if (this._homeView === 'home') {
      this._refreshHomeDock();
    }
  },

  renderCourseCard(course) {
    const el = document.getElementById('leftBody');
    if (!el) return;

    const deptName = getDeptName(course.course_code);
    const offeringSems = sortSemesters(
      [...new Set(getCourseOfferings(course).map(o => o.semester_code).filter(Boolean))]
    );
    const histSems = sortSemesters(course.offered || []);
    const semesters = sortSemesters([...new Set([...offeringSems, ...histSems])]);
    const prereq = formatPrereq(course.prerequisites);
    const profile = this.profile;
    const facultyView = isFaculty(profile);
    const mappings = getCourseMappings(course);
    const sections = filterOfferings(getCourseOfferings(course), this._filterParams());
    const semLabel = semesterLabel(this.activeSemester);
    const isDoubleCounter = !!course._doubleCounter;
    const pLower = profile && profile.primary ? profile.primary.toLowerCase() : 'cs';
    const minorMajor = getMinorAsMajorCode(profile);
    const sLower = minorMajor ? minorMajor.toLowerCase() : 'cs';

    // Where string
    const whereParts = [];
    if (course.offered_qatar) whereParts.push('Qatar');
    if (course.offered_pitts) whereParts.push('Pittsburgh');
    const whereStr = whereParts.length ? whereParts.join(' &amp; ') : 'Not listed';
    // Retired numbers this course replaced (backend/data/mapping_overlays.json "renumbered").
    const previousCodes = Array.isArray(course.previous_codes) ? course.previous_codes.filter(Boolean) : [];

    // Slim DC banner (spec § 4.4) — student lens only; faculty get the full
    // cross-program grid instead of a "double-counter for you" framing.
    let dcBannerHtml = '';
    if (!facultyView && isDoubleCounter && profile && minorMajor) {
      dcBannerHtml = `
        <div class="cc-dc-strip">
          <span class="cc-dc-badge cc-dc-${pLower}">${profile.primary}</span>
          <span class="cc-dc-badge cc-dc-${sLower}">${minorMajor}</span>
          <span class="cc-dc-text">Double-counter</span>
        </div>`;
    }

    // About column rows
    const aboutRows = `
      <div class="cc-kv"><span class="cc-k">Dept</span><span class="cc-v">${esc(deptName)} (${esc(course.course_code.split('-')[0])})</span></div>
      <div class="cc-kv"><span class="cc-k">Offered</span><span class="cc-v">${semesters.length ? semesters.map(s => esc(semesterLabel(s))).join(' · ') : 'Not listed'}</span></div>
      <div class="cc-kv"><span class="cc-k">Where</span><span class="cc-v">${whereStr}</span></div>
      ${previousCodes.length ? `<div class="cc-kv"><span class="cc-k">Previously</span><span class="cc-v">${previousCodes.map(esc).join(', ')}</span></div>` : ''}
      <div class="cc-kv"><span class="cc-k">Prereq</span><span class="cc-v">${prereq ? esc(prereq) : '<em>None</em>'}</span></div>
    `;

    // Schedule rows for active semester + campus + modality
    let filtered = sections.slice();
    const groupedSections = groupOfferingsBySection(filtered);
    let schedHtml = '';
    if (filtered.length === 0) {
      const campus = this.locationFilter === 'qatar' ? 'Qatar' : this.locationFilter === 'pittsburgh' ? 'Pittsburgh' : 'this filter';
      const mod = this.modalityFilter !== 'all' ? (' · ' + (MODALITY_OPTIONS.find(m => m.id === this.modalityFilter) || {}).label) : '';
      schedHtml = `<div class="cc-empty">No matching sections for ${esc(semLabel)}${mod ? esc(mod) : ''}${this.locationFilter !== 'all' ? ' · ' + esc(campus) : ''}</div>`;
    } else {
      const inline = groupedSections.slice(0, 4).map(g => this._renderSchedRowGroup(g, course.course_code)).join('');
      const extraCount = groupedSections.length - 4;
      const more = extraCount > 0
        ? `<button class="cc-more" onclick="App.expandScheduleV2(event)" id="cc-sched-more" data-expanded="0">+${extraCount} more sections</button>
           <div id="cc-sched-extra" style="display:none;margin-top:6px"></div>`
        : '';
      schedHtml = inline + more;
    }

    // Counts For — columns per major. Order depends on role: students lead
    // with their own program(s); faculty see the canonical cross-program order.
    const cfOrder = orderCfColumns(mappings, profile);
    const cfCols = [];
    for (const majorCode of cfOrder) {
      const majorMappings = mappings[majorCode];
      if (!majorMappings || majorMappings.length === 0) continue;
      const lc = majorCode.toLowerCase();
      const itemsHtml = majorMappings.map(m => {
        const typeLabel = m.isGenEd ? 'GenEd' : 'Required';
        const typeCls = m.isGenEd ? 'gened' : 'req';
        const safePath = m.fullPath.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return `
          <div class="cc-cf-item" data-nav-major="${majorCode}" data-nav-path="${safePath}" title="${esc(formatRequirementPath(m.fullPath))}">
            <span class="cc-cf-item-label">${esc(m.shortLabel)}</span>
            <span class="cc-cf-item-type cc-cf-item-type-${typeCls}">${typeLabel}</span>
          </div>`;
      }).join('');
      cfCols.push(`
        <div class="cc-cf-col cc-cf-col-${lc}">
          <div class="cc-cf-col-head">
            <span class="cc-cf-badge cc-cf-${lc}">${majorCode}</span>
            <span class="cc-cf-col-count">${majorMappings.length} ${majorMappings.length === 1 ? 'slot' : 'slots'}</span>
          </div>
          <div class="cc-cf-col-body">${itemsHtml}</div>
        </div>`);
    }
    const cfHtml = cfCols.length
      ? `<div class="cc-cf-grid">${cfCols.join('')}</div>`
      : '<div class="cc-empty">This course does not count toward any tracked major requirements.</div>';

    // Top-right card actions (role-gated)
    const cardActions = this._renderCardActions(course);
    const wishlistNoteHtml = (isStudent(this.profile) && this._isInWishlist(course.course_code))
      ? `
        <div class="cc-wishlist-note">
          <label class="wl-note-wrap">
            <span class="wl-note-label">Your note on this course</span>
            <textarea class="wl-note-input" data-wl-note="${esc(course.course_code)}" placeholder="Why you saved this course…" rows="2">${esc(this._getWishlistNote(course.course_code))}</textarea>
          </label>
        </div>`
      : '';

    el.innerHTML = `
      <div class="cc-card">
        ${this._planBackLinkHtml()}
        ${dcBannerHtml}
        <div class="cc-head">
          <div class="cc-head-main">
            <div class="cc-code">${esc(course.course_code)}</div>
            <div class="cc-name">${esc(course.course_name)} · ${course.units || '?'} units</div>
          </div>
          ${cardActions}
        </div>
        ${wishlistNoteHtml}

        <div class="cc-cols">
          <div class="cc-section">
            <div class="cc-h4">ABOUT</div>
            ${aboutRows}
          </div>
          <div class="cc-section">
            <div class="cc-h4">${esc(semLabel.toUpperCase())}</div>
            ${this._renderOfferingPredictionHtml(course, this.activeSemester ? this.activeSemester[0] : 'F')}
            ${schedHtml}
          </div>
        </div>

        <div class="cc-section cc-section-cf">
          <div class="cc-h4">COUNTS FOR${(facultyView && cfOrder.length) ? ` <span class="cc-cf-summary">· ${cfOrder.length} program${cfOrder.length === 1 ? '' : 's'}</span>` : ''}</div>
          ${cfHtml}
        </div>

        ${course.description ? `
          <div class="cc-section">
            <div class="cc-h4">DESCRIPTION</div>
            <div class="cc-desc">${esc(course.description)}</div>
          </div>
        ` : ''}
      </div>
    `;

    const explBtn = document.getElementById('exploreInlineBtn');
    if (explBtn) explBtn.style.display = this.layoutMode === 'focused' ? 'flex' : 'none';

    this._bindWishlistNoteInputs(el);
    this._schedSections = groupedSections;
    this._syncDirectoryFabLayout();
  },

  _renderSchedRowGroup(group, courseCode) {
    const dmCls = (dm) => {
      const d = (dm || '').toLowerCase();
      if (d.includes('remote')) return 'cc-dm-remote';
      if (d.includes('in person') || d.includes('in-person')) return 'cc-dm-inperson';
      return 'cc-dm-other';
    };
    const mod = group.modality || (group.meetings[0] && (group.meetings[0].modality || group.meetings[0].delivery_mode)) || '';
    const campusBadge = group.campus ? `<span class="cc-campus-pill">${esc(group.campus)}</span>` : '';
    const dm = mod ? `<span class="cc-dm-pill ${dmCls(mod)}">${esc(mod).toUpperCase()}</span>` : '';
    const meetingsHtml = (group.meetings || []).map(m => {
      const time = formatDaysTimesForDisplay(offeringDaysTimes(m));
      return `<span class="cc-sched-meeting">${esc(time)}</span>`;
    }).join('');
    let planBtn = '';
    if (canUseSchedulePlan(this.profile) && courseCode) {
      const inPlan = this._isSectionGroupInPlan(courseCode, group);
      const sem = group.semester_code || this.activeSemester;
      planBtn = `<button type="button" class="cc-plan-btn ${inPlan ? 'is-planned' : ''}" data-action="plan-toggle-section" data-course-code="${esc(courseCode)}" data-semester-code="${esc(sem)}" data-section="${esc(group.section || '')}" data-campus="${esc(group.campus || '')}" title="${inPlan ? 'Remove section from schedule plan' : 'Add this section (all meeting times) to your schedule plan'}" aria-label="${inPlan ? 'Remove section from schedule plan' : 'Add section to schedule plan'}">${inPlan ? '✓ Planned' : '+ Plan'}</button>`;
    }
    return `<div class="cc-kv cc-kv-sched cc-kv-sched-group"><span class="cc-k">Sec ${esc(group.section)}</span><span class="cc-v"><span class="cc-sched-meetings">${meetingsHtml}</span> ${campusBadge} ${dm} ${planBtn}</span></div>`;
  },

  expandScheduleV2(e) {
    e.stopPropagation();
    const btn = document.getElementById('cc-sched-more');
    const extra = document.getElementById('cc-sched-extra');
    if (!btn || !extra) return;
    const expanded = btn.dataset.expanded === '1';
    const sections = (this._schedSections || []).slice(4);
    if (!expanded) {
      extra.style.display = 'block';
      extra.innerHTML = sections.map(g => this._renderSchedRowGroup(g, this.selectedCourse ? this.selectedCourse.course_code : '')).join('');
      btn.textContent = 'Hide extra sections';
      btn.dataset.expanded = '1';
    } else {
      extra.style.display = 'none';
      btn.textContent = '+' + sections.length + ' more sections';
      btn.dataset.expanded = '0';
    }
  },

  // ══════════════════════════════════════════════════════════
  // RIGHT PANEL — REQUIREMENT MAP
  // ══════════════════════════════════════════════════════════

  _renderMajorTabs() {
    const visible = this._visibleMajors();
    const p = this.profile;
    const minorMajor = getMinorAsMajorCode(p);
    const facultyMajor = (isFaculty(p) && p.primary && p.primary !== 'AS' && MAJOR_LIST.includes(p.primary))
      ? p.primary : null;

    // Advisor-with-minor: the minor maps to a major (if we have the data).
    const advisorMinorMajor = (p && p.role === 'advisor' && p.scope === 'minor')
      ? (MINOR_CODE_TO_MAJOR[p.primary] || null)
      : null;

    return visible.map(m => {
      const isActive = m === this.activeMajor;
      const isMinor = minorMajor === m && p.primary !== m;
      const isYourMajor = p && p.role === 'student' && p.primary === m;
      const isFacultyOwn = facultyMajor === m;
      const isAdvisorMinor = advisorMinorMajor === m;

      let suffix = '';
      let suffixCls = '';
      if (isYourMajor)        { suffix = 'Your major';      suffixCls = 'major-tab-suffix-major'; }
      else if (isMinor)       { suffix = 'Your minor';      suffixCls = 'major-tab-suffix-minor'; }
      else if (isAdvisorMinor){ suffix = 'You advise';      suffixCls = 'major-tab-suffix-faculty'; }
      else if (isFacultyOwn)  { suffix = getRoleLabel(p) || 'Assigned'; suffixCls = 'major-tab-suffix-faculty'; }

      const name = this._programFullName(m);
      const pending = isProgramDataPending(m) ? '<span class="major-tab-pending">soon</span>' : '';

      return `
        <button class="major-tab ${isActive ? 'active' : ''}" data-major="${m}" onclick="App.switchMajor('${m}')">
          <span class="major-tab-row">
            <span class="major-tab-code">${m}</span>${pending}
            ${suffix ? `<span class="major-tab-suffix ${suffixCls}">${esc(suffix)}</span>` : ''}
          </span>
          <span class="major-tab-name">${esc(name)}</span>
        </button>`;
    }).join('');
  },

  switchMajor(major) {
    this.activeMajor = major;
    this.treeSearchQuery = '';
    const treeInput = document.getElementById('treeSearchInput');
    if (treeInput) treeInput.value = '';

    // Update tab UI
    document.querySelectorAll('.major-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.major === major);
    });

    // Auto-expand first level
    this.autoExpandFirstLevel(major);
    this.renderTree();
  },

  toggleNode(major, path) {
    const key = major + '::' + path;
    if (this.expandedNodes.has(key)) {
      this.expandedNodes.delete(key);
    } else {
      this.expandedNodes.add(key);
    }
    this.renderTree();
  },

  isExpanded(major, path) {
    return this.expandedNodes.has(major + '::' + path);
  },

  renderTree() {
    const rightBody = document.getElementById('rightBody');
    if (!rightBody) return;
    const sections = this.treeSections[this.activeMajor];
    if (!sections) {
      const pending = isProgramDataPending(this.activeMajor);
      const full = this._programFullName(this.activeMajor);
      if (pending) {
        rightBody.innerHTML = `
          <div class="empty-state-pending">
            <img class="empty-state-pending-illustration" src="assets/img/scotty-full.png" alt="" aria-hidden="true" />
            <span class="empty-state-pending-tag">Coming soon</span>
            <div class="empty-state-pending-title" style="margin-top:14px">${esc(full)} requirements</div>
            <div class="empty-state-pending-body">
              The official requirement list for ${esc(full)} is still being collected.
              Once it lands, courses will automatically count toward this program.
            </div>
            <a class="empty-state-pending-help" href="mailto:cmuq-curriculum@andrew.cmu.edu?subject=${encodeURIComponent('CountsFor: ' + full + ' requirement data')}">
              Have official data? Email us
            </a>
          </div>`;
      } else {
        rightBody.innerHTML = `<div class="empty-state"><img class="empty-illustration" src="assets/img/scotty-full.png" alt="" aria-hidden="true" /><div class="empty-text">No data</div></div>`;
      }
      return;
    }
    let html = '';
    const filterHint = `<div class="tree-filter-hint" aria-live="polite">Tree filtered: ${esc(this._activeFilterSummary().join(' · '))}</div>`;
    html += filterHint;
    // degree + gened both render as a flat list of cards — no separate section headers
    for (const node of [...sections.degree, ...sections.gened]) {
      html += this.renderTreeNode(node, this.activeMajor, 0);
    }
    rightBody.innerHTML = html;
  },

  renderTreeNode(node, major, depth) {
    const hasChildren = node.children && node.children.length > 0;
    const hasCourses = node.courses && node.courses.length > 0;
    const isExpandable = hasChildren || hasCourses;
    const expanded = this.isExpanded(major, node.path);
    const isHighlighted = this.highlightedPath === node.path;

    const matchesSearch = this.nodeMatchesSearch(node);
    if (this.treeSearchQuery && !matchesSearch) return '';

    const filteredTotalCourses = this.countFilteredCourses(node);
    if (filteredTotalCourses === 0) return '';

    const filteredCourses = (node.courses || []).filter(c => {
      const full = lookupCourse(this.courseIndex, c.code || c.course_code) || c;
      return this.coursePassesTreeFilter(full);
    });

    const ruleHtml = node.rule ? `<span class="tr-rule">${esc(node.rule.label)}</span>` : '';
    const countHtml = (!expanded && filteredTotalCourses > 0 && isExpandable)
      ? `<span class="tr-count">${filteredTotalCourses} course${filteredTotalCourses === 1 ? '' : 's'}</span>`
      : '';
    const safePath = node.path.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const downloadBtn = filteredTotalCourses > 0
      ? this._renderReqDownloadBtn(major, safePath)
      : '';

    // ── Depth 0: render as a card ─────────────────────────────
    if (depth === 0) {
      const accent = pickAccentColor(node.label, major);
      const openCls = expanded ? 'open' : '';
      const cardHead = `
        <div class="tr-card-head ${isHighlighted ? 'highlighted' : ''}" data-tree-major="${major}" data-tree-path="${safePath}">
          <span class="tr-arrow ${expanded ? 'expanded' : ''}">▶</span>
          <span class="tr-accent" style="background:${accent}"></span>
          <span class="tr-card-title">${esc(node.label)}</span>
          <span class="tr-card-meta">${ruleHtml}${countHtml}${downloadBtn}</span>
        </div>`;
      let body = '';
      if (isExpandable && expanded) {
        let inner = '';
        if (hasChildren) {
          for (const child of node.children) inner += this.renderTreeNode(child, major, depth + 1);
        }
        if (hasCourses) {
          for (const c of filteredCourses) inner += this._renderLeafCourse(c, major);
        }
        body = `<div class="tr-card-body">${inner}</div>`;
      }
      return `<div class="tr-card ${openCls}" style="--tr-accent:${accent}">${cardHead}${body}</div>`;
    }

    // ── Depth ≥ 1: regular sub-node ──────────────────────────
    const indent = (depth - 1) * 14;
    let html = `<div class="tr-sub" style="padding-left:${indent}px">`;
    html += `<div class="tr-sub-row ${isHighlighted ? 'highlighted' : ''}" data-tree-major="${major}" data-tree-path="${safePath}">`;
    html += `<span class="tr-arrow ${expanded ? 'expanded' : ''} ${!isExpandable ? 'leaf' : ''}">▶</span>`;
    html += `<span class="tr-sub-label">${esc(node.label)}</span>`;
    html += ruleHtml;
    html += countHtml;
    html += downloadBtn;
    html += `</div>`;
    if (isExpandable) {
      html += `<div class="tr-children ${expanded ? '' : 'collapsed'}">`;
      if (hasChildren) {
        for (const child of node.children) html += this.renderTreeNode(child, major, depth + 1);
      }
      if (hasCourses) {
        for (const c of filteredCourses) html += this._renderLeafCourse(c, major);
      }
      html += `</div>`;
    }
    html += `</div>`;
    return html;
  },

  _renderReqDownloadBtn(major, safePath) {
    return `<button type="button" class="tr-download" data-action="download-req" data-tree-major="${esc(major)}" data-tree-path="${safePath}" title="Download courses for Excel" aria-label="Download courses for Excel">⬇</button>`;
  },

  downloadRequirementExcel(major, path) {
    const node = findTreeNode(this.trees[major], path);
    if (!node) {
      showToast('Requirement not found.');
      return;
    }
    const filterFn = (leaf) => {
      const full = lookupCourse(this.courseIndex, leaf.code) || leaf;
      return this.filterByLocation(full);
    };
    const courses = collectCoursesForRequirement(node, filterFn);
    if (!courses.length) {
      // Name every filter that is actually narrowing the result. Reporting only the
      // campus filter made an active semester or modality filter look like missing
      // data rather than a filter the user could clear.
      showToast('No courses match your filters (' + this._activeFilterSummary().join(', ') + ').');
      return;
    }

    const pathLabel = formatRequirementPath(node.path);
    const majorLabel = (MAJOR_META[major] && MAJOR_META[major].label) || major;
    const headers = ['Course Code', 'Course Name', 'Units', 'Department', 'Type', 'Qatar', 'Pittsburgh', 'Prerequisites'];
    const rows = courses.map(leaf => {
      const full = lookupCourse(this.courseIndex, leaf.code) || leaf;
      return [
        leaf.code,
        leaf.name || full.course_name || '',
        leaf.units || full.units || '',
        typeof getDeptName === 'function' ? getDeptName(leaf.code) : (full.department || ''),
        leaf.type ? 'GenEd' : 'Core',
        full.offered_qatar ? 'Yes' : 'No',
        full.offered_pitts ? 'Yes' : 'No',
        full.prerequisites || '',
      ];
    });

    // Record all three filters, not just campus. The export applies semester and
    // modality too (see _filterParams), so a sheet that lists only the campus filter
    // cannot be reconciled with its own row count.
    const metaRows = [
      ['CountsFor course export'],
      ['Major', majorLabel],
      ['Requirement', pathLabel],
      ['Semester filter', semesterLabel(this.activeSemester)],
      ['Campus filter', this._campusFilterLabel()],
      ['Modality filter', this._modalityFilterLabel()],
      ['Courses', String(courses.length)],
      ['Exported', new Date().toLocaleString()],
    ];
    const filename = `CountsFor_${major}_${slugifyFilename(node.label)}.csv`;
    downloadExcelSheet(filename, node.label, headers, rows, metaRows);
    showToast(`Downloaded ${courses.length} courses`);
  },

  _renderLeafCourse(c, major) {
    const fullCourse = lookupCourse(this.courseIndex, c.code) || c;
    const isActive = this.selectedCourse && this.selectedCourse.course_code === c.code;
    const vm = computeViewMode(this.profile);
    const minorMajor = getMinorAsMajorCode(this.profile);

    let dcTag = '';
    if (vm === 'focused-dual' && fullCourse._doubleCounter && minorMajor) {
      const other = (minorMajor === major) ? this.profile.primary : minorMajor;
      if (other) dcTag = `<span class="tr-leaf-tag tr-leaf-tag-${other.toLowerCase()}">${other}</span>`;
    }
    let mpChip = '';
    if (vm === 'cross-program' && (fullCourse._programCount || 0) >= 3) {
      mpChip = `<span class="tr-mp-chip">${fullCourse._programCount} programs</span>`;
    }
    const alsoMajors = (vm !== 'focused-dual' && vm !== 'cross-program') ? getAlsoCountsFor(fullCourse, major) : [];
    const alsoHtml = alsoMajors.length
      ? `<span class="tr-also">${alsoMajors.map(m => `<span class="tr-leaf-tag tr-leaf-tag-${m.toLowerCase()}">${m}</span>`).join('')}</span>`
      : '';

    return `
      <div class="tr-leaf ${isActive ? 'active' : ''}" data-course-code="${esc(c.code)}">
        <span class="tr-leaf-code">${esc(c.code)}</span>
        <span class="tr-leaf-name">${esc(c.name)}</span>
        ${c.units ? `<span class="tr-leaf-units">${c.units}u</span>` : ''}
        ${alsoHtml}${dcTag}${mpChip}
        ${this._renderRowActions(fullCourse)}
      </div>`;
  },

  // ── Per-row inline actions (wishlist + flag) ───────────────
  // Compact, hover-revealed buttons so the row stays clean for everyone but
  // stays one click away for the relevant audience.
  _renderRowActions(course) {
    const acts = [];
    if (isStudent(this.profile)) {
      const saved = this._isInWishlist(course.course_code);
      acts.push(`<button class="tr-leaf-action tr-leaf-wishlist ${saved ? 'is-saved' : ''}" data-action="wishlist" data-course-code="${esc(course.course_code)}" title="${saved ? 'Remove from wishlist' : 'Save for later'}" aria-label="${saved ? 'Remove from wishlist' : 'Save for later'}">${saved ? this._iconBookmarkFilled() : this._iconBookmarkOutline()}</button>`);
    }
    if (canFlagCourses(this.profile) && (this.authMode === 'authed' || this.isGuest)) {
      acts.push(`<button class="tr-leaf-action tr-leaf-flag" data-action="flag" data-course-code="${esc(course.course_code)}" title="Flag course data issue" aria-label="Flag course data issue">${this._iconFlag()}</button>`);
    } else if (isStudent(this.profile) && this._courseHasVisibleFlag(course.course_code)) {
      acts.push(`<span class="tr-leaf-flag-badge" title="Faculty-flagged course">${this._iconFlag()}</span>`);
    }
    if (!acts.length) return '';
    return `<span class="tr-leaf-actions">${acts.join('')}</span>`;
  },

  // Course-card (detail view) actions — wishlist save toggle + flag link.
  // Labeled buttons here (vs icon-only on row) since the card has space.
  // Subtle offering-likelihood pill — appears under a semester header.
  // Silent for 'mixed' and 'unknown' to avoid noise.
  _renderOfferingPredictionHtml(course, season) {
    if (typeof predictOffering !== 'function') return '';
    const pred = predictOffering(course, season);
    if (!pred || pred.state === 'mixed' || pred.state === 'unknown') return '';
    return `
      <div class="cc-offer-pred cc-offer-pred-${pred.state}" title="${esc(pred.reason)}">
        <span class="cc-offer-pred-dot"></span>
        <span>${esc(pred.reason)}</span>
      </div>`;
  },

  _renderCardActions(course) {
    const parts = [];
    if (isStudent(this.profile)) {
      const saved = this._isInWishlist(course.course_code);
      parts.push(`
        <button class="cc-action cc-action-wishlist ${saved ? 'is-saved' : ''}" data-action="wishlist" data-course-code="${esc(course.course_code)}" aria-label="${saved ? 'Remove from saved courses' : 'Save this course for later'}">
          ${saved ? this._iconBookmarkFilled() : this._iconBookmarkOutline()}
          <span>${saved ? 'Saved ✓' : 'Save course'}</span>
        </button>`);
    }
    if (canUseSchedulePlan(this.profile)) {
      const sections = filterOfferings(getCourseOfferings(course), this._filterParams());
      const grouped = groupOfferingsBySection(sections);
      const hasPlannedSection = grouped.some(g => this._isSectionGroupInPlan(course.course_code, g));
      if (hasPlannedSection) {
        parts.push(`
          <button class="cc-action cc-action-plan is-planned" onclick="App._openActivePlanDetail()" aria-label="View in schedule plan">
            ${this._iconCalendar()}
            <span>In plan ✓</span>
          </button>`);
      } else if (grouped.length) {
        parts.push(`
          <button class="cc-action cc-action-plan" data-action="plan-add-first" data-course-code="${esc(course.course_code)}" aria-label="Add first section to schedule plan">
            ${this._iconCalendar()}
            <span>Add to plan</span>
          </button>`);
      }
    }
    if (canFlagCourses(this.profile) && (this.authMode === 'authed' || this.isGuest)) {
      parts.push(`
        <button class="cc-action cc-action-flag" data-action="flag" data-course-code="${esc(course.course_code)}" title="Report a data issue with this course" aria-label="Flag course issue">
          ${this._iconFlag()}
          <span>Flag course issue</span>
        </button>`);
    } else if (isStudent(this.profile) && this._courseHasVisibleFlag(course.course_code)) {
      parts.push(`<span class="cc-flag-badge">Faculty flagged · ${esc(this._courseFlagStatus(course.course_code))}</span>`);
    }
    if (!parts.length) return '';
    return `<div class="cc-head-actions">${parts.join('')}</div>`;
  },

  _iconBookmarkOutline() {
    return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3.5 2.5h9v11l-4.5-3-4.5 3z" stroke-linejoin="round"/></svg>';
  },
  _iconBookmarkFilled() {
    return '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M3.5 2.5h9v11l-4.5-3-4.5 3z"/></svg>';
  },
  _iconFlag() {
    return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M3 2v12"/><path d="M3 2.5h8.5L9.7 5.2 11.5 8H3"/></svg>';
  },
  _iconCalendar() {
    return '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2.5" y="3.5" width="11" height="10.5" rx="1.5"/><path d="M5 2v2M11 2v2M2.5 6.5h11"/></svg>';
  },

  countFilteredCourses(node) {
    let count = (node.courses || []).filter(c => {
      const full = lookupCourse(this.courseIndex, c.code || c.course_code) || c;
      return this.coursePassesTreeFilter(full);
    }).length;
    if (node.children) {
      for (const child of node.children) {
        count += this.countFilteredCourses(child);
      }
    }
    return count;
  },

  nodeMatchesSearch(node) {
    if (!this.treeSearchQuery) return true;
    const q = this.treeSearchQuery;

    // Check label
    if (node.label.toLowerCase().includes(q)) return true;
    if (node.rawLabel && node.rawLabel.toLowerCase().includes(q)) return true;

    // Check courses (respect active semester/campus/modality filters)
    if (node.courses) {
      for (const c of node.courses) {
        const full = lookupCourse(this.courseIndex, c.code || c.course_code) || c;
        if (!this.coursePassesTreeFilter(full)) continue;
        if (c.code.toLowerCase().replace(/-/g, '').includes(q.replace(/-/g, ''))) return true;
        if (c.name && c.name.toLowerCase().includes(q)) return true;
      }
    }

    // Check children recursively
    if (node.children) {
      for (const child of node.children) {
        if (this.nodeMatchesSearch(child)) return true;
      }
    }

    return false;
  },

  // ── Cross-linking ─────────────────────────────────────────
  selectCourseFromTree(code) {
    this.closeDirectoryPanel();
    const course = lookupCourse(this.courseIndex, code);
    if (!course) return;
    this._selectCourse(course);

    // On mobile, switch to lookup lens
    if (window.innerWidth <= 860) {
      this.setMobileLens('lookup');
    }

    // Scroll left panel to top
    const leftBody = document.getElementById('leftBody');
    if (leftBody) leftBody.scrollTop = 0;
  },

  // ══════════════════════════════════════════════════════════
  // WISHLIST (students only)
  // ══════════════════════════════════════════════════════════
  // Storage: localStorage['cf_wishlist'] = [{ course_code, note }, ...]

  _getWishlistItems() {
    const raw = loadStore('cf_wishlist', []);
    return raw.map(x => (typeof x === 'string'
      ? { course_code: x, note: '' }
      : { course_code: x.course_code, note: x.note || '' }));
  },

  _saveWishlistItems(list) {
    saveStore('cf_wishlist', list);
  },

  _getWishlist() {
    return this._getWishlistItems().map(i => i.course_code);
  },

  _getWishlistNote(code) {
    const item = this._getWishlistItems().find(i => this._sameCourse(i.course_code, code));
    return item ? (item.note || '') : '';
  },

  _isInWishlist(code) {
    return this._getWishlistItems().some(i => this._sameCourse(i.course_code, code));
  },

  async toggleWishlist(code) {
    if (!isStudent(this.profile)) {
      showToast('Wishlist is available to students only.');
      return;
    }
    if (!code) return;
    const list = this._getWishlistItems();
    const idx = list.findIndex(i => this._sameCourse(i.course_code, code));
    if (idx === -1) {
      list.push({ course_code: code, note: '' });
      this._saveWishlistItems(list);
      if (this.authMode === 'authed') {
        const r = await apiAddWishlist(code);
        if (!r.ok) {
          // Drop the synced flag so next sign-in retries the migration loop.
          try { localStorage.removeItem('cf_synced'); } catch {}
          showToast('Saved locally. Sync to server failed.');
        }
      }
      showToast('Saved for later');
    } else {
      // The saved entry may use an old number; remove it under that code.
      const [removed] = list.splice(idx, 1);
      this._saveWishlistItems(list);
      if (this.authMode === 'authed') {
        const r = await apiRemoveWishlist(removed.course_code);
        if (!r.ok && r.status !== 404) {
          try { localStorage.removeItem('cf_synced'); } catch {}
          showToast('Removed locally. Sync to server failed.');
        }
      }
      showToast('Removed from wishlist');
    }
    // Re-render any visible surfaces that show wishlist state
    if (this.selectedCourse && this._sameCourse(this.selectedCourse.course_code, code)) {
      this.renderCourseCard(this.selectedCourse);
    }
    // Quick re-render of leaf rows (affects bookmark fill state)
    this.renderTree();
    // Update the navbar count chip in place
    this._refreshNavWishCount();
    if (this._homeView === 'wishlist') this.showWishlistView();
    else if (this._homeView === 'home') this._refreshHomeDock();
  },

  showWishlistView() {
    if (!isStudent(this.profile)) return;
    this._homeView = 'wishlist';
    const el = document.getElementById('leftBody');
    if (!el) return;

    const items = this._getWishlistItems();
    const courses = items
      .map(i => ({ item: i, course: lookupCourse(this.courseIndex, i.course_code) }))
      .filter(x => x.course);

    let rowsHtml;
    if (courses.length === 0) {
      rowsHtml = `
        <div class="wl-empty">
          <div class="wl-empty-icon">${this._iconBookmarkOutline()}</div>
          <div class="wl-empty-title">No saved courses yet</div>
          <div class="wl-empty-hint">Tap the bookmark on any course to save it here for planning later.</div>
        </div>`;
    } else {
      rowsHtml = courses.map(({ item, course: c }) => {
        const flagWarn = this._hasUnavailabilityFlag(c.course_code)
          ? `<span class="wl-warn" title="Flagged by a faculty member as possibly no longer offered">${this._iconWarn()} Possibly unavailable</span>`
          : '';
        const where = [];
        if (c.offered_qatar) where.push('Qatar');
        if (c.offered_pitts) where.push('Pittsburgh');
        return `
          <div class="wl-row" data-course-code="${esc(c.course_code)}">
            <span class="wl-code">${esc(c.course_code)}</span>
            <span class="wl-main">
              <span class="wl-name">${esc(c.course_name)}</span>
              <span class="wl-meta">${c.units || '?'} units${where.length ? ' · ' + where.join(' & ') : ''}${flagWarn ? ' · ' + flagWarn : ''}</span>
              <label class="wl-note-wrap">
                <span class="wl-note-label">Your note</span>
                <textarea class="wl-note-input" data-wl-note="${esc(c.course_code)}" placeholder="Why you saved this course…" rows="2">${esc(item.note || '')}</textarea>
              </label>
            </span>
            <button class="wl-remove" data-action="wishlist" data-course-code="${esc(c.course_code)}" title="Remove from wishlist" aria-label="Remove from wishlist">Remove</button>
          </div>`;
      }).join('');
    }

    el.innerHTML = `
      <div class="wl-view">
        <div class="wl-header">
          <button class="dc-back-link" onclick="App.renderLeftEmpty()">Back to home</button>
          <div class="wl-title">Saved courses${courses.length ? ` <span class="wl-count">· ${courses.length}</span>` : ''}</div>
          <p class="wl-hint">Add a note on each course. Faculty advisors can read these when you share favorites.</p>
        </div>
        <div class="wl-list">${rowsHtml}</div>
      </div>
    `;
    this._bindWishlistNoteInputs(el);
  },

  _bindWishlistNoteInputs(container) {
    if (!container) return;
    container.querySelectorAll('.wl-note-input').forEach(ta => {
      if (ta.dataset.wlBound) return;
      ta.dataset.wlBound = '1';
      ta.addEventListener('click', e => e.stopPropagation());
      ta.addEventListener('mousedown', e => e.stopPropagation());
      let timer;
      const persist = () => this._saveWishlistNote(ta.dataset.wlNote, ta.value);
      ta.addEventListener('blur', persist);
      ta.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(persist, 700);
      });
    });
  },

  async _saveWishlistNote(code, note) {
    const items = this._getWishlistItems();
    const idx = items.findIndex(i => this._sameCourse(i.course_code, code));
    if (idx === -1) return;
    items[idx].note = (note || '').trim();
    this._saveWishlistItems(items);
    if (this.authMode === 'authed') {
      const r = await apiUpdateWishlistNote(items[idx].course_code, items[idx].note);
      if (!r.ok) {
        try { localStorage.removeItem('cf_synced'); } catch {}
        showToast('Note saved on this device. Could not sync to server.');
      }
    }
  },

  // ══════════════════════════════════════════════════════════
  // SCHEDULE PLAN (students + faculty) — multiple saved schedules
  // ══════════════════════════════════════════════════════════
  // Storage: localStorage['cf_plans_v2'] = { activePlanId, plans: [{ id, name, items }] }
  _planDetailId: null,
  _planCourseReturn: null,

  _loadPlansStore() {
    let store = loadStore('cf_plans_v2', null);
    if (store && Array.isArray(store.plans)) return store;
    const legacy = loadStore('cf_plan', []);
    if (Array.isArray(legacy) && legacy.length) {
      const id = 'plan-' + Date.now();
      store = {
        activePlanId: id,
        plans: [{
          id,
          name: 'My schedule',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          items: legacy.map(x => this._normalizePlanItem(x)),
        }],
      };
      saveStore('cf_plans_v2', store);
      return store;
    }
    return { activePlanId: null, plans: [] };
  },

  _savePlansStore(store) {
    saveStore('cf_plans_v2', store);
  },

  _defaultPlanName(store) {
    const n = (store.plans || []).length + 1;
    return `Schedule ${n}`;
  },

  _ensureActivePlan(createIfMissing) {
    const store = this._loadPlansStore();
    if (store.activePlanId && store.plans.some(p => p.id === store.activePlanId)) {
      return store.plans.find(p => p.id === store.activePlanId);
    }
    if (store.plans.length) {
      store.activePlanId = store.plans[0].id;
      this._savePlansStore(store);
      return store.plans[0];
    }
    if (!createIfMissing) return null;
    const id = 'plan-' + Date.now();
    const plan = {
      id,
      name: this._defaultPlanName(store),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [],
    };
    store.plans.push(plan);
    store.activePlanId = id;
    this._savePlansStore(store);
    return plan;
  },

  _setActivePlanId(planId) {
    const store = this._loadPlansStore();
    if (!store.plans.some(p => p.id === planId)) return;
    store.activePlanId = planId;
    this._savePlansStore(store);
  },

  _getPlanRecord(planId) {
    const store = this._loadPlansStore();
    const id = planId || store.activePlanId;
    return store.plans.find(p => p.id === id) || null;
  },

  _updatePlanItems(planId, items) {
    const store = this._loadPlansStore();
    const plan = store.plans.find(p => p.id === planId);
    if (!plan) return;
    plan.items = items.map(x => this._normalizePlanItem(x));
    plan.updatedAt = new Date().toISOString();
    store.activePlanId = planId;
    this._savePlansStore(store);
  },

  _openActivePlanDetail() {
    const plan = this._ensureActivePlan(false);
    if (plan) this.openPlanDetail(plan.id);
    else this.showPlanView();
  },

  createNewPlan(name) {
    if (!canUseSchedulePlan(this.profile)) return;
    const store = this._loadPlansStore();
    const id = 'plan-' + Date.now();
    const plan = {
      id,
      name: (name || '').trim() || this._defaultPlanName(store),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: [],
    };
    store.plans.unshift(plan);
    store.activePlanId = id;
    this._savePlansStore(store);
    this.openPlanDetail(id);
    showToast('Created “' + plan.name + '”');
  },

  deletePlan(planId) {
    if (!planId) return;
    const store = this._loadPlansStore();
    const plan = store.plans.find(p => p.id === planId);
    if (!plan) return;
    if (!confirm('Delete “' + plan.name + '”? This cannot be undone.')) return;
    store.plans = store.plans.filter(p => p.id !== planId);
    if (store.activePlanId === planId) {
      store.activePlanId = store.plans[0] ? store.plans[0].id : null;
    }
    this._savePlansStore(store);
    if (this._planDetailId === planId) this._planDetailId = null;
    showToast('Schedule deleted');
    this._refreshNavPlanCount();
    if (this._homeView === 'plan') this.showPlanView();
  },

  renamePlan(planId, name) {
    const label = (name || '').trim();
    if (!planId || !label) return;
    const store = this._loadPlansStore();
    const plan = store.plans.find(p => p.id === planId);
    if (!plan) return;
    plan.name = label;
    plan.updatedAt = new Date().toISOString();
    this._savePlansStore(store);
    if (this._homeView === 'plan') {
      if (this._planDetailId === planId) this.openPlanDetail(planId);
      else this.showPlanView();
    }
  },

  _promptRenamePlan(planId) {
    const plan = this._getPlanRecord(planId);
    if (!plan) return;
    const next = prompt('Rename schedule', plan.name);
    if (next == null) return;
    this.renamePlan(planId, next);
  },

  _planSnapshot(planId) {
    const plan = this._getPlanRecord(planId);
    if (!plan) return null;
    return {
      name: plan.name,
      items: (plan.items || []).map(x => this._normalizePlanItem(x)),
    };
  },

  async _loadServerPlans() {
    if (this.authMode !== 'authed' || !canUseSchedulePlan(this.profile)) return;
    const r = await apiGetPlans();
    if (!r.ok || !r.data || !Array.isArray(r.data.plans)) return;
    let added = 0;
    for (const sp of r.data.plans) {
      if (this._mergeServerPlan(sp)) added++;
    }
    if (added && this._homeView === 'plan' && !this._planDetailId) {
      // Caller re-renders plan library after load when needed.
    }
  },

  _mergeServerPlan(serverPlan) {
    if (!serverPlan || !serverPlan.id) return null;
    const store = this._loadPlansStore();
    if (store.plans.some(p => p.serverId === serverPlan.id)) return null;
    const localId = 'plan-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const plan = {
      id: localId,
      serverId: serverPlan.id,
      name: serverPlan.name,
      sharedFrom: serverPlan.shared_from || null,
      createdAt: serverPlan.created_at || new Date().toISOString(),
      updatedAt: serverPlan.updated_at || new Date().toISOString(),
      items: (serverPlan.items || []).map(x => this._normalizePlanItem(x)),
    };
    store.plans.unshift(plan);
    if (!store.activePlanId) store.activePlanId = plan.id;
    this._savePlansStore(store);
    this._refreshNavPlanCount();
    return plan;
  },

  async _handlePendingSharePlanLink() {
    const token = this._pendingSharePlanToken;
    if (!token) return;
    this._pendingSharePlanToken = null;
    if (this.authMode !== 'authed') return;
    if (!canUseSchedulePlan(this.profile)) return;
    const r = await apiAcceptPlanShare(token);
    try {
      const clean = new URL(location.href);
      clean.searchParams.delete('share_plan');
      history.replaceState(null, '', clean.pathname + clean.search + clean.hash);
    } catch {}
    if (!r.ok) {
      showToast(r.message || 'Could not import shared schedule.');
      return;
    }
    const merged = this._mergeServerPlan(r.data.plan);
    showToast('Shared schedule added to your library.');
    if (merged) {
      this._homeView = 'plan';
      this.openPlanDetail(merged.id);
    } else if (this._homeView === 'plan') {
      this.showPlanView();
    }
  },

  openSharePlanModal(planId) {
    if (!canUseSchedulePlan(this.profile)) return;
    if (this.authMode !== 'authed') {
      showToast('Sign in to share schedules with others.');
      return;
    }
    const snapshot = this._planSnapshot(planId);
    if (!snapshot) return;
    if (!snapshot.items.length) {
      showToast('Add at least one section before sharing.');
      return;
    }
    this._sharePlanState = { planId, name: snapshot.name, items: snapshot.items };
    this.closeSharePlanModal();

    const modal = document.createElement('div');
    modal.className = 'cf-modal-backdrop';
    modal.id = 'cfSharePlanModalRoot';
    modal.innerHTML = `
      <div class="cf-modal" role="dialog" aria-modal="true" aria-labelledby="cfSharePlanTitle">
        <header class="cf-modal-head">
          <div>
            <h3 id="cfSharePlanTitle" class="cf-modal-title">Share schedule</h3>
            <div class="cf-modal-sub">Send <strong>${esc(snapshot.name)}</strong> to someone on CountsFor, or copy a link they can open while signed in.</div>
          </div>
          <button class="cf-modal-x" aria-label="Close" onclick="App.closeSharePlanModal()">×</button>
        </header>
        <div class="cf-modal-body">
          <label class="cf-share-email-wrap">
            <span class="cf-share-label">Send to CMU email</span>
            <input type="email" class="cf-share-email" id="cfSharePlanEmail" placeholder="name@andrew.cmu.edu" autocomplete="email" />
          </label>
          <p class="cf-share-hint">They will see this schedule in <strong>Your schedules</strong> the next time they open CountsFor.</p>
          <div class="cf-share-divider"><span>or</span></div>
          <button type="button" class="cf-btn cf-btn-secondary cf-share-link-btn" id="cfSharePlanLinkBtn" onclick="App.copySharePlanLink()">Copy share link</button>
          <p class="cf-share-hint cf-share-hint-sub">Link works for 30 days. Anyone with the link can add a copy to their account while signed in.</p>
        </div>
        <footer class="cf-modal-foot">
          <button class="cf-btn cf-btn-secondary" onclick="App.closeSharePlanModal()">Cancel</button>
          <button class="cf-btn cf-btn-primary" id="cfSharePlanSendBtn" onclick="App.submitSharePlanEmail()">Send schedule</button>
        </footer>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeSharePlanModal();
    });
    const input = document.getElementById('cfSharePlanEmail');
    if (input) input.focus();
  },

  closeSharePlanModal() {
    const el = document.getElementById('cfSharePlanModalRoot');
    if (el) el.remove();
    this._sharePlanState = null;
  },

  async submitSharePlanEmail() {
    const st = this._sharePlanState;
    if (!st) return;
    const input = document.getElementById('cfSharePlanEmail');
    const email = (input && input.value || '').trim();
    if (!email) {
      showToast('Enter the recipient’s email.');
      if (input) input.focus();
      return;
    }
    const btn = document.getElementById('cfSharePlanSendBtn');
    if (btn) btn.disabled = true;
    const r = await apiSharePlan({
      recipient_email: email,
      name: st.name,
      items: st.items,
    });
    if (btn) btn.disabled = false;
    if (!r.ok) {
      showToast(r.message || 'Could not share schedule.');
      return;
    }
    const who = r.data && r.data.recipient_name ? r.data.recipient_name : email;
    showToast('Schedule sent to ' + who + '.');
    this.closeSharePlanModal();
  },

  async copySharePlanLink() {
    const st = this._sharePlanState;
    if (!st) return;
    const btn = document.getElementById('cfSharePlanLinkBtn');
    if (btn) btn.disabled = true;
    const r = await apiCreatePlanShareLink({ name: st.name, items: st.items });
    if (btn) btn.disabled = false;
    if (!r.ok || !r.data || !r.data.token) {
      showToast(r.message || 'Could not create share link.');
      return;
    }
    let url;
    try {
      url = new URL('app.html', location.href);
      url.searchParams.set('share_plan', r.data.token);
    } catch {
      url = location.origin + '/app.html?share_plan=' + encodeURIComponent(r.data.token);
    }
    try {
      await navigator.clipboard.writeText(url.toString());
      showToast('Share link copied to clipboard.');
    } catch {
      prompt('Copy this share link:', url.toString());
    }
  },

  _normalizePlanItem(item) {
    const base = {
      course_code: item.course_code,
      semester_code: item.semester_code || (this.activeSemester !== 'all' ? this.activeSemester : ''),
      section: item.section || '',
      campus: item.campus || '',
      days_times: item.days_times || 'TBA',
      modality: item.modality || '',
    };
    return { ...base, id: item.id || planOfferingKey(base.course_code, base) };
  },

  _getPlanItems(planId) {
    const plan = this._getPlanRecord(planId) || this._ensureActivePlan(false);
    if (!plan) return [];
    return (plan.items || []).map(x => this._normalizePlanItem(x)).filter(x => x.course_code);
  },

  _savePlanItems(list, planId) {
    const plan = this._ensureActivePlan(true);
    if (!plan) return;
    const id = planId || plan.id;
    this._updatePlanItems(id, list);
  },

  _getPlanItemsForSemester(semesterCode, planId) {
    const code = semesterCode || this.activeSemester;
    const items = this._getPlanItems(planId);
    if (!code || code === 'all') return items;
    return items.filter(i => i.semester_code === code);
  },

  _isOfferingInPlan(courseCode, offering) {
    const id = planOfferingKey(courseCode, offering);
    return this._getPlanItems().some(i => i.id === id);
  },

  _sectionMeetingsForPlan(courseCode, semesterCode, section, campus) {
    const course = lookupCourse(this.courseIndex, courseCode);
    if (!course) return [];
    return getCourseOfferings(course).filter(o =>
      (o.semester_code || this.activeSemester) === semesterCode
      && (o.section || '') === (section || '')
      && (o.campus || '') === (campus || '')
    );
  },

  _isSectionGroupInPlan(courseCode, group) {
    const meetings = (group && group.meetings) || [];
    if (!meetings.length) return false;
    return meetings.some(m => this._isOfferingInPlan(courseCode, m));
  },

  _countPlannedSections(semesterCode, planId) {
    const items = this._getPlanItemsForSemester(semesterCode, planId);
    return new Set(items.map(i => planSectionKey(i.course_code, i))).size;
  },

  _planSummary(plan, semesterCode) {
    const items = this._getPlanItemsForSemester(semesterCode || this.activeSemester, plan.id);
    const allItems = plan.items || [];
    const sectionCount = new Set(allItems.map(i => planSectionKey(i.course_code, i))).size;
    const filteredSections = this._countPlannedSections(semesterCode || this.activeSemester, plan.id);
    const units = this._planUnitsTotal(items.length ? items : allItems);
    const courseCount = new Set((items.length ? items : allItems).map(i => i.course_code)).size;
    const conflicts = countPlanConflictPairs(items.length ? items : allItems);
    return { sectionCount, filteredSections, units, courseCount, conflicts, itemCount: allItems.length };
  },

  _groupPlanItems(items) {
    const map = new Map();
    for (const item of items || []) {
      const key = planSectionKey(item.course_code, item);
      if (!map.has(key)) {
        map.set(key, {
          course_code: item.course_code,
          semester_code: item.semester_code,
          section: item.section,
          campus: item.campus,
          meetings: [],
        });
      }
      map.get(key).meetings.push(item);
    }
    return [...map.values()];
  },

  _planUnitsTotal(items) {
    let total = 0;
    const seen = new Set();
    for (const item of items || []) {
      const key = resolveCourseCode(this.courseIndex || {}, item.course_code);
      if (seen.has(key)) continue;
      seen.add(key);
      const c = lookupCourse(this.courseIndex, item.course_code);
      total += Number(c && c.units) || 0;
    }
    return total;
  },

  _planBlockPalette() {
    return [
      { bg: '#FECDD3', border: '#C41230', text: '#7F1024' },
      { bg: '#BFDBFE', border: '#2563EB', text: '#1E3A8A' },
      { bg: '#A7F3D0', border: '#059669', text: '#065F46' },
      { bg: '#FDE68A', border: '#D97706', text: '#92400E' },
      { bg: '#DDD6FE', border: '#7C3AED', text: '#5B21B6' },
      { bg: '#A5F3FC', border: '#0891B2', text: '#155E75' },
    ];
  },

  addFirstSectionToPlan(courseCode) {
    if (!canUseSchedulePlan(this.profile)) return;
    this._ensureActivePlan(true);
    const course = lookupCourse(this.courseIndex, courseCode);
    if (!course) return;
    const sections = filterOfferings(getCourseOfferings(course), this._filterParams());
    const grouped = groupOfferingsBySection(sections);
    if (!grouped.length) {
      showToast('No sections match your current filters.');
      return;
    }
    const g = grouped[0];
    this.togglePlanSection(courseCode, g.semester_code || this.activeSemester, g.section, g.campus, { forceAdd: true });
    const ta = document.getElementById('typeahead');
    if (ta) ta.classList.remove('visible');
  },

  togglePlanSection(courseCode, semesterCode, section, campus, opts) {
    if (!canUseSchedulePlan(this.profile)) {
      showToast('Schedule planning is not available for this account.');
      return;
    }
    this._ensureActivePlan(true);
    const meetings = this._sectionMeetingsForPlan(courseCode, semesterCode, section, campus);
    if (!meetings.length) return;
    let list = this._getPlanItems();
    const ids = meetings.map(m => planOfferingKey(courseCode, m));
    const anyIn = ids.some(id => list.some(i => i.id === id));
    const allIn = ids.every(id => list.some(i => i.id === id));
    if (allIn && (!opts || !opts.forceAdd)) {
      list = list.filter(i => !ids.includes(i.id));
      this._savePlanItems(list);
      showToast('Removed from schedule plan');
    } else if (anyIn && !allIn) {
      for (const m of meetings) {
        const normalized = this._normalizePlanItem({
          course_code: courseCode,
          semester_code: m.semester_code || semesterCode,
          section: m.section,
          campus: m.campus,
          days_times: offeringDaysTimes(m),
          modality: m.modality || m.delivery_mode || '',
        });
        if (!list.some(i => i.id === normalized.id)) list.push(normalized);
      }
      this._savePlanItems(list);
      showToast('Added remaining meeting times to your schedule plan');
    } else if (!anyIn || (opts && opts.forceAdd)) {
      for (const m of meetings) {
        const normalized = this._normalizePlanItem({
          course_code: courseCode,
          semester_code: m.semester_code || semesterCode,
          section: m.section,
          campus: m.campus,
          days_times: offeringDaysTimes(m),
          modality: m.modality || m.delivery_mode || '',
        });
        if (!list.some(i => i.id === normalized.id)) list.push(normalized);
      }
      this._savePlanItems(list);
      showToast('Added to your schedule plan');
    }
    this._refreshPlanSurfaces(courseCode);
  },

  removePlanSection(courseCode, semesterCode, section, campus) {
    const key = planSectionKey(courseCode, { semester_code: semesterCode, section, campus });
    const list = this._getPlanItems().filter(i => planSectionKey(i.course_code, i) !== key);
    this._savePlanItems(list);
    showToast('Removed from schedule plan');
    this._refreshPlanSurfaces(courseCode);
  },

  removeFromPlan(planId) {
    if (!planId) return;
    const list = this._getPlanItems();
    const idx = list.findIndex(i => i.id === planId);
    if (idx === -1) return;
    const code = list[idx].course_code;
    list.splice(idx, 1);
    this._savePlanItems(list);
    showToast('Removed from schedule plan');
    this._refreshPlanSurfaces(code);
  },

  _refreshPlanSurfaces(courseCode) {
    this._refreshNavPlanCount();
    if (this._homeView === 'plan' && !this.selectedCourse) {
      if (this._planDetailId) this.openPlanDetail(this._planDetailId);
      else this.showPlanView();
    } else if (this._homeView === 'home') {
      this._refreshHomeDock();
    }
    if (this.selectedCourse && this._sameCourse(this.selectedCourse.course_code, courseCode)) {
      this.renderCourseCard(this.selectedCourse);
    }
  },

  _renderPlanCalendar(items, conflicts) {
    const palette = this._planBlockPalette();
    const courseColor = {};
    let colorIdx = 0;
    for (const item of items) {
      if (!courseColor[item.course_code]) {
        courseColor[item.course_code] = palette[colorIdx % palette.length];
        colorIdx++;
      }
    }

    const timed = [];
    const tba = [];
    for (const item of items) {
      const parsed = parseDaysTimes(item.days_times);
      if (parsed.parseable) timed.push({ item, parsed });
      else tba.push({ item, parsed });
    }

    const spanMin = PLAN_CAL_END_MIN - PLAN_CAL_START_MIN;
    const timeLabels = [];
    for (let m = PLAN_CAL_START_MIN; m <= PLAN_CAL_END_MIN; m += 60) {
      timeLabels.push(`<div class="plan-cal-time" style="top:${((m - PLAN_CAL_START_MIN) / spanMin) * 100}%">${esc(formatPlanMinutes(m))}</div>`);
    }

    const cols = PLAN_DAY_COLUMNS.map(col => {
      const dayEntries = timed
        .filter(({ parsed }) => parsed.days.includes(col.code))
        .map(({ item, parsed }) => ({
          item,
          parsed,
          top: ((parsed.startMin - PLAN_CAL_START_MIN) / spanMin) * 100,
          height: Math.max(((parsed.endMin - parsed.startMin) / spanMin) * 100, 3.5),
        }));
      const laid = layoutPlanDayBlocks(dayEntries);
      const blocks = laid.map(({ item, parsed, top, height, col, totalCols }) => {
        const widthPct = 100 / totalCols;
        const leftPct = col * widthPct;
        const inset = totalCols > 1 ? 1 : 2;
        const colors = courseColor[item.course_code];
        const c = lookupCourse(this.courseIndex, item.course_code);
        const title = `${item.course_code} · Sec ${item.section}\n${parsed.raw}`;
        return `
          <button type="button" class="plan-block" style="top:${top}%;height:${height}%;left:calc(${leftPct}% + ${inset}px);width:calc(${widthPct}% - ${inset * 2}px);background:${colors.bg};border-color:${colors.border};color:${colors.text}" title="${esc(title)}" onclick="App.selectCourseFromTree('${esc(item.course_code)}')">
            <span class="plan-block-code">${esc(item.course_code)}</span>
            <span class="plan-block-sec">Sec ${esc(item.section)}</span>
            <span class="plan-block-time">${esc(formatPlanMinutes(parsed.startMin))} to ${esc(formatPlanMinutes(parsed.endMin))}</span>
          </button>`;
      }).join('');
      return `
        <div class="plan-cal-col">
          <div class="plan-cal-col-head">${esc(col.label)}</div>
          <div class="plan-cal-col-body">${blocks}</div>
        </div>`;
    }).join('');

    const tbaHtml = tba.length ? `
      <section class="plan-tba" aria-label="Courses without listed times">
        <h3 class="plan-tba-title">No time listed</h3>
        <div class="plan-tba-list">
          ${tba.map(({ item, parsed }) => {
            const c = lookupCourse(this.courseIndex, item.course_code);
            const days = parsed.days.length ? parsed.days.join('') : '';
            return `
              <div class="plan-tba-row">
                <button type="button" class="plan-tba-main" onclick="App.selectCourseFromTree('${esc(item.course_code)}')">
                  <span class="plan-tba-code">${esc(item.course_code)}</span>
                  <span class="plan-tba-name">${esc(c ? c.course_name : '')}</span>
                  <span class="plan-tba-meta">Sec ${esc(item.section)}${days ? ' · ' + esc(days) : ''}${item.campus ? ' · ' + esc(item.campus) : ''}</span>
                </button>
                <button type="button" class="plan-tba-remove" data-action="plan-remove" data-plan-id="${esc(item.id)}" aria-label="Remove from plan">Remove</button>
              </div>`;
          }).join('')}
        </div>
      </section>` : '';

    if (!items.length) {
      return `
        <div class="plan-empty">
          <div class="plan-empty-icon">${this._iconCalendar()}</div>
          <div class="plan-empty-title">Your schedule is empty</div>
          <div class="plan-empty-hint">Search above and tap <strong>+ Plan</strong> on a result, or open a course and add a section.</div>
        </div>`;
    }

    return `
      <div class="plan-cal-wrap">
        <div class="plan-cal">
          <div class="plan-cal-axis">
            <div class="plan-cal-axis-head"></div>
            <div class="plan-cal-axis-body">${timeLabels.join('')}</div>
          </div>
          ${cols}
        </div>
      </div>
      ${tbaHtml}`;
  },

  _renderPlanList(items, conflicts) {
    if (!items.length) return '';
    const groups = this._groupPlanItems(items);
    return `
      <section class="plan-list" aria-label="Planned courses">
        <h3 class="plan-list-title">Course list</h3>
        <div class="plan-list-rows">
          ${groups.map(group => {
            const c = lookupCourse(this.courseIndex, group.course_code);
            const times = group.meetings.map(m => formatDaysTimesForDisplay(m.days_times)).join(' · ');
            const groupConflict = group.meetings.some(m => conflicts.has(m.id));
            return `
              <div class="plan-list-row ${groupConflict ? 'is-conflict' : ''}">
                <button type="button" class="plan-list-main" onclick="App.selectCourseFromTree('${esc(group.course_code)}')">
                  <span class="plan-list-code">${esc(group.course_code)}</span>
                  <span class="plan-list-body">
                    <span class="plan-list-name">${esc(c ? c.course_name : '')}</span>
                    <span class="plan-list-meta">Sec ${esc(group.section)} · ${esc(times)}${group.campus ? ' · ' + esc(group.campus) : ''}${c && c.units ? ' · ' + c.units + 'u' : ''}${groupConflict ? ' · Time conflict' : ''}</span>
                  </span>
                </button>
                <button type="button" class="plan-list-remove" data-action="plan-remove-section" data-course-code="${esc(group.course_code)}" data-semester-code="${esc(group.semester_code)}" data-section="${esc(group.section)}" data-campus="${esc(group.campus)}" aria-label="Remove section from plan">Remove</button>
              </div>`;
          }).join('')}
        </div>
      </section>`;
  },

  async showPlanView() {
    if (!canUseSchedulePlan(this.profile)) return;
    this._homeView = 'plan';
    this._planDetailId = null;
    this._planCourseReturn = null;
    this.selectedCourse = null;
    this.renderShell();
    if (this.authMode === 'authed') await this._loadServerPlans();
    const el = document.getElementById('leftBody');
    if (!el) return;

    const store = this._loadPlansStore();
    const semLabel = semesterLabel(this.activeSemester);
    const cards = (store.plans || []).map(plan => {
      const sum = this._planSummary(plan, this.activeSemester);
      const isActive = store.activePlanId === plan.id;
      const updated = plan.updatedAt ? new Date(plan.updatedAt).toLocaleDateString() : '';
      const sharedFrom = plan.sharedFrom && plan.sharedFrom.name
        ? `<span class="plan-card-meta plan-card-meta-sub">From ${esc(plan.sharedFrom.name)}</span>`
        : '';
      return `
        <article class="plan-card ${isActive ? 'is-active' : ''}">
          <button type="button" class="plan-card-main" data-action="plan-open" data-plan-id="${esc(plan.id)}">
            <span class="plan-card-name">${esc(plan.name)}</span>
            <span class="plan-card-meta">${sum.sectionCount} section${sum.sectionCount === 1 ? '' : 's'} · ${sum.units || 0} units${sum.conflicts ? ' · ' + sum.conflicts + ' conflict' + (sum.conflicts === 1 ? '' : 's') : ''}</span>
            ${this.activeSemester !== 'all' && sum.filteredSections !== sum.sectionCount
              ? `<span class="plan-card-meta plan-card-meta-sub">${sum.filteredSections} in ${esc(semLabel)}</span>` : ''}
            ${sharedFrom}
            ${updated ? `<span class="plan-card-meta plan-card-meta-sub">Updated ${esc(updated)}</span>` : ''}
          </button>
          <div class="plan-card-actions">
            <button type="button" class="plan-card-btn" data-action="plan-rename" data-plan-id="${esc(plan.id)}" title="Rename">Rename</button>
            <button type="button" class="plan-card-btn plan-card-btn-danger" data-action="plan-delete" data-plan-id="${esc(plan.id)}" title="Delete">Delete</button>
          </div>
        </article>`;
    }).join('');

    const emptyHtml = !store.plans.length ? `
      <div class="plan-empty">
        <div class="plan-empty-icon">${this._iconCalendar()}</div>
        <div class="plan-empty-title">No schedules yet</div>
        <div class="plan-empty-hint">Create a schedule, then add sections from course cards with <strong>+ Plan</strong>.</div>
      </div>` : '';

    el.innerHTML = `
      <div class="plan-view plan-view-library">
        <div class="plan-header">
          <button class="dc-back-link" onclick="App.renderLeftEmpty()">Back to home</button>
          <div class="plan-title-row">
            <h2 class="plan-title">Your schedules</h2>
            <span class="plan-sem">${esc(semLabel)}</span>
          </div>
          <p class="plan-lead">Search above to add courses with <strong>+ Plan</strong>, or open a course and pick a section.</p>
          <div class="plan-library-actions">
            <button type="button" class="plan-new-btn" data-action="plan-create">${this._iconCalendar()} New schedule</button>
          </div>
        </div>
        ${emptyHtml}
        ${cards ? `<div class="plan-library">${cards}</div>` : ''}
      </div>
    `;
    this._syncDirectoryFabLayout();
  },

  openPlanDetail(planId) {
    if (!canUseSchedulePlan(this.profile)) return;
    const plan = this._getPlanRecord(planId);
    if (!plan) {
      this.showPlanView();
      return;
    }
    this._setActivePlanId(planId);
    this._homeView = 'plan';
    this._planDetailId = planId;
    this._planCourseReturn = null;
    this.selectedCourse = null;
    this.renderShell();
    const el = document.getElementById('leftBody');
    if (!el) return;

    const items = this._getPlanItemsForSemester(this.activeSemester, planId);
    const conflicts = findPlanConflicts(items);
    const units = this._planUnitsTotal(items);
    const sectionCount = this._countPlannedSections(this.activeSemester, planId);
    const courseCount = new Set(items.map(i => i.course_code)).size;
    const semLabel = semesterLabel(this.activeSemester);
    const conflictPairs = countPlanConflictPairs(items);
    const conflictNote = conflictPairs
      ? `<span class="plan-stat plan-stat-warn">${conflictPairs} time conflict${conflictPairs === 1 ? '' : 's'}</span>`
      : '';
    const sharedNote = plan.sharedFrom && plan.sharedFrom.name
      ? `<p class="plan-shared-note">Shared by ${esc(plan.sharedFrom.name)}${plan.sharedFrom.email ? ' · ' + esc(plan.sharedFrom.email) : ''}</p>`
      : '';

    el.innerHTML = `
      <div class="plan-view">
        <div class="plan-header">
          <button class="dc-back-link" onclick="App.showPlanView()">All schedules</button>
          <div class="plan-title-row">
            <h2 class="plan-title">${esc(plan.name)}</h2>
            <span class="plan-sem">${esc(semLabel)}</span>
          </div>
          ${sharedNote}
          <p class="plan-lead">Search above and tap <strong>+ Plan</strong> to add a course, or open a course card and pick a section.</p>
          <div class="plan-detail-actions">
            <button type="button" class="plan-share-btn" data-action="plan-share" data-plan-id="${esc(plan.id)}">Share schedule</button>
          </div>
          <div class="plan-stats">
            <span class="plan-stat">${sectionCount} section${sectionCount === 1 ? '' : 's'}</span>
            <span class="plan-stat">${courseCount} course${courseCount === 1 ? '' : 's'}</span>
            <span class="plan-stat">${units || 0} units</span>
            ${conflictNote}
          </div>
        </div>
        ${this._renderPlanCalendar(items, conflicts)}
        ${this._renderPlanList(items, conflicts)}
      </div>
    `;
    this._syncDirectoryFabLayout();
    this._refreshNavPlanCount();
  },

  async showStudentFlagsView() {
    if (!isStudent(this.profile) || this.authMode !== 'authed') return;
    this._homeView = 'studentflags';
    const el = document.getElementById('leftBody');
    if (!el) return;
    await this._loadServerFlags();
    const items = this.serverFlags || [];
    const rows = items.length
      ? items.map(f => `
        <div class="adm-row adm-row-readonly">
          <div class="adm-course"><span class="adm-course-code">${esc(f.course_code)}</span><span class="adm-course-name">${esc(f.course_name)}</span></div>
          <span class="adm-status adm-status-${esc(f.status)}">${esc(f.status)}</span>
          <div class="adm-reason">${esc(f.reason_label)}</div>
          ${f.admin_notes ? `<div class="adm-notes adm-notes-admin">${esc(f.admin_notes)}</div>` : ''}
        </div>`).join('')
      : '<div class="empty-state"><div class="empty-text">No flagged courses right now.</div></div>';
    el.innerHTML = `
      <div class="adm-view">
        <div class="adm-header">
          <button class="dc-back-link" onclick="App.renderLeftEmpty()">Back to home</button>
          <div class="adm-title">Flagged courses <span class="adm-count">· ${items.length}</span></div>
        </div>
        <p class="adm-hint">Read-only. Students cannot submit flags. Faculty report and resolve issues.</p>
        <div class="adm-list">${rows}</div>
      </div>`;
  },

  async showStudentFavorites() {
    if (!isFaculty(this.profile) || this.authMode !== 'authed') {
      showToast('Faculty access required.');
      return;
    }
    this._homeView = 'studentfavs';
    const el = document.getElementById('leftBody');
    if (!el) return;
    el.innerHTML = '<div class="empty-state"><div class="spinner"></div><div class="empty-text" style="margin-top:12px">Loading student favorites…</div></div>';
    const r = await apiGetWishlistRoster();
    if (!r.ok) {
      el.innerHTML = `<div class="empty-state"><div class="empty-text">Could not load favorites: ${esc((r.data && r.data.message) || 'error')}</div></div>`;
      return;
    }
    const students = (r.data && r.data.students) || [];
    const blocks = students.length ? students.map(s => {
      const rows = (s.items || []).map(i => `
        <li><strong>${esc(i.course_code)}</strong>${i.note ? `: <em>${esc(i.note)}</em>` : ''}</li>`).join('') || '<li class="sf-empty">No saved courses</li>';
      return `
        <div class="sf-student">
          <div class="sf-student-head"><strong>${esc(s.name)}</strong> <span class="sf-email">${esc(s.email)}</span>${s.primary_program ? ` · ${esc(s.primary_program)}` : ''}</div>
          <ul class="sf-courses">${rows}</ul>
        </div>`;
    }).join('') : '<div class="empty-state"><div class="empty-text">No students have saved courses yet.</div></div>';
    el.innerHTML = `
      <div class="adm-view">
        <div class="adm-header">
          <button class="dc-back-link" onclick="App.renderLeftEmpty()">Back to home</button>
          <div class="adm-title">Student favorites <span class="adm-count">· ${students.length} students</span></div>
        </div>
        <div class="sf-list">${blocks}</div>
      </div>`;
  },

  // ══════════════════════════════════════════════════════════
  // COURSE FLAGGING (faculty only)
  // ══════════════════════════════════════════════════════════
  // Reasons are codified so admin review tooling can group/filter later.

  FLAG_REASONS: [
    { code: 'not_offered',         label: 'Course is no longer offered' },
    { code: 'campus_wrong',        label: 'Course campus availability is incorrect',         hint: 'Listed for the wrong campus (Doha / Pittsburgh).' },
    { code: 'metadata_outdated',   label: 'Course title, number, or units are outdated' },
    { code: 'prereq_wrong',        label: 'Prerequisites or corequisites are incorrect/missing' },
    { code: 'requirement_mismatch',label: 'Course is mapped to the wrong requirement/category', hint: 'Counting under the wrong major/minor requirement.' },
    { code: 'requirement_newly_counts', label: 'This course now counts toward a requirement it did not count for previously.' },
    { code: 'should_be_equivalent',label: 'Course should be added as an equivalent/substitute option' },
    { code: 'wrong_semester',      label: 'Course is listed as available in the wrong semester/year' },
    { code: 'restrictions_missing',label: 'Course restrictions are missing or incorrect',     hint: 'Permission required, major-only, class-year restriction, etc.' },
    { code: 'duplicate',           label: 'Duplicate or conflicting course entry' },
    { code: 'other',               label: 'Other issue' },
  ],

  _getFlags() {
    return loadStore('cf_flags', []);
  },
  _saveFlags(list) {
    saveStore('cf_flags', list);
  },
  _hasUnavailabilityFlag(code) {
    const flags = (this.serverFlags && this.serverFlags.length)
      ? this.serverFlags
      : this._getFlags();
    return flags.some(f =>
      this._sameCourse(f.course_code, code) &&
      (f.reason_code === 'not_offered' || f.reason_code === 'campus_wrong') &&
      f.status !== 'dismissed'
    );
  },

  _courseHasVisibleFlag(code) {
    const flags = this.serverFlags || [];
    return flags.some(f => this._sameCourse(f.course_code, code) && f.status !== 'dismissed');
  },

  _courseFlagStatus(code) {
    const f = (this.serverFlags || []).find(x => this._sameCourse(x.course_code, code) && x.status !== 'dismissed');
    return f ? f.status : '';
  },

  openFlagModal(courseCode) {
    if (!canFlagCourses(this.profile) || (this.authMode !== 'authed' && !this.isGuest)) {
      showToast('Course flagging is available to signed-in faculty only.');
      return;
    }
    if (this.authMode !== 'authed') {
      showToast('Sign in to flag a course.');
      return;
    }
    const course = lookupCourse(this.courseIndex, courseCode);
    if (!course) return;
    this._flagModalState = { courseCode, reason: null, notes: '' };

    const reasonItems = this.FLAG_REASONS.map(r => `
      <label class="cf-flag-reason">
        <input type="radio" name="cfReason" value="${r.code}">
        <span class="cf-flag-reason-text">
          <span class="cf-flag-reason-label">${esc(r.label)}</span>
          ${r.hint ? `<span class="cf-flag-reason-hint">${esc(r.hint)}</span>` : ''}
        </span>
      </label>
    `).join('');

    const modal = document.createElement('div');
    modal.className = 'cf-modal-backdrop';
    modal.id = 'cfFlagModalRoot';
    modal.innerHTML = `
      <div class="cf-modal" role="dialog" aria-modal="true" aria-labelledby="cfFlagTitle">
        <header class="cf-modal-head">
          <div>
            <h3 id="cfFlagTitle" class="cf-modal-title">Flag a course</h3>
            <div class="cf-modal-sub">Help us keep course data accurate. Any faculty member can review and resolve flags.</div>
          </div>
          <button class="cf-modal-x" aria-label="Close" onclick="App.closeFlagModal()">×</button>
        </header>
        <div class="cf-modal-body">
          <div class="cf-modal-course">
            <span class="cf-modal-course-code">${esc(course.course_code)}</span>
            <span class="cf-modal-course-name">${esc(course.course_name)}</span>
          </div>
          <fieldset class="cf-flag-fieldset">
            <legend class="cf-flag-legend">What's the issue?</legend>
            <div class="cf-flag-reasons">${reasonItems}</div>
          </fieldset>
          <label class="cf-flag-notes-wrap">
            <span class="cf-flag-notes-label">Additional context <span class="cf-flag-notes-opt">(optional)</span></span>
            <textarea class="cf-flag-notes" id="cfFlagNotes" placeholder="Anything else admins should know, e.g. 'Last offered Spring 2024 in Doha.'"></textarea>
          </label>
          <div class="cf-flag-attribution">
            <strong>Filed as:</strong> ${esc(getRoleLabel(this.profile))}${this.profile.primary ? ' · ' + esc(this.profile.primary) : ''}
          </div>
        </div>
        <footer class="cf-modal-foot">
          <button class="cf-btn cf-btn-secondary" onclick="App.closeFlagModal()">Cancel</button>
          <button class="cf-btn cf-btn-primary" id="cfFlagSubmit" disabled onclick="App.submitFlag()">Submit flag</button>
        </footer>
      </div>
    `;
    document.body.appendChild(modal);

    // Wire up reason selection → enables submit
    modal.addEventListener('change', (e) => {
      if (e.target.name === 'cfReason') {
        this._flagModalState.reason = e.target.value;
        const btn = document.getElementById('cfFlagSubmit');
        if (btn) btn.disabled = false;
      }
    });
    modal.addEventListener('input', (e) => {
      if (e.target.id === 'cfFlagNotes') this._flagModalState.notes = e.target.value;
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeFlagModal();
    });
  },

  closeFlagModal() {
    const root = document.getElementById('cfFlagModalRoot');
    if (root) root.remove();
    this._flagModalState = null;
  },

  async submitFlag() {
    const s = this._flagModalState;
    if (!s || !s.reason) return;
    const course = lookupCourse(this.courseIndex, s.courseCode);
    if (!course) return;

    const reasonMeta = this.FLAG_REASONS.find(r => r.code === s.reason);
    const flag = {
      id: 'flg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      course_code: course.course_code,
      course_name: course.course_name,
      reason_code: s.reason,
      reason_label: reasonMeta ? reasonMeta.label : s.reason,
      notes: (s.notes || '').trim(),
      role: this.profile.role,
      role_label: getRoleLabel(this.profile),
      primary: this.profile.primary || null,
      secondary: this.profile.secondary || null,
      timestamp: Date.now(),
      status: 'pending',
    };

    // Persist locally first so the action is reflected even if the network
    // is slow / offline — the server submission is best-effort sync.
    const flags = this._getFlags();
    flags.push(flag);
    this._saveFlags(flags);

    let toast = 'Flag submitted for admin review';
    if (this.authMode === 'authed') {
      const r = await apiCreateFlag(flag);
      if (!r.ok) {
        try { localStorage.removeItem('cf_synced'); } catch {}
        toast = 'Saved locally. Sync to server failed, will retry next sign-in.';
      }
    } else if (this.isGuest) {
      toast = 'Guest mode. Flag saved on this device only. Sign in to submit it for review.';
    } else {
      toast = 'Flag saved offline. Sign in to submit for admin review.';
    }

    this.closeFlagModal();
    showToast(toast);
    this.renderTree();
  },

  // ══════════════════════════════════════════════════════════
  // FACULTY — Staff directory (Postgres + JSON merge)
  // ══════════════════════════════════════════════════════════
  _staffDirState: {
    items: [],
    tab: 'add',
    search: '',
    form: { name: '', email: '', role: 'professor', department: '', primary_program: '' },
  },

  _staffInitials(name, email) {
    const src = (name || email || '?').trim();
    const parts = src.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return src.slice(0, 2).toUpperCase();
  },

  _avatarHtml(name, email, pictureUrl) {
    const initials = this._staffInitials(name, email);
    if (pictureUrl) {
      return `<div class="person-avatar" aria-hidden="true">
        <img class="person-avatar-img" src="${esc(pictureUrl)}" alt="" loading="lazy" decoding="async"
          onerror="this.classList.add('person-avatar-img--hidden'); this.nextElementSibling.classList.add('person-avatar-fallback--show');">
        <span class="person-avatar-fallback">${esc(initials)}</span>
      </div>`;
    }
    const imgSrc = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(name || email) + '&background=C41230&color=fff&size=80&bold=true';
    return `<div class="person-avatar" aria-hidden="true">
      <img class="person-avatar-img" src="${esc(imgSrc)}" alt="" loading="lazy" decoding="async"
        onerror="this.classList.add('person-avatar-img--hidden'); this.nextElementSibling.classList.add('person-avatar-fallback--show');">
      <span class="person-avatar-fallback">${esc(initials)}</span>
    </div>`;
  },

  _staffAvatarHtml(name, email, pictureUrl) {
    return this._avatarHtml(name, email, pictureUrl);
  },

  _directoryPanelOpen: false,

  closeDirectoryPanel() {
    if (!this._directoryPanelOpen) return;
    this._directoryPanelOpen = false;
    const root = document.getElementById('directoryPanelRoot');
    if (!root) return;
    root.hidden = true;
    root.innerHTML = '';
    root.onclick = null;
    if (this._homeView === 'admin-console' && this._adminConsole.tab === 'access') this._loadAdminAccess();
  },

  toggleDirectoryPanel() {
    if (!canManageDirectory(this.profile) || this.authMode !== 'authed') return;
    if (this._directoryPanelOpen) {
      this.closeDirectoryPanel();
      return;
    }
    this._directoryPanelOpen = true;
    this._staffDirState.tab = 'add';
    const root = document.getElementById('directoryPanelRoot');
    if (!root) return;
    root.hidden = false;
    root.innerHTML = '<div class="directory-panel"><div class="empty-state"><div class="spinner"></div></div></div>';
    root.onclick = (e) => {
      if (!e.target.closest('.directory-panel')) this.closeDirectoryPanel();
    };
    this._loadDirectoryPanel();
  },

  async _loadDirectoryPanel() {
    const r = await apiListStaffDirectory();
    const root = document.getElementById('directoryPanelRoot');
    if (!root || !this._directoryPanelOpen) return;
    if (!r.ok) {
      root.innerHTML = `<div class="directory-panel"><p class="empty-text">${esc((r.data && r.data.message) || 'Could not load directory.')}</p></div>`;
      return;
    }
    this._staffDirState.items = r.data.items || [];
    this._renderDirectoryPanel();
  },

  _renderDirectoryPanel() {
    const root = document.getElementById('directoryPanelRoot');
    if (!root) return;
    const st = this._staffDirState;
    const tab = st.tab || 'add';
    const f = st.form;
    const roleOpts = ['advisor', 'professor', 'area_head', 'associate_area_head', 'admin']
      .map(r => `<option value="${r}" ${f.role === r ? 'selected' : ''}>${esc((ROLE_META[r] && ROLE_META[r].label) || r)}</option>`).join('');
    const deptOpts = DEPARTMENT_LIST.map(d => `<option value="${esc(d)}" ${f.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('');
    const progOpts = VALID_PROGRAMS.map(p => `<option value="${p}" ${f.primary_program === p ? 'selected' : ''}>${esc(getProgramLabel(p))}</option>`).join('');

    const addPanel = `
      <div class="staff-add-card">
        <p class="directory-panel-lead">Directory members get the faculty view on sign-in. Role <strong>Admin</strong> grants full admin access.</p>
        <div class="staff-add-title">${f.editEmail ? 'Edit person' : 'Add person'}</div>
        <div class="staff-add-fields">
          <label>Full name<input class="adm-search" id="staffAddName" value="${esc(f.name)}" placeholder="Full name" autocomplete="name" /></label>
          <label>Email<input class="adm-search" id="staffAddEmail" value="${esc(f.email)}" placeholder="name@andrew.cmu.edu" autocomplete="email" inputmode="email" ${f.editEmail ? 'readonly' : ''} /></label>
          <label>Role<select class="adm-select" id="staffAddRole">${roleOpts}</select></label>
          <label>Department<select class="adm-select" id="staffAddDept"><option value="">None</option>${deptOpts}</select></label>
          <label>Program<select class="adm-select" id="staffAddProgram"><option value="">None</option>${progOpts}</select></label>
        </div>
        <div class="directory-form-actions">
          <button type="button" class="adm-btn adm-btn-resolve" onclick="App._submitDirectoryForm()">${f.editEmail ? 'Save changes' : 'Add to directory'}</button>
          ${f.editEmail ? '<button type="button" class="adm-btn" onclick="App._cancelDirectoryEdit()">Cancel</button>' : ''}
        </div>
      </div>`;

    const q = (st.search || '').trim().toLowerCase();
    const filtered = [...(st.items || [])]
      .filter(row => {
        if (!q) return true;
        const hay = `${row.name || ''} ${row.email || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));

    const searchRows = filtered.map(row => `
      <div class="staff-row">
        ${this._staffAvatarHtml(row.name, row.email, row.picture_url)}
        <div class="staff-row-body">
          <div class="staff-row-name">${esc(row.name)}</div>
          <div class="staff-row-meta">${esc(row.email)} · ${esc((ROLE_META[row.role] && ROLE_META[row.role].label) || row.role)} · ${esc(row.department || '')}${row.primary_program ? ' · ' + esc(getProgramLabel(row.primary_program)) : ''}</div>
        </div>
        <div class="staff-row-actions">
          <button type="button" class="adm-btn" onclick="App._editDirectoryRow('${esc(row.email)}')">Edit</button>
          <button type="button" class="adm-btn" onclick="App._revokeDirectoryRow('${esc(row.email)}', '${esc(row.name)}')">Remove</button>
        </div>
      </div>`).join('') || '<p class="empty-text">No matches.</p>';

    const searchPanel = `
      <div class="directory-search-panel">
        <label class="directory-search-label" for="directorySearchInput">Search by name or email</label>
        <input type="search" class="adm-search directory-search-input" id="directorySearchInput" value="${esc(st.search || '')}" placeholder="Start typing a name…" oninput="App._onDirectorySearchInput(this.value)" />
        <div class="staff-list">${searchRows}</div>
      </div>`;

    root.innerHTML = `
      <div class="directory-panel" role="dialog" aria-label="Faculty directory">
        <header class="directory-panel-head">
          <h3>Directory</h3>
          <button type="button" class="directory-panel-close" onclick="App.toggleDirectoryPanel()" aria-label="Close">×</button>
        </header>
        <div class="directory-tabs" role="tablist" aria-label="Directory sections">
          <button type="button" class="directory-tab ${tab === 'add' ? 'is-active' : ''}" role="tab" aria-selected="${tab === 'add' ? 'true' : 'false'}" onclick="App._setDirectoryTab('add')">Add person</button>
          <button type="button" class="directory-tab ${tab === 'search' ? 'is-active' : ''}" role="tab" aria-selected="${tab === 'search' ? 'true' : 'false'}" onclick="App._setDirectoryTab('search')">Search</button>
        </div>
        ${tab === 'add' ? addPanel : searchPanel}
      </div>`;
  },

  _setDirectoryTab(tab) {
    this._staffDirState.tab = tab;
    this._renderDirectoryPanel();
    if (tab === 'search') {
      const input = document.getElementById('directorySearchInput');
      if (input) input.focus();
    }
  },

  _onDirectorySearchInput(value) {
    this._staffDirState.search = value;
    this._renderDirectoryPanel();
    const input = document.getElementById('directorySearchInput');
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  },

  _editDirectoryRow(email) {
    const row = (this._staffDirState.items || []).find(r => r.email === email);
    if (!row) return;
    this._staffDirState.tab = 'add';
    this._staffDirState.form = {
      name: row.name,
      email: row.email,
      editEmail: row.email,
      role: row.role,
      department: row.department || '',
      primary_program: row.primary_program || '',
    };
    this._renderDirectoryPanel();
  },

  _cancelDirectoryEdit() {
    this._staffDirState.form = { name: '', email: '', role: 'professor', department: '', primary_program: '' };
    this._renderDirectoryPanel();
  },

  async _revokeDirectoryRow(email, name) {
    if (!confirm('Remove ' + (name || email) + ' from the directory? They will lose elevated access on next login.')) return;
    const row = (this._staffDirState.items || []).find(r => r.email === email);
    const r = row && row.id
      ? await apiDeleteDirectoryEntry(row.id)
      : await apiRevokeDirectoryAccess({ email, name });
    if (!r.ok) {
      showToast((r.data && r.data.message) || 'Could not remove.');
      return;
    }
    showToast('Removed from directory.');
    await this._loadDirectoryPanel();
  },

  async _submitDirectoryForm() {
    const f = this._staffDirState.form;
    const body = {
      name: (document.getElementById('staffAddName')?.value || '').trim(),
      email: (document.getElementById('staffAddEmail')?.value || '').trim(),
      role: document.getElementById('staffAddRole')?.value || 'professor',
      department: document.getElementById('staffAddDept')?.value || '',
      primary_program: document.getElementById('staffAddProgram')?.value || '',
    };
    if (!body.name || !body.email) {
      showToast('Enter a full name and email.');
      return;
    }
    const r = f.editEmail
      ? await apiUpsertDirectoryByEmail(body)
      : await apiAddStaffMember(body);
    if (!r.ok) {
      showToast((r.data && r.data.message) || 'Could not save.');
      return;
    }
    const roleLabel = (ROLE_META[body.role] && ROLE_META[body.role].label) || body.role;
    showToast(f.editEmail
      ? 'Directory updated.'
      : `Added. They get ${roleLabel === 'Admin' ? 'admin' : 'faculty'} access the next time they sign in.`);
    this._staffDirState.form = { name: '', email: '', role: 'professor', department: '', primary_program: '' };
    await this._loadDirectoryPanel();
    this._setDirectoryTab('search');
  },

  // ══════════════════════════════════════════════════════════
  // ADMIN — Admin page (overview, users, access, flags, insights, activity)
  // ══════════════════════════════════════════════════════════
  _adminConsole: { tab: 'courses', semester: '', activityAction: '', activityItems: [], activityTotal: 0, activityPage: 1 },

  ADMIN_TABS: [
    ['courses', 'Courses'],
    ['overview', 'Overview'],
    ['users', 'Users'],
    ['access', 'Faculty access'],
    ['flags', 'Flags'],
    ['insights', 'Insights'],
    ['activity', 'Activity log'],
  ],

  async showAdminConsole(tab) {
    if (!canManageUsers(this.authedUser)) {
      showToast('Admin access required.');
      return;
    }
    if (this._homeView === 'plan' || this.selectedCourse) {
      this.selectedCourse = null;
      this._planDetailId = null;
      this._homeView = 'admin-console';
      this.renderShell();
    }
    this._homeView = 'admin-console';
    if (tab) this._adminConsole.tab = tab;
    const el = document.getElementById('leftBody');
    if (!el) return;
    const active = this._adminConsole.tab;
    el.innerHTML = `
      <div class="adm-view adm-console">
        <div class="adm-header">
          <button class="dc-back-link" onclick="App.renderLeftEmpty()">Back to home</button>
          <div class="adm-title">Admin</div>
        </div>
        <div class="adm-console-tabs" role="tablist" aria-label="Admin sections">
          ${this.ADMIN_TABS.map(([id, label]) => `
            <button type="button" class="adm-console-tab ${active === id ? 'is-active' : ''}" role="tab"
              aria-selected="${active === id ? 'true' : 'false'}" data-tab="${id}" onclick="App._setAdminTab('${id}')">${label}</button>`).join('')}
        </div>
        <div id="admContent" class="adm-console-body"></div>
      </div>`;
    this._syncDirectoryFabLayout();
    await this._loadAdminTab();
  },

  async _setAdminTab(tab) {
    this._adminConsole.tab = tab;
    document.querySelectorAll('.adm-console-tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    await this._loadAdminTab();
  },

  async _loadAdminTab() {
    const el = document.getElementById('admContent');
    if (!el) return;
    el.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
    const tab = this._adminConsole.tab;
    if (tab === 'courses') return this._renderAdminCourses();
    if (tab === 'overview') return this._loadAdminOverview();
    if (tab === 'users') return this._loadUserAdmin();
    if (tab === 'access') return this._loadAdminAccess();
    if (tab === 'flags') return this._loadFlagReview();
    if (tab === 'insights') return this._loadAdminInsights();
    if (tab === 'activity') return this._loadAdminActivity(true);
  },

  /** Admin sub-views render into the Admin page when it is open, else the left panel. */
  _admEl() {
    return document.getElementById('admContent') || document.getElementById('leftBody');
  },

  _admEmbedded() {
    return !!document.getElementById('admContent');
  },

  _admError(r, what) {
    const el = this._admEl();
    if (el) el.innerHTML = `<div class="empty-state"><div class="empty-text">Could not load ${what}: ${esc((r.data && r.data.message) || r.error || 'error')}</div></div>`;
  },

  /** Server times are UTC; SQLite drops the offset, so treat bare timestamps as UTC. */
  _admParse(iso) {
    if (!iso) return null;
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + 'Z');
    return isNaN(d) ? null : d;
  },

  _admWhen(iso) {
    const d = this._admParse(iso);
    if (!d) return '';
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  },

  _admDate(iso) {
    const d = this._admParse(iso);
    return !d ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },

  _admRoleLabel(role) {
    return (ROLE_META[role] && ROLE_META[role].label) || role || '';
  },

  _admCourseLabel(code) {
    const c = this.courseIndex ? lookupCourse(this.courseIndex, code) : null;
    return c && c.course_name ? c.course_name : '';
  },

  _admStat(value, label, sub, onclick) {
    const tag = onclick ? 'button' : 'div';
    return `
      <${tag} class="adm-stat ${onclick ? 'adm-stat-link' : ''}" ${onclick ? `type="button" onclick="${onclick}"` : ''}>
        <div class="adm-stat-value">${esc(String(value))}</div>
        <div class="adm-stat-label">${esc(label)}</div>
        ${sub ? `<div class="adm-stat-sub">${esc(sub)}</div>` : ''}
      </${tag}>`;
  },

  // ── Courses (catalog edits) ───────────────────────────────
  _courseAdmin: { view: 'list', q: '', filter: 'all', key: null, draft: null },

  _courseEditKey(course) {
    // Edits to a scraped course stay keyed by its catalog number, even after renumbering.
    if (course._edit) return course._edit.course_code;
    return course.course_code;
  },

  _courseIsEdited(c) {
    const e = c._edit;
    return !!(e && !c._added && (Object.keys(e.fields || {}).length || e.requirements));
  },

  // Raw segments joined with ›. Used for datalist values, which
  // _reqPathFromInput turns back into the stored path, so no LABEL_OVERRIDES.
  _courseReqLabel(path) {
    return String(path || '').split('---').join(' › ');
  },

  // Display only: the same path with LABEL_OVERRIDES applied to each segment.
  _courseReqDisplayLabel(path) {
    return String(path || '').split('---').map(p => LABEL_OVERRIDES[p] || p).join(' › ');
  },

  _courseMatches(c, q) {
    if (!q) return true;
    const code = (c.course_code || '').toLowerCase();
    return code.includes(q) || code.replace('-', '').includes(q.replace('-', ''))
      || (c.course_name || '').toLowerCase().includes(q);
  },

  _renderAdminCourses() {
    const st = this._courseAdmin;
    if (st.view === 'edit' || st.view === 'add') return this._renderCourseEditor();
    if (st.view === 'saved') return this._renderCourseSaved();
    const el = document.getElementById('admContent');
    if (!el) return;
    const all = this.courses || [];
    const archived = this._archivedCourses || [];
    const editedCount = all.filter(c => this._courseIsEdited(c)).length;
    const addedCount = all.filter(c => c._added).length;
    const chip = (id, label, n) => `<button type="button" class="adm-chip ${st.filter === id ? 'is-active' : ''}" onclick="App._setCourseFilter('${id}')">${label}${n != null ? ` <span class="adm-chip-n">${n}</span>` : ''}</button>`;
    el.innerHTML = `
      <div class="adm-card adm-card-row">
        <div>
          <div class="adm-card-title">Course catalog</div>
          <p class="adm-card-text">${all.length.toLocaleString()} courses from the Schedule of Classes. Changes made here are kept when the daily scrape refreshes the catalog, and students see them the next time they load CountsFor.</p>
        </div>
        <button type="button" class="adm-btn adm-btn-resolve" onclick="App._openCourseAdd()">Add a course</button>
      </div>
      <div class="adm-search-row">
        <input type="search" class="adm-search" id="admCourseSearch" placeholder="Search by number or name, for example 15-122 or Calculus"
          value="${esc(st.q)}" oninput="App._onCourseSearch(this.value)" autocomplete="off" />
      </div>
      <div class="adm-toolbar">
        ${chip('all', 'All courses')}
        ${chip('edited', 'Edited', editedCount)}
        ${chip('added', 'Added here', addedCount)}
        ${chip('archived', 'Archived', archived.length)}
        <span class="adm-toolbar-count" id="admCourseCount"></span>
      </div>
      <div id="admCourseResults"></div>`;
    this._renderCourseResults();
  },

  _setCourseFilter(id) {
    this._courseAdmin.filter = id;
    this._renderAdminCourses();
  },

  _onCourseSearch(value) {
    this._courseAdmin.q = value;
    this._renderCourseResults();
  },

  _renderCourseResults() {
    const st = this._courseAdmin;
    const box = document.getElementById('admCourseResults');
    if (!box) return;
    const q = st.q.trim().toLowerCase();
    let pool;
    if (st.filter === 'archived') pool = this._archivedCourses || [];
    else if (st.filter === 'edited') pool = (this.courses || []).filter(c => this._courseIsEdited(c));
    else if (st.filter === 'added') pool = (this.courses || []).filter(c => c._added);
    else pool = this.courses || [];
    const matches = pool.filter(c => this._courseMatches(c, q))
      .sort((a, b) => (a.course_code || '').localeCompare(b.course_code || ''));
    const LIMIT = 60;
    const countEl = document.getElementById('admCourseCount');
    if (countEl) countEl.textContent = matches.length > LIMIT ? `Showing ${LIMIT} of ${matches.length.toLocaleString()}` : `${matches.length.toLocaleString()} course${matches.length === 1 ? '' : 's'}`;
    if (!q && st.filter === 'all') {
      box.innerHTML = '<p class="adm-empty-line">Search for a course to edit it, or use the filters to see what has already been changed.</p>';
      if (countEl) countEl.textContent = '';
      return;
    }
    if (!matches.length) {
      box.innerHTML = '<div class="empty-state"><div class="empty-text">No courses match.</div></div>';
      return;
    }
    const archivedView = st.filter === 'archived';
    box.innerHTML = `<ul class="adm-course-list">${matches.slice(0, LIMIT).map(c => {
      const where = [c.offered_qatar ? 'Qatar' : '', c.offered_pitts ? 'Pittsburgh' : ''].filter(Boolean).join(' · ');
      const tags = [
        c._added ? '<span class="adm-pill adm-pill-new">Added here</span>' : '',
        this._courseIsEdited(c) && !archivedView ? '<span class="adm-pill adm-pill-edit">Edited</span>' : '',
        archivedView ? '<span class="adm-pill">Archived</span>' : '',
        c.superseded_by ? `<span class="adm-pill">Replaced by ${esc(c.superseded_by)}</span>` : '',
      ].join('');
      const key = esc(this._courseEditKey(c));
      return `
        <li>
          <button type="button" class="adm-course-item" onclick="App._openCourseEditor('${key}', ${archivedView})">
            <span class="adm-course-item-code">${esc(c.course_code)}</span>
            <span class="adm-course-item-body">
              <span class="adm-course-item-name">${esc(c.course_name || 'Untitled')}</span>
              <span class="adm-cell-sub">${c.units ? esc(String(c.units)) + ' units' : 'Units not set'}${where ? ' · ' + esc(where) : ''}</span>
            </span>
            <span class="adm-course-item-tags">${tags}</span>
          </button>
        </li>`;
    }).join('')}</ul>`;
  },

  _findCourseByKey(key, archived) {
    const pool = archived ? (this._archivedCourses || []) : (this.courses || []);
    return pool.find(c => this._courseEditKey(c) === key) || null;
  },

  _courseDraftFrom(course) {
    const reqs = {};
    for (const m of MAJOR_ORDER) {
      reqs[m] = ((course && course.requirements && course.requirements[m]) || [])
        .map(r => ({ requirement: r.requirement, type: !!r.type }));
    }
    return {
      course_code: course ? course.course_code : '',
      course_name: course ? (course.course_name || '') : '',
      department: course ? String(course.department || '') : '',
      units: course ? (course.units != null ? String(course.units) : '') : '',
      description: course ? (course.description || '') : '',
      prerequisites: course ? (course.prerequisites || '') : '',
      offered_qatar: course ? !!course.offered_qatar : true,
      offered_pitts: course ? !!course.offered_pitts : false,
      offered: course && Array.isArray(course.offered) ? course.offered.join(', ') : '',
      requirements: reqs,
    };
  },

  _openCourseEditor(key, archived) {
    const course = this._findCourseByKey(key, archived);
    if (!course) {
      showToast('That course is no longer in the catalog.');
      return;
    }
    this._courseAdmin.view = 'edit';
    this._courseAdmin.key = key;
    this._courseAdmin.archived = !!archived;
    this._courseAdmin.draft = this._courseDraftFrom(course);
    this._renderCourseEditor();
    const top = document.getElementById('admContent');
    if (top) top.scrollIntoView({ block: 'start' });
  },

  _openCourseAdd() {
    this._courseAdmin.view = 'add';
    this._courseAdmin.key = null;
    this._courseAdmin.archived = false;
    this._courseAdmin.draft = this._courseDraftFrom(null);
    this._renderCourseEditor();
  },

  _closeCourseEditor() {
    this._courseAdmin.view = 'list';
    this._courseAdmin.draft = null;
    this._courseAdmin.saved = null;
    this._renderAdminCourses();
  },

  /** Confirmation screen shown right after a course is added or saved. */
  _renderCourseSaved() {
    const el = document.getElementById('admContent');
    const s = this._courseAdmin.saved;
    if (!el || !s) return this._closeCourseEditor();
    const course = this._findCourseByKey(s.key, false);
    const name = course ? course.course_name : s.name;
    const code = course ? course.course_code : s.code;
    const where = course ? [course.offered_qatar ? 'Qatar' : '', course.offered_pitts ? 'Pittsburgh' : ''].filter(Boolean).join(' · ') : '';
    const reqCount = course ? MAJOR_ORDER.reduce((n, m) => n + ((course.requirements && course.requirements[m]) || []).length, 0) : 0;
    const changes = (s.changes || []).map(c => `<li>${esc(c)}</li>`).join('');
    el.innerHTML = `
      <div class="adm-saved" role="status" aria-live="polite">
        <div class="adm-saved-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
        </div>
        <div class="adm-saved-kicker">${s.adding ? 'Course added' : 'Changes saved'}</div>
        <div class="adm-saved-title">${esc(code)} ${esc(name || '')}</div>
        <p class="adm-card-text">${s.adding
          ? 'It is now part of the catalog. Students will see it the next time they open CountsFor.'
          : 'Students will see the updated course the next time they open CountsFor.'}</p>
        <dl class="adm-saved-facts">
          <div><dt>Units</dt><dd>${course && course.units ? esc(String(course.units)) : 'Not set'}</dd></div>
          <div><dt>Campus</dt><dd>${esc(where || 'Not listed')}</dd></div>
          <div><dt>Counts for</dt><dd>${reqCount ? reqCount + ' requirement' + (reqCount === 1 ? '' : 's') : 'Nothing yet'}</dd></div>
        </dl>
        ${changes ? `<div class="adm-saved-changes"><div class="adm-mini-title">What changed</div><ul>${changes}</ul></div>` : ''}
        <div class="adm-actions adm-saved-actions">
          <button type="button" class="adm-btn adm-btn-resolve" onclick="App._closeCourseEditor()">Back to courses</button>
          ${course ? `<button type="button" class="adm-btn" onclick="App._viewSavedCourse()">See it as a student</button>` : ''}
          <button type="button" class="adm-btn" onclick="App._openCourseEditor('${esc(s.key)}', false)">Edit again</button>
          <button type="button" class="adm-btn" onclick="App._openCourseAdd()">Add another course</button>
        </div>
      </div>`;
    const top = document.getElementById('admContent');
    if (top) top.scrollIntoView({ block: 'start' });
  },

  _viewSavedCourse() {
    const s = this._courseAdmin.saved;
    const course = s && this._findCourseByKey(s.key, false);
    if (!course) return;
    this._courseAdmin.view = 'list';
    this._courseAdmin.saved = null;
    this._homeView = 'home';
    this._selectCourse(course);
  },

  /** Copy the form inputs into the draft so re-rendering the editor keeps what was typed. */
  _syncCourseDraft() {
    const d = this._courseAdmin.draft;
    if (!d) return;
    const val = id => { const el = document.getElementById(id); return el ? el.value : null; };
    const chk = id => { const el = document.getElementById(id); return el ? el.checked : null; };
    const fields = { course_code: 'ce-code', course_name: 'ce-name', department: 'ce-dept', units: 'ce-units', description: 'ce-desc', prerequisites: 'ce-prereq', offered: 'ce-offered' };
    for (const [k, id] of Object.entries(fields)) { const v = val(id); if (v !== null) d[k] = v; }
    const q = chk('ce-qatar'); if (q !== null) d.offered_qatar = q;
    const pi = chk('ce-pitts'); if (pi !== null) d.offered_pitts = pi;
  },

  _renderCourseEditor() {
    const el = document.getElementById('admContent');
    const st = this._courseAdmin;
    const d = st.draft;
    if (!el || !d) return;
    const adding = st.view === 'add';
    const course = adding ? null : this._findCourseByKey(st.key, st.archived);
    const cat = (course && course._catalog) || {};
    const was = (field, fmt) => (field in cat)
      ? `<span class="adm-field-was">Schedule of Classes says: ${esc(fmt ? fmt(cat[field]) : (cat[field] === '' || cat[field] == null ? '(blank)' : String(cat[field])))}</span>` : '';
    const known = this._knownReqPaths || (this._knownReqPaths = knownRequirementPaths(this.courses || []));
    const edit = course && course._edit;
    // A retired number is hidden from students; its current row is what they see.
    const retired = !adding && !st.archived && course && course.superseded_by
      ? normalizeCourseCode(course.superseded_by) : '';
    const locked = st.archived || !!retired;

    const reqSections = MAJOR_ORDER.map(prog => {
      const list = d.requirements[prog] || [];
      const options = [...known[prog].keys()].sort().map(p => `<option value="${esc(this._courseReqLabel(p))}"></option>`).join('');
      const chips = list.map((r, i) => `
        <li class="adm-req">
          <span class="adm-req-tag ${r.type ? 'is-gened' : ''}">${r.type ? 'Gen Ed' : 'Core'}</span>
          <span class="adm-req-path">${esc(this._courseReqDisplayLabel(r.requirement))}</span>
          <button type="button" class="adm-req-x" onclick="App._removeCourseReq('${prog}', ${i})" aria-label="Remove this requirement">×</button>
        </li>`).join('');
      return `
        <div class="adm-req-group">
          <div class="adm-req-head">${esc(getProgramLabel(prog) || prog)} <span class="adm-cell-sub">${list.length ? list.length + ' requirement' + (list.length === 1 ? '' : 's') : 'Does not count for anything'}</span></div>
          ${chips ? `<ul class="adm-req-list">${chips}</ul>` : ''}
          <div class="adm-req-add">
            <input class="adm-search" id="ce-req-${prog}" list="ce-dl-${prog}" placeholder="Pick or type a category, for example GenEd › Humanities/Arts Electives" oninput="App._onCourseReqInput('${prog}')" />
            <datalist id="ce-dl-${prog}">${options}</datalist>
            <select class="adm-select" id="ce-req-type-${prog}" title="Only used for a category that does not exist yet" hidden>
              <option value="core">Core</option><option value="gened">Gen Ed</option>
            </select>
            <button type="button" class="adm-btn" onclick="App._addCourseReq('${prog}')">Add</button>
          </div>
          <div class="adm-req-hint" id="ce-req-hint-${prog}" hidden>New category. Choose whether it is Core or Gen Ed.</div>
        </div>`;
    }).join('');

    const actions = adding
      ? `<button type="button" class="adm-btn adm-btn-resolve adm-btn-primary" id="ce-save" onclick="App._saveCourse()">Add course</button>
         <button type="button" class="adm-btn" onclick="App._closeCourseEditor()">Cancel</button>`
      : retired
        ? `<button type="button" class="adm-btn adm-btn-resolve adm-btn-primary" onclick="App._openCourseEditor('${esc(retired)}', false)">Edit ${esc(retired)}</button>
           <button type="button" class="adm-btn" onclick="App._closeCourseEditor()">Back</button>`
      : st.archived
        ? `<button type="button" class="adm-btn adm-btn-resolve" onclick="App._restoreCourse()">Restore course</button>
           <button type="button" class="adm-btn" onclick="App._closeCourseEditor()">Back</button>`
        : `<button type="button" class="adm-btn adm-btn-resolve adm-btn-primary" id="ce-save" onclick="App._saveCourse()">Save changes</button>
           <button type="button" class="adm-btn" onclick="App._closeCourseEditor()">Cancel</button>
           <span class="adm-actions-spacer"></span>
           ${this._courseIsEdited(course) ? '<button type="button" class="adm-btn" onclick="App._revertCourse()" title="Remove every manual change and show the Schedule of Classes version">Undo all edits</button>' : ''}
           <button type="button" class="adm-btn adm-btn-dismiss" onclick="App._archiveCourse()" title="Hide from students. Nothing is deleted and it can be restored.">Archive</button>`;

    el.innerHTML = `
      <div class="adm-editor">
        <button type="button" class="dc-back-link" onclick="App._closeCourseEditor()">Back to courses</button>
        <div class="adm-editor-head">
          <div class="adm-title">${adding ? 'Add a course' : esc(d.course_code) + ' ' + esc(d.course_name)}</div>
          ${st.archived ? '<p class="adm-card-text">This course is archived, so students do not see it. Restore it to edit it again.</p>' : ''}
          ${retired ? `<p class="adm-card-text">This number was replaced by ${esc(retired)}. Students only see ${esc(retired)}, so edit that course instead.</p>` : ''}
          ${edit && edit.updated_at ? `<p class="adm-cell-sub">Last edited ${esc(this._admWhen(edit.updated_at))}${edit.updated_by_email ? ' by ' + esc(edit.updated_by_email) : ''}</p>` : ''}
          ${!adding && course && !course._added && !this._courseIsEdited(course) ? '<p class="adm-cell-sub">Showing the Schedule of Classes version. Nothing has been changed yet.</p>' : ''}
        </div>
        <fieldset class="adm-fieldset" ${locked ? 'disabled' : ''}>
          <div class="adm-form-grid">
            <label class="adm-field">Course number<input class="adm-search" id="ce-code" value="${esc(d.course_code)}" placeholder="15-122" inputmode="numeric" />${was('course_code')}</label>
            <label class="adm-field adm-field-wide">Course name<input class="adm-search" id="ce-name" value="${esc(d.course_name)}" placeholder="Principles of Imperative Computation" />${was('course_name')}</label>
            <label class="adm-field">Department number<input class="adm-search" id="ce-dept" value="${esc(d.department)}" placeholder="15" inputmode="numeric" />${was('department')}</label>
            <label class="adm-field">Units<input class="adm-search" id="ce-units" value="${esc(d.units)}" placeholder="9" inputmode="decimal" />${was('units')}</label>
            <label class="adm-field">Semesters offered<input class="adm-search" id="ce-offered" value="${esc(d.offered)}" placeholder="F26, S27" />${was('offered', v => (v || []).join(', ') || '(none)')}</label>
            <div class="adm-field">Campus
              <div class="adm-checks">
                <label><input type="checkbox" id="ce-qatar" ${d.offered_qatar ? 'checked' : ''} /> Qatar</label>
                <label><input type="checkbox" id="ce-pitts" ${d.offered_pitts ? 'checked' : ''} /> Pittsburgh</label>
              </div>
            </div>
            <label class="adm-field adm-field-full">Description<textarea class="adm-search adm-textarea" id="ce-desc" rows="4">${esc(d.description)}</textarea>${'description' in cat ? '<span class="adm-field-was">Changed from the Schedule of Classes text.</span>' : ''}</label>
            <label class="adm-field adm-field-full">Prerequisites<input class="adm-search" id="ce-prereq" value="${esc(d.prerequisites)}" placeholder="15-112" />${was('prerequisites')}</label>
          </div>
          <div class="adm-card-title adm-section-title">What it counts for</div>
          <p class="adm-card-text">The requirements this course fulfills in each major. ${'requirements' in cat ? 'These have been edited here.' : ''}</p>
          <div class="adm-req-groups">${reqSections}</div>
        </fieldset>
        <div class="adm-actions adm-editor-actions">${actions}
          <div class="adm-form-notice" id="ce-notice" role="alert" hidden></div>
        </div>
      </div>`;
  },

  _reqPathFromInput(prog) {
    const input = document.getElementById('ce-req-' + prog);
    const raw = input ? input.value.trim() : '';
    if (!raw) return '';
    return raw.split(/\s*›\s*|\s*---\s*/).map(s => s.trim()).filter(Boolean).join('---');
  },

  _onCourseReqInput(prog) {
    const path = this._reqPathFromInput(prog);
    const known = this._knownReqPaths || {};
    const isNew = !!path && !(known[prog] && known[prog].has(path));
    const sel = document.getElementById('ce-req-type-' + prog);
    const hint = document.getElementById('ce-req-hint-' + prog);
    if (sel) {
      sel.hidden = !isNew;
      if (isNew) sel.value = /^gened/i.test(path) ? 'gened' : 'core';
    }
    if (hint) hint.hidden = !isNew;
  },

  _addCourseReq(prog) {
    const path = this._reqPathFromInput(prog);
    if (!path) return;
    this._syncCourseDraft();
    const list = this._courseAdmin.draft.requirements[prog];
    if (list.some(r => r.requirement === path)) {
      showToast('Already listed.');
      return;
    }
    const known = this._knownReqPaths[prog];
    const sel = document.getElementById('ce-req-type-' + prog);
    const type = known.has(path) ? known.get(path) : (sel ? sel.value === 'gened' : false);
    list.push({ requirement: path, type });
    this._renderCourseEditor();
    const next = document.getElementById('ce-req-' + prog);
    if (next) next.focus();
  },

  _removeCourseReq(prog, index) {
    this._syncCourseDraft();
    this._courseAdmin.draft.requirements[prog].splice(index, 1);
    this._renderCourseEditor();
  },

  _parseOffered(text) {
    return String(text || '').split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  },

  /** Show a message next to the Save button (instead of a toast that is easy to miss). */
  _courseFormNotice(msg, fieldId) {
    const box = document.getElementById('ce-notice');
    if (box) {
      box.textContent = msg;
      box.hidden = !msg;
    } else if (msg) {
      showToast(msg);
    }
    if (fieldId) {
      const f = document.getElementById(fieldId);
      if (f) {
        f.classList.add('adm-input-error');
        f.focus();
        f.addEventListener('input', () => f.classList.remove('adm-input-error'), { once: true });
      }
    }
  },

  /** A category typed into a "Pick or type" box but never added with its Add button still counts on save. */
  _collectPendingCourseReqs() {
    const d = this._courseAdmin.draft;
    const known = this._knownReqPaths || {};
    for (const prog of MAJOR_ORDER) {
      const path = this._reqPathFromInput(prog);
      if (!path) continue;
      const list = d.requirements[prog];
      if (list.some(r => r.requirement === path)) continue;
      const sel = document.getElementById('ce-req-type-' + prog);
      const type = known[prog] && known[prog].has(path) ? known[prog].get(path) : (sel ? sel.value === 'gened' : /^gened/i.test(path));
      list.push({ requirement: path, type });
    }
  },

  async _saveCourse() {
    if (this._courseSaving) return;
    this._syncCourseDraft();
    this._collectPendingCourseReqs();
    this._courseFormNotice('');
    const st = this._courseAdmin;
    const d = st.draft;
    const adding = st.view === 'add';
    const code = normalizeCourseCode(d.course_code) || d.course_code.trim();
    if (!/^\d{2}-\d{3}$/.test(code)) {
      this._courseFormNotice('Course number must look like 15-122.', 'ce-code');
      return;
    }
    if (!d.course_name.trim()) {
      this._courseFormNotice('Course name is required.', 'ce-name');
      return;
    }
    const course = adding ? null : this._findCourseByKey(st.key, false);
    if (course && course.superseded_by) {
      this._courseFormNotice(`This number was replaced by ${course.superseded_by}. Edit that course instead.`);
      return;
    }
    // Exact codes: the course index also maps retired numbers to their
    // current row, which would make a retired row clash with itself.
    const clash = [...(this.courses || []), ...(this._archivedCourses || [])]
      .find(c => c !== course && c.course_code === code);
    if (clash) {
      this._courseFormNotice(`${code} is already in the catalog. Edit that course instead.`, 'ce-code');
      return;
    }
    const renamedFrom = (this.courses || []).find(c => Array.isArray(c.previous_codes)
      && c.previous_codes.some(p => normalizeCourseCode(p) === code));
    if (renamedFrom && (!course || course.course_code !== code)) {
      this._courseFormNotice(`${code} is an old number of ${renamedFrom.course_code}. Use a different number.`, 'ce-code');
      return;
    }
    const offered = this._parseOffered(d.offered);
    if (offered.some(s => !/^[FSMN]\d{2}$/.test(s))) {
      this._courseFormNotice('Semesters must be codes like F26 or S27, separated by commas.', 'ce-offered');
      return;
    }
    const reqs = {};
    for (const m of MAJOR_ORDER) reqs[m] = d.requirements[m].map(r => ({ requirement: r.requirement, type: !!r.type }));

    let r;
    let changes = [];
    if (adding) {
      changes = null;
      this._setCourseSaving(true, 'Adding...');
      r = await apiAddCourse({
        course_code: code,
        course_name: d.course_name.trim(),
        department: d.department.trim(),
        units: d.units.trim() === '' ? 0 : d.units.trim(),
        description: d.description,
        prerequisites: d.prerequisites,
        offered_qatar: d.offered_qatar,
        offered_pitts: d.offered_pitts,
        offered,
        requirements: reqs,
      });
    } else {
      const before = this._courseDraftFrom(course);
      const body = {};
      if (code !== course.course_code) body.new_code = code;
      for (const f of ['course_name', 'department', 'description', 'prerequisites']) {
        if (d[f].trim() !== String(before[f]).trim()) body[f] = d[f].trim();
      }
      if (d.units.trim() !== before.units.trim()) body.units = d.units.trim();
      if (d.offered_qatar !== before.offered_qatar) body.offered_qatar = d.offered_qatar;
      if (d.offered_pitts !== before.offered_pitts) body.offered_pitts = d.offered_pitts;
      if (offered.join(',') !== this._parseOffered(before.offered).join(',')) body.offered = offered;
      if (JSON.stringify(reqs) !== JSON.stringify(before.requirements)) body.requirements = reqs;
      if (!Object.keys(body).length) {
        this._courseFormNotice('There is nothing to save yet. Change a field first, or press Cancel to go back.');
        return;
      }
      const labels = {
        new_code: `Course number is now ${code}`, course_name: 'Course name', department: 'Department number',
        units: 'Units', description: 'Description', prerequisites: 'Prerequisites',
        offered_qatar: 'Campus (Qatar)', offered_pitts: 'Campus (Pittsburgh)', offered: 'Semesters offered',
        requirements: 'What it counts for',
      };
      changes = Object.keys(body).map(k => labels[k] || k);
      this._setCourseSaving(true, 'Saving...');
      r = await apiEditCourse(st.key, body);
    }
    if (!r.ok) {
      this._setCourseSaving(false);
      this._courseFormNotice((r.data && r.data.message) || r.error || 'Could not save the course. Try again.');
      return;
    }
    const key = r.data.course_code || code;
    await this._reloadCatalog();
    this._setCourseSaving(false);
    st.view = 'saved';
    st.draft = null;
    st.saved = { key, code, name: d.course_name.trim(), adding, changes };
    this._renderCourseSaved();
  },

  _setCourseSaving(on, label) {
    this._courseSaving = !!on;
    const btn = document.getElementById('ce-save');
    if (!btn) return;
    if (on) {
      btn.dataset.label = btn.textContent;
      btn.textContent = label || 'Saving...';
    } else if (btn.dataset.label) {
      btn.textContent = btn.dataset.label;
    }
    btn.disabled = !!on;
  },

  async _archiveCourse() {
    const st = this._courseAdmin;
    const course = this._findCourseByKey(st.key, false);
    if (!course || course.superseded_by) return;
    if (!confirm(`Archive ${course.course_code} ${course.course_name}? Students will stop seeing it. Nothing is deleted, and you can restore it from the Archived list.`)) return;
    const r = await apiArchiveCourse(st.key);
    if (!r.ok) {
      showToast((r.data && r.data.message) || 'Could not archive the course.');
      return;
    }
    await this._reloadCatalog();
    showToast(`${course.course_code} archived.`);
    this._closeCourseEditor();
  },

  async _restoreCourse() {
    const st = this._courseAdmin;
    const r = await apiRestoreCourse(st.key);
    if (!r.ok) {
      showToast((r.data && r.data.message) || 'Could not restore the course.');
      return;
    }
    await this._reloadCatalog();
    showToast('Course restored.');
    this._openCourseEditor(st.key, false);
  },

  async _revertCourse() {
    const st = this._courseAdmin;
    const course = this._findCourseByKey(st.key, false);
    if (!course) return;
    if (!confirm(`Undo every manual change to ${course.course_code}? It will show exactly what the Schedule of Classes says.`)) return;
    const r = await apiRevertCourse(st.key);
    if (!r.ok) {
      showToast((r.data && r.data.message) || 'Could not undo the edits.');
      return;
    }
    await this._reloadCatalog();
    showToast('Edits removed.');
    this._openCourseEditor(st.key, false);
  },

  /** Re-apply course edits after a save, so search, trees and this page all agree. */
  async _reloadCatalog() {
    try {
      await this._prepareCatalog();
      this._knownReqPaths = null;
    } catch (err) {
      console.error(err);
      showToast('Saved, but the catalog could not be refreshed. Reload the page.');
    }
  },

  // ── Overview ──────────────────────────────────────────────
  async _loadAdminOverview() {
    const r = await apiAdminOverview();
    if (!r.ok) return this._admError(r, 'the overview');
    const el = document.getElementById('admContent');
    if (!el || this._adminConsole.tab !== 'overview') return;
    const d = r.data;
    const u = d.users;
    const openFlags = (d.flags.pending || 0) + (d.flags.reviewed || 0);
    const scraped = d.course_data && d.course_data.last_scrape;
    const scrapedDays = scraped ? Math.floor((Date.now() - new Date(scraped).getTime()) / 86400000) : null;
    const staleData = scrapedDays !== null && scrapedDays > 3;

    const recent = (d.recent_signups || []).map(s => `
      <li class="adm-recent-row">
        <div>
          <div class="adm-recent-name">${esc(s.name)}</div>
          <div class="adm-recent-meta">${esc(s.email)} · ${esc(this._admRoleLabel(s.role))}${s.primary_program ? ' · ' + esc(getProgramLabel(s.primary_program) || s.primary_program) : ''}</div>
        </div>
        <span class="adm-recent-when" title="${esc(this._admDate(s.created_at))}">${esc(this._admWhen(s.created_at))}</span>
      </li>`).join('') || '<li class="adm-empty-line">No accounts yet.</li>';

    el.innerHTML = `
      <div class="adm-stat-grid">
        ${this._admStat(u.total, 'Accounts', `${u.by_group.student} student${u.by_group.student === 1 ? '' : 's'} · ${u.by_group.faculty} faculty · ${u.by_group.admin} admin${u.by_group.admin === 1 ? '' : 's'}`, "App._setAdminTab('users')")}
        ${this._admStat(u.new_7d, 'New this week', `${u.new_30d} in the last 30 days`, "App._openSignIns(7, 'new')")}
        ${this._admStat(u.active_7d, 'Signed in this week', (u.total ? `${Math.round(100 * u.active_7d / u.total)}% of accounts · ` : '') + 'See who', 'App._openSignIns(7)')}
        ${this._admStat(u.incomplete_profiles, 'Unfinished profiles', 'Signed up but never chose a program', 'App._openIncompleteUsers()')}
        ${this._admStat(openFlags, 'Open flags', `${d.flags.pending || 0} pending · ${d.flags.reviewed || 0} reviewed`, "App._setAdminTab('flags')")}
        ${this._admStat(d.wishlist.items, 'Saved courses', `by ${d.wishlist.students} student${d.wishlist.students === 1 ? '' : 's'}`)}
        ${this._admStat(d.plans, 'Schedule plans', '')}
        ${this._admStat(d.course_lookups, 'Course lookups', 'Courses opened by students', "App._setAdminTab('insights')")}
      </div>

      <div class="adm-card ${staleData ? 'adm-card-warn' : ''}">
        <div class="adm-card-title">Course data</div>
        <p class="adm-card-text">${scraped
          ? `Schedule of Classes last scraped <strong>${esc(this._admDate(scraped))}</strong> (${esc(this._admWhen(scraped))}).`
          : 'The date of the last Schedule of Classes scrape is not available.'}
          ${staleData ? ' The daily scrape normally keeps this within a day, so it may have stopped running.' : ''}</p>
      </div>

      <div class="adm-card">
        <div class="adm-card-title">Newest accounts</div>
        <ul class="adm-recent">${recent}</ul>
      </div>`;
  },

  _openIncompleteUsers() {
    this._userAdminState.roleGroup = '';
    this._userAdminState.incomplete = true;
    this._setAdminTab('users');
  },

  // ── Sign-in activity (drill-down from "Signed in this week") ──
  _signIns: { days: 7, q: '', group: '', show: '', sort: 'last_seen', dir: 'desc', data: null },

  SIGN_IN_METHOD_LABELS: {
    google: 'Google',
    password: 'Password',
    email_link: 'Email link',
    register: 'Created an account',
    before_tracking: 'Before tracking began',
  },

  async _openSignIns(days, show) {
    const st = this._signIns;
    st.days = days || st.days || 7;
    st.show = show || '';
    st.q = '';
    st.group = '';
    if (!document.getElementById('admContent')) await this.showAdminConsole('overview');
    this._adminConsole.tab = 'overview';
    document.querySelectorAll('.adm-console-tab').forEach(b => {
      const on = b.dataset.tab === 'overview';
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    await this._loadSignIns();
    const top = document.getElementById('admContent');
    if (top) top.scrollIntoView({ block: 'start' });
  },

  async _setSignInWindow(days) {
    this._signIns.days = days;
    await this._loadSignIns();
  },

  async _loadSignIns() {
    const el = document.getElementById('admContent');
    if (!el) return;
    el.innerHTML = '<div class="empty-state"><div class="spinner"></div></div>';
    const r = await apiAdminSignIns(this._signIns.days);
    if (!r.ok) return this._admError(r, 'sign-in activity');
    if (this._adminConsole.tab !== 'overview') return;
    this._signIns.data = r.data;
    this._renderSignIns();
  },

  _signInDayLabel(iso, long) {
    const d = new Date(iso + 'T12:00:00');
    return long
      ? d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
      : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  },

  _signInBars(items, label) {
    const total = items.reduce((n, i) => n + i.n, 0);
    const max = Math.max(1, ...items.map(i => i.n));
    if (!total) return `<p class="adm-empty-line">No ${esc(label)} in this period.</p>`;
    return `<ul class="adm-bars">${items.map(i => `
      <li class="adm-bar-row" title="${esc(i.label)}: ${i.n} (${Math.round(100 * i.n / total)}%)">
        <span class="adm-bar-label">${esc(i.label)}</span>
        <span class="adm-bar-track"><span class="adm-bar-fill" style="width:${Math.max(2, Math.round(100 * i.n / max))}%"></span></span>
        <span class="adm-bar-value">${i.n} <span class="adm-cell-sub">${Math.round(100 * i.n / total)}%</span></span>
      </li>`).join('')}</ul>`;
  },

  _renderSignIns() {
    const el = document.getElementById('admContent');
    const st = this._signIns;
    const d = st.data;
    if (!el || !d) return;
    const t = d.totals;
    const span = d.days === 7 ? 'this week' : `in the last ${d.days} days`;
    const pct = t.total_accounts ? Math.round(100 * t.active_users / t.total_accounts) : 0;
    const diff = t.active_users - d.previous.active_users;
    const diffText = d.previous.active_users || t.active_users
      ? (diff === 0 ? 'Same as the period before' : `${diff > 0 ? 'Up' : 'Down'} ${Math.abs(diff)} from the ${d.days} days before`)
      : '';

    // Daily bars: one series (people active that day).
    const maxDay = Math.max(1, ...d.daily.map(x => x.users));
    const labelEvery = d.days <= 7 ? 1 : d.days <= 30 ? 5 : 14;
    const dayBars = d.daily.map((x, i) => {
      const h = x.users ? Math.max(4, Math.round(100 * x.users / maxDay)) : 0;
      const showLabel = (d.daily.length - 1 - i) % labelEvery === 0;
      const tip = `${this._signInDayLabel(x.day, true)}: ${x.users} ${x.users === 1 ? 'person' : 'people'}, ${x.sign_ins} sign-in${x.sign_ins === 1 ? '' : 's'}, ${x.visits} app open${x.visits === 1 ? '' : 's'}`;
      return `
        <div class="adm-day" data-tip="${esc(tip)}" tabindex="0" aria-label="${esc(tip)}">
          ${d.days <= 7 ? `<span class="adm-day-value">${x.users || ''}</span>` : ''}
          <span class="adm-day-plot"><span class="adm-day-bar" style="height:${h}%"></span></span>
          <span class="adm-day-label">${showLabel ? esc(d.days <= 7 ? new Date(x.day + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' }) : this._signInDayLabel(x.day)) : ''}</span>
        </div>`;
    }).join('');

    const groupItems = [['student', 'Students'], ['faculty', 'Faculty'], ['admin', 'Admins']]
      .map(([k, label]) => ({ label, n: d.by_group[k] || 0 }));
    const programItems = Object.entries(d.by_program)
      .map(([k, n]) => ({ label: k === 'none' ? 'No program chosen' : (getProgramLabel(k) || k), n }))
      .sort((a, b) => b.n - a.n);
    const methodItems = Object.entries(d.by_method)
      .map(([k, n]) => ({ label: this.SIGN_IN_METHOD_LABELS[k] || k, n }))
      .sort((a, b) => b.n - a.n);
    const maxHour = Math.max(1, ...d.by_hour);
    const hourTotal = d.by_hour.reduce((a, b) => a + b, 0);
    const busiest = hourTotal ? d.by_hour.indexOf(Math.max(...d.by_hour)) : -1;
    const hourName = h => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`;
    const hours = d.by_hour.map((n, h) => `
      <div class="adm-hour" data-tip="${esc(`${hourName(h)} to ${hourName((h + 1) % 24)}: ${n} sign-in${n === 1 ? '' : 's'}`)}" tabindex="0">
        <span class="adm-hour-bar" style="height:${n ? Math.max(6, Math.round(100 * n / maxHour)) : 0}%"></span>
      </div>`).join('');

    const chip = (val, label, n, field) => `<button type="button" class="adm-chip ${st[field] === val ? 'is-active' : ''}" onclick="App._setSignInFilter('${field}', '${val}')">${label}${n != null ? ` <span class="adm-chip-n">${n}</span>` : ''}</button>`;

    el.innerHTML = `
      <div class="adm-signins">
        <button type="button" class="dc-back-link" onclick="App._setAdminTab('overview')">Back to overview</button>
        <div class="adm-card-row adm-signins-head">
          <div>
            <div class="adm-title">Sign-in activity</div>
            <p class="adm-card-text">Everyone who used CountsFor ${esc(span)}: they signed in, or opened CountsFor while still signed in from before. Days follow Qatar time.</p>
          </div>
          <div class="adm-seg" role="group" aria-label="Time period">
            ${d.windows.map(w => `<button type="button" class="adm-seg-btn ${w === d.days ? 'is-active' : ''}" aria-pressed="${w === d.days}" onclick="App._setSignInWindow(${w})">${w} days</button>`).join('')}
          </div>
        </div>

        <div class="adm-stat-grid">
          ${this._admStat(t.active_users, 'Active people', `${pct}% of ${t.total_accounts} account${t.total_accounts === 1 ? '' : 's'}${diffText ? ' · ' + diffText : ''}`)}
          ${this._admStat(t.sign_ins, 'Sign-ins', 'Times someone logged in')}
          ${this._admStat(t.visits, 'App opens', 'Visits while already signed in')}
          ${this._admStat(t.returning, 'Returning', `Also active in the ${d.days} days before`, "App._setSignInFilter('show', 'returning')")}
          ${this._admStat(t.new_accounts, 'New accounts', `Joined ${span}`, "App._setSignInFilter('show', 'new')")}
          ${this._admStat(t.avg_days_active, 'Days active', 'Average per active person')}
        </div>

        <div class="adm-card">
          <div class="adm-card-title">People active each day</div>
          <p class="adm-card-text">Hover or tap a bar for sign-ins and app opens on that day.</p>
          <div class="adm-days ${d.days > 30 ? 'is-dense' : ''}" style="grid-template-columns: repeat(${d.daily.length}, minmax(0, 1fr))">${dayBars}</div>
        </div>

        <div class="adm-insight-grid adm-signins-grid">
          <div class="adm-card"><div class="adm-card-title">By role</div>${this._signInBars(groupItems, 'activity')}</div>
          <div class="adm-card"><div class="adm-card-title">By program</div>${this._signInBars(programItems, 'activity')}</div>
          <div class="adm-card"><div class="adm-card-title">How they signed in</div>${this._signInBars(methodItems, 'sign-ins')}</div>
          <div class="adm-card">
            <div class="adm-card-title">Busiest hours</div>
            <p class="adm-card-text">${busiest >= 0 ? `Most sign-ins happen between ${hourName(busiest)} and ${hourName((busiest + 1) % 24)} (Qatar time).` : 'No sign-ins recorded in this period yet.'}</p>
            <div class="adm-hours">${hours}</div>
            <div class="adm-hours-axis"><span>12 am</span><span>6 am</span><span>12 pm</span><span>6 pm</span><span>11 pm</span></div>
          </div>
        </div>

        <div class="adm-card adm-signins-people">
          <div class="adm-card-row">
            <div>
              <div class="adm-card-title">Who was active</div>
              <p class="adm-card-text" id="admSignInCount"></p>
            </div>
            <button type="button" class="adm-btn" onclick="App._exportSignInsCsv()">Download CSV</button>
          </div>
          <div class="adm-search-row">
            <input type="search" class="adm-search" placeholder="Search by name or email" value="${esc(st.q)}" oninput="App._onSignInSearch(this.value)" autocomplete="off" />
          </div>
          <div class="adm-toolbar">
            ${chip('', 'Everyone', null, 'group')}
            ${chip('student', 'Students', d.by_group.student || 0, 'group')}
            ${chip('faculty', 'Faculty', d.by_group.faculty || 0, 'group')}
            ${chip('admin', 'Admins', d.by_group.admin || 0, 'group')}
            <span class="adm-toolbar-sep"></span>
            ${chip('', 'All', null, 'show')}
            ${chip('new', 'New accounts', t.new_accounts, 'show')}
            ${chip('returning', 'Returning', t.returning, 'show')}
          </div>
          <div id="admSignInTable"></div>
        </div>
        <p class="adm-cell-sub adm-signins-foot">${d.tracking_since
          ? `Detailed tracking started ${esc(this._admDate(d.tracking_since))}. Earlier activity only shows each person's most recent sign-in.`
          : 'Detailed tracking starts with the next sign-in. Until then, only each person’s most recent sign-in is known.'}</p>
      </div>`;
    this._renderSignInTable();
  },

  _setSignInFilter(field, value) {
    this._signIns[field] = value;
    this._renderSignIns();
    if (field === 'show' && value) {
      const box = document.querySelector('.adm-signins-people');
      if (box) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  },

  _onSignInSearch(value) {
    this._signIns.q = value;
    this._renderSignInTable();
  },

  _sortSignIns(key) {
    const st = this._signIns;
    if (st.sort === key) st.dir = st.dir === 'asc' ? 'desc' : 'asc';
    else { st.sort = key; st.dir = key === 'name' ? 'asc' : 'desc'; }
    this._renderSignInTable();
  },

  _filteredSignIns() {
    const st = this._signIns;
    const q = st.q.trim().toLowerCase();
    const rows = (st.data ? st.data.users : []).filter(p =>
      (!st.group || p.role_group === st.group)
      && (!st.show || (st.show === 'new' ? p.is_new : p.returning))
      && (!q || (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q)));
    const k = st.sort;
    const sign = st.dir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      const va = k === 'name' ? (a.name || '').toLowerCase() : a[k];
      const vb = k === 'name' ? (b.name || '').toLowerCase() : b[k];
      if (va === vb) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va > vb ? sign : -sign;
    });
  },

  _renderSignInTable() {
    const box = document.getElementById('admSignInTable');
    const st = this._signIns;
    if (!box || !st.data) return;
    const rows = this._filteredSignIns();
    const all = st.data.users.length;
    const count = document.getElementById('admSignInCount');
    if (count) count.textContent = rows.length === all
      ? `${all} ${all === 1 ? 'person' : 'people'}, most recent first.`
      : `Showing ${rows.length} of ${all} people.`;
    if (!rows.length) {
      box.innerHTML = `<p class="adm-empty-line">${all ? 'Nobody matches these filters.' : 'Nobody has used CountsFor in this period yet.'}</p>`;
      return;
    }
    const th = (key, label, num) => {
      const on = st.sort === key;
      return `<th class="${num ? 'adm-num' : ''}" aria-sort="${on ? (st.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">
        <button type="button" class="adm-th-btn" onclick="App._sortSignIns('${key}')">${label}${on ? `<span aria-hidden="true">${st.dir === 'asc' ? ' ▲' : ' ▼'}</span>` : ''}</button></th>`;
    };
    box.innerHTML = `
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr>
            ${th('name', 'Person')}${th('role', 'Role')}${th('primary_program', 'Program')}
            ${th('days_active', 'Days active', true)}${th('sign_ins', 'Sign-ins', true)}${th('visits', 'App opens', true)}${th('last_seen', 'Last seen')}
          </tr></thead>
          <tbody>${rows.map(p => `
            <tr>
              <td>
                <div class="adm-cell-strong">${esc(p.name || p.email)}
                  ${p.is_new ? '<span class="adm-pill adm-pill-new">New</span>' : ''}
                  ${p.returning ? '<span class="adm-pill adm-pill-edit">Returning</span>' : ''}</div>
                <div class="adm-cell-sub">${esc(p.email)}</div>
              </td>
              <td>${esc(this._admRoleLabel(p.role))}</td>
              <td>${esc(p.primary_program ? (getProgramLabel(p.primary_program) || p.primary_program) : 'Not chosen')}</td>
              <td class="adm-num">${p.days_active}</td>
              <td class="adm-num">${p.sign_ins}</td>
              <td class="adm-num">${p.visits}</td>
              <td title="${esc(this._admDate(p.last_seen))}">${esc(this._admWhen(p.last_seen))}
                ${p.last_method ? `<div class="adm-cell-sub">${esc(this.SIGN_IN_METHOD_LABELS[p.last_method] || p.last_method)}</div>` : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  },

  _exportSignInsCsv() {
    const d = this._signIns.data;
    if (!d) return;
    const rows = this._filteredSignIns().map(p => [
      p.name, p.email, this._admRoleLabel(p.role), p.primary_program || '', p.days_active, p.sign_ins, p.visits,
      p.last_seen || '', this.SIGN_IN_METHOD_LABELS[p.last_method] || p.last_method || '', p.is_new ? 'yes' : 'no', p.returning ? 'yes' : 'no',
    ]);
    downloadExcelSheet(`countsfor-sign-ins-${d.start}-to-${d.end}.csv`, 'Sign-ins',
      ['Name', 'Email', 'Role', 'Program', 'Days active', 'Sign-ins', 'App opens', 'Last seen (UTC)', 'Last sign-in method', 'New account', 'Returning'],
      rows, [['CountsFor sign-in activity'], ['Period', `${d.start} to ${d.end} (Qatar time)`]]);
  },

  // ── Faculty access (directory) ────────────────────────────
  async _loadAdminAccess() {
    const r = await apiListStaffDirectory();
    if (!r.ok) return this._admError(r, 'the directory');
    const el = document.getElementById('admContent');
    if (!el || this._adminConsole.tab !== 'access') return;
    const items = [...(r.data.items || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    const counts = {};
    items.forEach(i => { counts[i.role] = (counts[i.role] || 0) + 1; });
    const sourceLabel = { db: 'Added here', json: 'Seed list', 'db+json': 'Seed list, edited here' };
    const rows = items.map(i => `
      <tr>
        <td><div class="adm-cell-strong">${esc(i.name)}</div><div class="adm-cell-sub">${esc(i.email)}</div></td>
        <td>${esc(this._admRoleLabel(i.role))}</td>
        <td>${esc(i.department || '')}</td>
        <td class="adm-cell-sub">${esc(sourceLabel[i.source] || i.source || '')}</td>
      </tr>`).join('');
    el.innerHTML = `
      <div class="adm-card">
        <div class="adm-card-row">
          <div>
            <div class="adm-card-title">People with faculty or admin access</div>
            <p class="adm-card-text">${items.length} people · ${Object.entries(counts).map(([role, n]) => `${n} ${esc(this._admRoleLabel(role))}`).join(' · ')}. Anyone listed gets the faculty view when they sign in. Changes apply on their next sign-in.</p>
          </div>
          <button type="button" class="adm-btn adm-btn-resolve" onclick="App._openDirectoryFromAdmin()">Add or edit people</button>
        </div>
      </div>
      ${items.length ? `
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col">Department</th><th scope="col">Source</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : '<div class="empty-state"><div class="empty-text">Nobody has faculty access yet.</div></div>'}`;
  },

  _openDirectoryFromAdmin() {
    if (!this._directoryPanelOpen) this.toggleDirectoryPanel();
  },

  // ── Insights ──────────────────────────────────────────────
  async _loadAdminInsights() {
    const r = await apiAdminInsights(this._adminConsole.semester);
    if (!r.ok) return this._admError(r, 'insights');
    const el = document.getElementById('admContent');
    if (!el || this._adminConsole.tab !== 'insights') return;
    const d = r.data;
    const semLabel = code => {
      const opt = (availableSemesterOptions(this.courses || [], code) || []).find(s => s.code === code);
      return opt ? opt.label : code;
    };
    const semOpts = ['<option value="">All semesters</option>']
      .concat((d.semesters || []).map(s => `<option value="${esc(s)}" ${this._adminConsole.semester === s ? 'selected' : ''}>${esc(semLabel(s))}</option>`))
      .join('');

    const bars = (rows, labelFn, valueKey = 'count', empty = 'No data yet.') => {
      if (!rows || !rows.length) return `<p class="adm-empty-line">${empty}</p>`;
      const max = Math.max(...rows.map(x => x[valueKey])) || 1;
      return `<ol class="adm-bars">${rows.map(x => `
        <li class="adm-bar-row">
          <div class="adm-bar-label">${labelFn(x)}</div>
          <div class="adm-bar-track"><div class="adm-bar-fill" style="width:${Math.max(2, Math.round(100 * x[valueKey] / max))}%"></div></div>
          <div class="adm-bar-value">${x[valueKey]}</div>
        </li>`).join('')}</ol>`;
    };
    const courseLabel = x => {
      const name = this._admCourseLabel(x.course_code) || x.course_name || '';
      return `<span class="adm-bar-code">${esc(x.course_code)}</span>${name ? ` <span class="adm-bar-name">${esc(name)}</span>` : ''}`;
    };

    const byProgram = Object.entries(d.lookups_by_program || {})
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([prog, rows]) => `
        <div class="adm-mini">
          <div class="adm-mini-title">${esc(getProgramLabel(prog) || prog)}</div>
          <ol class="adm-mini-list">${rows.map(x => `<li><span class="adm-bar-code">${esc(x.course_code)}</span> <span class="adm-cell-sub">${x.count}</span></li>`).join('')}</ol>
        </div>`).join('') || '<p class="adm-empty-line">No lookups yet.</p>';

    const programs = Object.entries(d.students_by_program || {})
      .map(([p, n]) => ({ label: p === 'none' ? 'Not chosen yet' : (getProgramLabel(p) || p), count: n }))
      .sort((a, b) => b.count - a.count);

    const start = new Date(d.signups_by_week.start + 'T00:00:00');
    const weeks = (d.signups_by_week.counts || []).map((n, i) => {
      const wk = new Date(start.getTime() + i * 7 * 86400000);
      return { label: wk.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), count: n };
    });
    const weekMax = Math.max(1, ...weeks.map(w => w.count));

    el.innerHTML = `
      <div class="adm-toolbar">
        <label class="adm-toolbar-label" for="admInsightSem">Course lookups for</label>
        <select id="admInsightSem" class="adm-select" onchange="App._adminConsole.semester=this.value;App._loadAdminInsights();">${semOpts}</select>
      </div>
      <div class="adm-insight-grid">
        <section class="adm-card">
          <div class="adm-card-title">Most looked-up courses</div>
          <p class="adm-card-text">How often students opened each course.</p>
          ${bars(d.top_lookups, courseLabel, 'count', 'No lookups yet.')}
        </section>
        <section class="adm-card">
          <div class="adm-card-title">Most saved courses</div>
          <p class="adm-card-text">Courses students added to their saved list.</p>
          ${bars(d.most_saved, courseLabel, 'count', 'Nothing saved yet.')}
        </section>
        <section class="adm-card">
          <div class="adm-card-title">Top lookups by program</div>
          <div class="adm-mini-grid">${byProgram}</div>
        </section>
        <section class="adm-card">
          <div class="adm-card-title">Most flagged courses</div>
          ${d.most_flagged && d.most_flagged.length ? `<ol class="adm-bars">${d.most_flagged.map(x => `
            <li class="adm-bar-row adm-bar-row-plain">
              <div class="adm-bar-label">${courseLabel(x)}</div>
              <div class="adm-bar-value">${x.total} flag${x.total === 1 ? '' : 's'}${x.open ? ` · <span class="adm-open">${x.open} open</span>` : ''}</div>
            </li>`).join('')}</ol>` : '<p class="adm-empty-line">No flags yet.</p>'}
        </section>
        <section class="adm-card">
          <div class="adm-card-title">Students by program</div>
          ${bars(programs, x => esc(x.label), 'count', 'No students yet.')}
        </section>
        <section class="adm-card">
          <div class="adm-card-title">New accounts per week</div>
          <p class="adm-card-text">Last 12 weeks. Each bar is the week starting on that date.</p>
          <div class="adm-weeks" role="img" aria-label="New accounts per week: ${weeks.map(w => `${w.label} ${w.count}`).join(', ')}">
            ${weeks.map(w => `
              <div class="adm-week" title="Week of ${esc(w.label)}: ${w.count}">
                <div class="adm-week-value">${w.count || ''}</div>
                <div class="adm-week-bar" style="height:${Math.round(100 * w.count / weekMax)}%"></div>
                <div class="adm-week-label">${esc(w.label)}</div>
              </div>`).join('')}
          </div>
        </section>
      </div>`;
  },

  // ── Activity log ──────────────────────────────────────────
  async _loadAdminActivity(reset) {
    const s = this._adminConsole;
    if (reset) {
      s.activityPage = 1;
      s.activityItems = [];
    }
    const q = `limit=50&page=${s.activityPage}` + (s.activityAction ? '&action=' + encodeURIComponent(s.activityAction) : '');
    const r = await apiAdminActivity(q);
    if (!r.ok) return this._admError(r, 'the activity log');
    if (this._adminConsole.tab !== 'activity') return;
    s.activityItems = s.activityItems.concat(r.data.items || []);
    s.activityTotal = r.data.total || 0;
    this._renderAdminActivity();
  },

  _renderAdminActivity() {
    const el = document.getElementById('admContent');
    if (!el) return;
    const s = this._adminConsole;
    const filters = [['', 'Everything'], ['course.', 'Courses'], ['user.', 'User changes'], ['flag.', 'Flag reviews'], ['directory.', 'Faculty access']];
    const rows = s.activityItems.map(e => `
      <li class="adm-log-row">
        <div class="adm-log-text"><strong>${esc(e.actor_name || e.actor_email)}</strong> ${this._describeAdminEvent(e)}</div>
        <div class="adm-log-meta" title="${esc(this._admDate(e.created_at))}">${esc(this._admWhen(e.created_at))}</div>
      </li>`).join('');
    el.innerHTML = `
      <div class="adm-toolbar">
        ${filters.map(([id, label]) => `<button type="button" class="adm-chip ${s.activityAction === id ? 'is-active' : ''}" onclick="App._adminConsole.activityAction='${id}';App._loadAdminActivity(true);">${label}</button>`).join('')}
        <span class="adm-toolbar-count">${s.activityTotal} event${s.activityTotal === 1 ? '' : 's'}</span>
      </div>
      ${rows ? `<ul class="adm-log">${rows}</ul>` : '<div class="empty-state"><div class="empty-text">Nothing recorded yet. Course edits, role changes, flag reviews and directory edits will show up here.</div></div>'}
      ${s.activityItems.length < s.activityTotal ? `<div class="adm-more"><button type="button" class="adm-btn" onclick="App._adminConsole.activityPage++;App._loadAdminActivity(false);">Show older</button></div>` : ''}`;
  },

  _describeAdminEvent(e) {
    const d = e.details || {};
    const who = `<strong>${esc(e.target || '')}</strong>`;
    const fieldLabels = { primary_program: 'program', minor_codes: 'minors', department: 'department', advisor_scope: 'advisor scope', name: 'name' };
    switch (e.action) {
      case 'user.update': {
        const changes = d.changes || {};
        const parts = [];
        if (changes.role) {
          parts.push(`changed the role of ${who} from ${esc(this._admRoleLabel(changes.role.from))} to ${esc(this._admRoleLabel(changes.role.to))}`);
        }
        const others = esc(Object.keys(changes).filter(k => k !== 'role').map(k => fieldLabels[k] || k).join(', '));
        if (others) parts.push(parts.length ? `and updated their ${others}` : `updated the ${others} of ${who}`);
        return parts.join(' ') || `edited ${who}`;
      }
      case 'flag.status':
        return `marked the flag on ${who} as <strong>${esc(d.to)}</strong> (was ${esc(d.from)})`;
      case 'flag.note':
        return d.note ? `added a note on the ${who} flag: <em>${esc(d.note)}</em>` : `cleared the note on the ${who} flag`;
      case 'directory.add':
        return `gave ${who} access as ${esc(this._admRoleLabel(d.role))}`;
      case 'directory.update':
        return `updated ${who} in the directory (${esc(this._admRoleLabel(d.role))})`;
      case 'directory.remove':
        return `removed ${who} from the directory`;
      case 'directory.revoke':
        return `revoked the elevated access of ${who}`;
      case 'course.add':
        return `added the course ${who}${d.name ? ' ' + esc(d.name) : ''}`;
      case 'course.update': {
        const labels = { course_code: 'number', course_name: 'name', department: 'department', units: 'units', description: 'description', prerequisites: 'prerequisites', offered_qatar: 'Qatar offering', offered_pitts: 'Pittsburgh offering', offered: 'semesters' };
        const list = (d.fields || []).map(f => labels[f] || f).join(', ');
        return `edited ${who}${list ? ': ' + esc(list) : ''}${d.renumbered_from ? ' (was ' + esc(d.renumbered_from) + ')' : ''}`;
      }
      case 'course.archive':
        return `archived ${who}`;
      case 'course.restore':
        return `restored ${who}`;
      case 'course.revert':
        return `undid all edits to ${who}`;
      default:
        return `${esc(e.action)} ${who}`;
    }
  },

  // ══════════════════════════════════════════════════════════
  // ADMIN — User role management
  // ══════════════════════════════════════════════════════════
  _userAdminState: { items: [], search: '', roleGroup: '', incomplete: false, total: 0 },

  _userAdminQuery(limit) {
    const st = this._userAdminState;
    const parts = ['limit=' + limit];
    if (st.search) parts.push('search=' + encodeURIComponent(st.search));
    if (st.roleGroup) parts.push('role_group=' + encodeURIComponent(st.roleGroup));
    if (st.incomplete) parts.push('incomplete=1');
    return parts.join('&');
  },

  async _loadUserAdmin() {
    const r = await apiListUsers(this._userAdminQuery(300));
    if (!r.ok) return this._admError(r, 'users');
    this._userAdminState.items = r.data.items || [];
    this._userAdminState.total = r.data.total != null ? r.data.total : this._userAdminState.items.length;
    this._renderUserAdmin();
  },

  _setUserAdminFilter(roleGroup, incomplete) {
    this._userAdminState.roleGroup = roleGroup;
    this._userAdminState.incomplete = !!incomplete;
    this._loadUserAdmin();
  },

  async _exportUsersCsv() {
    const r = await apiListUsers(this._userAdminQuery(1000));
    if (!r.ok) {
      showToast((r.data && r.data.message) || 'Could not export users.');
      return;
    }
    const cols = ['name', 'email', 'role', 'primary_program', 'minor_codes', 'department', 'profile_completed', 'created_at', 'last_login'];
    const cell = v => {
      const text = Array.isArray(v) ? v.join('; ') : (v == null ? '' : String(v));
      return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    const csv = [cols.join(',')].concat((r.data.items || []).map(u => cols.map(c => cell(u[c])).join(','))).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'countsfor-users-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  _renderUserAdmin() {
    const el = this._admEl();
    if (!el) return;
    const st = this._userAdminState;
    const items = st.items;
    const rows = items.length === 0
      ? '<div class="empty-state"><div class="empty-text">No users match.</div></div>'
      : items.map(u => this._renderUserAdminRow(u)).join('');
    const chip = (group, incomplete, label) => {
      const on = st.roleGroup === group && st.incomplete === incomplete;
      return `<button type="button" class="adm-chip ${on ? 'is-active' : ''}" onclick="App._setUserAdminFilter('${group}', ${incomplete})">${label}</button>`;
    };
    const countText = items.length < st.total ? `Showing ${items.length} of ${st.total}` : `${st.total} ${st.total === 1 ? 'person' : 'people'}`;

    const body = `
        <div class="adm-search-row">
          <input type="search" class="adm-search" id="userAdminSearch" placeholder="Search by email, name or role" value="${esc(st.search)}"
            onkeydown="if(event.key==='Enter'){App._userAdminState.search=this.value;App._loadUserAdmin();}" />
          <button class="adm-btn" onclick="App._userAdminState.search=document.getElementById('userAdminSearch').value;App._loadUserAdmin();">Search</button>
          <button class="adm-btn" onclick="App._exportUsersCsv()" title="Download the people matching these filters as a spreadsheet">Export CSV</button>
        </div>
        <div class="adm-toolbar">
          ${chip('', false, 'Everyone')}
          ${chip('student', false, 'Students')}
          ${chip('faculty', false, 'Faculty')}
          ${chip('admin', false, 'Admins')}
          ${chip('', true, 'Unfinished profiles')}
          <span class="adm-toolbar-count">${countText}</span>
        </div>
        <div class="adm-list">${rows}</div>`;

    el.innerHTML = this._admEmbedded() ? body : `
      <div class="adm-view">
        <div class="adm-header">
          <button class="dc-back-link" onclick="App.renderLeftEmpty()">Back to home</button>
          <div class="adm-title">User roles <span class="adm-count">· ${st.total}</span></div>
        </div>
        ${body}
      </div>`;
  },

  _renderUserAdminRow(u) {
    const rg = getRoleGroup(u);
    const isStudent = rg === 'student';
    const progLabel = getProgramLabel(u.primary_program) || u.primary_program || 'Not listed';
    const minors = Array.isArray(u.minor_codes) ? u.minor_codes : (u.minor_code ? [u.minor_code] : []);
    const minorSummary = minors.length ? minors.map(mc => getMinorLabel(mc)).join(', ') : '';
    const summary = isStudent
      ? `${esc(u.name)} · student · ${esc(u.primary_program || 'Not listed')}${minorSummary ? ' · minors ' + esc(minorSummary) : ''}`
      : `${esc(u.name)} · ${esc(u.role)} · ${esc(progLabel)}`;
    const roleOpts = ['student', 'professor', 'area_head', 'associate_area_head', 'advisor', 'admin']
      .map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${esc((ROLE_META[r] && ROLE_META[r].label) || r)}</option>`)
      .join('');
    const majorOpts = MAJOR_LIST.map(m => `<option value="${m}" ${u.primary_program === m ? 'selected' : ''}>${m}</option>`).join('');
    const programOpts = VALID_PROGRAMS.map(p => `<option value="${p}" ${u.primary_program === p ? 'selected' : ''}>${esc(getProgramLabel(p))}</option>`).join('');
    const deptOpts = DEPARTMENT_LIST.map(d => `<option value="${esc(d)}" ${u.department === d ? 'selected' : ''}>${esc(d)}</option>`).join('');
    const minorChips = minors.map(mc => `
      <span class="adm-minor-chip" data-code="${esc(mc)}">${esc(getMinorLabel(mc))}
        <button type="button" class="adm-minor-chip-x" onclick="App._adminRemoveMinor(${u.id}, '${esc(mc)}')">×</button>
      </span>`).join('');
    const minorAddOpts = MINOR_LIST.filter(m => !minors.includes(m.code))
      .map(m => `<option value="${m.code}">${esc(m.label)}</option>`).join('');
    const studentFields = `
          <label>Major<select class="adm-select" id="major-${u.id}"><option value="">None</option>${majorOpts}</select></label>
          <label>Minor(s)<div class="adm-minor-chips" id="minors-${u.id}">${minorChips || '<span class="adm-minor-empty">None</span>'}</div>
            <select class="adm-select adm-minor-add" id="minor-add-${u.id}" onchange="App._adminAddMinor(${u.id}, this.value); this.value='';">
              <option value="">Add minor…</option>${minorAddOpts}
            </select></label>`;
    const facultyFields = `
          <label>Department<select class="adm-select" id="dept-${u.id}"><option value="">None</option>${deptOpts}</select></label>
          <label>Program<select class="adm-select" id="program-${u.id}"><option value="">None</option>${programOpts}</select></label>`;
    return `
      <div class="adm-row adm-user-row" data-user-id="${u.id}">
        <div class="adm-row-head">
          <div>
            <div class="adm-course-code">${esc(u.email)}</div>
            <div class="adm-course-name">${summary}</div>
          </div>
          <div class="adm-user-dates">
            ${u.profile_completed ? '' : '<span class="adm-pill">Unfinished profile</span>'}
            <span title="${esc(this._admDate(u.created_at))}">Joined ${esc(this._admWhen(u.created_at) || 'unknown')}</span>
            <span title="${esc(this._admDate(u.last_login))}">Last sign-in ${esc(this._admWhen(u.last_login) || 'never')}</span>
          </div>
        </div>
        <div class="adm-user-fields">
          <label>Role<select class="adm-select" id="role-${u.id}" onchange="App._onUserAdminRoleChange(${u.id}, this.value)">${roleOpts}</select></label>
          <div id="student-fields-${u.id}" ${isStudent ? '' : 'hidden'}>${studentFields}</div>
          <div id="faculty-fields-${u.id}" ${isStudent ? 'hidden' : ''}>${facultyFields}</div>
        </div>
        <div class="adm-actions">
          <button class="adm-btn adm-btn-resolve" onclick="App._saveUserAdmin(${u.id})">Save</button>
        </div>
      </div>`;
  },

  _onUserAdminRoleChange(userId, role) {
    const student = getRoleGroup(role) === 'student';
    const s = document.getElementById('student-fields-' + userId);
    const f = document.getElementById('faculty-fields-' + userId);
    if (s) s.hidden = !student;
    if (f) f.hidden = student;
  },

  _adminMinorCodes(userId) {
    const chipRoot = document.getElementById('minors-' + userId);
    if (!chipRoot) return [];
    return [...chipRoot.querySelectorAll('.adm-minor-chip')].map(el => el.getAttribute('data-code')).filter(Boolean);
  },

  _adminAddMinor(userId, code) {
    if (!code) return;
    const codes = this._adminMinorCodes(userId);
    if (codes.includes(code)) return;
    codes.push(code);
    this._renderAdminMinorChips(userId, codes);
  },

  _adminRemoveMinor(userId, code) {
    const codes = this._adminMinorCodes(userId).filter(c => c !== code);
    this._renderAdminMinorChips(userId, codes);
  },

  _renderAdminMinorChips(userId, codes) {
    const chipRoot = document.getElementById('minors-' + userId);
    if (!chipRoot) return;
    chipRoot.innerHTML = codes.length
      ? codes.map(mc => `<span class="adm-minor-chip" data-code="${esc(mc)}">${esc(getMinorLabel(mc))}
        <button type="button" class="adm-minor-chip-x" onclick="App._adminRemoveMinor(${userId}, '${esc(mc)}')">×</button></span>`).join('')
      : '<span class="adm-minor-empty">None</span>';
    const addEl = document.getElementById('minor-add-' + userId);
    if (addEl) {
      addEl.innerHTML = '<option value="">Add minor…</option>' + MINOR_LIST.filter(m => !codes.includes(m.code))
        .map(m => `<option value="${m.code}">${esc(m.label)}</option>`).join('');
    }
  },

  async _saveUserAdmin(userId) {
    const roleEl = document.getElementById('role-' + userId);
    const role = roleEl ? roleEl.value : 'student';
    const patch = { role };
    if (getRoleGroup(role) === 'student') {
      const majorEl = document.getElementById('major-' + userId);
      patch.primary_program = majorEl ? majorEl.value : undefined;
      patch.minor_codes = this._adminMinorCodes(userId);
      patch.department = null;
    } else {
      const deptEl = document.getElementById('dept-' + userId);
      const progEl = document.getElementById('program-' + userId);
      patch.department = deptEl ? deptEl.value : undefined;
      patch.primary_program = progEl ? progEl.value : undefined;
      patch.minor_codes = [];
    }
    const r = await apiPatchUser(userId, patch);
    if (!r.ok) {
      showToast((r.data && r.data.message) || 'Could not save user.');
      return;
    }
    showToast('User updated.');
    await this._loadUserAdmin();
  },

  // ══════════════════════════════════════════════════════════
  // ADMIN — Flag review
  // ══════════════════════════════════════════════════════════
  _adminState: { status: 'pending', items: [], total: 0 },

  async showFlagReview() {
    if (!canFlagCourses(this.profile)) {
      showToast('Faculty access required.');
      return;
    }
    if (canManageUsers(this.authedUser)) {
      await this.showAdminConsole('flags');
      return;
    }
    this._homeView = 'admin';
    const el = document.getElementById('leftBody');
    if (!el) return;
    el.innerHTML = '<div class="empty-state"><div class="spinner"></div><div class="empty-text" style="margin-top:12px">Loading flag review…</div></div>';
    await this._loadFlagReview();
  },

  async _loadFlagReview() {
    const s = this._adminState;
    const r = await apiListFlags('status=' + encodeURIComponent(s.status) + '&limit=100');
    if (!r.ok) return this._admError(r, 'flags');
    s.items = r.data.items || [];
    s.total = r.data.total || 0;
    this._renderFlagReview();
  },

  _renderFlagReview() {
    const el = this._admEl();
    if (!el) return;
    const s = this._adminState;

    const tab = (status, label) => `
      <button class="adm-tab ${s.status === status ? 'active' : ''}" onclick="App._switchFlagStatus('${status}')">${label}</button>
    `;

    const rowsHtml = s.items.length === 0
      ? `<div class="empty-state"><div class="empty-text">No flags with status “${esc(s.status)}”.</div></div>`
      : s.items.map(f => this._renderFlagRow(f)).join('');

    const body = `
        <div class="adm-tabs">
          ${tab('pending',   'Pending')}
          ${tab('reviewed',  'Reviewed')}
          ${tab('resolved',  'Resolved')}
          ${tab('dismissed', 'Dismissed')}
        </div>
        <div class="adm-list">${rowsHtml}</div>`;

    el.innerHTML = this._admEmbedded() ? body : `
      <div class="adm-view">
        <div class="adm-header">
          <button class="dc-back-link" onclick="App.renderLeftEmpty()">Back to home</button>
          <div class="adm-title">Flag review <span class="adm-count">· ${s.total}</span></div>
        </div>
        ${body}
      </div>
    `;
  },

  _renderFlagRow(f, opts = {}) {
    const readOnly = !!opts.readOnly;
    const when = f.created_at ? new Date(f.created_at).toLocaleDateString() : '';
    const submitter = `${esc(f.submitted_by_name || f.submitted_by_email || 'Unknown')} <span class="adm-role">· ${esc(f.submitted_by_role || '')}${f.submitted_program ? ' · ' + esc(f.submitted_program) : ''}</span>`;
    const notes = f.notes ? `<div class="adm-notes"><strong>Notes:</strong> ${esc(f.notes)}</div>` : '';
    const adminNotes = f.admin_notes ? `<div class="adm-notes adm-notes-admin"><strong>Admin:</strong> ${esc(f.admin_notes)}</div>` : '';
    // Read-only rows (faculty "My flags") show status + admin feedback but no
    // review controls — only admins can change a flag's state.
    const actions = readOnly ? '' : ((f.status === 'pending' || f.status === 'reviewed') ? `
      <div class="adm-actions">
        <button class="adm-btn adm-btn-resolve"  onclick="App._setFlagStatus('${esc(f.id)}','resolved')">Resolve</button>
        <button class="adm-btn adm-btn-review"   onclick="App._setFlagStatus('${esc(f.id)}','reviewed')">Mark reviewed</button>
        <button class="adm-btn adm-btn-dismiss"  onclick="App._setFlagStatus('${esc(f.id)}','dismissed')">Dismiss</button>
        <button class="adm-btn adm-btn-note"     onclick="App._promptFlagNote('${esc(f.id)}')">Add note…</button>
      </div>` : `
      <div class="adm-actions">
        <button class="adm-btn" onclick="App._setFlagStatus('${esc(f.id)}','pending')">Reopen as pending</button>
        <button class="adm-btn adm-btn-note" onclick="App._promptFlagNote('${esc(f.id)}')">Add note…</button>
      </div>`);
    return `
      <div class="adm-row">
        <div class="adm-row-head">
          <div class="adm-course">
            <span class="adm-course-code">${esc(f.course_code)}</span>
            <span class="adm-course-name">${esc(f.course_name)}</span>
          </div>
          <span class="adm-status adm-status-${esc(f.status)}">${esc(f.status)}</span>
        </div>
        <div class="adm-reason">${esc(f.reason_label || f.reason_code)}</div>
        ${notes}
        ${adminNotes}
        <div class="adm-meta">By ${submitter} · ${esc(when)}</div>
        ${actions}
      </div>`;
  },

  async _switchFlagStatus(status) {
    this._adminState.status = status;
    await this._loadFlagReview();
  },

  async _setFlagStatus(id, status) {
    const r = await apiUpdateFlag(id, { status });
    if (!r.ok) {
      showToast((r.data && r.data.message) || 'Update failed.');
      return;
    }
    showToast('Flag marked ' + status);
    await this._loadFlagReview();
  },

  async _promptFlagNote(id) {
    const note = window.prompt('Admin note for this flag (leave empty to clear):', '');
    if (note === null) return;  // cancelled
    const r = await apiUpdateFlag(id, { admin_notes: note });
    if (!r.ok) {
      showToast((r.data && r.data.message) || 'Update failed.');
      return;
    }
    showToast('Note saved');
    await this._loadFlagReview();
  },

  _iconWarn() {
    return '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M8 1.5l7 13H1l7-13zM8 6v4M8 11.5v.5" stroke="currentColor" stroke-width="1.2" fill="none"/></svg>';
  },

  navigateToReqNode(major, fullPath) {
    // Switch to the right major
    if (this.activeMajor !== major) {
      this.activeMajor = major;
      document.querySelectorAll('.major-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.major === major);
      });
      this.autoExpandFirstLevel(major);
    }

    // Expand the path to this node
    const parts = fullPath.split('---');
    let pathSoFar = '';
    for (const part of parts) {
      pathSoFar = pathSoFar ? pathSoFar + '---' + part : part;
      this.expandedNodes.add(major + '::' + pathSoFar);
    }

    // Set highlight
    this.highlightedPath = fullPath;
    setTimeout(() => { this.highlightedPath = null; }, 2500);

    // On mobile, switch to map lens
    if (window.innerWidth <= 860) {
      this.setMobileLens('map');
    }

    this.renderTree();

    // Scroll to highlighted node
    setTimeout(() => {
      const highlighted = document.querySelector('.tr-card-head.highlighted, .tr-sub-row.highlighted');
      if (highlighted) {
        highlighted.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  },
};

// ── Bootstrap ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!localStorage.getItem('cf_theme') && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    App.theme = 'dark';
  }
  App.init();
});
