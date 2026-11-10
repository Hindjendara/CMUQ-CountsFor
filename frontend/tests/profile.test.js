// ── computeViewMode ──────────────────────────────────────

test('computeViewMode: a student with minors stays focused on their major', () => {
  // Minors are sections of the student's own tree (minors.json); a minor no
  // longer borrows another major's tree.
  for (const minors of [['business'], ['cs', 'psychology'], ['arabic']]) {
    assertEqual(computeViewMode({ role: 'student', primary: 'IS', secondaries: minors }), 'focused-single', minors.join());
  }
  assertEqual(computeViewMode({ role: 'student', primary: 'CS', secondary: 'business' }), 'focused-single');
});

test('computeViewMode: student with major, no minor → focused-single', () => {
  assertEqual(
    computeViewMode({ role: 'student', primary: 'CS', secondary: null }),
    'focused-single'
  );
});

test('computeViewMode: professor with CS → cross-program (faculty-with-major view)', () => {
  // Faculty with assigned major browse all programs with their major highlighted.
  assertEqual(
    computeViewMode({ role: 'professor', primary: 'CS', secondary: null }),
    'cross-program'
  );
});

test('computeViewMode: professor with AS (Arts & Sciences) → cross-program', () => {
  assertEqual(
    computeViewMode({ role: 'professor', primary: 'AS', secondary: null }),
    'cross-program'
  );
});

test('computeViewMode: area_head with no major → cross-program', () => {
  assertEqual(
    computeViewMode({ role: 'area_head', primary: null, secondary: null }),
    'cross-program'
  );
});

test('computeViewMode: area_head with CS → cross-program', () => {
  // CS Area Head still browses all programs but with CS highlighted.
  assertEqual(
    computeViewMode({ role: 'area_head', primary: 'CS', secondary: null }),
    'cross-program'
  );
});

test('computeViewMode: associate_area_head with IS → cross-program', () => {
  assertEqual(
    computeViewMode({ role: 'associate_area_head', primary: 'IS', secondary: null }),
    'cross-program'
  );
});

test('computeViewMode: advisor with major scope → cross-program', () => {
  assertEqual(
    computeViewMode({ role: 'advisor', primary: 'BA', scope: 'major' }),
    'cross-program'
  );
});

test('computeViewMode: advisor with minor scope → cross-program', () => {
  assertEqual(
    computeViewMode({ role: 'advisor', primary: 'history', scope: 'minor' }),
    'cross-program'
  );
});

test('computeViewMode: advisor with all_programs scope → cross-program', () => {
  assertEqual(
    computeViewMode({ role: 'advisor', primary: null, scope: 'all_programs' }),
    'cross-program'
  );
});

// ── Role groups ──────────────────────────────────────────

test('getRoleGroup: maps every faculty title to the faculty group', () => {
  assertEqual(getRoleGroup('professor'),           'faculty');
  assertEqual(getRoleGroup('area_head'),           'faculty');
  assertEqual(getRoleGroup('associate_area_head'), 'faculty');
  assertEqual(getRoleGroup('advisor'),             'faculty');
});

test('getRoleGroup: maps student and admin to their own groups', () => {
  assertEqual(getRoleGroup('student'), 'student');
  assertEqual(getRoleGroup('admin'),   'admin');
  assertEqual(getRoleGroup(null),      'student');
  assertEqual(getRoleGroup({ role: 'professor', role_group: 'admin' }), 'admin');
});

// ── Advisor scope validation ─────────────────────────────

test('validateProfile: advisor with major scope + valid major', () => {
  assertTrue(validateProfile({ role: 'advisor', scope: 'major', primary: 'CS' }));
});

test('validateProfile: advisor with major scope + bogus major → invalid', () => {
  assertFalse(validateProfile({ role: 'advisor', scope: 'major', primary: 'ZZ' }));
});

test('validateProfile: advisor with minor scope + valid minor code', () => {
  assertTrue(validateProfile({ role: 'advisor', scope: 'minor', primary: 'history' }));
});

test('validateProfile: advisor with minor scope + bogus minor → invalid', () => {
  assertFalse(validateProfile({ role: 'advisor', scope: 'minor', primary: 'not_a_minor' }));
});

test('validateProfile: advisor with arts_sciences scope', () => {
  assertTrue(validateProfile({ role: 'advisor', scope: 'arts_sciences', primary: null }));
});

test('validateProfile: advisor with all_programs scope (no target needed)', () => {
  assertTrue(validateProfile({ role: 'advisor', scope: 'all_programs', primary: null }));
});

test('validateProfile: advisor with no scope → invalid', () => {
  assertFalse(validateProfile({ role: 'advisor', scope: null, primary: 'CS' }));
});

// ── PROGRAM_GROUPS ───────────────────────────────────────

test('isProgramDataPending: true for AI and GS, false for CS', () => {
  assertTrue(isProgramDataPending('AI'));
  assertTrue(isProgramDataPending('GS'));
  assertFalse(isProgramDataPending('CS'));
});

// ── validateProfile ──────────────────────────────────────

test('validateProfile: complete student profile is valid', () => {
  assertTrue(validateProfile({ role: 'student', primary: 'CS', secondary: 'business' }));
});

test('validateProfile: student with same field as major+minor → invalid', () => {
  // CS major + Computer Science minor — same field.
  assertFalse(validateProfile({ role: 'student', primary: 'CS', secondary: 'cs' }));
});

test('validateProfile: student with arbitrary valid minor → valid', () => {
  assertTrue(validateProfile({ role: 'student', primary: 'CS', secondary: 'arabic' }));
});

test('validateProfile: student with unknown minor code → invalid', () => {
  assertFalse(validateProfile({ role: 'student', primary: 'CS', secondary: 'unknown_minor' }));
});

test('validateProfile: product, business_analytics and comp_bio are minors', () => {
  assertTrue(validateProfile({ role: 'student', primary: 'CS', secondaries: ['product'] }));
  assertTrue(validateProfile({ role: 'student', primary: 'CS', secondaries: ['business_analytics', 'comp_bio'] }));
  assertEqual(getMinorLabel('product'), 'Product Management');
});

test('validateProfile: blocked majors follow minors.json (BA may not take four Tepper minors)', () => {
  for (const mc of ['business', 'business_analytics', 'finance', 'product']) {
    assertFalse(validateProfile({ role: 'student', primary: 'BA', secondaries: [mc] }), 'BA + ' + mc);
    assertTrue(validateProfile({ role: 'student', primary: 'IS', secondaries: [mc] }), 'IS + ' + mc);
  }
  assertFalse(validateProfile({ role: 'student', primary: 'BS', secondaries: ['biology'] }));
  assertTrue(validateProfile({ role: 'student', primary: 'BS', secondaries: ['comp_bio', 'neuroscience'] }));
  assertTrue(validateProfile({ role: 'student', primary: 'BA', secondaries: ['economics', 'psychology'] }));
  assertFalse(validateProfile({ role: 'student', primary: 'CS', secondaries: ['math', 'math'] }), 'no repeats');
});

test('isMinorBlockedForMajor and cleanProfileMinors', () => {
  assertTrue(isMinorBlockedForMajor('finance', 'BA'));
  assertFalse(isMinorBlockedForMajor('finance', 'CS'));
  assertTrue(isMinorBlockedForMajor('product', 'BA'));
  assertFalse(isMinorBlockedForMajor('product', 'IS'));
  assertFalse(isMinorBlockedForMajor('psychology', 'BA'));
  assertFalse(isMinorBlockedForMajor('cs', null));
  assertEqual(cleanProfileMinors('BA', ['finance', 'psychology', 'product', 'psychology', '', 'no_such_minor', 'economics']),
    ['psychology', 'economics']);
  assertEqual(cleanProfileMinors('IS', ['product', 'finance', 'no_such_minor']), ['product', 'finance']);
});

test('minorListFromData: names sorted, blocked majors kept, bad entries skipped', () => {
  const { list, blocked } = minorListFromData({ minors: {
    zed: { name: 'Zoology', blocked_majors: [] },
    abc: { name: 'Accounting', blocked_majors: ['BA', ''] },
    bad: null,
  } });
  assertEqual(list, [{ code: 'abc', label: 'Accounting' }, { code: 'zed', label: 'Zoology' }]);
  assertEqual(blocked, { abc: ['BA'] });
  assertEqual(minorListFromData(null), { list: [], blocked: {} });
});

test('applyMinorsCatalog: an empty file leaves the list alone', () => {
  const before = JSON.stringify(MINOR_LIST);
  assertFalse(applyMinorsCatalog({ minors: {} }));
  assertEqual(JSON.stringify(MINOR_LIST), before);
});

test('validateProfile: invalid role → invalid', () => {
  assertFalse(validateProfile({ role: 'wizard', primary: 'CS', secondary: null }));
});

test('validateProfile: invalid primary program → invalid', () => {
  assertFalse(validateProfile({ role: 'student', primary: 'XX', secondary: null }));
});

test('validateProfile: student with primary=AS → invalid (AS only for profs)', () => {
  assertFalse(validateProfile({ role: 'student', primary: 'AS', secondary: null }));
});

test('validateProfile: area_head with no primary is valid', () => {
  assertTrue(validateProfile({ role: 'area_head', primary: null, secondary: null }));
});

test('validateProfile: area_head with CS is valid', () => {
  assertTrue(validateProfile({ role: 'area_head', primary: 'CS', secondary: null }));
});

test('validateProfile: associate_area_head must have a major', () => {
  assertFalse(validateProfile({ role: 'associate_area_head', primary: null, secondary: null }));
  assertTrue(validateProfile({ role: 'associate_area_head', primary: 'IS', secondary: null }));
});

test('validateProfile: advisor must have a scope (replaced by scope-aware tests below)', () => {
  // No scope at all → invalid; full coverage in the "Advisor scope validation" section.
  assertFalse(validateProfile({ role: 'advisor', primary: 'BS', secondary: null }));
});

test('validateProfile: null profile → invalid', () => {
  assertFalse(validateProfile(null));
});

test('validateProfile: missing role → invalid', () => {
  assertFalse(validateProfile({ primary: 'CS' }));
});

// ── role helpers ─────────────────────────────────────────

test('isFaculty: true for all faculty-type roles', () => {
  assertTrue(isFaculty({ role: 'professor' }));
  assertTrue(isFaculty({ role: 'area_head' }));
  assertTrue(isFaculty({ role: 'associate_area_head' }));
  assertTrue(isFaculty({ role: 'advisor' }));
});

test('isFaculty: false for students', () => {
  assertFalse(isFaculty({ role: 'student' }));
});

test('isStudent: true only for students', () => {
  assertTrue(isStudent({ role: 'student' }));
  assertFalse(isStudent({ role: 'professor' }));
  assertFalse(isStudent({ role: 'advisor' }));
});

// ── persistence ──────────────────────────────────────────

test('saveProfile then loadProfile round-trips a student', () => {
  localStorage.removeItem('cf_role');
  localStorage.removeItem('cf_primary');
  localStorage.removeItem('cf_secondary');

  saveProfile({ role: 'student', primary: 'CS', secondary: 'business' });
  const loaded = loadProfile();
  assertEqual(loaded.role, 'student');
  assertEqual(loaded.primary, 'CS');
  assertEqual(loaded.secondary, 'business');
});

test('saveProfile then loadProfile for area_head (null primary/secondary)', () => {
  saveProfile({ role: 'area_head', primary: null, secondary: null });
  const loaded = loadProfile();
  assertEqual(loaded.role, 'area_head');
  assertEqual(loaded.primary, null);
  assertEqual(loaded.secondary, null);
});

test('saveProfile then loadProfile for advisor with major scope', () => {
  saveProfile({ role: 'advisor', primary: 'IS', secondary: null, scope: 'major' });
  const loaded = loadProfile();
  assertEqual(loaded.role, 'advisor');
  assertEqual(loaded.primary, 'IS');
  assertEqual(loaded.scope, 'major');
});

test('saveProfile then loadProfile for advisor with minor scope', () => {
  saveProfile({ role: 'advisor', primary: 'history', secondary: null, scope: 'minor' });
  const loaded = loadProfile();
  assertEqual(loaded.role, 'advisor');
  assertEqual(loaded.primary, 'history');
  assertEqual(loaded.scope, 'minor');
});

test('saveProfile then loadProfile for associate_area_head with CS', () => {
  saveProfile({ role: 'associate_area_head', primary: 'CS', secondary: null });
  const loaded = loadProfile();
  assertEqual(loaded.role, 'associate_area_head');
  assertEqual(loaded.primary, 'CS');
});

test('loadProfile migrates legacy student minor stored as major code', () => {
  localStorage.setItem('cf_role', 'student');
  localStorage.setItem('cf_primary', 'IS');
  localStorage.setItem('cf_secondary', 'BA');  // legacy form
  const loaded = loadProfile();
  assertEqual(loaded.role, 'student');
  assertEqual(loaded.secondary, 'business');  // migrated
});

test('loadProfile drops minors the app does not offer or the major may not take', () => {
  localStorage.setItem('cf_role', 'student');
  localStorage.setItem('cf_primary', 'BA');
  localStorage.setItem('cf_secondary', 'no_such_minor');
  localStorage.setItem('cf_minors', JSON.stringify(['no_such_minor', 'product', 'finance', 'psychology']));
  const loaded = loadProfile();
  assertEqual(loaded.primary, 'BA');
  assertEqual(loaded.secondaries, ['psychology']);
  assertEqual(loaded.secondary, 'psychology');
  assertEqual(JSON.parse(localStorage.getItem('cf_minors')), ['psychology'], 'the cleaned list is saved');
});

test('loadProfile returns null when no role stored', () => {
  localStorage.removeItem('cf_role');
  localStorage.removeItem('cf_primary');
  localStorage.removeItem('cf_secondary');
  assertEqual(loadProfile(), null);
});

test('loadProfile returns null when stored profile is invalid', () => {
  localStorage.setItem('cf_role', 'wizard');  // not a valid role
  localStorage.setItem('cf_primary', 'CS');
  localStorage.setItem('cf_secondary', '');
  assertEqual(loadProfile(), null);
});

test('clearProfile removes all three keys', () => {
  saveProfile({ role: 'student', primary: 'CS', secondary: 'business' });
  clearProfile();
  assertEqual(localStorage.getItem('cf_role'), null);
  assertEqual(localStorage.getItem('cf_primary'), null);
  assertEqual(localStorage.getItem('cf_secondary'), null);
});
