const __tests = [];

function test(name, fn) {
  __tests.push({ name, fn });
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error((msg ? msg + '\n' : '') + '  expected: ' + e + '\n  got:      ' + a);
  }
}

function assertTrue(v, msg) {
  if (!v) throw new Error(msg || 'expected truthy, got ' + JSON.stringify(v));
}

function assertFalse(v, msg) {
  if (v) throw new Error(msg || 'expected falsy, got ' + JSON.stringify(v));
}

function assertThrows(fn, msg) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  if (!threw) throw new Error(msg || 'expected function to throw');
}

function runAll() {
  const results = document.getElementById('results');
  const summary = document.getElementById('summary');
  let pass = 0, fail = 0;
  for (const t of __tests) {
    const div = document.createElement('div');
    div.className = 'test';
    try {
      t.fn();
      div.innerHTML = '<span class="pass">PASS</span> ' + t.name;
      pass++;
    } catch (e) {
      div.innerHTML = '<span class="fail">FAIL</span> ' + t.name + '<pre>' + e.message + '</pre>';
      fail++;
    }
    results.appendChild(div);
  }
  summary.textContent = pass + ' passed · ' + fail + ' failed';
  summary.className = 'summary ' + (fail === 0 ? 'pass-summary' : 'fail-summary');
}
