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
function loadApp() {
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
  App.renderTree = () => {};
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

// Admin course editor and renumbered courses. 85-211 is retired (superseded_by
// 85-110) and stays in the catalog, hidden from students.
function loadCourseAdmin() {
  const env = loadApp();
  const { App, document, ctx } = env;
  const reqs = () => ({ CS: [], IS: [], BA: [], BS: [] });
  App.courses = [
    { course_code: '85-211', course_name: 'Cognitive Psychology', superseded_by: '85-110', requirements: reqs(), offered: [] },
    { course_code: '85-110', course_name: 'Cognitive Psychology', previous_codes: ['85-211'], requirements: reqs(), offered: ['F26'] },
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

test('course editor: a retired row is read only and points to its current code', () => {
  const { App, document } = loadCourseAdmin();
  App._openCourseEditor('85-211', false);
  const html = document.getElementById('admContent').innerHTML;
  assertTrue(html.includes('replaced by 85-110'), 'explains the replacement');
  assertTrue(html.includes("App._openCourseEditor('85-110', false)"), 'links to the current course');
  assertFalse(html.includes('App._archiveCourse()'), 'no Archive button');
  assertFalse(html.includes('App._saveCourse()'), 'no Save button');
  assertTrue(/<fieldset class="adm-fieldset" disabled>/.test(html), 'fields are disabled');
});

test('course editor: save and archive do nothing on a retired row', () => {
  const { App, notices, calls } = loadCourseAdmin();
  App._openCourseEditor('85-211', false);
  App._courseAdmin.draft.course_name = 'Edited';
  App._saveCourse();
  App._archiveCourse();
  assertEqual(calls, []);
  assertTrue(notices.some(n => n.includes('replaced by 85-110')), notices.join(' | '));
});

test('course editor: the current row saves under its own code', () => {
  const { App, notices, calls } = loadCourseAdmin();
  App._openCourseEditor('85-110', false);
  App._courseAdmin.draft.course_name = 'Cognitive Psychology (edited)';
  App._saveCourse();
  assertEqual(notices, []);
  assertEqual(calls.length, 1);
  assertEqual(calls[0].key, '85-110');
});

test('course editor: renumbering onto a retired or previous code is a clash', () => {
  const { App, notices, calls } = loadCourseAdmin();
  App._openCourseEditor('85-110', false);
  App._courseAdmin.draft.course_code = '85-211';
  App._saveCourse();
  assertTrue(notices.some(n => n.includes('85-211 is already in the catalog')), notices.join(' | '));

  App.courses = App.courses.filter(c => c.course_code !== '85-211');
  App._openCourseEditor('15-112', false);
  App._courseAdmin.draft.course_code = '85-211';
  App._saveCourse();
  assertTrue(notices.some(n => n.includes('85-211 is an old number of 85-110')), notices.join(' | '));
  assertEqual(calls, []);
});

