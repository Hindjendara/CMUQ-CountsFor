// Runs the browser JS tests (frontend/tests/test.html) under Node.
// Loads the same files in the same order as test.html, with an in-memory
// localStorage/sessionStorage so the profile save/load tests work.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// The site root: js/, tests/ and the HTML pages live under frontend/.
const ROOT = path.join(__dirname, '..', 'frontend');

class MemoryStorage {
  constructor() { this._data = new Map(); }
  get length() { return this._data.size; }
  key(i) { return Array.from(this._data.keys())[i] ?? null; }
  getItem(k) { return this._data.has(String(k)) ? this._data.get(String(k)) : null; }
  setItem(k, v) { this._data.set(String(k), String(v)); }
  removeItem(k) { this._data.delete(String(k)); }
  clear() { this._data.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();

function load(file) {
  const full = path.join(ROOT, file);
  vm.runInThisContext(fs.readFileSync(full, 'utf8') + `\n//# sourceURL=${file}`, { filename: file });
}

load('js/utils.js');
load('js/data.js');
load('js/profile.js');
load('tests/test-runner.js');

// Load each test file separately so results can be reported per file.
const TEST_FILES = ['tests/profile.test.js', 'tests/data.test.js', 'tests/utils.test.js'];
const byFile = [];
for (const file of TEST_FILES) {
  const start = __tests.length;
  load(file);
  byFile.push({ file, tests: __tests.slice(start) });
}
// Node-only suites (they read source files with fs), loaded with require().
const NODE_TEST_FILES = ['tests/dash-guard.test.js', 'tests/app-views.test.js', 'tests/catalog-data.test.js'];
for (const file of NODE_TEST_FILES) {
  const start = __tests.length;
  require(path.join(ROOT, file));
  byFile.push({ file, tests: __tests.slice(start) });
}

let pass = 0;
let fail = 0;
for (const { file, tests } of byFile) {
  let filePass = 0;
  let fileFail = 0;
  console.log(`\n# ${file}`);
  for (const t of tests) {
    localStorage.clear();
    sessionStorage.clear();
    try {
      t.fn();
      filePass++;
      console.log('PASS', t.name);
    } catch (e) {
      fileFail++;
      console.log('FAIL', t.name, e.message);
    }
  }
  console.log(`${file}: ${filePass} passed, ${fileFail} failed`);
  pass += filePass;
  fail += fileFail;
}
console.log(`\nTotal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
