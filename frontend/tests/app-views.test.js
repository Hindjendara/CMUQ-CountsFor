// View switching in js/app.js: going back to the home view must write the home
// HTML into the #leftBody that is on screen. renderShell() replaces all of #app,
// so an element captured before it is detached (the old blank main panel bug).
//
// Node only: it runs the real js/app.js (with utils.js, data.js and profile.js)
// in a vm context with a tiny fake DOM, so scripts/run-data-tests.js loads it
// with require() and tests/test.html does not include it.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP_SOURCES = ['js/utils.js', 'js/data.js', 'js/profile.js', 'js/app.js'];

function fakeElement(id) {
  return {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    scrollTop: 0,
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

// #app rebuilds its child elements from the id="..." attributes of whatever
// HTML is assigned to it, so every renderShell() detaches the old #leftBody
// and creates a new one, as a browser does.
function fakeDocument() {
  const live = new Map();
  const app = fakeElement('app');
  let appHtml = '';
  Object.defineProperty(app, 'innerHTML', {
    get() { return appHtml; },
    set(html) {
      appHtml = String(html);
      for (const id of Array.from(live.keys())) if (id !== 'app') live.delete(id);
      for (const m of appHtml.matchAll(/\sid="([^"]+)"/g)) live.set(m[1], fakeElement(m[1]));
    },
  });
  live.set('app', app);
  return {
    live,
    documentElement: fakeElement('html'),
    body: fakeElement('body'),
    readyState: 'complete',
    getElementById(id) { return live.get(id) || null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement(tag) { return fakeElement(tag); },
    addEventListener() {},
    removeEventListener() {},
  };
}

class MemoryStorage {
  constructor() { this._data = new Map(); }
  getItem(k) { return this._data.has(String(k)) ? this._data.get(String(k)) : null; }
  setItem(k, v) { this._data.set(String(k), String(v)); }
  removeItem(k) { this._data.delete(String(k)); }
  clear() { this._data.clear(); }
}

const HOME_MARKER = '<div class="home-test-marker">home</div>';

// Fresh App in its own context. The network and heavy renderers are stubbed;
// renderShell(), renderLeftEmpty(), reset() and setGuestRole() are the real code.
// With { realTree: true } the requirement map (renderTree) is the real code too.
function loadApp(opts = {}) {
  const document = fakeDocument();
  const ctx = {
    console,
    document,
    window: { innerWidth: 1280, matchMedia: () => ({ matches: false }), addEventListener() {} },
    location: { href: 'app.html', search: '', pathname: '/app.html' },
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    setTimeout: () => 0,
    clearTimeout() {},
  };
  vm.createContext(ctx);
  for (const file of APP_SOURCES) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  ctx.showToast = () => {};
  const App = vm.runInContext('App', ctx);
  App._renderHome = () => HOME_MARKER;
  App._loadPopularCourses = () => {};
  App._loadMyFlagsSummary = () => {};
  App._loadStudentFlagsSummary = () => {};
  App.bindGlobalEvents = () => {};
  if (!opts.realTree) App.renderTree = () => {};
  App.renderCourseCard = (course) => {
    const el = document.getElementById('leftBody');
    if (el) el.innerHTML = '<div class="course-card">' + course.course_code + '</div>';
  };
  let shellRenders = 0;
  const realRenderShell = App.renderShell;
  App.renderShell = function () { shellRenders++; return realRenderShell.call(this); };
  App.profile = { role: 'student', primary: 'CS', secondary: null, scope: null };
  App.renderShell();
  shellRenders = 0;
  return { App, document, ctx, shellRenders: () => shellRenders };
}

function leftBodyHtml(document) {
  const el = document.getElementById('leftBody');
  return el ? el.innerHTML : null;
}

const COURSE = { course_code: '15-112', course_name: 'Fundamentals of Programming' };

test('app views: renderLeftEmpty with a course open writes home into the live #leftBody', () => {
  const { App, document, shellRenders } = loadApp();
  App._selectCourse(COURSE);
  assertTrue(leftBodyHtml(document).includes('15-112'), 'course card should be on screen first');
  App.renderLeftEmpty();
  assertEqual(shellRenders(), 2, 'one shell render to open the course, one to drop its search header');
  assertEqual(App.selectedCourse, null);
  assertEqual(leftBodyHtml(document), HOME_MARKER);
});

test('app views: renderLeftEmpty from the schedule view writes home into the live #leftBody', () => {
  const { App, document } = loadApp();
  App._homeView = 'plan';
  App._planDetailId = 'p1';
  App.renderLeftEmpty();
  assertEqual(App._homeView, 'home');
  assertEqual(App._planDetailId, null);
  assertEqual(leftBodyHtml(document), HOME_MARKER);
});

test('app views: renderLeftEmpty on the home view does not re-render the shell', () => {
  const { App, document, shellRenders } = loadApp();
  const before = document.getElementById('leftBody');
  App.renderLeftEmpty();
  assertEqual(shellRenders(), 0);
  assertTrue(document.getElementById('leftBody') === before, 'same #leftBody element');
  assertEqual(leftBodyHtml(document), HOME_MARKER);
});

test('app views: renderLeftEmpty without the main shell (onboarding) changes nothing', () => {
  const { App, document, shellRenders } = loadApp();
  App.selectedCourse = COURSE;
  document.getElementById('app').innerHTML = '<div id="onboarding"></div>';
  App.renderLeftEmpty();
  assertEqual(shellRenders(), 0, 'must not replace the onboarding screen');
  assertEqual(App.selectedCourse, COURSE);
  assertEqual(document.getElementById('app').innerHTML, '<div id="onboarding"></div>');
});

test('app views: reset() from the schedule view shows home', () => {
  const { App, document } = loadApp();
  App._homeView = 'plan';
  App.reset();
  assertEqual(leftBodyHtml(document), HOME_MARKER);
});

test('app views: guest view switch with a course open shows home in both directions', () => {
  const { App, document } = loadApp();
  App.isGuest = true;
  App._refreshSemesterOptions = () => {};
  App._selectCourse(COURSE);
  App.setGuestRole('faculty');
  assertEqual(App.profile.role, 'professor');
  assertEqual(leftBodyHtml(document), HOME_MARKER, 'student to faculty');
  App._selectCourse(COURSE);
  App.setGuestRole('student');
  assertEqual(App.profile.role, 'student');
  assertEqual(leftBodyHtml(document), HOME_MARKER, 'faculty to student');
});

// Admin course editor.
function loadCourseAdmin() {
  const env = loadApp();
  const { App, document, ctx } = env;
  const reqs = () => ({ CS: [], IS: [], BA: [], BS: [] });
  App.courses = [
    { course_code: '85-110', course_name: 'Cognitive Psychology', requirements: reqs(), offered: ['F26'] },
    { course_code: '15-112', course_name: 'Fundamentals of Programming', requirements: reqs(), offered: ['F26'] },
  ];
  App.courseIndex = vm.runInContext('buildCourseIndex', ctx)(App.courses);
  App._archivedCourses = [];
  const content = document.createElement('div');
  content.scrollIntoView = () => {};
  document.live.set('admContent', content);
  App._syncCourseDraft = () => {};
  App._collectPendingCourseReqs = () => {};
  App._setCourseSaving = () => {};
  const notices = [];
  App._courseFormNotice = (msg) => { if (msg) notices.push(msg); };
  const calls = [];
  ctx.apiEditCourse = (key, body) => { calls.push({ key, body }); return new Promise(() => {}); };
  ctx.apiArchiveCourse = (key) => { calls.push({ archive: key }); return new Promise(() => {}); };
  ctx.confirm = () => true;
  return { ...env, notices, calls };
}

test('course editor: a row saves under its own code', () => {
  const { App, notices, calls } = loadCourseAdmin();
  App._openCourseEditor('85-110', false);
  App._courseAdmin.draft.course_name = 'Cognitive Psychology (edited)';
  App._saveCourse();
  assertEqual(notices, []);
  assertEqual(calls.length, 1);
  assertEqual(calls[0].key, '85-110');
});

test('course editor: renumbering onto a code already in the catalog is a clash', () => {
  const { App, notices, calls } = loadCourseAdmin();
  App._openCourseEditor('15-112', false);
  App._courseAdmin.draft.course_code = '85-110';
  App._saveCourse();
  assertTrue(notices.some(n => n.includes('85-110 is already in the catalog')), notices.join(' | '));
  assertEqual(calls, []);
});

// ── Minors in the requirement map ────────────────────────────
// The real renderTree() with a small catalog and the real data/minors.json.
const MINORS_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'minors.json'), 'utf8'));

function minorsCatalog() {
  const course = (code, name, units, reqs) => {
    const requirements = { CS: [], IS: [], BA: [], BS: [] };
    for (const [major, requirement, type] of reqs || []) requirements[major].push({ requirement, type: !!type, major });
    return { course_code: code, course_name: name, units, requirements, offered: ['F26'] };
  };
  return [
    course('15-112', 'Fundamentals of Programming and Computer Science', 12,
      [['CS', 'Computer Science---Intro Programming'], ['IS', 'Information Systems Core---Programming']]),
    course('15-122', 'Principles of Imperative Computation', 12,
      [['CS', 'Computer Science---Imperative'], ['IS', 'Information Systems Core---Data Structures']]),
    course('15-150', 'Principles of Functional Programming', 12,
      [['CS', 'Computer Science---Functional'], ['IS', 'Information Systems Breadth---Functional']]),
    course('15-210', 'Parallel and Sequential Data Structures and Algorithms', 12,
      [['CS', 'Computer Science---Algorithms'], ['IS', 'Information Systems Breadth---Algorithms']]),
    course('21-127', 'Concepts of Mathematics', 12, [['CS', 'Mathematics and Probability---Mathematical Foundations for CS']]),
    course('21-241', 'Matrices and Linear Transformations', 11, [['CS', 'Mathematics and Probability---Matrix/Linear Algebra']]),
    course('21-228', 'Discrete Mathematics', 9, []),
    course('21-301', 'Combinatorics', 9, []),
    course('36-200', 'Reasoning with Data', 9, []),
    course('85-110', 'Cognitive Psychology', 9,
      [['CS', 'GenEd---Category 1: Cognition---Cognition, Choice, and Behavior (CS, CB, & HCI)', true]]),
    course('85-130', 'Social Psychology', 9, []),
    course('85-310', 'Research Methods in Cognitive Psychology', 9, []),
    course('85-352', 'Evolutionary Psychology', 9, []),
    course('03-121', 'Modern Biology', 9, []),
    course('03-362', 'Cellular Neuroscience', 9, []),
    course('70-381', 'Marketing I', 9, []),
    course('70-452', 'Introduction to Product Management', 9, []),
    course('73-102', 'Principles of Microeconomics', 9, []),
    course('70-389', 'Design Thinking with AI', 9, []),
    course('70-385', 'Consumer Behavior', 9, []),
  ];
}

function loadMinorsApp(profile, extra = {}) {
  const env = loadApp({ realTree: true });
  const { App } = env;
  Object.assign(App, extra);
  App.profile = profile;
  App._buildCatalog(minorsCatalog(), [], MINORS_JSON);
  App.activeSemester = 'F26';
  App.layoutMode = 'split';
  if (profile.primary && profile.primary !== 'AS') App.activeMajor = profile.primary;
  App.autoExpandFirstLevel(App.activeMajor);  // as loadData() does
  App.renderShell();
  return env;
}

const treeHtml = document => document.getElementById('rightBody').innerHTML;
const STUDENT = (primary, minors) => ({ role: 'student', primary, secondary: minors[0] || null, secondaries: minors, scope: null });

test('minors: a student sees each chosen minor after the major, with its limit and status controls', () => {
  const { App, document } = loadMinorsApp(STUDENT('CS', ['psychology', 'math']));
  App.renderTree();
  const html = treeHtml(document);
  assertTrue(html.includes('class="mn-programs"'), 'the programs bar');
  const iMajor = html.indexOf('data-tree-major="CS"');
  const iPsych = html.indexOf('id="mn-section-psychology"');
  const iMath = html.indexOf('id="mn-section-math"');
  assertTrue(iMajor >= 0 && iPsych > iMajor && iMath > iPsych, 'the major first, then the minors in the chosen order');
  assertTrue(html.includes('Psychology minor') && html.includes('Mathematical Sciences minor'));
  assertTrue(html.includes('Courses may also count toward your major or another minor without a limit.'), 'Psychology limit');
  assertTrue(html.includes('without a limit, except courses used for Mathematical Sciences Electives.'), 'Math limit');
  assertTrue(html.includes('Audit rule: Courses may double count without any limit with other programs unless specified otherwise.'));
  assertTrue(html.includes('data-tree-major="minor:psychology"'), 'minor categories render as tree cards');
  assertTrue(html.includes('class="cs-btn cs-none"'), 'status controls');
  assertTrue(html.includes('Also counts for Psychology minor'), 'the major tree names the minor');
  assertTrue(html.includes('Also counts for CS Gen Ed'), 'the minor tree names the major');
  assertTrue(html.includes('5 requirements. Mark the courses you took to see your progress.'));
});

test('minors: marking two courses completed updates the minor and is saved in cf_course_status', () => {
  const { App, document, ctx } = loadMinorsApp(STUDENT('CS', ['psychology', 'math']));
  App.renderTree();
  App.cycleCourseStatus('85-110');
  App.cycleCourseStatus('85-110');
  App.setCourseStatus('85-130', 'completed');
  assertEqual(JSON.parse(ctx.localStorage.getItem('cf_course_status')), { '85-110': 'completed', '85-130': 'completed' });
  const html = treeHtml(document);
  assertTrue(html.includes('1 of 5 requirements done, 4 left'), 'Psychology summary');
  assertTrue(html.includes('<span class="mn-st mn-st-done"'), 'Survey Courses is done');
  assertTrue(html.includes('class="cs-btn cs-done"'));
  assertTrue(html.includes('1 done'), 'the CS category with 85-110 counts it');
  App.setCourseStatus('85-130', '');
  assertEqual(JSON.parse(ctx.localStorage.getItem('cf_course_status')), { '85-110': 'completed' });
});

test('minors: shared courses over the double counting limit show a warning', () => {
  const { App, document } = loadMinorsApp(STUDENT('IS', ['cs']));
  for (const code of ['15-112', '15-122', '15-150', '15-210']) App.setCourseStatus(code, 'completed');
  const html = treeHtml(document);
  assertTrue(html.includes('At most 2 courses may also count toward your major or another minor. Courses used for Prerequisites do not count toward this limit.'));
  assertTrue(html.includes('3 courses you marked count toward this minor and toward your IS major or another minor (15-122, 15-150 and 15-210). At most 2 may.'));
  assertTrue(html.includes('class="mn-warn"'));
});

test('minors: the Minors tab lists every minor and shows the chosen one in full (faculty view)', () => {
  const { App, document } = loadMinorsApp({ role: 'professor', primary: 'AS', secondary: null, scope: null });
  const tabs = App._renderMajorTabs();
  assertTrue(tabs.includes('data-major="MINORS"') && tabs.includes('All 17 minors'));
  App.switchMajor('MINORS');
  let html = treeHtml(document);
  assertEqual((html.match(/data-action="minor-browse"/g) || []).length, 17);
  assertTrue(html.includes('Choose a minor to see its full requirements.'));
  App.browseMinor('neuroscience');
  html = treeHtml(document);
  assertTrue(html.includes('id="mn-section-neuroscience"'));
  for (const name of ['Required Courses', 'Modern Biology', 'Neuroscience Core', 'Neurobiology Electives']) {
    assertTrue(html.includes(name), name);
  }
  assertTrue(html.includes('data-course-code="03-121"') && html.includes('data-course-code="03-362"'));
  assertTrue(html.includes('At most 2 courses may also count toward a student&#039;s major or another minor.'));
  assertFalse(html.includes('cs-btn'), 'no status controls for faculty');
  assertFalse(html.includes('mn-programs'), 'no programs bar for faculty');
});

test('minors: Product Management shows its catalog requirements and the catalog double counting rule', () => {
  const { App, document } = loadMinorsApp(STUDENT('CS', ['product']));
  App.renderTree();
  const html = treeHtml(document);
  assertTrue(html.includes('id="mn-section-product"') && html.includes('Product Management minor'));
  assertTrue(html.includes('Minor in Product Management'));
  assertTrue(html.includes('Version: 2026-2027 Catalog'));
  for (const name of ['Required', 'Marketing I', 'Introduction to Product Management', 'Principles of Microeconomics',
    'Course in Design Thinking', 'Marketing Course']) {
    assertTrue(html.includes(name), name);
  }
  assertTrue(html.includes('data-course-code="70-452"') && html.includes('data-course-code="70-389"'));
  assertTrue(html.includes('At most 1 course may also count toward your major or another minor.'));
  assertTrue(html.includes('Catalog rule: While there are no double counting restrictions between the minor and'));
  assertFalse(html.includes('Audit rule:'), 'the rule comes from the catalog page, not an audit file');
  assertTrue(html.includes('3 requirements. Mark the courses you took to see your progress.'));
});

test('minors: no minor shows a campus note; Product Management is not open to BA majors', () => {
  const { App, document } = loadMinorsApp({ role: 'professor', primary: 'AS', secondary: null, scope: null });
  App.switchMajor('MINORS');
  for (const code of ['business_analytics', 'finance', 'sociology', 'history', 'tech_entre', 'product']) {
    App.browseMinor(code);
    const html = treeHtml(document);
    assertTrue(html.includes(`id="mn-section-${code}"`), code);
    assertFalse(/Pittsburgh version|Campus not stated|mn-pill-campus/i.test(html), code);
  }
  const ba = loadMinorsApp(STUDENT('BA', []), { isGuest: true });
  ba.App._refreshSemesterOptions = () => {};
  ba.App.addStudentMinor('product');
  assertEqual(ba.App.profile.secondaries, [], 'product is not open to BA majors');
  ba.App.switchMajor('MINORS');
  ba.App.browseMinor('product');
  assertTrue(treeHtml(ba.document).includes('Not open to BA majors'));
});

test('minors: a guest student adds and removes minors in the tree and keeps them across a view switch', () => {
  const { App, document, ctx } = loadMinorsApp(STUDENT('CS', []), { isGuest: true });
  App._refreshSemesterOptions = () => {};
  App.addStudentMinor('psychology');
  App.addStudentMinor('math');
  App.addStudentMinor('cs');  // not open to CS majors
  assertEqual(App.profile.secondaries, ['psychology', 'math']);
  assertEqual(JSON.parse(ctx.localStorage.getItem('cf_minors')), ['psychology', 'math'], 'saved on this device');
  App.setGuestRole('faculty');
  assertEqual(App.profile.role, 'professor');
  App.setGuestRole('student');
  assertEqual([App.profile.primary, App.profile.secondaries], ['CS', ['psychology', 'math']]);
  App.removeStudentMinor('math');
  assertEqual(App.profile.secondaries, ['psychology']);
  App.addStudentMinor('business');
  App.setStudentMajor('BA');
  assertEqual([App.profile.primary, App.profile.secondaries], ['BA', ['psychology']], 'business is not open to BA majors');
  App.switchMajor('MINORS');
  App.browseMinor('finance');
  assertTrue(treeHtml(document).includes('Not open to BA majors'));
});

test('minors: a signed-in student saves to the account one request at a time, the latest list last', async () => {
  const { App, ctx } = loadMinorsApp(STUDENT('CS', []), { authMode: 'authed' });
  const calls = [];
  const pending = [];
  ctx.apiPatchMe = body => {
    calls.push(JSON.parse(JSON.stringify(body)));
    return new Promise(resolve => pending.push(() => resolve({ ok: true, data: { minor_codes: body.minor_codes } })));
  };
  const ticks = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const first = App.addStudentMinor('psychology');
  const second = App.addStudentMinor('math');
  const third = App.removeStudentMinor('psychology');
  assertEqual(calls, [{ primary_program: 'CS', minor_codes: ['psychology'] }], 'one request in flight');
  pending.shift()();
  await ticks();
  assertEqual(calls.length, 2, 'the changes made meanwhile go in one more request');
  assertEqual(calls[1], { primary_program: 'CS', minor_codes: ['math'] });
  pending.shift()();
  await Promise.all([first, second, third]);
  assertEqual(calls.length, 2);
  assertEqual(App.authedUser.minor_codes, ['math']);
});

test('minors: without minors.json the tree still renders and the minor says why', () => {
  const { App, document } = loadApp({ realTree: true });
  App.profile = STUDENT('CS', ['psychology']);
  App._minorsLoadError = 'HTTP 404';
  App._buildCatalog(minorsCatalog(), [], null);
  App.layoutMode = 'split';
  App.renderShell();
  App.renderTree();
  assertTrue(treeHtml(document).includes('data-tree-major="CS"'));
  assertTrue(treeHtml(document).includes('The minor requirements could not be loaded.'));
  App.switchMajor('MINORS');
  assertTrue(treeHtml(document).includes('The minor requirements could not be loaded.'));
});


// ── Semester picker ──────────────────────────────────────────
// The real loadData() with the network stubbed: the picker lists the catalog's
// semesters and opens on the newest fall or spring with Qatar sections; the
// semester picked last is kept on this device (cf_semester).
function semesterCatalog(...extra) {
  const off = (semester_code, campus) => ({ semester_code, campus, modality: 'In Person', section: 'A', days_times: 'MW 10:00AM-11:20AM' });
  const course = (code, name, path, offerings) => {
    const requirements = { CS: [{ requirement: path, type: false, major: 'CS' }], IS: [], BA: [], BS: [] };
    return { course_code: code, course_name: name, units: 12, requirements, offerings, offered: [...new Set(offerings.map(o => o.semester_code))] };
  };
  return [
    course('15-112', 'Fundamentals of Programming', 'Computer Science---Intro Programming',
      [off('F25', 'Qatar'), off('S26', 'Qatar'), off('M26', 'Pittsburgh'), off('F26', 'Qatar'), off('S27', 'Qatar')]),
    course('15-122', 'Principles of Imperative Computation', 'Computer Science---Imperative', [off('F26', 'Qatar')]),
    ...extra,
  ];
}

async function loadSemesterApp(catalog, saved) {
  const env = loadApp();
  const { App, ctx } = env;
  if (saved !== undefined) ctx.localStorage.setItem('cf_semester', JSON.stringify(saved));
  ctx.fetchAllCourses = async () => JSON.parse(JSON.stringify(catalog));
  ctx.fetchMinors = async () => MINORS_JSON;
  ctx.apiGetCourseOverrides = async () => ({ ok: true, data: { items: [] } });
  await App.loadData();
  return env;
}

const lookupCourseIn = (App, code) => App.courses.find(c => c.course_code === code);

const semesterOptionsShown = document => {
  const html = document.getElementById('semesterSelect').innerHTML;
  return [...html.matchAll(/<option value="([^"]*)"\s*(selected)?\s*>([^<]*)</g)].map(m => (m[2] ? '*' : '') + m[3]);
};

test('semesters: the picker lists the catalog semesters and opens on Spring 2027', async () => {
  const env = loadApp();
  assertTrue(env.document.getElementById('app').innerHTML.includes('Loading semesters'), 'a placeholder until the catalog loads');
  const { App, document } = await loadSemesterApp(semesterCatalog());
  assertEqual(App.activeSemester, 'S27');
  assertEqual(semesterOptionsShown(document),
    ['All semesters', '*Spring 2027', 'Fall 2026', 'Summer 2026', 'Spring 2026', 'Fall 2025']);
  const course = code => lookupCourseIn(App, code);
  assertTrue(App.coursePassesTreeFilter(course('15-112')) && App.coursePassesSearchFilter(course('15-112')));
  assertFalse(App.coursePassesTreeFilter(course('15-122')), 'only offered in Fall 2026');
  assertFalse(App.coursePassesSearchFilter(course('15-122')));
  assertEqual(App._normalizePlanItem({ course_code: '15-112' }).semester_code, 'S27', 'a plan row without a semester');
  assertEqual(App._popularSemester(), 'S27');
});

test('semesters: a picked semester is kept on this device while the catalog has it', async () => {
  const first = await loadSemesterApp(semesterCatalog());
  first.App.setSemester('F26');
  const saved = JSON.parse(first.ctx.localStorage.getItem('cf_semester'));
  assertEqual(saved, { code: 'F26', defaultCode: 'S27' });
  assertTrue(first.App.coursePassesTreeFilter(lookupCourseIn(first.App, '15-122')));

  const again = await loadSemesterApp(semesterCatalog(), saved);
  assertEqual(again.App.activeSemester, 'F26');
  assertEqual(semesterOptionsShown(again.document)[2], '*Fall 2026');

  const all = await loadSemesterApp(semesterCatalog(), { code: 'all', defaultCode: 'S27' });
  assertEqual(all.App.activeSemester, 'all');
  assertEqual(all.App._popularSemester(), 'S27', 'lookups under "All semesters" count for the default');
  assertEqual(all.App._normalizePlanItem({ course_code: '15-112' }).semester_code, '');

  const gone = await loadSemesterApp(semesterCatalog(), { code: 'F24', defaultCode: 'F24' });
  assertEqual(gone.App.activeSemester, 'S27', 'a semester the catalog no longer has');
});

test('semesters: a new semester in the catalog (F27) is listed with no code change and opens once Qatar has sections', async () => {
  const off = campus => ({ semester_code: 'F27', campus, modality: 'In Person', section: 'A' });
  const pitt = { course_code: '15-213', course_name: 'Introduction to Computer Systems', units: 12, requirements: {}, offerings: [off('Pittsburgh')] };
  const saved = { code: 'F26', defaultCode: 'S27' };

  const pittOnly = await loadSemesterApp(semesterCatalog(pitt));
  assertEqual(pittOnly.App.activeSemester, 'S27', 'Pittsburgh sections alone do not move the default');
  assertEqual(semesterOptionsShown(pittOnly.document).slice(0, 3), ['All semesters', 'Fall 2027', '*Spring 2027']);

  const qatar = { ...pitt, course_code: '15-214', offerings: [off('Qatar')] };
  const fresh = await loadSemesterApp(semesterCatalog(pitt, qatar));
  assertEqual(fresh.App.activeSemester, 'F27');
  assertEqual(semesterOptionsShown(fresh.document)[1], '*Fall 2027');
  const returning = await loadSemesterApp(semesterCatalog(pitt, qatar), saved);
  assertEqual(returning.App.activeSemester, 'F27', 'a choice made before Fall 2027 came out gives way to it');
});

test('semesters: when the catalog cannot be loaded the picker stops saying it is loading', async () => {
  const { App, ctx, document } = loadApp();
  ctx.console = { log() {}, warn() {}, error() {} };
  ctx.fetchAllCourses = async () => { throw new Error('offline'); };
  ctx.fetchMinors = async () => MINORS_JSON;
  ctx.apiGetCourseOverrides = async () => ({ ok: true, data: { items: [] } });
  await App.loadData();
  assertEqual(App.activeSemester, 'all');
  assertEqual(semesterOptionsShown(document), ['*All semesters']);
  assertTrue(document.getElementById('leftBody').innerHTML.includes('Failed to load data: offline'));
});
