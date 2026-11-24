/**
 * CountsFor landing page (index.html): sign in, create account, forgot and
 * reset password. There is no guest mode (removed November 18, 2026). Shares js/utils.js and js/api.js with the app.
 *
 * With CMU sign-in on (GET /api/auth/methods says mode "shibboleth") the card
 * shows one "Sign in with Andrew ID" button instead of the password views.
 * When that answer does not come (no API, as on the GitHub Pages test copy)
 * the page works exactly as before.
 */
(function () {
  'use strict';

  const APP_URL = 'app.html';

  // Backend URL, auth token storage, apiFetch and the api* calls come from
  // js/api.js; esc, showToast and the CMU email check (normalizeCmuEmail,
  // isCmuEmail) come from js/utils.js. index.html loads both before this file.

  // Reads the checkbox rendered in the sign-in panel.
  function wantsPersistentSession() {
    const box = document.getElementById('cfRememberMe');
    return !!(box && box.checked);
  }

  // Any answer from the server (status other than 0) proves the backend is up,
  // so drop a stale "could not reach the server" banner. Wraps every api.js call here.
  async function reach(promise) {
    const r = await promise;
    if (r && r.status !== 0 && state.backendUnreachable) clearBackendAlert();
    return r;
  }

  const state = {
    view: 'signin',
    resetEmail: '',
    resetToken: '',
    recovered: false,       // true after Google verified the user in the recovery flow
    backendUnreachable: false,
    sso: null,              // { loginUrl } when the server uses CMU sign-in (view 'sso')
    ssoError: '',           // ?sso_error= code from a failed CMU sign-in
  };

  // /api/auth/shibboleth sends a failed CMU sign-in back here as /?sso_error=<code>.
  const SSO_ERROR_MESSAGES = {
    domain: 'Only Andrew accounts can sign in to CountsFor.',
    identity: 'CMU sign-in did not share your Andrew ID. Try again later.',
    unavailable: 'CMU sign-in is not available right now. Try again later.',
  };
  const SSO_ERROR_DEFAULT = 'CMU sign-in did not finish. Try again.';

  function isNetworkError(r) {
    return !r || r.status === 0 || r.error === 'network';
  }

  function authErrorMessage(r, fallback) {
    if (isNetworkError(r)) {
      return 'Could not reach the server. Try again in a moment.';
    }
    return (r.data && r.data.message) || fallback;
  }

  function handleAuthNetworkFailure(r) {
    // The server uses CMU sign-in (a card drawn before it said so): the password
    // routes answer 403 sso_only, so show the CMU sign-in button instead.
    if (r && r.status === 403 && r.error === 'sso_only') {
      applySso({ loginUrl: SSO_LOGIN_PATH }, true);
      renderPanel();
      return true;
    }
    if (!isNetworkError(r)) return false;
    state.backendUnreachable = true;
    setFormError('');
    renderPanel({ focus: false });
    return true;
  }

  function setFieldMsg(inputId, msgId, text, kind) {
    const input = document.getElementById(inputId);
    const msg = document.getElementById(msgId);
    if (msg) {
      msg.textContent = text || '';
      msg.className = 'landing-field-msg' + (kind ? ' is-' + kind : '');
    }
    if (input) {
      input.classList.toggle('is-invalid', kind === 'error');
      input.classList.toggle('is-valid', kind === 'ok');
      input.setAttribute('aria-invalid', kind === 'error' ? 'true' : 'false');
    }
  }

  function clearFieldMsg(inputId, msgId) {
    setFieldMsg(inputId, msgId, '', '');
  }

  function validateAndrewField(inputId, msgId) {
    const el = document.getElementById(inputId);
    if (!el) return true;
    const val = (el.value || '').trim();
    if (!val) {
      clearFieldMsg(inputId, msgId);
      return false;
    }
    if (!andrewEmailFromInput(val)) {
      setFieldMsg(inputId, msgId, 'Enter your Andrew ID, for example andrewid.', 'error');
      return false;
    }
    clearFieldMsg(inputId, msgId);
    return true;
  }

  function validatePasswordMatch(passId, confirmId, msgId) {
    const pass = document.getElementById(passId)?.value || '';
    const confirm = document.getElementById(confirmId)?.value || '';
    if (!confirm) {
      clearFieldMsg(confirmId, msgId);
      return false;
    }
    if (pass !== confirm) {
      setFieldMsg(confirmId, msgId, 'Passwords do not match.', 'error');
      return false;
    }
    setFieldMsg(confirmId, msgId, 'Passwords match.', 'ok');
    return true;
  }

  function togglePassword(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.textContent = show ? 'Hide' : 'Show';
    btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  }

  function setFormError(text) {
    const box = document.getElementById('cfAuthFormError');
    if (!box) return;
    if (text) {
      box.textContent = text;
      box.hidden = false;
    } else {
      box.textContent = '';
      box.hidden = true;
    }
  }

  function setLoading(loading, idleLabel) {
    const btn = document.getElementById('cfAuthSubmit');
    if (!btn) return;
    btn.classList.toggle('is-loading', loading);
    if (loading) {
      btn.disabled = true;
      btn.innerHTML =
        '<span class="landing-submit-spinner" aria-hidden="true"></span><span>' +
        idleLabel.replace(/…$/, '') + '…' +
        '</span>';
    } else {
      btn.textContent = idleLabel;
      updateSubmitState(state.view);
    }
  }

  function updateSubmitState(view) {
    const btn = document.getElementById('cfAuthSubmit');
    if (!btn) return;
    let ready = false;

    if (view === 'signin') {
      const email = (document.getElementById('cfLoginEmail')?.value || '').trim();
      const pass = document.getElementById('cfLoginPass')?.value || '';
      const emailOk = !!andrewEmailFromInput(email);
      ready = emailOk && pass.length > 0;
      if (email && !emailOk) validateAndrewField('cfLoginEmail', 'cfLoginEmailMsg');
    } else if (view === 'register') {
      const email = (document.getElementById('cfRegEmail')?.value || '').trim();
      const pass = document.getElementById('cfRegPass')?.value || '';
      const confirm = document.getElementById('cfRegPass2')?.value || '';
      const emailOk = !!andrewEmailFromInput(email);
      const passOk = pass.length >= 8;
      const matchOk = passOk && confirm.length > 0 && pass === confirm;
      ready = emailOk && passOk && matchOk;
      if (email && !emailOk) validateAndrewField('cfRegEmail', 'cfRegEmailMsg');
      if (confirm) validatePasswordMatch('cfRegPass', 'cfRegPass2', 'cfRegPass2Msg');
    } else if (view === 'forgot') {
      const email = (document.getElementById('cfForgotEmail')?.value || '').trim();
      ready = !!andrewEmailFromInput(email);
    } else if (view === 'reset') {
      const pass = document.getElementById('cfResetPass')?.value || '';
      const confirm = document.getElementById('cfResetPass2')?.value || '';
      ready = pass.length >= 8 && pass === confirm;
    }

    btn.disabled = !ready || btn.classList.contains('is-loading');
  }

  function validatePasswordLength(inputId, msgId) {
    const el = document.getElementById(inputId);
    if (!el) return true;
    const val = el.value || '';
    if (!val) {
      clearFieldMsg(inputId, msgId);
      return false;
    }
    if (val.length < 8) {
      setFieldMsg(inputId, msgId, 'Password must be at least 8 characters.', 'error');
      return false;
    }
    clearFieldMsg(inputId, msgId);
    return true;
  }

  function bindForm(view) {
    const onInput = function () {
      updateSubmitState(view);
    };
    const ids = {
      signin: ['cfLoginEmail', 'cfLoginPass'],
      register: ['cfRegName', 'cfRegEmail', 'cfRegPass', 'cfRegPass2'],
      forgot: ['cfForgotEmail'],
      reset: ['cfResetPass', 'cfResetPass2'],
    }[view] || [];

    ids.forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', function () {
        if (id === 'cfLoginEmail' || id === 'cfRegEmail' || id === 'cfForgotEmail') {
          const val = (el.value || '').trim();
          if (isCmuEmail(val)) clearFieldMsg(id, id + 'Msg');
        }
        if (id === 'cfRegPass' || id === 'cfResetPass') {
          const val = el.value || '';
          if (val.length >= 8) clearFieldMsg(id, id + 'Msg');
        }
        onInput();
      });
      el.addEventListener('blur', function () {
        if (id === 'cfLoginEmail' || id === 'cfRegEmail' || id === 'cfForgotEmail') {
          validateAndrewField(id, id + 'Msg');
        }
        if (id === 'cfRegPass' || id === 'cfResetPass') {
          validatePasswordLength(id, id + 'Msg');
        }
        if (id === 'cfRegPass2' || id === 'cfResetPass2') {
          const passId = view === 'reset' ? 'cfResetPass' : 'cfRegPass';
          validatePasswordMatch(passId, id, id + 'Msg');
        }
        updateSubmitState(view);
      });
    });

    if (view === 'register' || view === 'reset') {
      const passId = view === 'reset' ? 'cfResetPass' : 'cfRegPass';
      const confirmId = view === 'reset' ? 'cfResetPass2' : 'cfRegPass2';
      const passEl = document.getElementById(passId);
      if (passEl) {
        passEl.addEventListener('input', function () {
          const confirm = document.getElementById(confirmId);
          if (confirm && confirm.value) {
            validatePasswordMatch(passId, confirmId, confirmId + 'Msg');
          }
          updateSubmitState(view);
        });
      }
    }

    document.querySelectorAll('.landing-pass-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        togglePassword(btn.getAttribute('data-target'), btn);
      });
    });

    updateSubmitState(view);
  }

  function passwordField(id, label, opts) {
    opts = opts || {};
    const hint = opts.hint
      ? '<p class="landing-field-msg is-hint" id="' + id + 'Hint">' + esc(opts.hint) + '</p>'
      : '';
    return (
      '<div class="landing-field-group">' +
      '<label class="landing-label" for="' + id + '">' + label + '</label>' +
      '<div class="landing-field">' +
      '<input class="landing-input" id="' + id + '" type="password" autocomplete="' +
      (opts.autocomplete || 'new-password') +
      '" minlength="' +
      (opts.minlength || 8) +
      '" required aria-describedby="' +
      id +
      'Msg' +
      (opts.hint ? ' ' + id + 'Hint' : '') +
      '" aria-invalid="false" />' +
      '<button type="button" class="landing-pass-toggle" data-target="' +
      id +
      '" aria-label="Show password">Show</button>' +
      '</div>' +
      hint +
      '<p class="landing-field-msg" id="' +
      id +
      'Msg" role="alert"></p>' +
      '</div>'
    );
  }

  // The Andrew ID field: the ID alone, with "@andrew.cmu.edu" shown after it
  // (hidden once the person types a full address, which works too).
  function emailField(id, label) {
    return (
      '<div class="landing-field-group">' +
      '<label class="landing-label" for="' + id + '">' + label + '</label>' +
      '<div class="landing-id-wrap">' +
      '<input class="landing-input landing-id-input" id="' +
      id +
      '" type="text" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="andrewid" required aria-describedby="' +
      id +
      'Suffix ' + id + 'Msg" aria-invalid="false" oninput="this.parentNode.classList.toggle(\'has-at\', this.value.indexOf(\'@\') >= 0)" />' +
      '<span class="landing-id-suffix" id="' + id + 'Suffix" aria-hidden="false">@andrew.cmu.edu</span>' +
      '</div>' +
      '<p class="landing-field-msg" id="' +
      id +
      'Msg" role="alert"></p>' +
      '</div>'
    );
  }

  function tabsHtml(active) {
    if (active === 'forgot' || active === 'reset') return '';
    function tab(id, label) {
      return (
        '<button type="button" class="landing-tab' +
        (active === id ? ' is-active' : '') +
        '" data-view="' +
        id +
        '" role="tab" id="tab-' +
        id +
        '" aria-selected="' +
        (active === id ? 'true' : 'false') +
        '" aria-controls="authPanel" tabindex="' +
        (active === id ? '0' : '-1') +
        '">' +
        label +
        '</button>'
      );
    }
    return (
      '<div class="landing-tabs" role="tablist" aria-label="Authentication">' +
      tab('signin', 'Sign in') +
      tab('register', 'Create account') +
      '</div>'
    );
  }

  function panelWrap(content, view) {
    const labelledBy =
      view === 'register'
        ? 'tab-register'
        : view === 'signin'
          ? 'panel-title-signin'
          : 'panel-title-' + view;
    const role =
      view === 'signin' || view === 'register' ? 'tabpanel' : 'region';
    return (
      '<div id="authPanel" role="' +
      role +
      '" aria-labelledby="' +
      labelledBy +
      '">' +
      content +
      '</div>'
    );
  }

  // CMU-Q IT's help center handles sign-in problems (Andrew ID, Shibboleth). It is
  // also the support address on the Shibboleth SP's error pages (deploy/shibboleth).
  const HELP_EMAIL = 'helpcenter@qatar.cmu.edu';

  function footerHtml() {
    return '<div class="landing-card__footer">Carnegie Mellon University · Qatar' +
      '<p class="landing-help">Trouble signing in? Contact <a href="mailto:' + HELP_EMAIL + '">' + HELP_EMAIL + '</a></p>' +
      '</div>';
  }

  function backendWarnHtml() {
    // Always emit the slot so background probes can fill it without re-rendering
    // the panel (a re-render would wipe anything the user has typed).
    if (!state.backendUnreachable) {
      return '<div class="landing-alert" id="cfBackendAlert" role="alert" hidden></div>';
    }
    return '<div class="landing-alert" id="cfBackendAlert" role="alert">' + esc(UNREACHABLE_MSG) + '</div>';
  }

  // One canonical wording, reused by the initial render, the background session
  // probe, and every failed submit, so the user never sees two different
  // descriptions of the same outage.
  //
  // The wording is plain (the server could not be reached), so people do not
  // retype passwords that were never wrong.
  const ACCOUNTS_UNAVAILABLE_MSG =
    'Could not reach the server. Try again in a moment.';
  const UNREACHABLE_MSG = ACCOUNTS_UNAVAILABLE_MSG;
  const SLOW_MSG =
    'The server took too long to respond. Try again in a moment.';

  // status 0 means the request never completed: connection refused, DNS, a CORS
  // rejection, the abort timeout, or a gateway error from the reverse proxy
  // (apiFetch maps those to 0). It carries no information about the
  // credentials, so it must never be reported as a bad password.
  function isUnreachable(r) {
    return !r || r.status === 0;
  }

  // Show the connectivity banner and clear any credential-level error, so the
  // page never claims "wrong password" and "cannot reach server" at once.
  function showUnreachable(r) {
    state.backendUnreachable = true;
    setFormError('');
    clearFieldMsg('cfLoginPass', 'cfLoginPassMsg');
    setBackendAlert(
      r && r.message === 'The server took too long to respond.' ? SLOW_MSG : ACCOUNTS_UNAVAILABLE_MSG
    );
  }

  // The server answered, so any banner left over from a previous attempt or from
  // the background probe is stale.
  function clearBackendAlert() {
    state.backendUnreachable = false;
    setBackendAlert('');
  }

  function setBackendAlert(message, opts) {
    const box = document.getElementById('cfBackendAlert');
    if (!box) return;
    if (!message) {
      box.textContent = '';
      box.hidden = true;
      return;
    }
    box.textContent = message + ' ';
    if (opts && opts.continueLink) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'landing-link-btn';
      btn.textContent = 'Continue to CountsFor';
      btn.addEventListener('click', goToApp);
      box.appendChild(btn);
    }
    box.hidden = false;
  }

  function formErrorHtml() {
    return '<div class="landing-form-error" id="cfAuthFormError" hidden role="alert"></div>';
  }

  function renderPanel(opts) {
    opts = opts || {};
    const v = state.view;
    let inner = '';

    if (v === 'sso') {
      // CMU sign-in: a plain link to the login URL, which Apache sends through
      // the CMU sign-in page and back to the app. No form, nothing to type.
      inner = panelWrap(
        '<div class="landing-card__top">' +
        '<div class="landing-panel-head landing-panel-head--signin">' +
        '<h2 class="landing-panel-title" id="panel-title-sso">Welcome</h2>' +
        '<p class="landing-panel-lead">Use your Andrew ID and password on the CMU sign-in page.</p>' +
        '</div>' +
        backendWarnHtml() +
        '</div>' +
        '<div class="landing-card__body">' +
        formErrorHtml() +
        '<div class="landing-form-actions landing-sso-actions">' +
        '<a class="landing-submit landing-sso-btn" id="cfSsoBtn" href="' + esc(ssoLoginHref()) + '">Sign in with Andrew ID</a>' +
        '</div>' +
        '</div>',
        'sso'
      );
    } else if (v === 'register') {
      inner = panelWrap(
        '<div class="landing-card__top">' +
        tabsHtml('register') +
        backendWarnHtml() +
        '</div>' +
        '<div class="landing-card__body">' +
        '<form class="landing-form" id="cfAuthForm" novalidate>' +
        formErrorHtml() +
        '<div class="landing-form-fields">' +
        '<div class="landing-field-group">' +
        '<label class="landing-label" for="cfRegName">Full name</label>' +
        '<input class="landing-input" id="cfRegName" type="text" autocomplete="name" placeholder="Your name" />' +
        '</div>' +
        emailField('cfRegEmail', 'Andrew ID') +
        passwordField('cfRegPass', 'Password', { autocomplete: 'new-password', hint: 'At least 8 characters' }) +
        passwordField('cfRegPass2', 'Confirm password', { autocomplete: 'new-password' }) +
        '</div>' +
        '<div class="landing-form-actions">' +
        '<button type="submit" class="landing-submit" id="cfAuthSubmit" disabled>Create account</button>' +
        '</div>' +
        '</form>' +
        '</div>',
        'register'
      );
    } else if (v === 'forgot') {
      inner = panelWrap(
        '<div class="landing-card__top">' +
        '<div class="landing-panel-head">' +
        '<button type="button" class="landing-back" data-view="signin">Back to sign in</button>' +
        '<h2 class="landing-panel-title" id="panel-title-forgot">Forgot password</h2>' +
        '<p class="landing-panel-lead">We\'ll email you a reset link. Or verify with your <strong>@andrew.cmu.edu</strong> Google account instead, no email needed.</p>' +
        '</div>' +
        backendWarnHtml() +
        '</div>' +
        '<div class="landing-card__body" id="cfForgotBody">' +
        '<form class="landing-form" id="cfAuthForm" novalidate>' +
        formErrorHtml() +
        emailField('cfForgotEmail', 'Andrew ID') +
        '<div class="landing-form-actions">' +
        '<button type="submit" class="landing-submit" id="cfAuthSubmit" disabled>Send reset link</button>' +
        '</div>' +
        '</form>' +
        '<div class="landing-reset-box" id="cfResetLinkBox" hidden></div>' +
        '<div class="landing-divider" aria-hidden="true"><span>or</span></div>' +
        '<div id="cfGoogleRecover" class="landing-google-mount"></div>' +
        '<p class="landing-recover-note">Sign in with Google to confirm you own the account. No reset email needed.</p>' +
        '</div>',
        'forgot'
      );
    } else if (v === 'reset') {
      const resetLead = state.recovered
        ? 'You\'re verified. Choose a new password for <strong>' + esc(state.resetEmail || 'your account') + '</strong>.'
        : 'Choose a new password for <strong>' + esc(state.resetEmail || 'your account') + '</strong>.';
      inner = panelWrap(
        '<div class="landing-card__top">' +
        '<div class="landing-panel-head">' +
        '<h2 class="landing-panel-title" id="panel-title-reset">Set a new password</h2>' +
        '<p class="landing-panel-lead">' + resetLead + '</p>' +
        '</div>' +
        backendWarnHtml() +
        '</div>' +
        '<div class="landing-card__body">' +
        '<form class="landing-form" id="cfAuthForm" novalidate>' +
        formErrorHtml() +
        passwordField('cfResetPass', 'New password', { autocomplete: 'new-password', hint: 'At least 8 characters' }) +
        passwordField('cfResetPass2', 'Confirm password', { autocomplete: 'new-password' }) +
        '<div class="landing-form-actions">' +
        '<button type="submit" class="landing-submit" id="cfAuthSubmit" disabled>Update password</button>' +
        '</div>' +
        '</form>' +
        '</div>',
        'reset'
      );
    } else {
      inner = panelWrap(
        '<div class="landing-card__top">' +
        tabsHtml('signin') +
        '<div class="landing-panel-head landing-panel-head--signin">' +
        '<h2 class="landing-panel-title" id="panel-title-signin">Welcome back</h2>' +
        '</div>' +
        backendWarnHtml() +
        '</div>' +
        '<div class="landing-card__body">' +
        '<form class="landing-form" id="cfAuthForm" novalidate>' +
        formErrorHtml() +
        emailField('cfLoginEmail', 'Andrew ID') +
        passwordField('cfLoginPass', 'Password', { autocomplete: 'current-password' }) +
        '<div class="landing-forgot-row">' +
        '<label class="landing-remember">' +
        '<input type="checkbox" id="cfRememberMe" />' +
        '<span>Keep me signed in</span>' +
        '</label>' +
        '<button type="button" class="landing-link-btn" data-view="forgot">Forgot password?</button>' +
        '</div>' +
        '<div class="landing-form-actions">' +
        '<button type="submit" class="landing-submit" id="cfAuthSubmit" disabled>Sign in</button>' +
        '</div>' +
        '</form>' +
        '</div>',
        'signin'
      );
    }

    inner += footerHtml();

    const card = document.getElementById('landingCard');
    card.innerHTML = inner;

    card.querySelectorAll('[data-view]').forEach(function (el) {
      el.addEventListener('click', function () {
        switchView(el.getAttribute('data-view'));
      });
    });

    const form = document.getElementById('cfAuthForm');
    if (form) {
      form.addEventListener('submit', onFormSubmit);
    }

    bindForm(v);

    // The first-run explainer is for someone deciding whether to sign up. On the
    // forgot/reset views they already have an account, so it is just noise
    // pushing the form down. Toggled on the element, never re-rendered, because
    // re-rendering the panel would wipe anything already typed.
    const intro = document.getElementById('cfIntro');
    if (intro) intro.hidden = (v === 'forgot' || v === 'reset');

    if (v === 'forgot') mountGoogleRecover();
    if (v === 'sso' && state.ssoError) {
      const known = Object.prototype.hasOwnProperty.call(SSO_ERROR_MESSAGES, state.ssoError);
      setFormError(known ? SSO_ERROR_MESSAGES[state.ssoError] : SSO_ERROR_DEFAULT);
    }

    if (opts.focus !== false) {
      const focusIds = {
        signin: 'cfLoginEmail',
        register: 'cfRegEmail',
        forgot: 'cfForgotEmail',
        reset: 'cfResetPass',
      };
      const focusEl = document.getElementById(focusIds[v]);
      if (focusEl) focusEl.focus();
    }
  }

  function switchView(view) {
    state.view = view;
    setFormError('');
    renderPanel({ focus: false });
  }

  function goToApp() {
    const params = new URLSearchParams(location.search);
    const sharePlan = params.get('share_plan') || '';
    if (sharePlan) {
      location.href = APP_URL + '?share_plan=' + encodeURIComponent(sharePlan);
      return;
    }
    try {
      const stored = sessionStorage.getItem('cf_pending_share_plan');
      if (stored) {
        sessionStorage.removeItem('cf_pending_share_plan');
        location.href = APP_URL + '?share_plan=' + encodeURIComponent(stored);
        return;
      }
    } catch (e) { /* storage blocked */ }
    location.href = APP_URL;
  }

  // The CMU sign-in link: the login URL with `next` set to the app on this site
  // (keeping a shared plan link), where the server sends the browser afterwards.
  function ssoLoginHref() {
    let next = location.pathname.replace(/[^/]*$/, '') + APP_URL;
    let sharePlan = new URLSearchParams(location.search).get('share_plan') || '';
    if (!sharePlan) {
      try { sharePlan = sessionStorage.getItem('cf_pending_share_plan') || ''; } catch (e) { /* storage blocked */ }
    }
    if (sharePlan) next += '?share_plan=' + encodeURIComponent(sharePlan);
    const url = state.sso.loginUrl;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'next=' + encodeURIComponent(next);
  }

  // { sso, answered }: sso is { loginUrl } when the server uses CMU sign-in,
  // else null (also when the API answers something else: the GitHub Pages copy
  // answers 404). answered is false when the server could not be reached.
  async function loadSsoSettings() {
    const r = await reach(apiAuthMethods());
    const d = r && r.ok ? r.data : null;
    const sso = d && d.mode === 'shibboleth' && isSitePath(d.login_url) ? { loginUrl: d.login_url } : null;
    return { sso, answered: !!r && r.status !== 0 };
  }

  // The server's last answer, so a returning visitor sees the right card at once
  // (the new answer still decides, a moment later).
  const SSO_MEMO_KEY = 'cf_sign_in_mode';
  const SSO_LOGIN_PATH = '/api/auth/shibboleth';
  function rememberedSso() {
    try {
      const v = JSON.parse(localStorage.getItem(SSO_MEMO_KEY) || 'null');
      if (v && v.mode === 'shibboleth' && isSitePath(v.login_url)) return { loginUrl: v.login_url };
    } catch (e) { /* storage blocked or an old value */ }
    return null;
  }
  function rememberSso(sso) {
    try {
      if (sso) localStorage.setItem(SSO_MEMO_KEY, JSON.stringify({ mode: 'shibboleth', login_url: sso.loginUrl }));
      else localStorage.setItem(SSO_MEMO_KEY, JSON.stringify({ mode: 'password' }));
    } catch (e) { /* storage blocked */ }
  }
  // CMU sign-in replaces every password view; without it the sign-in view
  // (or the reset view of a reset link) comes back.
  function applySso(sso, remember) {
    state.sso = sso;
    if (sso) state.view = 'sso';
    else if (state.view === 'sso') state.view = state.resetToken ? 'reset' : 'signin';
    if (remember) rememberSso(sso);
  }
  // While the first answer is on its way on a slow connection.
  function renderWaiting() {
    const card = document.getElementById('landingCard');
    if (card && !card.querySelector('#authPanel')) {
      card.innerHTML = '<div class="landing-card__wait" role="status"><span class="landing-wait-spinner" aria-hidden="true"></span>Loading</div>';
    }
  }

  // Shown on the forgot view when sign-in or Create account sends someone there
  // (the server's own messages say "Open Forgot password", which is where they are).
  const FORGOT_REASONS = {
    no_password_set: 'No password is set for this account yet. Send a reset link, or use Continue with Google below.',
    account_exists: 'An account already exists for this email. Send a reset link, or use Continue with Google below.',
    staff_email: 'Faculty and staff confirm their address with Google. Use Continue with Google below, then choose a password.',
  };

  // Opens the forgot view with a message and the email filled in. It is the way
  // to a password for an account without one, and for faculty and staff, whom
  // Create account refuses: email reset, or Continue with Google.
  function showForgotWith(message, email) {
    state.view = 'forgot';
    renderPanel({ focus: false });
    const input = document.getElementById('cfForgotEmail');
    if (input && email) input.value = email;
    updateSubmitState('forgot');
    setFormError(message);
  }

  async function onLogin(event) {
    event.preventDefault();
    setFormError('');
    const email = (document.getElementById('cfLoginEmail')?.value || '').trim();
    const password = document.getElementById('cfLoginPass')?.value || '';
    if (!validateAndrewField('cfLoginEmail', 'cfLoginEmailMsg')) return;
    if (!password) {
      setFieldMsg('cfLoginPass', 'cfLoginPassMsg', 'Enter your password.', 'error');
      return;
    }
    // Read the checkbox before any await, while the panel is still on screen.
    const persist = wantsPersistentSession();
    setLoading(true, 'Sign in');
    const body = { email: andrewEmailFromInput(email) || email, password };
    const r = await reach(apiLogin(body));
    setLoading(false, 'Sign in');
    if (isUnreachable(r)) {
      showUnreachable(r);
      updateSubmitState('signin');
      return;
    }
    clearBackendAlert();
    if (!r.ok) {
      if (handleAuthNetworkFailure(r)) {
        updateSubmitState('signin');
        return;
      }
      state.backendUnreachable = false;
      const msg = authErrorMessage(r, 'Email or password is incorrect.');
      if (r.data && r.data.error === 'no_password_set') {
        showForgotWith(FORGOT_REASONS.no_password_set, body.email);
        return;
      } else if (r.status === 401) {
        setFieldMsg('cfLoginPass', 'cfLoginPassMsg', msg, 'error');
      } else {
        setFormError(msg);
      }
      updateSubmitState('signin');
      return;
    }
    // Re-save with the explicit choice: apiFetch already stashed the token in the
    // tab-only bucket, so this promotes it to localStorage when the box was ticked.
    if (r.data && r.data.auth_token) saveAuthToken(r.data.auth_token, persist);
    const me = await reach(apiGetMe());
    if (!me.ok) {
      clearAuthToken();
      setFormError('Sign-in succeeded but could not start a session. Try again.');
      return;
    }
    goToApp();
  }

  async function onRegister(event) {
    event.preventDefault();
    setFormError('');
    const name = (document.getElementById('cfRegName')?.value || '').trim();
    const email = (document.getElementById('cfRegEmail')?.value || '').trim();
    const password = document.getElementById('cfRegPass')?.value || '';
    const confirm = document.getElementById('cfRegPass2')?.value || '';
    if (!validateAndrewField('cfRegEmail', 'cfRegEmailMsg')) return;
    if (password.length < 8) {
      setFieldMsg('cfRegPass', 'cfRegPassMsg', 'Password must be at least 8 characters.', 'error');
      return;
    }
    if (!validatePasswordMatch('cfRegPass', 'cfRegPass2', 'cfRegPass2Msg')) return;
    setLoading(true, 'Create account');
    const regBody = {
      email: andrewEmailFromInput(email) || email,
      password,
      confirm_password: confirm,
      name: name || undefined,
    };
    const r = await reach(apiRegister(regBody));
    setLoading(false, 'Create account');
    if (isUnreachable(r)) {
      showUnreachable(r);
      updateSubmitState('register');
      return;
    }
    clearBackendAlert();
    if (!r.ok) {
      if (handleAuthNetworkFailure(r)) {
        updateSubmitState('register');
        return;
      }
      const msg = authErrorMessage(r, 'Registration failed.');
      const code = r.data && r.data.error;
      if (code === 'staff_email' || code === 'account_exists') {
        // Create account cannot prove the address is theirs: Forgot password can.
        showForgotWith(FORGOT_REASONS[code], regBody.email);
        return;
      }
      if (code === 'email_taken') {
        setFieldMsg('cfRegEmail', 'cfRegEmailMsg', msg, 'error');
      } else {
        setFormError(msg);
      }
      updateSubmitState('register');
      return;
    }
    if (r.data && r.data.auth_token) saveAuthToken(r.data.auth_token);
    const me = await reach(apiGetMe());
    if (!me.ok) {
      clearAuthToken();
      setFormError('Account created but sign-in could not be verified. Try signing in.');
      state.view = 'signin';
      renderPanel({ focus: false });
      return;
    }
    goToApp();
  }

  function mountGoogleRecover() {
    const slot = document.getElementById('cfGoogleRecover');
    if (!slot) return;
    const clientId = getGoogleClientId();
    if (!clientId) {
      setFormError('Google sign-in isn\'t configured, so password recovery is unavailable. Contact an admin.');
      return;
    }
    let tries = 0;
    const mount = function () {
      if (!(window.google && window.google.accounts && window.google.accounts.id)) {
        if (tries++ > 40) {  // ~6s
          setFormError('Couldn\'t load Google sign-in. Check your connection and refresh.');
          return;
        }
        return setTimeout(mount, 150);
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: onGoogleRecover,
        ux_mode: 'popup',
        auto_select: false,
      });
      slot.innerHTML = '';
      window.google.accounts.id.renderButton(slot, {
        theme: 'filled_blue',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        width: 300,
      });
    };
    mount();
  }

  async function onGoogleRecover(response) {
    if (!response || !response.credential) {
      setFormError('Google sign-in was cancelled.');
      return;
    }
    setFormError('');
    const r = await reach(apiSignInWithGoogle(response.credential));
    if (!r.ok) {
      if (handleAuthNetworkFailure(r)) return;
      setFormError(authErrorMessage(r, 'Google sign-in failed. Use your @andrew.cmu.edu account.'));
      return;
    }
    // Verified — move to the set-a-new-password step (now authenticated).
    state.recovered = true;
    state.resetEmail = (r.data && r.data.email) || '';
    switchView('reset');
  }

  async function onForgotPassword(event) {
    event.preventDefault();
    setFormError('');
    const email = (document.getElementById('cfForgotEmail')?.value || '').trim();
    if (!validateAndrewField('cfForgotEmail', 'cfForgotEmailMsg')) return;
    setLoading(true, 'Send reset link');
    const r = await reach(apiForgotPassword(andrewEmailFromInput(email) || email));
    setLoading(false, 'Send reset link');
    if (!r.ok) {
      if (handleAuthNetworkFailure(r)) {
        updateSubmitState('forgot');
        return;
      }
      if (r.status === 503) {
        // email_unavailable — SMTP not configured on the server; steer to Google.
        const box = document.getElementById('cfResetLinkBox');
        if (box) {
          box.hidden = false;
          box.innerHTML =
            '<p class="landing-reset-msg">Email reset isn\'t available yet. Use ' +
            '<strong>Continue with Google</strong> below to verify it\'s you and set a new password.</p>';
        }
      } else if (r.status === 502) {
        // email_failed — transient send failure.
        setFormError((r.data && r.data.message) || 'We couldn\'t send the email right now. Try again in a few minutes, or use Google below.');
      } else {
        setFormError(authErrorMessage(r, 'Request failed.'));
      }
      updateSubmitState('forgot');
      return;
    }
    const msg = (r.data && r.data.message) || 'If an account exists for that email, a reset link has been sent.';
    const form = document.getElementById('cfAuthForm');
    if (form) form.hidden = true;
    const box = document.getElementById('cfResetLinkBox');
    if (box) {
      let extra = '';
      if (r.data && r.data.reset_url) {
        extra = '<a class="landing-reset-link" href="' + esc(r.data.reset_url) + '">Reset my password</a>';
        state.resetToken = r.data.reset_token || '';
      } else if (r.data && r.data.reset_token) {
        const url =
          location.origin +
          location.pathname.replace(/[^/]+$/, '') +
          'index.html?token=' +
          encodeURIComponent(r.data.reset_token);
        extra = '<a class="landing-reset-link" href="' + esc(url) + '">Reset my password</a>';
        state.resetToken = r.data.reset_token;
      }
      box.hidden = false;
      box.innerHTML = '<p class="landing-reset-msg">' + esc(msg) + '</p>' + extra;
    }
  }

  async function onResetPassword(event) {
    event.preventDefault();
    setFormError('');
    const password = document.getElementById('cfResetPass')?.value || '';
    const confirm = document.getElementById('cfResetPass2')?.value || '';
    if (password.length < 8) {
      setFieldMsg('cfResetPass', 'cfResetPassMsg', 'Password must be at least 8 characters.', 'error');
      return;
    }
    if (!validatePasswordMatch('cfResetPass', 'cfResetPass2', 'cfResetPass2Msg')) return;
    setLoading(true, 'Update password');
    // Recovery via Google: the user is already authenticated, so set the
    // password directly. The email-link path uses the one-time token.
    const r = state.recovered
      ? await reach(apiSetPassword(password))
      : await reach(apiResetPassword({ token: state.resetToken, password }));
    setLoading(false, 'Update password');
    if (!r.ok) {
      if (handleAuthNetworkFailure(r)) {
        updateSubmitState('reset');
        return;
      }
      setFormError(authErrorMessage(r, 'Reset failed.'));
      updateSubmitState('reset');
      return;
    }
    if (state.recovered) {
      // Already signed in via Google — go straight into the app.
      showToast('Password set. Taking you in…', 4500);
      goToApp();
      return;
    }
    showToast('Password updated. Sign in with your new password.', 4500);
    state.view = 'signin';
    state.resetToken = '';
    state.resetEmail = '';
    if (typeof history !== 'undefined') {
      history.replaceState({}, '', location.pathname);
    }
    renderPanel({ focus: false });
  }

  function onFormSubmit(event) {
    if (state.view === 'register') return onRegister(event);
    if (state.view === 'forgot') return onForgotPassword(event);
    if (state.view === 'reset') return onResetPassword(event);
    return onLogin(event);
  }

  // True when redirecting to the app would throw away text the user typed in
  // the card. Only typed text counts (hasTypedText in utils.js): the "Keep me
  // signed in" checkbox always has the value "on", and ticking it loses nothing
  // when the session is already valid.
  function userIsEngaged() {
    const card = document.getElementById('landingCard');
    if (!card) return false;
    return hasTypedText(card.querySelectorAll('input, textarea'));
  }

  // Runs in the background after the panel is already on screen; must never
  // re-render the panel (that would wipe anything the user has typed).
  async function probeSession() {
    const me = await reach(apiGetMe());
    if (me.ok) {
      if (!userIsEngaged()) {
        goToApp();
        return;
      }
      setBackendAlert("You're already signed in.", { continueLink: true });
      return;
    }
    if (me.status === 0) {
      state.backendUnreachable = true;
      setBackendAlert(ACCOUNTS_UNAVAILABLE_MSG);
    }
  }

  async function init() {
    const params = new URLSearchParams(location.search);
    const sharePlan = params.get('share_plan') || '';
    if (sharePlan) {
      try { sessionStorage.setItem('cf_pending_share_plan', sharePlan); } catch (e) { /* storage blocked */ }
    }
    const resetTok = params.get('token') || params.get('reset') || '';
    if (resetTok) {
      state.resetToken = resetTok;
      state.view = 'reset';
    }
    // Shown once: drop the code from the address so a reload does not repeat it.
    state.ssoError = params.get('sso_error') || '';
    if (state.ssoError && typeof history !== 'undefined' && history.replaceState) {
      params.delete('sso_error');
      const query = params.toString();
      history.replaceState({}, '', location.pathname + (query ? '?' + query : '') + location.hash);
    }

    // The server's sign-in mode decides the card. The last answer draws it at
    // once; without one the card waits for the server ("Loading" after a
    // moment), so a slow connection never gets a password form that would not
    // work on a CMU sign-in server. With no answer at all, the password form.
    const remembered = rememberedSso();
    const asked = loadSsoSettings();
    let waiting = null;
    if (remembered) {
      applySso(remembered, false);
      renderPanel();
    } else {
      waiting = setTimeout(renderWaiting, 300);
    }
    const answer = await asked;
    clearTimeout(waiting);
    if (answer.answered) rememberSso(answer.sso);
    const shown = remembered ? !!state.sso : null;
    if (shown === null || (answer.answered && !!answer.sso !== shown)) {
      applySso(answer.answered ? answer.sso : state.sso, false);
      renderPanel({ focus: shown === null });
    }
    probeSession();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
