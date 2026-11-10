// ── annotateDoubleCounters (major + minors.json minors) ─────

function makeCourse(code, requirementsByMajor) {
  const requirements = {};
  for (const m of Object.keys(requirementsByMajor)) {
    requirements[m] = requirementsByMajor[m].map(r => ({ requirement: r, type: false }));
  }
  return { course_code: code, course_name: code, units: 9, requirements };
}

// A one-category Business minor (70-311 or 73-100), built like minors.json.
function businessMinorIndex(courses) {
  const data = { minors: { business: {
    name: 'Business Administration', blocked_majors: ['BA'],
    double_count: { text: null, max_with_major: null },
    categories: [{ id: 'core', name: 'Core', rule: { type: 'pick', n: 1, units: null },
      courses: ['70-311', '73-100'], select: null, children: [], notes: [] }],
  } } };
  return buildMinorIndex(data, courses, buildCourseIndex(courses));
}

test('annotateDoubleCounters: marks a course of the major and a chosen minor', () => {
  const courses = [
    makeCourse('15-122', { CS: ['CS---Core'], BA: ['BA---Tech'] }),
    makeCourse('21-127', { CS: ['CS---Math'] }),
    makeCourse('70-311', { CS: ['CS---Electives'], BA: ['BA---Core'] }),
    makeCourse('73-100', { BA: ['BA---Core'] }),
  ];
  const profile = { role: 'student', primary: 'CS', secondaries: ['business'] };
  annotateDoubleCounters(courses, profile, businessMinorIndex(courses));

  assertEqual(courses.map(c => c._doubleCounter), [false, false, true, false]);
  assertEqual(courses[2]._minorMatches, ['business']);
  assertEqual(courses[2]._majorKind, 'degree');
  assertEqual(courses[3]._minorMatches, ['business'], 'counts for the minor only');
  assertEqual(courses[3]._majorKind, null);
});

test('annotateDoubleCounters: a General Education overlap is marked as gened', () => {
  const courses = [{ course_code: '73-100', course_name: 'Principles of Economics', units: 9,
    requirements: { CS: [{ requirement: 'GenEd---Category 2', type: true, major: 'CS' }] } }];
  annotateDoubleCounters(courses, { role: 'student', primary: 'CS', secondaries: ['business'] }, businessMinorIndex(courses));
  assertEqual(courses[0]._doubleCounter, true);
  assertEqual(courses[0]._majorKind, 'gened');
});

test('annotateDoubleCounters: 15-122 is not a false minor double counter', () => {
  const courses = [makeCourse('15-122', { CS: ['CS---Core'], BA: ['BA---Tech'] })];
  annotateDoubleCounters(courses, { role: 'student', primary: 'CS', secondaries: ['business'] }, businessMinorIndex(courses));
  assertEqual(courses[0]._doubleCounter, false);
});

test('annotateDoubleCounters: no minors, faculty or no minor data clear prior annotations', () => {
  const courses = [makeCourse('70-311', { CS: ['CS---Core'], BA: ['BA---Tech'] })];
  const index = businessMinorIndex(courses);
  for (const [profile, idx] of [
    [{ role: 'student', primary: 'CS', secondary: null }, index],
    [{ role: 'area_head', primary: null, secondary: null }, index],
    [{ role: 'professor', primary: 'AS', secondary: null }, index],
    [{ role: 'student', primary: 'CS', secondaries: ['business'] }, null],
  ]) {
    courses[0]._doubleCounter = true;  // stale annotation
    annotateDoubleCounters(courses, profile, idx);
    assertEqual(courses[0]._doubleCounter, false, JSON.stringify(profile));
  }
});

test('annotateDoubleCounters: empty or missing requirements do not count or crash', () => {
  const courses = [
    { course_code: '70-311', requirements: { CS: [], BA: [] } },
    { course_code: '73-100' },  // no requirements at all
  ];
  annotateDoubleCounters(courses, { role: 'student', primary: 'CS', secondaries: ['business'] }, businessMinorIndex(courses));
  assertEqual(courses.map(c => c._doubleCounter), [false, false]);
  assertEqual(courses.map(c => c._majorKind), [null, null]);
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

test('annotateMultiProgram: counts AI like the other majors', () => {
  const courses = [makeCourse('15-122', { CS: ['x'], AI: ['x'] })];
  annotateMultiProgram(courses);
  assertEqual(courses[0]._programCount, 2);
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
  // Frontend uses offering campus from bundled data; Python fixture lives in backend/scraper/soc_parse.py.
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

test('orderCfColumns: student leads with their major, then the canonical order', () => {
  const mappings = { CS: [1], IS: [1], BA: [1], BS: [1] };
  assertEqual(orderCfColumns(mappings, { role: 'student', primary: 'BS', secondary: 'cs' }), ['BS', 'CS', 'IS', 'BA']);
  assertEqual(orderCfColumns(mappings, { role: 'student', primary: 'IS', secondaries: ['business'] }), ['IS', 'CS', 'BA', 'BS'],
    'a minor no longer pulls another major forward');
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
    IS: ['GenEd---Foundations---Intercultural and Global Inquiry'],
  }));
  assertEqual(m.IS[0].shortLabel, 'Intercultural and Global Inquiry');
});

test('getCourseMappings: a row from an older audit or a catalog rule counts like any other', () => {
  const course = makeCourse('70-213', { BA: ['BS in Business Administration---Business Electives'] });
  course.requirements.BA[0].source = 'rule';
  const m = getCourseMappings(course);
  assertEqual(Object.keys(m.BA[0]).sort(), ['fullPath', 'isGenEd', 'parts', 'shortLabel']);
  assertEqual(m.BA[0].shortLabel, 'Business Electives');
});

test('requirementLeafLabel: strips GenEd path to leaf', () => {
  assertEqual(
    requirementLeafLabel('GenEd---Foundations---Intercultural and Global Inquiry'),
    'Intercultural and Global Inquiry'
  );
});

test('requirementLeafLabel: catalog bucket names show as they are; degree roots get a label', () => {
  const ba = 'BS in Business Administration---Concentration---Entrepreneurship---Choose 2 remaining courses from';
  assertEqual(requirementLeafLabel(ba), 'Choose 2 remaining courses from');
  assertEqual(
    formatRequirementPath(ba),
    'BA Degree Requirements > Concentration > Entrepreneurship > Choose 2 remaining courses from'
  );
  assertEqual(
    requirementLeafLabel('BS in Biological Sciences---Core Areas of Study---Neuroscience Track'
      + '---And TWO (2) or THREE (3) of the following for a total of FIVE (5) courses'),
    'Two or three more courses'
  );
  assertEqual(formatRequirementPath('BS in Artificial Intelligence---Ethics Course'), 'AI Degree Requirements > Ethics Course');
});

// ── Requirement trees: catalog order, gen ed root ──

function treeCatalog() {
  const row = (path, extra) => Object.assign({ requirement: path, type: path.startsWith('GenEd'), major: 'CS' }, extra || {});
  const core = 'BS in Computer Science---Computer Science---Computer Science Core';
  return [
    { course_code: '02-201', course_name: 'Programming for Scientists', units: 10,
      requirements: { CS: [row('BS in Computer Science---Computer Science---Two School of Computer Science electives')] } },
    { course_code: '07-128', course_name: 'First Year Seminar', units: 3, requirements: { CS: [row(core)] } },
    { course_code: '07-129', course_name: 'Freshmen Immigration Course', units: 3,
      requirements: { CS: [row(core, { source: 'rule' })] } },
    { course_code: '15-122', course_name: 'Principles of Imperative Computation', units: 12, requirements: { CS: [row(core)] } },
    { course_code: '15-151', course_name: 'Mathematical Foundations for Computer Science', units: 12,
      requirements: { CS: [row('BS in Computer Science---Mathematics---All of the following Mathematics courses')] } },
    { course_code: '76-101', course_name: 'Interpretation and Argument', units: 9,
      requirements: { CS: [row('GenEd---Humanities and Arts---A. First Year Writing Requirement')] } },
  ];
}

test('normalizeTree: sibling buckets follow the catalog order of the rules', () => {
  const tree = normalizeTree(buildRequirementTree(treeCatalog(), 'CS'), 'CS', 0);
  const degree = tree.children.find(n => n.rawLabel === 'BS in Computer Science');
  assertEqual(degree.children.map(n => n.rawLabel), ['Computer Science', 'Mathematics']);
  const cs = degree.children[0];
  // 02-201 is seen first, but Computer Science Core comes first in the catalog.
  assertEqual(cs.children.map(n => n.rawLabel), ['Computer Science Core', 'Two School of Computer Science electives']);
  assertEqual(cs.children[0].rule.label, 'Take all');
});

test('buildRequirementTree: every course on a bucket lists the same way, in catalog row order', () => {
  const tree = normalizeTree(buildRequirementTree(treeCatalog(), 'CS'), 'CS', 0);
  const core = findTreeNode(tree, 'BS in Computer Science---Computer Science---Computer Science Core');
  // 07-129 comes from an older audit and its row carries a rule tag: neither is shown or sorted on.
  assertEqual(core.courses.map(c => c.code), ['07-128', '07-129', '15-122']);
  for (const c of core.courses) {
    assertFalse('earlier' in c || 'earlierReason' in c || 'source' in c, `${c.code} carries no flag`);
  }
});

test('splitTreeSections: the GenEd root is gen ed, the degree root is not', () => {
  const tree = normalizeTree(buildRequirementTree(treeCatalog(), 'CS'), 'CS', 0);
  const { degree, gened } = splitTreeSections(tree, 'CS');
  assertEqual(degree.map(n => n.rawLabel), ['BS in Computer Science']);
  assertEqual(gened.map(n => n.rawLabel), ['GenEd']);
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

// ── Qatar overlay flag: qatar_only ──
// Written by backend/scraper/apply_mapping_overlays.py from backend/data/mapping_overlays.json.

function qatarOnlyCatalog() {
  const req = (major, path) => ({ requirement: path, type: true, major });
  return [
    {
      course_code: '85-110', course_name: 'Cognitive Psychology',
      requirements: { CS: [req('CS', 'GenEd---Humanities and Arts---C. Humanities and Arts Electives')], IS: [], BA: [], BS: [] },
      offerings: [{ semester_code: 'F26', campus: 'Qatar', modality: 'In Person' }],
    },
    {
      course_code: '85-100', course_name: 'Introduction to Psychology', qatar_only: true,
      requirements: { CS: [req('CS', 'GenEd---Humanities and Arts---C. Humanities and Arts Electives')], IS: [], BA: [], BS: [] },
      offerings: [{ semester_code: 'F26', campus: 'Pittsburgh', modality: 'In Person' }],
    },
  ];
}

test('isCourseHidden: qatar_only rows without a Qatar offering', () => {
  const [current, intro] = qatarOnlyCatalog();
  assertFalse(isCourseHidden(current));
  assertTrue(isCourseHidden(intro));
  intro.offerings.push({ semester_code: 'S27', campus: 'Qatar', modality: 'In Person' });
  assertFalse(isCourseHidden(intro), 'a Qatar offering makes a qatar_only course visible');
  intro.offerings[1].cancelled = true;
  assertTrue(isCourseHidden(intro), 'a cancelled Qatar section does not count');
  assertFalse(isCourseHidden({ course_code: '15-122', offerings: [] }));
});

test('buildRequirementTree: leaves out hidden qatar_only rows', () => {
  const tree = buildRequirementTree(qatarOnlyCatalog(), 'CS');
  const leaf = tree.children.GenEd.children['Humanities and Arts'].children['C. Humanities and Arts Electives'];
  assertEqual(leaf.courses.map(c => c.code), ['85-110']);
});

test('buildCourseIndex: finds a course by its code only', () => {
  const index = buildCourseIndex(qatarOnlyCatalog());
  assertEqual(lookupCourse(index, '85-110').course_code, '85-110');
  assertEqual(lookupCourse(index, '85110').course_code, '85-110');
  assertEqual(lookupCourse(index, '85-211'), null, 'a code with no row finds nothing');
});

test('getAlsoCountsFor and annotateDoubleCounters skip hidden rows', () => {
  const [current, intro] = qatarOnlyCatalog();
  intro.requirements.BA = [{ requirement: 'BA---Core', type: false, major: 'BA' }];
  current.requirements.BA = [{ requirement: 'BA---Core', type: false, major: 'BA' }];
  assertEqual(getAlsoCountsFor(intro, 'CS'), []);
  assertEqual(getAlsoCountsFor(current, 'CS'), ['BA']);

  const catalog = [current, intro];
  const index = buildMinorIndex({ minors: { psychology: {
    name: 'Psychology', double_count: {},
    categories: [{ id: 'any', name: 'Any Psychology', rule: { type: 'pick', n: 2 }, courses: ['85-100', '85-110'] }],
  } } }, catalog, buildCourseIndex(catalog));
  annotateDoubleCounters(catalog, { role: 'student', primary: 'CS', secondaries: ['psychology'] }, index);
  assertEqual(intro._doubleCounter, false);
  assertEqual(current._doubleCounter, true);
  assertEqual(courseCountsForMinor(intro, 'psychology', index), false, 'a hidden row counts for no minor');
});
