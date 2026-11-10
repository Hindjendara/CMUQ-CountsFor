// Admin edits in js/data.js: what a course counts for as per program changes
// ({ add, remove }) on the catalog, minor category edits, the category pick
// list, and the minor settings. Runs in the browser (tests/test.html) and in
// Node (scripts/run-data-tests.js). Wrapped in a function so its names stay
// out of the scope the other suites share.
(function () {
  const CORE = 'BS in Computer Science---Computer Science---Computer Science Core';
  const HA = 'GenEd---Humanities and Arts---C. Humanities and Arts Electives';
  const SCI = 'GenEd---Science and Engineering';
  const AI_SCS = 'BS in Artificial Intelligence---School of Computer Science Electives';
  const OLD = 'BS in Computer Science---Mathematics and Probability---Calculus';

  const row = (requirement, major) => ({ requirement, type: requirement.startsWith('GenEd---'), major });
  const paths = rows => (rows || []).map(r => r.requirement).sort();

  function catalog() {
    return [
      { course_code: '15-122', course_name: 'Imperative Computation', units: 12,
        requirements: { CS: [row(CORE, 'CS'), row(SCI, 'CS')], IS: [], BA: [], BS: [], AI: [row(AI_SCS, 'AI'), row(SCI, 'AI')] } },
      { course_code: '02-261', course_name: 'Quantitative Cell Biology', units: 9,
        requirements: { CS: [row(SCI, 'CS')], IS: [], BA: [], BS: [row('BS in Biological Sciences---Electives', 'BS')], AI: [row(SCI, 'AI'), row(AI_SCS, 'AI')] } },
      { course_code: '85-110', course_name: 'Cognitive Psychology', units: 9, requirements: { CS: [], IS: [], BA: [], BS: [], AI: [] } },
    ];
  }

  test('applyProgramEdit: a legacy list replaces the rows and its old flags are ignored', () => {
    const legacy = [
      { requirement: OLD, type: false, major: 'CS', earlier: true, earlier_reason: 'older degree version' },
      { requirement: OLD, type: false },
      { requirement: HA, type: false },
    ];
    assertEqual(applyProgramEdit([row(CORE, 'CS')], legacy, 'CS'), [row(OLD, 'CS'), { requirement: HA, type: true, major: 'CS' }],
      'deduplicated, Gen Ed flag from the root, no earlier flag');
  });

  test('applyProgramEdit: remove, add, an add of a listed path, and no edit', () => {
    const base = [row(CORE, 'CS'), row(SCI, 'CS')];
    const out = applyProgramEdit(base, { add: [{ requirement: HA, type: false }, { requirement: SCI }], remove: [CORE] }, 'CS');
    assertEqual(out.map(r => r.requirement), [SCI, HA]);
    assertEqual(out[1], row(HA, 'CS'));
    assertEqual(applyProgramEdit(base, { add: ['GenEd---Foundations---Data Analysis'] }, 'CS').length, 3, 'a bare path works too');
    const copy = applyProgramEdit(base, null, 'CS');
    assertEqual(copy, base);
    assertFalse(copy[0] === base[0], 'rows are copied');
    assertEqual(applyProgramEdit(undefined, { add: [AI_SCS] }, 'AI'), [row(AI_SCS, 'AI')]);
  });

  test('programEditDelta: the smallest change, null for the same paths, and a round trip', () => {
    const base = [row(CORE, 'CS'), row(SCI, 'CS')];
    assertEqual(programEditDelta(base, [row(SCI, 'CS'), row(CORE, 'CS')]), null, 'order does not matter');
    assertEqual(programEditDelta(base, [row(SCI, 'CS'), { requirement: HA, type: false }]),
      { add: [{ requirement: HA, type: true }], remove: [CORE] });
    assertEqual(programEditDelta([], [row(HA, 'IS'), row(HA, 'IS')]), { add: [{ requirement: HA, type: true }], remove: [] });
    const drafts = [[], [row(SCI, 'CS')], [row(HA, 'CS'), row(CORE, 'CS')], [row(OLD, 'CS'), row(SCI, 'CS'), row(CORE, 'CS')]];
    for (const draft of drafts) {
      assertEqual(paths(applyProgramEdit(base, programEditDelta(base, draft), 'CS')), paths(draft), JSON.stringify(paths(draft)));
    }
  });

  test('sameRequirementEdit: by paths, a legacy list never matches', () => {
    assertTrue(sameRequirementEdit({ add: [row(HA, 'CS')], remove: [CORE] }, { add: [{ requirement: HA, type: true }], remove: [CORE] }));
    assertFalse(sameRequirementEdit({ add: [], remove: [CORE] }, { add: [], remove: [SCI] }));
    assertFalse(sameRequirementEdit([row(CORE, 'CS')], { add: [row(CORE, 'CS')], remove: [] }));
    assertTrue(sameRequirementEdit(null, undefined));
    assertTrue(sameRequirementEdit({ add: ['survey'], remove: [] }, { add: ['survey'] }), 'minor paths');
  });

  test('applyCourseOverrides: an edit of CS changes CS only; AI and the other programs follow the catalog', () => {
    const courses = catalog();
    const { courses: out } = applyCourseOverrides(courses, [{ course_code: '15-122', fields: {}, requirements: {
      CS: { add: [row(HA, 'CS')], remove: [CORE] },
    } }]);
    const c = out.find(x => x.course_code === '15-122');
    assertEqual(paths(c.requirements.CS), [HA, SCI].sort());
    assertEqual(paths(c.requirements.AI), [AI_SCS, SCI].sort(), 'AI rows untouched');
    assertEqual(paths(c._catalog.requirements.CS), [CORE, SCI].sort(), 'the scraped rows are kept for the editor');
    assertEqual(paths(courses[0].requirements.CS), [CORE, SCI].sort(), 'the cached catalog is not changed');
  });

  test('applyCourseOverrides: a legacy four program list keeps the AI rows; {} keeps every row', () => {
    const legacy = { CS: [row(OLD, 'CS')], IS: [], BA: [], BS: [] };
    const { courses: out } = applyCourseOverrides(catalog(), [
      { course_code: '02-261', fields: {}, requirements: legacy },
      { course_code: '15-122', fields: {}, requirements: {} },
    ]);
    const c = out.find(x => x.course_code === '02-261');
    assertEqual(paths(c.requirements.CS), [OLD]);
    assertEqual(c.requirements.BS, [], 'a legacy list replaces its own program');
    assertEqual(paths(c.requirements.AI), [AI_SCS, SCI].sort(), 'no AI key: AI keeps its catalog rows');
    const k = out.find(x => x.course_code === '15-122');
    assertEqual(paths(k.requirements.CS), [CORE, SCI].sort());
    assertFalse('requirements' in k._catalog, 'an empty map is no requirement edit');
  });

  test('applyCourseOverrides: minor keys go to _minorEdits, never into requirements', () => {
    const courses = catalog();
    const { courses: out } = applyCourseOverrides(courses, [{ course_code: '85-110', fields: {}, requirements: {
      'MINOR:psychology': { add: ['survey'], remove: ['advanced'] },
      'MINOR:history': ['old shape'],
    } }]);
    const c = out.find(x => x.course_code === '85-110');
    assertEqual(c._minorEdits, { psychology: { add: ['survey'], remove: ['advanced'] } });
    assertFalse(Object.keys(c.requirements).some(k => k.startsWith('MINOR:')));
    assertEqual(Object.keys(c.requirements).sort(), MAJOR_ORDER.slice().sort());
    const again = applyCourseOverrides(courses, []).courses.find(x => x.course_code === '85-110');
    assertFalse('_minorEdits' in again, 'a reload without the edit starts clean');
  });

  test('knownRequirementPaths and parseRequirementBuckets: the bucket file adds empty buckets', () => {
    const buckets = parseRequirementBuckets({ CS: [CORE, 'BS in Computer Science---Free Electives'], XX: ['a---b'] });
    assertEqual(buckets, { CS: [CORE, 'BS in Computer Science---Free Electives'] });
    const known = knownRequirementPaths(catalog(), buckets);
    assertEqual([...known.CS.keys()], [CORE, 'BS in Computer Science---Free Electives', SCI], 'bucket order first, then the rows');
    assertEqual(known.CS.get(SCI), true);
    assertEqual(known.CS.get(CORE), false);
    assertTrue(known.AI.has(AI_SCS));
    assertEqual([...knownRequirementPaths(catalog()).CS.keys()], [CORE, SCI], 'no file: the rows only');
    // Headings of the file are left out, unless catalog rows use them (GenEd---Science and Engineering).
    const withHeadings = knownRequirementPaths(catalog(), { CS: [
      'BS in Computer Science---Computer Science', CORE, SCI, SCI + '---Laboratory Requirement', 'GenEd---Humanities and Arts', HA,
    ] });
    assertEqual([...withHeadings.CS.keys()], [CORE, SCI, SCI + '---Laboratory Requirement', HA]);
    assertFalse(withHeadings.CS.has('BS in Computer Science---Computer Science'), 'an old bucket name that is now a heading stays unknown');
    assertEqual(parseRequirementBuckets({ programs: { AI: [{ path: AI_SCS }, { requirement: AI_SCS }] } }), { AI: [AI_SCS] });
    assertEqual(parseRequirementBuckets({ description: 'x', CS: { [CORE]: {} } }), { CS: [CORE] });
    for (const bad of [null, 'text', [], {}, { CS: ['no separator'] }]) assertEqual(parseRequirementBuckets(bad), null, JSON.stringify(bad));
  });

  test('requirementPathRootOk: GenEd or the program degree root, then at least one more part', () => {
    assertTrue(requirementPathRootOk('CS', CORE));
    assertTrue(requirementPathRootOk('AI', HA));
    assertTrue(requirementPathRootOk('AI', AI_SCS));
    assertFalse(requirementPathRootOk('CS', AI_SCS), 'another major');
    assertFalse(requirementPathRootOk('CS', 'GenEd'), 'one part');
    assertFalse(requirementPathRootOk('CS', 'GenEd---'), 'empty part');
    assertEqual(DEGREE_ROOTS.BS, 'BS in Biological Sciences');
  });

  // A small Psychology minor in the shape of data/minors.json.
  const PSYCH = {
    name: 'Psychology', total_units: 72,
    double_count: { text: 'Courses may double count without any limit', max_with_major: null, max_with_other_minors: null,
      gen_ed_exempt: true, no_limit_categories: [], no_sharing_categories: [], by_major: {}, notes: [] },
    categories: [
      { id: 'survey', name: 'Survey Courses', rule: { type: 'pick', n: 2 }, courses: ['85-110', '85-130'], select: null, children: [] },
      { id: 'statistics', name: 'Statistics', rule: { type: 'take_all' }, courses: [], children: [
        { id: 'intro_stats', name: 'Introductory Statistics', rule: { type: 'pick', n: 1 }, courses: ['36-200'], children: [] },
      ] },
      { id: 'elective', name: 'Psychology Elective', rule: { type: 'min_units', units: 9 }, courses: [], children: [],
        select: { prefixes: ['85'], min_number: 0, max_number: 999, exclude: [], exclude_ranges: [] } },
    ],
  };

  function minorCatalog() {
    const c = (code, extra) => Object.assign({ course_code: code, course_name: 'Course ' + code, units: 9, requirements: {} }, extra || {});
    return [c('85-110'), c('85-130'), c('85-211'), c('36-200'), c('15-122'), c('70-207'), c('99-999', { qatar_only: true, offerings: [] })];
  }

  test('minorLeafCategories and minorFileCategories: the categories that hold courses, and those that take a course by the file', () => {
    assertEqual(minorLeafCategories(PSYCH), [
      { path: 'survey', id: 'survey', label: 'Survey Courses', pathLabel: 'Survey Courses' },
      { path: 'statistics---intro_stats', id: 'intro_stats', label: 'Introductory Statistics', pathLabel: 'Statistics › Introductory Statistics' },
      { path: 'elective', id: 'elective', label: 'Psychology Elective', pathLabel: 'Psychology Elective' },
    ]);
    const course = code => ({ course_code: code, units: 9 });
    assertEqual(minorFileCategories(PSYCH, course('85-110')), ['survey', 'elective'], 'listed and matched by the select rule');
    assertEqual(minorFileCategories(PSYCH, course('36-200')), ['statistics---intro_stats']);
    assertEqual(minorFileCategories(PSYCH, course('15-122')), []);
    assertEqual(minorFileCategories(null, course('85-110')), []);
  });

  test('buildMinorTree with edits: additions, removals of a listed and a matched course, a hidden course stays out', () => {
    const courses = minorCatalog();
    const index = buildCourseIndex(courses);
    const edits = new Map([
      ['15-122', { add: new Set(['survey']), remove: new Set() }],
      ['85-130', { add: new Set(), remove: new Set(['survey']) }],
      ['85-211', { add: new Set(), remove: new Set(['elective']) }],
      ['99-999', { add: new Set(['survey']), remove: new Set() }],
      ['70-207', { add: new Set(['statistics---intro_stats']), remove: new Set() }],
    ]);
    const tree = buildMinorTree('psychology', PSYCH, courses, index, edits);
    const node = p => findTreeNode(tree, p);
    assertEqual(node('survey').courses.map(c => c.code), ['15-122', '85-110']);
    assertEqual(node('survey').adminAdded, ['15-122'], 'the hidden 99-999 is not added');
    assertEqual(node('survey').adminRemoved, ['85-130']);
    assertEqual(node('elective').courses.map(c => c.code), ['85-110', '85-130'], '85-211 removed from the select rule');
    assertEqual(node('elective').adminRemoved, ['85-211']);
    assertEqual(node('statistics---intro_stats').courses.map(c => c.code), ['36-200', '70-207']);
    const plain = buildMinorTree('psychology', PSYCH, courses, index);
    assertEqual(findTreeNode(plain, 'survey').courses.map(c => c.code), ['85-110', '85-130']);
    assertEqual(findTreeNode(plain, 'survey').adminAdded, []);
  });

  test('buildMinorIndex: course _minorEdits reach eligible and courseCountsForMinor', () => {
    const courses = minorCatalog();
    courses[4] = Object.assign({}, courses[4], { _minorEdits: { psychology: { add: ['survey'], remove: [] } } });
    courses[0] = Object.assign({}, courses[0], { _minorEdits: { psychology: { add: [], remove: ['survey', 'elective'] } } });
    const edits = collectMinorEdits(courses);
    assertEqual([...edits.get('psychology').keys()].sort(), ['15-122', '85-110']);
    const index = buildMinorIndex({ minors: { psychology: PSYCH } }, courses, buildCourseIndex(courses));
    const m = index.byCode.psychology;
    assertEqual(m.eligible.get('15-122'), ['survey']);
    assertFalse(m.eligible.has('85-110'), 'removed from both categories');
    assertTrue(courseCountsForMinor(courses[4], 'psychology', index));
    assertFalse(courseCountsForMinor(courses[0], 'psychology', index));
  });

  test('applyMinorOverrides: settings on a copy, with the file values kept', () => {
    const data = { minors: { psychology: PSYCH, other: { name: 'Other', double_count: { max_with_major: 2, max_with_other_minors: 2 } } } };
    const out = applyMinorOverrides(data, [
      { minor_code: 'psychology', fields: { total_units: 63, max_with_major: 1, admin_note: 'Ask your advisor.' } },
      { minor_code: 'missing', fields: { total_units: 1 } },
    ]);
    const def = out.minors.psychology;
    assertEqual([def.total_units, def.double_count.max_with_major, def.double_count.max_with_other_minors, def.admin_note], [63, 1, null, 'Ask your advisor.']);
    assertEqual(def._file, { total_units: 72, max_with_major: null });
    assertTrue(def.double_count.edited);
    assertEqual(PSYCH.total_units, 72, 'the file object is not changed');
    assertFalse('edited' in PSYCH.double_count);
    assertTrue(out.minors.other === data.minors.other, 'a minor without an edit is the same object');
    assertTrue(applyMinorOverrides(data, []) === data);
    assertEqual(applyMinorOverrides(null, [{ minor_code: 'x', fields: {} }]), null);
  });

  test('double counting with limits set on the admin page: the major and other minors apart', () => {
    const def = applyMinorOverrides({ minors: { psychology: PSYCH } },
      [{ minor_code: 'psychology', fields: { max_with_major: 1 } }]).minors.psychology;
    const rules = minorDoubleCountRules(def, 'CS');
    assertEqual([rules.limit, rules.minorLimit, rules.separate, rules.known], [1, null, true, true]);
    assertEqual(minorDoubleCountLimitText(def, 'CS'),
      'At most 1 course may also count toward your major. Courses may also count toward another minor without a limit.');

    const both = applyMinorOverrides({ minors: { psychology: PSYCH } },
      [{ minor_code: 'psychology', fields: { max_with_major: 2, max_with_other_minors: 0 } }]).minors.psychology;
    assertEqual([minorDoubleCountRules(both, 'CS').limit, minorDoubleCountRules(both, 'CS').minorLimit], [2, 0]);
    assertEqual(minorDoubleCountLimitText(both, null, "a student's"),
      "At most 2 courses may also count toward a student's major. No course may also count toward another minor.");

    const same = applyMinorOverrides({ minors: { psychology: PSYCH } },
      [{ minor_code: 'psychology', fields: { max_with_major: 0, max_with_other_minors: 0 } }]).minors.psychology;
    assertFalse(minorDoubleCountRules(same).separate, 'equal limits read as one limit');
    assertEqual(minorDoubleCountLimitText(same, 'CS'), 'No course may also count toward your major or another minor.');
  });
})();
