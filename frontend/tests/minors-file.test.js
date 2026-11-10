// The real data/minors.json as the app loads it. Node only: it reads the file
// with fs and runs js/api.js in a vm context with a fake fetch, so
// scripts/run-data-tests.js loads it with require() and tests/test.html does
// not include it. The pure minor logic is in tests/minors.test.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const MINORS_FILE = path.join(ROOT, 'data', 'minors.json');
const readMinors = () => JSON.parse(fs.readFileSync(MINORS_FILE, 'utf8'));

class MemoryStore {
  constructor() { this._data = new Map(); }
  getItem(k) { return this._data.has(String(k)) ? this._data.get(String(k)) : null; }
  setItem(k, v) { this._data.set(String(k), String(v)); }
  removeItem(k) { this._data.delete(String(k)); }
  clear() { this._data.clear(); }
}

// utils.js, data.js, profile.js and api.js in a fresh context, as app.html loads them.
function loadPage(fetchImpl, buildTag) {
  const ctx = {
    console,
    fetch: fetchImpl,
    document: {
      querySelector: sel => (sel === 'meta[name="cf-build"]' && buildTag ? { getAttribute: () => buildTag } : null),
    },
    localStorage: new MemoryStore(),
    sessionStorage: new MemoryStore(),
  };
  vm.createContext(ctx);
  for (const file of ['js/utils.js', 'js/data.js', 'js/profile.js', 'js/api.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  return ctx;
}

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

async function rejection(promise) {
  try { await promise; } catch (e) { return e.message; }
  throw new Error('expected a rejection');
}

test('minors.json load: fetchMinors reads data/minors.json with the cf-build cache tag', async () => {
  const urls = [];
  const ctx = loadPage(async url => { urls.push(url); return jsonResponse(200, readMinors()); }, 'minors-test');
  const data = await vm.runInContext('fetchMinors()', ctx);
  assertEqual(urls, ['data/minors.json?v=minors-test']);
  assertEqual(Object.keys(data.minors).length, 17);
  assertEqual(data.minors.psychology.name, 'Psychology');
});

test('minors.json load: a missing file or one without minors is an error the app catches', async () => {
  const missing = loadPage(async () => jsonResponse(404, null), 'x');
  assertTrue(/^Could not load data\/minors\.json \(HTTP 404/.test(await rejection(vm.runInContext('fetchMinors()', missing))));
  const empty = loadPage(async () => jsonResponse(200, { minors: {} }), 'x');
  assertEqual(await rejection(vm.runInContext('fetchMinors()', empty)), 'data/minors.json has no minors.');
});

test('minors.json load: applyMinorsCatalog rebuilds the minor list from the file', () => {
  const ctx = loadPage(async () => jsonResponse(404, null));
  vm.runInContext('MINOR_LIST.length = 0; for (const k of Object.keys(MINOR_BLOCKED_MAJORS)) delete MINOR_BLOCKED_MAJORS[k];', ctx);
  ctx.__data = readMinors();
  assertTrue(vm.runInContext('applyMinorsCatalog(__data)', ctx));
  const list = JSON.parse(vm.runInContext('JSON.stringify(MINOR_LIST)', ctx));
  assertEqual(list.length, 17);
  assertEqual(list[0], { code: 'arabic', label: 'Arabic Studies' });
  assertTrue(vm.runInContext("isMinorBlockedForMajor('finance', 'BA') && !isMinorBlockedForMajor('finance', 'CS')", ctx));
  assertTrue(vm.runInContext("isMinorBlockedForMajor('product', 'BA') && !isMinorBlockedForMajor('product', 'IS')", ctx));
  assertEqual(vm.runInContext("getMinorLabel('comp_bio')", ctx), 'Computational Biology');
});

test('minors.json: the fallback MINOR_LIST and MINOR_BLOCKED_MAJORS in js/profile.js match the file', () => {
  const { list, blocked } = minorListFromData(readMinors());
  assertEqual(list, MINOR_LIST);
  assertEqual(blocked, MINOR_BLOCKED_MAJORS);
  assertTrue(list.some(m => m.code === 'product' && m.label === 'Product Management'), 'product is a minor again');
  assertEqual(blocked.product, ['BA'], 'BA majors may not take Product Management');
});

test('minors.json: every category has a known rule and builds against a catalog of its listed codes', () => {
  const data = readMinors();
  const RULES = ['take_all', 'required', 'pick', 'min_units', 'max_units'];
  const listed = new Set();
  const problems = [];
  (function walkAll() {
    for (const [code, def] of Object.entries(data.minors)) {
      const walk = (cat, where) => {
        const at = `${code}/${where}${cat.id}`;
        if (!cat.rule || !RULES.includes(cat.rule.type)) problems.push(`${at}: rule ${JSON.stringify(cat.rule)}`);
        if (cat.rule && cat.rule.type === 'pick' && !(cat.rule.n > 0)) problems.push(`${at}: pick without n`);
        const kids = cat.children || [];
        if (!kids.length && !(cat.courses || []).length && !cat.select) problems.push(`${at}: no courses, select or parts`);
        for (const c of cat.courses || []) listed.add(c);
        for (const k of kids) walk(k, `${where}${cat.id}/`);
      };
      for (const cat of def.categories || []) walk(cat, '');
    }
  })();
  assertEqual(problems, []);

  // A catalog of every listed code (9 units each) plus one course per select prefix.
  const catalog = Array.from(listed).filter(c => /^\d\d-\d\d\d$/.test(c))
    .map(c => ({ course_code: c, course_name: c, units: 9, requirements: {} }));
  for (const p of ['02', '03', '15', '21', '70', '73', '76', '79', '85']) {
    catalog.push({ course_code: `${p}-399`, course_name: `${p}-399`, units: 9, requirements: {} });
  }
  const index = buildMinorIndex(data, catalog, buildCourseIndex(catalog));
  assertEqual(index.order.length, 17);
  for (const code of index.order) {
    const m = index.byCode[code];
    assertEqual(m.tree.children.map(n => n.id), (m.def.categories || []).map(c => c.id), code);
    (function check(node) {
      for (const ch of node.children || []) {
        if (!ch.rule.label) problems.push(`${code}/${ch.path}: no rule chip`);
        check(ch);
      }
    })(m.tree);
    assertTrue(minorDoubleCountLimitText(m.def, 'CS').length > 0, code);
  }
  assertEqual(problems, []);
  assertEqual(index.byCode.self_defined.tree.children, []);
  assertEqual(minorDoubleCountLimitText(index.byCode.biology.def, 'CS'), 'Confirm double counting with your advisor.');
  assertEqual(minorDoubleCountLimitText(index.byCode.neuroscience.def, 'CS'),
    'At most 2 courses may also count toward your major or another minor.');
  assertEqual(minorDoubleCountLimitText(index.byCode.product.def, 'CS'),
    'At most 1 course may also count toward your major or another minor.');
});

test('minors.json: Product Management comes from its archived catalog page; the others from their audit files', () => {
  const data = readMinors();
  const product = data.minors.product;
  assertEqual(product.source_file, 'backend/data/sources/catalog-2026-27/minors/product-management-minor.html');
  assertTrue(fs.existsSync(path.join(ROOT, '..', product.source_file)), 'the archived page is in the repository');
  for (const [code, def] of Object.entries(data.minors)) {
    const want = code === 'product' ? 'catalog' : code === 'self_defined' ? null : 'audit';
    assertEqual(minorSourceKind(def), want, code);
  }

  const catalog = ['70-381', '70-387', '70-452', '73-102', '73-104', '70-389', '05-391', '05-410',
    '70-385', '70-481', '70-482', '70-483'].map(c => ({ course_code: c, course_name: c, units: 9, requirements: {} }));
  const m = buildMinorIndex(data, catalog, buildCourseIndex(catalog)).byCode.product;
  // Rule types, not the chip wording (minorRuleLabel() words the chips).
  const shape = node => [node.label, node.rule.type, node.rule.n, node.courses.map(c => c.code),
    (node.children || []).map(shape)];
  assertEqual(m.tree.children.map(shape), [
    ['Required', 'take_all', null, [], [
      ['Marketing I', 'required', null, ['70-381'], []],
      ['Strategy for High-Tech Products and Services', 'required', null, ['70-387'], []],
      ['Introduction to Product Management', 'required', null, ['70-452'], []],
      ['Principles of Microeconomics', 'pick', 1, ['73-102', '73-104'], []],
    ]],
    ['Course in Design Thinking', 'pick', 1, ['05-391', '05-410', '70-389'], []],
    ['Marketing Course', 'pick', 1, ['70-385', '70-481', '70-482', '70-483'], []],
  ]);
  assertEqual(m.eligible.get('73-104'), ['required---microeconomics']);
  assertEqual(m.eligible.get('05-410'), ['design_thinking']);
  assertEqual(m.eligible.get('70-381'), ['required---marketing_i']);
});

test('minors.json: no minor carries a campus note', () => {
  for (const [code, def] of Object.entries(readMinors().minors)) {
    assertFalse('campus_note' in def, code);
    const text = JSON.stringify([def.name, def.title, def.notes, def.grade_rules, def.double_count.notes, def.categories]);
    assertFalse(/Pittsburgh version|campus not stated/i.test(text), code);
  }
});

test('minors.json: the authored text the app shows has no dash punctuation', () => {
  const data = readMinors();
  const DASH = /[‒-―]|\s-{1,2}\s/;
  const problems = [];
  for (const [code, def] of Object.entries(data.minors)) {
    const texts = [def.name, def.title, ...(def.notes || []), ...(def.grade_rules || []),
      ...((def.double_count && def.double_count.notes) || [])];
    const walk = cat => {
      texts.push(cat.name, ...(cat.notes || []));
      for (const k of cat.children || []) walk(k);
    };
    for (const cat of def.categories || []) walk(cat);
    // The verbatim rule strings are shown through plainDataText(); the version is never shown.
    for (const t of String((def.double_count && def.double_count.text) || '').split(' | ')) texts.push(plainDataText(t));
    for (const t of texts) if (t && DASH.test(t)) problems.push(`${code}: ${t}`);
  }
  assertEqual(problems, []);
});
