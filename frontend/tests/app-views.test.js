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
// With { realTree: true } the requirement map (renderTree) is the real code too,
// and with { realCard: true } the course card (renderCourseCard).
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
  // loadData() also reads the admin minor settings; none unless a test sets its own.
  ctx.apiGetMinorOverrides = async () => ({ ok: true, data: { items: [] } });
  const App = vm.runInContext('App', ctx);
  App._renderHome = () => HOME_MARKER;
  App._loadPopularCourses = () => {};
  App._loadMyFlagsSummary = () => {};
  App._loadStudentFlagsSummary = () => {};
  App.bindGlobalEvents = () => {};
  if (!opts.realTree) App.renderTree = () => {};
  if (!opts.realCard) {
    App.renderCourseCard = (course) => {
      const el = document.getElementById('leftBody');
      if (el) el.innerHTML = '<div class="course-card">' + course.course_code + '</div>';
    };
  }
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
// The Minors tab dropdown, and the minor codes it offers in order.
const minorsPickerHtml = html => {
  const start = html.indexOf('id="mnBrowsePick"');
  return start < 0 ? '' : html.slice(start, html.indexOf('</select>', start));
};
const pickerValues = picker => [...picker.matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);

test('minors: a student sees each chosen minor after the major, with its limit and the double counting tags', () => {
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
  assertTrue(html.includes('Also counts for Psychology minor'), 'the major tree names the minor');
  assertTrue(html.includes('Also counts for CS Gen Ed'), 'the minor tree names the major');
});

// The course status feature (round controls on tree rows, status buttons on the
// course card, progress bars, "N of M requirements done" and warnings built
// from marked courses) is gone; a value an older version saved in
// cf_course_status is left in the browser and changes nothing.
test('minors: no status controls, progress, version line or marks based warnings; an old cf_course_status is ignored and kept', () => {
  const saved = JSON.stringify({ '15-112': 'completed', '15-122': 'completed', '15-150': 'completed', '15-210': 'completed', '85-110': 'in_progress' });
  const env = loadApp({ realTree: true, realCard: true });
  const { App, document, ctx } = env;
  ctx.localStorage.setItem('cf_course_status', saved);
  App.profile = STUDENT('IS', ['cs', 'psychology']);
  App._buildCatalog(minorsCatalog(), [], MINORS_JSON);
  App.activeSemester = 'F26';
  App.layoutMode = 'split';
  App.activeMajor = 'IS';
  App.autoExpandFirstLevel('IS');
  App.renderShell();
  App.renderTree();
  let html = treeHtml(document);
  const gone = ['cs-btn', 'data-action="course-status', 'data-status-key', 'tr-leaf-completed', 'tr-leaf-in_progress', 'mn-st',
    'mn-progress', 'mn-bar', 'mn-warn', 'mn-prog-hint', 'mn-version', 'Click the circle', 'requirements done', 'Mark the courses',
    'you marked', 'Counted in', 'Version:', 'Pittsburgh version'];
  assertEqual(gone.filter(t => html.includes(t)), [], 'nothing of the status feature in the tree');
  assertTrue(html.includes('id="mn-section-cs"') && html.includes('id="mn-section-psychology"'));
  assertTrue(html.includes('At most 2 courses may also count toward your major or another minor. Courses used for Prerequisites do not count toward this limit.'),
    'the limit line stays');
  assertTrue(html.includes('Also counts for IS'), 'the minor tree still names the major');
  App.switchMajor('MINORS');
  App.browseMinor('sociology');
  html = treeHtml(document);
  assertEqual(gone.filter(t => html.includes(t)), [], 'nothing of it in the Minors tab');
  assertFalse(/EY2023|Version|Pittsburgh/.test(html), 'no version line, no campus');
  App._selectCourse(App.courses.find(c => c.course_code === '15-122'));
  const card = leftBodyHtml(document);
  assertTrue(card.includes('15-122'));
  assertFalse(/cc-status|Your status|Not taken|course-status/.test(card), 'no status buttons on the course card');
  assertEqual(ctx.localStorage.getItem('cf_course_status'), saved, 'the old value is left alone');
});

test('minors: the tree filters hide a course even when an old cf_course_status marked it', () => {
  const { App, document, ctx } = loadMinorsApp(STUDENT('CS', ['psychology']));
  ctx.localStorage.setItem('cf_course_status', JSON.stringify({ '85-110': 'completed' }));
  App.renderTree();
  assertTrue(treeHtml(document).includes('data-course-code="85-110"'), 'offered in Fall 2026');
  App.activeSemester = 'S27';  // no course of this catalog runs in Spring 2027
  App.renderTree();
  const html = treeHtml(document);
  assertFalse(html.includes('data-course-code="85-110"'), 'a marked course no longer always shows');
  assertTrue(html.includes('id="mn-section-psychology"'), "the minor's requirements still show");
});

test('minors: a course code in a minor note is never split at its hyphen', () => {
  const { App } = loadMinorsApp(STUDENT('CS', []));
  assertEqual(App._minorTextHtml('Take 15-122 first.'), 'Take <span class="mn-code">15-122</span> first.');
});

test('minors: the Minors tab lists every minor and shows the chosen one in full (faculty view)', () => {
  const { App, document } = loadMinorsApp({ role: 'professor', primary: 'AS', secondary: null, scope: null });
  const tabs = App._renderMajorTabs();
  assertTrue(tabs.includes('data-major="MINORS"') && tabs.includes('All 17 minors'));
  App.switchMajor('MINORS');
  let html = treeHtml(document);
  let picker = minorsPickerHtml(html);
  assertEqual(pickerValues(picker).length, 17, 'every minor in the dropdown');
  assertTrue(picker.includes('<option value="" selected disabled>Choose a minor</option>'), 'the placeholder');
  assertFalse(picker.includes('<optgroup'), 'no groups without minors of your own');
  assertTrue(html.includes('Choose a minor to see its full requirements.'));
  App.browseMinor('neuroscience');
  html = treeHtml(document);
  assertTrue(minorsPickerHtml(html).includes('<option value="neuroscience" selected>'), 'the dropdown shows the chosen minor');
  assertFalse(minorsPickerHtml(html).includes('Choose a minor'), 'no placeholder once a minor is chosen');
  assertTrue(html.includes('id="mn-section-neuroscience"'));
  for (const name of ['Required Courses', 'Modern Biology', 'Neuroscience Core', 'Neurobiology Electives']) {
    assertTrue(html.includes(name), name);
  }
  assertTrue(html.includes('data-course-code="03-121"') && html.includes('data-course-code="03-362"'));
  assertTrue(html.includes('At most 2 courses may also count toward a student&#039;s major or another minor.'));
  assertFalse(html.includes('mn-programs'), 'no programs bar for faculty');
});

test('minors: Product Management shows its catalog requirements and the catalog double counting rule', () => {
  const { App, document } = loadMinorsApp(STUDENT('CS', ['product']));
  App.renderTree();
  const html = treeHtml(document);
  assertTrue(html.includes('id="mn-section-product"') && html.includes('Product Management minor'));
  assertFalse(html.includes('Minor in Product Management'), 'the official name only repeats the title');
  assertFalse(html.includes('Version:') || html.includes('2026-2027 Catalog'), 'the version stays in minors.json, unseen');
  for (const name of ['Required', 'Marketing I', 'Introduction to Product Management', 'Principles of Microeconomics',
    'Course in Design Thinking', 'Marketing Course']) {
    assertTrue(html.includes(name), name);
  }
  assertTrue(html.includes('data-course-code="70-452"') && html.includes('data-course-code="70-389"'));
  assertTrue(html.includes('At most 1 course may also count toward your major or another minor.'));
  assertTrue(html.includes('Catalog rule: While there are no double counting restrictions between the minor and'));
  assertFalse(html.includes('Audit rule:'), 'the rule comes from the catalog page, not an audit file');
});

test('minors: no minor shows a campus note; Product Management is not open to BA majors', () => {
  const { App, document } = loadMinorsApp({ role: 'professor', primary: 'AS', secondary: null, scope: null });
  App.switchMajor('MINORS');
  for (const code of ['business_analytics', 'finance', 'sociology', 'history', 'tech_entre', 'product']) {
    App.browseMinor(code);
    const html = treeHtml(document);
    assertTrue(html.includes(`id="mn-section-${code}"`), code);
    assertFalse(/Pittsburgh version|Campus not stated|mn-pill-campus|mn-campus/i.test(html), code);
  }
  const ba = loadMinorsApp(STUDENT('BA', []), { isGuest: true });
  ba.App._refreshSemesterOptions = () => {};
  ba.App.addStudentMinor('product');
  assertEqual(ba.App.profile.secondaries, [], 'product is not open to BA majors');
  ba.App.switchMajor('MINORS');
  ba.App.browseMinor('product');
  assertTrue(treeHtml(ba.document).includes('Not open to BA majors'));
});

test('minors: the Minors tab dropdown lists a student\'s own minors first; the header has the add button or says it is theirs', () => {
  const { App, document } = loadMinorsApp(STUDENT('CS', ['psychology', 'math']));
  App.switchMajor('MINORS');
  App.browseMinor('finance');
  let html = treeHtml(document);
  const picker = minorsPickerHtml(html);
  const values = pickerValues(picker);
  assertEqual(values.length, 17, 'every minor once');
  assertEqual(values.slice(0, 2), ['math', 'psychology'], 'your minors first, by name');
  assertTrue(picker.indexOf('<optgroup label="Your minors">') >= 0
    && picker.indexOf('<optgroup label="Your minors">') < picker.indexOf('<optgroup label="Other minors">'));
  assertTrue(html.includes('data-action="minor-add" data-minor="finance"'), 'Add to my minors');
  assertFalse(/Pittsburgh version|mn-campus/.test(html), 'no campus note');
  App.browseMinor('psychology');
  html = treeHtml(document);
  assertTrue(html.includes('Your minor</span>'));
  assertFalse(html.includes('data-action="minor-add"'), 'no add button on your own minor');
  assertTrue(html.includes('72 units'));
  assertFalse(html.includes('Minor in Psychology'), 'the official name only repeats the title');
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

// ── Schedule planner: a lecture with its sections ────────────
// The real togglePlanSection(), course card and plan views, with a small
// catalog whose offerings are in Schedule of Classes order.
function planRow(semester_code, campus, section, days_times) {
  return { semester_code, campus, section, modality: 'In Person', days_times, instructor: '', location: '' };
}

function planCatalog() {
  const reqs = () => ({ CS: [], IS: [], BA: [], BS: [] });
  const course = (course_code, course_name, units, offerings) =>
    ({ course_code, course_name, units, requirements: reqs(), offered: ['F25', 'F26'], offerings });
  return [
    course('09-207', 'Techniques in Quantitative Analysis', 9, [
      planRow('F26', 'Pittsburgh', 'Lec 1', 'T 03:30PM-04:50PM'),
      planRow('F26', 'Pittsburgh', 'A', 'MW 02:00PM-04:20PM'),
      planRow('F26', 'Pittsburgh', 'A', 'MW 02:00PM-02:50PM'),
      planRow('F26', 'Qatar', 'Lec 2', 'U 04:00PM-04:50PM'),
      planRow('F26', 'Qatar', 'W', 'MW 02:30PM-05:30PM'),
      planRow('F25', 'Qatar', 'Lec 2', 'U 10:00AM-10:50AM'),
      planRow('F25', 'Qatar', 'W', 'MW 02:30PM-05:30PM'),
    ]),
    course('15-112', 'Fundamentals of Programming and Computer Science', 12, [
      planRow('F26', 'Pittsburgh', 'Lec 1', 'TR 09:30AM-10:50AM'),
      planRow('F26', 'Pittsburgh', 'A', 'W 09:00AM-09:50AM'),
      planRow('F26', 'Pittsburgh', 'B', 'W 10:00AM-10:50AM'),
      planRow('F26', 'Pittsburgh', 'C', 'W 11:00AM-11:50AM'),
      planRow('F26', 'Pittsburgh', 'Lec 2', 'TR 02:00PM-03:20PM'),
      planRow('F26', 'Pittsburgh', 'M', 'W 09:00AM-09:50AM'),
      planRow('F26', 'Qatar', 'Lec 3', 'UTR 11:30AM-12:45PM'),
      planRow('F26', 'Qatar', 'W', 'W 11:30AM-12:45PM'),
    ]),
    course('03-151', 'Honors Modern Biology', 10, [
      planRow('F26', 'Qatar', 'Lec 2', 'UTR 11:30AM-12:20PM'),
      planRow('F26', 'Qatar', 'W', 'M 02:30PM-04:20PM'),
    ]),
    course('21-120', 'Differential and Integral Calculus', 10, [
      planRow('F26', 'Pittsburgh', 'Lec 1', 'MWF 10:00AM-10:50AM'),
    ]),
  ];
}

function loadPlanApp() {
  const env = loadApp({ realCard: true });
  const { App, ctx } = env;
  App.courses = planCatalog();
  App.courseIndex = vm.runInContext('buildCourseIndex', ctx)(App.courses);
  App.activeSemester = 'F26';
  App.locationFilter = 'all';
  App.modalityFilter = 'all';
  const toasts = [];
  ctx.showToast = msg => toasts.push(msg);
  const course = code => App.courses.find(c => c.course_code === code);
  return { ...env, toasts, course };
}

// [course, section, days_times] of every planned meeting, in plan order.
const plannedRows = App => App._getPlanItems().map(i => [i.course_code, i.section, i.days_times]);
const entryParts = (App, items) => App._groupPlanItems(items || App._getPlanItems()).map(e => e.parts.map(p => p.section));
const blocksOf = html => html.split('class="cc-sched-block"').slice(1);
const planBtnCount = html => (html.match(/class="cc-plan-btn/g) || []).length;

test('planner: + Plan on Sec W plans Lec 2 and W at their own times; a second click removes both', () => {
  const { App, toasts } = loadPlanApp();
  App.togglePlanSection('09-207', 'F26', 'W', 'Qatar');
  assertEqual(plannedRows(App), [
    ['09-207', 'Lec 2', 'U 04:00PM-04:50PM'],
    ['09-207', 'W', 'MW 02:30PM-05:30PM'],
  ]);
  assertEqual(toasts.pop(), 'Added to your schedule plan');
  App.togglePlanSection('09-207', 'F26', 'W', 'Qatar');
  assertEqual(plannedRows(App), []);
  assertEqual(toasts.pop(), 'Removed from schedule plan');
});

test('planner: another section of the same lecture replaces the planned one; other lectures stay', () => {
  const { App, toasts } = loadPlanApp();
  App.togglePlanSection('15-112', 'F26', 'W', 'Qatar');
  App.togglePlanSection('15-112', 'F26', 'A', 'Pittsburgh');
  App.togglePlanSection('15-112', 'F26', 'B', 'Pittsburgh');
  assertEqual(toasts.pop(), 'Switched to Sec B in your schedule plan');
  assertEqual(plannedRows(App), [
    ['15-112', 'Lec 3', 'UTR 11:30AM-12:45PM'],
    ['15-112', 'W', 'W 11:30AM-12:45PM'],
    ['15-112', 'Lec 1', 'TR 09:30AM-10:50AM'],
    ['15-112', 'B', 'W 10:00AM-10:50AM'],
  ]);
  App.removePlanSection('15-112', 'F26', 'Lec 1', 'Pittsburgh');
  assertEqual(plannedRows(App), [['15-112', 'Lec 3', 'UTR 11:30AM-12:45PM'], ['15-112', 'W', 'W 11:30AM-12:45PM']],
    'Remove in the plan list takes the lecture and its section');
});

test('planner: a plan saved with only part of a group loads, and + Plan adds the missing part', () => {
  const { App, ctx, document, course } = loadPlanApp();
  ctx.localStorage.setItem('cf_plans_v2', JSON.stringify({ activePlanId: 'old', plans: [{ id: 'old', name: 'Old plan', items: [
    { course_code: '09-207', semester_code: 'F26', section: 'W', campus: 'Qatar', days_times: 'MW 02:30PM-05:30PM', modality: 'In Person' },
  ] }] }));
  assertEqual(entryParts(App), [['W']]);
  App._selectCourse(course('09-207'));
  assertTrue(leftBodyHtml(document).includes('title="Add the missing meeting times of Lec 2 and Sec W to your schedule plan"'));
  App.togglePlanSection('09-207', 'F26', 'W', 'Qatar');
  assertEqual(plannedRows(App), [
    ['09-207', 'W', 'MW 02:30PM-05:30PM'],
    ['09-207', 'Lec 2', 'U 04:00PM-04:50PM'],
  ]);
  assertEqual(entryParts(App), [['Lec 2', 'W']]);
  assertTrue(/data-section="W"[^>]*>✓ Planned</.test(leftBodyHtml(document)));
});

test('course card: a lecture and its section are one block with one + Plan; All semesters names each block', () => {
  const { App, document, course } = loadPlanApp();
  App.activeSemester = 'all';
  App.locationFilter = 'qatar';
  App._selectCourse(course('09-207'));
  const blocks = blocksOf(leftBodyHtml(document));
  assertEqual(blocks.length, 2);
  assertTrue(blocks[0].startsWith('><div class="cc-sched-term">Fall 2026</div>'), blocks[0].slice(0, 80));
  assertTrue(blocks[1].startsWith('><div class="cc-sched-term">Fall 2025</div>'));
  const b = blocks[0];
  assertTrue(b.indexOf('>Lec 2<') >= 0 && b.indexOf('>Lec 2<') < b.indexOf('>Sec W<'), 'lecture line, then section line');
  assertTrue(b.includes('U 4:00 PM to 4:50 PM') && b.includes('MW 2:30 PM to 5:30 PM'));
  assertEqual(planBtnCount(b), 1);
  assertTrue(b.includes('data-section="W"') && b.includes('title="Add Lec 2 and Sec W (all meeting times) to your schedule plan"'));
  App.activeSemester = 'F26';
  App.renderCourseCard(course('09-207'));
  assertFalse(leftBodyHtml(document).includes('cc-sched-term'), 'one semester: no semester labels');
});

test('course card: each section of a lecture has its own + Plan, and planning B replaces A', () => {
  const { App, document, course } = loadPlanApp();
  App.locationFilter = 'pittsburgh';
  App._selectCourse(course('15-112'));
  let html = leftBodyHtml(document);
  const lec1 = blocksOf(html)[0];
  assertEqual(planBtnCount(lec1), 3, 'on A, B and C, none on the lecture line');
  assertTrue(lec1.includes('cc-sched-sub'));
  assertTrue(html.includes('+2 more sections'), 'Lec 2 and its section M wait behind more');
  App.togglePlanSection('15-112', 'F26', 'A', 'Pittsburgh');
  html = leftBodyHtml(document);
  assertTrue(/data-section="A"[^>]*>✓ Planned</.test(html));
  assertTrue(html.includes('title="Plan Lec 1 and Sec B instead of Sec A"'));
  App.togglePlanSection('15-112', 'F26', 'B', 'Pittsburgh');
  html = leftBodyHtml(document);
  assertTrue(/data-section="B"[^>]*>✓ Planned</.test(html));
  assertFalse(/data-section="A"[^>]*>✓ Planned</.test(html));
  assertEqual(plannedRows(App), [['15-112', 'Lec 1', 'TR 09:30AM-10:50AM'], ['15-112', 'B', 'W 10:00AM-10:50AM']]);
});

test('course card: a lecture with no sections keeps its own + Plan', () => {
  const { App, document, course } = loadPlanApp();
  App._selectCourse(course('21-120'));
  const block = blocksOf(leftBodyHtml(document))[0];
  assertEqual(planBtnCount(block), 1);
  assertTrue(block.includes('data-section="Lec 1"'));
  App.togglePlanSection('21-120', 'F26', 'Lec 1', 'Pittsburgh');
  assertEqual(plannedRows(App), [['21-120', 'Lec 1', 'MWF 10:00AM-10:50AM']]);
});

test('typeahead + Plan adds the first matching lecture with its first section', () => {
  const { App, toasts } = loadPlanApp();
  App.locationFilter = 'qatar';
  App.addFirstSectionToPlan('09-207');
  App.locationFilter = 'pittsburgh';
  App.addFirstSectionToPlan('15-112');
  assertEqual(plannedRows(App), [
    ['09-207', 'Lec 2', 'U 04:00PM-04:50PM'],
    ['09-207', 'W', 'MW 02:30PM-05:30PM'],
    ['15-112', 'Lec 1', 'TR 09:30AM-10:50AM'],
    ['15-112', 'A', 'W 09:00AM-09:50AM'],
  ]);
  App.addFirstSectionToPlan('15-112');
  assertEqual(toasts.pop(), 'Already in your schedule plan');
  assertEqual(plannedRows(App).length, 4);
});

test('plan view: one entry per course with its lecture and section, courses counted, units once', async () => {
  const { App, document } = loadPlanApp();
  App.togglePlanSection('09-207', 'F26', 'W', 'Qatar');
  App.togglePlanSection('15-112', 'F26', 'A', 'Pittsburgh');
  assertEqual(App._planUnitsTotal(App._getPlanItems()), 21, '9 + 12: a lecture and its section count once');
  assertEqual(App._countPlannedCourses('F26'), 2);
  const plan = App._ensureActivePlan(false);
  App.openPlanDetail(plan.id);
  const html = leftBodyHtml(document);
  assertTrue(html.includes('<span class="plan-stat">2 courses</span>') && html.includes('<span class="plan-stat">21 units</span>'));
  assertFalse(html.includes('time conflict'));
  assertEqual((html.match(/class="plan-list-row /g) || []).length, 2);
  assertTrue(html.includes('Lec 2 + Sec W · Qatar · 9u'));
  assertTrue(html.includes('Lec 2: U 4:00 PM to 4:50 PM') && html.includes('Sec W: MW 2:30 PM to 5:30 PM'));
  assertTrue(html.includes('Lec 1 + Sec A · Pittsburgh · 12u'));
  assertEqual((html.match(/class="plan-block"/g) || []).length, 6, 'every meeting on each of its days: U, M, W, T, R, W');
  assertTrue(html.includes('<span class="plan-block-sec">Lec 2</span>') && html.includes('<span class="plan-block-sec">Sec W</span>'));
  await App.showPlanView();
  assertTrue(leftBodyHtml(document).includes('2 courses · 21 units'));
});

test('plan view: a lecture is not in conflict with its own section; a real overlap with another course is', () => {
  const { App, document } = loadPlanApp();
  App.togglePlanSection('09-207', 'F26', 'W', 'Qatar');
  const plan = App._ensureActivePlan(false);
  App.openPlanDetail(plan.id);
  assertFalse(leftBodyHtml(document).includes('time conflict'));
  App.togglePlanSection('03-151', 'F26', 'W', 'Qatar');  // M 2:30 PM to 4:20 PM, inside 09-207 Sec W
  App.openPlanDetail(plan.id);
  const html = leftBodyHtml(document);
  assertTrue(html.includes('1 time conflict'));
  assertEqual((html.match(/class="plan-list-row is-conflict"/g) || []).length, 2);
});

test('plan view: an offering whose own times overlap in the SOC is no conflict; another course at that time is', async () => {
  const { App, ctx, document } = loadPlanApp();
  // 03-117 as the Schedule of Classes lists it: Lec 1 meets inside the time of its lab A.
  App.courses.push({ course_code: '03-117', course_name: 'Frontiers, Analysis, and Discovery in Biological Sciences', units: 6,
    requirements: { CS: [], IS: [], BA: [], BS: [] }, offered: ['F26'], offerings: [
      planRow('F26', 'Pittsburgh', 'Lec 1', 'TR 01:00PM-01:50PM'),
      planRow('F26', 'Pittsburgh', 'A', 'TR 01:00PM-04:00PM'),
    ] });
  App.courseIndex = vm.runInContext('buildCourseIndex', ctx)(App.courses);
  const plan = App._ensureActivePlan(true);
  const view = () => {
    App.openPlanDetail(plan.id);
    const html = leftBodyHtml(document);
    return { html, warn: (html.match(/<span class="plan-stat plan-stat-warn">([^<]*)</) || [])[1] || '',
      rows: (html.match(/class="plan-list-row is-conflict"/g) || []).length };
  };
  App.togglePlanSection('03-117', 'F26', 'A', 'Pittsburgh');
  let v = view();
  assertEqual([v.warn, v.rows], ['', 0], 'Lec 1 inside lab A is one offering');
  assertFalse(v.html.includes('Time conflict'));
  assertEqual(App._planSummary(App._getPlanRecord(plan.id), 'F26').conflicts, 0);
  await App.showPlanView();
  assertTrue(leftBodyHtml(document).includes('<span class="plan-card-meta">1 course · 6 units</span>'), 'no conflict on the library card');

  // 09-207 Pittsburgh A meets MW 2:00 PM to 4:20 PM and MW 2:00 PM to 2:50 PM, and its Lec 1 meets
  // T 3:30 PM to 4:50 PM, inside the time of 03-117 lab A: one real conflict, between the two courses.
  App.togglePlanSection('09-207', 'F26', 'A', 'Pittsburgh');
  v = view();
  assertEqual([v.warn, v.rows], ['1 time conflict', 2]);
  await App.showPlanView();
  assertTrue(leftBodyHtml(document).includes('2 courses · 15 units · 1 conflict'));
  App.togglePlanSection('03-117', 'F26', 'A', 'Pittsburgh');
  v = view();
  assertEqual([v.warn, v.rows], ['', 0], 'the overlapping rows of 09-207 A are not a conflict');
});

test('planner: a shared snapshot and the imported plan keep the lecture and section together', () => {
  const { App } = loadPlanApp();
  App.togglePlanSection('09-207', 'F26', 'W', 'Qatar');
  const snapshot = App._planSnapshot(App._ensureActivePlan(false).id);
  assertEqual(snapshot.items.map(i => i.id), [
    '09-207::F26::Lec 2::Qatar::U 04:00PM-04:50PM',
    '09-207::F26::W::Qatar::MW 02:30PM-05:30PM',
  ]);
  // What /api/plans/accept-share returns for that snapshot (SchedulePlanItem.to_dict).
  const imported = App._mergeServerPlan({ id: 'srv-1', name: 'From Hind: Fall', items: snapshot.items.map(i => ({ ...i })) });
  const items = App._getPlanItems(imported.id);
  assertEqual(entryParts(App, items), [['Lec 2', 'W']]);
  assertEqual(App._planUnitsTotal(items), 9);
});
