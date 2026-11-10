// Minors (js/data.js): selection rules, the minor tree, progress from course
// statuses, and double counting. Runs in the browser (tests/test.html) and in
// Node (scripts/run-data-tests.js). The real data/minors.json is checked in
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

const mnStatus = (progress, path) => progress.byPath.get(path);

// ── Course statuses ──────────────────────────────────────

test('course status: cycle, labels and cleaning of stored values', () => {
  assertEqual(nextCourseStatus(''), 'in_progress');
  assertEqual(nextCourseStatus('in_progress'), 'completed');
  assertEqual(nextCourseStatus('completed'), '');
  assertEqual(nextCourseStatus(undefined), 'in_progress');
  assertEqual([courseStatusLabel(''), courseStatusLabel('in_progress'), courseStatusLabel('completed')],
    ['Not taken', 'In progress', 'Completed']);
  assertEqual(normalizeCourseStatuses({ '85110': 'completed', '15-122': 'in_progress', '21-127': 'maybe', '': 'completed' }),
    { '85-110': 'completed', '15-122': 'in_progress' });
  assertEqual(normalizeCourseStatuses(['85-110']), {});
  assertEqual(normalizeCourseStatuses(null), {});
  assertEqual(COURSE_STATUS_KEY, 'cf_course_status');
});

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

test('minorRuleLabel: every rule type of minors.json', () => {
  assertEqual(minorRuleLabel({ type: 'take_all' }, 0), 'take all');
  assertEqual(minorRuleLabel({ type: 'required' }, 0), 'required');
  assertEqual(minorRuleLabel({ type: 'pick', n: 2, units: null }, 0), 'pick 2');
  assertEqual(minorRuleLabel({ type: 'pick', n: 2, units: 18 }, 0), 'pick 2, ≥18 units');
  assertEqual(minorRuleLabel({ type: 'pick', n: 1, units: null, count: 'children' }, 2), 'pick 1 of 2');
  assertEqual(minorRuleLabel({ type: 'pick', n: 4, units: null, count: 'courses' }, 2), '4 courses');
  assertEqual(minorRuleLabel({ type: 'min_units', units: 36 }, 0), '≥36 units');
  assertEqual(minorRuleLabel({ type: 'max_units', units: 9 }, 0), '≤9 units');
  assertEqual(minorRuleLabel(null, 0), '');
});

test('buildMinorTree: same node shape as the major trees, paths from category ids', () => {
  const tree = mnPsychTree();
  assertEqual(tree.treeKey, 'minor:psychology');
  assertEqual(tree.label, 'Psychology minor');
  assertEqual(tree.children.map(n => n.path), ['survey', 'statistics', 'research_methods', 'advanced', 'elective']);
  const stats = tree.children[1];
  assertEqual(stats.children.map(n => n.path), ['statistics---intro_stats', 'statistics---behavioral_stats']);
  assertEqual(stats.rule.label, 'take all');
  assertEqual(stats.children[0].courses.map(c => c.code), ['36-200']);
  const survey = tree.children[0];
  assertEqual(survey.rule.label, 'pick 2');
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

// ── Progress: rule status from course statuses ───────────

test('computeMinorProgress: nothing marked, every requirement is left', () => {
  const p = computeMinorProgress(mnPsychTree(), {});
  assertEqual(p.summary, { total: 5, complete: 0, inProgress: 0, remaining: 5, marked: 0, state: 'remaining' });
  assertEqual(minorStatusText(mnStatus(p, 'survey')), { cls: 'left', text: '2 courses left' });
  assertEqual(minorStatusText(mnStatus(p, 'elective')), { cls: 'left', text: '9 units left' });
  assertEqual(minorStatusText(mnStatus(p, 'statistics')), { cls: 'left', text: '2 parts left' });
  assertEqual(minorStatusText(mnStatus(p, 'research_methods')), { cls: 'left', text: '1 course and 9 units left' });
});

test('computeMinorProgress: one course fills one category (a third survey course becomes the elective)', () => {
  const p = computeMinorProgress(mnPsychTree(), { '85-110': 'completed', '85-130': 'completed', '85-150': 'completed' });
  assertEqual(mnStatus(p, 'survey').state, 'complete');
  assertEqual(mnStatus(p, 'elective').state, 'complete');
  assertEqual(p.assigned.get('85-110'), 'survey');
  assertEqual(p.assigned.get('85-130'), 'survey');
  assertEqual(p.assigned.get('85-150'), 'elective');
  assertEqual(p.summary.complete, 2);
  assertEqual(minorSummaryText(p.summary), '2 of 5 requirements done, 3 left');
});

test('computeMinorProgress: narrower categories fill first, so an any course list does not take them', () => {
  const p = computeMinorProgress(mnPsychTree(), { '85-352': 'completed', '85-450': 'completed' });
  assertEqual(mnStatus(p, 'advanced').state, 'complete');
  assertEqual(mnStatus(p, 'elective').state, 'remaining', 'both courses are needed for Advanced Courses');
  const more = computeMinorProgress(mnPsychTree(), { '85-352': 'completed', '85-450': 'completed', '85-102': 'in_progress' });
  assertEqual(mnStatus(more, 'elective').state, 'in_progress');
  assertEqual(more.assigned.get('85-102'), 'elective');
});

test('computeMinorProgress: completed, in progress and remaining states and texts', () => {
  const p = computeMinorProgress(mnPsychTree(), {
    '85-110': 'completed', '85-130': 'in_progress', '85-310': 'in_progress', '36-200': 'completed',
  });
  assertEqual(mnStatus(p, 'survey').state, 'in_progress');
  assertEqual(minorStatusText(mnStatus(p, 'survey')), { cls: 'ip', text: 'In progress' });
  assertEqual(mnStatus(p, 'research_methods').state, 'in_progress');
  assertEqual(mnStatus(p, 'statistics---intro_stats').state, 'complete');
  assertEqual(minorStatusText(mnStatus(p, 'statistics---intro_stats')), { cls: 'done', text: 'Done' });
  assertEqual(mnStatus(p, 'statistics').state, 'remaining');
  assertEqual(minorStatusText(mnStatus(p, 'statistics')), { cls: 'left', text: '1 part left' });
  assertEqual(mnStatus(p, 'survey').done, 1);
  assertEqual(mnStatus(p, 'survey').inProgress, 1);
  assertEqual(p.summary, { total: 5, complete: 0, inProgress: 2, remaining: 3, marked: 4, state: 'remaining' });
  assertEqual(minorSummaryText(p.summary), '0 of 5 requirements done, 2 in progress, 3 left');
  const done = computeMinorProgress(mnPsychTree(), {
    '85-110': 'completed', '85-130': 'completed', '85-310': 'completed', '36-200': 'completed', '36-309': 'completed',
    '85-352': 'completed', '85-450': 'completed', '85-102': 'completed',
  });
  assertEqual(done.summary.state, 'complete');
  assertEqual(minorSummaryText(done.summary), '5 of 5 requirements done');
});

test('computeMinorProgress: pick n with a unit floor takes courses until both are met', () => {
  const catalog = mnCatalog(['79-201:6', '79-202:6', '79-203:6', '79-204:12']);
  const def = { name: 'History', categories: [
    { id: 'electives', name: 'History Electives', rule: { type: 'pick', n: 2, units: 18 },
      select: { prefixes: ['79'], min_number: 100, max_number: 999 } },
  ] };
  const tree = buildMinorTree('history', def, catalog, buildCourseIndex(catalog));
  const two = computeMinorProgress(tree, { '79-201': 'completed', '79-202': 'completed' });
  assertEqual(mnStatus(two, 'electives').state, 'remaining');
  assertEqual(minorStatusText(mnStatus(two, 'electives')), { cls: 'left', text: '6 units left' });
  const three = computeMinorProgress(tree, { '79-201': 'completed', '79-202': 'completed', '79-203': 'completed' });
  assertEqual(mnStatus(three, 'electives').state, 'complete');
  assertEqual(mnStatus(three, 'electives').doneUnits, 18);
});

test('computeMinorProgress: a take all list needs every listed course, including codes not in the catalog', () => {
  const catalog = mnCatalog(['15-122:12', '15-150:12']);
  const def = { name: 'CS', categories: [
    { id: 'core', name: 'Required Courses', rule: { type: 'take_all' }, courses: ['15-122', '15-150', '15-210'] },
  ] };
  const tree = buildMinorTree('cs', def, catalog, buildCourseIndex(catalog));
  const p = computeMinorProgress(tree, { '15-122': 'completed', '15-150': 'completed' });
  assertEqual(mnStatus(p, 'core').state, 'remaining');
  assertEqual(minorStatusText(mnStatus(p, 'core')), { cls: 'left', text: '1 course left' });
});

test('computeMinorProgress: pick one of two parts (Economics Quantitative Analysis)', () => {
  const catalog = mnCatalog(['36-200', '73-265']);
  const def = { name: 'Economics', categories: [
    { id: 'quant', name: 'Quantitative Analysis', rule: { type: 'pick', n: 1, count: 'children' }, courses: [], children: [
      { id: 'statistics', name: 'Statistics', rule: { type: 'pick', n: 1 }, courses: ['36-200'] },
      { id: 'data_science', name: 'Economics and Data Science', rule: { type: 'required' }, courses: ['73-265'] },
    ] },
  ] };
  const tree = buildMinorTree('economics', def, catalog, buildCourseIndex(catalog));
  assertEqual(tree.children[0].rule.label, 'pick 1 of 2');
  assertEqual(minorStatusText(mnStatus(computeMinorProgress(tree, {}), 'quant')), { cls: 'left', text: '1 part left' });
  assertEqual(mnStatus(computeMinorProgress(tree, { '73-265': 'completed' }), 'quant').state, 'complete');
  assertEqual(mnStatus(computeMinorProgress(tree, { '36-200': 'in_progress' }), 'quant').state, 'in_progress');
});

test('computeMinorProgress: courses counted across parts (Sociology Electives, 4 courses, 1 from each area)', () => {
  const catalog = mnCatalog(['88-230', '88-231', '88-232', '88-234', '88-235']);
  const def = { name: 'Sociology', categories: [
    { id: 'electives', name: 'Sociology Electives', rule: { type: 'pick', n: 4, count: 'courses' }, courses: [], children: [
      { id: 'a', name: 'Gender, Family and Culture', rule: { type: 'pick', n: 1 }, courses: ['88-230', '88-231', '88-232'] },
      { id: 'b', name: 'Work, Organizations and Technology', rule: { type: 'pick', n: 1 }, courses: ['88-234', '88-235'] },
    ] },
  ] };
  const tree = buildMinorTree('sociology', def, catalog, buildCourseIndex(catalog));
  const oneArea = computeMinorProgress(tree, { '88-230': 'completed', '88-231': 'completed', '88-232': 'completed' });
  assertEqual(mnStatus(oneArea, 'electives').state, 'remaining');
  assertEqual(mnStatus(oneArea, 'electives').courses.length, 3, 'the area took more than its one course');
  assertEqual(minorStatusText(mnStatus(oneArea, 'electives')), { cls: 'left', text: '1 course left' });
  const both = computeMinorProgress(tree, { '88-230': 'completed', '88-231': 'completed', '88-232': 'completed', '88-234': 'completed' });
  assertEqual(mnStatus(both, 'electives').state, 'complete');
  assertEqual(mnStatus(both, 'electives---b').courses, ['88-234']);
});

test('computeMinorProgress: a unit total across parts with a capped part (Writing Core Writing)', () => {
  const catalog = mnCatalog(['76-373', '76-389', '76-260', '76-261']);
  const def = { name: 'Professional Writing', categories: [
    { id: 'core_writing', name: 'Core Writing', rule: { type: 'min_units', units: 18 }, courses: [], children: [
      { id: 'core', name: 'Core Courses', rule: { type: 'pick', n: 1 }, courses: ['76-373', '76-389'] },
      { id: 'creative', name: 'Creative Writing', rule: { type: 'max_units', units: 9 }, courses: ['76-260', '76-261'] },
    ] },
  ] };
  const tree = buildMinorTree('writing', def, catalog, buildCourseIndex(catalog));
  const p = computeMinorProgress(tree, { '76-373': 'completed', '76-260': 'completed', '76-261': 'completed' });
  assertEqual(mnStatus(p, 'core_writing').state, 'complete');
  assertEqual(mnStatus(p, 'core_writing---creative').courses, ['76-260'], 'at most 9 units of creative writing');
  assertFalse(p.assigned.has('76-261'));
  assertEqual(mnStatus(p, 'core_writing---creative').state, 'optional');
  assertEqual(minorStatusText(mnStatus(p, 'core_writing---creative')), { cls: 'opt', text: '9 units used' });
  const short = computeMinorProgress(tree, { '76-260': 'completed', '76-261': 'completed' });
  assertEqual(mnStatus(short, 'core_writing').state, 'remaining', 'a core course is required');
  const twoCore = computeMinorProgress(tree, { '76-373': 'completed', '76-389': 'completed' });
  assertEqual(mnStatus(twoCore, 'core_writing').state, 'complete', 'a second core course adds the units');
  assertEqual(mnStatus(twoCore, 'core_writing---core').courses, ['76-373', '76-389']);
});

test('computeMinorProgress: completed courses are used before in progress ones', () => {
  const p = computeMinorProgress(mnPsychTree(), { '85-110': 'in_progress', '85-130': 'completed', '85-150': 'completed' });
  assertEqual(mnStatus(p, 'survey').state, 'complete');
  assertEqual(mnStatus(p, 'survey').courses, ['85-130', '85-150']);
  assertEqual(p.assigned.get('85-110'), 'elective');
});

test('computeMinorProgress: a minor without categories has nothing to track', () => {
  const p = computeMinorProgress(buildMinorTree('self_defined', { name: 'Student-defined', categories: [] }, [], {}), { '85-110': 'completed' });
  assertEqual(p.summary, { total: 0, complete: 0, inProgress: 0, remaining: 0, marked: 0, state: 'none' });
  assertEqual(minorSummaryText(p.summary), '');
});

test('countMarkedCourses: distinct marked courses under a major tree node', () => {
  const node = { courses: [{ code: '85-110' }, { code: '85-130' }], children: [
    { courses: [{ code: '85-110' }, { code: '21-127' }, { code: '15-122' }], children: [] },
  ] };
  assertEqual(countMarkedCourses(node, { '85-110': 'completed', '21-127': 'in_progress', '99-999': 'completed' }),
    { done: 1, inProgress: 1 });
  assertEqual(countMarkedCourses(node, {}), { done: 0, inProgress: 0 });
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

test('checkMinorDoubleCounting: shared courses over the limit raise a warning; free categories do not count', () => {
  const def = mnDef({ text: 'x', max_with_major: 2, no_limit_categories: ['prereq'] }, MN_CS_CATS);
  const progress = { assigned: new Map([
    ['15-112', 'prereq'], ['21-127', 'prereq'],
    ['15-122', 'core---core_required'], ['15-150', 'core---core_required'], ['15-210', 'core---core_required'],
  ]) };
  const kinds = { '15-112': 'degree', '15-122': 'degree', '15-150': 'degree', '15-210': 'degree', '21-127': 'gened' };
  const check = checkMinorDoubleCounting(def, progress, { majorCode: 'IS', majorKindOf: c => kinds[c] || null, otherMinors: [] });
  assertEqual(check.shared.map(s => s.code), ['15-112', '15-122', '15-150', '15-210'], 'Gen Ed overlap is free');
  assertEqual(check.counted.map(s => s.code), ['15-122', '15-150', '15-210']);
  assertTrue(check.over);
  const warnings = minorDoubleCountWarnings(check, def, 'IS');
  assertEqual(warnings, ['3 courses you marked count toward this minor and toward your IS major or another minor '
    + '(15-122, 15-150 and 15-210). At most 2 may. Ask your advisor which ones to use.']);

  progress.assigned.delete('15-210');
  const ok = checkMinorDoubleCounting(def, progress, { majorCode: 'IS', majorKindOf: c => kinds[c] || null });
  assertFalse(ok.over);
  assertEqual(minorDoubleCountWarnings(ok, def, 'IS'), []);
});

test('checkMinorDoubleCounting: a category that may never be shared is flagged even without a limit', () => {
  const def = mnDef({ text: 'Courses may double count without any limit | Business electives cannot double-count',
    no_sharing_categories: ['business_electives'] },
    [{ id: 'constrained', name: 'Constrained Electives' }, { id: 'business_electives', name: 'Business Electives' }]);
  const progress = { assigned: new Map([['70-311', 'constrained'], ['70-371', 'business_electives']]) };
  const check = checkMinorDoubleCounting(def, progress, { majorCode: 'IS', majorKindOf: () => 'degree' });
  assertFalse(check.over, 'no limit');
  assertEqual(check.blocked.map(s => s.code), ['70-371']);
  assertEqual(minorDoubleCountWarnings(check, def, 'IS'), [
    '70-371 is used here for Business Electives, which may not also count toward another program, and it also counts '
    + 'toward your IS major. Use another course here or confirm with your advisor.']);
});

test('checkMinorDoubleCounting: a course another minor uses is shared too', () => {
  const def = mnDef({ text: 'Up to 1 course may double count', max_with_major: 1 },
    [{ id: 'survey', name: 'Survey Courses' }, { id: 'electives', name: 'Electives' }]);
  const progress = { assigned: new Map([['85-110', 'survey'], ['85-130', 'electives'], ['85-150', 'electives']]) };
  const check = checkMinorDoubleCounting(def, progress, {
    majorCode: 'CS',
    majorKindOf: c => (c === '85-130' ? 'degree' : null),
    otherMinors: [{ name: 'Neuroscience', assigned: new Map([['85-110', 'electives']]) }, { name: 'Arabic Studies', assigned: new Map() }],
  });
  assertEqual(check.counted.map(s => [s.code, s.withMajor, s.withMinors]), [['85-110', false, ['Neuroscience']], ['85-130', true, []]]);
  assertTrue(check.over);
  assertTrue(minorDoubleCountWarnings(check, def, 'CS')[0].startsWith('2 courses you marked count toward this minor and toward your CS major or another minor (85-110 and 85-130). At most 1 may.'));
});

test('checkMinorDoubleCounting: Gen Ed overlap counts only when the file does not exempt it; limit 0 and by_major', () => {
  const strict = mnDef({ text: 'x', max_with_major: 0, gen_ed_exempt: false }, [{ id: 'core', name: 'Core' }]);
  const progress = { assigned: new Map([['85-110', 'core']]) };
  const check = checkMinorDoubleCounting(strict, progress, { majorCode: 'CS', majorKindOf: () => 'gened' });
  assertTrue(check.over);
  assertTrue(minorDoubleCountWarnings(check, strict, 'CS')[0].startsWith('1 course you marked counts toward this minor and toward your CS major or another minor (85-110). None may.'));

  const econ = mnDef(MN_ECON_DC, MN_ECON_CATS);
  const used = { assigned: new Map([['21-120', 'math'], ['36-200', 'quant---statistics'], ['73-352', 'advanced']]) };
  const forCS = checkMinorDoubleCounting(econ, used, { majorCode: 'CS', majorKindOf: () => 'degree' });
  assertEqual(forCS.counted, []);
  assertEqual(forCS.blocked.map(s => s.code), ['73-352']);
  assertEqual(forCS.shared.filter(s => s.free).map(s => s.code), ['21-120', '36-200'], 'a part counts as its category');
  const forBA = checkMinorDoubleCounting(econ, used, { majorCode: 'BA', majorKindOf: () => 'degree' });
  assertEqual(forBA.blocked, []);
  assertFalse(forBA.over);
});

test('plainDataText and joinWithAnd: data strings without dash punctuation, plain lists', () => {
  assertEqual(plainDataText('Qatar - Minor in Economics - EY2020+'), 'Qatar, Minor in Economics, EY2020+');
  assertEqual(plainDataText('EY23-25 Doha Minor Psychology'), 'EY23-25 Doha Minor Psychology');
  assertEqual(plainDataText(null), '');
  assertEqual([joinWithAnd([]), joinWithAnd(['A']), joinWithAnd(['A', 'B']), joinWithAnd(['A', 'B', 'C'])],
    ['', 'A', 'A and B', 'A, B and C']);
  assertTrue(pathInCategories('quant---statistics', ['statistics']));
  assertFalse(pathInCategories('quant---data_science', ['statistics']));
  assertFalse(pathInCategories('', ['x']));
});

test('minorSourceKind: a catalog page, an official audit file or no source', () => {
  assertEqual(minorSourceKind({ source_file: 'backend/data/sources/catalog-2026-27/minors/product-management-minor.html' }), 'catalog');
  assertEqual(minorSourceKind({ source_file: 'cmu_minor_psychology.json' }), 'audit');
  assertEqual(minorSourceKind({ source_file: null }), null);
  assertEqual(minorSourceKind(null), null);
});
