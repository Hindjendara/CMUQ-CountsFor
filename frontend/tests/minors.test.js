// Minors (js/data.js): selection rules, the minor tree and the double counting
// limit text. Runs in the browser (tests/test.html) and in Node
// (scripts/run-data-tests.js). The real data/minors.json is checked in
// tests/minors-file.test.js (Node only).

function mnCourse(code, units, extra) {
  return Object.assign({
    course_code: code, course_name: 'Course ' + code, units: units == null ? 9 : units, requirements: {},
  }, extra || {});
}

function mnCatalog(spec) {
  return spec.map(s => {
    const [code, units] = s.split(':');
    return mnCourse(code, units == null ? 9 : Number(units));
  });
}

// A small Psychology minor in the shape of data/minors.json.
const MN_PSYCH = {
  name: 'Psychology', title: 'Minor in Psychology', total_units: 72,
  double_count: {
    text: 'Courses may double count without any limit with other programs unless specified otherwise',
    max_with_major: null, max_with_other_minors: null, gen_ed_exempt: true,
    no_limit_categories: [], no_sharing_categories: [], by_major: {}, notes: [],
  },
  categories: [
    { id: 'survey', name: 'Survey Courses', rule: { type: 'pick', n: 2, units: null },
      courses: ['85-110', '85-130', '85-150', '85-170'], select: null, children: [], notes: ['Any 2 survey courses.'] },
    { id: 'statistics', name: 'Statistics', rule: { type: 'take_all', n: null, units: null }, courses: [], select: null, children: [
      { id: 'intro_stats', name: 'Introductory Statistics', rule: { type: 'pick', n: 1, units: null }, courses: ['36-200'], children: [] },
      { id: 'behavioral_stats', name: 'Behavioral Statistics', rule: { type: 'pick', n: 1, units: null }, courses: ['36-309'], children: [] },
    ] },
    { id: 'research_methods', name: 'Research Methods', rule: { type: 'pick', n: 1, units: 9 }, courses: ['85-310'], children: [] },
    { id: 'advanced', name: 'Advanced Courses', rule: { type: 'pick', n: 2, units: null }, courses: [], children: [],
      select: { prefixes: ['85'], min_number: 350, max_number: 499, exclude: ['85-480'], exclude_ranges: [], min_units_per_course: null } },
    { id: 'elective', name: 'Psychology Elective', rule: { type: 'min_units', n: null, units: 9 }, courses: [], children: [],
      select: { prefixes: ['85'], min_number: 0, max_number: 999, exclude: [], exclude_ranges: [], min_units_per_course: null } },
  ],
};

const MN_PSYCH_CATALOG = mnCatalog([
  '85-102', '85-110', '85-130', '85-150', '85-170', '85-310', '85-352', '85-450', '85-480',
  '36-200', '36-309', '15-112:12',
]);

function mnPsychTree() {
  return buildMinorTree('psychology', MN_PSYCH, MN_PSYCH_CATALOG, buildCourseIndex(MN_PSYCH_CATALOG));
}

// ── Selection rules ──────────────────────────────────────

test('courseMatchesSelect: prefixes, number range, exclusions, excluded ranges and unit floor', () => {
  const business = { prefixes: ['70', '73'], min_number: 0, max_number: 999, exclude: ['70-104'],
    exclude_ranges: [{ prefix: '70', min_number: 500, max_number: 599 }], min_units_per_course: null };
  assertTrue(courseMatchesSelect(mnCourse('70-311'), business));
  assertTrue(courseMatchesSelect(mnCourse('73-265'), business));
  assertFalse(courseMatchesSelect(mnCourse('70-104'), business), 'an excluded code');
  assertFalse(courseMatchesSelect(mnCourse('70-501'), business), 'an excluded range');
  assertTrue(courseMatchesSelect(mnCourse('73-501'), business), 'the excluded range is for 70 only');
  assertFalse(courseMatchesSelect(mnCourse('76-101'), business), 'another prefix');

  const cs = { prefixes: ['15'], min_number: 200, max_number: 999, exclude: ['15-351'], exclude_ranges: [], min_units_per_course: 9 };
  assertTrue(courseMatchesSelect(mnCourse('15-281', 9), cs));
  assertTrue(courseMatchesSelect(mnCourse('15-200', 12), cs), 'the range includes its ends');
  assertFalse(courseMatchesSelect(mnCourse('15-300', 6), cs), 'under the unit floor');
  assertFalse(courseMatchesSelect(mnCourse('15-122', 12), cs), 'under the number range');
  assertFalse(courseMatchesSelect(mnCourse('15-351', 12), cs), 'excluded');
  assertFalse(courseMatchesSelect(mnCourse('QG-447'), cs), 'not a CMU course number');
  assertFalse(courseMatchesSelect(mnCourse('15-281'), null));
  assertTrue(courseMatchesSelect(mnCourse('15281.0', 9), cs), 'compact codes are normalized');
});

test('expandMinorCategory: listed codes and select matches, sorted, missing codes reported, hidden rows left out', () => {
  const catalog = [
    mnCourse('79-350'), mnCourse('79-104'), mnCourse('82-286'), mnCourse('79-099'), mnCourse('79-210'),
    mnCourse('79-400', 9, { qatar_only: true, offerings: [{ semester_code: 'F26', campus: 'Pittsburgh' }] }),
  ];
  const r = expandMinorCategory({
    courses: ['82-286', 'QG-447', '82-286', '79-400'],
    select: { prefixes: ['79'], min_number: 100, max_number: 999, exclude: [], exclude_ranges: [] },
  }, catalog, buildCourseIndex(catalog));
  assertEqual(r.courses.map(c => c.course_code), ['79-104', '79-210', '79-350', '82-286']);
  assertEqual(r.missing, ['QG-447']);
  assertEqual(expandMinorCategory({ courses: [], select: null }, catalog, buildCourseIndex(catalog)),
    { courses: [], missing: [] });
});

test('minorRuleLabel: every rule type of minors.json, worded like the major chips', () => {
  assertEqual(minorRuleLabel({ type: 'take_all' }, 0), 'Take all');
  assertEqual(minorRuleLabel({ type: 'required' }, 0), 'Required');
  assertEqual(minorRuleLabel({ type: 'pick', n: 2, units: null }, 0), 'Choose 2');
  assertEqual(minorRuleLabel({ type: 'pick', n: 1, units: 9 }, 0), 'Choose 1 (at least 9 units)');
  assertEqual(minorRuleLabel({ type: 'pick', n: 2, units: 18 }, 0), 'Choose 2 (at least 18 units)');
  assertEqual(minorRuleLabel({ type: 'pick', n: 1, units: null, count: 'children' }, 2), 'Choose 1 of 2');
  assertEqual(minorRuleLabel({ type: 'pick', n: 4, units: null, count: 'courses' }, 2), '4 courses');
  assertEqual(minorRuleLabel({ type: 'pick', n: 4, units: 36, count: 'courses' }, 2), '4 courses (at least 36 units)');
  assertEqual(minorRuleLabel({ type: 'min_units', units: 36 }, 0), 'At least 36 units');
  assertEqual(minorRuleLabel({ type: 'max_units', units: 9 }, 0), 'Up to 9 units');
  assertEqual(minorRuleLabel(null, 0), '');
});

test('buildMinorTree: same node shape as the major trees, paths from category ids', () => {
  const tree = mnPsychTree();
  assertEqual(tree.treeKey, 'minor:psychology');
  assertEqual(tree.label, 'Psychology minor');
  assertEqual(tree.children.map(n => n.path), ['survey', 'statistics', 'research_methods', 'advanced', 'elective']);
  const stats = tree.children[1];
  assertEqual(stats.children.map(n => n.path), ['statistics---intro_stats', 'statistics---behavioral_stats']);
  assertEqual(stats.rule.label, 'Take all');
  assertEqual(stats.children[0].courses.map(c => c.code), ['36-200']);
  const survey = tree.children[0];
  assertEqual(survey.rule.label, 'Choose 2');
  assertEqual(survey.notes, ['Any 2 survey courses.']);
  assertEqual(survey.courses.map(c => c.code), ['85-110', '85-130', '85-150', '85-170']);
  assertEqual(Object.keys(survey.courses[0]).sort(),
    ['code', 'department', 'name', 'offered', 'offered_pitts', 'offered_qatar', 'prerequisites', 'type', 'units']);
  assertFalse(survey.selectOnly);
  const advanced = tree.children[3];
  assertTrue(advanced.selectOnly);
  assertEqual(advanced.courses.map(c => c.code), ['85-352', '85-450'], '85-480 is excluded');
  assertEqual(tree.children[4].courses.length, 9, 'every 85 course');
  assertTrue(tree.children.every(n => n.isMinor && n.minorCode === 'psychology'));
});

test('buildMinorIndex: minors sorted by name, eligible courses and courseCountsForMinor', () => {
  const catalog = MN_PSYCH_CATALOG;
  const index = buildMinorIndex({ minors: {
    psychology: MN_PSYCH,
    arabic: { name: 'Arabic Studies', double_count: {}, categories: [
      { id: 'list_b', name: 'Interdisciplinary', rule: { type: 'min_units', units: 18 }, courses: ['85-170', '79-336'] },
    ] },
    broken: null,
  } }, catalog, buildCourseIndex(catalog));
  assertEqual(index.order, ['arabic', 'psychology']);
  assertEqual(index.byCode.psychology.key, 'minor:psychology');
  assertEqual(index.byCode.psychology.eligible.get('85-110'), ['survey', 'elective']);
  assertEqual(index.byCode.arabic.tree.children[0].missing, ['79-336']);
  assertTrue(courseCountsForMinor(catalog.find(c => c.course_code === '85-170'), 'arabic', index));
  assertFalse(courseCountsForMinor(catalog.find(c => c.course_code === '15-112'), 'psychology', index));
  assertFalse(courseCountsForMinor(catalog[0], 'nope', index));
  assertFalse(courseCountsForMinor(catalog[0], 'psychology', null));
});

// ── Double counting ──────────────────────────────────────

function mnDef(dc, categories) {
  return {
    name: 'Sample',
    double_count: Object.assign({ text: null, max_with_major: null, max_with_other_minors: null, gen_ed_exempt: true,
      no_limit_categories: [], no_sharing_categories: [], by_major: {}, notes: [] }, dc),
    categories: categories || [],
  };
}

const MN_CS_CATS = [
  { id: 'prereq', name: 'Prerequisites', rule: { type: 'take_all' }, courses: ['15-112', '21-127'] },
  { id: 'core', name: 'Computer Science Core', rule: { type: 'take_all' }, courses: [], children: [
    { id: 'core_required', name: 'Required Courses', rule: { type: 'take_all' }, courses: ['15-122', '15-150', '15-210'] },
  ] },
];

const MN_ECON_CATS = [
  { id: 'math', name: 'Mathematics', rule: { type: 'take_all' }, children: [] },
  { id: 'theory', name: 'Economic Theory', rule: { type: 'take_all' }, children: [] },
  { id: 'quant', name: 'Quantitative Analysis', rule: { type: 'pick', n: 1, count: 'children' }, children: [
    { id: 'statistics', name: 'Statistics', rule: { type: 'pick', n: 1 }, courses: ['36-200'] },
    { id: 'data_science', name: 'Economics and Data Science', rule: { type: 'required' }, courses: ['73-265'] },
  ] },
  { id: 'advanced', name: 'Advanced Economics Electives', rule: { type: 'pick', n: 3 } },
];

const MN_ECON_DC = {
  text: 'Courses may not double count with other programs unless specified otherwise',
  max_with_major: 0, max_with_other_minors: 0,
  no_limit_categories: ['math', 'theory', 'statistics'], no_sharing_categories: ['data_science', 'advanced'],
  by_major: { BA: { no_limit_categories: ['math', 'theory', 'statistics', 'advanced'], no_sharing_categories: ['data_science'] } },
};

test('majorCountKind: major requirement, General Education only, none', () => {
  const course = { course_code: '85-110', requirements: {
    CS: [{ requirement: 'GenEd---Category 1', type: true }],
    IS: [{ requirement: 'GenEd---X', type: true }, { requirement: 'IS Core---Y', type: false }],
    BA: [],
  } };
  assertEqual(majorCountKind(course, 'CS'), 'gened');
  assertEqual(majorCountKind(course, 'IS'), 'degree');
  assertEqual(majorCountKind(course, 'BA'), null);
  assertEqual(majorCountKind(course, 'BS'), null);
  assertEqual(majorCountKind(course, null), null);
  assertEqual(majorCountKind(null, 'CS'), null);
});

test('minorDoubleCountLimitText: a limit, no course, no limit, and an unknown rule', () => {
  assertEqual(minorDoubleCountLimitText(mnDef({ text: 'Up to 2 courses may double count', max_with_major: 2 }), 'CS'),
    'At most 2 courses may also count toward your major or another minor.');
  assertEqual(minorDoubleCountLimitText(mnDef({ text: 'Up to 1 course may double count', max_with_major: 1 }), 'CS'),
    'At most 1 course may also count toward your major or another minor.');
  assertEqual(minorDoubleCountLimitText(mnDef({ text: 'x', max_with_major: 2, no_limit_categories: ['prereq'] }, MN_CS_CATS), 'IS'),
    'At most 2 courses may also count toward your major or another minor. Courses used for Prerequisites do not count toward this limit.');
  assertEqual(minorDoubleCountLimitText(mnDef(MN_ECON_DC, MN_ECON_CATS), 'CS'),
    'No course may also count toward your major or another minor, except courses used for Mathematics, Economic Theory and Statistics.');
  assertEqual(minorDoubleCountLimitText(mnDef(MN_ECON_DC, MN_ECON_CATS), 'BA'),
    'No course may also count toward your major or another minor, except courses used for Mathematics, Economic Theory, Statistics and Advanced Economics Electives.');
  assertEqual(minorDoubleCountLimitText(mnDef({ text: 'Courses may double count without any limit' }), 'CS'),
    'Courses may also count toward your major or another minor without a limit.');
  assertEqual(minorDoubleCountLimitText(mnDef({ text: 'x', no_sharing_categories: ['business_electives'] },
    [{ id: 'business_electives', name: 'Business Electives' }]), 'CS'),
    'Courses may also count toward your major or another minor without a limit, except courses used for Business Electives.');
  assertEqual(minorDoubleCountLimitText(mnDef({}), 'CS'), 'Confirm double counting with your advisor.');
  assertEqual(minorDoubleCountLimitText({}, 'CS'), 'Confirm double counting with your advisor.');
  assertEqual(minorDoubleCountLimitText(mnDef({ text: 'x', max_with_major: 2 }), null, "a student's"),
    "At most 2 courses may also count toward a student's major or another minor.");
});

test('plainDataText and joinWithAnd: data strings without dash punctuation, plain lists', () => {
  assertEqual(plainDataText('Up to 2 courses may double count - Business electives cannot'), 'Up to 2 courses may double count, Business electives cannot');
  assertEqual(plainDataText('Pre-requisites and 15-122 may double count'), 'Pre-requisites and 15-122 may double count');
  assertEqual(plainDataText(null), '');
  assertEqual([joinWithAnd([]), joinWithAnd(['A']), joinWithAnd(['A', 'B']), joinWithAnd(['A', 'B', 'C'])],
    ['', 'A', 'A and B', 'A, B and C']);
});

test('minorSourceKind: a catalog page, an official audit file or no source', () => {
  assertEqual(minorSourceKind({ source_file: 'backend/data/sources/catalog-2026-27/minors/product-management-minor.html' }), 'catalog');
  assertEqual(minorSourceKind({ source_file: 'cmu_minor_psychology.json' }), 'audit');
  assertEqual(minorSourceKind({ source_file: null }), null);
  assertEqual(minorSourceKind(null), null);
});
