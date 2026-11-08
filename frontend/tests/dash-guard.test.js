// Guard for README section 18 rule 1: no em or en dashes (and no spaced
// hyphens used as dashes) in user-facing text. Node only: it reads the source
// files, so scripts/run-data-tests.js loads it with require() and tests/test.html
// does not include it.
//
// Scanned: string and template literals in js/*.js, the user-facing HTML pages
// (text, attributes and inline scripts/styles) and CSS content: values.
// Comments are skipped everywhere. Course titles from the Schedule of Classes
// never appear in these files, so they are not affected.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML_FILES = ['index.html', 'app.html', 'reset.html', 'landing/index.html'];

// Em dash, en dash, figure dash, horizontal bar, in any spelling a page can use.
const DASH_RE = /[‒–—―]|&[mn]dash;|&#821[12];|&#x201[345];|\\u201[345]/i;
// A hyphen standing alone between words, e.g. "Done - next" or "a -- b".
// \u0001 stands for a ${...} placeholder in a template literal.
const SPACED_HYPHEN_RE = /[A-Za-z0-9)\u0001]\s+-{1,2}\s+[A-Za-z0-9(\u0001]/;

// Strings that must keep a spaced hyphen. Each entry: file, exact literal text, reason.
const ALLOWLIST = [
  { file: 'js/data.js', text: 'EY2022 Qatar Business Administration - University Core Requirements',
    reason: 'LABEL_OVERRIDES key; must match the requirement path in data/courses.json (shown as "University Core")' },
  { file: 'js/data.js', text: 'EY2024+ Qatar Business Administration - University Core Requirements',
    reason: 'LABEL_OVERRIDES key; must match the requirement path in data/courses.json (shown as "University Core")' },
  { file: 'js/data.js', text: 'Concentration - select 1 concentration from the list below',
    reason: 'LABEL_OVERRIDES key; must match the requirement path in data/courses.json (shown as "Concentrations")' },
  { file: 'js/data.js', text: 'Independent Study - Special Permission Required',
    reason: 'LABEL_OVERRIDES key; must match the 70-509 requirement path (shown as "Independent Study (Special Permission Required)")' },
];

function allowed(file, text) {
  return ALLOWLIST.some(a => a.file === file && a.text === text);
}

/**
 * JS literals with comments skipped. Returns [{ line, text }]; for a template
 * literal, text is its static parts joined by \u0001 (one per ${...}), and each
 * ${...} expression is scanned for its own literals.
 */
function jsLiterals(src, lineOffset = 0) {
  const out = [];
  let i = 0;
  let line = 1 + lineOffset;
  const n = src.length;
  let lastSig = '';

  const advance = (k) => {
    for (let j = 0; j < k; j++) if (src[i + j] === '\n') line++;
    i += k;
  };

  function readQuoted(q) {
    const startLine = line;
    let text = '';
    advance(1);
    while (i < n && src[i] !== q && src[i] !== '\n') {
      if (src[i] === '\\') { text += src.slice(i, i + 2); advance(2); continue; }
      text += src[i]; advance(1);
    }
    advance(1);
    out.push({ line: startLine, text });
  }

  function readTemplate() {
    const startLine = line;
    const parts = [''];
    advance(1);
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { parts[parts.length - 1] += src.slice(i, i + 2); advance(2); continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        advance(2);
        readCode(true);
        advance(1); // closing }
        parts.push('');
        continue;
      }
      parts[parts.length - 1] += src[i]; advance(1);
    }
    advance(1);
    out.push({ line: startLine, text: parts.join('\u0001') });
  }

  function readRegex() {
    let inClass = false;
    advance(1);
    while (i < n && src[i] !== '\n') {
      const c = src[i];
      if (c === '\\') { advance(2); continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
      advance(1);
    }
    advance(1);
    while (i < n && /[a-z]/i.test(src[i])) advance(1);
  }

  function regexAllowed() {
    if (!lastSig) return true;
    if ('(,=:[!&|?{};+-*%<>~^'.includes(lastSig)) return true;
    const before = src.slice(Math.max(0, i - 12), i);
    return /\b(return|typeof|case|in|of|delete|void|throw|new)\s*$/.test(before);
  }

  // Code until end of input or, inside ${...}, the matching }.
  function readCode(inTemplate) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') {
        while (i < n && src[i] !== '\n') advance(1);
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        advance((end < 0 ? n : end + 2) - i);
        continue;
      }
      if (c === '\'' || c === '"') { readQuoted(c); lastSig = 'x'; continue; }
      if (c === '`') { readTemplate(); lastSig = 'x'; continue; }
      if (c === '/' && regexAllowed()) { readRegex(); lastSig = 'x'; continue; }
      if (inTemplate) {
        if (c === '{') depth++;
        else if (c === '}') {
          if (depth === 0) return;
          depth--;
        }
      }
      if (!/\s/.test(c)) lastSig = c;
      advance(1);
    }
  }

  readCode(false);
  return out;
}

const blank = s => s.replace(/[^\n]/g, ' ');

/** Visible HTML text and the attributes people read, from markup with comments blanked. */
function htmlVisibleText(markup) {
  const pieces = [];
  const attrRe = /\b(title|aria-label|placeholder|alt|content|value|label)\s*=\s*(["'])(.*?)\2/gs;
  let m;
  while ((m = attrRe.exec(markup))) pieces.push({ index: m.index, text: m[3] });
  const textRe = />([^<]+)</g;
  while ((m = textRe.exec(markup))) pieces.push({ index: m.index + 1, text: m[1] });
  return pieces;
}

function lineAt(src, index) {
  return src.slice(0, index).split('\n').length;
}

function scanJsSource(file, src, lineOffset, problems) {
  for (const lit of jsLiterals(src, lineOffset)) {
    if (DASH_RE.test(lit.text)) problems.push(`${file}:${lit.line}: em/en dash in ${JSON.stringify(lit.text.slice(0, 120))}`);
    else if (SPACED_HYPHEN_RE.test(lit.text) && !allowed(file, lit.text)) {
      problems.push(`${file}:${lit.line}: spaced hyphen in ${JSON.stringify(lit.text.slice(0, 120))}`);
    }
  }
}

function scanHtml(file, src, problems) {
  let markup = src.replace(/<!--[\s\S]*?-->/g, blank);
  // Inline scripts: scan their literals, then blank them out of the markup.
  markup = markup.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (all, open, body, close, offset) => {
    scanJsSource(file, body, lineAt(markup, offset + open.length) - 1, problems);
    return open + blank(body) + close;
  });
  markup = markup.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (all, open, body, close, offset) => {
    const css = body.replace(/\/\*[\s\S]*?\*\//g, blank);
    const hit = css.search(DASH_RE);
    if (hit >= 0) problems.push(`${file}:${lineAt(markup, offset + open.length + hit)}: em/en dash in inline style`);
    return open + blank(body) + close;
  });
  const dashAt = markup.search(DASH_RE);
  if (dashAt >= 0) problems.push(`${file}:${lineAt(markup, dashAt)}: em/en dash in markup`);
  for (const piece of htmlVisibleText(markup)) {
    if (SPACED_HYPHEN_RE.test(piece.text)) {
      problems.push(`${file}:${lineAt(markup, piece.index)}: spaced hyphen in ${JSON.stringify(piece.text.trim().slice(0, 120))}`);
    }
  }
}

function scanCssContent(file, src, problems) {
  const css = src.replace(/\/\*[\s\S]*?\*\//g, blank);
  const re = /content\s*:\s*(["'])(.*?)\1/g;
  let m;
  while ((m = re.exec(css))) {
    if (DASH_RE.test(m[2])) problems.push(`${file}:${lineAt(css, m.index)}: em/en dash in content: ${m[2]}`);
  }
}

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const listDir = (dir, ext) => fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith(ext)).sort().map(f => `${dir}/${f}`);

test('dash guard: js/*.js string literals have no em/en dashes or spaced hyphens', () => {
  const problems = [];
  for (const file of listDir('js', '.js')) scanJsSource(file, read(file), 0, problems);
  assertEqual(problems, []);
});

test('dash guard: HTML pages and CSS content: have no em/en dashes outside comments', () => {
  const problems = [];
  for (const file of HTML_FILES) scanHtml(file, read(file), problems);
  for (const file of listDir('css', '.css')) scanCssContent(file, read(file), problems);
  assertEqual(problems, []);
});

test('dash guard: the scanner catches dashes and skips comments', () => {
  const problems = [];
  scanJsSource('x.js', [
    '// a comment — fine',
    '/* block — fine */',
    "const a = 'Saved — done';",
    'const b = `${n} – ${m}`;',
    "const c = 'Step 1 - next';",
    'const d = `${x} - ${y}`;',
    'const e = a - b; const f = /[—]/g;',
    "const g = 'sign-in, CMU-Q, 15-213, Non-Technical';",
  ].join('\n'), 0, problems);
  assertEqual(problems.map(p => p.split(':')[1]), ['3', '4', '5', '6']);
  const html = [];
  scanHtml('x.html', '<!-- note — fine -->\n<p>Hello — world</p>\n<a title="One - two">x</a>', html);
  assertEqual(html.map(p => p.split(':')[1]), ['2', '3']);
  const ok = [];
  scanJsSource('js/data.js', "const k = { 'Independent Study - Special Permission Required': 'x' };", 0, ok);
  assertEqual(ok, []);
});

module.exports = { jsLiterals, ALLOWLIST };
