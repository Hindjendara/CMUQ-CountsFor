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

test('predictOffering: the semesters of the SOC sections count as history, once each', () => {
  // A catalog row keeps its old history in offered; its SOC sections (S26, S27) are offerings.
  const c = {
    offered: ['F20', 'F21', 'F22', 'F23', 'F24'],
    offerings: [{ semester_code: 'S26', section: 'A' }, { semester_code: 'S26', section: 'B' },
      { semester_code: 'S27', section: 'A' }, { semester_code: 'F26', section: 'A', cancelled: true }],
  };
  assertEqual(predictOffering(c, 'S').state, 'mixed', '2 springs of 7 semesters, not "not offered in Spring"');
  assertEqual(predictOffering(c, 'F').state, 'likely');
  assertEqual(predictOffering({ offerings: [{ semester_code: 'S26' }, { semester_code: 'S27' }, { semester_code: 'F26' }] }, 'S').state, 'likely');
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

// ── Semesters from the Schedule of Classes ──────────────────
// The picker lists the semesters the catalog has sections for. No semester is
// named in js/, so a new one in the daily scrape needs no code change.

function socCatalog(...extra) {
  const off = (semester_code, campus) => ({ semester_code, campus, modality: 'In Person', section: 'A' });
  return [
    { course_code: '15-122', offerings: [off('F25', 'Qatar'), off('S26', 'Qatar'), off('F26', 'Qatar'), off('S27', 'Qatar')] },
    { course_code: '21-127', offerings: [off('M26', 'Pittsburgh'), off('S27', 'Pittsburgh')] },
    ...extra,
  ];
}

test('catalogSemesters: the catalog semesters newest first; the default is the newest fall or spring in Qatar', () => {
  const s = catalogSemesters(socCatalog());
  assertEqual(s.codes, ['S27', 'F26', 'M26', 'S26', 'F25']);
  assertEqual(s.defaultCode, 'S27');
  assertEqual(availableSemesterOptions(socCatalog()).map(o => o.label),
    ['All semesters', 'Spring 2027', 'Fall 2026', 'Summer 2026', 'Spring 2026', 'Fall 2025']);
});

test('catalogSemesters: a new semester (F27) in the catalog is offered, and is the default once Qatar has sections', () => {
  const pitt = { course_code: '36-200', offerings: [{ semester_code: 'F27', campus: 'Pittsburgh' }] };
  const opts = availableSemesterOptions(socCatalog(pitt));
  assertEqual(opts[1], { code: 'F27', label: 'Fall 2027' });
  assertEqual(catalogSemesters(socCatalog(pitt)).defaultCode, 'S27', 'Pittsburgh sections alone do not move the default');
  const qatar = { course_code: '67-250', offerings: [{ semester_code: 'F27', campus: 'Qatar' }] };
  assertEqual(catalogSemesters(socCatalog(pitt, qatar)).defaultCode, 'F27');
});

test('catalogSemesters: summer is offered but never the default; cancelled sections do not count', () => {
  const summer = { course_code: '15-112', offerings: [{ semester_code: 'M27', campus: 'Qatar' }] };
  const cancelled = { course_code: '15-213', offerings: [{ semester_code: 'F27', campus: 'Qatar', cancelled: true }] };
  const s = catalogSemesters(socCatalog(summer, cancelled));
  assertEqual(s.codes.slice(0, 2), ['M27', 'S27']);
  assertEqual(s.defaultCode, 'S27');
  assertEqual(catalogSemesters([{ course_code: '15-112', offerings: [{ semester_code: 'M27', campus: 'Qatar' }] }]).defaultCode, 'M27',
    'a catalog with only a summer opens on it');
  assertEqual(catalogSemesters([]), { codes: [], defaultCode: null });
});

test('semesterOptions: the semester on screen stays listed even when the catalog lacks it', () => {
  assertEqual(semesterOptions(['S27'], 'F24').map(o => o.code), ['all', 'S27', 'F24']);
  assertEqual(semesterOptions(['S27'], 'all').map(o => o.code), ['all', 'S27']);
  assertEqual(semesterOptions([], null), [{ code: 'all', label: 'All semesters' }]);
});

test('resolveSemesterChoice: the saved choice while offered; else the default, also once a newer default is out', () => {
  const s = catalogSemesters(socCatalog());
  assertEqual(resolveSemesterChoice(s, null), 'S27');
  assertEqual(resolveSemesterChoice(s, { code: 'F26', defaultCode: 'S27' }), 'F26');
  assertEqual(resolveSemesterChoice(s, 'M26'), 'M26', 'a bare code');
  assertEqual(resolveSemesterChoice(s, { code: 'all', defaultCode: 'F26' }), 'all');
  assertEqual(resolveSemesterChoice(s, { code: 'F24', defaultCode: 'S27' }), 'S27', 'no longer in the catalog');
  assertEqual(resolveSemesterChoice(s, { code: 'F26', defaultCode: 'F26' }), 'S27', 'picked before Spring 2027 came out');
  assertEqual(resolveSemesterChoice({ codes: [], defaultCode: null }, { code: 'F26' }), 'all');
});

test('semesterLabel, normalizeSemesterCode, sortSemesters: work for any code', () => {
  assertEqual(semesterLabel('S27'), 'Spring 2027');
  assertEqual(semesterLabel('F31'), 'Fall 2031');
  assertEqual(semesterLabel('X27'), 'X27');
  assertEqual(normalizeSemesterCode('Spring 2027'), 'S27');
  assertEqual(normalizeSemesterCode(' f27 '), 'F27');
  assertEqual(normalizeSemesterCode('Fall'), null);
  assertEqual(sortSemesters(['F25', 'S27', 'M26', 'F26', 'S26', 'bad']), ['S27', 'F26', 'M26', 'S26', 'F25', 'bad']);
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
    { id: 'a', course_code: '15-112', semester_code: 'F26', section: 'W', campus: 'Qatar', days_times: 'UTR 08:30AM-09:45AM' },
    { id: 'b', course_code: '15-122', semester_code: 'F26', section: 'W', campus: 'Qatar', days_times: 'UTR 09:00AM-10:15AM' },
    { id: 'c', course_code: '21-120', semester_code: 'F26', section: 'W', campus: 'Qatar', days_times: 'MWF 08:30AM-09:45AM' },
  ];
  assertEqual(countPlanConflictPairs(items), 1);
  assertEqual([...findPlanConflicts(items)].sort(), ['a', 'b']);
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

// ── Offering groups: a lecture with its sections ─────────────
// Rows as data/courses.json stores them, in Schedule of Classes order.

function socRow(semester_code, campus, section, days_times, modality) {
  return { semester_code, campus, section, days_times, modality: modality || 'In Person' };
}

// [semester, campus, lecture or null, [sections]] for each group.
function groupShape(groups) {
  return groups.map(g => [g.semester_code, g.campus, g.lecture ? g.lecture.section : null, g.sections.map(s => s.section)]);
}

// 09-207 Techniques in Quantitative Analysis, as the Schedule of Classes lists it.
const ROWS_09_207 = [
  socRow('S27', 'Pittsburgh', 'A', 'TBA'),
  socRow('F26', 'Pittsburgh', 'Lec 1', 'T 03:30PM-04:50PM'),
  socRow('F26', 'Pittsburgh', 'A', 'MW 02:00PM-04:20PM'),
  socRow('F26', 'Pittsburgh', 'A', 'MW 02:00PM-02:50PM'),
  socRow('F26', 'Pittsburgh', 'B', 'MW 06:30PM-07:20PM'),
  socRow('F26', 'Pittsburgh', 'B', 'MW 06:30PM-08:50PM'),
  socRow('F26', 'Qatar', 'Lec 2', 'U 04:00PM-04:50PM'),
  socRow('F26', 'Qatar', 'W', 'MW 02:30PM-05:30PM'),
  socRow('S26', 'Pittsburgh', 'A', 'TBA'),
  socRow('F25', 'Pittsburgh', 'Lec 1', 'T 03:30PM-04:50PM'),
  socRow('F25', 'Pittsburgh', 'A', 'MW 02:00PM-02:50PM'),
  socRow('F25', 'Qatar', 'Lec 2', 'U 10:00AM-10:50AM'),
  socRow('F25', 'Qatar', 'W', 'MW 02:30PM-05:30PM'),
];

test('isLectureSection and planSectionLabel: "Lec" rows are lectures, the rest are sections', () => {
  assertTrue(isLectureSection('Lec 2') && isLectureSection('Lec') && isLectureSection('LEC 12'));
  assertFalse(isLectureSection('W') || isLectureSection('LE') || isLectureSection('LA') || isLectureSection(''));
  assertEqual(planSectionLabel('Lec 2'), 'Lec 2');
  assertEqual(planSectionLabel('W'), 'Sec W');
});

test('linkOfferingGroups: 03-151 Fall 2026 links Lec 1 with A in Pittsburgh and Lec 2 with W in Qatar', () => {
  const groups = linkOfferingGroups([
    socRow('F26', 'Pittsburgh', 'Lec 1', 'MWF 02:00PM-02:50PM'),
    socRow('F26', 'Pittsburgh', 'A', 'W 07:00PM-07:50PM'),
    socRow('F26', 'Qatar', 'Lec 2', 'UTR 11:30AM-12:20PM'),
    socRow('F26', 'Qatar', 'W', 'M 02:30PM-04:20PM'),
  ]);
  assertEqual(groupShape(groups), [
    ['F26', 'Pittsburgh', 'Lec 1', ['A']],
    ['F26', 'Qatar', 'Lec 2', ['W']],
  ]);
  assertEqual(groups[1].lecture.meetings.map(m => m.days_times), ['UTR 11:30AM-12:20PM']);
  assertEqual(groups[1].sections[0].meetings.map(m => m.days_times), ['M 02:30PM-04:20PM']);
});

test('linkOfferingGroups: 09-207 Qatar pairs Lec 2 with W in each fall; a section with no lecture stands alone', () => {
  const groups = linkOfferingGroups(ROWS_09_207);
  assertEqual(groupShape(groups), [
    ['S27', 'Pittsburgh', null, ['A']],
    ['F26', 'Pittsburgh', 'Lec 1', ['A', 'B']],
    ['F26', 'Qatar', 'Lec 2', ['W']],
    ['S26', 'Pittsburgh', null, ['A']],
    ['F25', 'Pittsburgh', 'Lec 1', ['A']],
    ['F25', 'Qatar', 'Lec 2', ['W']],
  ]);
  const qatar = filterOfferingGroups(groups, { semesterCode: 'all', locationFilter: 'qatar', modalityFilter: 'all' });
  assertEqual(qatar.map(g => [g.semester_code, g.lecture.meetings[0].days_times, g.sections[0].meetings[0].days_times]), [
    ['F26', 'U 04:00PM-04:50PM', 'MW 02:30PM-05:30PM'],
    ['F25', 'U 10:00AM-10:50AM', 'MW 02:30PM-05:30PM'],
  ]);
});

test('linkOfferingGroups: a section that meets at several times is one section with all its meetings', () => {
  const f26 = linkOfferingGroups(ROWS_09_207)[1];
  assertEqual(f26.sections.map(s => [s.section, s.meetings.map(m => m.days_times)]), [
    ['A', ['MW 02:00PM-04:20PM', 'MW 02:00PM-02:50PM']],
    ['B', ['MW 06:30PM-07:20PM', 'MW 06:30PM-08:50PM']],
  ]);
});

test('linkOfferingGroups: each lecture keeps the sections listed under it (15-112 Fall 2026)', () => {
  const groups = linkOfferingGroups([
    socRow('F26', 'Pittsburgh', 'Lec 1', 'TR 09:30AM-10:50AM'),
    socRow('F26', 'Pittsburgh', 'A', 'W 09:00AM-09:50AM'),
    socRow('F26', 'Pittsburgh', 'B', 'W 10:00AM-10:50AM'),
    socRow('F26', 'Pittsburgh', 'K', 'W 08:00PM-08:50PM'),
    socRow('F26', 'Pittsburgh', 'Lec 2', 'TR 02:00PM-03:20PM'),
    socRow('F26', 'Pittsburgh', 'M', 'W 09:00AM-09:50AM'),
    socRow('F26', 'Qatar', 'Lec 3', 'UTR 11:30AM-12:45PM'),
    socRow('F26', 'Qatar', 'W', 'W 11:30AM-12:45PM'),
  ]);
  assertEqual(groupShape(groups), [
    ['F26', 'Pittsburgh', 'Lec 1', ['A', 'B', 'K']],
    ['F26', 'Pittsburgh', 'Lec 2', ['M']],
    ['F26', 'Qatar', 'Lec 3', ['W']],
  ]);
});

test('linkOfferingGroups: list order decides, never alphabetical order', () => {
  const groups = linkOfferingGroups([
    socRow('F26', 'Pittsburgh', 'Lec 2', 'TR 02:00PM-03:20PM'),
    socRow('F26', 'Pittsburgh', 'B', 'W 10:00AM-10:50AM'),
    socRow('F26', 'Pittsburgh', 'A', 'W 09:00AM-09:50AM'),
    socRow('F26', 'Pittsburgh', 'Lec 1', 'TR 09:30AM-10:50AM'),
    socRow('F26', 'Pittsburgh', 'C', 'W 11:00AM-11:50AM'),
  ]);
  assertEqual(groupShape(groups), [
    ['F26', 'Pittsburgh', 'Lec 2', ['B', 'A']],
    ['F26', 'Pittsburgh', 'Lec 1', ['C']],
  ]);
});

test('linkOfferingGroups: standalone sections, a lecture with no sections, and no links across semesters', () => {
  assertEqual(groupShape(linkOfferingGroups([
    socRow('F26', 'Qatar', 'A', 'MW 10:00AM-11:15AM'),
    socRow('F26', 'Qatar', 'B', 'TR 10:00AM-11:15AM'),
  ])), [['F26', 'Qatar', null, ['A']], ['F26', 'Qatar', null, ['B']]]);
  assertEqual(groupShape(linkOfferingGroups([
    socRow('F26', 'Pittsburgh', 'Lec 1', 'MWF 09:00AM-09:50AM'),
    socRow('F26', 'Pittsburgh', 'Lec 2', 'MWF 10:00AM-10:50AM'),
    socRow('S26', 'Pittsburgh', 'A', 'W 09:00AM-09:50AM'),
  ])), [['F26', 'Pittsburgh', 'Lec 1', []], ['F26', 'Pittsburgh', 'Lec 2', []], ['S26', 'Pittsburgh', null, ['A']]]);
});

test('linkOfferingGroups: a section after a lecture of another campus stays alone', () => {
  assertEqual(groupShape(linkOfferingGroups([
    socRow('F26', 'Pittsburgh', 'Lec 1', 'TR 09:30AM-10:50AM'),
    socRow('F26', 'Qatar', 'W', 'W 11:30AM-12:45PM'),
    socRow('F26', 'Pittsburgh', 'A', 'W 09:00AM-09:50AM'),
  ])), [['F26', 'Pittsburgh', 'Lec 1', ['A']], ['F26', 'Qatar', null, ['W']]]);
});

test('filterOfferingGroups: links first, then filters; a group shows when any meeting matches the modality', () => {
  const groups = linkOfferingGroups([
    socRow('F26', 'Pittsburgh', 'Lec 1', 'TR 09:30AM-10:50AM', 'Remote'),
    socRow('F26', 'Pittsburgh', 'A', 'W 09:00AM-09:50AM', 'In Person'),
    socRow('S26', 'Qatar', 'W', 'M 10:00AM-10:50AM', 'In Person'),
  ]);
  const shape = filters => groupShape(filterOfferingGroups(groups, filters));
  assertEqual(shape({ semesterCode: 'F26', locationFilter: 'all', modalityFilter: 'in_person' }), [['F26', 'Pittsburgh', 'Lec 1', ['A']]]);
  assertEqual(shape({ semesterCode: 'F26', locationFilter: 'all', modalityFilter: 'remote' }), [['F26', 'Pittsburgh', 'Lec 1', ['A']]]);
  assertEqual(shape({ semesterCode: 'F26', locationFilter: 'all', modalityFilter: 'hybrid' }), []);
  assertEqual(shape({ semesterCode: 'all', locationFilter: 'qatar', modalityFilter: 'all' }), [['S26', 'Qatar', null, ['W']]]);
  assertEqual(shape({ semesterCode: 'F26', locationFilter: 'qatar', modalityFilter: 'all' }), []);
});

test('offeringGroupChoice: a section plans with its lecture and replaces the lecture\'s other sections', () => {
  const [lec1] = linkOfferingGroups([
    socRow('F26', 'Pittsburgh', 'Lec 1', 'TR 09:30AM-10:50AM'),
    socRow('F26', 'Pittsburgh', 'A', 'W 09:00AM-09:50AM'),
    socRow('F26', 'Pittsburgh', 'B', 'W 10:00AM-10:50AM'),
  ]);
  const names = choice => [choice.parts.map(p => p.section), choice.others.map(p => p.section)];
  assertEqual(names(offeringGroupChoice(lec1, 'B')), [['Lec 1', 'B'], ['A']]);
  assertEqual(names(offeringGroupChoice(lec1, 'Lec 1')), [['Lec 1', 'A'], ['B']], 'the lecture alone pairs with its first section');
  const bPlanned = m => m.section === 'B';
  assertEqual(names(offeringGroupChoice(lec1, 'Lec 1', bPlanned)), [['Lec 1', 'B'], ['A']], 'or with the section already planned');
  assertEqual(names(offeringGroupChoice(lec1, 'Z')), [[], []]);
  const [alone] = linkOfferingGroups([socRow('F26', 'Qatar', 'W', 'M 10:00AM-10:50AM')]);
  assertEqual(names(offeringGroupChoice(alone, 'W')), [['W'], []]);
});

test('groupPlanItemsByOffering: a lecture and its planned section are one entry, the lecture first', () => {
  const groups = linkOfferingGroups(ROWS_09_207);
  const item = (section, days_times) => ({ course_code: '09-207', semester_code: 'F26', section, campus: 'Qatar', days_times });
  const entries = groupPlanItemsByOffering([
    item('W', 'MW 02:30PM-05:30PM'),
    { course_code: '15-112', semester_code: 'F26', section: 'W', campus: 'Qatar', days_times: 'W 11:30AM-12:45PM' },
    item('Lec 2', 'U 04:00PM-04:50PM'),
    item('Z', 'F 09:00AM-09:50AM'),
  ], code => (code === '09-207' ? groups : []));
  assertEqual(entries.map(e => [e.course_code, e.parts.map(p => p.section)]), [
    ['09-207', ['Lec 2', 'W']],
    ['15-112', ['W']],
    ['09-207', ['Z']],
  ]);
  assertEqual(entries[0].key, planSectionKey('09-207', { semester_code: 'F26', section: 'Lec 2', campus: 'Qatar' }));
  assertEqual(entries[2].key, planSectionKey('09-207', { semester_code: 'F26', section: 'Z', campus: 'Qatar' }), 'a section the catalog no longer lists keeps its own entry');
});

// A planned meeting of an offering row, as togglePlanSection() stores it.
function planMeeting(code, row) {
  return { id: planOfferingKey(code, row), course_code: code, semester_code: row.semester_code, section: row.section,
    campus: row.campus, days_times: row.days_times };
}

// 03-117 Fall 2026 Pittsburgh as the Schedule of Classes lists it: the lecture meets inside its lab's time.
const ROWS_03_117 = [
  socRow('F26', 'Pittsburgh', 'Lec 1', 'TR 01:00PM-01:50PM'),
  socRow('F26', 'Pittsburgh', 'A', 'TR 01:00PM-04:00PM'),
  socRow('F26', 'Pittsburgh', 'B', 'MW 01:00PM-04:00PM'),
];

// The offering key the plan views use (App._planOfferingKeyOf()), over these rows.
function offeringKeys() {
  const groups = { '03-117': linkOfferingGroups(ROWS_03_117), '09-207': linkOfferingGroups(ROWS_09_207) };
  const offeringOf = planItemOfferingGroups(code => groups[code] || []);
  return item => offeringOf(item).key;
}

test('conflicts: the meetings of one offering never conflict, even where the SOC lists overlapping times', () => {
  const keyOf = offeringKeys();
  // Lec 1 (TR 1:00 PM to 1:50 PM) inside lab A (TR 1:00 PM to 4:00 PM): one offering.
  const bio = ROWS_03_117.slice(0, 2).map(r => planMeeting('03-117', r));
  assertTrue(planEntriesOverlap(bio[0], bio[1]), 'the SOC times overlap');
  assertEqual(countPlanConflictPairs(bio, keyOf), 0);
  assertEqual(findPlanConflicts(bio, keyOf).size, 0);
  assertEqual(keyOf(bio[0]), keyOf(bio[1]), 'the lecture and its lab share the offering key');
  assertEqual(countPlanConflictPairs(bio), 1, 'without offering keys each section is its own offering');
  // 09-207 Pittsburgh A meets MW 2:00 PM to 4:20 PM and MW 2:00 PM to 2:50 PM: rows of one section.
  const rowsA = ROWS_09_207.filter(r => r.semester_code === 'F26' && r.section === 'A').map(r => planMeeting('09-207', r));
  assertEqual(rowsA.length, 2);
  assertTrue(planEntriesOverlap(rowsA[0], rowsA[1]), 'the SOC rows overlap');
  assertEqual(countPlanConflictPairs(rowsA), 0, "a section's own rows, without offering keys");
  assertEqual(countPlanConflictPairs(rowsA, keyOf), 0);
  // A lecture and a section that meet at other times of the week are no conflict either way.
  const qatar = ROWS_09_207.filter(r => r.semester_code === 'F26' && r.campus === 'Qatar').map(r => planMeeting('09-207', r));
  assertEqual(countPlanConflictPairs(qatar, keyOf), 0);
});

test('conflicts: other courses and other offerings of one course still conflict when their times overlap', () => {
  const keyOf = offeringKeys();
  const bio = ROWS_03_117.slice(0, 2).map(r => planMeeting('03-117', r));
  // Another course on Tuesdays at 1:30 PM overlaps the lecture and the lab: two conflicts.
  const other = { id: 'x', course_code: '15-112', semester_code: 'F26', section: 'A', campus: 'Pittsburgh', days_times: 'T 01:30PM-02:20PM' };
  assertEqual(countPlanConflictPairs(bio.concat(other), keyOf), 2);
  assertEqual([...findPlanConflicts(bio.concat(other), keyOf)].sort(), [bio[0].id, bio[1].id, 'x'].sort());
  // 09-207 Pittsburgh A (MW from 2:00 PM) next to 09-207 Qatar W (MW from 2:30 PM): two offerings of one course.
  const pitt = ROWS_09_207.filter(r => r.semester_code === 'F26' && r.campus === 'Pittsburgh' && r.section === 'A').map(r => planMeeting('09-207', r));
  const qatarW = ROWS_09_207.filter(r => r.semester_code === 'F26' && r.section === 'W').map(r => planMeeting('09-207', r));
  assertTrue(keyOf(pitt[0]) !== keyOf(qatarW[0]), 'two offerings');
  assertEqual(countPlanConflictPairs(pitt.concat(qatarW), keyOf), 2, "each row of A overlaps W; A's own rows do not count");
  // A meeting whose section the catalog no longer lists is an offering of its own.
  const gone = planMeeting('03-117', socRow('F26', 'Pittsburgh', 'Z', 'TR 01:00PM-02:00PM'));
  assertEqual(countPlanConflictPairs(bio.concat(gone), keyOf), 2);
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
