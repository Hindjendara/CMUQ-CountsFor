// ============================================================
// Tests for js/utils.js helpers
// ============================================================

// Plain objects shaped like form fields, so the suite runs in Node and the browser.
function field(tagName, type, value) {
  return { tagName, type, value };
}

test('hasTypedText: the "Keep me signed in" checkbox alone does not count', () => {
  // A checkbox's value is "on" whether or not it is ticked.
  assertFalse(hasTypedText([
    field('INPUT', 'email', ''),
    field('INPUT', 'password', ''),
    field('INPUT', 'checkbox', 'on'),
  ]));
});

test('hasTypedText: text in an email, password or text field counts', () => {
  assertTrue(hasTypedText([field('INPUT', 'email', 'a'), field('INPUT', 'checkbox', 'on')]));
  assertTrue(hasTypedText([field('INPUT', 'password', 'x')]));
  assertTrue(hasTypedText([field('INPUT', 'text', 'Ann')]));
  assertTrue(hasTypedText([field('TEXTAREA', '', 'note')]));
});

test('hasTypedText: radios, hidden and button inputs never count', () => {
  assertFalse(hasTypedText([
    field('INPUT', 'radio', 'student'),
    field('INPUT', 'hidden', 'token'),
    field('INPUT', 'submit', 'Sign in'),
    field('INPUT', 'button', 'Go'),
  ]));
});

test('hasTypedText: a field with no type is a text field', () => {
  assertTrue(hasTypedText([field('INPUT', '', 'abc')]));
  assertFalse(hasTypedText([field('INPUT', '', '')]));
});

test('hasTypedText: empty or missing list is false', () => {
  assertFalse(hasTypedText([]));
  assertFalse(hasTypedText(null));
});
