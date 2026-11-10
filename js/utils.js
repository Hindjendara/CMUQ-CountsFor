// ============================================================
// CountsFor — Utilities
// ============================================================

/**
 * The one CMU email check on the frontend; it mirrors backend/cmu.py
 * normalize_cmu_email. Accepts name@andrew.cmu.edu, name@cmu.edu and
 * name@qatar.cmu.edu (any case, surrounding spaces ignored) and returns the
 * canonical name@andrew.cmu.edu the API expects, or null for anything else.
 */
function normalizeCmuEmail(raw) {
  const e = (raw || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(e)) return null;
  const parts = e.split('@');
  const local = parts[0];
  const domain = parts[1];
  if (domain === 'cmu.edu' || domain === 'qatar.cmu.edu') {
    return local + '@andrew.cmu.edu';
  }
  if (domain === 'andrew.cmu.edu') return e;
  return null;
}

function isCmuEmail(raw) {
  return normalizeCmuEmail(raw) !== null;
}

function debounce(fn, ms = 250) {
  let t;
  return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

function esc(s) {
  if (!s) return '';
  const m = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' };
  return String(s).replace(/[&<>"']/g, c => m[c]);
}

function loadStore(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}

function saveStore(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// Input types whose value is text the user types. A checkbox or radio is not
// one of them: its .value is the fixed submit value ("on" by default), set
// whether or not it is ticked.
const TYPED_INPUT_TYPES = ['text', 'email', 'password', 'search', 'tel', 'url', 'number'];

/**
 * True when any of the given form fields holds text the user typed (a text
 * like <input> or a <textarea> with a non-empty value). Checkboxes, radios,
 * hidden and button inputs never count. Used by the landing page to decide
 * whether redirecting a signed-in visitor would throw away what they typed.
 */
function hasTypedText(fields) {
  return Array.prototype.some.call(fields || [], function (f) {
    if (!f) return false;
    const tag = String(f.tagName || '').toLowerCase();
    if (tag !== 'textarea') {
      const type = String(f.type || (f.getAttribute && f.getAttribute('type')) || 'text').toLowerCase();
      if (TYPED_INPUT_TYPES.indexOf(type) === -1) return false;
    }
    return String(f.value || '').length > 0;
  });
}

// Shared by the landing page and the app; each page's stylesheet styles .toast.
let _toastTimer;
function showToast(msg, ms = 2200) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('visible'), ms);
}

function formatPrereq(text) {
  if (!text || text === 'None' || text === 'none') return null;
  return text;
}

/**
 * Quote one CSV field. Doubling the quote is the RFC 4180 escape, and quoting
 * unconditionally keeps commas, newlines and leading zeros in course codes intact.
 */
function _csvCell(value) {
  return '"' + String(value ?? '').replace(/"/g, '""') + '"';
}

function _csvRow(cells) {
  return cells.map(_csvCell).join(',');
}

/**
 * Download rows as a real CSV file.
 *
 * This previously emitted SpreadsheetML 2003 XML under a .xls extension. Excel
 * accepted it only after a "format does not match extension" warning, and Google
 * Sheets, Numbers and Quick Look rendered it as a blank grid, which made a
 * perfectly good export look like missing data. CSV opens correctly everywhere and
 * needs no library. The sheetName argument is kept for call-site compatibility but
 * a CSV has no named sheets, so it is unused.
 */
function downloadExcelSheet(filename, sheetName, headers, rows, metaRows) {
  const lines = [];
  if (metaRows && metaRows.length) {
    for (const row of metaRows) lines.push(_csvRow(row));
    lines.push('');
  }
  lines.push(_csvRow(headers));
  for (const row of rows) lines.push(_csvRow(row));

  // CRLF per RFC 4180, and a UTF-8 BOM so Excel on Windows reads accented course
  // titles (e.g. "Français") as UTF-8 instead of mojibake.
  const csv = '﻿' + lines.join('\r\n') + '\r\n';

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : filename.replace(/\.xls$/i, '') + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slugifyFilename(text) {
  return String(text || '')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 72) || 'export';
}
