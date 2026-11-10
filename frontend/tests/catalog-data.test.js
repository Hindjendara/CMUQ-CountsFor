// Checks on the served catalog, data/courses.json, against js/data.js: every
// requirement path uses a known root and catalog bucket names, every bucket
// has a rule chip, LABEL_OVERRIDES and FULFILLMENT_RULES have no stale keys,
// and every row has the same plain shape (no earlier requirement flag). Also
// checks data/requirement_buckets.json, the admin course editor's bucket list:
// it lists every row path, in the tree's catalog order. And the planner: no
// offering of the catalog conflicts with itself when it is planned.
//
// Node only: it reads the 30 MB catalog with fs, so scripts/run-data-tests.js
// loads it with require() and tests/test.html does not include it. It runs
// after js/data.js is loaded, so the data.js globals are in scope.
const fs = require('fs');
const path = require('path');

const CATALOG = path.join(__dirname, '..', 'data', 'courses.json');
const BUCKETS = path.join(__dirname, '..', 'data', 'requirement_buckets.json');
const DASH_RE = /[‒–—―]/;
const SPACED_HYPHEN_RE = /[A-Za-z0-9)]\s+-{1,2}\s+[A-Za-z0-9(]/;

let catalog = null;
let buckets = null;
function bucketList() {
  if (!buckets) buckets = JSON.parse(fs.readFileSync(BUCKETS, 'utf8'));
  return buckets;
}
function courses() {
  if (!catalog) catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8')).courses;
  return catalog;
}
function rows() {
  const out = [];
  for (const c of courses()) {
    for (const [prog, list] of Object.entries(c.requirements || {})) {
      for (const r of list || []) out.push({ code: c.course_code, prog, row: r });
    }
  }
  return out;
}

test('catalog: every program with rows is in MAJOR_ORDER, and AI has rows', () => {
  const progs = new Set(rows().map(r => r.prog));
  for (const p of progs) assertTrue(MAJOR_ORDER.includes(p), `${p} has rows but is not in MAJOR_ORDER`);
  assertTrue(progs.has('AI'), 'AI has requirement rows');
  assertFalse(!!MAJOR_META.AI.dataPending, 'AI is not data pending');
});

test('catalog: paths start with the degree root or GenEd, with no doubled root', () => {
  const bad = new Set();
  for (const { prog, row } of rows()) {
    const parts = row.requirement.split('---');
    const root = 'BS in ' + MAJOR_META[prog].label;
    if (parts[0] !== root && parts[0] !== 'GenEd') bad.add(`${prog}: ${row.requirement}`);
    if (parts[1] === 'GenEd') bad.add(`${prog}: ${row.requirement}`);
    if (row.type !== (parts[0] === 'GenEd')) bad.add(`${prog} type: ${row.requirement}`);
    if (row.major !== prog) bad.add(`${prog} major field: ${row.requirement}`);
  }
  assertEqual([...bad].slice(0, 10), []);
});

test('catalog: bucket names have no dash punctuation, stray spaces or trailing colons', () => {
  const bad = new Set();
  for (const { row } of rows()) {
    for (const seg of row.requirement.split('---')) {
      if (DASH_RE.test(seg) || SPACED_HYPHEN_RE.test(seg) || seg !== seg.trim() || /\s\s/.test(seg) || /:$/.test(seg) || !seg) {
        bad.add(seg);
      }
    }
  }
  assertEqual([...bad], []);
});

test('catalog: every bucket gets a rule chip (its own, or one from a parent bucket)', () => {
  const missing = new Set();
  const seen = new Set();
  for (const { prog, row } of rows()) {
    const key = prog + '|' + row.requirement;
    if (seen.has(key)) continue;
    seen.add(key);
    const parts = row.requirement.split('---');
    for (let i = 1; i < parts.length; i++) {
      const sub = parts.slice(0, i + 1).join('---');
      if (!findRule(prog, parts[i], sub)) missing.add(`${prog}: ${sub}`);
    }
  }
  assertEqual([...missing], []);
});

test('catalog: LABEL_OVERRIDES and FULFILLMENT_RULES have no stale keys', () => {
  // A rule chip names a bucket of the catalog: one with rows, or one the bucket
  // list holds without rows yet (BA Free Electives, IS Emerging Technology Management).
  const segs = {};
  const add = (prog, p) => {
    segs[prog] = segs[prog] || new Set();
    for (const s of p.split('---')) segs[prog].add(s);
  };
  for (const { prog, row } of rows()) add(prog, row.requirement);
  const all = new Set(Object.values(segs).flatMap(s => [...s]));
  assertEqual(Object.keys(LABEL_OVERRIDES).filter(k => !all.has(k)), []);
  for (const [prog, list] of Object.entries(bucketList())) for (const p of list) add(prog, p);
  for (const [prog, rules] of Object.entries(FULFILLMENT_RULES)) {
    const stale = Object.keys(rules).filter(k => !(segs[prog] || new Set()).has(k));
    assertEqual(stale, [], `stale ${prog} rules`);
  }
});

test('bucket list: every program in MAJOR_ORDER, every row path and its parents listed once', () => {
  const list = bucketList();
  assertEqual(Object.keys(list), MAJOR_ORDER.filter(p => list[p]));
  for (const p of MAJOR_ORDER) assertTrue(Array.isArray(list[p]) && list[p].length > 0, `${p} has buckets`);
  const missing = new Set();
  for (const { prog, row } of rows()) {
    const parts = row.requirement.split('---');
    for (let i = 2; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('---');
      if (!list[prog].includes(p)) missing.add(`${prog}: ${p}`);
    }
  }
  assertEqual([...missing].slice(0, 10), []);
  for (const [prog, paths] of Object.entries(list)) {
    assertEqual(paths.length, new Set(paths).size, `${prog} lists a path twice`);
    const root = 'BS in ' + MAJOR_META[prog].label;
    const bad = paths.filter(p => {
      const parts = p.split('---');
      return parts.length < 2 || (parts[0] !== root && parts[0] !== 'GenEd') || parts.some(s => !s || s !== s.trim());
    });
    assertEqual(bad, [], `${prog} bucket paths`);
  }
});

test('bucket list: each program lists its buckets in the tree order (degree first, then GenEd)', () => {
  for (const [prog, paths] of Object.entries(bucketList())) {
    const firstGenEd = paths.findIndex(p => p.startsWith('GenEd---'));
    assertTrue(firstGenEd > 0, `${prog} lists degree buckets before GenEd`);
    assertFalse(paths.slice(firstGenEd).some(p => !p.startsWith('GenEd---')), `${prog}: a degree bucket after GenEd`);
    // Siblings follow the rule (catalog) order the tree uses.
    const kids = {};
    for (const p of paths) {
      const parts = p.split('---');
      const parent = parts.slice(0, -1).join('---');
      (kids[parent] = kids[parent] || []).push(parts[parts.length - 1]);
    }
    for (const [parent, names] of Object.entries(kids)) {
      const order = names.map(n => ruleOrder(prog, n));
      const sorted = order.slice().sort((a, b) => a - b);
      assertEqual(order, sorted, `${prog} ${parent}: siblings in rule order`);
    }
  }
});

test('catalog: every row is requirement, type and major (a rule row adds source: rule); no earlier flag', () => {
  // Courses from the older CMU-Q audits count like the rest (decision of
  // 2026-11-10): no row carries "earlier" or "earlier_reason".
  const bad = [];
  for (const { code, prog, row } of rows()) {
    const keys = Object.keys(row).sort().join(',');
    const plain = keys === 'major,requirement,type';
    const rule = keys === 'major,requirement,source,type' && row.source === 'rule';
    if (!plain && !rule) bad.push(`${prog} ${code}: ${keys}`);
  }
  assertEqual(bad.slice(0, 10), []);
});

test('planner: no offering of the catalog conflicts with itself, though the SOC lists overlapping times inside some', () => {
  // A planned meeting, as togglePlanSection() stores it.
  const item = (code, m) => ({ id: planOfferingKey(code, { ...m, days_times: offeringDaysTimes(m) }), course_code: code,
    semester_code: m.semester_code, section: m.section, campus: m.campus, days_times: offeringDaysTimes(m) });
  const overlapping = list => list.some((a, i) => list.slice(i + 1).some(b => planEntriesOverlap(a, b)));
  let lectureOverlapsSection = 0;
  let sectionRowsOverlap = 0;
  let planned = 0;
  const reported = [];
  for (const c of courses()) {
    const groups = linkOfferingGroups(getCourseOfferings(c));
    const offeringOf = planItemOfferingGroups(code => (code === c.course_code ? groups : []));
    const keyOf = i => offeringOf(i).key;
    for (const g of groups) {
      for (const p of offeringGroupParts(g)) if (overlapping(p.meetings.map(m => item(c.course_code, m)))) sectionRowsOverlap++;
      // What "+ Plan" plans: the lecture with each one of its sections, or a lecture or section alone.
      const picks = g.sections.length ? g.sections.map(s => s.section) : [offeringGroupParts(g)[0].section];
      for (const section of picks) {
        const items = offeringGroupChoice(g, section).parts.flatMap(p => p.meetings).map(m => item(c.course_code, m));
        planned++;
        if (g.lecture && section !== g.lecture.section) {
          const lecture = items.filter(i => i.section === g.lecture.section);
          if (items.some(b => b.section === section && lecture.some(a => planEntriesOverlap(a, b)))) lectureOverlapsSection++;
        }
        if (countPlanConflictPairs(items, keyOf) || findPlanConflicts(items, keyOf).size) {
          reported.push(`${c.course_code} ${g.semester_code} ${g.campus} ${section}`);
        }
      }
    }
  }
  assertTrue(planned > 20000, `${planned} offerings planned`);
  assertTrue(lectureOverlapsSection > 100, `${lectureOverlapsSection} lectures overlap their own section in the SOC`);
  assertTrue(sectionRowsOverlap > 50, `${sectionRowsOverlap} sections have overlapping rows of their own in the SOC`);
  assertEqual(reported.slice(0, 10), [], `${reported.length} offerings conflict with themselves`);

  // 03-117 Lec 1 (TR 1:00 PM to 1:50 PM) inside its lab A (TR 1:00 PM to 4:00 PM): one offering, no conflict.
  const bio = courses().find(c => c.course_code === '03-117');
  const groups = linkOfferingGroups(getCourseOfferings(bio));
  const lab = findOfferingGroup(groups, 'F26', 'A', 'Pittsburgh');
  assertTrue(!!lab && lab.group.lecture.section === 'Lec 1', '03-117 Fall 2026 Pittsburgh: Lec 1 with lab A');
  const items = offeringGroupChoice(lab.group, 'A').parts.flatMap(p => p.meetings).map(m => item('03-117', m));
  assertTrue(items.some(i => i.days_times === 'TR 01:00PM-01:50PM') && items.some(i => i.days_times === 'TR 01:00PM-04:00PM'));
  const keyOf = i => planItemOfferingGroups(code => (code === '03-117' ? groups : []))(i).key;
  assertEqual(countPlanConflictPairs(items, keyOf), 0);
  // Another course at that time is a real conflict, with the lecture and with the lab.
  const other = { id: 'x', course_code: '15-112', semester_code: 'F26', section: 'A', campus: 'Pittsburgh', days_times: 'TR 01:30PM-02:20PM' };
  assertEqual(countPlanConflictPairs(items.concat(other), keyOf), 2);
  assertEqual([...findPlanConflicts(items.concat(other), keyOf)].sort(), items.map(i => i.id).concat('x').sort());
});
