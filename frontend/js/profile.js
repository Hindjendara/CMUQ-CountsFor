// ============================================================
// CountsFor — Profile module
// State, persistence, and derivation for the user's role and
// program selections. Loaded after data.js, before api.js.
// ============================================================

// ── Centralized program metadata ───────────────────────────
// Single source of truth for major/grouping labels. Per a future plan to
// split "Arts & Sciences" into Humanities & Social Sciences + Math Sciences,
// rename here in one place rather than across components.
const PROGRAM_GROUPS = [
  { id: 'CS', label: 'Computer Science',        kind: 'major',    dataPending: false },
  { id: 'IS', label: 'Information Systems',     kind: 'major',    dataPending: false },
  { id: 'BA', label: 'Business Administration', kind: 'major',    dataPending: false },
  { id: 'BS', label: 'Biological Sciences',     kind: 'major',    dataPending: false },
  { id: 'AI', label: 'Artificial Intelligence', kind: 'major',    dataPending: false },
  { id: 'GS', label: 'General Studies',         kind: 'major',    dataPending: true  },
  // 'AS' is a grouping (not a major identity). Tentative rename to follow
  // Prof. Silvia's suggested split (H&SS / Math Sciences) once finalized.
  { id: 'AS', label: 'Arts & Sciences',         kind: 'grouping', dataPending: false },
];

const VALID_PROGRAMS    = PROGRAM_GROUPS.map(p => p.id);
const MAJOR_LIST        = PROGRAM_GROUPS.filter(p => p.kind === 'major').map(p => p.id);
const STUDENT_PROGRAMS  = MAJOR_LIST.slice();  // students never pick AS

const PROGRAM_FULL_NAME = PROGRAM_GROUPS.reduce((acc, p) => { acc[p.id] = p.label; return acc; }, {});

/** CMU-Q departments for faculty/admin profiles (not student majors). */
const DEPARTMENT_LIST = [
  'Business Administration',
  'Mathematical and Physical Sciences (MPS)',
  'Humanities and Social Sciences (H&SS)',
  'Biological Sciences',
  'Computer Science',
  'Information Systems',
  "Dean's Office",
  'Education Office',
];

const FACULTY_ROLE_TITLES = ['professor', 'area_head', 'associate_area_head', 'advisor'];

function getProgramLabel(code) {
  if (!code) return null;
  return PROGRAM_FULL_NAME[code] || code;
}

/** Permission group: student | faculty | admin */
function getRoleGroup(profileOrRole) {
  if (!profileOrRole) return 'student';
  if (typeof profileOrRole === 'object') {
    if (profileOrRole.role_group) return profileOrRole.role_group;
    profileOrRole = profileOrRole.role;
  }
  if (profileOrRole === 'admin') return 'admin';
  if (FACULTY_ROLE_TITLES.includes(profileOrRole)) return 'faculty';
  return 'student';
}

function canManageDirectory(profile) {
  const g = getRoleGroup(profile);
  return g === 'faculty' || g === 'admin';
}

function canFlagCourses(profile) {
  const g = getRoleGroup(profile);
  return g === 'faculty' || g === 'admin';
}

function canManageUsers(profile) {
  return getRoleGroup(profile) === 'admin';
}

function isProgramDataPending(programId) {
  const meta = PROGRAM_GROUPS.find(p => p.id === programId);
  return !!(meta && meta.dataPending);
}

// ── Centralized minor list (alphabetical) ──────────────────
const MINOR_LIST = [
  { code: 'arabic',        label: 'Arabic Studies' },
  { code: 'biology',       label: 'Biological Sciences' },
  { code: 'business',      label: 'Business Administration' },
  { code: 'cs',            label: 'Computer Science' },
  { code: 'economics',     label: 'Economics' },
  { code: 'finance',       label: 'Financial Management' },
  { code: 'history',       label: 'History' },
  { code: 'math',          label: 'Mathematical Sciences' },
  { code: 'neuroscience',  label: 'Neuroscience' },
  { code: 'product',       label: 'Product Management' },
  { code: 'writing',       label: 'Professional Writing' },
  { code: 'psychology',    label: 'Psychology' },
  { code: 'sociology',     label: 'Sociology' },
  { code: 'self_defined',  label: 'Student-defined' },
  { code: 'tech_entre',    label: 'Tech Entrepreneurship' },
];

// Major code ↔ analogous minor code, so a student picking a same-field
// major+minor combo is silently disallowed.
const MAJOR_TO_MINOR_CODE = { CS: 'cs', BS: 'biology', BA: 'business' };

// Inverse — minors whose requirements we already track as a major.
const MINOR_CODE_TO_MAJOR = { cs: 'CS', biology: 'BS', business: 'BA' };

function getMinorLabel(code) {
  if (!code) return null;
  const m = MINOR_LIST.find(x => x.code === code);
  return m ? m.label : code;
}

/** Student minor codes (0..n). Supports legacy single `secondary`. */
function getProfileMinors(profile) {
  if (!profile) return [];
  if (Array.isArray(profile.secondaries)) {
    return profile.secondaries.filter(Boolean);
  }
  if (profile.secondary) return [profile.secondary];
  return [];
}

function getMinorAsMajorCode(profile) {
  if (!profile || profile.role !== 'student') return null;
  for (const mc of getProfileMinors(profile)) {
    if (MINOR_CODE_TO_MAJOR[mc]) return MINOR_CODE_TO_MAJOR[mc];
  }
  return null;
}

// ── Roles ──────────────────────────────────────────────────
// Internal roles store the precise identity (Area Head vs Associate Area
// Head stay distinct for the database). The UI collapses both under one
// "Area / Associate Area Head" group to avoid button-heavy onboarding.
const VALID_ROLES = ['student', 'professor', 'area_head', 'associate_area_head', 'advisor', 'admin'];

const ROLE_META = {
  student:             { label: 'Student',                    faculty: false, needsMajor: true,  allowsMinor: true,  allowsAllPrograms: false, group: 'student'   },
  professor:           { label: 'Professor',                  faculty: true,  needsMajor: true,  allowsMinor: false, allowsAllPrograms: true,  group: 'professor' },
  area_head:           { label: 'Area Head',                  faculty: true,  needsMajor: true,  allowsMinor: false, allowsAllPrograms: false, group: 'area_lead' },
  associate_area_head: { label: 'Associate Area Head',        faculty: true,  needsMajor: true,  allowsMinor: false, allowsAllPrograms: false, group: 'area_lead' },
  advisor:             { label: 'Advisor',                    faculty: true,  needsMajor: false, allowsMinor: false, allowsAllPrograms: true,  group: 'advisor'   },
  // Admins are not user-pickable in onboarding — they're granted by a
  // directory entry with role admin (directory_entries table). Treated as faculty for flagging visibility
  // (admins can also flag courses) but get the dedicated Flag-Review surface.
  admin:               { label: 'Admin',                      faculty: true,  needsMajor: false, allowsMinor: false, allowsAllPrograms: true,  group: 'admin'     },
};

function isFaculty(profile) {
  const g = getRoleGroup(profile);
  return g === 'faculty' || g === 'admin';
}

function getRoleLabel(profile) {
  if (!profile) return '';
  return (ROLE_META[profile.role] && ROLE_META[profile.role].label) || profile.role;
}

function isStudent(profile) {
  return getRoleGroup(profile) === 'student';
}

/** Schedule planner is available to students and faculty (including admin). */
function canUseSchedulePlan(profile) {
  const g = getRoleGroup(profile);
  return g === 'student' || g === 'faculty' || g === 'admin';
}

// ── Advisor scope ──────────────────────────────────────────
// Advisors may advise across majors, minors, the Arts & Sciences grouping,
// or all programs. The scope flag tells us how to interpret `primary`.
const ADVISOR_SCOPES = ['major', 'minor', 'arts_sciences', 'all_programs'];

function getAdvisorScopeLabel(scope) {
  return ({
    major:         'Major',
    minor:         'Minor',
    arts_sciences: 'Arts & Sciences',
    all_programs:  'All programs',
  })[scope] || scope;
}

// ── View mode ──────────────────────────────────────────────
function computeViewMode(profile) {
  if (!profile || !profile.role) return null;

  // Admins always browse all programs.
  if (profile.role === 'admin') return 'cross-program';

  // Advisor view mode follows scope.
  if (profile.role === 'advisor') {
    if (profile.scope === 'all_programs' || profile.scope === 'arts_sciences') return 'cross-program';
    // Minor or major scope → highlight one program but allow browsing all.
    return 'cross-program';
  }

  // Area leads with no specific major → cross-program (legacy "all programs" path).
  if ((profile.role === 'area_head' || profile.role === 'associate_area_head') &&
      (!profile.primary || profile.primary === 'AS')) {
    return 'cross-program';
  }
  if (profile.role === 'professor' && profile.primary === 'AS') return 'cross-program';

  // Faculty with an assigned major browse all programs with their primary highlighted.
  if (isFaculty(profile) && profile.primary && profile.primary !== 'AS') {
    return 'cross-program';
  }

  // Student-with-minor goes "dual" only if the minor maps to a major we have
  // requirement-tree data for (CS / BA / BS). Other minors are role-badge only.
  if (profile.role === 'student' && getMinorAsMajorCode(profile)) return 'focused-dual';
  return 'focused-single';
}

function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') return false;
  if (!VALID_ROLES.includes(profile.role)) return false;

  if (profile.role === 'student') {
    if (!STUDENT_PROGRAMS.includes(profile.primary)) return false;
    const minors = getProfileMinors(profile);
    const seen = new Set();
    for (const mc of minors) {
      if (seen.has(mc)) return false;
      seen.add(mc);
      if (!MINOR_LIST.some(m => m.code === mc)) return false;
      if (MAJOR_TO_MINOR_CODE[profile.primary] === mc) return false;
    }
    return true;
  }

  if (profile.role === 'professor') {
    if (profile.primary === 'AS') return true;
    if (!MAJOR_LIST.includes(profile.primary)) return false;
    return true;
  }

  if (profile.role === 'admin') {
    // No program required — admins are scoped by server, not by UI.
    return true;
  }

  if (profile.role === 'advisor') {
    if (!ADVISOR_SCOPES.includes(profile.scope)) return false;
    if (profile.scope === 'all_programs')  return true;
    if (profile.scope === 'arts_sciences') return true;
    if (profile.scope === 'major')         return MAJOR_LIST.includes(profile.primary);
    if (profile.scope === 'minor')         return MINOR_LIST.some(m => m.code === profile.primary);
    return false;
  }

  // area_head / associate_area_head — must have a specific program (major or AS)
  if (profile.role === 'area_head' || profile.role === 'associate_area_head') {
    // Legacy area_head with no primary remains valid for back-compat.
    if (profile.role === 'area_head' && !profile.primary) return true;
    if (profile.primary === 'AS') return true;
    if (!MAJOR_LIST.includes(profile.primary)) return false;
    return true;
  }

  return false;
}

// ── Persistence ────────────────────────────────────────────
// Storage keys:
//   cf_role       — role identity (precise — area_head, associate_area_head…)
//   cf_primary    — major code, minor code, 'AS', or empty (for area_head all-programs)
//   cf_secondary  — legacy first minor (mirrors cf_minors[0])
//   cf_minors     — JSON array of student minor codes

function saveProfile(profile) {
  if (!validateProfile(profile)) {
    throw new Error('saveProfile: profile failed validation');
  }
  const minors = getProfileMinors(profile);
  localStorage.setItem('cf_role', profile.role);
  localStorage.setItem('cf_primary', profile.primary || '');
  localStorage.setItem('cf_secondary', minors[0] || '');
  localStorage.setItem('cf_minors', JSON.stringify(minors));
  localStorage.setItem('cf_scope', profile.scope || '');
}

function loadProfile() {
  const role = localStorage.getItem('cf_role');
  if (!role) return null;
  const primary = localStorage.getItem('cf_primary') || null;
  let secondary = localStorage.getItem('cf_secondary') || null;
  let secondaries = [];
  try {
    const rawMinors = localStorage.getItem('cf_minors');
    if (rawMinors) secondaries = JSON.parse(rawMinors);
  } catch {}
  if (!Array.isArray(secondaries)) secondaries = [];
  const scope   = localStorage.getItem('cf_scope') || null;

  // Migration: pre-2026-05-26 builds stored minor as a major code (CS/BA/BS).
  if (secondary && role === 'student') {
    const LEGACY_MAJOR_MINOR = { CS: 'cs', BA: 'business', BS: 'biology' };
    if (LEGACY_MAJOR_MINOR[secondary]) {
      secondary = LEGACY_MAJOR_MINOR[secondary];
      try { localStorage.setItem('cf_secondary', secondary); } catch {}
    } else if (!MINOR_LIST.some(m => m.code === secondary)) {
      secondary = null;
      try { localStorage.setItem('cf_secondary', ''); } catch {}
    }
  }
  if (!secondaries.length && secondary) secondaries = [secondary];

  const profile = {
    role,
    primary:   primary || null,
    secondary: secondaries[0] || null,
    secondaries,
    scope:     scope || null,
  };
  if (!validateProfile(profile)) return null;
  return profile;
}

function clearProfile() {
  localStorage.removeItem('cf_role');
  localStorage.removeItem('cf_primary');
  localStorage.removeItem('cf_secondary');
  localStorage.removeItem('cf_minors');
  localStorage.removeItem('cf_scope');
}
