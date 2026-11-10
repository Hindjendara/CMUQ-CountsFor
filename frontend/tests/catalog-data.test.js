// Checks on the served catalog, data/courses.json, against js/data.js: every
// requirement path uses a known root and catalog bucket names, every bucket
// has a rule chip, LABEL_OVERRIDES and FULFILLMENT_RULES have no stale keys,
// and rows kept from an earlier requirement carry a reason.
//
// Node only: it reads the 30 MB catalog with fs, so scripts/run-data-tests.js
// loads it with require() and tests/test.html does not include it. It runs
// after js/data.js is loaded, so the data.js globals are in scope.
const fs = require('fs');
const path = require('path');

const CATALOG = path.join(__dirname, '..', 'data', 'courses.json');
const DASH_RE = /[‒–—―]/;
const SPACED_HYPHEN_RE = /[A-Za-z0-9)]\s+-{1,2}\s+[A-Za-z0-9(]/;
// Rule chips with no rows today: the catalog gives a rule but no course list.
const RULES_WITHOUT_ROWS = { BA: ['Free Electives'] };

let catalog = null;
function rows() {
  if (!catalog) catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8')).courses;
  const out = [];
  for (const c of catalog) {
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

test('catalog: every bucket gets a rule chip (its own, or an earlier-catalog parent)', () => {
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
  const segs = {};
  for (const { prog, row } of rows()) {
    segs[prog] = segs[prog] || new Set();
    for (const s of row.requirement.split('---')) segs[prog].add(s);
  }
  const all = new Set(Object.values(segs).flatMap(s => [...s]));
  assertEqual(Object.keys(LABEL_OVERRIDES).filter(k => !all.has(k)), []);
  for (const [prog, rules] of Object.entries(FULFILLMENT_RULES)) {
    const allowed = RULES_WITHOUT_ROWS[prog] || [];
    const stale = Object.keys(rules).filter(k => !(segs[prog] || new Set()).has(k) && !allowed.includes(k));
    assertEqual(stale, [], `stale ${prog} rules`);
  }
});

test('catalog: earlier rows carry a short plain reason; current rows carry none', () => {
  const bad = [];
  let earlier = 0;
  for (const { code, prog, row } of rows()) {
    if (row.earlier) {
      earlier++;
      const why = row.earlier_reason;
      if (row.earlier !== true || typeof why !== 'string' || !why || why.length > 80 || DASH_RE.test(why) || SPACED_HYPHEN_RE.test(why)) {
        bad.push(`${prog} ${code}: ${JSON.stringify(why)}`);
      }
    } else if ('earlier' in row || 'earlier_reason' in row) {
      bad.push(`${prog} ${code}: flag fields on a current row`);
    }
  }
  assertEqual(bad.slice(0, 10), []);
  assertTrue(earlier > 0, 'some rows are kept from an earlier requirement');
});
