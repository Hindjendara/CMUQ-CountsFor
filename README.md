# CountsFor

A role-aware curriculum explorer for Carnegie Mellon University in Qatar. Students, faculty and advisors look up any course and see exactly which major, minor and Gen Ed requirements it counts for, plan schedules, save courses and flag catalog mistakes. Admins edit the catalog and see usage.

**Live site:** [adicmu.github.io/Countsfor-Summer-26](https://adicmu.github.io/Countsfor-Summer-26/) · **API:** `https://countsfor-summer-26.onrender.com` · **Repo:** [Adicmu/Countsfor-Summer-26](https://github.com/Adicmu/Countsfor-Summer-26)

**Quick start:** see [section 5](#5-local-setup-from-a-fresh-mac). In short: create a virtualenv and `pip install -r requirements.txt`, run the API with `python -m backend.app` (port 5050), serve the site with `python3 -m http.server 8765`, and open `http://localhost:8765/`.

## About this README

This README is the project's complete maintainer manual. It was written so that a new student developer can take over CountsFor alone, with no access to the original authors. Every statement was checked against the code on `main` in November 2026 unless it is explicitly marked as uncertain. If anything else in the repo disagrees with this file, trust this file and the code, and then fix whichever is wrong.

Written: November 2026. Keep it current: when you change how something works, update the matching section in the same commit.

---

## Table of contents

1. [What CountsFor is](#1-what-countsfor-is)
2. [Glossary](#2-glossary)
3. [Architecture](#3-architecture)
4. [Repository map](#4-repository-map)
5. [Local setup from a fresh Mac](#5-local-setup-from-a-fresh-mac)
6. [Environment variables (complete table)](#6-environment-variables-complete-table)
7. [Signing in locally and making yourself admin](#7-signing-in-locally-and-making-yourself-admin)
8. [Frontend walkthrough](#8-frontend-walkthrough)
9. [Backend walkthrough](#9-backend-walkthrough)
10. [API reference (every route)](#10-api-reference-every-route)
11. [Database: tables, schema changes and migrations](#11-database-tables-schema-changes-and-migrations)
12. [Course overrides (admin catalog edits)](#12-course-overrides-admin-catalog-edits)
13. [Admin analytics (sign-in activity)](#13-admin-analytics-sign-in-activity)
14. [Data pipeline (SOC scrape)](#14-data-pipeline-soc-scrape)
15. [Deployment](#15-deployment)
16. [Testing](#16-testing)
17. [Git workflow](#17-git-workflow)
18. [Project rules and conventions](#18-project-rules-and-conventions)
19. [How-to recipes](#19-how-to-recipes)
20. [Troubleshooting and FAQ](#20-troubleshooting-and-faq)
21. [Open issues and roadmap](#21-open-issues-and-roadmap)
22. [Known stale docs](#22-known-stale-docs)
23. [Handover checklist](#23-handover-checklist)

---

## 1. What CountsFor is

CountsFor is a web app for Carnegie Mellon University in Qatar (CMU-Q). It answers one question: **"What does this course count for?"** For every course in the catalog it shows which requirements it satisfies in each CMU-Q undergraduate major (Computer Science, Information Systems, Business Administration, Biological Sciences), including General Education (GenEd) categories, plus section times from CMU's Schedule of Classes.

### 1.1 Who uses it

| Audience | What they do in CountsFor | Role(s) in the app |
|---|---|---|
| Students | Search courses, see what each counts for in their major and minors, save courses with notes ("Saved" list, internally "wishlist"), build weekly schedule plans and share them | `student` |
| Faculty | Same browsing as students, plus report data problems ("flag" a course), see the flag queue, see students' saved-course roster for advising, manage the faculty directory | `professor`, `area_head`, `associate_area_head`, `advisor` (all share one permission group, `faculty`) |
| Admins | Everything faculty can do, plus the Admin page: edit the course catalog, manage user roles, see usage insights and the audit log | `admin` |
| Guests | Browse without an account (local only, nothing saved on a server) | none (demo mode) |

### 1.2 Stakeholders and people

- **Aditya Vivek** (GitHub `Adicmu`): original author and owner of the main repo `Adicmu/Countsfor-Summer-26`. CMU-Q student.
- **Hind Jendara** (GitHub `Hindjendara`): co-developer. Owns the fork `Hindjendara/Countsfor-Summer-26` (git remote `hind`). AI and GS requirement data was expected to come from her (see `js/data.js` line 16).
- CMU-Q faculty, area heads and advisors: the faculty directory in `data/faculty_directory.json` (65 people scraped from the public CMU-Q People page) decides who gets faculty access.
- CMU-Q IT: owns the `countsfor.qatar.cmu.edu` hostname (see [15.4](#154-countsforqatarcmuedu)).
- Upstream data source: the course-to-requirement mappings originally came from the older open-source project [open-cmuq/CountsFor](https://github.com/open-cmuq/CountsFor) (credited in `README.md`).

### 1.3 What it is not

- It is not an official degree audit. Mappings come from upstream data plus manual overlays and admin edits.
- AI (Artificial Intelligence) and GS (General Studies) majors are defined in `js/data.js` (marked `dataPending`) but have **no requirement data** and are not in `MAJOR_ORDER`.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **SOC** | Schedule of Classes. CMU's public course offering site at `https://enr-apps.as.cmu.edu/open/SOC/SOCServlet`. The scraper reads sections, days, times, campus and modality from it. |
| **Semester codes** | `F26` = Fall 2026, `S26` = Spring 2026, `M26` = Summer 2026, `N26` = Fall mini (see `SEASON_NAME` in `js/data.js`). Backend validates with regex `^[FSMN]\d{2}$`. |
| **Course code** | Always normalized to `NN-NNN`, e.g. `15-122`. `normalizeCourseCode()` in `js/data.js` and `_normalize_code()` in `backend/course_overrides.py` accept `15122`, `15122.0`, `15-122`. |
| **Requirement path** | A string of segments joined by three hyphens, e.g. `GenEd---GenEd---Foundations---Contextual Thinking`. The frontend splits on `---` to build the requirement tree. |
| **`type` on a requirement** | Boolean. `true` means GenEd, `false` means a major (core) requirement. |
| **GenEd** | General Education. University core requirements every student in a major must satisfy (humanities, cultural analysis and so on). `splitTreeSections()` treats top-level nodes named `GenEd` or containing `University Core`, `EY2022`, `EY2024` as GenEd. |
| **Majors** | `CS` Computer Science, `IS` Information Systems, `BA` Business Administration, `BS` Biological Sciences. Live in `MAJOR_ORDER`. Scaffolded but not live: `AI`, `GS`. |
| **`AS`** | "Arts & Sciences". Not a major. A grouping used as the `primary_program` of cross-program faculty and as the default program for directory entries (`DEFAULT_DIRECTORY_PROGRAM = "AS"`). Students can never pick it. |
| **Minors** | Codes in `VALID_MINORS_FOR_PATCH` (`backend/auth.py`) and `MINOR_LIST` (`js/profile.js`): arabic, biology, business, cs, economics, finance, history, math, neuroscience, product, writing, psychology, sociology, self_defined, tech_entre. Course lists per minor are in `data/minor_courses.json` (only `business` and `cs` are populated). A student cannot take a minor in their own major field (`MAJOR_MINOR_COLLISION`). |
| **Role** | Exact title stored on the user: `student`, `professor`, `area_head`, `associate_area_head`, `advisor`, `admin`. |
| **Role group** | Permission bucket computed by `User.role_group()`: `student`, `faculty` (the four faculty titles), `admin`. **All permission checks use role groups**, except a few student-only routes that use the exact role. |
| **Directory** | The list of people who get faculty or admin access. Two layers: a JSON seed file (static) plus the `directory_entries` table (editable, wins on conflict). Your role is recomputed from the directory **on every sign-in**. |
| **Flag** | A data-problem report a faculty member files against a course (reason codes in `backend/flags.py`). Statuses: `pending`, `reviewed`, `resolved`, `dismissed`. |
| **Wishlist / Saved** | A student's saved courses with optional notes (`wishlist_items`). The UI calls it "Saved". |
| **Plan / schedule plan** | A weekly schedule built from course sections. Stored in browser localStorage; the server only stores shared copies. |
| **Override** | An admin edit to the course catalog stored in the database (`course_overrides`) and applied in the browser on top of the scraped `data/courses.json`. |
| **Mapping overlay** | A manual, additive requirement mapping in `data/mapping_overlays.json`, applied to the catalog file by the scrape pipeline. |
| **Demo mode / guest mode** | Running the frontend without a signed-in user. Everything is local to the browser. |
| **Render** | The hosting company that runs the Flask backend and its Postgres database. |
| **GitHub Pages** | Static hosting for the frontend. |

---

## 3. Architecture

### 3.1 Big picture

```
                          +-------------------------------------------+
                          |  Browser                                  |
                          |                                           |
   index.html (landing) --+-> js/utils.js, js/api.js, js/landing.js   |
        |  sign in / register / forgot / reset / guest                |
        v                                                             |
   app.html (main app) ---+-> js/utils.js -> js/data.js ->            |
                          |   js/profile.js -> js/api.js -> js/app.js |
                          |                                           |
                          |   localStorage / sessionStorage           |
                          |   (token, profile, plans, theme, ...)     |
                          +-----------+-------------------+-----------+
                                      |                   |
             static files (same origin)                   | JSON over HTTPS, cross origin
             data/courses.json  (~24 MB)                  | credentials: include
             data/minor_courses.json                      | Authorization: Bearer <token>
                                      |                   v
          +---------------------------+---+   +-----------------------------------+
          | GitHub Pages                  |   | Render web service (Flask)        |
          | adicmu.github.io/             |   | countsfor-summer-26.onrender.com  |
          |   Countsfor-Summer-26         |   | gunicorn 'backend.app:create_app()'|
          | (whole repo uploaded as-is)   |   |  blueprints: auth, flags,         |
          +---------------^---------------+   |  wishlist, users, directory,      |
                          |                   |  search-analytics, plans, admin,  |
                          | commit + deploy   |  course overrides, /health        |
                          |                   +-----------------+-----------------+
          +---------------+---------------+                     |
          | GitHub Actions                |                     v
          |  scrape.yml (daily SOC)       |   +-----------------------------------+
          |  pages.yml  (deploy Pages)    |   | Postgres (Render, "CountsFor_     |
          |  keepalive.yml (ping /health) |   |  Summer_2026"); SQLite locally    |
          +---------------+---------------+   +-----------------------------------+
                          |
                          v
          CMU Schedule of Classes (enr-apps.as.cmu.edu)
```

### 3.2 Key ideas

1. **Zero-build frontend.** Plain HTML, CSS and JavaScript. No npm, no bundler, no framework. Files are loaded with `<script>` tags in a fixed order and share globals. What is in the repo is exactly what is served.
2. **The course catalog is a static file.** `data/courses.json` (6,385 courses, about 24 MB) is downloaded by the browser on every app load. The backend does not serve course data. The daily scrape workflow rewrites this file and commits it.
3. **The backend stores people and their activity**: users, roles, directory, flags, saved courses, shared plans, search counts, admin catalog edits and the audit log.
4. **Admin catalog edits are layered on top of the static file in the browser** (`applyCourseOverrides()` in `js/data.js`), because the scrape would overwrite any edit made directly in `data/courses.json`. See [section 12](#12-course-overrides-admin-catalog-edits).
5. **Security lives on the backend.** The UI hides buttons based on role, but every protected route checks the role group server side.

### 3.3 Where the frontend finds things

There are two different "base URLs" in `js/api.js`. Do not confuse them.

| Constant / function | Used for | Value / logic |
|---|---|---|
| `LOCAL_DATA` | The course catalog | `data/courses.json` with `?v=<cf-build meta>` appended by `_bundledDataUrl()` |
| `getBackendUrl()` / `CF_BACKEND_URL` | **The Flask backend** (all `/api/...` calls) | See resolution order below |

`fetchAllCourses()` loads only the bundled `data/courses.json`. There is no remote fallback: if the file cannot be loaded or has no courses, it throws and `App.loadData()` shows "Failed to load data".

`getBackendUrl()` resolution order (in `js/api.js`, used by both pages):

1. `localStorage['cf_backend_override']` if set (manual escape hatch).
2. `window.CF_BACKEND_URL` if set before `api.js` loads.
3. If the page hostname is `localhost`, `127.0.0.1` or empty: **`http://localhost:5050`** (hardcoded).
4. `<meta name="cf-backend-url">` in the HTML (currently `https://countsfor-summer-26.onrender.com` in both `index.html` and `app.html`).
5. Hardcoded fallback `https://countsfor-summer-26.onrender.com`.

`isBackendConfigured()` returns true when the `cf-backend-url` meta tag is present and non-empty. Because both HTML files ship that tag, it is effectively always true, which means the "demo mode when the backend is unreachable" branch in `App.init()` is now only reachable through guest mode.

### 3.4 Authentication model

- Two ways to prove identity: **email + password** (`/api/auth/register`, `/api/auth/login`) and **Google Sign-In** (`/api/auth/google`, verifies a Google ID token against `GOOGLE_CLIENT_ID`). The old passwordless route `/api/auth/email` was removed in November 2026.
- After sign-in the server sets a signed Flask session cookie `cf_session` **and** returns an `auth_token` in the JSON body. The token is an `itsdangerous` signed `{"uid": id}` valid for 30 days (`backend/tokens.py`). The frontend stores it and sends `Authorization: Bearer <token>` on every call, because browsers often block third-party cookies between `github.io` and `onrender.com`.
- Token storage: `sessionStorage['cf_auth_token']` by default, or `localStorage['cf_auth_token']` if the user ticked "Keep me signed in" on the landing page.
- On every sign-in the backend recomputes the role from the directory (`_sync_directory_profile()` in `backend/auth.py`). This is the single most important rule to understand about roles. See [section 7](#7-signing-in-locally-and-making-yourself-admin).

### 3.5 Databases

| Environment | Database | How it is chosen |
|---|---|---|
| Production (Render) | Postgres, Render database `CountsFor_Summer_2026` (region Ohio) | `DATABASE_URL` linked from the database in `render.yaml`. `config.py` refuses to start without it when `RENDER=true` or `FLASK_ENV=production`. |
| Local | SQLite file | Any relative `sqlite:///name.db` URL is rewritten to `<repo>/instance/name.db`. With no `DATABASE_URL` at all, local dev also falls back to `<repo>/instance/countsfor.db`. |
| Tests | In-memory SQLite | `TestConfig.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"` |

Supabase was once considered as an alternative Postgres host. Nothing in the code is Supabase specific; it would work with any Postgres URL. There is no evidence that Supabase is used in production today.

---

## 4. Repository map

### 4.1 Top level

| Path | Tracked in git? | What it is | Status |
|---|---|---|---|
| `index.html` | yes | Landing page: sign in, create account, forgot and reset password, "Continue as guest". Loads `js/utils.js`, `js/api.js` and `js/landing.js`. | Live |
| `app.html` | yes | Main app shell. Loads `utils.js`, `data.js`, `profile.js`, `api.js`, `app.js` in that order. Holds the `cf-build` cache tag, backend URL meta and Google client ID meta. | Live |
| `reset.html` | yes | Redirect stub to `index.html` keeping the query string (old reset links). | Keep |
| `landing/index.html` | yes | Redirect stub to `../index.html`. | Keep (old links) |
| `landing/DESIGN_NOTES.md` | yes | Landing design notes. | Reference only |
| `.nojekyll` | yes | Tells GitHub Pages to serve files as-is. | Keep |
| `js/` | yes | All frontend logic. See [section 8](#8-frontend-walkthrough). | Live |
| `css/styles.css` | yes | App styles, about 5,500 lines, light and dark tokens at the top. | Live |
| `css/landing.css` | yes | Landing page styles. | Live |
| `assets/img/` | yes | Scotty and CMU artwork used by the landing and navbar, plus the two favicons (`scotty-portrait.png` for the landing, `scotty-standing.png` for the app). | Live |
| `backend/` | yes | Flask API. See [section 9](#9-backend-walkthrough). | Live |
| `data/` | yes | Catalog JSON files and the scrape pipeline scripts. See [section 14](#14-data-pipeline-soc-scrape). | Live |
| `scripts/bump_cf_build.py` | yes | Rewrites the `cf-build` meta and every `?v=` tag in `app.html`, and every `?v=` tag in `index.html`. Run by the scrape workflow. | Live |
| `scripts/run-data-tests.js` | yes | Node runner for `tests/profile.test.js` and `tests/data.test.js`, with an in-memory `localStorage`. | Live |
| `tests/` | yes | Browser test page (`tests/test.html`) and JS unit tests. | Live |
| `.github/workflows/` | yes | `scrape.yml`, `pages.yml`, `keepalive.yml`. | Live |
| `render.yaml` | yes | Render Blueprint for the backend and database. | Live |
| `requirements.txt` | yes | One line: `-r backend/requirements.txt`. Render installs from the repo root. | Live |
| `runtime.txt` | yes | `python-3.11.9`. | Live |
| `README.md` | yes | This manual. | Keep current |
| `docs/` | yes | `docs/analytics-plan/` (the team analytics plan, HTML source and PDF) and `docs/archive/` (sprint plans, proposals, progress report, wireframes, UX review and design specs from 2026; history only, not current truth). | Reference |
| `Testing/` | yes | A tiny mock SOC Flask server for testing the scraper offline (`Testing/app.py`, `Testing/readMe`). Its readme references `scraper/scrape_soc.py`, which is now `data/scrape_soc.py`. | Legacy but usable |
| `CONTEXT.md` | **no** (gitignored) | A long "complete project context" doc that exists only on the original author's laptop. A successor cloning the repo will not have it. | Local only |
| `server.log` | no (gitignored) | Local log file. | Local only |
| `instance/` | no (gitignored) | Local SQLite databases. | Local only |
| `Branding Assets/` | no (gitignored) | Design source files. | Local only |
| `.venv/`, `backend/.venv/` | no | Local Python virtual environments. | Local only |
| `.claude/`, `.superpowers/` | no | AI assistant working folders, including a git worktree `.claude/worktrees/role-aware-onboarding`. | Local only |

### 4.2 `backend/`

| File | Purpose |
|---|---|
| `app.py` | App factory `create_app()`, `init_database()`, CORS setup, blueprint registration, `/health`, JSON 404, dev entry point (`python -m backend.app`). |
| `config.py` | Every setting, read from environment variables. Loads `backend/.env` if present. Also `TestConfig`. |
| `db.py` | The shared `SQLAlchemy()` instance. |
| `models.py` | All ORM models (14 tables) and role constants (`VALID_ROLES`, `FACULTY_ROLES`, `VALID_DEPARTMENTS`, `FLAG_STATUSES`). |
| `db_schema.py` | `REQUIRED_TABLES` (checked by `/health` and bootstrap) and URL redaction helpers. |
| `migrate.py` | Hand-written, idempotent `ALTER TABLE` and `CREATE TABLE` steps for databases that predate a model change. |
| `bootstrap_db.py` | `python -m backend.bootstrap_db`: create tables, run migrations, verify required tables. Render pre-deploy command. |
| `permissions.py` | `require_login`, `require_role_group`, `require_role`, `current_user`, user loading from cookie or bearer token. |
| `tokens.py` | Bearer token sign and verify. |
| `cmu.py` | The one backend CMU email check: `normalize_cmu_email()` (accepts `andrew.cmu.edu`, `cmu.edu`, `qatar.cmu.edu`, always returns `@andrew.cmu.edu`, rejects an empty local part, whitespace or a second `@`; same rules as `normalizeCmuEmail()` in `js/utils.js`) and `email_in_domain()` (the `ALLOWED_EMAIL_DOMAIN` check). Also seed file helpers. Used by `auth.py`, `directory.py`, `directory_routes.py` and `plans.py`. |
| `auth.py` | Register, login, forgot and reset password, set password, Google sign-in, logout, `GET/PATCH /api/me`, role and profile validation. |
| `directory.py` | Directory lookup logic (DB first, then JSON seed). |
| `directory_routes.py` | `/api/directory/...` routes. |
| `users.py` | `/api/users` list and role edit (admin only). |
| `admin.py` | `/api/admin/overview`, `/insights`, `/sign-ins`, `/activity`, and `record_event()` used by everyone to write audit rows. |
| `activity.py` | Sign-in and visit tracking for the analytics page (`mark_signed_in`, `record_visit`, Qatar day helper). See section 13. |
| `course_overrides.py` | `/api/courses/overrides` routes for catalog edits. |
| `flags.py` | `/api/flags` routes. |
| `wishlist.py` | `/api/wishlist` routes. |
| `plans.py` | `/api/plans` routes (list, share by email, share link, accept link). |
| `search_analytics.py` | `/api/search-analytics` (course lookup counts per program and semester). |
| `email_util.py` | Password reset email via Resend API or SMTP. **This is the one in use.** |
| `Procfile` | `web:` gunicorn command (same as `render.yaml` start command). |
| `requirements.txt` | Pinned Python dependencies (Flask 3.0.3, Flask-SQLAlchemy 3.1.1, flask-cors, SQLAlchemy 2.0.51, psycopg2-binary, google-auth, requests, itsdangerous, gunicorn, python-dotenv, pytest). |
| `runtime.txt` | `python-3.11.9`. |
| `.env.example` | Template for `backend/.env`. |
| `.env` | Your local settings. Gitignored. |
| `seed_users.example.json` | Example directory seed rows. |
| `seed_users.json` | Optional local directory seed. Gitignored by `backend/.gitignore`. |
| `README.md` | Points to this manual. |
| `tests/` | Pytest suite. |

### 4.3 `data/`

| File | Purpose |
|---|---|
| `courses.json` | **The catalog the app loads.** `{ "_meta": {...}, "courses": [ ... ] }`. Each course: `course_code`, `course_name`, `department`, `units`, `description`, `prerequisites`, `offered` (semester codes), `offered_qatar`, `offered_pitts`, `requirements` (`{CS: [...], IS: [...], BA: [...], BS: [...]}`), `soc_sections`, `offerings`. |
| `soc.json` | Raw SOC scrape output (`metadata.last_scrape`, `semesters`). About 23 MB. The admin Overview reads `last_scrape` from its first 4 KB. |
| `mapping_overlays.json` | Manual additive requirement mappings (9 overlays as of Nov 2026). |
| `minor_courses.json` | Course lists per minor (only `business` and `cs` populated). Loaded by `fetchMinorCourses()`. |
| `faculty_directory.json` | 65 CMU-Q faculty scraped from the public People page. Used as the directory seed in production (`SEED_USERS_PATH=data/faculty_directory.json` in `render.yaml`). |
| `scrape_soc.py` | Scraper. |
| `soc_parse.py`, `soc_departments.py` | Shared parsing helpers. |
| `json_io.py` | Shared `load_json` and `save_json` helpers for the pipeline scripts. |
| `reconcile_offerings.py` | Merges `soc.json` into `courses.json`: offerings, campus flags, units. |
| `apply_mapping_overlays.py` | Applies `mapping_overlays.json` to `courses.json`. |
| `validate_soc_coverage.py` | Fails if a SOC course is missing from `courses.json`. |
| `scrape_faculty_directory.py` | Builds `faculty_directory.json` or `backend/seed_users.json` from the CMU-Q People page (Algolia search). Run by hand. |
| `tests/` | Pytest tests for the pipeline (29 tests). |

---

## 5. Local setup from a fresh Mac

These steps were run end to end in November 2026.

### 5.1 Install tools

```bash
# Xcode command line tools (git, make)
xcode-select --install

# Homebrew (skip if installed): see https://brew.sh
# Python 3.11 matches production (runtime.txt says python-3.11.9).
brew install python@3.11 node gh
```

Python 3.12 and 3.13 also work for local development and tests (both were used successfully), but use 3.11 if you want to match production exactly. Node is only needed to run the JS data tests from the command line.

### 5.2 Clone

```bash
git clone https://github.com/Adicmu/Countsfor-Summer-26.git CountsFor
cd CountsFor
git remote add hind https://github.com/Hindjendara/Countsfor-Summer-26.git   # optional, partner fork
```

The repo history is large (about 145 MB packed) because the daily scrape commits multi-megabyte data files and old screenshots remain in history.

### 5.3 Python environment

Always run backend commands **from the repo root**, never from inside `backend/`. The backend is a package with relative imports; `python app.py` inside `backend/` fails with "attempted relative import with no known parent package".

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt      # pulls backend/requirements.txt
```

### 5.4 Configure `backend/.env`

```bash
cp backend/.env.example backend/.env
```

Then edit `backend/.env`:

- `SECRET_KEY`: any long random string locally. Generate one: `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
- `DATABASE_URL=sqlite:///countsfor.db` (becomes `<repo>/instance/countsfor.db`).
- `FRONTEND_ORIGIN=http://localhost:8765` (must match the port you serve the frontend on).
- `EXPOSE_RESET_TOKEN=1` (lets you test password reset without email).
- Leave `FLASK_ENV` unset. Setting it to `production` makes `config.py` refuse SQLite and crash at import.
- `GOOGLE_CLIENT_ID` can stay empty. The Google button will then fail with "GOOGLE_CLIENT_ID not set on the server", which is fine locally.

`config.py` loads `backend/.env` automatically (`python-dotenv`). Real environment variables win over `.env` values.

### 5.5 Create the database and start the backend

```bash
python -m backend.bootstrap_db   # creates tables, runs migrations, verifies (prints a SQLite warning, that is expected)
python -m backend.app            # http://localhost:5050
```

- Default port is **5050** (`PORT` env var). Not 5000: macOS AirPlay Receiver occupies 5000 and answers 403.
- `python -m backend.app` also runs `create_all()` and migrations on every start unless `SKIP_DB_BOOTSTRAP=1`, so the bootstrap step is optional locally.
- Debug mode is on by default (`FLASK_DEBUG` defaults to `"1"`).
- Check it: `curl http://localhost:5050/health` returns `{"database":"sqlite","db_host":"sqlite","status":"ok"}`.

Alternative with the Flask CLI (equivalent, port is your choice):

```bash
flask --app 'backend.app:create_app()' run --port 5050
```

### 5.6 Serve the frontend

In a second terminal, from the repo root:

```bash
python3 -m http.server 8765
```

Open `http://localhost:8765/`. Use port **8765** unless you also change `FRONTEND_ORIGIN`. Any other port is rejected by CORS and the UI says it "could not reach the server".

If you must run the backend on a port other than 5050 (for example because 5050 is busy), the frontend still calls `http://localhost:5050` because that is hardcoded for localhost. Point it elsewhere in the browser console:

```js
localStorage.setItem('cf_backend_override', 'http://localhost:5099');
location.reload();
// undo with: localStorage.removeItem('cf_backend_override')
```

### 5.7 First visit behaviour

1. `http://localhost:8765/` serves `index.html` (landing). `js/landing.js` renders the sign-in panel immediately, then probes `GET /api/me` in the background.
   - If you already have a valid session and have not typed anything, it redirects to `app.html`.
   - If the backend is unreachable, it shows an "accounts unavailable" banner with a guest link.
2. "Continue as guest" sets `sessionStorage['cf_guest'] = '1'` and opens `app.html`. The app boots in demo mode with a default profile (student, CS) and never calls `/api/me`.
3. Opening `app.html` directly without a session redirects back to `index.html` (because the backend meta tag is present).
4. `app.html?token=...` or `?reset=...` redirects to `index.html` with the same parameter, which opens the reset password view.
5. `?share_plan=<token>` survives the login redirect via `sessionStorage['cf_pending_share_plan']` and is imported after sign-in.
6. A freshly bootstrapped database has no users. Use **Create account** first.

---

## 6. Environment variables (complete table)

### 6.1 Backend (`backend/config.py`, `backend/app.py`, `backend/auth.py`)

| Name | Required? | Default | Purpose |
|---|---|---|---|
| `SECRET_KEY` | **Yes in production** | `dev-only-change-me` | Signs the session cookie and the bearer `auth_token`. Changing it signs everyone out. Render generates it (`generateValue: true`). |
| `DATABASE_URL` | **Yes on Render or when `FLASK_ENV=production`** | none (local falls back to `sqlite:///<repo>/instance/countsfor.db`) | SQLAlchemy URL. `postgres://` is rewritten to `postgresql://`. Relative SQLite paths are anchored to `<repo>/instance/`. |
| `RENDER` | Set by Render | unset | When `true`: production cookie settings, and the app refuses to start without `DATABASE_URL`. |
| `FLASK_ENV` | Yes on Render (`production` in `render.yaml`) | `development` | `production` turns on Secure, `SameSite=None` cookies and forbids SQLite. Never set it locally. |
| `ALLOW_SQLITE` | No | unset | Mentioned in `.env.example` and docs, but **has no effect**: outside production SQLite is always allowed, and in production it is always refused. |
| `SKIP_DB_BOOTSTRAP` | No | unset | `1` skips `create_all()` and migrations inside `create_app()`. Production start command sets it because Render runs `bootstrap_db` in pre-deploy instead. |
| `ALLOW_BOOTSTRAP_SKIP` | No (recovery only) | unset | `1` lets a failed bootstrap continue and makes `/health` return 200 even when degraded. Only for recovering from an expired or deleted Render database (section 15.2). Remove afterwards. |
| `GOOGLE_CLIENT_ID` | Yes for Google sign-in | empty | OAuth web client ID used to verify Google ID tokens. Not a secret. Must match the `cf-google-client-id` meta tag. |
| `ALLOWED_EMAIL_DOMAIN` | No | empty (any CMU domain) | If set (production uses `andrew.cmu.edu`), only that domain may sign in. Note that `normalize_cmu_email()` already rewrites `cmu.edu` and `qatar.cmu.edu` to `andrew.cmu.edu` and rejects all non-CMU addresses. |
| `ADMIN_EMAILS` | No | empty | **Ignored by sign-in.** Kept only so old deploy configs do not break. Admin comes only from the directory. |
| `SEED_USERS_PATH` | No | `backend/seed_users.json` | JSON directory seed. Production uses `data/faculty_directory.json`. Relative paths are resolved against the current directory, `backend/`, then the repo root. |
| `RESET_TOKEN_MINUTES` | No | `30` | Password reset link lifetime. |
| `FRONTEND_RESET_BASE` | No | empty | Base URL for reset links in emails. Production: `https://adicmu.github.io/Countsfor-Summer-26/index.html`. If empty, falls back to `PUBLIC_APP_URL`, then to the first `FRONTEND_ORIGIN` plus `/index.html`. |
| `PUBLIC_APP_URL` | No | empty | Fallback for `FRONTEND_RESET_BASE`. |
| `RESEND_API_KEY` | One email provider needed for email resets | empty | Resend API key. Tried first. Secret. |
| `MAIL_FROM` | With Resend (or SMTP) | empty | From address. `SMTP_FROM` is accepted as an alias. |
| `SMTP_FROM` | No | empty | Alias for `MAIL_FROM`. |
| `SMTP_HOST` | For SMTP | empty | e.g. `smtp.gmail.com`. |
| `SMTP_PORT` | No | `587` | SMTP port. |
| `SMTP_USER` | For SMTP | empty | SMTP login. |
| `SMTP_PASS` | For SMTP | empty | SMTP password (Gmail app password). Secret. `SMTP_PASSWORD` is accepted as an alias. |
| `SMTP_PASSWORD` | No | empty | Alias for `SMTP_PASS`. |
| `SMTP_USE_TLS` | No | `true` | STARTTLS on or off. |
| `FRONTEND_ORIGIN` | Yes in production | `http://localhost:8765,https://adicmu.github.io` | Comma-separated CORS allow list for `/api/*`. Origins only, no paths, no trailing slash. Production: `https://adicmu.github.io,https://hindjendara.github.io,http://localhost:8765`. |
| `EXPOSE_RESET_TOKEN` | No (dev only) | unset | `1` makes `/api/auth/forgot-password` return `reset_token` and `reset_url` in the response, and allows the flow even with no email provider. **Never set in production.** Read directly from `os.environ` in `auth.py`. |
| `HOST` | No | `127.0.0.1` | Dev server bind address (`python -m backend.app` only). |
| `PORT` | No | `5050` | Dev server port. On Render, gunicorn binds `$PORT` provided by Render. |
| `FLASK_DEBUG` | No | `1` | Dev server debug mode. |
| `PYTHON_VERSION` | Render only | `3.11.9` in `render.yaml` | Python version Render uses. |

Email behaviour summary (`forgot_password()` plus `email_util.py`): if neither Resend (`RESEND_API_KEY` + `MAIL_FROM`) nor SMTP (`SMTP_HOST` + `SMTP_USER` + `SMTP_PASS`) is configured and `EXPOSE_RESET_TOKEN` is off, the endpoint returns **503 `email_unavailable`** with `google_recovery: true` for every email, and the landing page steers the user to "Continue with Google", which then lets them set a password via `/api/auth/set-password`. As of November 2026 it is not known whether production has an email provider configured (the values are `sync: false` in `render.yaml`, set only in the Render dashboard).

### 6.2 Data pipeline scripts

| Name | Script | Default | Purpose |
|---|---|---|---|
| `SOC_BASE_URL` | `scrape_soc.py` | `https://enr-apps.as.cmu.edu/open/SOC/SOCServlet` | Point at `Testing/app.py` mock for offline tests. |
| `MIN_COURSES_FOR_VALID_SCRAPE` | same | `100` | Below this a semester scrape is treated as failed. |
| `MIN_COURSES_FOR_SUMMER_SCRAPE` | `scrape_soc.py` | `10` | Lower threshold for summer terms. |
| `SOC_OUTPUT_PATH` | `scrape_soc.py` | `data/soc.json` | Output file. |
| `SEMESTERS_TO_TRY` | `soc_departments.py` | from the SOC form | Comma list override of semesters. |
| `SOC_JSON_PATH`, `COURSES_JSON_PATH` | reconcile and validate | `data/soc.json`, `data/courses.json` | File locations. |
| `CATALOG_PATHS` | `apply_mapping_overlays.py` | `data/courses.json` | Semicolon list of catalogs to patch. |

### 6.3 Frontend configuration (no env vars, all in HTML)

| Where | What |
|---|---|
| `<meta name="cf-backend-url">` in `index.html` and `app.html` | Production backend URL. |
| `<meta name="cf-google-client-id">` in both | Google OAuth client ID (public). |
| `<meta name="cf-build">` in `app.html` | Cache tag appended to `data/courses.json`. Bumped by `scripts/bump_cf_build.py`. |
| `?v=...` on script and CSS tags | Manual cache busting. `app.html` tags are bumped by the script; `index.html` tags (`?v=home-copy-2026-08-22`) are not and must be bumped by hand. |
| `localStorage['cf_backend_override']` | Per-browser backend URL override. |

---

## 7. Signing in locally and making yourself admin

### 7.1 How roles are decided (read this first)

On **every** sign-in (`register`, `login`, `google`, `email`), the backend calls `_sync_directory_profile(user, email)`:

1. Look up the email in the `directory_entries` table. If found, use that row.
2. Otherwise look in the JSON seed. `_load_json_directory()` tries, in order, `SEED_USERS_PATH`, `backend/seed_users.json`, `backend/faculty_seed.json`, `data/faculty_directory.json`, and **uses the first file that exists and has rows** (files are not merged). Then `data/directory_admins.json` (path set by `ADMIN_SEED_PATH`; empty string disables it) is layered on top, so the admins listed there win over the faculty seed. It is a separate file because `data/scrape_faculty_directory.py` rewrites `faculty_directory.json` from scratch.
3. If a row is found: `role` comes from it (`admin` sets `is_admin`), and `name`, `primary_program`, `department`, `department_scope`, `picture_url` are copied when present. Minors are cleared.
4. If no row is found: the user becomes `student`, `is_admin = False`.

Consequences:

- **Changing someone's role on the Admin page Users tab (`PATCH /api/users/<id>`) does not stick.** It is overwritten at that person's next sign-in unless they also have a matching directory entry. This was verified locally (patched a student to professor, signed in again, back to student). To change a role permanently, change the directory (Admin page, "Faculty access" tab, or the Directory panel).
- `ADMIN_EMAILS` does nothing (it is still read into config for old deploy settings, but auth ignores it).
- Students set their own major and minors through onboarding (`PATCH /api/me`). Users can only set their own role to `student` (`SELF_SETTABLE_ROLES`).

### 7.2 Sign in locally with a password

1. Start backend and frontend (section 5).
2. Open `http://localhost:8765/`, choose **Create account**, use any `@andrew.cmu.edu` address (it does not need to be real locally) and an 8+ character password.
3. You land in `app.html` and see onboarding (pick your major) because a new student profile is incomplete.

From the command line:

```bash
curl -s -c /tmp/cf.jar -X POST -H 'Content-Type: application/json' \
  -d '{"email":"me@andrew.cmu.edu","password":"longpassword1"}' \
  http://localhost:5050/api/auth/register
curl -s -b /tmp/cf.jar http://localhost:5050/api/me
```

### 7.3 Make yourself admin locally

Pick one:

**Option A, seed file (simplest):** create `backend/seed_users.json` (gitignored):

```json
[
  {
    "email": "me@andrew.cmu.edu",
    "name": "My Name",
    "role": "admin",
    "primary_program": "AS",
    "department": "Dean's Office"
  }
]
```

Then sign out and sign in again (or create the account now). Because the first non-empty seed file wins, while `backend/seed_users.json` exists `data/faculty_directory.json` is ignored locally.

**Option B, point at a throwaway seed:** set `SEED_USERS_PATH=/absolute/path/to/my_seed.json` in `backend/.env`.

**Option C, insert a directory row directly:**

```bash
python - <<'EOF'
from backend.app import create_app
from backend.db import db
from backend.models import DirectoryEntry
app = create_app()
with app.app_context():
    db.session.add(DirectoryEntry(email="me@andrew.cmu.edu", name="My Name",
                                  role="admin", department="Dean's Office", primary_program="AS"))
    db.session.commit()
EOF
```

After any option, sign in again. `/api/me` should show `"role": "admin"`, `"role_group": "admin"`, `"is_admin": true`, and the navbar shows the **Admin** button.

### 7.4 Password reset locally

With `EXPOSE_RESET_TOKEN=1`, `POST /api/auth/forgot-password` returns `reset_url`. Open it (it points to `index.html?token=...`), choose a new password. Without that flag and without an email provider the endpoint returns 503 and the UI offers Google recovery.

---

## 8. Frontend walkthrough

### 8.1 Load order and globals

`app.html` loads, in order: `js/utils.js`, `js/data.js`, `js/profile.js`, `js/api.js`, `js/app.js`. There are no modules; every top-level `function` and `const` is a global. Later files depend on earlier ones. `tests/test.html` loads `utils.js`, `data.js`, `profile.js` in the same order.

`index.html` loads `js/utils.js`, `js/api.js` and `js/landing.js`, in that order. `landing.js` is wrapped in an IIFE and uses the globals from the other two: the backend URL, token storage, `apiFetch` and the auth calls from `api.js`; `esc`, `showToast` and the CMU email check from `utils.js`. Both pages therefore share one copy of each.

**Console tip:** `App` is declared with `const`, so it is not a property of `window`. In the browser console use `App` directly or check `typeof App`. `window.App` is `undefined`.

### 8.2 `js/utils.js` (about 105 lines)

| Function | Purpose |
|---|---|
| `normalizeCmuEmail(raw)`, `isCmuEmail(raw)` | The one frontend CMU email check, same rules as `backend/cmu.py`: CMU domains only, always returns `@andrew.cmu.edu` (or null). Tested in `tests/data.test.js` with the same cases as `backend/tests/test_cmu.py`. |
| `debounce(fn, ms)` | Debounce helper. |
| `esc(s)` | HTML escape. **Use it for every value interpolated into HTML.** |
| `loadStore(key, def)`, `saveStore(key, val)` | JSON localStorage helpers that never throw. |
| `showToast(msg, ms = 2200)` | Bottom toast (`#toast.toast`, `role="status"`). Used by both pages; `css/styles.css` and `css/landing.css` each style `.toast`. The landing page passes 4500 ms. |
| `formatPrereq(text)` | Returns null for empty or "None" prerequisites. |
| `downloadExcelSheet(filename, sheetName, headers, rows, metaRows)` | Despite the name, writes a UTF-8 CSV (with BOM). |
| `slugifyFilename(text)` | Safe file names for exports. |

### 8.3 `js/data.js` (about 1,050 lines): catalog logic, pure functions

| Lines (approx.) | Item | Purpose |
|---|---|---|
| 6 to 25 | `MAJOR_META`, `MAJOR_ORDER`, `MAJOR_BRAND` | Majors, their labels, degree names and colors. `MAJOR_ORDER = ['CS','IS','BA','BS']` controls which programs get trees and columns. |
| 28 to 45 | `ACCENT_RULES`, `pickAccentColor()` | Accent color by requirement label. |
| 48 to 108 | `LABEL_OVERRIDES` | Prettier display names for raw requirement segments. |
| 110 to 220 | `FULFILLMENT_RULES`, `setRule()` | Hand-annotated rule chips ("pick 1", "take all", "at least N units") per major and requirement. |
| 222 to 331 | `buildRequirementTree()`, `normalizeTree()`, `countTreeCourses()`, `findRule()`, `splitTreeSections()` | Build each major's requirement tree from `course.requirements[major]` paths; split into degree and GenEd sections. |
| 334 | `normalizeCourseCode()` | Canonical `NN-NNN`. |
| 343 to 425 | `COURSE_EDIT_FIELDS`, `applyCourseOverrides(courses, overrides)` | Apply admin edits. Returns `{ courses, archived }`. Edited courses get `_edit` (the override) and `_catalog` (the scraped values replaced). Added courses get `_added`. Archived courses are removed from `courses` and returned in `archived`. Copies objects so a reload starts from scraped data. |
| 428 | `knownRequirementPaths()` | All requirement paths per program, used by the course editor's autocomplete. |
| 443 to 501 | `buildCourseIndex()`, `lookupCourse()`, `findTreeNode()`, `collectCoursesForRequirement()`, `formatRequirementPath()`, `requirementLeafLabel()` | Index by `15-122` and `15122`; tree lookups. |
| 505 to 570 | `getCourseMappings()`, `orderCfColumns()`, `summarizeFlagsByStatus()`, `getAlsoCountsFor()` | Display data for the course card. |
| 577 to 625 | `predictOffering()`, `sortSemesters()` | Rule-based "likely offered next term" hint (no ML). |
| 628 to 646 | `DEPT_NAMES`, `getDeptName()` | Department number to name. |
| 650 to 784 | `SEMESTER_OPTIONS`, `MODALITY_OPTIONS`, `availableSemesterOptions()`, `semesterLabel()`, `getCourseOfferings()`, `filterOfferings()`, `courseHasMatchingOffering()` | Semester, campus and modality filters over SOC offerings. |
| 787 to 1004 | `PLAN_DAY_COLUMNS`, `parseDaysTimes()`, `planOfferingKey()`, `groupOfferingsBySection()`, `findPlanConflicts()`, `layoutPlanDayBlocks()` and friends | Schedule planner math: parsing times, conflicts, calendar layout (7:00 to 22:00). |
| 1007 to end | `courseCountsForMinor()`, `annotateDoubleCounters()`, `annotateMultiProgram()` | Profile-aware flags on courses: `_doubleCounter` (counts for major and minor) and `_programCount`. |

### 8.4 `js/profile.js` (about 325 lines): roles and programs

| Item | Purpose |
|---|---|
| `PROGRAM_GROUPS` | Programs with labels and `dataPending` (AI and GS are pending). Derived: `VALID_PROGRAMS`, `MAJOR_LIST`, `STUDENT_PROGRAMS`, `PROGRAM_FULL_NAME`. |
| `DEPARTMENT_LIST` | Must match `VALID_DEPARTMENTS` in `backend/models.py`. |
| `getRoleGroup()`, `isFaculty()`, `isStudent()` | Role group helpers (mirror of backend). |
| `canManageDirectory()`, `canFlagCourses()`, `canManageUsers()`, `canUseSchedulePlan()` | UI gates only. The backend enforces the real rules. |
| `MINOR_LIST`, `MAJOR_TO_MINOR_CODE`, `getMinorLabel()`, `getProfileMinors()` | Minors. |
| `VALID_ROLES`, `ROLE_META` | Role labels and per-role flags. |
| `ADVISOR_SCOPES`, `getAdvisorScopeLabel()` | Advisor scope labels. |
| `computeViewMode()`, `validateProfile()` | Which programs to show for a profile. |
| `saveProfile()`, `loadProfile()`, `clearProfile()` | Persist the local profile in localStorage keys `cf_role`, `cf_primary`, `cf_secondary`, `cf_minors`, `cf_scope`. |

### 8.5 `js/api.js` (about 325 lines): all network calls

`apiFetch(path, opts)` is the single wrapper. It always sends `credentials: 'include'` and the bearer token, times out after 75 s by default (`opts.timeoutMs`), never throws on HTTP errors, saves any `auth_token` it sees in a response, and returns `{ ok, status, data, error, message }`. `status: 0` means network failure or timeout.

| Group | Functions | Endpoint |
|---|---|---|
| Course data | `fetchAllCourses()`, `fetchMinorCourses()` | static files (see 3.3) |
| Backend URL and token | `getBackendUrl()`, `isBackendConfigured()`, `getAuthToken()`, `saveAuthToken(token, persist)`, `clearAuthToken()`, `getGoogleClientId()` | none |
| Auth | `apiSignInWithGoogle`, `apiRegister`, `apiLogin`, `apiForgotPassword`, `apiResetPassword`, `apiSetPassword` (these six are called by `landing.js`), `apiLogout`, `apiGetMe`, `apiPatchMe` | `/api/auth/*`, `/api/me` |
| Users | `apiListUsers(query)`, `apiPatchUser(id, patch)` | `/api/users` |
| Admin console | `apiAdminOverview`, `apiAdminInsights(semester)`, `apiAdminActivity(query)` | `/api/admin/*` |
| Course edits | `apiGetCourseOverrides` (10 s timeout), `apiAddCourse`, `apiEditCourse`, `apiArchiveCourse`, `apiRestoreCourse`, `apiRevertCourse` | `/api/courses/overrides` |
| Directory | `apiListStaffDirectory`, `apiAddStaffMember`, `apiUpsertDirectoryByEmail`, `apiRevokeDirectoryAccess`, `apiDeleteDirectoryEntry` | `/api/directory/entries` |
| Flags | `apiCreateFlag`, `apiListFlags`, `apiUpdateFlag` | `/api/flags` |
| Wishlist | `apiGetWishlist`, `apiGetWishlistRoster`, `apiAddWishlist`, `apiUpdateWishlistNote`, `apiRemoveWishlist` | `/api/wishlist` |
| Search analytics | `apiRecordCourseSearch`, `apiGetPopularCourses` (8 s timeout) | `/api/search-analytics` |
| Plans | `apiGetPlans`, `apiSharePlan`, `apiCreatePlanShareLink`, `apiAcceptPlanShare` | `/api/plans` |

Token storage: `saveAuthToken(token, true)` puts the token in localStorage ("Keep me signed in"), `saveAuthToken(token, false)` keeps it in sessionStorage only, and `saveAuthToken(token)` (what `apiFetch` does with a refreshed token) writes to whichever bucket already holds one, so a remembered session is never downgraded. `getAuthToken()` reads localStorage first, then sessionStorage; `clearAuthToken()` clears both.

### 8.6 `js/landing.js` (about 955 lines)

One IIFE. Main parts: `reach()` (wraps every `api.js` call and clears a stale "accounts unavailable" banner as soon as the server answers), validation helpers (`validateAndrewField`, `validatePasswordMatch`), `renderPanel()` (about line 608, renders sign in, register, forgot, reset views), `goToApp()` (preserves `share_plan`), `onLogin`, `onRegister`, `mountGoogleRecover` and `onGoogleRecover` (Google button used for password recovery: sign in with Google, then set a password), `onForgotPassword`, `onResetPassword`, `probeSession()`, `enterGuestMode()`, `init()`.

`js/app.js` has no sign-in screens of its own (the old in-app copy was removed in November 2026). It redirects to `index.html` whenever a sign-in is needed.

### 8.7 `js/app.js` (about 5,825 lines): the `App` object

Everything lives on one object literal `const App = { ... }`, started by `App.init()` on `DOMContentLoaded` (last lines of the file). Line numbers below are for the `cleanup` branch after the November 2026 dead code removal; they will drift as the file is edited. Search for the function name.

| Lines (approx.) | Section | Key functions |
|---|---|---|
| 5 to 11 | Home constants | `HOME_POPULAR_COURSES`, `HOME_SEARCH_CHIPS`, `HOME_RECENT_MAPPINGS` |
| 12 to 46 | State | `courses`, `courseIndex`, `trees`, `treeSections`, `layoutMode`, `activeMajor`, `selectedCourse`, filters (`locationFilter`, `activeSemester` default `F26`, `modalityFilter`), `profile`, `authedUser`, `authMode` (`authed`, `demo`, `login`), `isGuest`, `serverFlags` |
| 47 to 240 | Boot and auth state | `init()`, `_redirectToLogin()`, `_restorePendingSharePlan()`, `_afterAuthed()`, `_syncLocalToServer()` (one-time upload of local flags and wishlist), `_loadServerFlags()`, `_needsOnboarding()`, `_hydrateProfileFromServer()` |
| 241 to 251 | Theme | `applyTheme()`, `toggleTheme()` |
| 252 to 329 | Data loading | `_prepareCatalog()` (fetch catalog, fetch overrides, `applyCourseOverrides`, index, annotate, build trees), `loadData()`, `autoExpandFirstLevel()` |
| 330 to 580 | Onboarding (students only) | `renderOnboarding()`, `_renderOnboardingScreen()`, `_obPickMajor()`, `_obPickMinor()`, `_obAddMinor()`, `_obRemoveMinor()`, `_finishOnboarding()` (PATCHes `/api/me`) |
| 581 to 833 | Sign-in result, guest, sign-out, role badge | `_afterSignIn()`, `_readGuestFlag()`, `exitGuest()`, `setGuestRole()`, `signOut()`, `_roleBadgeHtml()`, `editRole()`, `_visibleMajors()`, `_guestBannerHtml()` |
| 834 to 1049 | Shell rendering | `renderShell()` (navbar with Saved, Plans, Admin or Flag review buttons, directory button), `_syncDirectoryFabLayout()`, `_initPanelResizer()` (split view drag handle) |
| 1050 to 1318 | Events and filters | `bindGlobalEvents()`, `_filterParams()`, `_refreshSemesterOptions()`, `setSemester()`, `setModalityFilter()`, `setLocation()`, `setMobileLens()`, `reset()` |
| 1319 to 1540 | Explorer mode and course search | `enterExplorer()`, `exitExplorer()`, `handleSearchKeydown()`, `_selectCourse()`, `selectSearchResult()` |
| 1541 to 1760 | Category index and unified home search | `_buildCategoryIndex()`, `selectCategoryResult()`, `handleUnifiedSearchKeydown()`, `selectUnifiedResult()`, `runHomeSearchChip()` |
| 1761 to 2148 | Home screen | `renderLeftEmpty()`, `_renderHome()`, `_renderHomeDock()`, popular courses (`_recordCourseSearch()`, `_loadPopularCourses()`, local fallback counts), `_renderQuickStart()`, navbar counters |
| 2149 to 2177 | Flag counts for the home screen | `_loadStudentFlagsSummary()`, `_loadMyFlagsSummary()` |
| 2178 to 2375 | Course card | `renderCourseCard()`, `_renderSchedRowGroup()` |
| 2376 to 2777 | Requirement tree | `_renderMajorTabs()`, `switchMajor()`, `toggleNode()`, `renderTree()`, `renderTreeNode()`, `downloadRequirementExcel()` (CSV), `_renderLeafCourse()`, `_renderRowActions()`, `_renderCardActions()` |
| 2778 to 2794 | Cross-linking | `selectCourseFromTree()` |
| 2795 to 2955 | Wishlist (Saved) | `_getWishlistItems()`, `toggleWishlist()`, `showWishlistView()`, `_saveWishlistNote()` |
| 2956 to 3738 | Schedule plans | `_loadPlansStore()` (localStorage `cf_plans_v2`, migrates legacy `cf_plan`), `createNewPlan()`, `deletePlan()`, `renamePlan()`, `_loadServerPlans()`, `_mergeServerPlan()`, `_handlePendingSharePlanLink()`, `openSharePlanModal()`, `submitSharePlanEmail()`, `copySharePlanLink()`, `togglePlanSection()`, `_renderPlanCalendar()`, `showPlanView()`, `openPlanDetail()` |
| 3739 to 3800 | Student flag view and favourites | `showStudentFlagsView()`, `showStudentFavorites()` |
| 3801 to 3974 | Flags | `FLAG_REASONS` (must match `VALID_REASON_CODES` in `backend/flags.py`), `_getFlags()` (local `cf_flags`), `openFlagModal()`, `submitFlag()` |
| 3975 to 4208 | Directory panel | `toggleDirectoryPanel()`, `_loadDirectoryPanel()`, `_renderDirectoryPanel()`, `_editDirectoryRow()`, `_revokeDirectoryRow()`, `_submitDirectoryForm()` |
| 4209 to 4338 | Admin console shell | `_adminConsole` state, `ADMIN_TABS`, `showAdminConsole()`, `_setAdminTab()`, `_loadAdminTab()` (dispatch), helpers `_admEl()`, `_admError()`, `_admWhen()`, `_admStat()` |
| 4339 to 4890 | Admin: Courses tab (course editor) | `_courseAdmin` state, `_renderAdminCourses()`, `_renderCourseResults()`, `_openCourseEditor()`, `_openCourseAdd()`, `_renderCourseEditor()`, `_addCourseReq()`, `_saveCourse()`, `_archiveCourse()`, `_restoreCourse()`, `_revertCourse()`, `_reloadCatalog()` |
| 4891 to 5224 | Admin: Overview tab and sign-in activity | `_loadAdminOverview()`, `_openIncompleteUsers()`, `_openSignIns()`, `_renderSignIns()`, `_exportSignInsCsv()` |
| 5225 to 5264 | Admin: Faculty access tab | `_loadAdminAccess()`, `_openDirectoryFromAdmin()` |
| 5265 to 5360 | Admin: Insights tab | `_loadAdminInsights()` |
| 5361 to 5440 | Admin: Activity log tab | `_loadAdminActivity()`, `_renderAdminActivity()`, `_describeAdminEvent()` (human text per audit action) |
| 5441 to 5651 | Admin: Users tab | `_loadUserAdmin()`, `_exportUsersCsv()`, `_renderUserAdmin()`, `_renderUserAdminRow()`, `_saveUserAdmin()` (opened with `showAdminConsole('users')`) |
| 5652 to 5780 | Admin and faculty: Flags review | `showFlagReview()`, `_loadFlagReview()`, `_renderFlagReview()`, `_setFlagStatus()`, `_promptFlagNote()` |
| 5781 to 5818 | Deep links into the tree | `navigateToReqNode()` |
| 5819 to 5826 | Bootstrap | `DOMContentLoaded` handler, picks dark theme from OS if no saved theme, calls `App.init()` |

Admin tabs, in order (`ADMIN_TABS`): `courses` (Courses), `overview` (Overview), `users` (Users), `access` (Faculty access), `flags` (Flags), `insights` (Insights), `activity` (Activity log). The Admin button appears only when `canManageUsers(this.authedUser)`.

### 8.8 State model and browser storage

All UI state is fields on `App`; it is re-rendered by writing `innerHTML` strings. There is no virtual DOM and no reactive store. After changing state you call the relevant render function (`renderTree()`, `renderShell()`, `renderLeftEmpty()` and so on).

Every browser storage key (found by searching `localStorage`, `sessionStorage`, `loadStore`, `saveStore`):

| Key | Storage | Written by | Meaning |
|---|---|---|---|
| `cf_auth_token` | session (default) or local ("Keep me signed in") | `api.js` (`saveAuthToken`, called by `landing.js` at sign-in) | Bearer token |
| `cf_backend_override` | local | you, by hand | Backend URL override |
| `cf_guest` | session | `landing.js` | Guest mode on |
| `cf_pending_share_plan` | session | `landing.js`, `app.js` | Plan share token waiting for sign-in |
| `cf_theme` | local | `app.js` | `light` or `dark` |
| `cf_role`, `cf_primary`, `cf_secondary`, `cf_minors`, `cf_scope` | local | `profile.js` | Local copy of the profile |
| `cf_wishlist` | local | `app.js` | Saved courses (array of `{course_code, note}`) |
| `cf_flags` | local | `app.js` | Locally queued flags |
| `cf_synced` | local | `app.js` | One-time local to server sync done |
| `cf_plans_v2` | local | `app.js` | `{ activePlanId, plans: [{ id, name, items }] }` |
| `cf_plan` | local | legacy | Old single plan, migrated into `cf_plans_v2` on load |
| `cf_split_left_px` | local | `app.js` | Split view panel width |
| `cf_search_counts_<PROGRAM>_<SEMESTER>` | local | `app.js` | Local fallback for "popular courses" |

Note: schedule plans live only in the browser. The server stores a plan only when someone shares it (`/api/plans/share`, `/api/plans/accept-share`), and `GET /api/plans` returns those copies. There is no endpoint that saves a user's own plans.

### 8.9 CSS

`css/styles.css` starts with light theme custom properties in `:root` (line 9, including `--major-cs`, `--major-is` and friends), then `[data-theme="dark"]` overrides (line 107), then sections for layout (focused and split mode), search, course card, tree, onboarding, navbar, plans, directory panel (around line 3767), and the Admin page and course editor (around lines 3887 and 4042). The theme is switched by setting `data-theme` on `<html>`.

---

## 9. Backend walkthrough

### 9.1 App factory (`backend/app.py`)

`create_app(config_class=Config, *, bootstrap_db=None)`:

1. Loads config.
2. `db.init_app(app)`.
3. Unless `SKIP_DB_BOOTSTRAP` is truthy, runs `init_database(app)`: imports models, `db.create_all()`, then `run_migrations()`.
4. Enables CORS for `/api/*` only, for `FRONTEND_ORIGINS`, with credentials and the `Content-Type` and `Authorization` headers.
5. Registers blueprints: `auth`, `flags`, `wishlist`, `users`, `directory`, `search_analytics`, `plans`, `admin`, `course_overrides`.
6. Adds `GET /health` (no `/api` prefix, so no CORS). For SQLite it always returns ok. For Postgres it runs `SELECT 1` and checks `REQUIRED_TABLES`; returns 503 if tables are missing or the DB errors (200 when `ALLOW_BOOTSTRAP_SKIP` is set).
7. JSON 404 handler: `{"error":"not_found","message":"Route not found."}`.

Production runs `gunicorn --workers=1 ... 'backend.app:create_app()'` with `SKIP_DB_BOOTSTRAP=1`.

### 9.2 Permissions (`backend/permissions.py`)

- `_load_user()`: session `uid` first, then `Authorization: Bearer <token>`. Cached on `g._current_user` per request.
- `@require_login`: 401 unless signed in. Sets `g.user`.
- `@require_role_group("faculty", "admin")`: 403 unless the user's role group is listed. **Use this for permissions.**
- `@require_role("student")`: exact role match. Used for student-only routes (wishlist, search event).
- Constants: `ROLE_GROUP_STUDENT`, `ROLE_GROUP_FACULTY`, `ROLE_GROUP_ADMIN`, `FACULTY_OR_ADMIN`.

Error shape everywhere: `{"error": "<code>", "message": "<human text>"}`.

### 9.3 Auth (`backend/auth.py`)

- Passwords: Werkzeug `generate_password_hash` and `check_password_hash`. Minimum 8 characters.
- `register`: CMU email only, checks `ALLOWED_EMAIL_DOMAIN`, rejects if the email already has a password (409). If the user exists without a password (for example signed in with Google before), it sets the password. Applies the directory, writes the session, returns the user plus `auth_token` (201).
- `login`: email and password. Clear messages when the account has no password (`no_password_set`).
- `forgot-password` and `reset-password`: see 6.1 and 7.4. Reset tokens are random, stored as SHA-256 hashes in `password_reset_tokens`, single use, expire after `RESET_TOKEN_MINUTES`. The response is the same whether or not the account exists.
- `set-password`: signed-in user sets a password without a token (Google recovery flow).
- `google`: verifies the ID token with `google.oauth2.id_token.verify_oauth2_token`, requires `email_verified`, upserts by `google_sub` then by email.
- `logout`: clears the session (the frontend also clears the token).
- `GET /api/me`: the user, plus a fresh `auth_token`.
- `PATCH /api/me`: allowed fields `name`, `role`, `primary_program`, `minor_code`, `minor_codes`, `advisor_scope`, `department_scope`, `department`. Validates the whole resulting profile with `_validate_consistent_profile()`: students need a major in `CS IS BA BS AI GS`, no department, no advisor scope; faculty and admin need a valid department and program, no minors, no advisor scope. A non-admin can only set their own role to `student`; an admin cannot change their own role.

### 9.4 Directory (`backend/directory.py`, `backend/directory_routes.py`)

- Lookup order: `directory_entries` row, then the first non-empty JSON seed file. The DB layer is what the UI edits; the JSON file is never written by the app.
- `list_elevated_directory()` merges both and marks each row `source` as `db`, `json` or `db+json`.
- Adding with only name and email defaults to role `professor`, department `Dean's Office`, program `AS`.
- "Revoke" for a JSON-only person creates a DB row with role `student` (DB wins, so they become a student). For a DB row it deletes the row.
- **All directory routes are open to the whole faculty group, not just admins**, including setting `role: "admin"`. See 21.1.

### 9.5 Users (`backend/users.py`)

Admin only (`MANAGER_ROLES = (ROLE_GROUP_ADMIN,)`). List with `search`, `role_group`, `incomplete`, `limit` (max 1000). Patch validates like `PATCH /api/me`, writes a `user.update` audit row with before and after values. Remember 7.1: the role part is overwritten on next sign-in unless the directory agrees. Some code comments still mention area heads managing users; that is no longer allowed.

### 9.6 Flags (`backend/flags.py`)

- Faculty and admin create flags. The client may send its own `flg-...` id (for idempotent migration from localStorage); a repeated id returns the existing flag with 200.
- `GET /api/flags`: students see non-dismissed flags with fewer fields; faculty and admin see everything (`?mine=1` limits faculty to their own). Filters: `status`, `course`, `page`, `limit` (max 100).
- `PATCH`: faculty and admin set `status` and `admin_notes`; changes write `flag.status` and `flag.note` audit rows.

### 9.7 Wishlist (`backend/wishlist.py`)

Student-only CRUD on the caller's own saved courses with notes. `GET /api/wishlist/roster` gives faculty and admins every student's saved courses grouped by student (advising view).

### 9.8 Plans (`backend/plans.py`)

- `GET /api/plans`: plans stored for the caller (shared copies).
- `POST /api/plans/share`: copy a plan snapshot into another existing user's account (`"From <name>: <plan>"`). The recipient email goes through `normalize_cmu_email()`, so `name@cmu.edu` and `name@qatar.cmu.edu` find the `name@andrew.cmu.edu` account.
- `POST /api/plans/share-link`: returns a raw token; the token's hash is stored with the plan snapshot. Valid 30 days, 20 uses.
- `POST /api/plans/accept-share`: import a shared snapshot into the caller's account.

### 9.9 Search analytics (`backend/search_analytics.py`)

When a signed-in **student** opens a course, the frontend posts `/api/search-analytics/events`; the server increments a counter keyed by (student's program, semester, course). `GET /popular?program=CS&semester=F26&limit=5` is public and returns only aggregates. No per-user data is stored.

### 9.10 Admin console API and audit log (`backend/admin.py`)

- `record_event(actor, action, target, **details)` adds an `admin_audit_events` row to the current session; the caller's commit saves it together with the change.
- Actions written today: `user.update`, `directory.add`, `directory.update`, `directory.remove`, `directory.revoke`, `flag.status`, `flag.note`, `course.add`, `course.update`, `course.revert`, `course.archive`, `course.restore`.
- `GET /api/admin/overview`: user counts by role and group, new users in 7 and 30 days, active in 7 days (by `last_login`), incomplete profiles, flag counts by status, wishlist totals, plan count, total course lookups, directory row count, `course_data.last_scrape` (read from the top of `data/soc.json` **on the server**, so it reflects the copy of the repo Render deployed, not GitHub Pages), six most recent signups.
- `GET /api/admin/insights?semester=F26`: top lookups, top lookups per program, most saved, most flagged, students per program, signups per week for 12 weeks, list of semesters with data.
- `GET /api/admin/sign-ins?days=7|30|90`: sign-in activity (active people, sign-ins, app opens, daily series, breakdowns, per-person table). See section 13.
- `GET /api/admin/activity?action=course.&page=1&limit=50`: paginated audit log; `action` is a prefix match (a trailing `*` is ignored).

### 9.11 Email (`backend/email_util.py`)

`send_password_reset_email(to, url)` tries Resend (HTTPS API), then SMTP (STARTTLS by default), and returns False if neither is configured or both fail. Never raises. `email_utils.py` (with an `s`) is unused.

---

## 10. API reference (every route)

All `/api/*` routes return JSON. "Login" means any signed-in user. Files are under `backend/`.

| Method | Path | Who | File | Purpose |
|---|---|---|---|---|
| GET | `/health` | public | `app.py` | Health and DB check (used by Render and `keepalive.yml`) |
| POST | `/api/auth/register` | public | `auth.py` | Create account with email and password |
| POST | `/api/auth/login` | public | `auth.py` | Email and password sign-in |
| POST | `/api/auth/forgot-password` | public | `auth.py` | Start password reset |
| POST | `/api/auth/reset-password` | public | `auth.py` | Finish reset with token |
| POST | `/api/auth/set-password` | login | `auth.py` | Set password without token (after Google sign-in) |
| POST | `/api/auth/google` | public | `auth.py` | Google ID token sign-in |
| POST | `/api/auth/logout` | public | `auth.py` | Clear session |
| GET | `/api/me` | login (401 otherwise) | `auth.py` | Current user plus fresh token |
| PATCH | `/api/me` | login | `auth.py` | Update own profile (onboarding) |
| POST | `/api/flags` | faculty, admin | `flags.py` | File a flag |
| GET | `/api/flags` | login (scoped by group) | `flags.py` | List flags |
| PATCH | `/api/flags/<id>` | faculty, admin | `flags.py` | Change status or notes |
| GET | `/api/wishlist` | role `student` | `wishlist.py` | Own saved courses |
| GET | `/api/wishlist/roster` | faculty, admin | `wishlist.py` | All students' saved courses |
| POST | `/api/wishlist` | role `student` | `wishlist.py` | Save a course (upsert note) |
| PATCH | `/api/wishlist/<code>` | role `student` | `wishlist.py` | Edit note |
| DELETE | `/api/wishlist/<code>` | role `student` | `wishlist.py` | Remove (204) |
| GET | `/api/users` | admin | `users.py` | List users |
| PATCH | `/api/users/<id>` | admin | `users.py` | Edit a user (role edits revert on next login, see 7.1) |
| GET | `/api/directory/entries` | faculty, admin | `directory_routes.py` | Merged directory |
| POST | `/api/directory/entries` | faculty, admin | `directory_routes.py` | Add or update by email |
| PATCH | `/api/directory/entries/<id>` | faculty, admin | `directory_routes.py` | Edit a DB row |
| PATCH | `/api/directory/entries/by-email` | faculty, admin | `directory_routes.py` | Create or update the DB overlay for an email |
| DELETE | `/api/directory/entries/<id>` | faculty, admin | `directory_routes.py` | Delete a DB row |
| POST | `/api/directory/entries/revoke` | faculty, admin | `directory_routes.py` | Remove elevated access |
| POST | `/api/search-analytics/events` | role `student` | `search_analytics.py` | Count a course lookup |
| GET | `/api/search-analytics/popular` | public | `search_analytics.py` | Top courses per program and semester |
| GET | `/api/plans` | login | `plans.py` | Shared plans in my account |
| POST | `/api/plans/share` | login | `plans.py` | Share a plan to a user by email |
| POST | `/api/plans/share-link` | login | `plans.py` | Create a share link token |
| POST | `/api/plans/accept-share` | login | `plans.py` | Import from a share link |
| GET | `/api/admin/overview` | admin | `admin.py` | Dashboard numbers |
| GET | `/api/admin/insights` | admin | `admin.py` | Usage insights |
| GET | `/api/admin/sign-ins` | admin | `admin.py` | Sign-in activity (section 13) |
| GET | `/api/admin/activity` | admin | `admin.py` | Audit log |
| GET | `/api/courses/overrides` | public | `course_overrides.py` | All catalog edits (`Cache-Control: no-cache`) |
| POST | `/api/courses/overrides` | admin | `course_overrides.py` | Add a new course |
| PATCH | `/api/courses/overrides/<code>` | admin | `course_overrides.py` | Edit a course (creates the override) |
| POST | `/api/courses/overrides/<code>/archive` | admin | `course_overrides.py` | Hide a course |
| POST | `/api/courses/overrides/<code>/restore` | admin | `course_overrides.py` | Unhide |
| DELETE | `/api/courses/overrides/<code>` | admin | `course_overrides.py` | Revert a scraped course to the scrape (added courses cannot be reverted, only archived) |


---

## 11. Database: tables, schema changes and migrations

### 11.1 Tables (`backend/models.py`)

| Table | Model | Key columns | Notes |
|---|---|---|---|
| `users` | `User` | `email` (unique), `google_sub` (unique), `password_hash`, `role`, `primary_program`, `minor_code` (legacy single minor), `advisor_scope`, `department_scope`, `department`, `picture_url`, `is_admin`, `profile_completed`, `last_login`, `created_at`, `updated_at` | `reset_token_hash` and `reset_token_expires` are unused leftovers (tokens live in their own table). |
| `user_minors` | `UserMinor` | `user_id`, `minor_code` (unique pair) | Multiple minors. |
| `directory_entries` | `DirectoryEntry` | `email` (unique), `name`, `role`, `department`, `primary_program`, `picture_url`, `added_by_id` | Editable directory layer. |
| `password_reset_tokens` | `PasswordResetToken` | `user_id`, `token_hash` (unique), `expires_at`, `used` | |
| `flags` | `Flag` | string `id` (`flg-...`), `course_code`, `reason_code`, `notes`, submitter snapshot, `status`, `admin_notes`, `resolved_by` | |
| `wishlist_items` | `WishlistItem` | `user_id`, `course_code` (unique pair), `note` | |
| `schedule_plans` | `SchedulePlan` | string `id`, `user_id`, `name`, `shared_from_*` | |
| `schedule_plan_items` | `SchedulePlanItem` | `plan_id`, `offering_id` (unique pair), section details | |
| `schedule_plan_share_tokens` | `SchedulePlanShareToken` | `token_hash`, snapshot JSON, `expires_at`, `use_count`, `max_uses` | |
| `course_search_counts` | `CourseSearchCount` | (`primary_program`, `semester_code`, `course_code`) unique, `search_count` | |
| `admin_audit_events` | `AdminAuditEvent` | `actor_id`, `actor_email`, `actor_name`, `action`, `target`, `details` (JSON text), `created_at` | |
| `sign_in_events` | `SignInEvent` | `user_id`, `method`, `created_at` | One row per sign-in (section 13) |
| `user_activity_days` | `UserActivityDay` | `user_id`, `day`, `visits`, `sign_ins`, `first_seen`, `last_seen` | One row per user per Qatar day (section 13) |
| `course_overrides` | `CourseOverride` | `course_code` (unique), `is_new`, `archived`, `fields` (JSON text), `requirements` (JSON text), `updated_by_*` | |

`backend/db_schema.py` `REQUIRED_TABLES` lists all 14. `backend/models.py` is the source of truth for the schema.

### 11.2 How schema changes reach production (exactly)

1. Render runs the **pre-deploy command** `python -m backend.bootstrap_db` once per deploy (before gunicorn starts). It calls `create_app(bootstrap_db=False)`, then `init_database()`:
   - `db.create_all()`: **creates tables that do not exist yet. It never alters an existing table. It will not add a new column, change a type, add an index to an existing table, or drop anything.**
   - `run_migrations()` in `backend/migrate.py`: a list of idempotent steps (`_add_column_if_missing`, `_ensure_..._table`) for changes to tables that already existed in production.
   - `verify_bootstrap()`: fails the deploy if any table in `REQUIRED_TABLES` is missing.
2. gunicorn starts with `SKIP_DB_BOOTSTRAP=1`, so workers do not repeat this.
3. Locally, `python -m backend.app` does steps 1a and 1b on every start.

So:

- **New table:** add the model; `create_all()` creates it. Also add the name to `REQUIRED_TABLES` if the app cannot work without it.
- **New column on an existing table:** you **must** also add a `_add_column_if_missing("table", "column", "<sqlite ddl>", "<postgres ddl>")` call at the end of `run_migrations()`. Without it production will crash with "column does not exist" while tests still pass (tests create fresh tables).
- **Renames, type changes, drops:** not supported by the helpers. Write a careful one-off step in `migrate.py`, guarded so it is idempotent, and test it against a copy of the production database first. There is no Alembic.
- New columns added to an existing table should be nullable or have a default, otherwise the `ALTER TABLE` fails on existing rows.
- Booleans: the existing migrations use `DEFAULT 0` for SQLite and `DEFAULT FALSE` for Postgres. Follow that pattern.

Since November 3, 2026 production `/health` reports `"tables": 14` (the admin page and sign-in analytics are deployed). The deploy created `admin_audit_events`, `course_overrides`, `sign_in_events` and `user_activity_days` through `create_all()` and backfilled sign-in history once (section 13.2).

---

## 12. Course overrides (admin catalog edits)

### 12.1 Why they exist

`data/courses.json` is regenerated from the SOC by a bot and committed to git. Any manual edit to that file would be overwritten by the next scrape. So admin edits are stored in the `course_overrides` table and applied by the browser after it loads the file.

### 12.2 Data model

One row per course code:

- Scraped course edited: `is_new = false`, `course_code` = the catalog code (even if the admin renumbers it; the new number is stored inside `fields.course_code`), `fields` = only the changed fields (`course_name`, `department`, `units`, `description`, `prerequisites`, `offered_qatar`, `offered_pitts`, `offered`, optionally `course_code`), `requirements` = the complete "counts for" map when edited (`{"CS": [{"requirement": "A---B", "type": false, "major": "CS"}], ...}`), else null.
- Course added by an admin: `is_new = true`, keyed by its own code; renumbering moves the key.
- `archived = true` hides the course from everyone; nothing is deleted.
- If an edit leaves a scraped course identical to the scrape (no fields, no requirements, not archived) the row is deleted.

### 12.3 Validation rules (`course_overrides.py`)

Code must match `NN-NNN`. Name 1 to 200 chars, description up to 5000, prerequisites up to 1000. Department is the numeric department code (for example `15`). Units 0 to 48. Offered semesters must match `^[FSMN]\d{2}$`. Requirement programs must be in `CS IS BA BS AI GS`; each path up to 400 chars; duplicates are dropped.

### 12.4 How the browser applies them

`App._prepareCatalog()` calls `fetchAllCourses()`, then `apiGetCourseOverrides()` (10 s timeout; on failure it logs a warning and shows the plain scrape), then `applyCourseOverrides()`, then rebuilds the index and trees. After every save the course editor calls `_reloadCatalog()` to rebuild from scratch.

### 12.5 Using the course editor

Admin page, **Courses** tab: search by number or title, filter (all, edited, added, archived), open a course, edit fields and the "counts for" list per program (with autocomplete from existing requirement paths), then Save. A category typed into a "Pick or type" box is saved even if you never pressed its Add button. A successful Add course or Save changes opens a confirmation screen (`_renderCourseSaved` in `js/app.js`, state `_courseAdmin.view === 'saved'`) listing what changed; validation errors appear in the `#ce-notice` box next to the buttons, not as toasts. Buttons: Archive, Restore, Revert (drops all edits for a scraped course). "Add course" creates a new course. Every action is in the Activity log.

---

## 13. Admin analytics (sign-in activity)

Admins open it from **Admin > Overview > Signed in this week** (or **New this week**, which opens it filtered to new accounts). The page has a 7 / 30 / 90 day switch, six stat cards, a people-per-day bar chart, breakdowns by role, program, sign-in method and hour of day, and a searchable, sortable table of everyone who was active, with CSV export. The team-facing design and Phase 2/3 proposals are in `docs/analytics-plan/` (`plan.html` is the source, `CountsFor_Analytics_Plan.pdf` the rendered copy).

### 13.1 What "active" means

A session cookie lasts 30 days (`PERMANENT_SESSION_LIFETIME` in `backend/config.py`), so most returning users never sign in again. Counting only logins would undercount badly. A person is **active** on a day if they signed in **or** loaded CountsFor while already signed in (every app load calls `GET /api/me`).

| Metric | Definition |
|---|---|
| Active people | Distinct users with a `user_activity_days` row in the window |
| Sign-ins | Sum of `sign_ins` in the window (successful logins of any method) |
| App opens | Sum of `visits` in the window (`GET /api/me` calls) |
| Returning | Active in the window and also in the same-length window right before it |
| New accounts | Active users whose `users.created_at` is inside the window |
| Days active | Average number of distinct active days per active user |

Days are **Qatar local dates** (UTC+3, no daylight saving). The constant is `LOCAL_TZ` in `backend/activity.py`. Change it there if the app is ever used from another campus.

### 13.2 Data model

| Table | One row per | Columns |
|---|---|---|
| `sign_in_events` | successful sign-in | `user_id`, `method` (`google`, `password`, `email_link`, `register`, `before_tracking`), `created_at` |
| `user_activity_days` | user per Qatar day | `user_id`, `day` (`YYYY-MM-DD` string), `visits`, `sign_ins`, `first_seen`, `last_seen`; unique on (`user_id`, `day`) |

Both are SQLAlchemy models in `backend/models.py`. They are new tables, so `db.create_all()` creates them on deploy (Render's `preDeployCommand: python -m backend.bootstrap_db` runs `init_database`). Both are in `REQUIRED_TABLES` in `backend/db_schema.py`, so `/health` on Postgres reports `degraded` if either is missing. Rows are deleted with the user (`ON DELETE CASCADE`).

**One-time backfill.** Tracking started after people were already using the site. `_backfill_sign_in_history()` in `backend/migrate.py` runs inside `run_migrations()`: if `sign_in_events` is empty, it copies each user's `users.last_login` into one `before_tracking` event plus one activity-day row. Once any event exists it never runs again. The page footer shows when real tracking began (earliest non-backfill event).

### 13.3 Code path

| Step | Where |
|---|---|
| Record a sign-in | `mark_signed_in(user, method)` in `backend/activity.py`. Called from `_finalize_user` (password login, `register`) and `_upsert_user_from_login` (Google, legacy email link) in `backend/auth.py`. It sets `users.last_login`, adds an event and bumps the day row. The caller commits. |
| Record an app load | `record_visit(user)` in `backend/activity.py`, called by `GET /api/me`. It commits on its own and swallows database errors so `/api/me` can never fail because of analytics. |
| API | `GET /api/admin/sign-ins?days=7\|30\|90` in `backend/admin.py` (admin role group only; any other value falls back to 7). The Overview's `active_7d` uses the same activity rows (plus `last_login` as a fallback). |
| Frontend | `apiAdminSignIns` in `js/api.js`; `_openSignIns`, `_loadSignIns`, `_renderSignIns`, `_renderSignInTable`, `_exportSignInsCsv` in `js/app.js`; styles under "Admin page: sign-in activity" at the end of `css/styles.css`. Charts are plain HTML/CSS bars, no chart library. |
| Tests | Five tests at the end of `backend/tests/test_admin.py` (permissions, tracking through the real email route, overview consistency, window fallback, backfill runs once). |

### 13.4 Privacy rules for this feature

Store counts, not behaviour: no IP addresses, user agents, locations or per-person page/search logs. Course lookups (`course_search_counts`) stay aggregated per program and semester, never per person. Keep the endpoint admin-only on the server. Any Phase 2 feature tracking should follow the same rule (daily counts per role group and program, not per person); see the plan PDF.

### 13.5 Recipes

- **See it locally with data:** create a few test accounts through **Create account** (or `POST /api/auth/register`) and reload `app.html` a few times; each reload is an app open.
- **Add a new sign-in method:** call `mark_signed_in(user, "<method>")` in the new route before its commit, and add a label to `SIGN_IN_METHOD_LABELS` in `js/app.js`.
- **Add a window (for example 365 days):** add it to `SIGN_IN_WINDOWS` in `backend/admin.py`; the switch buttons come from the API's `windows` list.

---

## 14. Data pipeline (SOC scrape)

### 14.1 Steps (`.github/workflows/scrape.yml`)

Runs daily at 12:00 UTC and on weekdays at 06:00 UTC, and on manual dispatch. Only runs when `github.repository == 'Adicmu/Countsfor-Summer-26'`.

1. `python -m pytest data/tests/test_scrape_soc.py data/tests/test_soc_parse.py -q`
2. `python data/scrape_soc.py`: scrapes every semester on the SOC form for Pittsburgh and Qatar, all departments, writes `data/soc.json` only if the scrape is non-empty and above `MIN_COURSES_FOR_VALID_SCRAPE`.
3. `python data/reconcile_offerings.py`: merges SOC sections into `data/courses.json` (offerings, `offered`, campus flags, units). It does **not** create requirement mappings.
4. `python data/apply_mapping_overlays.py`: adds the manual requirement mappings from `data/mapping_overlays.json` (additive only).
5. `python data/validate_soc_coverage.py`: fails if a SOC course is missing from the catalog.
6. `python scripts/bump_cf_build.py`: sets the `cf-build` meta and every `?v=` in `app.html` to `soc-YYYY-MM-DD`, so browsers fetch the new `courses.json`.
7. Commits `data/soc.json data/courses.json app.html` as `soc-bot` with message `Update SOC data (YYYY-MM-DD)` and pushes.
8. If it pushed, triggers `pages.yml` with `gh workflow run pages.yml --ref main` (bot pushes do not trigger workflows by themselves).

### 14.2 Current state (verified November 3, 2026): the scrape on the main repo is broken

- Every scheduled run of "Scrape SOC" on `Adicmu/Countsfor-Summer-26` since July 9, 2026 has **failed** except a few, the last success being August 12, 2026. The failure is at step 1: `No module named pytest`. The workflow never installs pytest (there is no `pip install` step). Fix: add a step before the tests, for example `run: pip install pytest`.
- As a result `origin/main` data stops at commit `642c4ab Update SOC data (2026-08-12)` and `data/soc.json` says `"last_scrape": "2026-08-13T07:51:25..."` (UTC timestamp of the scrape, committed on Aug 12 in Qatar time). The live site `adicmu.github.io/Countsfor-Summer-26` serves this August data.
- The partner fork `Hindjendara/Countsfor-Summer-26` (remote `hind`) has a version of `scrape.yml` without the repository guard and without the pytest step. It runs successfully every day; its latest commit is `eb394f1 Update SOC data (2026-11-02)`. `hind/main` is 144 commits ahead of `origin/main` (bot commits only, no code) and 20 behind. Its Pages site `hindjendara.github.io/Countsfor-Summer-26` has fresh data but an old frontend (cf-build `2026-08-10-faculty-home-v1`).
- To bring fresh data into the main repo without running the scraper, you can take the data files from the fork:

```bash
git fetch hind
git checkout -b data-sync origin/main
git checkout hind/main -- data/soc.json data/courses.json
python scripts/bump_cf_build.py
git commit -am "Sync SOC data from the hind fork"
```

  Note `hind/main` does not run `bump_cf_build.py`, so bump it yourself as shown.

### 14.3 Run the scraper manually

```bash
source .venv/bin/activate
pip install pytest
python -m pytest data/tests -q                 # 34 tests
python data/scrape_soc.py                      # 30 to 90 minutes, polite delays
python data/reconcile_offerings.py
python data/apply_mapping_overlays.py
python data/validate_soc_coverage.py
python scripts/bump_cf_build.py
git diff --stat
```

Or trigger it on GitHub: `gh workflow run scrape.yml -R Adicmu/Countsfor-Summer-26` (only after fixing the pytest step).

Offline testing against the mock server in `Testing/app.py` (serves on port 5000 by default, change it if AirPlay is on):

```bash
pip install flask
python Testing/app.py
SOC_BASE_URL=http://localhost:5000/open/SOC/SOCServlet MIN_COURSES_FOR_VALID_SCRAPE=1 \
  SOC_OUTPUT_PATH=/tmp/test_soc.json python data/scrape_soc.py
```

### 14.4 Mapping overlays (`data/mapping_overlays.json`)

```json
{
  "description": "...",
  "overlays": [
    {
      "id": "is-igi-modern-languages-core",
      "note": "why this exists",
      "course_codes": ["82-101", "82-102"],
      "requirements": {
        "IS": [{"requirement": "GenEd---GenEd---Foundations---Intercultural and Global Inquiry", "type": true, "major": "IS"}]
      },
      "ensure_course_defaults": {"department": "82", "offered_qatar": true}
    }
  ]
}
```

Overlays only add mappings, never remove them. Use overlays for mapping fixes that should live in git and apply to every deploy; use the admin course editor for quick fixes by non-developers. Test: `python -m pytest data/tests/test_is_igi_modern_languages.py`.

### 14.5 Faculty directory refresh

`python data/scrape_faculty_directory.py --dry-run` then `python data/scrape_faculty_directory.py -o data/faculty_directory.json`. It queries the CMU-Q People page's public Algolia index using the search-only key embedded in that site (copied into the script). Review the diff before committing: everyone in this file gets faculty access in production.

---

## 15. Deployment

### 15.1 Frontend: GitHub Pages

- Repo settings (checked with `gh api repos/Adicmu/Countsfor-Summer-26/pages`): build type **workflow** (GitHub Actions), public, URL `https://adicmu.github.io/Countsfor-Summer-26/`, HTTPS enforced, no custom domain.
- Workflow `.github/workflows/pages.yml`: on push to `main` (or manual run), collects the public files listed below and deploys them. Only `main` deploys; feature branches do not.
- The `gh-pages` branch on origin (last commit August 9, 2026) is a leftover from an experiment on the fork branch `hind/cursor/adicmu-pages-deploy`. Pages does not serve from it. The `pages-build-deployment` workflow listed in the Actions tab is GitHub's built-in branch builder and is likewise unused.
- Every push to `main` redeploys. The admin page, course editor and sign-in analytics went live on November 3, 2026.
- The workflow copies only what the browser loads into `_site/` and publishes that: `index.html`, `app.html`, `reset.html`, `.nojekyll`, `js/`, `css/`, `assets/`, `landing/` (without its notes) and `data/courses.json` plus `data/minor_courses.json`. Backend code, docs, tests and raw scrape data are not public. **If you add a file the browser must load from a new folder, add it to the "Collect public site files" step in `.github/workflows/pages.yml`, or it will 404 on the live site.**

### 15.2 Backend: Render

- Blueprint: `render.yaml` at the repo root (the comment says `backend/render.yaml` was removed).
  - Web service `countsfor-backend` (Python, plan `starter`, region Ohio). Build `pip install -r requirements.txt`. Pre-deploy `python -m backend.bootstrap_db`. Start `SKIP_DB_BOOTSTRAP=1 gunicorn --workers=1 --bind 0.0.0.0:$PORT --timeout 120 --access-logfile - 'backend.app:create_app()'`. Health check `/health`.
  - Database `CountsFor_Summer_2026` (plan `starter`, Ohio).
  - Env: `FLASK_ENV=production`, `DATABASE_URL` from the database, generated `SECRET_KEY`, `ALLOWED_EMAIL_DOMAIN=andrew.cmu.edu`, `FRONTEND_ORIGIN`, `SEED_USERS_PATH=data/faculty_directory.json`, `FRONTEND_RESET_BASE`, and dashboard-only (`sync: false`) values: `GOOGLE_CLIENT_ID`, `RESEND_API_KEY`, `MAIL_FROM`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `ALLOW_BOOTSTRAP_SKIP`.
- The URL actually used by the frontend and keepalive is **`https://countsfor-summer-26.onrender.com`** (the service is named `countsfor-summer-26` in the dashboard; the blueprint calls it `countsfor-backend`). **Render auto-deploys the backend from `main`:** confirmed on November 3, 2026, when a push to `main` moved production `/health` from 10 to 14 tables within minutes. Uncertain: whether the live service is managed by this blueprint or was created by hand.
- The production database host is `dpg-d9osve67...`. An older host (`dpg-d8nqt2...`) was used earlier in 2026, so the database has been recreated at least once.
- Older notes mentioned a second service `countsfor-backend.onrender.com` and an Oregon database `countsfor-db`. In November 2026 that hostname did not answer. Check the Render dashboard and delete anything unused.
- Plans are paid (`starter`). Who pays and on which Render account is not recorded in the repo. Find out before the owner leaves.
- `keepalive.yml` pings `/health` every 10 minutes from 04:00 to 20:59 UTC and fails loudly if three attempts fail. It was originally for the free tier (which sleeps); on a paid plan it is a cheap uptime monitor.

Deploying the backend: push or merge to `main`; Render builds, runs the pre-deploy bootstrap (creates new tables, runs `migrate.py`), then starts. Watch the deploy log for `Database bootstrap OK` and then check `/health` (expect `"status":"ok"` and `"tables":14`).

**Recovering a deleted database** (this happened once when a free trial expired; deploys then fail at pre-deploy or `/health` returns 503):

1. Make sure billing is active on the Render account (Account Settings, Billing). Paid plans cannot be chosen without it.
2. Render dashboard, **New +**, **PostgreSQL**. Name it `CountsFor_Summer_2026` (must match `render.yaml`), region **Ohio**, plan **Starter**. Wait until it is **Available**.
3. Open the web service `countsfor-summer-26`, **Environment**, and link `DATABASE_URL` to the new database's **Internal Database URL**. On the database's **Apps** tab, check that 1 service is connected.
4. If a deploy loop blocks you from changing settings, add `ALLOW_BOOTSTRAP_SKIP=1` for **one** deploy (pre-deploy and `/health` then pass in a degraded state), fix the database, and remove the variable again.
5. **Manual Deploy**, **Clear build cache & deploy**. Pre-deploy creates every table. Confirm `/health` shows `"database":"connected"`.
6. The data is gone with the old database: users must sign up again, and directory entries, course edits and flags are lost. Take regular `pg_dump` backups to avoid this.

### 15.3 Google OAuth

- Client ID (public, committed in both HTML files): `378923997481-...apps.googleusercontent.com`.
- Authorized JavaScript origins must include every frontend origin (`https://adicmu.github.io`, `http://localhost:8765`, and `https://hindjendara.github.io` if the fork is used). No redirect URIs are needed (popup flow).
- The Google Cloud project and its owner account are not recorded in the repo. Find out who can edit it.

### 15.4 `countsfor.qatar.cmu.edu`

The hostname resolves to a private address (`172.20.245.41`), so it is reachable only on the CMU-Q network. Older docs described it as "the CMU-Q deployment" and the original CountsFor production API. The code no longer references it (the old `API_BASE` course data fallback was removed in November 2026). **Uncertain:** whether it currently serves this repository's frontend or the older open-cmuq CountsFor app, and who at CMU-Q IT administers it. Nothing in this repo deploys to it. Ask CMU-Q IT.

### 15.5 Supabase

Supabase Postgres was once considered instead of Render Postgres. The code supports it (any Postgres URL; use the Session pooler URI on port 5432). There is no evidence it is in use; production `/health` shows a Render database host.

### 15.6 Release checklist

1. All backend tests pass except the known failures (section 16).
2. If you added a column: migration step in `migrate.py` (section 11.2).
3. Bump `?v=` tags in `app.html` and `index.html`: `python scripts/bump_cf_build.py my-feature-2026-11-03` then check the diff.
4. Merge to `main` on origin. Pages deploys automatically; Render deploys the backend.
5. Check `https://countsfor-summer-26.onrender.com/health` (table count should be 12 after the admin page), then the site in a private window.

---

## 16. Testing

### 16.1 Commands

```bash
source .venv/bin/activate

# Backend (in-memory SQLite, no network)
python -m pytest backend/tests -q

# Data pipeline
python -m pytest data/tests -q

# Frontend (Node, runs tests/profile.test.js and tests/data.test.js like tests/test.html)
node scripts/run-data-tests.js

# Frontend in the browser (runs tests/profile.test.js and tests/data.test.js)
python3 -m http.server 8765
# open http://localhost:8765/tests/test.html
```

### 16.2 Results on November 7, 2026 (`cleanup` branch)

| Suite | Result |
|---|---|
| `backend/tests` | **116 passed, 6 failed** |
| `data/tests` | 34 passed |
| `node scripts/run-data-tests.js` | 97 passed, 1 failed (profile 46/46, data 51/52; counted after the runner started loading `profile.test.js` in November 2026) |

Known failures (all pre-date the admin page; the tests are stale, the code is the intended behaviour):

| Test | Why it fails |
|---|---|
| `test_auth.py::test_google_signin_marks_seeded_faculty_complete` | Relies on a seed mechanism the tests no longer wire up (`TestConfig.SEED_USERS_PATH = ""` and the directory skips default files under `TESTING`), so the user stays a student. |
| `test_auth.py::test_patch_me_accepts_consistent_advisor_minor` | Faculty roles may no longer have `advisor_scope`. |
| `test_auth.py::test_google_signin_syncs_directory_role_on_relogin` | Monkeypatches `backend.auth.load_merged_directory`, which no longer exists there. |
| `test_auth.py::test_register_faculty_from_seed` | Same seed issue. |
| `test_users.py::test_area_head_can_patch_user_role` | User management is now admin only (403). |
| `test_users.py::test_seeded_professor_skips_incomplete_on_login` | Same seed issue. |
| JS `annotateDoubleCounters: focused-dual marks courses fulfilling both programs` | Known stale test (also listed in `docs/archive/UX_REVIEW_2026-07-17.md` item 52). |

A seventh failure, `test_auth.py::test_email_signin_normalizes_cmu_domain`, went away when the passwordless `/api/auth/email` route and its tests were removed.

Fixing these tests (by writing a temp seed file and setting `SEED_USERS_PATH` in a fixture, or by inserting `DirectoryEntry` rows) is a good first task for a new maintainer.

### 16.3 Test layout

- `backend/tests/conftest.py`: `app` fixture builds `create_app(TestConfig)`, drops and recreates all tables and runs migrations per test. Fixtures `student`, `professor`, `area_head`, `advisor`, `admin`. `login(client, user)` puts `uid` into the session directly.
- Google sign-in tests patch `id_token.verify_oauth2_token`.
- `backend/tests/test_admin.py` and `test_course_overrides.py` cover the admin page.
- `data/tests/` cover SOC parsing, title mismatch reconciliation, the modern languages overlay and `scripts/bump_cf_build.py`.
- `tests/test-runner.js` is a 48-line assertion helper; `scripts/run-data-tests.js` loads it with Node's `vm`, gives the tests an in-memory `localStorage` and `sessionStorage` (cleared before each test), and prints counts per file and in total. It exits non-zero if any test fails.
- `Testing/` (capital T) is not a test suite; it is the SOC mock server.

There is no CI that runs the backend tests. Only the scrape workflow runs the two SOC parser test files.

---

## 17. Git workflow

### 17.1 Remotes

| Remote | URL | Role |
|---|---|---|
| `origin` | `https://github.com/Adicmu/Countsfor-Summer-26.git` | Main repo (public, not a fork). Pages and Render are attached to it. |
| `hind` | `https://github.com/Hindjendara/Countsfor-Summer-26.git` | Partner's public fork. Daily scrape commits land here. |

### 17.2 Branches (November 2026)

| Branch | State |
|---|---|
| `main` | Production. Everything below that says merged is on it, including the admin page, course editor and sign-in analytics (November 3, 2026). |
| `feat/admin-page` | Merged into `main` on November 3, 2026. Safe to delete. |
| `feature/password-reset-email` | Merged (PR #13). Safe to delete. |
| `feat/login-landing-guest-flags`, `feat/multiple-minors` | Old branches with open PRs #10 and #12 (June 2026). Each has one commit not on `main`, but guest mode, the landing page and multiple minors already exist on `main` in reworked form. Review, then close the PRs and delete the branches. |
| `feat/ui-ux-overhaul`, `landing-copy-and-signin-fixes`, `roster-and-role-views-backup`, `worktree-role-aware-onboarding` | Local-only branches on the original laptop. |
| `origin/gh-pages` | Stale, unused (see 15.1). |
| `hind/main` | Fork main with fresh SOC data. |
| `hind/cursor/adicmu-pages-deploy` | Old experiment. |

### 17.3 How changes get merged

Both styles appear in history. Thirteen pull requests exist on `Adicmu/Countsfor-Summer-26` (11 merged, 2 still open as of November 2026, including PR #9 from the fork `Hindjendara:main`), but since July most work was committed or merged directly into `main` (for example `Merge upstream/main before pipeline push`, `Merge origin/main, keep upstream SOC data`). Recommended going forward:

1. Branch from `origin/main`: `git checkout -b feat/short-name origin/main`.
2. Commit, push, open a PR on `Adicmu/Countsfor-Summer-26`.
3. Before merging, `git fetch origin` and rebase or merge: the bot updates `data/*.json` and `app.html` on `main` often (once the scrape is fixed), so expect conflicts in `app.html` `?v=` tags. Resolve by keeping either tag and re-running `bump_cf_build.py`.
4. Never resolve conflicts inside `data/courses.json` by hand; take one side (`git checkout --theirs data/courses.json`) and rerun `reconcile_offerings.py` and `apply_mapping_overlays.py` if needed.

### 17.4 Commit style

From `git log`: one-line, imperative, sentence case, ending with a period, describing the user-visible change. Examples: `Add an admin page with a course catalog editor.`, `Fix login hang caused by syntax error in app.js home dock.`, `Enable course search and quick add while building schedule plans.` A few older commits use a `feat:` or `fix(dev):` prefix; the recent convention is plain sentences. Bot commits: `Update SOC data (YYYY-MM-DD)`.

---

## 18. Project rules and conventions

1. **No em dashes or en dashes in any user-facing text.** This covers UI strings, toasts, titles, `title=` and `aria-label` attributes, placeholder options, and API `message` strings. Use a colon, comma or period instead. Use "to" for ranges ("9:00 AM to 10:20 AM"). Middle dots (·) are fine. Known violations still in the code are listed in 21.3.
2. **Empty values:** show "None" or "Not listed", never a dash.
3. **Zero dependencies, no build step for the frontend.** No npm packages, no bundler, no framework, no TypeScript. Anything you add must work by opening the file in a browser.
4. **Roles are enforced on the backend.** Every route that changes or reveals protected data needs `@require_role_group(...)` or `@require_role(...)`. Hiding a button is never enough.
5. **Check role groups, not titles**, unless a specific title matters (students only).
6. **Escape everything** interpolated into HTML with `esc()`. This includes course names and descriptions from the scrape and anything a user typed.
7. **Backend errors** use `{"error": "<snake_case_code>", "message": "<plain sentence>"}`.
8. **Audit admin actions**: any route that changes roles, directory, flags or the catalog should call `record_event()` before its commit.
9. **Script order** in `app.html` is `utils, data, profile, api, app`. Bump `?v=` tags when you change any of them.
10. **Do not hand-edit `data/courses.json`** for content fixes; use overlays or the admin editor.
11. **Run backend commands from the repo root** (`python -m backend.<module>`).
12. **Keep `DEPARTMENT_LIST` (`js/profile.js`) and `VALID_DEPARTMENTS` (`backend/models.py`) identical**, and keep `FLAG_REASONS` (`js/app.js`) in sync with `VALID_REASON_CODES` (`backend/flags.py`).

---

## 19. How-to recipes

### 19.1 Add a new major (for example AI)

Requirement data is the hard part. The scrape does not produce requirement mappings; they come from the upstream catalog plus overlays.

1. Get the authoritative requirement list and decide requirement path names (`Top---Sub---Leaf`).
2. Add mappings: either an overlay in `data/mapping_overlays.json` per course (`"requirements": {"AI": [...]}`) and run `python data/apply_mapping_overlays.py`, or use the admin course editor (backend already accepts `AI` and `GS` in `REQUIREMENT_PROGRAMS`).
3. Frontend:
   - `js/data.js`: add the code to `MAJOR_ORDER`; check `MAJOR_META` and `MAJOR_BRAND`; add `LABEL_OVERRIDES` and `setRule(...)` lines if needed; update `annotateMultiProgram()` which has its own hardcoded `['CS','IS','BA','BS']` list (about line 1042); check `splitTreeSections()` GenEd detection.
   - `js/profile.js`: set `dataPending: false` in `PROGRAM_GROUPS`.
   - `css/styles.css`: add `--major-ai` tokens next to `--major-cs` (line 26) for light and dark themes, and any `.ai` classes the tree uses (copy the existing ones for `cs`).
4. Backend: `VALID_PROGRAMS_FOR_PATCH` (`auth.py`), `REQUIREMENT_PROGRAMS` (`course_overrides.py`) and `_VALID_PROGRAMS` (`search_analytics.py`) already include `AI` and `GS`. For a brand new code, add it to all three.
5. If the program has a matching minor, update `MAJOR_MINOR_COLLISION` (`auth.py`) and `MAJOR_TO_MINOR_CODE` (`profile.js`).
6. Test: a student with that major sees the tree; course cards show the new column.

### 19.2 Add a new admin tab

1. Backend: add a route in `backend/admin.py` decorated with `@require_role_group(ROLE_GROUP_ADMIN)`; return JSON.
2. Test: add cases in `backend/tests/test_admin.py` (admin gets 200, faculty and student get 403, anonymous gets 401).
3. `js/api.js`: add `async function apiAdminThing() { return apiFetch('/api/admin/thing'); }`.
4. `js/app.js`: add `['thing', 'Thing']` to `ADMIN_TABS`; add `if (tab === 'thing') return this._loadAdminThing();` in `_loadAdminTab()`; write `_loadAdminThing()` that calls the API, handles errors with `this._admError(r, 'thing')`, and writes HTML into `this._admEl()` using `esc()` for every value.
5. `css/styles.css`: style under the "Admin page" section; reuse `adm-*` classes.
6. Bump `?v=` tags in `app.html`.

### 19.3 Add a new API endpoint end to end

1. Pick or create a blueprint module in `backend/`. New module: `bp = Blueprint("name", __name__, url_prefix="/api/name")` and register it in `create_app()`.
2. Write the route with the right decorator, validate input from `request.get_json(silent=True) or {}`, return `jsonify(...)` with proper status codes and the standard error shape.
3. If it changes protected data, call `record_event()` before `db.session.commit()`.
4. Add pytest tests in `backend/tests/`, using the fixtures and `login()` from `conftest.py`.
5. Add an `api*` function in `js/api.js` using `apiFetch`.
6. Call it from `js/app.js`, branching on `r.ok` and showing `r.data.message` on error.
7. CORS is already set for all `/api/*` paths.

### 19.4 Add a database column safely

1. Add the field to the model in `backend/models.py` (nullable or with a default).
2. Add a migration at the end of `run_migrations()` in `backend/migrate.py`:

```python
if _add_column_if_missing("users", "my_column", "my_column VARCHAR(64)"):
    log.append("Added users.my_column")
```

   Give a separate Postgres DDL as the fourth argument when types differ (for example `TIMESTAMP` vs `TIMESTAMPTZ`, `DEFAULT 0` vs `DEFAULT FALSE`).
3. Update `to_dict()` or `to_public_dict()` if the API should expose it.
4. Test the upgrade path, not only fresh tables: copy an old local DB, run `python -m backend.bootstrap_db` against it with `DATABASE_URL=sqlite:////absolute/path/old.db`, and check the log line appears once and not on the second run.
5. Deploy; check the Render pre-deploy log for your log line.

### 19.5 Edit a course via the admin page

Sign in as admin, open **Admin**, tab **Courses**, search the course, click it, change fields or "counts for" entries, **Save**. The change is visible to everyone on their next page load (overrides are fetched on every load with `no-cache`). To undo: open it again and **Revert** (scraped course) or **Archive** (added course).

### 19.6 Rotate secrets

| Secret | Where | How | Side effect |
|---|---|---|---|
| `SECRET_KEY` | Render dashboard, web service, Environment | Replace with a new random value (or regenerate), save, redeploy | Everyone is signed out (cookies and bearer tokens are both signed with it). Reset links stay valid (they are DB hashes). |
| Postgres password | Render dashboard, database | Rotate credentials; the linked `DATABASE_URL` updates; redeploy | Brief downtime |
| SMTP app password | The sending Google account, App passwords | Create new, update `SMTP_PASS` on Render, revoke old | None |
| `RESEND_API_KEY` | resend.com | Create new key, update Render, delete old | None |
| Google OAuth | Google Cloud Console | The client ID is public; there is no client secret in use. If you must replace the client, update `GOOGLE_CLIENT_ID` on Render and the `cf-google-client-id` meta in both HTML files together | Google sign-in breaks until both match |
| Local `backend/.env` | your laptop | Never commit it (gitignored) | None |

### 19.7 Give someone admin (production)

**Permanent admins** (the project owners): add them to `data/directory_admins.json` (email, name, `role: "admin"`, `primary_program`, `department`), push to `main`, wait for Render to redeploy, then have them sign out and in. As of November 2026 it lists `avivek@andrew.cmu.edu`. Remove people from this file when they leave.

**Anyone else:**

1. Sign in as an existing admin.
2. Admin page, **Faculty access** tab, "Add or edit people" (opens the Directory panel). Enter name and andrew email, role **Admin**, department. Save. This writes a `directory_entries` row (audited as `directory.add`).
3. Ask the person to sign out and sign in again. Their role is applied at sign-in.

Do not use the Users tab alone (reverts on next sign-in) and do not use `ADMIN_EMAILS` (ignored). If no admin exists at all, insert a `directory_entries` row with role `admin` directly in Postgres (Render dashboard, database, connect with `psql` using the External URL):

```sql
INSERT INTO directory_entries (email, name, role, department, primary_program, created_at, updated_at)
VALUES ('someone@andrew.cmu.edu', 'Someone', 'admin', 'Dean''s Office', 'AS', NOW(), NOW());
```

To remove admin: Directory panel, revoke or change the role; they become student or faculty at their next sign-in. Their existing 30-day token still works until then, but the role on their user row is not recomputed until they sign in again, so also change it in the Users tab for an immediate effect.

### 19.8 Debug "the site shows old data"

1. Admin page, Overview: `course_data.last_scrape` shows the server's copy of `data/soc.json`. Compare with `https://adicmu.github.io/Countsfor-Summer-26/data/soc.json` (first lines).
2. `git log origin/main --grep "Update SOC" -3`: when did the bot last commit to the main repo?
3. `gh run list -R Adicmu/Countsfor-Summer-26 --workflow scrape.yml -L 5`: are scrapes failing? (As of Nov 2026 they fail on missing pytest, see 14.2.)
4. `gh run list -R Adicmu/Countsfor-Summer-26 --workflow pages.yml -L 5`: did Pages deploy after the data commit?
5. `curl -s https://adicmu.github.io/Countsfor-Summer-26/app.html | grep cf-build`: did the cache tag change? If the tag did not change, browsers may reuse the old `courses.json`.
6. Hard refresh (Cmd+Shift+R) or a private window.
7. If a single course is wrong but the scrape is fresh, check for an admin override (Admin, Courses, filter "edited") or a mapping overlay.
8. Locally: make sure you are on an up-to-date branch; feature branches carry the data from when they were cut.

---

## 20. Troubleshooting and FAQ

**"Could not reach the server" locally.**
The frontend is not on the port listed in `FRONTEND_ORIGIN` (CORS rejected), or the backend is not on 5050 (the frontend hardcodes `http://localhost:5050` on localhost). Fix the port, or set `cf_backend_override` (5.6).

**`python app.py` fails with "attempted relative import".**
Run from the repo root: `python -m backend.app`.

**Backend crashes at import: "DATABASE_URL is required when FLASK_ENV=production".**
You set `FLASK_ENV=production` locally. Unset it.

**Port 5000 returns 403.**
macOS AirPlay Receiver. Use 5050.

**Different databases depending on how I start the server.**
Fixed in `config.py`: relative SQLite URLs are anchored to `<repo>/instance/`. Use an absolute URL (`sqlite:////full/path.db`) if you want a database elsewhere.

**I changed someone's role in the Users tab and it reverted.**
Expected; see 7.1. Use the directory.

**A faculty member gets the student view.**
Their email is not in the directory (DB or `data/faculty_directory.json`), or it is there with a different spelling (for example `hbouamor@` vs `houda@`). Add them in Faculty access and have them sign in again.

**Sign-in works but the user is asked to onboard every time.**
`profile_completed` is false: students need `primary_program`; faculty and admin need `department` and `primary_program`. Check `/api/me`.

**"Password reset by email isn't available yet."**
No email provider configured on the server (6.1). Configure Resend or SMTP on Render, or use the Google recovery path.

**Google button does nothing.**
The Google Identity Services script failed to load, or the origin is not in the OAuth client's authorized JavaScript origins, or `GOOGLE_CLIENT_ID` on the server does not match the meta tag.

**`/health` returns 503 on Render.**
Missing tables (pre-deploy did not run or failed) or the database is unreachable or expired. Check the deploy log for `FATAL` lines and see "Recovering a deleted database" in section 15.2.

**Production crashes with "column ... does not exist" after a deploy.**
A model gained a column without a `migrate.py` step (11.2). Add the step and redeploy.

**Admin page Courses tab shows no edits.**
`GET /api/courses/overrides` failed or timed out (10 s); the console shows "Course edits unavailable". On production before the admin branch is deployed this route returns 404.

**`App` is undefined in the console.**
Use `App` directly or `typeof App`; it is a `const`, not `window.App`.

**Saved courses or flags disappear after signing in.**
`_syncLocalToServer()` uploads local items once (`cf_synced`). If the upload failed midway, flags stay local. Clear `cf_synced` to retry.

**The scrape workflow fails in 15 seconds.**
`No module named pytest` (14.2).

**Tests fail with role assertions.**
See the known failures in 16.2.

**My page changes do not show on the live site.**
Only `main` deploys. Also bump `?v=` tags so browsers drop cached JS and CSS.

---

## 21. Open issues and roadmap

### 21.1 Security issues (fix first)

1. **Faculty can make themselves admin.** All `/api/directory/entries` write routes accept `role: "admin"` from any faculty user (verified locally: a professor upserted their own entry to admin and was admin after signing in again). Restrict admin grants (and probably all directory writes) to `ROLE_GROUP_ADMIN`.
2. Students can read `admin_notes` on non-dismissed flags (`GET /api/flags`). Decide whether notes should be private.

### 21.2 Operational issues

1. The scrape workflow on this repo failed every day from July 9 to November 3, 2026 because it never installed `pytest`. Fixed on November 3 (an "Install test runner" step in `scrape.yml`). Check the Actions tab after the next 12:00 UTC run; until a run succeeds, live data stays at the August 13, 2026 scrape (14.2).
2. Role edits in the Users tab do not persist (7.1). Either make `PATCH /api/users` also write a directory entry, or show a warning in the UI.
3. Render service naming and ownership are unclear (15.2). Confirm in the dashboard; remove the stray `countsfor-backend` service and `countsfor-db` database if they still exist.
4. 6 backend tests and 1 JS test fail (16.2). No CI runs the backend tests.
5. Email reset provider status in production unknown.

### 21.3 Code hygiene

- The no-dash rule (section 18) was fully applied to user-facing text on November 3, 2026. Check new strings before committing: `grep -n "[—–]" js/*.js *.html` should only find code comments.
- Done in November 2026: `js/landing.js` no longer keeps its own copies of the backend URL, token storage, fetch wrapper, auth calls, `esc`, `showToast` or the CMU email check. It loads `js/api.js` and `js/utils.js` like the app. The frontend has one CMU email check (`normalizeCmuEmail` in `js/utils.js`) and the backend has one (`backend/cmu.py`).
- Dead code: unused `users.reset_token_hash` and `reset_token_expires` columns (kept on purpose: dropping them is a schema change). The rest of the dead code found in the November 2026 audit was removed: the old in-app sign-in screens and their CSS, unused `App` methods, `isStudentRole`, `ROLE_GROUPS`, `FACULTY_GROUPS`, `getOnboardingUiGroup`, `apiUpdateDirectoryEntry`, `apiGetMyFlags`, the `API_BASE` and `GITHUB_RAW` course data fallbacks, `role_group_for`, `_can_manage_users`, `_ensure_staff_directory_table`, the `StaffDirectoryEntry` alias, the legacy `/api/directory/staff` routes, and about 170 CSS classes that nothing rendered.
- Also removed in November 2026: `data_all_courses.json` (a 24 MB copy of `data/courses.json` that nothing read; the pipeline now writes only `data/courses.json`), the empty `data/requirements_ai.json` and `data/requirements_gs.json` placeholders, the stale `backend/schema.sql`, `data/scripts/inspect_mappings.py`, and the inline cached-CSS `<style>` block in `app.html` (its rules already live in `css/styles.css`). The partner fork may still carry `data_all_courses.json`.
- In-memory `_cache` in `api.js` and the 24 MB catalog download make first load slow (UX review items 4 to 12).
- `cf_flags` local queue has no cap.

### 21.4 Product roadmap (from docs and code comments)

- AI and GS majors: waiting on authoritative requirement specs (`js/data.js` line 16).
- Minor course lists are empty for most minors (`data/minor_courses.json`).
- Server-side storage of a user's own schedule plans (today they are browser-only).
- UX review (`docs/archive/UX_REVIEW_2026-07-17.md`): deploy hygiene, dark theme parity, copy consistency, accessibility (keyboard navigation of the tree, ARIA for typeahead), slimmer boot payload.
- Not done yet: CMU Andrew SSO (Shibboleth, needs IT), ML-based offering prediction (current `predictOffering()` is rule-based), deduplication of `courses.json`.
- Analytics Phase 2 (feature usage counts, onboarding funnel) and Phase 3 (weekly digest, semester report): proposals in `docs/analytics-plan/`. Phase 1 (section 13) is live.

---

## 22. Known stale docs

On November 3, 2026 the repo was cleaned: the old deploy and setup guides (`docs/RENDER_*.md`, `DEPLOY_*.md`, `SETUP_AUTH.md`, `SUPABASE_HOSTING.md`, `BACKEND_API_CONTRACT.md`), AI session notes, about 90 MB of screenshots, an old React bundle, unused JSON scaffolds, a session log and dead code were deleted, and planning documents were moved to `docs/archive/`. Everything still useful from the deleted guides is in this README (the Render recovery steps are in 15.2). They remain in git history if you ever need them (`git log --all -- docs/RENDER_UPGRADE.md`).

What is still out of date:

| Document | What is wrong |
|---|---|
| `docs/archive/*` | History only. Plans, proposals and design specs from 2026; many details no longer match the code. |
| `landing/DESIGN_NOTES.md` | Design notes for the landing page; refers to `docs/scotty-head.png` (the image is `assets/img/scotty-head.png`). |
| `backend/.env.example` | Presents `ALLOW_SQLITE=1` as required; it has no effect. |
| `backend/.env` (local, not in git) | Comment says an empty `SMTP_HOST` returns the reset link inline; that only happens with `EXPOSE_RESET_TOKEN=1`. |
| Code comments | `backend/users.py` mentions area heads managing users; `backend/models.py` says there is no password column. |
| `CONTEXT.md` | Not in git at all (gitignored). Successors will not have it. |

---

## 23. Handover checklist

No secret values belong in this file or in git. Hand secrets over in person or through a password manager.

### 23.1 Accounts and access the successor needs

- [ ] **GitHub**: admin (or at least write) access to `Adicmu/Countsfor-Summer-26`, including Settings (Pages, Actions, secrets). Consider transferring the repo to a CMU-Q organization so it does not depend on a personal account.
- [ ] **GitHub fork**: decide what happens to `Hindjendara/Countsfor-Summer-26`. Today it is the only place the scrape works. After fixing `scrape.yml` on origin, the fork can be retired.
- [ ] **Render**: membership on the Render account or team that owns the `countsfor-summer-26` web service and the `CountsFor_Summer_2026` database, including billing (plans are paid `starter`). Record who pays.
- [ ] **Database**: ability to open the Postgres database (Render dashboard; External Database URL for `psql` or DBeaver). Take a backup (`pg_dump`) before major changes.
- [ ] **Google Cloud**: owner or editor on the project that holds the OAuth client `378923997481-...` (to edit authorized origins and the consent screen).
- [ ] **Email**: the Resend account or the Gmail account (with app password) used for reset emails, if configured. If not configured, decide whether to set one up.
- [ ] **CMU-Q IT contact**: who controls `countsfor.qatar.cmu.edu` and could host CountsFor on campus or enable Andrew SSO.
- [ ] **At least one production admin account** belonging to a staff member (not a student who will graduate), created through the directory (19.7).
- [ ] **Faculty directory owner**: someone who decides who gets faculty access and refreshes `data/faculty_directory.json`.

### 23.2 Knowledge transfer

- [ ] Walk the successor through sections 5, 7, 11.2, 14.2 and 21.1 of this manual.
- [ ] Hand over `CONTEXT.md` and any other gitignored notes from the original laptop, or commit what is still relevant.
- [ ] Confirm which branch Render auto-deploys and write it into section 15.2.
- [ ] Confirm whether an email provider is configured in production and write it into section 6.1.

### 23.3 Before the owner leaves

- [ ] Fix the security issues in 21.1.
- [ ] Fix the scrape workflow (add `pip install pytest`) and confirm a green run.
- [x] Merge and deploy `feat/admin-page` and the sign-in analytics (done November 3, 2026).
- [ ] Rotate `SECRET_KEY`, the database password and any email credentials, then give the new values only to the successor.
- [ ] Remove the original owner's personal admin directory entry if appropriate.
