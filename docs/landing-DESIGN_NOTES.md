# CountsFor Landing — Design Directions

**Source:** No dedicated `landing` rule file exists in the repo yet. These directions follow the established landing contract from the auth implementation and polish spec: split layout, `@andrew.cmu.edu` sign-in / create account, forgot password, faculty auto-recognition from seed, Scotty + CMU-Q wordmark, vanilla HTML/CSS/JS only, CMU kit colors.

**Assets available:** `scotty-head.png`, `scotty-full.png` (red swoosh asset, not full-body Scotty), `cmuq-wordmark.png`, `cmu-tartan-wave.png`, `cmu-swoosh-red-lg.png`, `cmu-swoosh-red-sm.png`.

---

## Direction 1 — **Maroon Afterglow**

| Token | Value |
|-------|-------|
| Carnegie Red | `#C41230` |
| Deep Maroon | `#7A0F1F` |
| Carbon | `#1A1A1A` |
| Ink | `#16252B` |
| Cream Panel | `#FAF9F7` |
| Field Border | `#D6D0CB` |

| Role | Face |
|------|------|
| Display | **Inter** 800 — hero “CountsFor”, tab headings (`background-clip` gradient `#C41230` → `#7A0F1F`) |
| Body | **Inter** 400–600 — labels, bullets, form copy (`#3A3F44` / `#5B6770`) |
| Mono | **JetBrains Mono** 500 — `@andrew.cmu.edu` hints, inline validation, reset tokens |

**Layout:** Full-height 55/45 split. Left panel is a near-black maroon gradient with a soft radial red bloom behind the mascot; right panel is warm cream with a floating auth card (tabs + form). Value bullets stay on the left only so tab switches never move the hero block.

```
┌──────────────────────┬─────────────────────┐
│  ○ glow              │  [Sign in|Create]   │
│  [Scotty badge]      │  Welcome back       │
│  CMU-Q CURRICULUM…   │  email ________     │
│  CountsFor           │  pass  ________     │
│  • @andrew…          │  Forgot?  [Sign in] │
│  • Faculty…          │  ─── CMU-Q mark ─── │
└──────────────────────┴─────────────────────┘
```

**Mascot:** `scotty-head.png` inside a frosted squircle on the dark panel — `filter: brightness(0) invert(1)` for a white knock-out, `border: 1px solid rgba(255,255,255,.16)`, subtle `box-shadow` inset highlight. No white PNG box behind the dog.

**Signature element:** A single **radial red afterglow** (`radial-gradient` at 28% 78%) that reads as “CMU energy” without tartan or stock illustration clutter.

**AI-default risk:** This is closest to the current build and reads like a generic “dark SaaS login + gradient blob.” Push it by tightening type scale (one massive wordmark, fewer bullets), using the glow **only** behind Scotty (not the whole panel), and a sharper cream card edge (1px `#D6D0CB` + tiny offset shadow, not a heavy float).

---

## Direction 2 — **Tartan Heritage**

| Token | Value |
|-------|-------|
| Carnegie Red | `#C41230` |
| Warm Parchment | `#F5F0EA` |
| Tartan Black | `#262626` |
| Heritage Maroon | `#7A0F1F` |
| Slate Body | `#3A3F44` |
| Muted Label | `#5B6770` |

| Role | Face |
|------|------|
| Display | **Inter** 800 — “CountsFor” in `#262626` on parchment (no gradient; heritage feels editorial) |
| Body | **Inter** 400–500 — form and reassurance copy |
| Mono | **JetBrains Mono** 450 — email placeholders, password rules, domain errors |

**Layout:** Left 50% is parchment with a **low-opacity tartan wave** (`cmu-tartan-wave.png` as `background-image`, `background-size: cover`, `opacity: .12` on a pseudo-layer). Scotty sits in natural black+red (no invert) on a thin red rule. Right 50% is solid white form column with a vertical **red swoosh** (`cmu-swoosh-red-lg.png`) bleeding off the top-right corner at 8% opacity — brand accent, not a second hero.

```
┌──────────────────────┬─────────────────────┐
│ ░░ tartan texture ░░ │        ╱ swoosh    │
│   [Scotty natural]   │  [Sign in|Create]   │
│   ─── red rule ───   │  Create account     │
│   CountsFor          │  name / email / …   │
│   CMU-Q Explorer     │  [Create account →] │
│   faculty bullets    │  CMU-Q wordmark     │
└──────────────────────┴─────────────────────┘
```

**Mascot:** `scotty-head.png` at ~96px, **no** invert — show native black Scotty + red scarf on parchment. Frame with a simple `border-bottom: 3px solid #C41230` under the mark, not a glass badge.

**Signature element:** **Tartan texture + natural Scotty** — immediately says “CMU-Q” without looking like a fintech login.

**AI-default risk:** Tartan + mascot can feel like “university template #4.” Push it by keeping tartan **barely visible** (texture, not wallpaper), limiting red to one rule + one button, and avoiding rounded pill overload on the left (square-ish editorial type instead).

---

## Direction 3 — **Type First Red**

| Token | Value |
|-------|-------|
| Carnegie Red | `#C41230` |
| Deep Maroon | `#7A0F1F` |
| Ink | `#16252B` |
| Paper White | `#FFFFFF` |
| Cool Gray | `#5B6770` |
| Line Gray | `#D6D0CB` |

| Role | Face |
|------|------|
| Display | **Inter** 800 — oversized “CountsFor” spans the top of the viewport (`clamp(48px, 8vw, 88px)`), gradient clipped text |
| Body | **Inter** 500 — compact form; left column is **type-only** (no paragraph blocks) |
| Mono | **JetBrains Mono** 500 — `@andrew.cmu.edu` as the only colored mono string in the hero |

**Layout:** Single cream/white canvas. Top band: giant wordmark left, **tiny** Scotty head right (navbar scale). Below: asymmetric two-column — narrow left rail (three short lines: “Andrew email only”, “Faculty recognized”, “Students: pick major once”) in display sizes; wide right column holds the auth card aligned to vertical center. No full-height dark panel.

```
┌────────────────────────────────────────────┐
│ CountsFor                          [scotty]│
├──────────────────┬─────────────────────────┤
│ @andrew.cmu.edu  │  [Sign in | Create]     │
│ Faculty → auto   │  email / password         │
│ Students → once  │  [ Sign in → ]          │
│                  │  CMU-Q wordmark           │
└──────────────────┴─────────────────────────┘
```

**Mascot:** `scotty-head.png` at 40–48px beside the wordmark — natural colors, no badge, no glow. Optional `mix-blend-mode: multiply` on white areas only if placed on off-white.

**Signature element:** **Typography scale** — the page is remembered for the wordmark dominating the header, not the illustration.

**AI-default risk:** Big headline + minimal form is the most “AI startup landing” of the three. Push it by using **CMU red only on the submit button and heading gradient**, keeping the rest strictly grayscale, and using mono for the `@andrew.cmu.edu` line at display size (unexpected, on-brand).

---

## Recommendation

**Choose Direction 2 — Tartan Heritage**, implemented with a restrained tartan (Direction 2’s “push” notes applied).

**Why:** CountsFor’s job on first load is to say “official CMU-Q tool, Andrew email, faculty vs student” — not “another dark auth screen.” Heritage ties to assets you already ship (`tartan-wave`, natural Scotty, CMU-Q wordmark), separates you from generic SaaS logins (Direction 1) and thin startup landings (Direction 3), and still supports the required split auth flows on a clean white form column with the polished token system (`#C41230`, `#7A0F1F`, `#5B6770`, `#D6D0CB`) already validated for contrast.

If implementation bandwidth is tight, **Direction 1** is the lowest delta from current CSS — but budget one sprint to migrate toward Heritage so the landing matches CMU-Q identity rather than default dark-mode product UI.

---

## Locked build spec — Heritage Single

**Chosen direction:** Heritage Single (no split). Supersedes Direction 2 split layout for implementation. Functional contract below matches the shared landing rule in the doc introduction and current `js/app.js` auth flows.

### Locked direction tokens

| Token | Hex | Use |
|-------|-----|-----|
| Carnegie Red | `#C41230` | Rule under Scotty, active tab underline, links, primary button, validation errors |
| Heritage Maroon | `#7A0F1F` | Hover/pressed button, optional link hover (not heading gradient) |
| Parchment | `#F5F0EA` | Full-page canvas |
| Tartan Black | `#262626` | Wordmark, card headings |
| Slate body | `#3A3F44` | Tagline, register lede |
| Muted label | `#5B6770` | Field labels, inactive tab, hints |
| Line | `#E2DACF` | Input borders default, card hairline |
| Card | `#FFFFFF` | Auth card surface |

**Type roles:** Inter 800 wordmark (solid `#262626`, no gradient) · Inter 400–600 body/form · JetBrains Mono 500 eyebrow, placeholders, validation.

**Signature:** CSS windowpane tartan on parchment + natural Scotty on a red rule. No dark panel, glow, swoosh, or `cmu-tartan-wave.png`.

---

### Component inventory

States for every interactive control: **default · focus · error · disabled · loading** (where applicable). Non-interactive elements list default only.

#### Shared shell (both tab modes)

| Element | Default | Focus | Error | Disabled | Loading |
|---------|---------|-------|-------|----------|---------|
| **Page canvas** (`auth-page`) | Parchment `#F5F0EA`; fixed tartan layer at ~6–8% effective opacity | — | — | — | — |
| **Tartan layer** (CSS pseudo on canvas) | `repeating-linear-gradient` windowpane: red + charcoal + faint gold hairline; `pointer-events: none` | — | — | — | — |
| **Content column** | `max-width: 560px`; centered; vertical padding | — | — | — | — |
| **Brand block** | Stacked center: Scotty → rule → eyebrow → wordmark → tagline | — | — | — | — |
| **Scotty image** | `docs/scotty-head.png`, ~96px wide, natural colors, centered | — | — | — | — |
| **Red rule** | 3px × ~64px Carnegie Red bar under Scotty | — | — | — | — |
| **Eyebrow** | `CMU-Q CURRICULUM EXPLORER`, mono, uppercase, Carnegie Red | — | — | — | — |
| **Wordmark** | `CountsFor`, Inter 800, `#262626`, live type | — | — | — | — |
| **Tagline (lede)** | See copy section; Slate body, centered | — | — | — | — |
| **Auth card** | White `#FFFFFF`, 1px `#E2DACF`, soft shadow, `border-radius` ~12px, full width of column | — | — | — | — |
| **Card footer** | `Carnegie Mellon University · Qatar`, small centered Carnegie Red text (live type, not image) | — | — | — | — |

#### Tab bar (Sign in · Create account modes only)

| Element | Default | Focus | Error | Disabled | Loading |
|---------|---------|-------|-------|----------|---------|
| **Tab strip** | Two equal tabs; bottom border `#E2DACF` on strip | — | — | — | — |
| **Tab — inactive** | `#5B6770`, Inter 600 | — | — | — | — |
| **Tab — active** | `#262626`, Inter 700, 3px Carnegie Red **bottom** underline (not pill) | `focus-visible`: outline on tab | — | — | — |
| **Tab — hover** (inactive) | `#3A3F44` | — | — | — | — |

Switching tabs must not shift brand block or card width; only card interior changes.

#### Sign in mode

| Element | Default | Focus | Error | Disabled | Loading |
|---------|---------|-------|-------|----------|---------|
| **Card heading (h1)** | `Welcome back` | — | — | — | — |
| **Form error banner** (`#cfAuthFormError`) | hidden | — | visible: Heritage Maroon left bar + message | — | — |
| **Backend alert** | hidden unless unreachable | — | amber warning strip | — | — |
| **Label — Andrew email** | `Andrew email`, Muted | — | — | — | — |
| **Email input** | border `#E2DACF`; placeholder `you@andrew.cmu.edu` (mono) | border `#C41230` + ring `rgba(196,18,48,.15)` | border `#C41230`; `.is-invalid` | — | — |
| **Email inline msg** | empty | — | `Use your @andrew.cmu.edu email address.` (mono, Carnegie Red) | — | — |
| **@andrew.cmu.edu validation** | On blur/submit: regex `^[^\s@]+@andrew\.cmu\.edu$`; reject other domains inline (not toast) | — | same string | blocks submit when invalid | — |
| **Label — Password** | `Password` | — | — | — | — |
| **Password input** | masked; border `#E2DACF` | red border + focus ring | `Enter your password.` or API `Email or password is incorrect.` under field | — | — |
| **Show / Hide toggle** | `Show`; toggles `type` password ↔ text; label becomes `Hide`; `aria-label` updates | focus ring on button | — | — | — |
| **Forgot password link** | `Forgot password?`, Carnegie Red, right-aligned under password | underline + focus outline | — | — | — |
| **Submit button** | `Sign in →`, full width, Carnegie Red | brighten slightly | — | opacity ~42% when required fields empty/invalid | spinner + `Signing in…`; `pointer-events: none` |

#### Create account mode

| Element | Default | Focus | Error | Disabled | Loading |
|---------|---------|-------|-------|----------|---------|
| **Card heading (h1)** | `Create your account` | — | — | — | — |
| **Register lede** | See copy section (`@andrew.cmu.edu` bold in Carnegie Red) | — | — | — | — |
| **Label — Full name** | `Full name` | — | — | — | — |
| **Name input** | placeholder `Your name`; optional field | focus ring | — | — | — |
| **Email field** | same as Sign in + `@andrew.cmu.edu` validation | same | same | — | — |
| **Password field** | hint `At least 8 characters` (Muted/mono); Show/Hide toggle | same | `Password must be at least 8 characters.` | — | — |
| **Confirm password** | Show/Hide toggle | same | `Passwords do not match.` (error) · `Passwords match.` (ok, green) | submit disabled until match | — |
| **Submit button** | `Create account →` | same | form banner for API errors; email field for `email_taken` | disabled until email valid + pass ≥8 + match | `Creating…` + spinner |

#### Forgot password mode (no tabs)

| Element | Default | Focus | Error | Disabled | Loading |
|---------|---------|-------|-------|----------|---------|
| **Back link** | `← Back to sign in` | focus outline | — | — | — |
| **Card heading** | `Forgot password` | — | — | — | — |
| **Lede** | See copy section | — | — | — | — |
| **Email field** | + `@andrew.cmu.edu` validation | same | same | — | — |
| **Submit** | `Send reset link →` | same | form banner | disabled until valid email | `Sending…` + spinner |
| **Reset link box** | hidden; after success shows message + `Reset my password →` link | link focus | — | — | — |

#### Reset password mode (URL `?reset=&email=`, no tabs)

| Element | Default | Focus | Error | Disabled | Loading |
|---------|---------|-------|-------|----------|---------|
| **Card heading** | `Set a new password` | — | — | — | — |
| **Lede** | `Choose a new password for **{email}**.` | — | — | — | — |
| **New password + confirm** | hints + Show/Hide on both | same | length/mismatch messages | disabled until valid | `Saving…` / `Update password →` |

#### Post-auth (out of scope for landing paint, same session)

Faculty seed → faculty view (no onboarding). Student → major/minor onboarding once. Documented so landing copy does not promise a different flow.

---

### Wireframes

#### Desktop (content column max ~560px, centered on full viewport)

```
┌──────────────────────────────────────────────────────────────┐
│ ░░░░░░░░░  parchment + CSS windowpane tartan  ░░░░░░░░░░░░░ │
│                                                              │
│                    ┌─────────────────┐                       │
│                    │   [Scotty 96]   │                       │
│                    │   ─── red ───   │                       │
│                    │ CMU-Q CURRIC…   │  mono eyebrow         │
│                    │   CountsFor     │  Inter 800            │
│                    │  tagline lede   │  2–3 lines            │
│                    └─────────────────┘                       │
│                    ┌─────────────────┐                       │
│                    │ Sign in│Create  │  tabs + red underline │
│                    │─────────────────│                       │
│                    │ Welcome back    │  h1                   │
│                    │ Andrew email    │                       │
│                    │ [you@andrew…  ] │                       │
│                    │ Password  [Show]│                       │
│                    │      Forgot?    │                       │
│                    │ [ Sign in →   ] │                       │
│                    │ CMU · Qatar      │  footer               │
│                    └─────────────────┘                       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### Mobile (360px wide)

```
┌────────────────────────────┐
│ ░ tartan parchment ground ░ │
│         [Scotty]            │
│         ── red ──           │
│    CMU-Q CURRICULUM…        │
│       CountsFor             │
│   tagline (narrow wrap)     │
│ ┌──────────────────────────┐│
│ │ Sign in │ Create account ││
│ │──────────────────────────││
│ │ Welcome back             ││
│ │ email / password / …       ││
│ │ [ Sign in → ]            ││
│ │ Carnegie Mellon · Qatar    ││
│ └──────────────────────────┘│
└────────────────────────────┘
```

Card uses ~16px side margin; brand block stays centered above card; register form scrolls inside card if viewport height < 700px (button pinned in actions row).

---

### On-page copy (final)

**Brand block (static on all tab modes except Forgot/Reset replace card content only — brand block unchanged):**

| Element | Copy |
|---------|------|
| Eyebrow | `CMU-Q CURRICULUM EXPLORER` |
| Wordmark | `CountsFor` |
| Tagline | `See what every course counts for across Computer Science, Information Systems, Business, and Biological Sciences.` |

**Sign in tab**

| Element | Copy |
|---------|------|
| Tab labels | `Sign in` · `Create account` |
| Heading | `Welcome back` |
| Label | `Andrew email` |
| Placeholder | `you@andrew.cmu.edu` |
| Label | `Password` |
| Toggle | `Show` / `Hide` |
| Link | `Forgot password?` |
| Submit | `Sign in →` |
| Loading | `Signing in…` |

**Create account tab**

| Element | Copy |
|---------|------|
| Heading | `Create your account` |
| Lede | `Use your @andrew.cmu.edu email. Faculty in our directory are recognized automatically; everyone else starts as a student.` (`@andrew.cmu.edu` emphasized) |
| Label | `Full name` |
| Placeholder | `Your name` |
| Labels | `Andrew email` · `Password` · `Confirm password` |
| Hint | `At least 8 characters` |
| Submit | `Create account →` |
| Loading | `Creating…` |

**Forgot password**

| Element | Copy |
|---------|------|
| Back | `← Back to sign in` |
| Heading | `Forgot password` |
| Lede | `Enter your @andrew.cmu.edu email. We'll give you a reset link you can use below.` |
| Submit | `Send reset link →` |

**Reset password**

| Element | Copy |
|---------|------|
| Heading | `Set a new password` |
| Lede | `Choose a new password for **{email}**.` |
| Submit | `Update password →` |

**Validation & system strings (verbatim — mono, Carnegie Red unless noted)**

| Trigger | Copy |
|---------|------|
| Invalid email domain | `Use your @andrew.cmu.edu email address.` |
| Empty password (sign in) | `Enter your password.` |
| Wrong credentials (401) | `Email or password is incorrect.` |
| Password too short | `Password must be at least 8 characters.` |
| Confirm mismatch | `Passwords do not match.` |
| Confirm match | `Passwords match.` (ok state, green) |
| Backend unreachable | `Could not reach the server — wait ~30s and refresh.` |
| Reset success toast | `Password updated — sign in with your new password.` |

**Card footer:** `Carnegie Mellon University · Qatar`

---

### Type scale

| Role | Face | Size | Weight | Color | Notes |
|------|------|------|--------|-------|-------|
| Wordmark | Inter | 40px desktop / 32px mobile | 800 | `#262626` | `letter-spacing: -0.03em`; no gradient |
| h1 (card heading) | Inter | 26px | 800 | `#262626` | Single line preferred |
| Lede (tagline + register intro) | Inter | 15px | 400 | `#3A3F44` | Tagline `max-width: 42ch`; lede `line-height: 1.55` |
| Tab | Inter | 14px | 600 inactive / 700 active | Muted / Tartan Black | Underline active, not pill |
| Label | Inter | 12px | 700 | `#5B6770` | Above fields |
| Body (links, back, footer) | Inter | 13–14px | 600 | Red or Muted | Footer 12px |
| Input text | Inter | 15px | 400 | `#262626` | |
| Mono (eyebrow, placeholder, validation) | JetBrains Mono | 11px eyebrow / 12px validation / 15px placeholder | 500 | eyebrow Red; validation Red or green ok | eyebrow `letter-spacing: 0.14em` |
| Submit | Inter | 15px | 700 | `#FFFFFF` on `#C41230` | Full-width, radius 999px |

---

### Image & decoration list (exact)

| Asset / element | Implementation |
|-----------------|----------------|
| **`docs/scotty-head.png`** | Centered `<img>` in brand block, `width: 96px`, `height: auto`, no `filter`, no badge/glow. Sits directly above a centered 3px × 64px `background: #C41230` rule (or `<hr>` styled). Repo path today: `assets/img/scotty-head.png` — alias or move to `docs/` at implement time. |
| **Tartan ground** | CSS only on `.auth-page::before` (fixed, inset 0): layered `repeating-linear-gradient` windowpane — e.g. vertical/horizontal 1px lines in `rgba(196,18,48,.08)`, `rgba(38,38,38,.04)`, `rgba(180,150,80,.05)` at ~24–32px repeat; overall layer opacity ≤ 0.35 so parchment reads as texture not wallpaper. **Do not** use `cmu-tartan-wave.png`. |
| **`CountsFor` wordmark** | Live text (`<h1>`), not an image. |
| **CMU-Q footer line** | Live text in card footer, not `cmuq-wordmark.png` (matches approved mock). Optional wordmark swap only if requested later. |
| **Excluded** | `cmu-swoosh-red-*.png`, dark gradients, `filter: invert` on Scotty, split-panel layout. |

---

### Functional confirmations

- **`@andrew.cmu.edu` validation:** Required on Sign in, Create account, and Forgot password email fields; inline mono error `Use your @andrew.cmu.edu email address.`; submit disabled until domain passes on register/sign-in; validated on blur and submit.
- **Show password:** Every password field includes `Show` / `Hide` toggle; switches input `type`; updates `aria-label`; register confirm field has independent toggle.
- **Faculty routing:** Unchanged — faculty emails in seed skip onboarding; students complete major/minor once after first sign-in.
- **Stack:** Vanilla HTML, CSS, JS only; no new dependencies.

