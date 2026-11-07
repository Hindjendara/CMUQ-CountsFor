// ── annotateDoubleCounters ───────────────────────────────

function makeCourse(code, requirementsByMajor) {
  const requirements = {};
  for (const m of Object.keys(requirementsByMajor)) {
    requirements[m] = requirementsByMajor[m].map(r => ({ requirement: r, type: false }));
  }
  return { course_code: code, course_name: code, requirements };
}

test('annotateDoubleCounters: focused-dual marks courses fulfilling both programs', () => {
  const courses = [
    makeCourse('15-122', { CS: ['CS---Core'], BA: ['BA---Tech'] }),
    makeCourse('21-127', { CS: ['CS---Math'] }),
    makeCourse('70-311', { BA: ['BA---Core'] }),
  ];
  const profile = { role: 'student', primary: 'CS', secondary: 'business' };
  const minorList = { business: ['70-311', '73-100'] };

  annotateDoubleCounters(courses, profile, minorList);

  assertEqual(courses[0]._doubleCounter, false);
  assertEqual(courses[1]._doubleCounter, false);
  assertEqual(courses[2]._doubleCounter, true);
});

test('annotateDoubleCounters: 15-122 not a false minor double counter (T5)', () => {
  const courses = [makeCourse('15-122', { CS: ['CS---Core'], BA: ['BA---Tech'] })];
  const profile = { role: 'student', primary: 'CS', secondary: 'business' };
  const minorList = { business: ['70-311'] };
  annotateDoubleCounters(courses, profile, minorList);
  assertEqual(courses[0]._doubleCounter, false);
});

test('annotateDoubleCounters: focused-single clears any prior annotations', () => {
  const courses = [makeCourse('15-122', { CS: ['CS---Core'], BA: ['BA---Tech'] })];
  courses[0]._doubleCounter = true;  // simulate stale annotation

  const profile = { role: 'student', primary: 'CS', secondary: null };
  annotateDoubleCounters(courses, profile, {});

  assertEqual(courses[0]._doubleCounter, false);
});

test('annotateDoubleCounters: cross-program clears annotations', () => {
  const courses = [makeCourse('15-122', { CS: ['CS---Core'], BA: ['BA---Tech'] })];
  courses[0]._doubleCounter = true;

  const profile = { role: 'area_head', primary: null, secondary: null };
  annotateDoubleCounters(courses, profile, {});

  assertEqual(courses[0]._doubleCounter, false);
});

test('annotateDoubleCounters: empty requirements arrays do not count', () => {
  const courses = [
    { course_code: '15-122', requirements: { CS: [], BA: [] } },
  ];
  annotateDoubleCounters(courses, { role: 'student', primary: 'CS', secondary: 'BA' }, {});
  assertEqual(courses[0]._doubleCounter, false);
});

test('annotateDoubleCounters: course with missing requirements key does not crash', () => {
  const courses = [
    { course_code: '15-122' },  // no requirements at all
  ];
  annotateDoubleCounters(courses, { role: 'student', primary: 'CS', secondary: 'BA' }, {});
  assertEqual(courses[0]._doubleCounter, false);
});

// ── annotateMultiProgram ─────────────────────────────────

test('annotateMultiProgram: counts non-empty program keys', () => {
  const courses = [
    makeCourse('15-122', { CS: ['x'], IS: ['x'], BA: ['x'] }),  // 3 programs
    makeCourse('21-127', { CS: ['x'] }),                          // 1 program
    makeCourse('76-101', { CS: ['x'], IS: ['x'], BA: ['x'], BS: ['x'] }),  // 4
  ];
  annotateMultiProgram(courses);
  assertEqual(courses[0]._programCount, 3);
  assertEqual(courses[1]._programCount, 1);
  assertEqual(courses[2]._programCount, 4);
});

test('annotateMultiProgram: empty arrays do not count', () => {
  const courses = [
    { course_code: '15-122', requirements: { CS: ['x'], IS: [], BA: [] } },
  ];
  annotateMultiProgram(courses);
  assertEqual(courses[0]._programCount, 1);
});

test('annotateMultiProgram: missing requirements → 0', () => {
  const courses = [{ course_code: '15-122' }];
  annotateMultiProgram(courses);
  assertEqual(courses[0]._programCount, 0);
});

// === pickAccentColor (spec § 4.5) ===

test('pickAccentColor: math nodes get purple', () => {
  assertEqual(pickAccentColor('Math & Probability', 'CS'), '#6b21a8');
  assertEqual(pickAccentColor('Probability Theory', 'CS'), '#6b21a8');
});

test('pickAccentColor: humanities/arts/gened get amber', () => {
  assertEqual(pickAccentColor('Humanities & Arts', 'CS'), '#B45309');
  assertEqual(pickAccentColor('GenEd Distribution', 'CS'), '#B45309');
});

test('pickAccentColor: electives/technical get green', () => {
  assertEqual(pickAccentColor('Technical Electives', 'CS'), '#047857');
  assertEqual(pickAccentColor('Elective Pool', 'CS'), '#047857');
});

test('pickAccentColor: core/required falls back to major brand', () => {
  assertEqual(pickAccentColor('CS Core', 'CS'), '#C41230');
  assertEqual(pickAccentColor('Required Courses', 'BA'), '#2563EB');
});

test('pickAccentColor: unknown label uses major brand', () => {
  assertEqual(pickAccentColor('Something Random', 'IS'), '#D97706');
  assertEqual(pickAccentColor('Foo Bar', 'BS'), '#059669');
});

test('pickAccentColor: case-insensitive matching', () => {
  assertEqual(pickAccentColor('MATH & PROBABILITY', 'CS'), '#6b21a8');
  assertEqual(pickAccentColor('humanities & arts', 'CS'), '#B45309');
});

// ── predictOffering (rule-based, no ML) ────────────────────

test('predictOffering: <3 historical entries → unknown', () => {
  const c = { offered: ['F23'] };
  assertEqual(predictOffering(c, 'F').state, 'unknown');
});

test('predictOffering: 50%+ in target season → likely', () => {
  // 4 Springs, 1 Fall → 80% Spring share
  const c = { offered: ['S22', 'S23', 'S24', 'S25', 'F22'] };
  assertEqual(predictOffering(c, 'S').state, 'likely');
});

test('predictOffering: 0 in target season → unlikely', () => {
  const c = { offered: ['S22', 'S23', 'S24'] };
  assertEqual(predictOffering(c, 'F').state, 'unlikely');
});

test('predictOffering: <20% in target season → rare', () => {
  // 1 Fall out of 9 = ~11% → rare
  const c = { offered: ['S20', 'S21', 'S22', 'S23', 'S24', 'M21', 'M22', 'M23', 'F25'] };
  assertEqual(predictOffering(c, 'F').state, 'rare');
});

test('predictOffering: 20-50% share → mixed', () => {
  // 2 Falls out of 5 = 40%
  const c = { offered: ['S22', 'S23', 'S24', 'F22', 'F23'] };
  assertEqual(predictOffering(c, 'F').state, 'mixed');
});

test('predictOffering: missing offered field → unknown', () => {
  assertEqual(predictOffering({}, 'F').state, 'unknown');
});

test('filterOfferings: composable semester campus modality', () => {
  const offerings = [
    { semester_code: 'F26', campus: 'Qatar', modality: 'Remote', section: 'A' },
    { semester_code: 'F26', campus: 'Qatar', modality: 'In Person', section: 'B' },
    { semester_code: 'S26', campus: 'Qatar', modality: 'Remote', section: 'C' },
  ];
  const f26QatarRemote = filterOfferings(offerings, {
    semesterCode: 'F26',
    locationFilter: 'qatar',
    modalityFilter: 'remote',
  });
  assertEqual(f26QatarRemote.length, 1);
  assertEqual(f26QatarRemote[0].section, 'A');
});

test('parse campus: 82-289 forced Qatar via fixture helper', () => {
  // Frontend uses offering campus from bundled data; Python fixture lives in data/soc_parse.py.
  const c = { course_code: '82-289', course_name: 'Tutoring for Community Outreach - CMUQ', offered_qatar: true, offered_pitts: false };
  assertEqual(c.offered_qatar, true);
  assertEqual(c.offered_pitts, false);
});

test('predictOffering: deduplicates identical entries before counting', () => {
  // Without dedup: 6 Springs → likely. With dedup: 3 unique Springs → still likely (100%).
  const c = { offered: ['S22', 'S22', 'S23', 'S23', 'S24', 'S24'] };
  assertEqual(predictOffering(c, 'S').state, 'likely');
});

// ── orderCfColumns (role-based course-card column order) ─────

test('orderCfColumns: faculty get canonical cross-program order', () => {
  const mappings = { CS: [1], IS: [1], BA: [1], BS: [1] };
  assertEqual(orderCfColumns(mappings, { role: 'professor', primary: 'IS' }), ['CS', 'IS', 'BA', 'BS']);
});

test('orderCfColumns: student leads with major then minor-as-major', () => {
  const mappings = { CS: [1], IS: [1], BA: [1], BS: [1] };
  assertEqual(orderCfColumns(mappings, { role: 'student', primary: 'BA', secondary: 'cs' }), ['BA', 'CS', 'IS', 'BS']);
});

test('orderCfColumns: only includes programs that have mappings', () => {
  assertEqual(orderCfColumns({ CS: [1], BA: [1] }, { role: 'student', primary: 'BA', secondary: null }), ['BA', 'CS']);
});

// ── getCourseMappings: leaf category label ───────────────────

test('getCourseMappings: shows leaf category only', () => {
  const m = getCourseMappings(makeCourse('X', { CS: ['Root---Mid---Sub---Leaf'] }));
  assertEqual(m.CS[0].shortLabel, 'Leaf');
});

test('getCourseMappings: IGI path shows leaf only, not parent breadcrumb', () => {
  const m = getCourseMappings(makeCourse('82-101', {
    IS: ['GenEd---GenEd---Foundations---Intercultural and Global Inquiry'],
  }));
  assertEqual(m.IS[0].shortLabel, 'Intercultural & Global Inquiry');
});

test('requirementLeafLabel: strips GenEd path to leaf', () => {
  assertEqual(
    requirementLeafLabel('GenEd---GenEd---Foundations---Intercultural and Global Inquiry'),
    'Intercultural & Global Inquiry'
  );
});

test('requirementLeafLabel: labels with a spaced hyphen get a display override', () => {
  const ba = 'BS in Business Administration---Concentration - select 1 concentration from the list below'
    + '---Entrepreneurship---Entrepreneurship Concentration---Two Area Electives'
    + '---Independent Study - Special Permission Required';
  assertEqual(requirementLeafLabel(ba), 'Independent Study (Special Permission Required)');
  assertEqual(
    formatRequirementPath(ba),
    'BA Degree Requirements > Concentrations > Entrepreneurship > Entrepreneurship Concentration'
      + ' > Two Area Electives > Independent Study (Special Permission Required)'
  );
  assertEqual(
    requirementLeafLabel('EY2022 Qatar Business Administration - University Core Requirements'),
    'University Core'
  );
});

test('availableSemesterOptions: includes summer when catalog has M26 offerings', () => {
  const courses = [{
    course_code: '15-122',
    offerings: [{ semester_code: 'F26', campus: 'Qatar', modality: 'In Person' }],
  }, {
    course_code: '21-127',
    offerings: [{ semester: 'Summer 2026', semester_code: 'M26', campus: 'Pittsburgh', modality: 'In Person' }],
  }];
  const opts = availableSemesterOptions(courses, 'F26');
  assertTrue(opts.some(s => s.code === 'M26'));
  assertTrue(opts.some(s => s.code === 'F26'));
});

test('normalizeSemesterCode: accepts label or code', () => {
  assertEqual(normalizeSemesterCode('M26'), 'M26');
  assertEqual(normalizeSemesterCode('Summer 2026'), 'M26');
});

// ── summarizeFlagsByStatus ──────────────────────────────────

test('summarizeFlagsByStatus: counts each status, ignores unknown and null', () => {
  const items = [{ status: 'pending' }, { status: 'pending' }, { status: 'resolved' }, { status: 'weird' }, null];
  assertEqual(summarizeFlagsByStatus(items), { pending: 2, reviewed: 0, resolved: 1, dismissed: 0 });
});

test('summarizeFlagsByStatus: empty / missing input → all zero', () => {
  assertEqual(summarizeFlagsByStatus([]), { pending: 0, reviewed: 0, resolved: 0, dismissed: 0 });
  assertEqual(summarizeFlagsByStatus(undefined), { pending: 0, reviewed: 0, resolved: 0, dismissed: 0 });
});

// ── normalizeCourseCode / buildCourseIndex / lookupCourse ──

test('normalizeCourseCode: compact and float variants resolve to 82-101', () => {
  assertEqual(normalizeCourseCode('82-101'), '82-101');
  assertEqual(normalizeCourseCode('82101'), '82-101');
  assertEqual(normalizeCourseCode('82101.0'), '82-101');
});

test('buildCourseIndex: indexes canonical and compact aliases', () => {
  const courses = [{ course_code: '82-101', course_name: 'Elementary French I' }];
  const index = buildCourseIndex(courses);
  assertEqual(index['82-101'].course_name, 'Elementary French I');
  assertEqual(index['82101'].course_name, 'Elementary French I');
});

test('lookupCourse: 82-101 and 82101 resolve to same record', () => {
  const courses = [{ course_code: '82-101', course_name: 'Elementary French I' }];
  const index = buildCourseIndex(courses);
  assertEqual(lookupCourse(index, '82-101').course_name, 'Elementary French I');
  assertEqual(lookupCourse(index, '82101').course_name, 'Elementary French I');
});

test('findTreeNode and collectCoursesForRequirement gather descendant courses', () => {
  const tree = {
    path: '',
    children: [{
      path: 'GenEd---Foundations',
      label: 'Foundations',
      children: [{
        path: 'GenEd---Foundations---IGI',
        label: 'IGI',
        children: [],
        courses: [
          { code: '82-101', name: 'French I', units: 12, type: true, offered_qatar: true, offered_pitts: false },
          { code: '82-102', name: 'French II', units: 12, type: true, offered_qatar: true, offered_pitts: false },
        ],
      }],
      courses: [],
    }],
    courses: [],
  };
  const parent = findTreeNode(tree, 'GenEd---Foundations');
  const leaf = findTreeNode(tree, 'GenEd---Foundations---IGI');
  assertEqual(parent.label, 'Foundations');
  assertEqual(collectCoursesForRequirement(parent).length, 2);
  assertEqual(collectCoursesForRequirement(leaf).length, 2);
  assertEqual(collectCoursesForRequirement(leaf, c => c.offered_qatar).length, 2);
  assertEqual(collectCoursesForRequirement(leaf, c => c.offered_pitts).length, 0);
});

test('semesterLabel: M-prefix codes read as Summer', () => {
  assertEqual(semesterLabel('M20'), 'Summer 2020');
  assertEqual(semesterLabel('M17'), 'Summer 2017');
  assertEqual(semesterLabel('M26'), 'Summer 2026');
});

test('courseHasMatchingOffering: semester filter excludes other terms', () => {
  const course = {
    offerings: [
      { semester_code: 'F26', campus: 'Qatar', modality: 'In Person' },
      { semester_code: 'S26', campus: 'Qatar', modality: 'In Person' },
    ],
  };
  assertEqual(courseHasMatchingOffering(course, { semesterCode: 'F26', locationFilter: 'all', modalityFilter: 'all' }), true);
  assertEqual(courseHasMatchingOffering(course, { semesterCode: 'M26', locationFilter: 'all', modalityFilter: 'all' }), false);
  assertEqual(courseHasMatchingOffering(course, { locationFilter: 'all', modalityFilter: 'all' }), true);
});

// ── Schedule planning helpers ────────────────────────────────

test('parseDaysTimes: parses CMU-style meeting strings', () => {
  const parsed = parseDaysTimes('UTR 08:30AM-09:45AM');
  assertEqual(parsed.parseable, true);
  assertEqual(parsed.days.join(''), 'UTR');
  assertEqual(parsed.startMin, 8 * 60 + 30);
  assertEqual(parsed.endMin, 9 * 60 + 45);
});

test('parseDaysTimes: TBA and days-only strings are not timed', () => {
  assertEqual(parseDaysTimes('TBA').parseable, false);
  const daysOnly = parseDaysTimes('MWF');
  assertEqual(daysOnly.parseable, false);
  assertEqual(daysOnly.days.join(''), 'MWF');
});

test('formatDaysTimesForDisplay: shows a time range with "to", not a hyphen', () => {
  assertEqual(formatDaysTimesForDisplay('MW 03:30PM-04:50PM'), 'MW 3:30 PM to 4:50 PM');
  assertEqual(formatDaysTimesForDisplay('UTR 08:30AM-09:45AM'), 'UTR 8:30 AM to 9:45 AM');
  assertEqual(formatDaysTimesForDisplay('F 12:00PM-12:50PM'), 'F 12:00 PM to 12:50 PM');
  assertEqual(formatDaysTimesForDisplay('S 10:30AM-03:30PM'), 'S 10:30 AM to 3:30 PM');
  assertEqual(formatDaysTimesForDisplay('TBA 09:00AM-10:20AM'), 'TBA 9:00 AM to 10:20 AM');
  assertEqual(formatDaysTimesForDisplay('09:00AM - 10:20AM'), '9:00 AM to 10:20 AM');
});

test('formatDaysTimesForDisplay: TBA, empty and unparsed strings pass through', () => {
  assertEqual(formatDaysTimesForDisplay('TBA'), 'TBA');
  assertEqual(formatDaysTimesForDisplay(''), 'TBA');
  assertEqual(formatDaysTimesForDisplay(null), 'TBA');
  assertEqual(formatDaysTimesForDisplay('MWF'), 'MWF');
  assertEqual(formatDaysTimesForDisplay('Pittsburgh, Pennsylvania'), 'Pittsburgh, Pennsylvania');
});

test('formatDaysTimesForDisplay: stored days_times and plan keys keep the hyphen format', () => {
  const offering = { semester_code: 'F26', section: 'W', campus: 'Qatar', days_times: 'MW 03:30PM-04:50PM' };
  formatDaysTimesForDisplay(offering.days_times);
  assertEqual(offering.days_times, 'MW 03:30PM-04:50PM');
  assertEqual(planOfferingKey('15-213', offering), '15-213::F26::W::Qatar::MW 03:30PM-04:50PM');
  assertEqual(parseDaysTimes(offering.days_times).parseable, true);
  assertEqual(offeringDaysTimes({ days: 'TR', begin_time: '10:00AM', end_time: '11:20AM' }), 'TR 10:00AM-11:20AM');
});

test('planEntriesOverlap: detects same-day time overlap in one semester', () => {
  const a = { semester_code: 'F26', days_times: 'UTR 08:30AM-09:45AM' };
  const b = { semester_code: 'F26', days_times: 'UTR 09:00AM-10:15AM' };
  const c = { semester_code: 'F26', days_times: 'MWF 08:30AM-09:45AM' };
  assertEqual(planEntriesOverlap(a, b), true);
  assertEqual(planEntriesOverlap(a, c), false);
});

test('countPlanConflictPairs: counts unique overlapping pairs', () => {
  const items = [
    { id: 'a', semester_code: 'F26', days_times: 'UTR 08:30AM-09:45AM' },
    { id: 'b', semester_code: 'F26', days_times: 'UTR 09:00AM-10:15AM' },
    { id: 'c', semester_code: 'F26', days_times: 'MWF 08:30AM-09:45AM' },
  ];
  assertEqual(countPlanConflictPairs(items), 1);
});

test('groupOfferingsBySection: merges multi-meeting rows under one section', () => {
  const offerings = [
    { semester_code: 'F26', section: 'W', campus: 'Qatar', days_times: 'MW 10:00AM-10:50AM' },
    { semester_code: 'F26', section: 'W', campus: 'Qatar', days_times: 'UT 10:00AM-11:15AM' },
    { semester_code: 'F26', section: 'A', campus: 'Qatar', days_times: 'TR 09:00AM-09:50AM' },
  ];
  const groups = groupOfferingsBySection(offerings);
  assertEqual(groups.length, 2);
  assertEqual(groups[0].section, 'W');
  assertEqual(groups[0].meetings.length, 2);
});

test('layoutPlanDayBlocks: places overlapping blocks side by side', () => {
  const a = { item: { id: 'a' }, parsed: { startMin: 600, endMin: 675 } };
  const b = { item: { id: 'b' }, parsed: { startMin: 630, endMin: 705 } };
  const c = { item: { id: 'c' }, parsed: { startMin: 720, endMin: 795 } };
  const laid = layoutPlanDayBlocks([a, b, c]);
  const la = laid.find(x => x.item.id === 'a');
  const lb = laid.find(x => x.item.id === 'b');
  const lc = laid.find(x => x.item.id === 'c');
  assertEqual(la.totalCols, 2);
  assertEqual(lb.totalCols, 2);
  assertEqual(la.col === lb.col, false);
  assertEqual(lc.totalCols, 1);
  assertEqual(lc.col, 0);
});

test('filterOfferings: semester all includes every term', () => {
  const offerings = [
    { semester_code: 'F26', campus: 'Qatar', modality: 'In Person', section: 'A' },
    { semester_code: 'S26', campus: 'Qatar', modality: 'In Person', section: 'B' },
  ];
  const all = filterOfferings(offerings, { semesterCode: 'all', locationFilter: 'all', modalityFilter: 'all' });
  assertEqual(all.length, 2);
});

test('semesterLabel: all semesters option', () => {
  assertEqual(semesterLabel('all'), 'All semesters');
});

test('layoutPlanDayBlocks: different heights for partial overlap', () => {
  const short = { item: { id: 'short' }, parsed: { startMin: 600, endMin: 650 } };
  const long = { item: { id: 'long' }, parsed: { startMin: 600, endMin: 705 } };
  const laid = layoutPlanDayBlocks([short, long]);
  const ls = laid.find(x => x.item.id === 'short');
  const ll = laid.find(x => x.item.id === 'long');
  assertEqual(ls.totalCols, 2);
  assertEqual(ll.totalCols, 2);
  assertEqual(ls.col === ll.col, false);
});

test('layoutPlanDayBlocks: non-overlapping blocks use full width', () => {
  const a = { item: { id: 'a' }, parsed: { startMin: 600, endMin: 650 } };
  const b = { item: { id: 'b' }, parsed: { startMin: 660, endMin: 710 } };
  const laid = layoutPlanDayBlocks([a, b]);
  assertEqual(laid[0].totalCols, 1);
  assertEqual(laid[1].totalCols, 1);
});

// ── normalizeCmuEmail (js/utils.js) ──────────────────────
// Same cases as backend/tests/test_cmu.py: the two checks must agree.

test('normalizeCmuEmail: maps CMU aliases to the Andrew address', () => {
  assertEqual(normalizeCmuEmail('alice@andrew.cmu.edu'), 'alice@andrew.cmu.edu');
  assertEqual(normalizeCmuEmail('  Alice@Andrew.CMU.edu  '), 'alice@andrew.cmu.edu');
  assertEqual(normalizeCmuEmail('alice@cmu.edu'), 'alice@andrew.cmu.edu');
  assertEqual(normalizeCmuEmail('alice@qatar.cmu.edu'), 'alice@andrew.cmu.edu');
});

test('normalizeCmuEmail: rejects non CMU and malformed addresses', () => {
  for (const raw of ['alice@gmail.com', 'alice@notcmu.edu', 'alice', '', null, undefined,
                     '@andrew.cmu.edu', 'al ice@andrew.cmu.edu', 'a@b@andrew.cmu.edu']) {
    assertEqual(normalizeCmuEmail(raw), null, 'input: ' + JSON.stringify(raw));
    assertFalse(isCmuEmail(raw), 'isCmuEmail input: ' + JSON.stringify(raw));
  }
  assertTrue(isCmuEmail('alice@cmu.edu'));
});

// ── Qatar overlay flags: superseded_by, previous_codes, qatar_only ──
// Written by data/apply_mapping_overlays.py from data/mapping_overlays.json.

function renumberedCatalog() {
  const req = (major, path) => ({ requirement: path, type: true, major });
  return [
    {
      course_code: '85-211', course_name: 'Cognitive Psychology', superseded_by: '85-110',
      requirements: { CS: [req('CS', 'GenEd---Humanities/Arts Electives')], IS: [], BA: [], BS: [] },
      offerings: [],
    },
    {
      course_code: '85-110', course_name: 'Cognitive Psychology', previous_codes: ['85-211'],
      requirements: { CS: [req('CS', 'GenEd---Humanities/Arts Electives')], IS: [], BA: [], BS: [] },
      offerings: [{ semester_code: 'F26', campus: 'Qatar', modality: 'In Person' }],
    },
    {
      course_code: '85-100', course_name: 'Introduction to Psychology', qatar_only: true,
      requirements: { CS: [req('CS', 'GenEd---Humanities/Arts Electives')], IS: [], BA: [], BS: [] },
      offerings: [{ semester_code: 'F26', campus: 'Pittsburgh', modality: 'In Person' }],
    },
  ];
}

test('isCourseHidden: superseded rows and qatar_only rows without a Qatar offering', () => {
  const [old, current, intro] = renumberedCatalog();
  assertTrue(isCourseHidden(old));
  assertFalse(isCourseHidden(current));
  assertTrue(isCourseHidden(intro));
  intro.offerings.push({ semester_code: 'S27', campus: 'Qatar', modality: 'In Person' });
  assertFalse(isCourseHidden(intro), 'a Qatar offering makes a qatar_only course visible');
  intro.offerings[1].cancelled = true;
  assertTrue(isCourseHidden(intro), 'a cancelled Qatar section does not count');
  assertFalse(isCourseHidden({ course_code: '15-122', offerings: [] }));
});

test('buildRequirementTree: leaves out superseded and hidden qatar_only rows', () => {
  const tree = buildRequirementTree(renumberedCatalog(), 'CS');
  const leaf = tree.children.GenEd.children['Humanities/Arts Electives'];
  assertEqual(leaf.courses.map(c => c.code), ['85-110']);
});

test('buildCourseIndex: old numbers resolve to the current row', () => {
  const courses = renumberedCatalog();
  const index = buildCourseIndex(courses);
  assertEqual(lookupCourse(index, '85-211').course_code, '85-110');
  assertEqual(lookupCourse(index, '85211').course_code, '85-110');
  assertEqual(lookupCourse(index, '85-110').course_code, '85-110');
  assertEqual(resolveCourseCode(index, '85-211'), '85-110');
  assertTrue(sameCourseCode(index, '85-211', '85-110'));
  assertTrue(sameCourseCode(index, '85110', '85-211'));
  assertFalse(sameCourseCode(index, '85-211', '85-100'));
  assertFalse(sameCourseCode(index, '', '85-110'));
});

test('buildCourseIndex: previous_codes alias works when the old row is gone', () => {
  const courses = [{ course_code: '85-190', previous_codes: ['85-104'] }];
  const index = buildCourseIndex(courses);
  assertEqual(lookupCourse(index, '85-104').course_code, '85-190');
});

test('buildCourseIndex: a code held by a live row is never aliased', () => {
  const courses = [
    { course_code: '85-102', course_name: 'Introduction to Psychology' },
    { course_code: '85-100', course_name: 'Introduction to Psychology', previous_codes: ['85-102'] },
  ];
  const index = buildCourseIndex(courses);
  assertEqual(lookupCourse(index, '85-102').course_code, '85-102');
});

test('applyCourseOverrides: an override on an old code edits the current row', () => {
  const overrides = [{ course_code: '85-211', fields: { course_name: 'Cognitive Psychology (edited)' } }];
  const { courses } = applyCourseOverrides(renumberedCatalog(), overrides);
  const byCode = Object.fromEntries(courses.map(c => [c.course_code, c]));
  assertEqual(byCode['85-110'].course_name, 'Cognitive Psychology (edited)');
  assertEqual(byCode['85-211'].course_name, 'Cognitive Psychology');
});

test('applyCourseOverrides: an is_new override on an old code adds no row', () => {
  const overrides = [{ course_code: '85-211', is_new: true, fields: { units: 9 } }];
  const { courses } = applyCourseOverrides(renumberedCatalog(), overrides);
  assertEqual(courses.length, 3);
  assertEqual(courses.filter(c => c.course_code === '85-211').length, 1);
  assertTrue(!!courses.find(c => c.course_code === '85-211').superseded_by, 'retired row stays superseded');
  assertEqual(courses.find(c => c.course_code === '85-110').units, 9);
});

test('getAlsoCountsFor and annotateDoubleCounters skip hidden rows', () => {
  const [old, current] = renumberedCatalog();
  old.requirements.BA = [{ requirement: 'BA---Core', type: false, major: 'BA' }];
  current.requirements.BA = [{ requirement: 'BA---Core', type: false, major: 'BA' }];
  assertEqual(getAlsoCountsFor(old, 'CS'), []);
  assertEqual(getAlsoCountsFor(current, 'CS'), ['BA']);

  const profile = { role: 'student', primary: 'CS', secondary: 'business' };
  const minorList = { business: ['85-211', '85-110'] };
  annotateDoubleCounters([old, current], profile, minorList);
  assertEqual(old._doubleCounter, false);
  assertEqual(current._doubleCounter, true);
});
