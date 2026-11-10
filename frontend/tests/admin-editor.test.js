// The admin course editor, category view, minor settings and activity log of
// js/app.js. Node only: it runs the real utils.js, data.js, profile.js and
// app.js in a vm context with a small fake DOM and a fake API that records
// every write, so scripts/run-data-tests.js loads it with require() and
// tests/test.html does not include it.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SOURCES = ['js/utils.js', 'js/data.js', 'js/profile.js', 'js/app.js'];
const MINORS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'minors.json'), 'utf8'));

const CORE = 'BS in Computer Science---Computer Science---Computer Science Core';
const SCI = 'GenEd---Science and Engineering';
const HA = 'GenEd---Humanities and Arts---C. Humanities and Arts Electives';
const MATH = 'BS in Computer Science---Mathematics---Mathematical Foundations for Computer Science';
const AI_SCS = 'BS in Artificial Intelligence---School of Computer Science Electives';
const OLD = 'BS in Computer Science---Mathematics and Probability---Calculus';

function element(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', hidden: false, checked: false, disabled: false, dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {}, removeEventListener() {},
    focus() {}, scrollIntoView() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

class MemoryStorage {
  constructor() { this._data = new Map(); }
  getItem(k) { return this._data.has(String(k)) ? this._data.get(String(k)) : null; }
  setItem(k, v) { this._data.set(String(k), String(v)); }
  removeItem(k) { this._data.delete(String(k)); }
  clear() { this._data.clear(); }
}

function adminCatalog() {
  const course = (code, name, reqs) => {
    const requirements = { CS: [], IS: [], BA: [], BS: [], AI: [] };
    for (const [major, requirement] of reqs || []) requirements[major].push({ requirement, type: requirement.startsWith('GenEd---'), major });
    return { course_code: code, course_name: name, units: 9, requirements, offered: ['F26'], offerings: [], description: '', prerequisites: '' };
  };
  return [
    course('15-122', 'Principles of Imperative Computation', [['CS', CORE], ['CS', SCI], ['AI', AI_SCS], ['AI', SCI]]),
    course('15-151', 'Mathematical Foundations for Computer Science', [['CS', MATH]]),
    course('21-127', 'Concepts of Mathematics', [['CS', MATH]]),
    course('85-110', 'Cognitive Psychology', [['CS', HA]]),
    course('85-130', 'Social Psychology', []),
    course('76-101', 'Interpretation and Argument', [['CS', HA]]),
  ];
}

/** A fresh App signed in as an admin, its catalog built from adminCatalog() and the real minors.json. */
function loadAdmin(opts = {}) {
  const live = new Map();
  const document = {
    live, documentElement: element('html'), body: element('body'), readyState: 'complete',
    getElementById(id) { return live.get(id) || null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement(tag) { return element(tag); }, addEventListener() {}, removeEventListener() {},
  };
  const ctx = {
    console, document,
    window: { innerWidth: 1280, matchMedia: () => ({ matches: false }), addEventListener() {} },
    location: { href: 'app.html', search: '', pathname: '/app.html' },
    localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage(),
    setTimeout: () => 0, clearTimeout() {},
  };
  vm.createContext(ctx);
  for (const file of SOURCES) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  const toasts = [];
  const calls = [];
  const confirms = [];
  const never = () => new Promise(() => {});
  const copy = v => JSON.parse(JSON.stringify(v));
  ctx.showToast = msg => toasts.push(msg);
  ctx.apiEditCourse = (key, body) => { calls.push({ edit: key, body: copy(body) }); return never(); };
  ctx.apiAddCourse = body => { calls.push({ add: copy(body) }); return never(); };
  ctx.apiBatchEditCourses = items => { calls.push({ batch: copy(items) }); return never(); };
  ctx.apiEditMinor = (code, body) => { calls.push({ minor: code, body: copy(body) }); return never(); };
  ctx.confirm = msg => { confirms.push(msg); return env.confirmAnswer; };
  const App = vm.runInContext('App', ctx);
  App.profile = opts.profile || { role: 'admin', primary: null, secondary: null, scope: null };
  App.authedUser = opts.authedUser || { role: 'admin', email: 'admin@andrew.cmu.edu' };
  App.authMode = 'authed';
  App._buildCatalog(opts.courses || adminCatalog(), opts.overrides || [], MINORS, opts.minorOverrides || []);
  const content = element('admContent');
  live.set('admContent', content);
  const notices = [];
  App._courseFormNotice = msg => { if (msg) notices.push(msg); };
  const env = {
    App, ctx, document, calls, toasts, confirms, notices, content, confirmAnswer: true,
    input(id, value) { const e = element(id); e.value = value; live.set(id, e); return e; },
  };
  return env;
}

const course = (App, code) => lookupCourseIn(App, code);
function lookupCourseIn(App, code) { return App.courses.find(c => c.course_code === code); }

test('course editor: removing a CS category and adding a Gen Ed one saves only CS, as a change', () => {
  const { App, calls, input, confirms } = loadAdmin();
  App._openCourseEditor('15-122', false);
  const d = App._courseAdmin.draft;
  App._removeCourseReq('CS', d.requirements.CS.findIndex(r => r.requirement === CORE));
  input('ce-req-CS', 'GenEd › Humanities and Arts › C. Humanities and Arts Electives');
  App._addCourseReq('CS');
  assertEqual(confirms, [], 'a catalog category needs no confirmation');
  App._saveCourse();
  assertEqual(calls, [{ edit: '15-122', body: { requirements: { CS: { add: [{ requirement: HA, type: true }], remove: [CORE] } } } }]);
});

test('course editor: chips say Added here and Removed here, Put back restores one row, Reset sends null', () => {
  const stored = { CS: { add: [{ requirement: HA, type: true, major: 'CS' }], remove: [CORE] }, AI: { add: [], remove: [AI_SCS] } };
  const { App, calls, content, notices } = loadAdmin({ overrides: [{ course_code: '15-122', fields: {}, requirements: stored }] });
  App._openCourseEditor('15-122', false);
  const html = content.innerHTML;
  assertTrue(html.includes('Added here') && html.includes('Removed here') && html.includes('Put back'));
  assertTrue(html.includes('Edited here') && html.includes('Reset to the catalog'));
  assertEqual(App._courseRemovedRows('CS').map(r => r.requirement), [CORE]);
  App._putBackCourseReq('CS', 0);
  App._saveCourse();
  assertEqual(calls[0].body, { requirements: { CS: { add: [{ requirement: HA, type: true }], remove: [] } } }, 'only the put back row changes');

  const second = loadAdmin({ overrides: [{ course_code: '15-122', fields: {}, requirements: stored }] });
  second.App._openCourseEditor('15-122', false);
  second.App._resetCourseProgram('CS');
  second.App._saveCourse();
  assertEqual(second.calls[0].body, { requirements: { CS: null } }, 'the AI change stays');
  second.App._courseSaving = false;  // the fake save never answers
  second.App._openCourseEditor('15-122', false);
  second.App._saveCourse();
  assertEqual(second.notices.slice(-1)[0], 'There is nothing to save yet. Change a field first, or press Cancel to go back.');
  assertEqual(notices, []);
});

test('course editor: a category not in the 2026-27 catalog needs a confirmation and is flagged', () => {
  const env = loadAdmin();
  const { App, calls, confirms, content, input } = env;
  App._openCourseEditor('15-122', false);
  input('ce-req-CS', 'BS in Computer Science › Mathematics and Probability › Calculus');
  env.confirmAnswer = false;
  App._addCourseReq('CS');
  assertEqual(confirms.length, 1);
  assertFalse(App._courseAdmin.draft.requirements.CS.some(r => r.requirement === OLD), 'not added when cancelled');
  env.confirmAnswer = true;
  App._addCourseReq('CS');
  assertTrue(App._courseAdmin.draft.requirements.CS.some(r => r.requirement === OLD));
  assertTrue(content.innerHTML.includes('Not in the 2026-27 catalog'));
  input('ce-req-CS', '');
  App._saveCourse();
  assertEqual(calls[0].body.requirements.CS.add, [{ requirement: OLD, type: false }]);
});

test('course editor: a path under another root is refused, and a typed unknown path stops the save', () => {
  const { App, calls, confirms, notices, input } = loadAdmin();
  App._openCourseEditor('15-122', false);
  input('ce-req-CS', 'BS in Artificial Intelligence › Computer Science');
  App._addCourseReq('CS');
  assertEqual(confirms, []);
  assertEqual(notices, ['A Computer Science category starts with GenEd or BS in Computer Science.']);
  input('ce-req-CS', 'GenEd › Not A Real Category');
  App._saveCourse();
  assertEqual(calls, [], 'nothing is added silently');
  assertTrue(notices[1].startsWith('The category typed for Computer Science is not in the 2026-27 catalog.'), notices[1]);
  input('ce-req-CS', 'GenEd › Humanities and Arts › C. Humanities and Arts Electives');
  App._saveCourse();
  assertEqual(calls[0].body, { requirements: { CS: { add: [{ requirement: HA, type: true }], remove: [] } } }, 'a typed catalog category is added on save');
});

test('course editor: minor categories are added and removed per minor', () => {
  const { App, calls, input, content } = loadAdmin();
  App._openCourseEditor('76-101', false);
  input('ce-minor-pick', 'psychology|survey');
  App._addCourseMinor();
  assertTrue(content.innerHTML.includes('Psychology minor › Survey Courses'));
  App._saveCourse();
  assertEqual(calls[0].body, { requirements: { 'MINOR:psychology': { add: ['survey'], remove: [] } } });

  const other = loadAdmin();
  other.App._openCourseEditor('85-110', false);
  const draft = other.App._courseAdmin.draft.minors.psychology;
  assertTrue(draft.includes('survey') && draft.includes('elective'), 'listed, and matched by the elective rule');
  assertTrue(other.content.innerHTML.includes('From the minor file'));
  other.App._removeCourseMinor('psychology', draft.indexOf('survey'));
  assertEqual(other.App._courseRemovedMinors('psychology'), ['survey']);
  other.App._saveCourse();
  assertEqual(other.calls[0].body, { requirements: { 'MINOR:psychology': { add: [], remove: ['survey'] } } });
});

test('course editor: a list saved before the change is read, flagged, and saved as changes', () => {
  const legacy = { CS: [{ requirement: OLD, type: false, major: 'CS', earlier: true, earlier_reason: 'older degree version' }], IS: [], BA: [], BS: [] };
  const { App, calls, content } = loadAdmin({ overrides: [{ course_code: '15-122', fields: {}, requirements: legacy }] });
  assertFalse(App._catalogReqPaths.CS.has(OLD), 'the pick list is the scraped catalog');
  assertTrue(App._catalogReqPaths.CS.has(CORE));
  const c = course(App, '15-122');
  assertEqual(c.requirements.CS.map(r => r.requirement), [OLD]);
  assertEqual(c.requirements.AI.length, 2, 'a four program list keeps the AI rows');
  assertFalse('earlier' in c.requirements.CS[0], 'old flags are ignored');
  assertEqual(App._courseEditProblems(c), ['Computer Science saved before the 2026-27 names', 'Information Systems saved before the 2026-27 names',
    'Business Administration saved before the 2026-27 names', 'Biological Sciences saved before the 2026-27 names']);
  App._openCourseEditor('15-122', false);
  assertTrue(content.innerHTML.includes('These categories were saved before the 2026-27 catalog names.'));
  assertTrue(content.innerHTML.includes('Not in the 2026-27 catalog'));
  App._removeCourseReq('CS', 0);
  App._resetCourseProgram('CS');
  App._saveCourse();
  assertEqual(calls[0].body, { requirements: { CS: null, IS: null, BA: null, BS: null } });
});

test('course list: edit summaries and the Check these filter', () => {
  const { App, content } = loadAdmin({ overrides: [
    { course_code: '15-122', fields: { units: 10 }, requirements: { CS: { add: [{ requirement: HA }], remove: [CORE] }, 'MINOR:psychology': { add: ['survey'], remove: [] } } },
    { course_code: '21-127', fields: {}, requirements: { CS: { add: [{ requirement: OLD }], remove: [] } } },
    { course_code: '85-110', fields: {}, requirements: { 'MINOR:psychology': { add: ['statistics'], remove: [] } } },
  ] });
  assertEqual(App._courseEditSummary(course(App, '15-122')), 'Units · Computer Science: 1 added, 1 removed · Psychology minor: 1 added');
  assertEqual(App._courseEditProblems(course(App, '15-122')), []);
  assertEqual(App._courseEditProblems(course(App, '21-127')), ['Computer Science category not in the 2026-27 catalog']);
  assertEqual(App._courseEditProblems(course(App, '85-110')), ['Psychology minor category not in the minor file']);
  App._courseAdmin.view = 'list';
  App._courseAdmin.filter = 'check';
  App._renderAdminCourses();
  assertTrue(content.innerHTML.includes('Check these <span class="adm-chip-n">2</span>'));
});

test('category view: two courses added at once go in one batch, each with its own change', () => {
  const { App, calls, input, content } = loadAdmin();
  const st = App._courseAdmin;
  st.view = 'category';
  App._setCategoryTarget('CS');
  App._setCategoryPath(MATH);
  assertTrue(content.innerHTML.includes('2 courses in this category'));
  input('cv-add', '15-122, 85110');
  App._categoryAddCodes();
  assertEqual(calls, [{ batch: [
    { course_code: '15-122', requirements: { CS: { add: [{ requirement: MATH, type: false }], remove: [] } } },
    { course_code: '85-110', requirements: { CS: { add: [{ requirement: MATH, type: false }], remove: [] } } },
  ] }]);
  App._categorySaving = false;
  App._categoryChange(['15-151'], false);
  assertEqual(calls[1], { batch: [{ course_code: '15-151', requirements: { CS: { add: [], remove: [MATH] } } }] });
  App._categorySaving = false;
  App._setCategoryTarget('minor:psychology');
  App._setCategoryPath('survey');
  input('cv-add', '76-101');
  App._categoryAddCodes();
  assertEqual(calls[2], { batch: [{ course_code: '76-101', requirements: { 'MINOR:psychology': { add: ['survey'], remove: [] } } }] });
});

test('category view: removed courses can be put back, and unknown numbers are refused', () => {
  const stored = { CS: { add: [], remove: [MATH] } };
  const { App, calls, input, content } = loadAdmin({ overrides: [{ course_code: '21-127', fields: {}, requirements: stored }] });
  App._courseAdmin.view = 'category';
  App._setCategoryTarget('CS');
  App._setCategoryPath(MATH);
  assertTrue(content.innerHTML.includes('Removed here'));
  App._toggleCategoryRow('21-127', true);
  App._categoryBulk(true);
  assertEqual(calls[0], { batch: [{ course_code: '21-127', requirements: { CS: null } }] });
  App._categorySaving = false;
  input('cv-add', '99-998');
  App._categoryAddCodes();
  assertEqual(calls.length, 1);
});

test('minor settings: only the changed values are saved; the header shows the result and a note', () => {
  const { App, calls, input, content } = loadAdmin();
  App._courseAdmin.view = 'minors';
  App._courseAdmin.minorCode = 'psychology';
  App._renderAdminCourses();
  assertTrue(content.innerHTML.includes('Psychology minor'));
  assertFalse(content.innerHTML.includes("App._revertMinorSettings('psychology')"), 'nothing to undo yet');
  input('ms-units', '63');
  input('ms-major', '1');
  input('ms-minors', '');
  input('ms-note', '');
  App._saveMinorSettings('psychology');
  assertEqual(calls, [{ minor: 'psychology', body: { total_units: 63, max_with_major: 1 } }]);

  const edited = loadAdmin({ minorOverrides: [{ minor_code: 'psychology', fields: { max_with_major: 1, admin_note: 'Talk to the CMU-Q advisor first.' } }] });
  const html = edited.App._renderMinorSection('psychology', 'browse');
  assertTrue(html.includes('At most 1 course may also count toward a student&#039;s major. Courses may also count toward another minor without a limit.'), html.slice(0, 400));
  assertTrue(html.includes('CMU-Q updated this limit'));
  assertTrue(html.includes('Note from CMU-Q') && html.includes('Talk to the CMU-Q advisor first.'));
  assertTrue(html.includes('Edit minor settings'));
  edited.App._courseAdmin.view = 'minors';
  edited.App._courseAdmin.minorCode = 'psychology';
  edited.App._renderAdminCourses();
  assertTrue(edited.content.innerHTML.includes("App._revertMinorSettings('psychology')"));
  assertTrue(edited.content.innerHTML.includes('The minor file says: no limit'));
});

test('minor tree: archived codes and the admin changes are named', () => {
  const { App } = loadAdmin({ overrides: [
    { course_code: '85-130', fields: {}, requirements: null, archived: true },
    { course_code: '76-101', fields: {}, requirements: { 'MINOR:psychology': { add: ['survey'], remove: [] } } },
  ] });
  const node = findTreeNode(App.minorIndex.byCode.psychology.tree, 'survey');
  assertEqual(node.adminAdded, ['76-101']);
  const html = App._minorNodeInfoHtml(node);
  assertTrue(html.includes('Archived on the admin page: 85-130.'));
  assertFalse(/not in the course catalog: [^<]*85-130/.test(html), 'an archived course is not called missing');
  assertTrue(html.includes('Added on the admin page: 76-101.'));
  assertTrue(App.minorIndex.byCode.psychology.eligible.get('76-101').includes('survey'), 'the course card lists the minor');
  App.authedUser = { role: 'student' };
  assertFalse(App._minorNodeInfoHtml(node).includes('Added on the admin page'), 'admins only');
});

test('course card and activity log: an Edit course data button for admins, readable events with Open buttons', () => {
  const { App } = loadAdmin();
  assertTrue(App._renderCardActions(course(App, '15-122')).includes("App._editCourseInAdmin('15-122')"));
  const student = loadAdmin({ authedUser: { role: 'student' }, profile: { role: 'student', primary: 'CS', secondaries: [] } });
  assertFalse(student.App._renderCardActions(course(student.App, '15-122')).includes('Edit course data'));

  const update = { action: 'course.update', target: '15-122', details: {
    fields: ['units', 'counts for', 'minors'], changes: { units: { from: null, to: 10 } },
    requirements: { CS: { add: [{ requirement: HA, type: true, major: 'CS' }], remove: [CORE] }, 'MINOR:psychology': { add: ['survey'], remove: [] }, AI: null },
  } };
  const text = App._describeAdminEvent(update);
  assertTrue(text.includes('units: Schedule of Classes value to 10'), text);
  assertTrue(text.includes('Computer Science: added GenEd › Humanities and Arts › C. Humanities and Arts Electives; removed CS Degree Requirements › Computer Science › Computer Science Core'), text);
  assertTrue(text.includes('Psychology minor: added Survey Courses'), text);
  assertTrue(text.includes('Artificial Intelligence: back to the catalog'), text);
  assertTrue(App._adminEventOpenHtml(update).includes("App._editCourseInAdmin('15-122')"));
  const revert = App._describeAdminEvent({ action: 'course.revert', target: '15-122', details: { before: {
    fields: { units: 10 }, requirements: { CS: { add: [], remove: [CORE] } }, archived: false } } });
  assertTrue(revert.includes('undid all edits to') && revert.includes('dropped units, Computer Science categories'), revert);
  const old = App._describeAdminEvent({ action: 'course.update', target: '15-122', details: { fields: ['course_name', 'counts for'] } });
  assertTrue(old.includes('name. what it counts for'), old);
  const minor = { action: 'minor.update', target: 'psychology', details: { changes: { max_with_major: { from: null, to: 1 } } } };
  assertTrue(App._describeAdminEvent(minor).includes('courses shared with the major: no limit to 1'));
  assertTrue(App._adminEventOpenHtml(minor).includes("App._openMinorSettings('psychology')"));
  assertEqual(App._adminEventOpenHtml({ action: 'user.update', target: 'x@andrew.cmu.edu' }), '');
  assertEqual(App._adminEventOpenHtml({ action: 'course.update', target: "15-122');alert(1);('" }), '', 'only plain codes');
});

test('adding a course: changes against an empty catalog, keys with rows only', () => {
  const { App, calls, input } = loadAdmin();
  App._openCourseAdd();
  const d = App._courseAdmin.draft;
  d.course_code = '76-999';
  d.course_name = 'Special Topics in Writing';
  input('ce-req-IS', 'GenEd › Humanities and Arts › C. Humanities and Arts Electives');
  App._catalogReqPaths.IS.set(HA, true);
  App._addCourseReq('IS');
  input('ce-minor-pick', 'writing|english_elective');
  App._addCourseMinor();
  App._saveCourse();
  assertEqual(calls[0].add.requirements, {
    IS: { add: [{ requirement: HA, type: true }], remove: [] },
    'MINOR:writing': { add: ['english_elective'], remove: [] },
  });
});
