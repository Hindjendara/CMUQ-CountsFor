# CountsFor

A role-aware curriculum explorer for Carnegie Mellon University in Qatar. Students, faculty and advisors look up any course and see exactly which major, minor and Gen Ed requirements it counts for, plan schedules, save courses and flag catalog mistakes. Admins edit the catalog and see usage.

**Live site today:** [adicmu.github.io/Countsfor-Summer-26](https://adicmu.github.io/Countsfor-Summer-26/) (GitHub Pages) with the API on Render (`https://countsfor-summer-26.onrender.com`), both built from `main`. **New home:** `https://countsfor.qatar.cmu.edu` on a CMU-Q Ubuntu server ([section 15](#15-deploy-to-the-cmu-q-server)), not live yet. **Repo:** [Adicmu/Countsfor-Summer-26](https://github.com/Adicmu/Countsfor-Summer-26)

**Quick start:** see [section 5](#5-local-setup-from-a-fresh-mac). In short, from the repo root: create a virtualenv in `.venv` and `pip install -r backend/requirements.txt`, copy `backend/.env.example` to `backend/.env`, run the API with `python -m backend.app` (port 5050), serve the site with `python scripts/dev_server.py` (port 8765; it serves `frontend/` and proxies `/api` to the API), and open `http://localhost:8765/`.

## About this README

This README is the project's complete maintainer manual. It was written so that a new student developer can take over CountsFor alone, with no access to the original authors. Every statement was checked against the code on the `cleanup` branch in November 2026 unless it is explicitly marked as uncertain. If anything else in the repo disagrees with this file, trust this file and the code, and then fix whichever is wrong.

> **Where things stand (November 8, 2026).** The `cleanup` branch moves CountsFor from GitHub Pages and Render to a CMU-Q server: the repo is split into `frontend/` (the static site) and `backend/` (the Flask API, the scraper and private data), every setting comes from the environment, the site calls the API by relative path, a system cron job replaces the GitHub Actions scrape, and `deploy/` holds the server files (systemd, Apache, cron, logrotate, environment templates). The branch is **not merged into `main` yet**. Until someone carries out the cutover in [15.15](#1515-cutover-from-github-pages-and-render), the live site keeps running on GitHub Pages and Render from `main`, with the old layout. Sections that describe the old hosting say so.

Paths in this file are relative to the repo root (`frontend/js/app.js`, `backend/auth.py`). Inside the frontend sections, `js/`, `css/` and `tests/` mean `frontend/js/`, `frontend/css/` and `frontend/tests/`, because that is how the pages refer to them.

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
15. [Deploy to the CMU-Q server](#15-deploy-to-the-cmu-q-server)
    - [15.8 Import the Render database](#158-import-the-render-database)
    - [15.15 Cutover from GitHub Pages and Render](#1515-cutover-from-github-pages-and-render)
    - [15.16 Updating the code later](#1516-updating-the-code-later)
    - [15.19 Troubleshooting the server](#1519-troubleshooting-the-server)
    - [15.20 Old hosting: GitHub Pages and Render (historical)](#1520-old-hosting-github-pages-and-render-historical)
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

CountsFor is a web app for Carnegie Mellon University in Qatar (CMU-Q). It answers one question: **"What does this course count for?"** For every course in the catalog it shows which requirements it satisfies in each CMU-Q undergraduate major (Computer Science, Information Systems, Business Administration, Biological Sciences, Artificial Intelligence), including General Education (GenEd) categories, plus section times from CMU's Schedule of Classes.

### 1.1 Who uses it

| Audience | What they do in CountsFor | Role(s) in the app |
|---|---|---|
| Students | Search courses, see what each counts for in their major and minors, save courses with notes ("Saved" list, internally "wishlist"), build weekly schedule plans and share them | `student` |
| Faculty | Same browsing as students, plus report data problems ("flag" a course), see the flag queue, see students' saved-course roster for advising, manage the faculty directory | `professor`, `area_head`, `associate_area_head`, `advisor` (all share one permission group, `faculty`) |
| Admins | Everything faculty can do, plus the Admin page: edit the course catalog, manage user roles, see usage insights and the audit log | `admin` |
| Guests | Browse without an account (local only, nothing saved on a server) | none (demo mode) |

### 1.2 Stakeholders and people

- **Aditya Vivek** (GitHub `Adicmu`): original author and owner of the main repo `Adicmu/Countsfor-Summer-26`. CMU-Q student.
- **Hind Jendara** (GitHub `Hindjendara`): co-developer. Owns the fork `Hindjendara/Countsfor-Summer-26` (git remote `hind`) and the working repo `Hindjendara/CMUQ-CountsFor` where the `cleanup` branch was made (17.1). GS requirement data is expected to come from her (see `MAJOR_ORDER` in `frontend/js/data.js`).
- CMU-Q faculty, area heads and advisors: the faculty directory in `backend/data/faculty_directory.json` (65 people scraped from the public CMU-Q People page) decides who gets faculty access.
- CMU-Q IT: runs the Ubuntu server CountsFor is moving to and owns the `countsfor.qatar.cmu.edu` hostname and its certificate (see [15.2](#152-prerequisites)).
- Upstream data source: the course-to-requirement mappings originally came from the older open-source project [open-cmuq/CountsFor](https://github.com/open-cmuq/CountsFor) (credited in `README.md`).

### 1.3 What it is not

- It is not an official degree audit. Mappings come from upstream data plus manual overlays and admin edits.
- The GS (General Studies) major is defined in `js/data.js` (marked `dataPending`) but has **no requirement data** and is not in `MAJOR_ORDER`.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **SOC** | Schedule of Classes. CMU's public course offering site at `https://enr-apps.as.cmu.edu/open/SOC/SOCServlet`. The scraper reads sections, days, times, campus and modality from it. |
| **Semester codes** | `F26` = Fall 2026, `S26` = Spring 2026, `M26` = Summer 2026, `N26` = Fall mini (see `SEASON_NAME` in `js/data.js`). Backend validates with regex `^[FSMN]\d{2}$`. |
| **Course code** | Always normalized to `NN-NNN`, e.g. `15-122`. `normalizeCourseCode()` in `js/data.js` and `_normalize_code()` in `backend/course_overrides.py` accept `15122`, `15122.0`, `15-122`. |
| **Requirement path** | A string of segments joined by three hyphens, e.g. `GenEd---Foundations---Contextual Thinking`. The frontend splits on `---` to build the requirement tree. The bucket names are the 2026-27 catalog's (14.10). |
| **`type` on a requirement** | Boolean. `true` means GenEd, `false` means a major (core) requirement. |
| **Earlier requirement** | A requirement row with `"earlier": true` and a short `earlier_reason` (for example "older degree version"): the course was mapped to that bucket before, but the 2026-27 catalog no longer lists it there. It is kept, not deleted, and the app tags it "Earlier requirement" (14.10). |
| **GenEd** | General Education. University core requirements every student in a major must satisfy (humanities, cultural analysis and so on). Every major keeps it under the `GenEd` root, and `splitTreeSections()` treats that root as GenEd. |
| **Majors** | `CS` Computer Science, `IS` Information Systems, `BA` Business Administration, `BS` Biological Sciences, `AI` Artificial Intelligence. Live in `MAJOR_ORDER`. Scaffolded but not live: `GS`. |
| **`AS`** | "Arts & Sciences". Not a major. A grouping used as the `primary_program` of cross-program faculty and as the default program for directory entries (`DEFAULT_DIRECTORY_PROGRAM = "AS"`). Students can never pick it. |
| **Minors** | The 17 minors of `frontend/data/minors.json`, built from the official files in `backend/data/minors/` and, for `product` (Product Management, which has no official file), from its 2026-27 catalog page (4.4): arabic, biology, business, business_analytics, comp_bio, cs, economics, finance, history, math, neuroscience, product, writing, psychology, sociology, self_defined, tech_entre. The same codes are in `VALID_MINORS_FOR_PATCH` (`backend/auth.py`) and in the fallback `MINOR_LIST` (`js/profile.js`). Some majors may not declare some minors (`blocked_majors` in the file, `MAJOR_MINOR_COLLISION` in `auth.py`, `MINOR_BLOCKED_MAJORS` in `profile.js`): CS not `cs`, BS not `biology`, BA not `business`, `business_analytics`, `finance` or `product`. A student's minors show in their requirement tree, and every minor in the Minors tab (8.10). |
| **Course status** | What a student marked a course as: not taken, in progress or completed. Kept in the browser (`localStorage['cf_course_status']`) for guests and signed-in students alike; the server does not store it yet. It drives the minor progress and the double counting warnings (8.10). |
| **Role** | Exact title stored on the user: `student`, `professor`, `area_head`, `associate_area_head`, `advisor`, `admin`. |
| **Role group** | Permission bucket computed by `User.role_group()`: `student`, `faculty` (the four faculty titles), `admin`. **All permission checks use role groups**, except a few student-only routes that use the exact role. |
| **Directory** | The list of people who get faculty or admin access. Two layers: a JSON seed file (static) plus the `directory_entries` table (editable, wins on conflict). Your role is recomputed from the directory **on every sign-in**. |
| **Flag** | A data-problem report a faculty member files against a course (reason codes in `backend/flags.py`). Statuses: `pending`, `reviewed`, `resolved`, `dismissed`. |
| **Wishlist / Saved** | A student's saved courses with optional notes (`wishlist_items`). The UI calls it "Saved". |
| **Plan / schedule plan** | A weekly schedule built from course sections. Stored in browser localStorage; the server only stores shared copies. |
| **Override** | An admin edit to the course catalog stored in the database (`course_overrides`) and applied in the browser on top of the scraped `frontend/data/courses.json`. |
| **Mapping overlay** | A manual complement to the SOC scrape in `backend/data/mapping_overlays.json` (additive mappings, mapping removals, Qatar visibility), applied to the catalog file by the scrape pipeline. |
| **Demo mode / guest mode** | Running the frontend without a signed-in user. Everything is local to the browser. |
| **The server** | The CMU-Q Ubuntu 24.04 machine for `countsfor.qatar.cmu.edu`: Apache serves `frontend/`, Gunicorn runs the API, PostgreSQL holds the database, cron runs the scraper (section 15). |
| **Deploy root** | `/var/www/html/countsfor` on the server, holding `frontend/` and `backend/`. `CF_DEPLOY_ROOT` in the daily update. |
| **Daily update** | `backend/scraper/update_data.py`, run by cron through `run_scrape.sh`: scrape, rebuild, check and publish the catalog in place (14.2). |
| **`countsfor`** | The system user that owns the deploy root, runs the API and the daily update, and owns the PostgreSQL database of the same name. |
| **Render** | Old hosting: the company that runs the Flask backend and its Postgres database until the cutover (15.20). |
| **GitHub Pages** | Old hosting: static hosting for the frontend until the cutover (15.20). |

---

## 3. Architecture

### 3.1 Big picture

This is the CMU-Q server setup (section 15). Until the cutover the live site still runs on GitHub Pages and Render (15.20). Locally, `scripts/dev_server.py` plays Apache's part and SQLite stands in for PostgreSQL (section 5).

```
  Browser
    index.html (landing): js/utils.js, js/api.js, js/landing.js
    app.html (main app):  js/utils.js -> js/data.js -> js/profile.js -> js/api.js -> js/app.js
    localStorage / sessionStorage (token, profile, plans, theme, ...)
          |                                         |
          | pages, js, css, data/courses.json       | /api/... on the same origin (relative URLs)
          | (sent gzipped, about 1.2 MB)            | Authorization: Bearer <token>, cookie cf_session
          v                                         v
  +--------------------------------------------------------------------------+
  | Apache 2.4  https://countsfor.qatar.cmu.edu   (port 80 redirects to 443) |
  |   DocumentRoot /var/www/html/countsfor/frontend                          |
  |   ProxyPass /api/  ->  http://127.0.0.1:8000/api/                        |
  +-------------------------------------+------------------------------------+
                                        |
                                        v
  +--------------------------------------------------------------------------+
  | Gunicorn, systemd unit countsfor-api, 3 workers on 127.0.0.1:8000        |
  |   'backend.app:create_app()'  blueprints: auth, flags, wishlist, users,  |
  |   directory, search-analytics, plans, admin, course overrides; /health   |
  +-------------------------------------+------------------------------------+
                                        |
                                        v
  PostgreSQL database "countsfor" on the same machine (peer authentication)

  cron, daily 15:00:  backend/scraper/run_scrape.sh  ->  update_data.py
    reads   CMU Schedule of Classes (enr-apps.as.cmu.edu)
    writes  backend/data/soc.json, frontend/data/courses.json and courses.json.gz
```

### 3.2 Key ideas

1. **Zero-build frontend.** Plain HTML, CSS and JavaScript. No npm, no bundler, no framework. Files are loaded with `<script>` tags in a fixed order and share globals. What is in the repo is exactly what is served.
2. **The course catalog is a static file.** `frontend/data/courses.json` (6,784 courses, about 30 MB, about 1.2 MB gzipped) is downloaded by the browser on every app load (Apache answers 304 when it has not changed). The API does not serve course data. On the server the daily update rewrites this file in place (14.2); nothing commits it to git any more.
3. **The backend stores people and their activity**: users, roles, directory, flags, saved courses, shared plans, search counts, admin catalog edits and the audit log.
4. **Admin catalog edits are layered on top of the static file in the browser** (`applyCourseOverrides()` in `js/data.js`), because the scrape would overwrite any edit made directly in `frontend/data/courses.json`. See [section 12](#12-course-overrides-admin-catalog-edits).
5. **Security lives on the backend.** The UI hides buttons based on role, but every protected route checks the role group server side.

### 3.3 Where the frontend finds things

There are two different "base URLs" in `js/api.js`. Do not confuse them.

| Constant / function | Used for | Value / logic |
|---|---|---|
| `LOCAL_DATA` | The course catalog | `frontend/data/courses.json` with `?v=<cf-build meta>` appended by `_bundledDataUrl()` |
| `MINORS_DATA` | The minor requirements | `frontend/data/minors.json`, with the same `?v=` tag, loaded by `fetchMinors()` |
| `getBackendUrl()` / `CF_BACKEND_URL` | **The Flask backend** (all `/api/...` calls) | See resolution order below |

`fetchAllCourses()` loads only the bundled `frontend/data/courses.json`. There is no remote fallback: if the file cannot be loaded or has no courses, it throws and `App.loadData()` shows "Failed to load data". `fetchMinors()` loads `frontend/data/minors.json` the same way, at the same time; when it fails, the app still runs and each minor section says its requirements could not be loaded.

The pages call the API on their own origin: `CF_BACKEND_URL` is normally `''`, so `apiFetch('/api/me')` requests the relative URL `/api/me`. In production Apache serves `frontend/` and proxies `/api` to gunicorn; locally `scripts/dev_server.py` serves `frontend/` and proxies `/api` and `/health` to the Flask dev server on `127.0.0.1:5050` (5.6). There is no backend URL in the HTML.

`getBackendUrl()` (in `js/api.js`, used by both pages) returns, in order:

1. `localStorage['cf_backend_override']` if set (debugging escape hatch, for example a local page against another backend; that backend's `FRONTEND_ORIGIN` must then list the page's origin for CORS).
2. `window.CF_BACKEND_URL` if set before `api.js` loads.
3. `''` (same origin), the normal case.

`App.init()` has no demo-mode fallback for an unreachable server any more: a 401 or an unreachable API redirects to `index.html`, which shows the sign-in form or the "Could not reach the server" banner with a guest link. Guest mode is the only localStorage-only mode.

### 3.4 Authentication model

- Two ways to prove identity: **email + password** (`/api/auth/register`, `/api/auth/login`) and **Google Sign-In** (`/api/auth/google`, verifies a Google ID token against `GOOGLE_CLIENT_ID`). The old passwordless route `/api/auth/email` was removed in November 2026.
- After sign-in the server sets a signed Flask session cookie `cf_session` **and** returns an `auth_token` in the JSON body. The token is an `itsdangerous` signed `{"uid": id}` valid for 30 days (`backend/tokens.py`). The frontend stores it and sends `Authorization: Bearer <token>` on every call. The token dates from when the site (github.io) and the API (onrender.com) were on different sites and browsers blocked the cookie; now that they share one origin the cookie is first-party (`SameSite=Lax`), but the frontend still relies on the token, so both stay.
- Token storage: `sessionStorage['cf_auth_token']` by default, or `localStorage['cf_auth_token']` if the user ticked "Keep me signed in" on the landing page.
- On every sign-in the backend recomputes the role from the directory (`_sync_directory_profile()` in `backend/auth.py`). This is the single most important rule to understand about roles. See [section 7](#7-signing-in-locally-and-making-yourself-admin).

### 3.5 Databases

| Environment | Database | How it is chosen |
|---|---|---|
| Production (CMU-Q server) | Local PostgreSQL, database and role `countsfor` | `DATABASE_URL=postgresql:///countsfor` in `/etc/countsfor/countsfor.env` (Unix socket, peer authentication). `config.py` refuses to start without `DATABASE_URL` when `FLASK_ENV=production`. |
| Production until the cutover (Render) | Postgres, Render database `CountsFor_Summer_2026` (region Ohio) | Linked in the Render dashboard. Its data moves to the server with `pg_dump` and `pg_restore` (15.8). |
| Local | SQLite file | Any relative `sqlite:///name.db` URL is rewritten to `backend/instance/name.db`. With no `DATABASE_URL` at all, local dev also falls back to `backend/instance/countsfor.db`. |
| Tests | In-memory SQLite | `TestConfig.SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"` |

Nothing in the code is specific to one Postgres host; any `postgresql://` URL works.

---

## 4. Repository map

The repo has the same shape as the server (`/var/www/html/countsfor/{frontend,backend}`, see 15.1): `frontend/` is exactly what Apache serves, minus its tests, and `backend/` is the Python package `backend`, deployed as it is.

```
CountsFor/
|-- frontend/            static site served by Apache (no build step)
|   |-- index.html, app.html, reset.html, landing/index.html
|   |-- js/  css/  assets/img/
|   |-- data/            served catalog: courses.json, minors.json
|   `-- tests/           JS unit tests (not deployed)
|-- backend/             Flask API (Python package "backend")
|   |-- *.py             app, config, models, routes
|   |-- data/            private data, never served: soc.json, mapping_overlays.json,
|   |                    faculty_directory.json, directory_admins.json, minors/
|   |-- scraper/         SOC scrape pipeline, the cron entry point and their tests
|   |-- tests/           API tests
|   `-- requirements.txt
|-- deploy/              server files: systemd unit, Apache site, cron, logrotate, env templates
|-- scripts/             dev_server.py, bump_cf_build.py, run-data-tests.js
|-- docs/                analytics plan, landing design notes, archive
|-- pytest.ini           "python -m pytest" runs backend/tests and backend/scraper/tests
`-- README.md            this manual
```

### 4.1 Top level

| Path | Tracked in git? | What it is | Status |
|---|---|---|---|
| `frontend/index.html` | yes | Landing page: sign in, create account, forgot and reset password, "Continue as guest". Loads `js/utils.js`, `js/api.js` and `js/landing.js`. | Live |
| `frontend/app.html` | yes | Main app shell. Loads `utils.js`, `data.js`, `profile.js`, `api.js`, `app.js` in that order. Holds the `cf-build` cache tag and the Google client ID meta. There is no backend URL in it: the API is on the same origin (3.3). | Live |
| `frontend/reset.html` | yes | Redirect stub to `index.html` keeping the query string (old reset links). | Keep |
| `frontend/landing/index.html` | yes | Redirect stub to `../index.html`. | Keep (old links) |
| `frontend/js/` | yes | All frontend logic. See [section 8](#8-frontend-walkthrough). | Live |
| `frontend/css/styles.css` | yes | App styles, about 4,500 lines, light and dark tokens at the top. | Live |
| `frontend/css/landing.css` | yes | Landing page styles. | Live |
| `frontend/assets/img/` | yes | Scotty and CMU artwork used by the landing and navbar, plus the two favicons (`scotty-portrait.png` for the landing, `scotty-standing.png` for the app). | Live |
| `frontend/data/` | yes | Served catalog: `courses.json` (6,784 courses, about 30 MB) and `minors.json` (minor requirements). On the server the daily update rewrites `courses.json` and adds `courses.json.gz` and `courses.json.prev` (both gitignored or never committed). See [4.4](#44-backenddata-and-backendscraper). | Live |
| `frontend/tests/` | yes | Browser test page (`test.html`) and JS unit tests. Not deployed (the rsync in 15.4 skips it, and Apache denies `/tests/`). | Live |
| `backend/` | yes | Flask API, private data and the scraper. See [4.2](#42-backend) and [section 9](#9-backend-walkthrough). | Live |
| `deploy/` | yes | Everything the CMU-Q server needs besides the code. No secrets. See [4.3](#43-deploy). | Live |
| `scripts/dev_server.py` | yes | Local server that mirrors production: serves `frontend/` on port 8765 and proxies `/api` and `/health` to the API on `127.0.0.1:5050` (5.6). Standard library only. | Live |
| `scripts/bump_cf_build.py` | yes | Rewrites the `cf-build` meta and every `?v=` tag in `frontend/app.html`, and every `?v=` tag in `frontend/index.html`. A release tool, run by hand. Optional on the server, where Apache makes browsers revalidate (15.16). | Live |
| `scripts/run-data-tests.js` | yes | Node runner for `frontend/tests/profile.test.js`, `data.test.js`, `minors.test.js` and `utils.test.js`, with an in-memory `localStorage`, plus the Node-only `dash-guard.test.js`, `minors-file.test.js`, `app-views.test.js` and `catalog-data.test.js`. It waits for tests that return a promise. | Live |
| `pytest.ini` | yes | Lets `python -m pytest` from the repo root run `backend/tests` and `backend/scraper/tests` together. | Live |
| `.gitattributes` | yes | Keeps `*.sh` and everything in `deploy/` at LF line endings in every checkout (a CR breaks bash, cron and systemd, for example on Windows with `core.autocrlf`). | Live |
| `README.md` | yes | This manual. | Keep current |
| `docs/` | yes | `docs/analytics-plan/` (the team analytics plan, HTML source and PDF), `docs/landing-DESIGN_NOTES.md` (landing design notes) and `docs/archive/` (sprint plans, proposals, progress report, wireframes, UX review and design specs from 2026; history only, not current truth). | Reference |
| `.venv/` | no (gitignored) | Your local Python virtual environment, at the repo root (5.3). On the server the environment is `backend/.venv/` instead. | Local only |
| `backend/instance/` | no (gitignored) | Local SQLite databases. Before November 2026 they were in `instance/` at the repo root; move an old `countsfor.db` here. | Local only |
| `backend/var/` | no (gitignored) | Made by the daily update: `update.lock` and `staging/`. Exists on the server, or locally after you run `update_data.py`. | Local only |
| `CONTEXT.md` | **no** (gitignored) | A long "complete project context" doc that exists only on the original author's laptop. A successor cloning the repo will not have it. | Local only |
| `server.log`, `Branding Assets/` | no (gitignored) | Local log file; design source files. | Local only |
| `.claude/`, `.superpowers/` | no | AI assistant working folders. | Local only |

Removed in November 2026 and still in git history: `render.yaml`, `backend/Procfile`, `runtime.txt`, `backend/runtime.txt`, the root `requirements.txt` (it only pointed at `backend/requirements.txt`), `.github/workflows/` (`scrape.yml`, `pages.yml`, `keepalive.yml`), `.nojekyll` and `Testing/` (an unused mock SOC server).

### 4.2 `backend/`

| File | Purpose |
|---|---|
| `__init__.py` | Makes `backend` a package. Modules use relative imports, so always run them as `python -m backend.<module>` from the folder that holds `backend/` (the repo root, or `/var/www/html/countsfor` on the server). |
| `app.py` | App factory `create_app()`, `init_database()`, `ProxyFix` when `TRUST_PROXY` is on, CORS setup, blueprint registration, `/health`, JSON 404, dev entry point (`python -m backend.app`). |
| `config.py` | Every setting, read from environment variables (6.1). Loads `backend/.env` if present. Also `TestConfig`. |
| `db.py` | The shared `SQLAlchemy()` instance. |
| `models.py` | All ORM models (14 tables) and role constants (`VALID_ROLES`, `FACULTY_ROLES`, `VALID_DEPARTMENTS`, `FLAG_STATUSES`). |
| `db_schema.py` | `REQUIRED_TABLES` (checked by `/health` and bootstrap) and URL redaction helpers. |
| `migrate.py` | Hand-written, idempotent `ALTER TABLE` and `CREATE TABLE` steps for databases that predate a model change. |
| `bootstrap_db.py` | `python -m backend.bootstrap_db`: create missing tables, run migrations, verify required tables. On the server systemd runs it before every start of the API (`ExecStartPre`). |
| `permissions.py` | `require_login`, `require_role_group`, `require_role`, `current_user`, user loading from cookie or bearer token. |
| `tokens.py` | Bearer token sign and verify. |
| `cmu.py` | The one backend CMU email check: `normalize_cmu_email()` (accepts `andrew.cmu.edu`, `cmu.edu`, `qatar.cmu.edu`, always returns `@andrew.cmu.edu`, rejects an empty local part, whitespace or a second `@`; same rules as `normalizeCmuEmail()` in `frontend/js/utils.js`) and `email_in_domain()` (the `ALLOWED_EMAIL_DOMAIN` check). Also seed file helpers. Used by `auth.py`, `directory.py`, `directory_routes.py` and `plans.py`. |
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
| `email_util.py` | Password reset email via Resend API or SMTP. |
| `requirements.txt` | Pinned Python dependencies (Flask 3.0.3, Flask-SQLAlchemy 3.1.1, flask-cors 4.0.1, SQLAlchemy 2.0.51, psycopg2-binary 2.9.10, google-auth, requests, itsdangerous, gunicorn 22.0.0, python-dotenv, pytest 8.3.2). pytest is installed on the server too: the daily update runs the parser tests before it scrapes. |
| `.env.example` | Template for `backend/.env`: every variable the API reads, with local values and the production value in a comment. |
| `.env` | Your local settings. Gitignored. Never used on the server (secrets live in `/etc/countsfor/`). |
| `seed_users.example.json` | Example directory seed rows. |
| `seed_users.json` | Optional local directory seed. Gitignored by `backend/.gitignore`. |
| `README.md` | Points to this manual. |
| `tests/` | API pytest suite (section 16), including `test_config.py` (production guards, cookies, `TRUST_PROXY`), `test_env_example.py` (the env templates match the code) and `test_deploy_files.py` (the `deploy/` files match the repo). |
| `data/` | Private data, never served: `soc.json`, `mapping_overlays.json`, `faculty_directory.json`, `directory_admins.json`, `minors/`. See 4.4. |
| `scraper/` | The scrape pipeline. See 4.4 and section 14. |
| `.venv/`, `var/` | Server only (and gitignored): the virtual environment that runs both the API and the scraper, and the daily update's lock and staging folder. |

### 4.3 `deploy/`

Each file starts with comments that give its install commands. Section 15 walks through them in order.

| File | Installed on the server as | What it does |
|---|---|---|
| `countsfor-api.service` | `/etc/systemd/system/countsfor-api.service` | Runs Gunicorn (3 workers, `127.0.0.1:8000`, timeout 120 s) on `'backend.app:create_app()'` from `/var/www/html/countsfor`, as user and group `countsfor`, with `/etc/countsfor/countsfor.env`. Runs `python -m backend.bootstrap_db` before every start. Restarts on failure. Hardened: the whole file system is read-only for the API (it writes no files), private `/tmp`, no capabilities. |
| `countsfor.conf` | `/etc/apache2/sites-available/countsfor.conf` | Apache site for `countsfor.qatar.cmu.edu`: port 80 redirects to HTTPS; port 443 serves `frontend/`, proxies `/api/` to Gunicorn without stripping the prefix, keeps `/health` private, denies `backend/` and the rest of the deploy root server wide plus `tests/`, dotfiles and source or env files, serves `courses.json.gz` to browsers that accept gzip, sends `no-cache` (ETag revalidation) for html, js, css and json and 30 days for images, and sets HSTS and other security headers. The certificate and key names are `CHANGE_ME` placeholders. |
| `countsfor.cron` | `/etc/cron.d/countsfor` (no dot: cron skips file names with a dot) | Daily 15:00 run of `backend/scraper/run_scrape.sh` as `countsfor`, under `flock` and `timeout`, appending to `/var/log/countsfor/scrape.log`; on failure it prints one line, which cron mails only if `MAILTO` is set (empty by default, so failures are silent, 15.12). Commented out: a weekday 09:00 run and a nightly `pg_dump` with 14-day retention. |
| `countsfor.logrotate` | `/etc/logrotate.d/countsfor` | Weekly rotation of `/var/log/countsfor/*.log`, 12 kept. |
| `countsfor.env.example` | `/etc/countsfor/countsfor.env` (mode 640, `root:countsfor`) | The API's environment on the server. Replace every `CHANGE_ME`. |
| `scraper.env.example` | `/etc/countsfor/scraper.env` (mode 640, `root:countsfor`) | The daily update's environment. Everything in it is optional. |

`backend/tests/test_deploy_files.py` checks these files against the repo on every test run: every `/var/www/html/countsfor` path they name exists, the Apache sections are balanced, the proxy target matches the Gunicorn bind and Flask's `/api` routes, `ProxyTimeout` is above Gunicorn's timeout, the Gunicorn and `ExecStartPre` modules import, the cron line runs the executable `run_scrape.sh` with a lock and a timeout (and `run_scrape.sh` quotes that exact line and refuses to run as another user), `/api/` answers get exactly one `Cache-Control: no-store`, the `.prev` backups are denied, and no file has CR line endings. `backend/tests/test_env_example.py` checks that the two env templates and the variables the code reads match.

### 4.4 `backend/data/` and `backend/scraper/`

The served catalog (`courses.json`, `minors.json`) is in `frontend/data/`. The private data files are in `backend/data/`. The scripts and their `tests/` are in `backend/scraper/`; `pipeline_paths.py` there holds the default file locations, derived from the script folder, so the scripts work from any working directory, in a checkout and on the server. A student's course statuses (8.10) are in no data file: they stay in the browser (`localStorage['cf_course_status']`, 8.8) until the server stores them (21.4).

| File | Purpose |
|---|---|
| `frontend/data/courses.json` | **The catalog the app loads.** `{ "_meta": {...}, "courses": [ ... ] }`, 6,784 courses, about 30 MB (about 1.2 MB gzipped). Each course: `course_code`, `course_name`, `department`, `units`, `description`, `prerequisites`, `offered` (semester codes), `offered_qatar`, `offered_pitts`, `requirements` (`{CS: [...], IS: [...], BA: [...], BS: [...]}`, plus `AI: [...]` on courses that count for AI; each row `{requirement, type, major}`, plus `earlier` and `earlier_reason` on rows kept from an earlier requirement, 14.10), `soc_sections`, `offerings`. Set by the overlay step (14.5): `qatar_only`. Set by reconcile: `previous_course_name` when a number was reused for a different course. |
| `frontend/data/minors.json` | Minor requirements: the 15 minors that have an official file in `backend/data/minors/`, `product` (Product Management, which has no official file, built from its 2026-27 catalog page: its `source_file` is the archived page) and `self_defined` (no fixed requirements). Each minor has its blocked majors, unit total (none for `product`: the page states none), double counting limits (the audit file's, or the catalog page's for `product`), grade rules, notes and a tree of categories; each category has a rule and lists its courses by code (`courses`), matches them by number (`select`) or holds sub categories (`children`). One course fills one category. Built by hand from the official files, with old Psychology numbers shown as their current numbers; `backend/scraper/tests/test_minors_file.py` checks it against them, and `product` against its catalog page (category names, course lists and rules word for word, nothing the page does not state). It has no campus notes: as for the majors, whether a course runs at CMU-Q comes from the Schedule of Classes. The daily update does not touch it. The app loads it with `fetchMinors()` and builds each minor's tree against the catalog (8.10). |
| `backend/data/soc.json` | Raw SOC scrape output (`metadata.last_scrape`, `semesters`). About 31 MB. The admin Overview reads `last_scrape` from its first 4 KB. A cancelled section stays in a course's `sections` with `cancelled: true` but is left out of its `offerings` and `campus`; a section subtitle is in `section_title`; summer sections carry `session`. Data scraped before November 7, 2026 has none of these fields (see 21.2). |
| `backend/data/mapping_overlays.json` | The one place for Qatar information and other manual complements to the SOC scrape (14.5): `overlays` (additive mappings, 21 entries, including the H&SS Course Offerings sheet), `remove_mappings` (85-414, 85-426) and `qatar_visibility` (85-100). |
| `backend/data/faculty_directory.json` | 65 CMU-Q faculty scraped from the public People page. The directory seed in production (`SEED_USERS_PATH` in `deploy/countsfor.env.example`). |
| `backend/data/directory_admins.json` | Hand-kept admins layered over the faculty seed (7.1, 19.7). |
| `backend/data/requirement_path_renames.json` | Old to new requirement paths from the move to the 2026-27 catalog bucket names (14.10). Only needed to update admin course edits saved before that change (15.8 step 8). |
| `backend/data/minors/` | The official CMU-Q minor requirement files (15 `cmu_minor_*.json` audit exports, Markdown versions of two of them and the Scotty "Minors" general information page). The source of truth for minor requirements; `frontend/data/minors.json` is built from them. |
| `backend/data/sources/catalog-2026-27/minors/product-management-minor.html` | The Product Management minor page of the 2026-2027 CMU Undergraduate Catalog (`https://coursecatalog.web.cmu.edu/schools-colleges/tepper/minors/product-management-minor/`), saved unchanged on November 10, 2026. The source of the `product` minor, which has no official file. Frozen evidence: never edit it; `.gitattributes` keeps its bytes as served (no line ending conversion) and `test_minors_file.py` checks its sha256. |
| `backend/scraper/update_data.py` | **The daily update** run by cron (14.2): lock, parser tests, staged pipeline run, checks, publish in place with `.prev` copies and a `.gz`. |
| `backend/scraper/run_scrape.sh` | The cron entry point: refuses to run as anyone but the owner of `backend/data/` (`countsfor` on the server; a run as root would leave root-owned files that break every later run), sources `/etc/countsfor/scraper.env` if it exists, changes to the deploy root and runs `backend/.venv/bin/python backend/scraper/update_data.py` with its arguments. Executable, LF line endings. |
| `backend/scraper/scrape_soc.py` | Scraper. Splits each results table into rows on `</tr>` (only the first row of each course opens with `<tr>`), maps table cells by the `<th>` header (summer pages have an extra Session column), strips the "This Section Cancelled" note from titles and marks those sections cancelled. Keeps semesters that dropped off the SOC form by reading the file it overwrites. |
| `backend/scraper/soc_parse.py`, `soc_departments.py` | Shared parsing helpers. `soc_parse.clean_soc_title()` cleans titles already stored in `soc.json` (cancelled note, " : subtitle", trailing ": TBA") and returns `None` when nothing usable is left. |
| `backend/scraper/json_io.py`, `pipeline_paths.py` | Shared `load_json` and `save_json` helpers; default file locations. |
| `backend/scraper/reconcile_offerings.py` | Merges `soc.json` into `courses.json` (14.3 step 3). |
| `backend/scraper/apply_mapping_overlays.py` | Applies every section of `mapping_overlays.json` to `courses.json`, in a fixed order (14.5). |
| `backend/scraper/validate_soc_coverage.py` | Fails if a SOC course is missing from `courses.json`. Warns about same-title pairs that may be renumberings. |
| `backend/scraper/scrape_faculty_directory.py` | Builds `faculty_directory.json` or `backend/seed_users.json` from the CMU-Q People page (Algolia search). Run by hand (14.8). |
| `backend/scraper/tests/` | Pytest tests for the pipeline, the daily update, `scripts/dev_server.py`, `scripts/bump_cf_build.py` and `frontend/data/minors.json` (179 tests). `tests/fixtures/` holds real, untrimmed SOC result pages for Psychology (F26, S27, M26 Pittsburgh and S26 Qatar) and `soc_malformed_summer.json` (two malformed summer courses copied from `soc.json`). |

---

## 5. Local setup from a fresh Mac

These steps were run end to end in November 2026.

### 5.1 Install tools

```bash
# Xcode command line tools (git, make)
xcode-select --install

# Homebrew (skip if installed): see https://brew.sh
# Python 3.12, the version the server runs (Ubuntu 24.04).
brew install python@3.12 node gh
```

Python 3.11 and 3.13 also work for local development and tests; if you use one of them, change `python3.12` in 5.3 to match. Node is only needed to run the JS data tests from the command line. You do not need Apache, Gunicorn or PostgreSQL locally: `scripts/dev_server.py` stands in for Apache, the Flask dev server for Gunicorn and SQLite for PostgreSQL.

### 5.2 Clone

```bash
git clone https://github.com/Adicmu/Countsfor-Summer-26.git CountsFor
cd CountsFor
git remote add hind https://github.com/Hindjendara/Countsfor-Summer-26.git   # optional, partner fork
```

The repo history is large (about 145 MB packed) because the old daily scrape committed multi-megabyte data files and old screenshots remain in history. Until the cutover (15.15), the new layout described here is on the `cleanup` branch, not on `main`: `git checkout cleanup` if you have it.

### 5.3 Python environment

Always run backend commands **from the repo root**, never from inside `backend/`. The backend is a package with relative imports; `python app.py` inside `backend/` fails with "attempted relative import with no known parent package". The virtual environment lives at the repo root in `.venv/` (gitignored). On the server it is `backend/.venv/` instead (15.5); do not create one there locally.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

### 5.4 Configure `backend/.env`

```bash
cp backend/.env.example backend/.env
```

The file lists every variable the API reads, with a local value or a commented default, and the production value in a comment (section 6.1 has the table). The defaults work as they are:

- `FLASK_ENV=development`. `production` makes `config.py` refuse SQLite and a missing `SECRET_KEY`, and crash at import.
- `SECRET_KEY`: any long random string locally. Generate one: `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
- `DATABASE_URL=sqlite:///countsfor.db` (becomes `backend/instance/countsfor.db`).
- `EXPOSE_RESET_TOKEN=1` (lets you test password reset without email; ignored when `FLASK_ENV=production`).
- `GOOGLE_CLIENT_ID` is the public client ID from the HTML meta tag. Google sign-in works locally only if `http://localhost:8765` is an authorized JavaScript origin of that client.

`backend/tests/test_env_example.py` fails if a variable read in `backend/` is missing from `.env.example` (or the reverse), so add new variables there.

`config.py` loads `backend/.env` automatically (`python-dotenv`). Real environment variables win over `.env` values. When the real environment already has `FLASK_ENV=production` (systemd on the server), `backend/.env` is not read at all.

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
python scripts/dev_server.py
```

Open `http://localhost:8765/`. The script (standard library only) mirrors production: it serves `frontend/` and proxies `/api/*` and `/health` to `http://127.0.0.1:5050`, keeping the method, headers (including `Authorization` and cookies), body and status. The pages therefore call the API with relative paths on one origin, exactly as behind Apache, and no CORS is involved. If the API is not running, `/api` answers 502 and the landing page shows "Could not reach the server".

Options: `--port` (default 8765), `--backend` (default `http://127.0.0.1:5050`; change it if the API runs on another port), `--root` (default `frontend/`), `--bind` (default `localhost`, which listens on both `127.0.0.1` and `::1`: on some machines tools such as Node's `fetch` resolve `localhost` only to `::1`). Keep using `http://localhost:8765` in the browser: it is the origin Google sign-in and `FRONTEND_ORIGIN` allow. A chunked request body is decoded and forwarded with a `Content-Length`.

A plain `python -m http.server 8765 --directory frontend` still serves the pages (guest mode and `tests/test.html` work), but every `/api` call then returns 404, so nothing that needs the server works.

To point one browser at another backend without the proxy, set the override in the console (that backend's `FRONTEND_ORIGIN` must list `http://localhost:8765`):

```js
localStorage.setItem('cf_backend_override', 'http://localhost:5099');
location.reload();
// undo with: localStorage.removeItem('cf_backend_override')
```

### 5.7 First visit behaviour

1. `http://localhost:8765/` serves `index.html` (landing). `js/landing.js` renders the sign-in panel immediately, then probes `GET /api/me` in the background.
   - If you already have a valid session and have not typed anything, it redirects to `app.html`.
   - If the backend is unreachable, it shows a "Could not reach the server" banner with a guest link.
2. "Continue as guest" sets `sessionStorage['cf_guest'] = '1'` and opens `app.html`. The app boots in demo mode with a default profile (student, CS) and never calls `/api/me`.
3. Opening `app.html` directly without a session (or with the API unreachable) redirects back to `index.html`.
4. `app.html?token=...` or `?reset=...` redirects to `index.html` with the same parameter, which opens the reset password view.
5. `?share_plan=<token>` survives the login redirect via `sessionStorage['cf_pending_share_plan']` and is imported after sign-in.
6. A freshly bootstrapped database has no users. Use **Create account** first.

### 5.8 Run the tests

```bash
python -m pytest -q                # backend/tests and backend/scraper/tests (pytest.ini)
node scripts/run-data-tests.js     # frontend/tests
```

Section 16 has the details and the expected results, including the known failures.

---

## 6. Environment variables (complete table)

### 6.1 Backend (`backend/config.py`, `backend/app.py`, `backend/auth.py`)

Every variable is also listed, with local values and production values in comments, in `backend/.env.example`; the server template is `deploy/countsfor.env.example` (loaded by systemd from `/etc/countsfor/countsfor.env`). `backend/tests/test_env_example.py` keeps both in step with the code.

| Name | Required? | Default | Purpose |
|---|---|---|---|
| `FLASK_ENV` | Yes in production (`production`) | `development` | `production` refuses to start without `SECRET_KEY` and `DATABASE_URL` (no SQLite fallback) and makes the session cookie `Secure` by default. The only production switch: the old `RENDER` variable is no longer read. |
| `SECRET_KEY` | **Yes in production** | `dev-only-change-me` outside production | Signs the session cookie and the bearer `auth_token`. Changing it signs everyone out. |
| `DATABASE_URL` | **Yes in production** | none (local falls back to `sqlite:///backend/instance/countsfor.db`) | SQLAlchemy URL. `postgres://` is rewritten to `postgresql://`. Relative SQLite paths are anchored to `backend/instance/`. Server: `postgresql:///countsfor` (local PostgreSQL, peer auth). |
| `SKIP_DB_BOOTSTRAP` | No | unset | `1`, `true` or `yes` skips `create_all()` and migrations inside `create_app()`. The server sets it because systemd runs `python -m backend.bootstrap_db` once before Gunicorn starts (`ExecStartPre`). Read in `app.py`. |
| `SESSION_COOKIE_SECURE` | No | on in production, off otherwise | Session cookie sent over HTTPS only. `1`, `true`, `yes` or `on` turn it on; any other non-empty value turns it off. |
| `SESSION_COOKIE_SAMESITE` | No | `Lax` | `Lax`, `Strict` or `None` (`None` needs `Secure`); any other value stops the app at startup. The site and API share one origin, so `Lax` is right. It was `None` on Render for the github.io to onrender.com setup. |
| `TRUST_PROXY` | No | off | `1` wraps the app in werkzeug `ProxyFix(x_for=1, x_proto=1)`, so `request.remote_addr` and `request.scheme` come from the proxy's `X-Forwarded-*` headers. Set it only when the app is reachable through that one proxy (server: Apache in front, gunicorn on `127.0.0.1:8000`). |
| `GOOGLE_CLIENT_ID` | Yes for Google sign-in | empty | OAuth web client ID used to verify Google ID tokens. Not a secret. Must match the `cf-google-client-id` meta tag (15.14). |
| `ALLOWED_EMAIL_DOMAIN` | No | empty (any CMU domain) | If set (production uses `andrew.cmu.edu`), only that domain may sign in. Note that `normalize_cmu_email()` already rewrites `cmu.edu` and `qatar.cmu.edu` to `andrew.cmu.edu` and rejects all non-CMU addresses. |
| `SEED_USERS_PATH` | No | `backend/seed_users.json` | JSON directory seed. Production uses `backend/data/faculty_directory.json`. Relative paths are resolved against the current directory, `backend/`, then the repo root. |
| `ADMIN_SEED_PATH` | No | unset (`backend/data/directory_admins.json`) | Hand-kept admin list layered over the seed. An empty value disables it (tests do). |
| `SOC_JSON_PATH` | No | `backend/data/soc.json` | The private SOC scrape; the admin overview reads its `last_scrape`. The pipeline scripts read the same variable (6.2). |
| `RESET_TOKEN_MINUTES` | No | `30` | Password reset link lifetime. |
| `FRONTEND_RESET_BASE` | No | empty | The page reset emails link to; `?token=...` is appended. Server: `https://countsfor.qatar.cmu.edu/index.html`. If empty, the first `FRONTEND_ORIGIN` plus `/index.html`. |
| `RESEND_API_KEY` | One email provider needed for email resets | empty | Resend API key. Tried first. Secret. |
| `MAIL_FROM` | With Resend; with SMTP unless `SMTP_USER` is the sender | empty | From address. Quote it in env files when it has spaces or `< >`. |
| `SMTP_HOST` | For SMTP | empty | e.g. `smtp.gmail.com`. |
| `SMTP_PORT` | No | `587` | SMTP port. |
| `SMTP_USER` | No | empty | SMTP login, and the From address when `MAIL_FROM` is empty. Without it no login is attempted (an unauthenticated campus relay). |
| `SMTP_PASS` | With `SMTP_USER` | empty | SMTP password (for Gmail an app password). Secret. |
| `SMTP_USE_TLS` | No | `true` | STARTTLS on or off (`1`, `true`, `yes` or `on` mean on). A campus relay on port 25 usually needs `false`. |
| `FRONTEND_ORIGIN` | No | `http://localhost:8765` | Comma-separated CORS allow list for `/api/*`. Origins only, no paths, no trailing slash. Same-origin requests (through Apache, or `scripts/dev_server.py`) never need it; it matters only for a page on another origin (the `cf_backend_override` hook). Server: `https://countsfor.qatar.cmu.edu`. |
| `EXPOSE_RESET_TOKEN` | No (dev only) | unset | `1`, `true` or `yes` makes `/api/auth/forgot-password` return `reset_token` and `reset_url` in the response, and allows the flow even with no email provider. Ignored in production (`FLASK_ENV=production`): it would let anyone reset any account. Read directly from `os.environ` in `auth.py`. |
| `HOST` | No | `127.0.0.1` | Dev server bind address (`python -m backend.app` only). |
| `PORT` | No | `5050` | Dev server port (`python -m backend.app` only; gunicorn has its own `--bind`). |
| `FLASK_DEBUG` | No | `1` | Dev server debug mode. |

Email behaviour summary (`forgot_password()` plus `email_util.py`): if neither Resend (`RESEND_API_KEY` + `MAIL_FROM`) nor SMTP (`SMTP_HOST` plus a sender, `MAIL_FROM` or `SMTP_USER`; it logs in only when `SMTP_USER` is set, so an unauthenticated campus relay works) is configured and `EXPOSE_RESET_TOKEN` is off, the endpoint returns **503 `email_unavailable`** with `google_recovery: true` for every email, and the landing page steers the user to "Continue with Google", which then lets them set a password via `/api/auth/set-password`. As of November 2026 it is not known whether production has an email provider configured (on Render the values were set only in the dashboard).

### 6.2 Data pipeline scripts

| Name | Script | Default | Purpose |
|---|---|---|---|
| `SOC_BASE_URL` | `scrape_soc.py` | `https://enr-apps.as.cmu.edu/open/SOC/SOCServlet` | Override the SOC endpoint, for example to point at a local mock server. |
| `MIN_COURSES_FOR_VALID_SCRAPE` | same | `100` | Below this a semester scrape is treated as failed. |
| `MIN_COURSES_FOR_SUMMER_SCRAPE` | `scrape_soc.py` | `10` | Lower threshold for summer terms. |
| `SOC_OUTPUT_PATH` | `scrape_soc.py` | `backend/data/soc.json` (found from the script, not the working directory) | Output file. |
| `SEMESTERS_TO_TRY` | `soc_departments.py` | from the SOC form | Comma list override of semesters. |
| `SOC_JSON_PATH`, `COURSES_JSON_PATH` | reconcile and validate | `backend/data/soc.json`, `frontend/data/courses.json` | File locations. |
| `CATALOG_PATHS` | `apply_mapping_overlays.py` | `frontend/data/courses.json` | Semicolon list of catalogs to patch. |
| `MAPPING_OVERLAYS_PATH` | `apply_mapping_overlays.py`, `validate_soc_coverage.py` | `backend/data/mapping_overlays.json` | Overlay file location. `update_data.py` passes it on unchanged (default `<deploy root>/backend/data/mapping_overlays.json`). |
| `CF_DEPLOY_ROOT` | `update_data.py` (exported by `run_scrape.sh`) | the folder that holds `backend/` | Where the live files are: `<root>/backend/data/soc.json` and `<root>/frontend/data/courses.json`. `/var/www/html/countsfor` on the server, the repo root in a checkout. |
| `CF_STAGING_DIR` | `update_data.py` | `<root>/backend/var/staging` | Where the pipeline works on copies before they go live. Keep it on the same file system, outside the DocumentRoot. |
| `CF_MIN_SECTION_RATIO` | `update_data.py` | `0.98` | Refuse to publish if any campus of a semester falls below this fraction of its live section count. A number from 0 to 1. |
| `CF_MIN_CATALOG_RATIO` | `update_data.py` | `0.95` | Refuse to publish if the catalog falls below this fraction of its live row count (losing any course code always fails). |
| `https_proxy` | Python's `urllib` in `scrape_soc.py` | unset | Outbound proxy, only if the server has no direct internet. Not a CountsFor variable. |

On the server these go in `/etc/countsfor/scraper.env` (template `deploy/scraper.env.example`, all optional). `update_data.py` sets `SOC_OUTPUT_PATH`, `SOC_JSON_PATH`, `COURSES_JSON_PATH` and `CATALOG_PATHS` to its staged copies for every step, so those four only matter when you run a script by hand.

### 6.3 Frontend configuration (no env vars, all in HTML)

| Where | What |
|---|---|
| `<meta name="cf-google-client-id">` in both | Google OAuth client ID (public). |
| `<meta name="cf-build">` in `app.html` | Cache tag appended to `frontend/data/courses.json`. Bumped by `scripts/bump_cf_build.py`. |
| `?v=...` on script and CSS tags | Manual cache busting, in `app.html` and `index.html` (today `?v=deploy-2026-11-10`). `scripts/bump_cf_build.py` bumps both pages. On the server Apache sends these files with `no-cache`, so a bump is no longer needed for browsers to see a new version. |
| `localStorage['cf_backend_override']` | Per-browser backend URL override for debugging (3.3). There is no backend URL in the HTML: the API is on the page's own origin. |

---

## 7. Signing in locally and making yourself admin

### 7.1 How roles are decided (read this first)

On **every** sign-in (`register`, `login`, `google`), the backend calls `_sync_directory_profile(user, email)`:

1. Look up the email in the `directory_entries` table. If found, use that row.
2. Otherwise look in the JSON seed. `_load_json_directory()` tries, in order, `SEED_USERS_PATH`, `backend/seed_users.json`, `backend/faculty_seed.json`, `backend/data/faculty_directory.json`, and **uses the first file that exists and has rows** (files are not merged). Then `backend/data/directory_admins.json` (path set by `ADMIN_SEED_PATH`; empty string disables it) is layered on top, so the admins listed there win over the faculty seed. It is a separate file because `backend/scraper/scrape_faculty_directory.py` rewrites `faculty_directory.json` from scratch.
3. If a row is found: `role` comes from it (`admin` sets `is_admin`), and `name`, `primary_program`, `department`, `department_scope`, `picture_url` are copied when present. Minors are cleared.
4. If no row is found: the user becomes `student`, `is_admin = False`.

Consequences:

- **Changing someone's role on the Admin page Users tab (`PATCH /api/users/<id>`) does not stick.** It is overwritten at that person's next sign-in unless they also have a matching directory entry. This was verified locally (patched a student to professor, signed in again, back to student). To change a role permanently, change the directory (Admin page, "Faculty access" tab, or the Directory panel).
- There is no admin env var: the old `ADMIN_EMAILS` is no longer read at all.
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

Then sign out and sign in again (or create the account now). Because the first non-empty seed file wins, while `backend/seed_users.json` exists `backend/data/faculty_directory.json` is ignored locally.

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

`app.html` loads, in order: `js/utils.js`, `js/data.js`, `js/profile.js`, `js/api.js`, `js/app.js`. There are no modules; every top-level `function` and `const` is a global. Later files depend on earlier ones. `tests/test.html` loads `utils.js`, `data.js`, `profile.js` in the same order, then the profile, data, minors and utils tests.

`index.html` loads `js/utils.js`, `js/api.js` and `js/landing.js`, in that order. `landing.js` is wrapped in an IIFE and uses the globals from the other two: the backend URL, token storage, `apiFetch` and the auth calls from `api.js`; `esc`, `showToast` and the CMU email check from `utils.js`. Both pages therefore share one copy of each.

**Console tip:** `App` is declared with `const`, so it is not a property of `window`. In the browser console use `App` directly or check `typeof App`. `window.App` is `undefined`.

### 8.2 `js/utils.js` (about 145 lines)

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

### 8.3 `js/data.js` (about 1,760 lines): catalog logic, pure functions

| Lines (approx.) | Item | Purpose |
|---|---|---|
| 6 to 25 | `MAJOR_META`, `MAJOR_ORDER`, `MAJOR_BRAND` | Majors, their labels, degree names and colors. `MAJOR_ORDER = ['CS','IS','BA','BS','AI']` controls which programs get trees and columns. |
| 28 to 45 | `ACCENT_RULES`, `pickAccentColor()` | Accent color by requirement label. |
| 47 to 62 | `LABEL_OVERRIDES` | Display names for the few segments that should not show as stored: the degree roots ("CS Degree Requirements") and four Biological Sciences track comment rows. Every other bucket shows its 2026-27 catalog name. The stored path never changes. Show a segment with `requirementLeafLabel()` or `formatRequirementPath()`, never raw. |
| 64 to 290 | `FULFILLMENT_RULES`, `setRule()` | Rule chips ("Choose 1", "Take all", "At least 36 units") per major and bucket name, from the 2026-27 catalog, listed in catalog order. A rule's optional `note` shows as the chip's tooltip. |
| 292 to 303 | `courseOfferedInQatar()`, `isCourseHidden()` | A row is hidden everywhere (tree, search, typeahead, home lists, also counts for, double counters) when it has `qatar_only` without a running Qatar offering. |
| 305 to 428 | `buildRequirementTree()`, `normalizeTree()`, `ruleOrder()`, `countTreeCourses()`, `findRule()`, `splitTreeSections()` | Build each major's requirement tree from `course.requirements[major]` paths; sibling buckets follow the order of the major's rules (catalog order), and courses kept from an earlier requirement list after the current ones; split into degree and GenEd sections. |
| 431 | `normalizeCourseCode()` | Canonical `NN-NNN`. |
| 440 to 522 | `COURSE_EDIT_FIELDS`, `applyCourseOverrides(courses, overrides)` | Apply admin edits. Returns `{ courses, archived }`. Edited courses get `_edit` (the override) and `_catalog` (the scraped values replaced). Added courses get `_added`. Archived courses are removed from `courses` and returned in `archived`. Copies objects so a reload starts from scraped data. |
| 525 | `knownRequirementPaths()` | All requirement paths per program, used by the course editor's autocomplete. |
| 539 to 598 | `buildCourseIndex()`, `lookupCourse()`, `findTreeNode()`, `collectCoursesForRequirement()`, `formatRequirementPath()`, `requirementLeafLabel()` | Index by `15-122` and `15122`. Tree lookups. |
| 600 to 666 | `getCourseMappings()`, `orderCfColumns()`, `summarizeFlagsByStatus()`, `getAlsoCountsFor()` | Display data for the course card. |
| 668 to 721 | `predictOffering()`, `sortSemesters()` | Rule-based "likely offered next term" hint (no ML). |
| 723 to 743 | `DEPT_NAMES`, `getDeptName()` | Department number to name. |
| 745 to 880 | `SEMESTER_OPTIONS`, `MODALITY_OPTIONS`, `availableSemesterOptions()`, `semesterLabel()`, `getCourseOfferings()`, `filterOfferings()`, `courseHasMatchingOffering()` | Semester, campus and modality filters over SOC offerings. |
| 882 to 1116 | `PLAN_DAY_COLUMNS`, `parseDaysTimes()`, `formatDaysTimesForDisplay()`, `planOfferingKey()`, `groupOfferingsBySection()`, `findPlanConflicts()`, `layoutPlanDayBlocks()` and friends | Schedule planner math: parsing times, conflicts, calendar layout (7:00 to 22:00). Stored `days_times` keep the SOC form `MW 03:30PM-04:50PM` (plan keys and `parseDaysTimes` read it); `formatDaysTimesForDisplay()` shows it as `MW 3:30 PM to 4:50 PM` on course cards and the plan list, and returns any other string unchanged. |
| 1118 to 1740 | `COURSE_STATUSES`, `COURSE_STATUS_KEY`, `normalizeCourseStatuses()`, `nextCourseStatus()`, `courseMatchesSelect()`, `expandMinorCategory()`, `minorRuleLabel()` (chips worded like the major chips), `buildMinorTree()`, `buildMinorIndex()`, `courseCountsForMinor()`, `majorCountKind()`, `computeMinorProgress()`, `minorStatusText()`, `minorSummaryText()`, `countMarkedCourses()`, `minorDoubleCountRules()`, `minorDoubleCountLimitText()`, `checkMinorDoubleCounting()`, `minorDoubleCountWarnings()`, `minorSourceKind()`, `plainDataText()` | Minors: each minor of `data/minors.json` as a tree against the catalog, a student's progress from their course statuses, and double counting (8.10). |
| 1742 to end | `annotateDoubleCounters()`, `annotateMultiProgram()` | Profile-aware flags on courses: for a student `_majorKind` (`degree`, `gened` or none for their major), `_minorMatches` (their minors the course can count for) and `_doubleCounter` (both); `_programCount`. |

### 8.4 `js/profile.js` (about 380 lines): roles and programs

| Item | Purpose |
|---|---|
| `PROGRAM_GROUPS` | Programs with labels and `dataPending` (GS is pending). Derived: `VALID_PROGRAMS`, `MAJOR_LIST`, `STUDENT_PROGRAMS`, `PROGRAM_FULL_NAME`. |
| `DEPARTMENT_LIST` | Must match `VALID_DEPARTMENTS` in `backend/models.py`. |
| `getRoleGroup()`, `isFaculty()`, `isStudent()` | Role group helpers (mirror of backend). |
| `canManageDirectory()`, `canFlagCourses()`, `canManageUsers()`, `canUseSchedulePlan()` | UI gates only. The backend enforces the real rules. |
| `MINOR_LIST`, `MINOR_BLOCKED_MAJORS`, `minorListFromData()`, `applyMinorsCatalog()`, `isKnownMinor()`, `isMinorBlockedForMajor()`, `cleanProfileMinors()`, `getMinorLabel()`, `getProfileMinors()` | Minors. The two constants are the fallback used before `data/minors.json` loads (onboarding); `applyMinorsCatalog()` rebuilds them from the file, and `tests/minors-file.test.js` checks that the fallback matches it. `cleanProfileMinors()` drops unknown codes and minors the major may not take. |
| `VALID_ROLES`, `ROLE_META` | Role labels and per-role flags. |
| `ADVISOR_SCOPES`, `getAdvisorScopeLabel()` | Advisor scope labels. |
| `computeViewMode()`, `validateProfile()` | Which programs to show for a profile. Students always get `focused-single` (their own major; their minors are sections of that tree). The old `focused-dual` mode, where a minor borrowed another major's tree, is gone. |
| `saveProfile()`, `loadProfile()`, `clearProfile()` | Persist the local profile in localStorage keys `cf_role`, `cf_primary`, `cf_secondary`, `cf_minors`, `cf_scope`. `loadProfile()` drops minors the app does not offer or the major may not take, and saves the cleaned list. |

### 8.5 `js/api.js` (about 360 lines): all network calls

`apiFetch(path, opts)` is the single wrapper. It requests `CF_BACKEND_URL + path` (normally just the relative path), always sends `credentials: 'include'` and the bearer token, times out after 20 s by default (`opts.timeoutMs`), never throws on HTTP errors, saves any `auth_token` it sees in a response, and returns `{ ok, status, data, error, message }`. `status: 0` means the API could not be reached: network failure, timeout, or a 502/503/504 without a JSON body (the proxy, Apache or `scripts/dev_server.py`, reporting the API down). Flask's own JSON error responses pass through unchanged.

| Group | Functions | Endpoint |
|---|---|---|
| Course data | `fetchAllCourses()`, `fetchMinors()` | static files (see 3.3) |
| Backend URL and token | `getBackendUrl()`, `getAuthToken()`, `saveAuthToken(token, persist)`, `clearAuthToken()`, `getGoogleClientId()` | none |
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

### 8.6 `js/landing.js` (about 930 lines)

One IIFE. Main parts: `reach()` (wraps every `api.js` call and clears a stale "Could not reach the server" banner as soon as the server answers), validation helpers (`validateAndrewField`, `validatePasswordMatch`), `renderPanel()` (about line 608, renders sign in, register, forgot, reset views), `goToApp()` (preserves `share_plan`), `onLogin`, `onRegister`, `mountGoogleRecover` and `onGoogleRecover` (Google button used for password recovery: sign in with Google, then set a password), `onForgotPassword`, `onResetPassword`, `probeSession()`, `enterGuestMode()`, `init()`.

`probeSession()` sends a visitor with a valid session straight to `app.html`. Only when they have already typed into the form (`userIsEngaged()`, which uses `hasTypedText()` from `utils.js`) does it stay and show "You're already signed in." with a Continue link, so typed text is never thrown away. The "Keep me signed in" checkbox does not count: its value is always "on".

`js/app.js` has no sign-in screens of its own (the old in-app copy was removed in November 2026). It redirects to `index.html` whenever a sign-in is needed.

### 8.7 `js/app.js` (about 6,500 lines): the `App` object

Everything lives on one object literal `const App = { ... }`, started by `App.init()` on `DOMContentLoaded` (last lines of the file). Line numbers below are for the `cleanup` branch after the catalog and minors merges (November 10, 2026); they will drift as the file is edited. Search for the function name.

| Lines (approx.) | Section | Key functions |
|---|---|---|
| 5 to 14 | Home constants | `HOME_POPULAR_COURSES`, `HOME_SEARCH_CHIPS`, `HOME_RECENT_MAPPINGS`, `MINORS_TAB` (id of the Minors tab) |
| 15 to 39 | State | `courses`, `courseIndex`, `trees` (the majors and `minor:<code>`), `treeSections`, `minorsData`, `minorIndex`, `browseMinorCode`, `layoutMode`, `activeMajor` (a major code or `MINORS_TAB`), `selectedCourse`, filters (`locationFilter`, `activeSemester` default `F26`, `modalityFilter`), `profile`, `authedUser`, `authMode` (`authed`, `demo`, `login`), `isGuest`, `serverFlags` |
| 40 to 224 | Boot and auth state | `init()`, `_redirectToLogin()`, `_restorePendingSharePlan()`, `_afterAuthed()`, `_syncLocalToServer()` (one-time upload of local flags and wishlist), `_loadServerFlags()`, `_needsOnboarding()`, `_hydrateProfileFromServer()` (drops minors the app no longer offers) |
| 225 to 236 | Theme | `applyTheme()`, `toggleTheme()` |
| 237 to 345 | Data loading | `_prepareCatalog()` (fetch the catalog, `minors.json` and the overrides), `_buildCatalog()` (apply edits, index, annotate, build the major and minor trees), `loadData()`, `autoExpandFirstLevel()` |
| 346 to 595 | Onboarding (students only) | `renderOnboarding()`, `_renderOnboardingScreen()`, `_obPickMajor()`, `_obPickMinor()`, `_obAddMinor()`, `_obRemoveMinor()`, `_finishOnboarding()` (PATCHes `/api/me`) |
| 596 to 851 | Sign-in result, guest, sign-out, role badge | `_afterSignIn()`, `_readGuestFlag()`, `exitGuest()`, `setGuestRole()` (keeps the guest student's major and minors in `cf_guest_student` while the Faculty view is on), `signOut()`, `_roleBadgeHtml()`, `editRole()`, `_visibleMajors()`, `_guestBannerHtml()` |
| 852 to 1067 | Shell rendering | `renderShell()` (navbar with Saved, Plans, Admin or Flag review buttons, directory button; redraws the requirement map in split view), `_syncDirectoryFabLayout()`, `_initPanelResizer()` (split view drag handle) |
| 1068 to 1351 | Events and filters | `bindGlobalEvents()`, `_filterParams()`, `_refreshSemesterOptions()`, `setSemester()`, `setModalityFilter()`, `setLocation()`, `setMobileLens()`, `reset()` |
| 1352 to 1571 | Explorer mode and course search | `enterExplorer()`, `exitExplorer()`, `handleSearchKeydown()`, `_selectCourse()`, `selectSearchResult()` |
| 1572 to 1808 | Category index and unified home search | `_buildCategoryIndex()` (requirement categories and one entry per minor), `selectCategoryResult()`, `handleUnifiedSearchKeydown()`, `selectUnifiedResult()`, `runHomeSearchChip()` |
| 1809 to 2201 | Home screen | `renderLeftEmpty()`, `_renderHome()`, `_renderHomeDock()`, popular courses (`_recordCourseSearch()`, `_loadPopularCourses()`, local fallback counts), `_renderQuickStart()`, navbar counters |
| 2202 to 2231 | Flag counts for the home screen | `_loadStudentFlagsSummary()`, `_loadMyFlagsSummary()` |
| 2232 to 2432 | Course card | `renderCourseCard()` (for a student also their status for the course; the minors the course counts for), `_renderSchedRowGroup()` |
| 2433 to 2923 | Requirement tree | `_renderMajorTabs()` (the majors and the Minors tab), `switchMajor()`, `toggleNode()`, `renderTree()`, `renderTreeNode()`, `downloadRequirementExcel()` (CSV), `_renderLeafCourse()`, `_earlierTagHtml()` (the "Earlier requirement" tag), `_renderRowActions()`, `_renderCardActions()`, `_leafPassesTreeFilter()` |
| 2924 to 2940 | Cross-linking | `selectCourseFromTree()` |
| 2941 to 3101 | Wishlist (Saved) | `_getWishlistItems()`, `toggleWishlist()`, `showWishlistView()`, `_saveWishlistNote()` |
| 3102 to 3885 | Schedule plans | `_loadPlansStore()` (localStorage `cf_plans_v2`, migrates legacy `cf_plan`), `createNewPlan()`, `deletePlan()`, `renamePlan()`, `_loadServerPlans()`, `_mergeServerPlan()`, `_handlePendingSharePlanLink()`, `openSharePlanModal()`, `submitSharePlanEmail()`, `copySharePlanLink()`, `togglePlanSection()`, `_renderPlanCalendar()`, `showPlanView()`, `openPlanDetail()` |
| 3886 to 3946 | Student flag view and favourites | `showStudentFlagsView()`, `showStudentFavorites()` |
| 3947 to 4120 | Flags | `FLAG_REASONS` (must match `VALID_REASON_CODES` in `backend/flags.py`), `_getFlags()` (local `cf_flags`), `openFlagModal()`, `submitFlag()` |
| 4121 to 4354 | Directory panel | `toggleDirectoryPanel()`, `_loadDirectoryPanel()`, `_renderDirectoryPanel()`, `_editDirectoryRow()`, `_revokeDirectoryRow()`, `_submitDirectoryForm()` |
| 4355 to 4484 | Admin console shell | `_adminConsole` state, `ADMIN_TABS`, `showAdminConsole()`, `_setAdminTab()`, `_loadAdminTab()` (dispatch), helpers `_admEl()`, `_admError()`, `_admWhen()`, `_admStat()` |
| 4485 to 5057 | Admin: Courses tab (course editor) | `_courseAdmin` state, `_renderAdminCourses()`, `_renderCourseResults()`, `_openCourseEditor()`, `_openCourseAdd()`, `_renderCourseEditor()`, `_addCourseReq()`, `_courseReqRow()` (keeps a row's earlier flag), `_saveCourse()`, `_archiveCourse()`, `_restoreCourse()`, `_revertCourse()`, `_reloadCatalog()` |
| 5058 to 5391 | Admin: Overview tab and sign-in activity | `_loadAdminOverview()`, `_openIncompleteUsers()`, `_openSignIns()`, `_renderSignIns()`, `_exportSignInsCsv()` |
| 5392 to 5431 | Admin: Faculty access tab | `_loadAdminAccess()`, `_openDirectoryFromAdmin()` |
| 5432 to 5527 | Admin: Insights tab | `_loadAdminInsights()` |
| 5528 to 5607 | Admin: Activity log tab | `_loadAdminActivity()`, `_renderAdminActivity()`, `_describeAdminEvent()` (human text per audit action) |
| 5608 to 5818 | Admin: Users tab | `_loadUserAdmin()`, `_exportUsersCsv()`, `_renderUserAdmin()`, `_renderUserAdminRow()`, `_saveUserAdmin()` (opened with `showAdminConsole('users')`) |
| 5819 to 5948 | Admin and faculty: Flags review | `showFlagReview()`, `_loadFlagReview()`, `_renderFlagReview()`, `_setFlagStatus()`, `_promptFlagNote()` |
| 5949 to 6479 | Minors (8.10) | course statuses (`setCourseStatus()`, `cycleCourseStatus()`, `_courseStatusButtonHtml()`, `_courseCardStatusHtml()`), `_courseCardMinorsHtml()`, `_nodeStatusHtml()`, `_minorNodeInfoHtml()`, `_studentProgramsBarHtml()`, `setStudentMajor()`, `addStudentMinor()`, `removeStudentMinor()`, `_applyStudentPrograms()`, `_saveStudentProgramsToAccount()` (one `PATCH /api/me` at a time), `browseMinor()`, `openMinorRequirements()`, `_navigateToMinorNode()`, `_renderMinorsBrowse()`, `_renderMinorSection()`, `_minorProgressHtml()` |
| 6480 to 6523 | Deep links into the tree | `navigateToReqNode()` (a `minor:<code>` target goes to `_navigateToMinorNode()`) |
| 6524 to 6530 | Bootstrap | `DOMContentLoaded` handler, picks dark theme from OS if no saved theme, calls `App.init()` |

Admin tabs, in order (`ADMIN_TABS`): `courses` (Courses), `overview` (Overview), `users` (Users), `access` (Faculty access), `flags` (Flags), `insights` (Insights), `activity` (Activity log). The Admin button appears only when `canManageUsers(this.authedUser)`.

### 8.8 State model and browser storage

All UI state is fields on `App`; it is re-rendered by writing `innerHTML` strings. There is no virtual DOM and no reactive store. After changing state you call the relevant render function (`renderTree()`, `renderShell()`, `renderLeftEmpty()` and so on). `renderShell()` replaces all of `#app`, so look up `#leftBody` (or any other element inside it) after calling it, never before: an element captured earlier is detached, and writing into it leaves the panel blank.

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
| `cf_course_status` | local | `app.js` | A student's course statuses, `{ "15-122": "completed", "85-110": "in_progress" }` (not taken is no entry). Guests and signed-in students alike, this browser only; kept at sign-out, like plans. |
| `cf_guest_student` | local | `app.js` | The guest Student view's major and minors, kept while the guest looks at the Faculty view |
| `cf_plan` | local | legacy | Old single plan, migrated into `cf_plans_v2` on load |
| `cf_split_left_px` | local | `app.js` | Split view panel width |
| `cf_search_counts_<PROGRAM>_<SEMESTER>` | local | `app.js` | Local fallback for "popular courses" |

Note: course statuses live only in the browser too; saving them on the account comes with the server (21.4). Schedule plans live only in the browser. The server stores a plan only when someone shares it (`/api/plans/share`, `/api/plans/accept-share`), and `GET /api/plans` returns those copies. There is no endpoint that saves a user's own plans.

### 8.9 CSS

`css/styles.css` starts with light theme custom properties in `:root` (line 9, including `--major-cs`, `--major-is` and friends, and `--minor-accent` and the `--status-*` colors of the minors UI), then `[data-theme="dark"]` overrides, then sections for layout (focused and split mode), search, course card, tree (with the minors and course status styles right after it, `.mn-*`, `.cs-btn`, `.tr-dc-tag`, `.cc-status`, `.cc-mn-*`), onboarding, navbar, plans, directory panel, and the Admin page and course editor. The theme is switched by setting `data-theme` on `<html>`.

### 8.10 Minors in the requirement map

**Data.** `frontend/data/minors.json` (4.4) lists each minor as a tree of categories. `fetchMinors()` loads it with the catalog; `applyMinorsCatalog()` rebuilds `MINOR_LIST` and `MINOR_BLOCKED_MAJORS` from it, and `buildMinorIndex()` builds every minor's tree against the loaded catalog (`App.minorIndex`, and `App.trees['minor:<code>']`). A category's courses are its listed codes that have a catalog row plus every course its `select` rule matches (prefix, number range, excluded codes and ranges, unit floor), sorted by code; listed codes with no catalog row are named under the category ("Also listed, but not in the course catalog"). There are no campus notes: as for the majors, whether a course runs at CMU-Q comes from the Schedule of Classes. Minor trees have the same node shape as the major trees, so the same cards, rows, rule chips and course rows render them; their paths are category ids joined by `---`. Their rule chips are worded like the 2026-27 catalog chips of the majors (`minorRuleLabel()`: "Take all", "Choose 2", "Choose 1 (at least 9 units)", "At least 27 units", "Up to 9 units").

**Student view.** On their own major tab, a student (guest or signed in) sees a programs bar (major picker, minor chips, "Add a minor"), the major's cards, then one section per chosen minor: "Psychology minor" with the title, unit total, the official version, a progress bar, the double counting limit in plain English with the rule's own words ("Audit rule", or "Catalog rule" for Product Management, whose source is its catalog page), warnings, and "About this minor" (notes, grade rules, double counting notes). Changes are saved locally (`saveProfile()`) and, when signed in, on the account (`PATCH /api/me`, one request at a time). The role badge's Edit (onboarding) still works too.

**Course statuses.** Every course row in a student's tree starts with a round control: one click for in progress, two for completed, three back to not taken; the course card has the same three states as buttons. Statuses are saved in `localStorage['cf_course_status']` only (guests and signed-in students alike; server sync comes with the server, 21.4). A marked course always shows in the tree, even when the semester, campus or modality filter would hide it.

**Progress** (`computeMinorProgress()`). One course fills one category. Each marked course is assigned to at most one bottom-level category: the categories with the fewest matching marked courses are filled first (then the narrower lists, then file order), each with completed courses before in progress ones and only until its rule is met; then a group that counts courses or units across its parts (Sociology Electives, Writing's Core Writing) takes more courses into its parts, never past a `max_units` cap. A category is Done when its completed courses meet its rule (`take_all`, `required`, `pick` n with an optional unit floor, `min_units`, parts for groups), In progress when completed plus in progress courses meet it, and otherwise shows what is left ("1 course left", "9 units left", "1 part left"). A row says where a marked course is counted ("Counted in Survey Courses") or that it is not needed. The header sums up the top-level requirements ("2 of 5 requirements done, 1 in progress, 2 left"). In the major tree, a category shows how many of its courses are marked.

**Double counting.** A course in a minor's tree that also counts for the student's major is tagged "Also counts for CS" (a major requirement) or "Also counts for CS Gen Ed"; in the major tree a course a chosen minor can use is tagged "Also counts for Psychology minor". The header states the limit (`minorDoubleCountLimitText()`): "At most 2 courses may also count toward your major or another minor", "No course may ..." with the categories that are free, "... without a limit" with the categories that may never be shared, or "Confirm double counting with your advisor" when the file states no rule (Biological Sciences, Student-defined). `checkMinorDoubleCounting()` takes the marked courses used for the minor that also count for a major requirement of the student's major (General Education overlap is free) or are used by another of their minors; courses in a `no_limit` category are free, courses in a `no_sharing` category are flagged, and the rest count toward the one shared limit (`max_with_major`, which equals `max_with_other_minors` in every file). Over the limit, the header warns and names the courses. A course counts for the major through any of its rows for that major, including a row kept as an earlier requirement (14.10), so a warning can name a course that only an earlier version of the major lists; the student confirms it with their advisor. The app offers every minor to every major, AI included, except to the majors a minor's `blocked_majors` names.

**Browse view.** Every role has a Minors tab after the major tabs. It lists all 17 minors; choosing one shows its full tree. Students also see their progress there and an "Add to my minors" button (or "Not open to BA majors"); an advisor with minor scope starts on their minor. Course cards list the minors a course counts for ("Psychology: Survey Courses or Psychology Elective", the student's own first), and the home search offers each minor ("Minor · Neuroscience minor").

Tests: `tests/minors.test.js` (selection rules, trees, progress, double counting), `tests/minors-file.test.js` (the real file through `fetchMinors()`, the fallback list, every category's rule) and the minors part of `tests/app-views.test.js` (the student tree, statuses, a warning, the Minors tab, guest changes, the save queue, a missing file).

---

## 9. Backend walkthrough

### 9.1 App factory (`backend/app.py`)

`create_app(config_class=Config, *, bootstrap_db=None)`:

1. Loads config.
2. If `TRUST_PROXY` is on, wraps the WSGI app in `ProxyFix(x_for=1, x_proto=1)`; then `db.init_app(app)`.
3. Unless `SKIP_DB_BOOTSTRAP` is truthy, runs `init_database(app)`: imports models, `db.create_all()`, then `run_migrations()`.
4. Enables CORS for `/api/*` only, for `FRONTEND_ORIGINS`, with credentials and the `Content-Type` and `Authorization` headers.
5. Registers blueprints: `auth`, `flags`, `wishlist`, `users`, `directory`, `search_analytics`, `plans`, `admin`, `course_overrides`.
6. Adds `GET /health` (no `/api` prefix, so no CORS). For SQLite it always returns ok. For Postgres it runs `SELECT 1` and checks `REQUIRED_TABLES`; returns 503 if tables are missing or the DB errors.
7. JSON 404 handler: `{"error":"not_found","message":"Route not found."}`.

On the server systemd runs `gunicorn --workers 3 --bind 127.0.0.1:8000 --timeout 120 --forwarded-allow-ips 127.0.0.1 ... 'backend.app:create_app()'` from `/var/www/html/countsfor`, with `SKIP_DB_BOOTSTRAP=1` and `TRUST_PROXY=1` from `/etc/countsfor/countsfor.env` (15.9).

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
- `PATCH /api/me`: allowed fields `name`, `role`, `primary_program`, `minor_code`, `minor_codes`, `advisor_scope`, `department_scope`, `department`. Validates the whole resulting profile with `_validate_consistent_profile()`: students need a major in `CS IS BA BS AI GS`, no department, no advisor scope, and minors from `VALID_MINORS_FOR_PATCH` that their major may take (`MAJOR_MINOR_COLLISION`); faculty and admin need a valid department and program, no minors, no advisor scope. `minor_codes` replaces the student's minors in the order given (`_sync_user_minors()` deletes the old rows before inserting the new ones; before November 10, 2026 keeping a minor while adding another failed with a 500). A non-admin can only set their own role to `student`; an admin cannot change their own role.

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
- `GET /api/admin/overview`: user counts by role and group, new users in 7 and 30 days, active in 7 days (by `last_login`), incomplete profiles, flag counts by status, wishlist totals, plan count, total course lookups, directory row count, `course_data.last_scrape` (read from the top of the server's `soc.json`: `SOC_JSON_PATH`, default `backend/data/soc.json`), six most recent signups.
- `GET /api/admin/insights?semester=F26`: top lookups, top lookups per program, most saved, most flagged, students per program, signups per week for 12 weeks, list of semesters with data.
- `GET /api/admin/sign-ins?days=7|30|90`: sign-in activity (active people, sign-ins, app opens, daily series, breakdowns, per-person table). See section 13.
- `GET /api/admin/activity?action=course.&page=1&limit=50`: paginated audit log; `action` is a prefix match (a trailing `*` is ignored).

### 9.11 Email (`backend/email_util.py`)

`send_password_reset_email(to, url)` tries Resend (HTTPS API), then SMTP (STARTTLS by default), and returns False if neither is configured or both fail. Never raises.

---

## 10. API reference (every route)

All `/api/*` routes return JSON. "Login" means any signed-in user. Files are under `backend/`.

| Method | Path | Who | File | Purpose |
|---|---|---|---|---|
| GET | `/health` | public | `app.py` | Health and DB check |
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

1. On the server, systemd runs `python -m backend.bootstrap_db` before every start of the API (`ExecStartPre` in `deploy/countsfor-api.service`), so the `systemctl restart countsfor-api` of a deploy applies schema changes (15.16). On Render it was the pre-deploy command. It calls `create_app(bootstrap_db=False)`, then `init_database()`:
   - `db.create_all()`: **creates tables that do not exist yet. It never alters an existing table. It will not add a new column, change a type, add an index to an existing table, or drop anything.**
   - `run_migrations()` in `backend/migrate.py`: a list of idempotent steps (`_add_column_if_missing`, `_ensure_..._table`) for changes to tables that already existed in production.
   - `verify_bootstrap()`: fails (exit 1, so the API does not start) if any table in `REQUIRED_TABLES` is missing.
2. Gunicorn starts with `SKIP_DB_BOOTSTRAP=1`, so workers do not repeat this.
3. Locally, `python -m backend.app` does steps 1a and 1b on every start.

So:

- **New table:** add the model; `create_all()` creates it. Also add the name to `REQUIRED_TABLES` if the app cannot work without it.
- **New column on an existing table:** you **must** also add a `_add_column_if_missing("table", "column", "<sqlite ddl>", "<postgres ddl>")` call at the end of `run_migrations()`. Without it production will crash with "column does not exist" while tests still pass (tests create fresh tables).
- **Renames, type changes, drops:** not supported by the helpers. Write a careful one-off step in `migrate.py`, guarded so it is idempotent, and test it against a copy of the production database first. There is no Alembic.
- New columns added to an existing table should be nullable or have a default, otherwise the `ALTER TABLE` fails on existing rows.
- Booleans: the existing migrations use `DEFAULT 0` for SQLite and `DEFAULT FALSE` for Postgres. Follow that pattern.

Since November 3, 2026 production `/health` on Render reports `"tables": 14` (the admin page and sign-in analytics are deployed). The deploy created `admin_audit_events`, `course_overrides`, `sign_in_events` and `user_activity_days` through `create_all()` and backfilled sign-in history once (section 13.2).

---

## 12. Course overrides (admin catalog edits)

### 12.1 Why they exist

`frontend/data/courses.json` is rebuilt from the SOC every day by the daily update on the server (14.2), and on every deploy (15.16). Any manual edit to that file would be overwritten. So admin edits are stored in the `course_overrides` table and applied by the browser after it loads the file.

### 12.2 Data model

One row per course code:

- Scraped course edited: `is_new = false`, `course_code` = the catalog code (even if the admin renumbers it; the new number is stored inside `fields.course_code`), `fields` = only the changed fields (`course_name`, `department`, `units`, `description`, `prerequisites`, `offered_qatar`, `offered_pitts`, `offered`, optionally `course_code`), `requirements` = the complete "counts for" map when edited (`{"CS": [{"requirement": "A---B", "type": false, "major": "CS"}], ...}`; a row kept from an earlier requirement also has `"earlier": true` and `earlier_reason`, which the editor keeps), else null.
- Course added by an admin: `is_new = true`, keyed by its own code; renumbering moves the key.
- `archived = true` hides the course from everyone; nothing is deleted.
- If an edit leaves a scraped course identical to the scrape (no fields, no requirements, not archived) the row is deleted.

### 12.3 Validation rules (`course_overrides.py`)

Code must match `NN-NNN`. Name 1 to 200 chars, description up to 5000, prerequisites up to 1000. Department is the numeric department code (for example `15`). Units 0 to 48. Offered semesters must match `^[FSMN]\d{2}$`. Requirement programs must be in `CS IS BA BS AI GS`; each path up to 400 chars; duplicates are dropped; `earlier_reason` up to 200 chars, stored only on a row with `earlier` true.

### 12.4 How the browser applies them

`App._prepareCatalog()` calls `fetchAllCourses()`, then `apiGetCourseOverrides()` (10 s timeout; on failure it logs a warning and shows the plain scrape), then `applyCourseOverrides()`, then rebuilds the index and trees. Overrides match exact codes. After every save the course editor calls `_reloadCatalog()` to rebuild from scratch.

### 12.5 Using the course editor

Admin page, **Courses** tab: search by number or title, filter (all, edited, added, archived), open a course, edit fields and the "counts for" list per program (with autocomplete from existing requirement paths), then Save. A category typed into a "Pick or type" box is saved even if you never pressed its Add button. A successful Add course or Save changes opens a confirmation screen (`_renderCourseSaved` in `js/app.js`, state `_courseAdmin.view === 'saved'`) listing what changed; validation errors appear in the `#ce-notice` box next to the buttons, not as toasts. Buttons: Archive, Restore, Revert (drops all edits for a scraped course). Saving under a number another row or an archived row already has is refused. "Add course" creates a new course. Every action is in the Activity log.

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

Both are SQLAlchemy models in `backend/models.py`. They are new tables, so `db.create_all()` creates them on deploy (`python -m backend.bootstrap_db`, run before the API starts, calls `init_database`). Both are in `REQUIRED_TABLES` in `backend/db_schema.py`, so `/health` on Postgres reports `degraded` if either is missing. Rows are deleted with the user (`ON DELETE CASCADE`).

**One-time backfill.** Tracking started after people were already using the site. `_backfill_sign_in_history()` in `backend/migrate.py` runs inside `run_migrations()`: if `sign_in_events` is empty, it copies each user's `users.last_login` into one `before_tracking` event plus one activity-day row. Once any event exists it never runs again. The page footer shows when real tracking began (earliest non-backfill event).

### 13.3 Code path

| Step | Where |
|---|---|
| Record a sign-in | `mark_signed_in(user, method)` in `backend/activity.py`. Called from `_finalize_user` (password login, `register`) and `_upsert_user_from_login` (Google) in `backend/auth.py` (`email_link` events exist only from the removed passwordless route). It sets `users.last_login`, adds an event and bumps the day row. The caller commits. |
| Record an app load | `record_visit(user)` in `backend/activity.py`, called by `GET /api/me`. It commits on its own and swallows database errors so `/api/me` can never fail because of analytics. |
| API | `GET /api/admin/sign-ins?days=7\|30\|90` in `backend/admin.py` (admin role group only; any other value falls back to 7). The Overview's `active_7d` uses the same activity rows (plus `last_login` as a fallback). |
| Frontend | `apiAdminSignIns` in `js/api.js`; `_openSignIns`, `_loadSignIns`, `_renderSignIns`, `_renderSignInTable`, `_exportSignInsCsv` in `js/app.js`; styles under "Admin page: sign-in activity" at the end of `css/styles.css`. Charts are plain HTML/CSS bars, no chart library. |
| Tests | Five tests at the end of `backend/tests/test_admin.py` (permissions, tracking through the real register route, overview consistency, window fallback, backfill runs once). |

### 13.4 Privacy rules for this feature

Store counts, not behaviour: no IP addresses, user agents, locations or per-person page/search logs. Course lookups (`course_search_counts`) stay aggregated per program and semester, never per person. Keep the endpoint admin-only on the server. Any Phase 2 feature tracking should follow the same rule (daily counts per role group and program, not per person); see the plan PDF.

### 13.5 Recipes

- **See it locally with data:** create a few test accounts through **Create account** (or `POST /api/auth/register`) and reload `app.html` a few times; each reload is an app open.
- **Add a new sign-in method:** call `mark_signed_in(user, "<method>")` in the new route before its commit, and add a label to `SIGN_IN_METHOD_LABELS` in `js/app.js`.
- **Add a window (for example 365 days):** add it to `SIGN_IN_WINDOWS` in `backend/admin.py`; the switch buttons come from the API's `windows` list.

---

## 14. Data pipeline (SOC scrape)

The catalog the app loads, `frontend/data/courses.json`, is built from three things: the base catalog (the file itself, with the requirement mappings that came from the upstream project), the Schedule of Classes scrape (`backend/data/soc.json`) and the Qatar overlays (`backend/data/mapping_overlays.json`). On the CMU-Q server a daily system cron job rebuilds it in place (14.2). Nothing commits data to git any more. Until the cutover, the old GitHub Actions workflow on `main` still runs (14.9).

### 14.1 Data rules (do not break)

1. **The SOC scrape is the rule.** Offerings, campus, units and titles come from it. When the SOC and another source disagree about what is offered, the SOC wins.
2. **Qatar information lives only in `backend/data/mapping_overlays.json`.** Never hand-edit `courses.json` for content, and never put Qatar facts into the scraper or reconcile code.
3. **Never infer a renumbering.** Treat an old and a new number as the same course only when an official source says so (the H&SS Course Offerings sheet, an official minor file). Same titles, same meeting times or the validator's warnings are hints, not evidence. The old Psychology numbers were removed on 2026-11-09 after their mappings moved to the current numbers.
4. **The catalog is the base and the sheet only adds.** The mappings in `courses.json` come from the upstream catalog; the H&SS sheet and the other overlays only add mappings. A mapping is removed only by an explicit `remove_mappings` entry with a reason.
5. **The pipeline never deletes catalog rows.** Rows the SOC no longer lists keep their history. The daily update refuses to publish a catalog that lost any course code.

### 14.2 The daily update on the server

Cron (`/etc/cron.d/countsfor`, from `deploy/countsfor.cron`) runs `backend/scraper/run_scrape.sh` as the `countsfor` user every day at 15:00 server time. The script refuses to run as any other user (it compares `id -un` with the owner of `backend/data/`; `CF_ALLOW_ANY_USER=1` skips the check), because a run as root would leave root-owned files in `backend/var/` and the data folders that make every later cron run fail. It then sources `/etc/countsfor/scraper.env` (template: `deploy/scraper.env.example`; every setting is optional), changes to the deploy root and runs `backend/scraper/update_data.py` with the virtual environment's Python. `update_data.py`:

1. Takes an exclusive lock on `backend/var/update.lock` (flock). If another update holds it, it exits 75. If the lock file cannot be opened at all (for example it belongs to root after a run as root), it logs why and how to fix the ownership, and exits 1. Cron also wraps the run in `flock -n /run/lock/countsfor-scrape.lock` and `timeout 3h`.
2. Runs the SOC parser tests, as the old workflow did: `python -m pytest backend/scraper/tests/test_scrape_soc.py backend/scraper/tests/test_soc_parse.py` (43 tests). `--skip-tests` skips them.
3. Copies the live `backend/data/soc.json` and `frontend/data/courses.json` into `backend/var/staging/` (`CF_STAGING_DIR`). `scrape_soc.py` carries old semesters forward from the file it overwrites, so it must start from a copy of the live file.
4. Runs the four pipeline steps of 14.3 on the staged copies, stopping at the first failure: `scrape_soc.py`, `reconcile_offerings.py`, `apply_mapping_overlays.py`, `validate_soc_coverage.py`. `--no-scrape` skips the scrape and rebuilds the catalog from the live `soc.json` (after a deploy, or after you change `mapping_overlays.json`).
5. Checks the result. It publishes only if both files parse; `metadata.last_scrape` is set (and changed, when this run scraped); every semester and campus present in both the live and the new `soc.json` keeps at least `CF_MIN_SECTION_RATIO` (0.98) of its live section count; and the catalog keeps at least `CF_MIN_CATALOG_RATIO` (0.95) of its rows and loses no course code.
6. Publishes with `os.replace`: `courses.json` (the old one kept as `courses.json.prev`), then `courses.json.gz` (gzip level 9, which Apache sends to browsers that accept gzip: about 1.2 MB instead of 30 MB), then `soc.json` (the old one kept as `soc.json.prev`). Files are mode 644. A catalog that is unchanged byte for byte is not rewritten, so its modification time and ETag stay and browsers keep their cached copy; `soc.json` is still updated, so the admin Overview shows the last successful scrape.

Exit codes: 0 published (or nothing changed), 1 failed, 75 another update is running. On any failure the live files stay as they were and the staged files stay in `backend/var/staging/` for inspection until the next run. Every log line starts with a timestamp, and each step's output is prefixed with the step name, for example `2026-11-08T15:41:12+03:00 [validate_soc_coverage] OK: every SOC course is present in courses.json.` Read the log with `tail -n 50 /var/log/countsfor/scrape.log`.

It does not commit or push anything, and it does not run `scripts/bump_cf_build.py`: Apache sends the data with `no-cache` and an ETag, so browsers ask for it again on every load and get a 304 when nothing changed. Tests: `backend/scraper/tests/test_update_data.py` (no network; success with a fake scrape, each failing step and each check leaves the live files untouched, the lock, `--no-scrape`, and the real reconcile, overlay and validation steps on a copy of the repo data).

Settings (`/etc/countsfor/scraper.env`): `CF_DEPLOY_ROOT` (default: the folder that holds `backend/`, which is `/var/www/html/countsfor` on the server and the repo root in a checkout), `CF_STAGING_DIR`, `CF_MIN_SECTION_RATIO`, `CF_MIN_CATALOG_RATIO`, plus the scraper settings in 6.2 and `https_proxy` if the server needs an outbound proxy.

### 14.3 What each step does

1. **Gate:** the two parser test files (14.2 step 2).
2. **`scrape_soc.py`:** scrapes every semester on the SOC form for Pittsburgh and Qatar, all departments, and writes `soc.json` only if the scrape is non-empty and above `MIN_COURSES_FOR_VALID_SCRAPE` (100; `MIN_COURSES_FOR_SUMMER_SCRAPE`, 10, for summer). A semester below the threshold counts as not released yet and its previous data is kept. Rows are split on `</tr>`, because only the first row of each course has an opening `<tr>` (the first header-based parser, before November 8, 2026, read only complete `<tr>...</tr>` pairs and kept only the first section of each course; that output was never adopted). Columns are read from each table's header, so the summer Session column does not shift cells. Cancelled sections are kept with `cancelled: true`; a table without a header is skipped rather than guessed. Pages are decoded with the charset the server declares (the SOC sends ISO-8859-1, read as windows-1252), so accented titles such as "Production Prep: L'étoile" are kept; before November 8, 2026 they were decoded as UTF-8 and the letter became U+FFFD. A full scrape takes 30 to 90 minutes with polite delays.
3. **`reconcile_offerings.py`:** merges SOC sections into `courses.json` (offerings, campus flags, units). Cancelled sections do not count as offerings and do not set `offered_qatar` or `offered_pitts`. For each field the newest semester wins (within a year: spring, then summer, then fall). `course_name` becomes the newest SOC title after `clean_soc_title()` (the catalog name stays only when cleaning leaves nothing). A title with a "TBA" placeholder, such as "Production Prep: TBA 5", is used only when no semester has another title. When the old name and the SOC title share no words, the number was probably reused: the old name, cleaned with `clean_soc_title()`, goes into `previous_course_name` (an existing `previous_course_name` is kept) and the code is printed under `REVIEW`; a SOC title that matches the stored `previous_course_name` is not a reuse. Mappings are never removed here. A SOC course missing from the catalog gets a new row (`soc_ingested`). `offered` on those rows is rebuilt from their SOC offerings for every semester in `soc.json`, so a semester that does not list the row, or lists it with only cancelled sections, drops out, and `offered` can become empty; semesters `soc.json` does not hold are kept, and a row that is no longer in `soc.json` at all keeps its `offered` unchanged. Catalog rows keep their history. Malformed SOC data is ignored, not deleted: a course whose units cell is not units (a number, a range or list of numbers, or VAR; the old fixed-column parser put the summer Session text such as "qatar summer" there) and a section whose section cell is not a section id (`soc_parse.usable_sections`) give no offerings, campus flags, titles or new rows; a course whose sections are all cancelled or malformed, with at least one malformed, is ignored whole (`soc_parse.is_ignored_course`, also used by step 5), and a semester where a `soc_ingested` row appears only as malformed data stays in its `offered`. Reconcile prints the ignored counts per semester (`IGNORED malformed SOC data in M25: 90 course(s), 827 section(s)`). It does **not** create requirement mappings.
4. **`apply_mapping_overlays.py`:** applies `backend/data/mapping_overlays.json` (14.5): additive mappings, mapping removals, Qatar visibility. It fails, without saving, if the file is invalid. It then prints a verification line (`verify courses.json: OK IGI=60 missing=[]`) and an audit line (`audit courses.json: OK checked=19 gaps=0`).
5. **`validate_soc_coverage.py`:** fails if a SOC course is missing from the catalog (courses with only cancelled sections and courses reconcile ignores as malformed are not required). It also fails if any semester the newest scrape wrote (`scraped_at` equal to `metadata.last_scrape`) has malformed data, because the current parser should produce none and the pipeline would silently drop those courses; semesters carried forward from older scrapes, such as M25, are allowed. It also prints a `WARNING` (not a failure) listing same-department, same-title pairs where one row is outside the SOC (43 pairs on November 9, 2026, none in Psychology), so possible renumberings show up in the log. Nothing is changed automatically.

### 14.4 Run the pipeline by hand

Locally, from the repo root:

```bash
source .venv/bin/activate
python -m pytest backend/scraper/tests -q            # 179 tests
python backend/scraper/update_data.py --no-scrape    # rebuild frontend/data/courses.json from backend/data/soc.json
python backend/scraper/update_data.py                # full run: scrape, rebuild, check, publish (30 to 90 minutes)
git diff --stat
```

`update_data.py` works in a checkout exactly as on the server (its deploy root defaults to the folder that holds `backend/`). It also writes `frontend/data/courses.json.gz` and, when a file changed, `courses.json.prev` and `soc.json.prev`; all three are gitignored. You can also run the steps one by one, which writes the files in place without the checks:

```bash
python backend/scraper/scrape_soc.py
python backend/scraper/reconcile_offerings.py
python backend/scraper/apply_mapping_overlays.py
python backend/scraper/validate_soc_coverage.py
```

Before adopting a new `soc.json` by hand, compare its course and section counts per semester and campus with the previous file; `update_data.py` does this for you (14.2 step 5).

On the server, always go through the wrapper, as `countsfor`, so file ownership stays right:

```bash
sudo -u countsfor /var/www/html/countsfor/backend/scraper/run_scrape.sh --no-scrape   # rebuild only, under a minute
sudo -u countsfor /var/www/html/countsfor/backend/scraper/run_scrape.sh               # full run
```

### 14.5 Mapping overlays (`backend/data/mapping_overlays.json`)

The SOC scrape stays the rule. This file is the one place for manual complements on top of it (Qatar campus information that the SOC does not carry). Put only confirmed entries here; never infer a mapping (14.1).

```json
{
  "description": "...",
  "overlays": [
    {
      "id": "hss-sheet-85-110",
      "note": "why this exists",
      "course_codes": ["85-110"],
      "create_missing": false,
      "requirements": {
        "BA": [{"requirement": "GenEd---University Core---Scientific Reasoning", "type": true, "major": "BA"}]
      },
      "ensure_course_defaults": {"department": "82", "offered_qatar": true},
      "ensure_course_defaults_codes": ["82-101"]
    }
  ],
  "remove_mappings": [
    {"course_code": "85-414", "programs": "all", "reason": "..."}
  ],
  "qatar_visibility": [
    {"course_code": "85-100", "rule": "show_only_if_offered_qatar", "note": "..."}
  ]
}
```

`apply_mapping_overlays.py` applies the sections in this order, in one step. Running it twice gives the same file.

1. **`overlays`**: additive mappings. `create_missing: false` skips (with a warning) a code the catalog lacks instead of creating a `manual_seed` row. `ensure_course_defaults_codes` limits `ensure_course_defaults` (and creation) to those codes.
2. **`remove_mappings`**: removes the requirement rows of the listed programs (`["BA", "BS"]` or `"all"`, which covers CS, IS, BA, BS and AI). It runs after step 1, and step 1 skips those programs, so nothing re-adds them.
3. **`qatar_visibility`**: `show_only_if_offered_qatar` sets `qatar_only`; the app hides the course everywhere unless its SOC offerings include the Qatar campus.

`qatar_only` belongs to this step: a row the file no longer lists loses it. Use the file for mapping fixes that should live in git and apply to every deploy; use the admin course editor for quick fixes by non-developers. After you change the file, deploy it (15.16), which runs `--no-scrape`. Tests: `backend/scraper/tests/test_mapping_overlay_sections.py` (also checks that every requirement path in the file exists in `frontend/data/courses.json`) and `backend/scraper/tests/test_is_igi_modern_languages.py`.

### 14.6 Psychology decisions and open data questions

Settled in November 2026 (the Entry column says where each one lives):

| Decision | Entry |
|---|---|
| The old Psychology numbers were removed on 2026-11-09 after their mappings moved to the current numbers. Each old row's requirement mappings were copied onto its current number first (85-104, 85-253 and 85-261 to 85-190, 85-211 to 85-110, 85-219 to 85-170, 85-221 to 85-130, 85-241 to 85-150, 85-377 to 85-452, 85-442 to 85-454, 85-359 to 85-411, 85-340 to 85-350). | none (a one-time change to `courses.json`) |
| The approved H&SS sheet mappings for 85-110, 85-130, 85-150, 85-170, 85-190, 85-251, 85-300, 85-310, 85-364, 85-413, 85-450 and 85-452. | `overlays`, one `hss-sheet-<code>` entry each |
| 85-414 (now "Cognition in the Age of AI") loses its mappings: the number was reused, and the mappings belonged to the old Cognitive Neuropsychology. The sheet lists none for it. | `remove_mappings` |
| 85-426 loses its mappings: it was renamed to "Reverse Engineering Brains and Machines", and the mappings came from "Learning in Humans and Machines". | `remove_mappings` |
| 85-100 (Introduction to Psychology) is not on the H&SS sheet, so it shows only when the SOC lists it for Qatar. | `qatar_visibility` |
| Kept as separate courses: 85-102 and 85-100, 85-421 and 85-210, and graduate versions such as 85-852 and 85-854. | none |

Open questions (nothing in the data changes until someone with authority answers them):

1. **85-426** has no mappings until it is confirmed what "Reverse Engineering Brains and Machines" should count for.
2. **85-102** (Introduction to Psychology, last offered M25 and never in Qatar in the SOC data) keeps its base catalog mappings (CS, IS, BA, BS, and AI through the SCS general education) and stays visible; since 14.10 its CS Category 1 row is marked earlier (the 2026-27 list has 85-100). Should it keep them, or be hidden like 85-100?
3. **85-421** (Language and Thought, last offered F25, not in Qatar) keeps its base catalog mappings (CS, BA, BS); the 2026-27 AI page lists it for Category 1A. Are they still right?
4. **The 43 same-title pairs** that `validate_soc_coverage.py` logs as warnings on every run (other departments, none in Psychology) are hints only; change nothing without an official source.

The other data questions (SOC-created rows that keep F26, codes printed under `REVIEW`, M25) are in 21.2.

### 14.7 Faculty directory refresh

`python backend/scraper/scrape_faculty_directory.py --dry-run` then `python backend/scraper/scrape_faculty_directory.py -o backend/data/faculty_directory.json`. It queries the CMU-Q People page's public Algolia index using the search-only key embedded in that site (copied into the script). Review the diff before committing: everyone in this file gets faculty access in production. Deploy it (15.16) and restart the API.

### 14.8 The data files in git

Once the server runs, its `soc.json` and `courses.json` are newer than the copies in git. The repo copies are only a starting point: for local development, and for the first deploy of a new server, which needs a `soc.json` to carry old semesters forward (15.4). Every later deploy overwrites the server's `courses.json` with the repo copy and rebuilds it from the server's `soc.json` (15.16), so a stale repo copy loses nothing. To refresh the repo copies now and then (the server's `backend/` folder is readable only by `countsfor`):

```bash
ssh <server> 'sudo cat /var/www/html/countsfor/backend/data/soc.json' > backend/data/soc.json
ssh <server> 'sudo cat /var/www/html/countsfor/frontend/data/courses.json' > frontend/data/courses.json
git diff --stat
```

### 14.9 History: the GitHub Actions scrape

Before the server, `.github/workflows/scrape.yml` ran the same steps on GitHub every day at 12:00 UTC and on weekdays at 06:00 UTC (only on `Adicmu/Countsfor-Summer-26`), ran `bump_cf_build.py`, committed `data/soc.json`, `data/courses.json` and `app.html` as `soc-bot` (`Update SOC data (YYYY-MM-DD)`) and triggered the Pages deploy. It failed every day from July 9 to November 3, 2026 because it never installed pytest; that was fixed on November 3. The `cleanup` branch removes it, but **it still runs on `main` until the branch is merged**, with the old layout and the old fixed-column parser (it shifts every field on summer pages, does not mark cancelled sections and turns accented letters into U+FFFD). Disable it in the GitHub Actions tab at the cutover (15.15). The partner fork `Hindjendara/Countsfor-Summer-26` has its own copy of the workflow.

### 14.10 Requirement bucket names (2026-27 catalog)

On November 10, 2026 the requirement paths of all five majors moved to the bucket names of the 2026-27 CMU Undergraduate Catalog (the major pages, the SCS, Dietrich, MCS and Tepper general education pages, and the CMU-Q page). The mappings that were already there stayed the base:

- Each old bucket was renamed to the catalog heading it belongs to. Several old buckets can merge into one (for example the CS Science and Engineering options all became `GenEd---Science and Engineering`); a course appears once per bucket.
- Courses the catalog lists but the mapping lacked were added, when `courses.json` has a row for them. Where the catalog gives a rule instead of a list ("any 70-3xx course"), today's courses were checked against the rule and other matching courses were not added, with two exceptions: the AI School of Computer Science Electives, which had no list to start from, holds every SCS course in `courses.json` that meets its rule, and the Biological Sciences D. Cultural/Global Understanding Course bucket holds the 82-xxx courses below 600 its rule names.
- Courses the catalog no longer lists in a bucket were **kept** and marked `"earlier": true` with an `earlier_reason`: `older degree version`, `not covered by the 2026-27 rule`, `honors or older alternative`, `cross-listed with NN-NNN` or `renumbered as NN-NNN`. The tree lists them after the current courses and the course card's Counts For list shows them, each with an "Earlier requirement" tag (the reason is in its tooltip).
- Old buckets with no 2026-27 heading keep their name with every row earlier (the Biological Sciences Biophysics and Computational Biology options, under `Options`; the Information Systems Digitalization concentration, under `IS Concentrations`).
- AI became a live major, built from its catalog page; its general education rows are the SCS ones CS uses, with Category 1A (Cognitive Studies) in place of Category 1.

Every bucket name has a rule chip in `FULFILLMENT_RULES` (`js/data.js`), and the rules are listed in catalog order, which is also the order the tree shows sibling buckets in. `frontend/tests/catalog-data.test.js` checks the served catalog against `js/data.js`: known roots only, no dash punctuation in bucket names, a rule chip for every bucket, no stale `LABEL_OVERRIDES` or rule keys, and a reason on every earlier row.

The minors did not change with the bucket names: `frontend/data/minors.json` lists course codes and number rules, not requirement paths (8.10).

The old to new paths are in `backend/data/requirement_path_renames.json`. The pipeline does not read it: `courses.json` carries the new paths, and reconcile keeps them; `mapping_overlays.json` and the constants in `apply_mapping_overlays.py` use the new paths, so the daily overlay step adds no old path back.

---

## 15. Deploy to the CMU-Q server

CountsFor's new home is an Ubuntu 24.04 server at CMU-Q, `https://countsfor.qatar.cmu.edu`. Apache serves the static frontend over HTTPS and proxies `/api` to the Flask API, which runs under Gunicorn on `127.0.0.1:8000`. The database is a local PostgreSQL. A system cron job runs the scraper once a day.

> **Status on November 8, 2026: not deployed yet.** Everything below is written from the files in `deploy/` and checked against the code, but nobody has run it on the real server yet. The live site still runs on GitHub Pages and Render from `main` (15.20) and keeps running there until the cutover (15.15). When you do the first deploy, correct this section wherever reality differs, and record the date.

The first deploy goes through 15.2 to 15.14 in order. Later deploys only need 15.16.

### 15.1 What runs where

| Piece | On the server | From the repo | Installed as |
|---|---|---|---|
| Static site | Apache 2.4, `https://countsfor.qatar.cmu.edu/`, DocumentRoot `/var/www/html/countsfor/frontend` | `deploy/countsfor.conf` | `/etc/apache2/sites-available/countsfor.conf` |
| API | Gunicorn, 3 workers, `127.0.0.1:8000`, `'backend.app:create_app()'` from `/var/www/html/countsfor`, user and group `countsfor`. Apache proxies `/api/` to it. | `deploy/countsfor-api.service` | `/etc/systemd/system/countsfor-api.service` |
| API settings | read by systemd | `deploy/countsfor.env.example` | `/etc/countsfor/countsfor.env` (640, `root:countsfor`) |
| Database | local PostgreSQL (Ubuntu 24.04 ships version 16), role and database `countsfor`, peer authentication over the Unix socket (`DATABASE_URL=postgresql:///countsfor`) | none | none |
| Daily data update | cron at 15:00 server time runs `backend/scraper/run_scrape.sh` as `countsfor` | `deploy/countsfor.cron`, `deploy/scraper.env.example` | `/etc/cron.d/countsfor`, `/etc/countsfor/scraper.env` |
| Logs | API: the journal (`journalctl -u countsfor-api`). Daily update: `/var/log/countsfor/scrape.log`. Apache: `/var/log/apache2/countsfor_ssl_access.log` and `countsfor_ssl_error.log`. | `deploy/countsfor.logrotate` | `/etc/logrotate.d/countsfor` |

Folder layout on the server:

```
/var/www/html/countsfor/          deploy root, home of the countsfor user (Apache denies all of it but frontend/)
|-- frontend/                     the repo's frontend/ without tests/ (Apache DocumentRoot)
|   `-- data/
|       |-- courses.json          live catalog, rewritten by the daily update
|       |-- courses.json.gz       gzip copy that Apache sends (made on the server)
|       `-- courses.json.prev     previous catalog, for rollback
`-- backend/                      the repo's backend/ (Python package "backend"), mode 750
    |-- .venv/                    virtual environment for the API and the scraper (server only)
    |-- data/soc.json             live SOC scrape, rewritten by the daily update (and soc.json.prev)
    |-- scraper/                  the pipeline; run_scrape.sh is the cron entry point
    `-- var/                      update.lock and staging/ (server only)
```

Gunicorn runs from `/var/www/html/countsfor` so that `backend` imports as a package, exactly as from the repo root locally. Never make the deploy root a git checkout that you `git pull` into: the daily update rewrites tracked files there. Keep a separate checkout and copy from it (15.4).

### 15.2 Prerequisites

- **Access:** an account with `sudo` on the server.
- **Hostname and certificate (CMU-Q IT):** `countsfor.qatar.cmu.edu` must point to this server, and the SSL certificate and key are in `/etc/apache2` (their file names are not recorded; find them with `sudo ls -l /etc/apache2`). In November 2026 the name resolved to a private address (`172.20.245.41`), reachable only on the CMU-Q network; whether the site should be reachable from outside campus is IT's decision.
- **Packages:**

  ```bash
  sudo apt update
  sudo apt install -y apache2 python3-venv postgresql rsync git
  ```

  Ubuntu 24.04 brings Python 3.12 and PostgreSQL 16 (with `psql`, `pg_dump` and `pg_restore`). `psycopg2-binary` ships its own libpq, so `libpq-dev` and a compiler are not needed. If the Render database runs a newer PostgreSQL than 16, read 15.8 step 2 before you create the database.
- **Apache modules:** `ssl proxy proxy_http headers rewrite`, plus `deflate` and `http2`, which the site uses when present (15.10 enables them all).
- **Default sites:** `000-default` and `default-ssl` must be disabled (15.10). `000-default` serves all of `/var/www/html`, `backend/` included.
- **Time zone:** cron uses the server's local time. `timedatectl` shows it. The cron file assumes `Asia/Qatar` (15:00 in Qatar is 12:00 UTC, the old workflow's slot). On a server kept in UTC, change `0 15` to `0 12` in the cron line (15.12).
- **Outbound HTTPS:** to `enr-apps.as.cmu.edu` (the scraper), `www.googleapis.com` (Google sign-in fetches Google's token certificates), `pypi.org` and `files.pythonhosted.org` (pip), and `api.resend.com` if you use Resend. Test with `curl -sI https://enr-apps.as.cmu.edu/open/SOC/SOCServlet | head -1`. If the server needs a proxy, set `https_proxy` in `scraper.env` and `HTTPS_PROXY` in `countsfor.env` (both templates have the line).

### 15.3 System user and folders

```bash
sudo adduser --system --group --home /var/www/html/countsfor countsfor
sudo chmod 755 /var/www/html/countsfor
sudo install -d -m 755 -o countsfor -g countsfor /var/www/html/countsfor/frontend
sudo install -d -m 750 -o countsfor -g countsfor /var/www/html/countsfor/backend
sudo install -d -m 755 -o countsfor -g countsfor /var/log/countsfor
sudo install -d -m 750 -o root -g countsfor /etc/countsfor
```

`countsfor` is a system user without a login shell. It owns the deploy root, runs the API and the daily update, and owns the database. Run commands as it with `sudo -u countsfor <command>`. Apache (`www-data`) only reads `frontend/`; `backend/` is closed to it both by permissions and by the Apache configuration.

### 15.4 Copy the code

Keep a clean checkout on the server under your own account and copy from it with rsync. Deploy committed code only.

```bash
git clone https://github.com/Adicmu/Countsfor-Summer-26.git ~/countsfor-src
cd ~/countsfor-src
git checkout main
git status --short         # must print nothing
```

**Before the merge (the rehearsal, 15.15 step 1)** `main` still has the old layout, and on November 8, 2026 the `cleanup` branch existed only in the checkout it was made in (17.2): it is on neither GitHub repo. Push it first to a repo the server can clone, then clone that repo and check out `cleanup` instead of `main`. For example, if it was pushed to Hind's working repo (17.1):

```bash
git clone https://github.com/Hindjendara/CMUQ-CountsFor.git ~/countsfor-src
cd ~/countsfor-src
git checkout cleanup
git status --short         # must print nothing
```

After the merge, replace that checkout with a fresh clone of the main repo on `main`, as above (`rm -rf ~/countsfor-src` first). Which repo to push `cleanup` to for the rehearsal is the owner's choice; the server must be able to clone it (a private repo needs a deploy key or token).

First deploy:

```bash
cd ~/countsfor-src
sudo rsync -a --delete --chown=countsfor:countsfor --chmod=D755,F644 \
  --exclude /tests/ \
  --exclude /data/courses.json.gz --exclude /data/courses.json.prev \
  frontend/ /var/www/html/countsfor/frontend/
sudo rsync -a --delete --chown=countsfor:countsfor --chmod=o-rwx \
  --exclude /.venv/ --exclude /var/ --exclude /instance/ \
  --exclude /.env --exclude __pycache__/ --exclude /data/soc.json.prev \
  backend/ /var/www/html/countsfor/backend/
```

On **every later deploy** add `--exclude /data/soc.json` to the second command (15.16 has the full commands).

Why each exclude:

- `frontend/tests/` is not deployed (Apache also denies `/tests/`).
- `courses.json.gz`, `courses.json.prev`, `soc.json.prev`, `.venv/`, `var/` and `instance/` exist only on the server; without the excludes `--delete` would remove them.
- `.env` and `__pycache__/`: a local settings file or Python cache must never reach the server. Secrets live in `/etc/countsfor/`.
- `soc.json`: the first deploy copies the repo's file, because the scraper carries old semesters forward from it and `--no-scrape` needs it. After that the server's copy is newer than git, so it must never be overwritten.
- `courses.json` is overwritten on every deploy on purpose: the deploy then rebuilds it from the live `soc.json` and the current overlays (15.16).

`--chown` makes `countsfor` the owner of everything. On `frontend/`, `--chmod=D755,F644` makes every folder and file readable by Apache (`www-data` reads them as "other"), whatever the umask of your checkout; without it, a checkout made with umask 027 or 077 would be copied as 640 or 600 and the site would answer 403. On `backend/`, `--chmod=o-rwx` closes it to every other user, including Apache.

### 15.5 Python virtual environment

```bash
sudo -u countsfor python3 -m venv /var/www/html/countsfor/backend/.venv
sudo -u countsfor /var/www/html/countsfor/backend/.venv/bin/pip install --no-cache-dir \
  -r /var/www/html/countsfor/backend/requirements.txt
```

One environment serves both the API (Gunicorn) and the daily update (`run_scrape.sh` uses `backend/.venv/bin/python`). `--no-cache-dir` keeps pip from writing a cache into the deploy root, which is `countsfor`'s home folder.

### 15.6 Environment files

```bash
cd ~/countsfor-src
sudo install -m 640 -o root -g countsfor deploy/countsfor.env.example /etc/countsfor/countsfor.env
sudo install -m 640 -o root -g countsfor deploy/scraper.env.example /etc/countsfor/scraper.env
python3 -c "import secrets; print(secrets.token_urlsafe(48))"    # a new SECRET_KEY
sudo editor /etc/countsfor/countsfor.env
```

In `countsfor.env`:

- `SECRET_KEY`: paste the new value. Everyone has to sign in again on the new site anyway (their tokens are stored per site), so there is no reason to copy Render's key.
- Email for password resets: if Render had `RESEND_API_KEY`, `MAIL_FROM` or `SMTP_*` values (Render dashboard, web service, Environment), copy them, or use a campus SMTP relay if IT offers one (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USE_TLS`, `MAIL_FROM`, no login). With no provider, users recover their password through Google (6.1).
- Everything else is already right for this server: `FLASK_ENV=production`, `DATABASE_URL=postgresql:///countsfor`, `SKIP_DB_BOOTSTRAP=1`, `TRUST_PROXY=1`, the Google client ID, `ALLOWED_EMAIL_DOMAIN=andrew.cmu.edu`, the seed and SOC paths under `/var/www/html/countsfor/backend/data/`, `FRONTEND_ORIGIN` and `FRONTEND_RESET_BASE` on `https://countsfor.qatar.cmu.edu`.

`scraper.env` needs no change unless the server needs a proxy (`https_proxy`). One `NAME=value` per line, no `export`; double-quote a value with spaces or `< >`. Never put secrets in the repo or in `backend/.env` on the server. Keep a copy of the filled-in `countsfor.env` in a password manager: it is the only place the secrets live.

### 15.7 PostgreSQL

```bash
sudo -u postgres createuser countsfor
sudo -u postgres createdb -O countsfor countsfor
sudo -u countsfor psql -d countsfor -Atc 'select current_user, version()'
```

The OS user `countsfor` connects as the database role `countsfor` by peer authentication, so there is no password; that is what `DATABASE_URL=postgresql:///countsfor` means. As the database owner, `countsfor` can create tables in `public` (PostgreSQL 15 and newer give `public` to the database owner).

**If you are importing the Render database, do it now (15.8), before anything creates tables.** For a brand new, empty database, skip 15.8: the service creates the tables when it first starts (15.9).

### 15.8 Import the Render database

Accounts, directory entries, flags, saved courses, shared plans, admin course edits, the audit log and the analytics live in Render's Postgres database `CountsFor_Summer_2026`. Move them with `pg_dump` and `pg_restore`.

**Restore before the first bootstrap or service start.** `python -m backend.bootstrap_db`, and the service's `ExecStartPre` that runs it, create every missing table, empty. `pg_restore` then stops at "relation ... already exists", and because the restore runs as one transaction, nothing is imported.

Do it twice: a **rehearsal** while the old site still runs (into a scratch database, below), and the **final copy** during the cutover (15.15), after writes have stopped.

1. **Get the External Database URL:** Render dashboard, database `CountsFor_Summer_2026`, **Connect**, **External Database URL**. It has the form `postgresql://USER:PASSWORD@HOST/DBNAME` and contains the password. Keep the password out of your shell history and off every command line (other users on the server can read a running command's arguments with `ps`): put the parts in a connection service file that only you can read, and name the service in the commands below.

   ```bash
   umask 077
   cat > ~/.pg_service.conf <<'EOF'
   [render]
   host=CHANGE_ME_HOST
   port=5432
   dbname=CHANGE_ME_DBNAME
   user=CHANGE_ME_USER
   password=CHANGE_ME_PASSWORD
   sslmode=require
   EOF
   editor ~/.pg_service.conf                     # fill in the four values from the URL
   ls -l ~/.pg_service.conf                      # -rw------- (600)
   ```

   `psql`, `pg_dump` and `pg_restore` read `~/.pg_service.conf` for `service=render`. `sslmode=require`: Render's external connections need SSL.

2. **Check the versions:**

   ```bash
   psql service=render -Atc 'show server_version'
   pg_dump --version
   ```

   `pg_dump` must be the same major version as the Render server or newer, and the same `pg_restore` version should restore it. Ubuntu 24.04 has 16. Whether `pg_restore` 16 can read an archive made by `pg_dump` 17 was not checked; matching versions avoids the question.

   **If Render reports 17 or newer**, the server's database must run that version, and on the default port 5432: every command in this section, the service and `DATABASE_URL=postgresql:///countsfor` use the default port. Installing a second version next to Ubuntu's 16 gives the new cluster port 5433, and everything would still reach 16. Do this **before** 15.7 (if 15.7 already ran, the database it made is dropped with the 16 cluster, which is fine while it is empty). The commands were not run on the server; check each step's output. For example, for 17:

   ```bash
   # add the PostgreSQL apt repository: https://www.postgresql.org/download/linux/ubuntu/
   sudo apt install -y postgresql-17
   pg_lsclusters                                  # 16 main on 5432, 17 main on 5433
   sudo -u postgres psql -p 5432 -l               # 16 must hold nothing you need (only postgres, template0/1, an empty countsfor)
   sudo pg_dropcluster --stop 16 main             # deletes the 16 cluster and its data
   sudo pg_dropcluster --stop 17 main
   sudo pg_createcluster --start -p 5432 17 main
   pg_lsclusters                                  # only: 17 main 5432 online
   sudo apt remove postgresql-16 postgresql-client-16   # optional, so no tool picks 16 by mistake
   ```

   Then do 15.7, and use `/usr/lib/postgresql/17/bin/pg_dump` and `/usr/lib/postgresql/17/bin/pg_restore` (full paths) in steps 3 and 5. If the server already runs other databases on 16, do not drop it: ask IT, or keep 17 on 5433 and add `?port=5433` to `DATABASE_URL` and `-p 5433` to every `psql`, `createuser`, `createdb`, `dropdb` and `pg_restore` command in 15.7, 15.8 and 15.17.

3. **Dump** (for the final copy, only after the Render service is suspended, 15.15):

   ```bash
   umask 077
   pg_dump -Fc --no-owner --no-acl -d service=render -f ~/countsfor-render-$(date +%F).dump
   pg_restore -l ~/countsfor-render-$(date +%F).dump | grep -c 'TABLE DATA'
   ```

   The count is the number of tables with data: 14, or 15 if the Render database still has the legacy `staff_directory_entries` table (`backend/migrate.py` copied it into `directory_entries` long ago; it is harmless).

4. **Hand the file to `countsfor`:**

   ```bash
   sudo install -m 600 -o countsfor -g countsfor ~/countsfor-render-$(date +%F).dump /var/tmp/countsfor-render.dump
   ```

5. **Restore** into the empty database (created in 15.7, never bootstrapped, service never started):

   ```bash
   sudo -u countsfor pg_restore --no-owner --no-acl --single-transaction -n public \
     -d countsfor /var/tmp/countsfor-render.dump
   ```

   - `--no-owner --no-acl`: Render's role names do not exist here; everything ends up owned by `countsfor`.
   - `--single-transaction`: all or nothing. On any error the whole restore is rolled back and the database stays empty; read the message, fix the cause and run the same command again.
   - `-n public`: only the app's schema (it skips things like extension comments that only a superuser may restore).

   If it fails with "relation ... already exists", something created the tables first. Stop the service, recreate the database, restore again:

   ```bash
   sudo systemctl stop countsfor-api
   sudo -u postgres dropdb countsfor && sudo -u postgres createdb -O countsfor countsfor
   ```

6. **Compare row counts** with Render:

   ```bash
   for t in users directory_entries flags wishlist_items schedule_plans course_overrides admin_audit_events sign_in_events; do
     printf '%-20s render %-7s local %s\n' "$t" \
       "$(psql service=render -Atc "select count(*) from $t")" \
       "$(sudo -u countsfor psql -d countsfor -Atc "select count(*) from $t")"
   done
   ```

7. **Check the sequences.** Twelve tables have an integer `id` filled from a sequence named `<table>_id_seq` (`flags` and `schedule_plans` use string ids). The dump sets each sequence, but check that every `last_value` is at least the largest `id`; otherwise the next insert fails with "duplicate key value violates unique constraint". Run `sudo -u countsfor psql -d countsfor` and paste:

   ```sql
   SELECT t, max_id, last_value, last_value >= coalesce(max_id, 0) AS ok FROM (
               SELECT 'users' AS t, (SELECT max(id) FROM users) AS max_id, (SELECT last_value FROM users_id_seq) AS last_value
     UNION ALL SELECT 'user_minors', (SELECT max(id) FROM user_minors), (SELECT last_value FROM user_minors_id_seq)
     UNION ALL SELECT 'directory_entries', (SELECT max(id) FROM directory_entries), (SELECT last_value FROM directory_entries_id_seq)
     UNION ALL SELECT 'password_reset_tokens', (SELECT max(id) FROM password_reset_tokens), (SELECT last_value FROM password_reset_tokens_id_seq)
     UNION ALL SELECT 'wishlist_items', (SELECT max(id) FROM wishlist_items), (SELECT last_value FROM wishlist_items_id_seq)
     UNION ALL SELECT 'schedule_plan_items', (SELECT max(id) FROM schedule_plan_items), (SELECT last_value FROM schedule_plan_items_id_seq)
     UNION ALL SELECT 'schedule_plan_share_tokens', (SELECT max(id) FROM schedule_plan_share_tokens), (SELECT last_value FROM schedule_plan_share_tokens_id_seq)
     UNION ALL SELECT 'course_search_counts', (SELECT max(id) FROM course_search_counts), (SELECT last_value FROM course_search_counts_id_seq)
     UNION ALL SELECT 'admin_audit_events', (SELECT max(id) FROM admin_audit_events), (SELECT last_value FROM admin_audit_events_id_seq)
     UNION ALL SELECT 'course_overrides', (SELECT max(id) FROM course_overrides), (SELECT last_value FROM course_overrides_id_seq)
     UNION ALL SELECT 'sign_in_events', (SELECT max(id) FROM sign_in_events), (SELECT last_value FROM sign_in_events_id_seq)
     UNION ALL SELECT 'user_activity_days', (SELECT max(id) FROM user_activity_days), (SELECT last_value FROM user_activity_days_id_seq)
   ) s ORDER BY t;
   ```

   Every row should say `ok` = `t`. For a row that says `f`, set the sequence, for example `SELECT setval('users_id_seq', (SELECT max(id) FROM users));`.

8. **Move saved data off the old Psychology numbers** (14.6). The catalog no longer has rows for them, so wishlist items, flags, schedule plan items and search counts saved under them would match nothing. In the same `psql` session, paste this once:

   ```sql
   BEGIN;
   CREATE TEMP TABLE psych_numbers (old_code text PRIMARY KEY, new_code text NOT NULL) ON COMMIT DROP;
   INSERT INTO psych_numbers VALUES
     ('85-104','85-190'), ('85-253','85-190'), ('85-261','85-190'), ('85-211','85-110'),
     ('85-219','85-170'), ('85-221','85-130'), ('85-241','85-150'), ('85-377','85-452'),
     ('85-442','85-454'), ('85-359','85-411'), ('85-340','85-350');
   -- wishlist_items allows one row per user and course: drop an old-code row when the user
   -- already has the current code, or has an older old-code row for the same current code.
   DELETE FROM wishlist_items w USING psych_numbers p
   WHERE w.course_code = p.old_code AND EXISTS (
     SELECT 1 FROM wishlist_items w2 LEFT JOIN psych_numbers p2 ON p2.old_code = w2.course_code
     WHERE w2.user_id = w.user_id AND w2.id <> w.id
       AND coalesce(p2.new_code, w2.course_code) = p.new_code
       AND (p2.old_code IS NULL OR w2.id < w.id));
   UPDATE wishlist_items w SET course_code = p.new_code FROM psych_numbers p WHERE w.course_code = p.old_code;
   UPDATE flags f SET course_code = p.new_code FROM psych_numbers p WHERE f.course_code = p.old_code;
   UPDATE schedule_plan_items i SET course_code = p.new_code FROM psych_numbers p WHERE i.course_code = p.old_code;
   -- course_search_counts allows one row per program, semester and course: add the counts up.
   INSERT INTO course_search_counts (primary_program, semester_code, course_code, search_count, last_searched_at)
   SELECT c.primary_program, c.semester_code, p.new_code, sum(c.search_count), max(c.last_searched_at)
   FROM course_search_counts c JOIN psych_numbers p ON c.course_code = p.old_code
   GROUP BY c.primary_program, c.semester_code, p.new_code
   ON CONFLICT (primary_program, semester_code, course_code) DO UPDATE
     SET search_count = course_search_counts.search_count + EXCLUDED.search_count,
         last_searched_at = greatest(course_search_counts.last_searched_at, EXCLUDED.last_searched_at);
   DELETE FROM course_search_counts c USING psych_numbers p WHERE c.course_code = p.old_code;
   COMMIT;
   SELECT course_code, is_new, archived, updated_by_email, updated_at FROM course_overrides
   WHERE course_code IN ('85-104','85-253','85-261','85-211','85-219','85-221','85-241','85-377','85-442','85-359','85-340');
   ```

   The last query lists admin course edits saved under an old number. An edit there no longer applies to anything, and a row with `is_new` true would bring the old number back as an added course. No rows: nothing to do. Otherwise an admin redoes each change on the current number in the course editor, and then you delete the old rows:

   ```sql
   DELETE FROM course_overrides
   WHERE course_code IN ('85-104','85-253','85-261','85-211','85-219','85-221','85-241','85-377','85-442','85-359','85-340');
   ```

   Admin edits saved before November 10, 2026 that changed what a course counts for still use the old requirement paths (14.10). The browser applies an edit's whole "counts for" list, so such a course would show under an old bucket with no rule chip. List them:

   ```sql
   SELECT course_code, updated_by_email, updated_at FROM course_overrides WHERE requirements IS NOT NULL;
   ```

   No rows: nothing to do. Otherwise an admin opens each course in the course editor, removes every category that is not in the pick list and adds its new name from `backend/data/requirement_path_renames.json`, then saves.

   Then the minors a BA major may not declare (`business`, `business_analytics`, `finance`, `product`). The app already ignores them, but a saved one makes every later profile save of that student fail ("That minor is not open to students in your major."). List them, then remove them:

   ```sql
   SELECT u.email, u.primary_program, m.minor_code FROM user_minors m JOIN users u ON u.id = m.user_id
   WHERE u.primary_program = 'BA' AND m.minor_code IN ('business', 'business_analytics', 'finance', 'product');
   BEGIN;
   DELETE FROM user_minors m USING users u
   WHERE u.id = m.user_id
     AND u.primary_program = 'BA' AND m.minor_code IN ('business', 'business_analytics', 'finance', 'product');
   UPDATE users SET minor_code = NULL
   WHERE primary_program = 'BA' AND minor_code IN ('business', 'business_analytics', 'finance', 'product');
   COMMIT;
   ```

9. **Bootstrap**, which adds anything the current code needs that the Render database lacks, and verifies the tables:

   ```bash
   sudo -u countsfor bash -c 'set -a; . /etc/countsfor/countsfor.env; set +a; cd /var/www/html/countsfor && backend/.venv/bin/python -m backend.bootstrap_db'
   ```

   Expected output:

   ```
   Database target: postgresql:/countsfor
   Database dialect: postgresql
   Required tables present (14): admin_audit_events, course_overrides, course_search_counts, directory_entries, flags, password_reset_tokens, schedule_plan_items, schedule_plan_share_tokens, schedule_plans, sign_in_events, user_activity_days, user_minors, users, wishlist_items
   Database bootstrap OK
   ```

   (`postgresql:/countsfor` is how the redaction helper prints a socket URL.) Lines such as `Added users.department` before them mean a migration ran because the Render database lacked a column; a second run prints none. A line starting with `FATAL` means it failed: read it, fix the cause, run it again.

10. **Clean up:** `sudo rm /var/tmp/countsfor-render.dump` and `rm ~/.pg_service.conf` (it holds the Render password). Keep the final dump file off the server as the last backup of the Render database.

**Rehearsal:** for the full rehearsal (15.15 step 1), run steps 1 to 9 as written, into `countsfor`, while Render keeps running (the dump is simply a little older than the final one). Then 15.9 starts the service on the imported accounts, and every check in 15.13 can pass. At the cutover the database is recreated and imported again (15.15 step 5).

To try only the import, without touching `countsfor` (for example after the service already created empty tables in it), use a scratch database:

```bash
sudo -u postgres createdb -O countsfor countsfor_rehearsal
sudo -u countsfor pg_restore --no-owner --no-acl --single-transaction -n public -d countsfor_rehearsal /var/tmp/countsfor-render.dump
# steps 6 to 8 with -d countsfor_rehearsal, then step 9 with the other database:
sudo -u countsfor bash -c 'set -a; . /etc/countsfor/countsfor.env; set +a; export DATABASE_URL=postgresql:///countsfor_rehearsal; cd /var/www/html/countsfor && backend/.venv/bin/python -m backend.bootstrap_db'
sudo -u postgres dropdb countsfor_rehearsal
```

### 15.9 Start the API with systemd

```bash
cd ~/countsfor-src
sudo install -m 644 deploy/countsfor-api.service /etc/systemd/system/countsfor-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now countsfor-api
systemctl status countsfor-api --no-pager
curl -s http://127.0.0.1:8000/health
```

`active (running)` only means the Gunicorn master is up (it reports ready to systemd before its workers import the app); the `curl` is the real check. Expected: `{"database":"connected","db_host":"","status":"ok","tables":14}` (`tables` counts every table in the database, so 15 with the legacy table; `db_host` is empty for a socket connection). On every start systemd first runs `python -m backend.bootstrap_db` (`ExecStartPre`); if it fails the API does not start, and `journalctl -u countsfor-api -n 50` shows why. The workers skip the bootstrap because the env file sets `SKIP_DB_BOOTSTRAP=1`. Gunicorn logs requests and errors to the journal (`journalctl -u countsfor-api -f`). systemd restarts the API if it crashes; `sudo systemctl restart countsfor-api` loads new code.

The unit is hardened: the whole file system is read-only for the API (it writes no files; its data is in PostgreSQL), it gets a private `/tmp` and no capabilities. The daily update runs from cron, outside the unit, so these limits do not apply to it. If the API ever needs to write a file, list the folder in `ReadWritePaths=`.

### 15.10 Apache site

```bash
sudo ls -l /etc/apache2                     # find the certificate and key file names
cd ~/countsfor-src
sudo install -m 644 deploy/countsfor.conf /etc/apache2/sites-available/countsfor.conf
sudo editor /etc/apache2/sites-available/countsfor.conf
sudo a2enmod ssl proxy proxy_http headers rewrite deflate http2
sudo a2ensite countsfor
sudo a2dissite 000-default default-ssl
sudo apachectl configtest && sudo systemctl restart apache2
```

In the editor, replace the two placeholders with the real names: `SSLCertificateFile /etc/apache2/CHANGE_ME_countsfor_cert.pem` and `SSLCertificateKeyFile /etc/apache2/CHANGE_ME_countsfor_key.pem`. Uncomment `SSLCertificateChainFile` only if the certificate file does not already contain the intermediate chain. Apache does not start until both files exist. Later changes to the site file only need `sudo apachectl configtest && sudo systemctl reload apache2`.

What the site does: port 80 answers with a permanent redirect to the same path on HTTPS (password reset links keep their `?token=`); port 443 serves `frontend/`, proxies `/api/` to `http://127.0.0.1:8000/api/` (the prefix stays, because every Flask route starts with `/api`), and sends `Cache-Control: no-store` on API answers (it removes the backend's own `Cache-Control` first, so there is only one). `/health` is not proxied, because it reveals the database host and errors; check it on the server, or uncomment the `<Location /health>` block and limit it to a monitoring address range. Server wide, `/var/www/html/countsfor` and its `backend/` are denied, so even a re-enabled `000-default` cannot serve them; on the site, `/tests/`, dotfiles and source, notes, env and backup files (the daily update's `.prev` copies included) are denied. Browsers that accept gzip get `data/courses.json.gz` with `Content-Encoding: gzip` (about 1.2 MB). HTML, JS, CSS and JSON are sent with `no-cache`, so browsers revalidate them on every load and get a 304 when unchanged; images are cached for 30 days. Security headers: HSTS (one year, this host only), `nosniff`, `Referrer-Policy`, `X-Frame-Options`, `frame-ancestors 'self'` and `Permissions-Policy`. The file also suggests `ServerTokens Prod`, `ServerSignature Off` and `TraceEnable Off` in `/etc/apache2/conf-available/security.conf`.

### 15.11 First data build

```bash
sudo -u countsfor /var/www/html/countsfor/backend/scraper/run_scrape.sh --no-scrape
```

This runs the parser tests, rebuilds the catalog from the deployed `soc.json`, checks it and writes `courses.json.gz`. It takes under a minute. The last lines should look like this (dates and counts will differ):

```
... Gates passed (last_scrape 2026-11-07T22:10:04.404911+00:00, 6795 courses)
... courses.json: unchanged, not rewritten
... courses.json.gz: written
... soc.json: unchanged
... Update done in 0.2 min (exit 0)
```

Then do one full run by hand, to see that the scrape works from this server before cron takes over. It takes 30 to 90 minutes, so run it in `tmux` (it survives a dropped SSH connection; detach with Ctrl+b then d, come back with `tmux attach -t scrape`):

```bash
tmux new -s scrape
sudo -u countsfor /var/www/html/countsfor/backend/scraper/run_scrape.sh
```

It should end with `Update done in ... min (exit 0)` and `soc.json: updated`. A failure leaves the live files as they were; see 15.19.

### 15.12 Cron job and log rotation

```bash
timedatectl | grep 'Time zone'              # the cron line assumes Asia/Qatar
cd ~/countsfor-src
sudo install -m 644 -o root -g root deploy/countsfor.cron /etc/cron.d/countsfor
sudo install -m 644 -o root -g root deploy/countsfor.logrotate /etc/logrotate.d/countsfor
sudo logrotate --debug /etc/logrotate.d/countsfor
```

The job in `/etc/cron.d/countsfor`:

```
0 15 * * * countsfor /usr/bin/flock -n /run/lock/countsfor-scrape.lock /usr/bin/timeout -k 5m 3h /var/www/html/countsfor/backend/scraper/run_scrape.sh >> /var/log/countsfor/scrape.log 2>&1 || echo "CountsFor daily update failed (exit $?): see /var/log/countsfor/scrape.log"
```

Every day at 15:00 server time, as `countsfor`: `flock -n` skips the run if the previous one still holds the lock, `timeout` stops a hung run after 3 hours (and kills it 5 minutes later if it ignores that), and the output is appended to `/var/log/countsfor/scrape.log`.

**Failures are silent by default.** On a non-zero exit (1 failed, 75 another update running, 124 or 137 stopped by `timeout`, or 1 from `flock` when the previous run still holds its lock) the `|| echo` part prints one line, and cron mails a job's output to `MAILTO`. The file sets `MAILTO=""`, so that line is dropped and the log is the only record; the old GitHub workflow at least emailed on failure. To be told: have IT confirm the server can send mail (a mailer such as `postfix` or `msmtp-mta` through the campus relay), set `MAILTO=` to an admin address in `deploy/countsfor.cron`, commit, and install the file again. Until then, check that Admin, Overview shows a recent last scrape. If the server is not on Qatar time, edit the hour in `deploy/countsfor.cron` and install it again (cron reads the file by itself; no reload needed). The file name must have no dot, belong to root, have mode 644 and end with a newline, or cron ignores it. The file also has two commented lines: a weekday 09:00 run for registration periods and a nightly database backup (15.17).

Logrotate rotates `/var/log/countsfor/*.log` weekly and keeps 12 compressed weeks. The API logs to the journal, which rotates itself, and Apache's logs are covered by `/etc/logrotate.d/apache2`.

The next day, check: `tail -n 50 /var/log/countsfor/scrape.log` and `journalctl -u cron --since yesterday | grep countsfor`.

### 15.13 Checks

On the server:

```bash
curl -s http://127.0.0.1:8000/health
# {"database":"connected","db_host":"","status":"ok","tables":14}
curl -s -o /dev/null -w '%{http_code}\n' https://countsfor.qatar.cmu.edu/api/me
# 401: the API answers through Apache (you are not signed in)
curl -s 'https://countsfor.qatar.cmu.edu/api/search-analytics/popular?program=CS&semester=F26&limit=3'
# a JSON answer from the API
curl -sI http://countsfor.qatar.cmu.edu/ | head -3
# 301, Location: https://countsfor.qatar.cmu.edu/
curl -sI -H 'Accept-Encoding: gzip' https://countsfor.qatar.cmu.edu/data/courses.json | grep -iE 'content-(type|encoding)'
# content-type: application/json and content-encoding: gzip
curl -s -o /dev/null -w '%{http_code}\n' https://countsfor.qatar.cmu.edu/health
# 404: /health is not public
curl -s -o /dev/null -w '%{http_code}\n' https://countsfor.qatar.cmu.edu/tests/test.html
# 403 or 404: tests are not served
```

If the name does not point to this server yet, add `--resolve countsfor.qatar.cmu.edu:443:127.0.0.1` (and `:80:` for the HTTP check) to test it anyway.

In a browser, in a private window, open `https://countsfor.qatar.cmu.edu/`. Items 2 and 4 need the imported Render database (15.8); on a server with a new, empty database they cannot pass.

1. The landing page loads with no "Could not reach the server" banner.
2. Sign in with an existing account (the password from the old site works, the accounts came with the database) and with Google (needs 15.14).
3. The app loads the catalog: search `15-122`, open it, see its requirements and sections.
4. As an admin, **Admin**, **Overview**: the last scrape date matches the server's `soc.json`, and the user counts match the old site.
5. In the developer tools Network tab, `courses.json` transfers about 1.2 MB, and a reload answers 304.

### 15.14 Google OAuth

In the Google Cloud Console, **APIs & Services**, **Credentials**, the OAuth 2.0 client `378923997481-...apps.googleusercontent.com`, add `https://countsfor.qatar.cmu.edu` to **Authorized JavaScript origins** (exactly that: scheme and host, no path, no trailing slash). Keep `http://localhost:8765` for local development. No redirect URIs are needed (popup flow). Changes can take a few minutes to apply. After the cutover, remove `https://adicmu.github.io` (and `https://hindjendara.github.io` if listed). `GOOGLE_CLIENT_ID` in `/etc/countsfor/countsfor.env` must equal the `cf-google-client-id` meta in `frontend/index.html` and `frontend/app.html`. The Google Cloud project and its owner are not recorded in the repo (23.1).

### 15.15 Cutover from GitHub Pages and Render

As of November 8, 2026 the live site is still the old one: GitHub Pages serves the frontend from `main`, Render runs the API and the database, and the GitHub Actions scrape still commits data to `main`. Nothing has been deployed to the CMU-Q server, and `cleanup` is not merged. The cutover, in order:

1. **Rehearse** 15.2 to 15.14 on the server, deploying the `cleanup` branch (push it first, 15.4) and importing a current dump into `countsfor` (15.8, "Rehearsal"), while the old site keeps running. The server can be fully tested, sign-in with existing accounts included, before anyone uses it.
2. **Freeze `main`:** in the Render dashboard, turn off **Auto-Deploy** for the web service `countsfor-summer-26`; in the GitHub Actions tab, **disable** the "Scrape SOC" workflow. Render auto-deploys `main`, and its build command installed the root `requirements.txt`, which `cleanup` deletes, so a Render deploy of the merged `main` would most likely fail and keep the old version running (not tested). Turning it off removes the question.
3. **Merge `cleanup` into `main`** and push. If `main` has not moved since `cleanup` was last updated (`git merge-base --is-ancestor main cleanup` succeeds), the merge is a fast-forward with no conflicts. Otherwise every bot commit on `main` changed `app.html` (the `?v=` tags), `data/courses.json`, `data/soc.json` and `data_all_courses.json`, which `cleanup` moved or deleted. A test merge of a simulated bot commit (November 8, 2026) gave modify/delete conflicts on `app.html` and `data_all_courses.json` and merged the bot's data changes into `backend/data/soc.json` and `frontend/data/courses.json`; real changes to the data can also conflict there. Take the `cleanup` side of every one of these files (its data comes from the fixed parser; the server rebuilds the data anyway):

   ```bash
   git checkout main && git merge cleanup
   git checkout cleanup -- backend/data/soc.json frontend/data/courses.json frontend/app.html
   git rm --ignore-unmatch app.html data_all_courses.json data/courses.json data/soc.json
   git status --short          # no "UU", "AA", "DU" or "UD" lines left; take the cleanup side of any other
   git diff --cached --stat cleanup   # should print nothing: the result equals cleanup
   git commit --no-edit
   ```

   After the merge, GitHub Pages keeps serving its last build (its workflow is gone) and Render keeps the old API.
4. **Stop writes:** announce a short downtime, then in the Render dashboard **Suspend** the web service. The old site now shows "Could not reach the server".
5. **Final database copy:** `sudo systemctl stop countsfor-api`, then drop and recreate the `countsfor` database, which holds the rehearsal import (the two commands at the end of 15.8 step 5), and run 15.8 steps 3 to 10 (recreate `~/.pg_service.conf` first, step 1, if you already removed it).
6. **Deploy the merged `main`** (15.16) and start the API: `sudo systemctl start countsfor-api`. Run the checks in 15.13.
7. **DNS and Google:** make sure IT points `countsfor.qatar.cmu.edu` at the server, and that the Google origin is in place (15.14).
8. **Tell users:** everyone signs in again (sign-in tokens are kept per site). Accounts, saved courses, flags and shared plans moved with the database. Schedule plans that were never shared, and the course statuses students marked (8.10), live only in the browser's storage for the old address and do not move; a student can carry one over by creating a share link on the old site before step 4 and opening it on the new site with the host changed (the link token is in the database).
9. **Retire the old hosting**, once the new site has worked for a few days: unpublish GitHub Pages (repo **Settings**, **Pages**) or replace it with a page that links to the new address; keep the final dump in two places; then delete the Render web service and database (they are paid plans). Update the top of this README, section 15.20 and 23.1.

### 15.16 Updating the code later

Before you deploy: backend and pipeline tests pass apart from the known failures (16.2); a new column has its `migrate.py` step (11.2); the change is merged into `main`. Bumping the `?v=` tags with `scripts/bump_cf_build.py` is optional on the server: Apache makes browsers revalidate every HTML, JS, CSS and JSON file.

Then on the server (not between 15:00 and the end of the daily update: `pgrep -af update_data.py` must print nothing):

```bash
cd ~/countsfor-src && git pull --ff-only && git status --short
sudo rsync -a --delete --chown=countsfor:countsfor --chmod=D755,F644 \
  --exclude /tests/ \
  --exclude /data/courses.json.gz --exclude /data/courses.json.prev \
  frontend/ /var/www/html/countsfor/frontend/
sudo rsync -a --delete --chown=countsfor:countsfor --chmod=o-rwx \
  --exclude /.venv/ --exclude /var/ --exclude /instance/ \
  --exclude /.env --exclude __pycache__/ \
  --exclude /data/soc.json --exclude /data/soc.json.prev \
  backend/ /var/www/html/countsfor/backend/
sudo -u countsfor /var/www/html/countsfor/backend/.venv/bin/pip install --no-cache-dir \
  -r /var/www/html/countsfor/backend/requirements.txt
sudo systemctl restart countsfor-api
sudo -u countsfor /var/www/html/countsfor/backend/scraper/run_scrape.sh --no-scrape
curl -s http://127.0.0.1:8000/health
```

- The restart runs `bootstrap_db` first, so a new table or a `migrate.py` step reaches the database here; look for its log line with `journalctl -u countsfor-api -n 30`.
- `--no-scrape` matters: rsync replaced the live `courses.json` with the repo copy, which lacks the daily updates. The rebuild brings it back from the live `soc.json` and the deployed `mapping_overlays.json` and rewrites both files. For the minute in between, browsers (which accept gzip) still get the previous catalog from the untouched `courses.json.gz`, and only clients without gzip get the repo copy.
- If you changed a file in `deploy/`, install it again with the command from its section (15.6, 15.9, 15.10, 15.12), then `sudo systemctl daemon-reload` and restart for the unit, or `sudo apachectl configtest && sudo systemctl reload apache2` for the site. Do not overwrite `/etc/countsfor/countsfor.env` with the template: edit it.

### 15.17 Backups

The database is the only thing that cannot be rebuilt (the code is in git; `soc.json` and `courses.json` can be rebuilt from the repo copies and a new scrape). Turn on the nightly dump that `deploy/countsfor.cron` carries commented out:

```bash
sudo install -d -m 700 -o countsfor -g countsfor /var/backups/countsfor
# uncomment the "30 2 * * *" pg_dump line in deploy/countsfor.cron, commit, then:
sudo install -m 644 -o root -g root deploy/countsfor.cron /etc/cron.d/countsfor
```

It writes `/var/backups/countsfor/countsfor-YYYY-MM-DD.dump` (`pg_dump -Fc`) at 02:30 and deletes dumps older than 14 days. A backup on the same disk does not survive the disk: copy the dumps off the server regularly (ask IT whether the server is backed up, or `scp` them weekly). Also keep `/etc/countsfor/countsfor.env` in a password manager.

Test a restore now and then, into a scratch database:

```bash
sudo -u postgres createdb -O countsfor countsfor_restoretest
sudo -u countsfor pg_restore --no-owner --single-transaction -d countsfor_restoretest /var/backups/countsfor/countsfor-YYYY-MM-DD.dump
sudo -u countsfor psql -d countsfor_restoretest -Atc 'select count(*) from users'
sudo -u postgres dropdb countsfor_restoretest
```

To restore for real: `sudo systemctl stop countsfor-api`, drop and recreate `countsfor` (15.8 step 5), restore the dump the same way into `countsfor`, check the sequences (15.8 step 7), `sudo systemctl start countsfor-api`.

### 15.18 Rollback

- **Bad data from the daily update.** The update keeps one previous copy of each file it replaced: `frontend/data/courses.json.prev` and `backend/data/soc.json.prev`. First stop the next run from overwriting them: comment out the job in `/etc/cron.d/countsfor`. Then:

  ```bash
  cd /var/www/html/countsfor
  sudo -u countsfor sh -c 'cp frontend/data/courses.json.prev frontend/data/.courses.json.tmp && mv frontend/data/.courses.json.tmp frontend/data/courses.json'
  sudo -u countsfor sh -c 'gzip -9 -c frontend/data/courses.json > frontend/data/.courses.json.gz.tmp && mv frontend/data/.courses.json.gz.tmp frontend/data/courses.json.gz'
  # only if soc.json.prev exists and is from before the bad run:
  sudo -u countsfor sh -c 'cp backend/data/soc.json.prev backend/data/.soc.json.tmp && mv backend/data/.soc.json.tmp backend/data/soc.json'
  ```

  Each file is written under a temporary name and then renamed over the live one, as the daily update does, so Apache never serves a half-written file. The `.gz` must match `courses.json`, or browsers that accept gzip keep getting the bad catalog. Find the cause in `/var/log/countsfor/scrape.log`, fix it, and turn cron back on.
- **Bad code.** Deploy the previous commit: in `~/countsfor-src`, `git checkout <good commit>`, then the commands of 15.16, then `git checkout main` again once `main` is fixed. Migrations only add tables and columns, so older code runs on the newer database.
- **Bad database change.** Restore the last nightly dump (15.17).

### 15.19 Troubleshooting the server

| Symptom | Likely cause and fix |
|---|---|
| The site says "Could not reach the server"; `/api/...` answers 503 | Gunicorn is down. `systemctl status countsfor-api`, `journalctl -u countsfor-api -n 100`. Apache answers 503 for a few seconds while the API restarts. |
| `countsfor-api` does not start; the journal shows `ExecStartPre` failed | `bootstrap_db` failed: PostgreSQL is down (`systemctl status postgresql`), `DATABASE_URL` is wrong, or a restore left tables missing (`FATAL: bootstrap verification failed`). Run the bootstrap by hand (15.8 step 9) to see the message. |
| Journal: `SECRET_KEY is required when FLASK_ENV=production` or `DATABASE_URL is required` | `/etc/countsfor/countsfor.env` is missing the value, or is not readable by `countsfor` (`ls -l /etc/countsfor`: 640, `root:countsfor`). |
| Apache does not start or reload | `sudo apachectl configtest`. Usually the `CHANGE_ME` certificate names, or a module not enabled (`Invalid command 'ProxyPass'`, `RewriteEngine`, `Header`, `SSLEngine`). |
| The Ubuntu default page appears | `000-default` is still enabled: `sudo a2dissite 000-default default-ssl && sudo systemctl reload apache2`. |
| 403 on every page | Apache cannot read `frontend/`: `namei -l /var/www/html/countsfor/frontend/index.html` (every folder needs `x` for others, files need `r`). The deploy root must be 755. |
| Signed in, but signed out again on the next page load | Open the site as `https://countsfor.qatar.cmu.edu`, not over HTTP or by IP address: the session cookie is `Secure` because `FLASK_ENV=production` turns on `SESSION_COOKIE_SECURE` (it does not depend on `TRUST_PROXY`), and sign-in state is kept per origin. The pages sign in with the bearer token in browser storage (3.4), so a lost cookie alone does not sign anyone out: in the developer tools, check that `cf_auth_token` is in Local Storage or Session Storage for that origin, and that `/api/me` answers 200. |
| Google: "origin is not allowed" | Add the origin in the Google Cloud Console (15.14). |
| `pg_restore: error: relation "..." already exists` | The database was bootstrapped before the restore. Recreate it and restore again (15.8 step 5). |
| `pg_restore: error: unsupported version (...) in file header` | `pg_restore` is older than the `pg_dump` that made the file. Install the matching PostgreSQL version (15.8 step 2). |
| Inserts fail with "duplicate key value violates unique constraint ..._pkey" after the import | A sequence is behind its table. Run the check in 15.8 step 7 and `setval`. |
| The last run in the scrape log shows `GATE FAILED: ...` lines (followed by `Not published; ...` and `Update FAILED ... (exit 1)`) | The new data looked wrong (sections or courses dropped) and nothing was published. Compare with the staged files in `backend/var/staging/`. A real drop, for example at the start of a semester, can be accepted once by running with a lower `CF_MIN_SECTION_RATIO`: `sudo -u countsfor env CF_MIN_SECTION_RATIO=0.9 /var/www/html/countsfor/backend/scraper/run_scrape.sh --skip-tests`. |
| The last run shows `FAILED: scrape_soc; ...` (before `Update FAILED ... (exit 1)`) or timeouts | No outbound access to `enr-apps.as.cmu.edu`, or the SOC changed its pages. Test with `curl`; set `https_proxy` in `/etc/countsfor/scraper.env` if IT requires a proxy. |
| `Another update holds .../update.lock; exiting` (exit 75) | A run is still going (`pgrep -af update_data.py`). Wait for it. |
| No new lines in the scrape log | Cron ignored the file (a dot in its name, wrong owner or mode, no final newline) or the time zone is not what you think: `journalctl -u cron --since today`, `timedatectl`. |
| `Permission denied` writing `backend/data/soc.json` or `frontend/data/`, or `ERROR: cannot open the lock file .../update.lock` | A copy was made without `--chown=countsfor:countsfor`, or an update was run as root (`run_scrape.sh` now refuses that, but an older run or a direct `update_data.py` call can leave root-owned files). `sudo chown -R countsfor:countsfor /var/www/html/countsfor/frontend /var/www/html/countsfor/backend`. |
| `ERROR: run this as countsfor, the owner of .../backend/data` | `run_scrape.sh` was started as another user (often root, `sudo` without `-u countsfor`). Run it again with `sudo -u countsfor`. |
| The site shows an old catalog | `ls -l /var/www/html/countsfor/frontend/data/`: `courses.json` and `courses.json.gz` should have about the same time. If only the `.gz` is old, run `run_scrape.sh --no-scrape`. Then 19.8. |

### 15.20 Old hosting: GitHub Pages and Render (historical)

This is how CountsFor was hosted until the cutover. **It is still the live site on November 8, 2026.** Its configuration files were removed on the `cleanup` branch (they are in git history: `git show 49d22b2:render.yaml`, `git show 49d22b2:.github/workflows/pages.yml`).

**Frontend: GitHub Pages.** Repo settings: build type "workflow" (GitHub Actions), public, URL `https://adicmu.github.io/Countsfor-Summer-26/`, HTTPS enforced, no custom domain. `pages.yml` deployed on every push to `main`, copying only what the browser loads (`index.html`, `app.html`, `reset.html`, `js/`, `css/`, `assets/`, `landing/`, `data/courses.json`, `data/minor_courses.json`). The `gh-pages` branch (last commit August 9, 2026) is a leftover from an experiment and is not served.

**Backend: Render.** Web service `countsfor-summer-26` (`https://countsfor-summer-26.onrender.com`; the blueprint called it `countsfor-backend`), Python, plan `starter`, region Ohio, auto-deploying from `main` (confirmed November 3, 2026). Build `pip install -r requirements.txt`, pre-deploy `python -m backend.bootstrap_db`, start `SKIP_DB_BOOTSTRAP=1 gunicorn --workers=1 --bind 0.0.0.0:$PORT --timeout 120 --access-logfile - 'backend.app:create_app()'`, health check `/health`. Database `CountsFor_Summer_2026` (Postgres, plan `starter`, Ohio, host `dpg-d9osve67...`; an older host `dpg-d8nqt2...` was used earlier in 2026, so it was recreated at least once after a free trial expired and the data was lost). Environment: `FLASK_ENV=production`, `DATABASE_URL` from the database, a generated `SECRET_KEY`, `ALLOWED_EMAIL_DOMAIN`, `FRONTEND_ORIGIN`, `SEED_USERS_PATH`, `FRONTEND_RESET_BASE`, and dashboard-only values (`GOOGLE_CLIENT_ID`, `RESEND_API_KEY`, `MAIL_FROM`, `SMTP_*`). `keepalive.yml` pinged `/health` every 10 minutes during the day. Older notes mention a second service `countsfor-backend.onrender.com` and an Oregon database `countsfor-db`; check the dashboard and delete them if they still exist. Who pays for the Render account is not recorded.

**Supabase** was once considered instead of Render Postgres. Nothing in the code is Supabase specific and there is no sign it was ever used.

**`countsfor.qatar.cmu.edu` before this move:** older docs called it "the CMU-Q deployment" of the original open-cmuq CountsFor app. It is not known what it serves today; ask CMU-Q IT before you point it at the new server.

---

## 16. Testing

### 16.1 Commands

From the repo root, with the virtualenv active:

```bash
source .venv/bin/activate

# Both Python suites at once (pytest.ini lists backend/tests and backend/scraper/tests)
python -m pytest -q

# Backend API (in-memory SQLite, no network)
python -m pytest backend/tests -q

# Data pipeline, daily update, dev server and bump script (no network)
python -m pytest backend/scraper/tests -q

# Frontend (Node): tests/profile.test.js, data.test.js, minors.test.js and utils.test.js like
# tests/test.html, then the Node-only dash-guard.test.js, minors-file.test.js, app-views.test.js and catalog-data.test.js
node scripts/run-data-tests.js

# Frontend in the browser (profile, data, minors and utils tests)
python scripts/dev_server.py
# open http://localhost:8765/tests/test.html
```

### 16.2 Results on November 10, 2026 (`final-data` branch, after merging `minors-product`)

| Suite | Result |
|---|---|
| `python -m pytest backend/tests` | **176 passed, 6 failed** (the known failures below) |
| `python -m pytest backend/scraper/tests` | 179 passed |
| `node scripts/run-data-tests.js` | 180 passed (profile 51/51, data 64/64, minors 26/26, utils 5/5, dash guard 3/3, minors file 8/8, app views 17/17, catalog data 6/6) |

Known failures (all pre-date the admin page; the tests are stale, the code is the intended behaviour):

| Test | Why it fails |
|---|---|
| `test_auth.py::test_google_signin_marks_seeded_faculty_complete` | Relies on a seed mechanism the tests no longer wire up (`TestConfig.SEED_USERS_PATH = ""` and the directory skips default files under `TESTING`), so the user stays a student. |
| `test_auth.py::test_patch_me_accepts_consistent_advisor_minor` | Faculty roles may no longer have `advisor_scope`. |
| `test_auth.py::test_google_signin_syncs_directory_role_on_relogin` | Monkeypatches `backend.auth.load_merged_directory`, which no longer exists there. |
| `test_auth.py::test_register_faculty_from_seed` | Same seed issue. |
| `test_users.py::test_area_head_can_patch_user_role` | User management is now admin only (403). |
| `test_users.py::test_seeded_professor_skips_incomplete_on_login` | Same seed issue. |

Fixing these tests (by writing a temp seed file and setting `SEED_USERS_PATH` in a fixture, or by inserting `DirectoryEntry` rows) is a good first task for a new maintainer.

### 16.3 Test layout

- `backend/tests/conftest.py`: `app` fixture builds `create_app(TestConfig)`, drops and recreates all tables and runs migrations per test. Fixtures `student`, `professor`, `area_head`, `advisor`, `admin`. `login(client, user)` puts `uid` into the session directly.
- Google sign-in tests patch `id_token.verify_oauth2_token`.
- `backend/tests/test_admin.py` and `test_course_overrides.py` cover the admin page.
- `backend/tests/test_config.py`: cookie defaults, the production guards (no `SECRET_KEY` or `DATABASE_URL`), `TRUST_PROXY`, `SOC_JSON_PATH`, the SMTP relay check end to end, and that production never returns a reset token or reads `backend/.env`.
- `backend/tests/test_env_example.py`: `backend/.env.example`, `deploy/countsfor.env.example` and `deploy/scraper.env.example` list exactly the variables the code reads. Add a new variable to the templates or this test fails.
- `backend/tests/test_deploy_files.py`: the `deploy/` files agree with the repo (4.3).
- `backend/scraper/tests/` cover SOC parsing, title reconciliation, the coverage validator, every section of the overlay file (`test_mapping_overlay_sections.py`), the IS Intercultural and Global Inquiry list, the daily update (`test_update_data.py`), `scripts/dev_server.py` (`test_dev_server.py`), `scripts/bump_cf_build.py` and `frontend/data/minors.json` (`test_minors_file.py`: every course code comes from that minor's official file, with old Psychology numbers as their current numbers, no listed code is lost, the number ranges, rule numbers, unit totals and double counting sentences match the file, every category has a rule, no category lists a code twice, no minor carries a campus note, and the user-facing text has no dashes; Product Management against its archived catalog page: the page's sha256, title and catalog year, its category names, course lists and rules, its footnote and its double counting paragraph word for word, and no unit total, grade rule or note the page does not state). `backend/scraper/tests/` has no `__init__.py`; its `conftest.py` puts `backend/scraper/` on `sys.path`, which is why the scripts are imported as top-level modules there.
- `frontend/tests/test-runner.js` is a 48-line assertion helper; `scripts/run-data-tests.js` loads it with Node's `vm`, gives the tests an in-memory `localStorage` and `sessionStorage` (cleared before each test), waits for a test that returns a promise, and prints counts per file and in total. It exits non-zero if any test fails.
- `frontend/tests/minors.test.js` covers the minors logic of `js/data.js` with small fixtures: selection rules, category expansion, rule chips, the trees, progress (one course fills one category, unit floors, parts, caps, completed before in progress), the double counting limit text, shared courses, warnings and the major and minor tags. `frontend/tests/minors-file.test.js` (Node only) loads the real `data/minors.json` through `fetchMinors()` with a fake `fetch`, checks that the fallback `MINOR_LIST` and `MINOR_BLOCKED_MAJORS` match it, that every category has a known rule and builds, that Product Management builds from its catalog page (`minorSourceKind()`), that no minor carries a campus note, and that the text the app shows has no dashes. `backend/tests/test_auth.py` checks that `VALID_MINORS_FOR_PATCH` and `MAJOR_MINOR_COLLISION` match the file.
- `frontend/tests/dash-guard.test.js` (Node only) enforces rule 18.1: it scans string and template literals in `js/*.js`, the four HTML pages (`index.html`, `app.html`, `reset.html`, `landing/index.html`, including inline scripts and styles) and CSS `content:` values, skipping comments, and fails on any em or en dash (also written as an HTML entity) or a spaced hyphen between words. Its `ALLOWLIST` holds the strings that must keep a spaced hyphen, each with a reason; it is empty since the 2026-27 catalog bucket names (no requirement path has a spaced hyphen).
- `frontend/tests/catalog-data.test.js` (Node only) reads `data/courses.json` and checks it against `js/data.js` (14.10).
- `frontend/tests/app-views.test.js` (Node only) runs the real `js/app.js` in a `vm` context with a small fake DOM in which every `renderShell()` replaces `#leftBody`, as a browser does. It checks that going home (`renderLeftEmpty()`, `reset()`, the guest Student and Faculty switch) with a course or schedule open writes the home view into the `#leftBody` on screen, and that the course editor saves a row under its own code and refuses a number another row already has. Its minors tests run the real `renderTree()` with a small catalog and the real `minors.json`: a student's minor sections after the major, statuses saved in `cf_course_status`, a double counting warning, the Minors tab for faculty, Product Management with its catalog rule (and not open to BA majors), no campus note on any minor, a guest adding and removing minors across a view switch, one account save at a time, and a missing minors file.
- `frontend/tests/utils.test.js` covers `hasTypedText()` (the landing page check for typed text).

There is no CI that runs the tests. On the server, the daily update runs the two SOC parser test files before every scrape (14.2), which is why pytest is in `backend/requirements.txt`.

---

## 17. Git workflow

### 17.1 Remotes

| Repo | URL | Role |
|---|---|---|
| Main repo | `https://github.com/Adicmu/Countsfor-Summer-26.git` | Public, not a fork. GitHub Pages and Render are attached to its `main` until the cutover (15.15). A fresh clone calls it `origin`. |
| Partner fork | `https://github.com/Hindjendara/Countsfor-Summer-26.git` | Hind's public fork (remote `hind` in 5.2). Its own scrape workflow commits data there. |
| Hind's working repo | `https://github.com/Hindjendara/CMUQ-CountsFor.git` | The checkout where the `cleanup` branch was made uses this as `origin` and the main repo as `adi`, with pushing to `adi` disabled. Check `git remote -v` in any checkout before you push. |

### 17.2 Branches (November 2026)

| Branch | State |
|---|---|
| `main` | Production today (GitHub Pages and Render deploy it). Old layout (`js/`, `data/` at the root), Render and GitHub Actions files. Includes the admin page, course editor and sign-in analytics (November 3, 2026). The scrape bot still commits to it daily. |
| `cleanup` | The work this README describes: dead code removal, the parser and data fixes, the Qatar overlay sections, the `frontend/` and `backend/` layout, environment-only configuration, the cron scraper, the `deploy/` files and the removal of the Render, GitHub Actions and Pages files. Not pushed yet and not merged. Merge it at the cutover (15.15 step 3), not before. |
| `feat/admin-page` | Merged into `main` on November 3, 2026. Safe to delete. |
| `feature/password-reset-email` | Merged (PR #13). Safe to delete. |
| `feat/login-landing-guest-flags`, `feat/multiple-minors` | Old branches with open PRs #10 and #12 (June 2026). Each has one commit not on `main`, but guest mode, the landing page and multiple minors already exist on `main` in reworked form. Review, then close the PRs and delete the branches. |
| `feat/ui-ux-overhaul`, `landing-copy-and-signin-fixes`, `roster-and-role-views-backup`, `worktree-role-aware-onboarding` | Local-only branches on the original laptop. |
| `gh-pages` | Stale, unused (15.20). |
| `hind/main` | Fork main with its own SOC data commits. |
| `hind/cursor/adicmu-pages-deploy` | Old experiment. |

### 17.3 How changes get merged

Both styles appear in history. Thirteen pull requests exist on `Adicmu/Countsfor-Summer-26` (11 merged, 2 still open as of November 2026, including PR #9 from the fork `Hindjendara:main`), but since July most work was committed or merged directly into `main`. Recommended going forward:

1. Branch from the main repo's `main`: `git checkout -b feat/short-name origin/main`.
2. Commit, push, open a PR on `Adicmu/Countsfor-Summer-26`.
3. Before merging, `git fetch origin` and rebase or merge. Until the cutover the bot keeps committing data to `main`; after it, nothing commits data to git (the server keeps its own, 14.8), so conflicts in the data files stop.
4. Never resolve conflicts inside `frontend/data/courses.json` or `backend/data/soc.json` by hand; take one side whole (`git checkout --theirs frontend/data/courses.json`) and rebuild with `python backend/scraper/update_data.py --no-scrape` if needed.
5. Deploy the merged `main` to the server (15.16). Merging does not deploy anything by itself any more.

### 17.4 Commit style

From `git log`: one line, imperative, sentence case, describing the change, with a body for anything that needs explaining. Examples: `Add an admin page with a course catalog editor.`, `Restructure the repo into frontend/ and backend/`, `Add a standalone cron scraper that updates the server in place`. A few older commits use a `feat:` or `fix(dev):` prefix; the recent convention is plain sentences, and recent commits drop the final period. Bot commits on `main`: `Update SOC data (YYYY-MM-DD)`.

---

## 18. Project rules and conventions

1. **No em dashes or en dashes in any user-facing text.** This covers UI strings, toasts, titles, `title=` and `aria-label` attributes, placeholder options, and API `message` strings. Use a colon, comma or period instead. Use "to" for ranges ("9:00 AM to 10:20 AM"). Middle dots (·) are fine. Hyphens inside words and codes stay (sign-in, CMU-Q, Non-Technical, 15-213). Course titles and descriptions from the Schedule of Classes are shown exactly as the SOC has them. `node scripts/run-data-tests.js` fails if a dash appears (16.3).
2. **Empty values:** show "None" or "Not listed", never a dash.
3. **Zero dependencies, no build step for the frontend.** No npm packages, no bundler, no framework, no TypeScript. Anything you add must work by opening the file in a browser.
4. **Roles are enforced on the backend.** Every route that changes or reveals protected data needs `@require_role_group(...)` or `@require_role(...)`. Hiding a button is never enough.
5. **Check role groups, not titles**, unless a specific title matters (students only).
6. **Escape everything** interpolated into HTML with `esc()`. This includes course names and descriptions from the scrape and anything a user typed.
7. **Backend errors** use `{"error": "<snake_case_code>", "message": "<plain sentence>"}`.
8. **Audit admin actions**: any route that changes roles, directory, flags or the catalog should call `record_event()` before its commit.
9. **Script order** in `app.html` is `utils, data, profile, api, app`. Bumping the `?v=` tags (`scripts/bump_cf_build.py`) when you change them is optional on the server, where Apache makes browsers revalidate.
10. **Do not hand-edit `frontend/data/courses.json`** for content fixes; use overlays or the admin editor.
11. **Run backend commands from the repo root** (`python -m backend.<module>`).
12. **Keep `DEPARTMENT_LIST` (`js/profile.js`) and `VALID_DEPARTMENTS` (`backend/models.py`) identical**, and keep `FLAG_REASONS` (`js/app.js`) in sync with `VALID_REASON_CODES` (`backend/flags.py`).
13. **Never put secrets in the repo.** Production secrets live only in `/etc/countsfor/` on the server (15.6); `backend/.env` is for local values and is gitignored.
14. **Follow the data rules in 14.1**: the SOC is the rule, Qatar information goes only in `mapping_overlays.json`, renumberings are never inferred, the sheet only adds, and the pipeline never deletes catalog rows.

---

## 19. How-to recipes

### 19.1 Add a new major (for example GS)

Requirement data is the hard part. The scrape does not produce requirement mappings; they come from the upstream catalog plus overlays.

1. Get the authoritative requirement list and use its headings as requirement path names (`BS in <Major>---Section---Bucket` for degree rows, `GenEd---...` for general education; 14.10). AI was added this way in November 2026.
2. Add mappings: either an overlay in `backend/data/mapping_overlays.json` per course (`"requirements": {"AI": [...]}`) and run `python backend/scraper/apply_mapping_overlays.py`, or use the admin course editor (backend already accepts `AI` and `GS` in `REQUIREMENT_PROGRAMS`).
3. Frontend:
   - `js/data.js`: add the code to `MAJOR_ORDER`; check `MAJOR_META` and `MAJOR_BRAND`; add a `LABEL_OVERRIDES` entry for the degree root and a `setRule(...)` line for every bucket name, in catalog order. `annotateMultiProgram()` and `splitTreeSections()` need no change.
   - `js/profile.js`: set `dataPending: false` in `PROGRAM_GROUPS`.
   - `css/styles.css`: add `--major-<code>` tokens next to `--major-cs` (line 26) for light and dark themes, and the per-major classes the tree uses (copy the ones for `ai`: `.tr-leaf-tag-ai`, `.tr-dc-tag-ai`, `.role-badge.rb-ai`, `.cc-cf-ai`, `.cc-cf-col-ai`, `.typeahead-cat-major-ai`, `.major-tab[data-major="AI"]`).
4. Backend: `VALID_PROGRAMS_FOR_PATCH` (`auth.py`), `REQUIREMENT_PROGRAMS` (`course_overrides.py`) and `_VALID_PROGRAMS` (`search_analytics.py`) already include `AI` and `GS`. For a brand new code, add it to all three.
5. If students of the new major may not take some minors, add the major to those minors' `blocked_majors` in `frontend/data/minors.json`, to `MAJOR_MINOR_COLLISION` (`auth.py`) and to `MINOR_BLOCKED_MAJORS` (`profile.js`); `backend/tests/test_auth.py` and `frontend/tests/minors-file.test.js` fail until all three agree.
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
5. Deploy (15.16). The `systemctl restart countsfor-api` runs the migration; check `journalctl -u countsfor-api -n 30` for your log line.

### 19.5 Edit a course via the admin page

Sign in as admin, open **Admin**, tab **Courses**, search the course, click it, change fields or "counts for" entries, **Save**. The change is visible to everyone on their next page load (overrides are fetched on every load with `no-cache`). To undo: open it again and **Revert** (scraped course) or **Archive** (added course).

### 19.6 Rotate secrets

Production secrets live in `/etc/countsfor/countsfor.env` on the server. Edit it with `sudo editor /etc/countsfor/countsfor.env`, then `sudo systemctl restart countsfor-api`.

| Secret | Where | How | Side effect |
|---|---|---|---|
| `SECRET_KEY` | `/etc/countsfor/countsfor.env` | Replace with a new random value (`python3 -c "import secrets; print(secrets.token_urlsafe(48))"`), restart the API | Everyone is signed out (cookies and bearer tokens are both signed with it). Reset links stay valid (they are DB hashes). |
| Database | local PostgreSQL | No password to rotate: `countsfor` connects by peer authentication over the Unix socket. If you switch to a TCP URL with a password, change it with `ALTER ROLE countsfor PASSWORD '...'` and update `DATABASE_URL` | Brief downtime |
| SMTP password | The sending account (for Gmail: App passwords) | Create a new one, update `SMTP_PASS`, restart, revoke the old one | None |
| `RESEND_API_KEY` | resend.com | Create a new key, update the env file, restart, delete the old key | None |
| Google OAuth | Google Cloud Console | The client ID is public; there is no client secret in use. If you must replace the client, update `GOOGLE_CLIENT_ID` in the env file and the `cf-google-client-id` meta in both HTML files together, and deploy | Google sign-in breaks until both match |
| Local `backend/.env` | your laptop | Never commit it (gitignored) | None |

Until the cutover the old API reads its secrets from the Render dashboard (web service, Environment).

### 19.7 Give someone admin (production)

**Permanent admins** (the project owners): add them to `backend/data/directory_admins.json` (email, name, `role: "admin"`, `primary_program`, `department`), merge to `main` and deploy it (15.16; before the cutover Render redeploys `main` by itself), then have them sign out and in. As of November 2026 it lists `avivek@andrew.cmu.edu`. Remove people from this file when they leave.

**Anyone else:**

1. Sign in as an existing admin.
2. Admin page, **Faculty access** tab, "Add or edit people" (opens the Directory panel). Enter name and andrew email, role **Admin**, department. Save. This writes a `directory_entries` row (audited as `directory.add`).
3. Ask the person to sign out and sign in again. Their role is applied at sign-in.

Do not use the Users tab alone (reverts on next sign-in) and do not use `ADMIN_EMAILS` (ignored). If no admin exists at all, insert a `directory_entries` row with role `admin` directly in the database (on the server: `sudo -u countsfor psql -d countsfor`; on Render before the cutover: `psql` with the External Database URL):

```sql
INSERT INTO directory_entries (email, name, role, department, primary_program, created_at, updated_at)
VALUES ('someone@andrew.cmu.edu', 'Someone', 'admin', 'Dean''s Office', 'AS', NOW(), NOW());
```

To remove admin: Directory panel, revoke or change the role; they become student or faculty at their next sign-in. Their existing 30-day token still works until then, but the role on their user row is not recomputed until they sign in again, so also change it in the Users tab for an immediate effect.

### 19.8 Debug "the site shows old data"

1. Admin page, Overview: `course_data.last_scrape` is the date in the server's `backend/data/soc.json`. Is it from today or yesterday?
2. On the server, `tail -n 50 /var/log/countsfor/scrape.log`: did the last daily update end with `Update done ... (exit 0)`? A `GATE FAILED` or `FAILED` line means nothing was published (15.19).
3. `ls -l /var/www/html/countsfor/frontend/data/`: when did `courses.json` and `courses.json.gz` last change? They should change together. An unchanged catalog is not rewritten (14.2), so an old date can be correct when nothing changed in the SOC.
4. `curl -sI -H 'Accept-Encoding: gzip' https://countsfor.qatar.cmu.edu/data/courses.json`: `Last-Modified` should match the time of `courses.json.gz` on disk.
5. Hard refresh (Cmd+Shift+R) or a private window.
6. If a single course is wrong but the scrape is fresh, check for an admin override (Admin, Courses, filter "edited") or a mapping overlay (14.5).
7. Locally: the repo copies of the data are older than the server's (14.8); feature branches carry the data from when they were cut.

Before the cutover the old site's data comes from the bot commits on `main` (`git log origin/main --grep "Update SOC" -3`), and `https://adicmu.github.io/Countsfor-Summer-26/app.html` carries the `cf-build` tag.

---

## 20. Troubleshooting and FAQ

**"Could not reach the server" locally.**
The API is not running, or not where `scripts/dev_server.py` forwards to (`--backend`, default `http://127.0.0.1:5050`), or the site is served by something that does not proxy `/api` (a plain `http.server` answers 404). See 5.6. With `cf_backend_override` set, also check that the backend's `FRONTEND_ORIGIN` lists the page's origin.

**`python app.py` fails with "attempted relative import".**
Run from the repo root: `python -m backend.app`.

**Backend crashes at import: "DATABASE_URL is required when FLASK_ENV=production" (or `SECRET_KEY`).**
Locally: you set `FLASK_ENV=production`; unset it. On the server: the env file is missing the value or is not readable (15.19).

**Port 5000 returns 403.**
macOS AirPlay Receiver. Use 5050.

**Different databases depending on how I start the server.**
Fixed in `config.py`: relative SQLite URLs are anchored to `backend/instance/`. Use an absolute URL (`sqlite:////full/path.db`) if you want a database elsewhere.

**I changed someone's role in the Users tab and it reverted.**
Expected; see 7.1. Use the directory.

**A faculty member gets the student view.**
Their email is not in the directory (DB or `backend/data/faculty_directory.json`), or it is there with a different spelling (for example `hbouamor@` vs `houda@`). Add them in Faculty access and have them sign in again.

**Sign-in works but the user is asked to onboard every time.**
`profile_completed` is false: students need `primary_program`; faculty and admin need `department` and `primary_program`. Check `/api/me`.

**"Password reset by email isn't available yet."**
No email provider configured on the server (6.1). Configure Resend or SMTP in `/etc/countsfor/countsfor.env` (15.6) and restart the API, or use the Google recovery path.

**Google button does nothing.**
The Google Identity Services script failed to load, or the origin is not in the OAuth client's authorized JavaScript origins, or `GOOGLE_CLIENT_ID` on the server does not match the meta tag.

**`/health` returns 503.**
Missing tables (the bootstrap did not run or failed) or the database is unreachable. On the server: `journalctl -u countsfor-api -n 50` for `FATAL` lines, `systemctl status postgresql`, and 15.19.

**Production crashes with "column ... does not exist" after a deploy.**
A model gained a column without a `migrate.py` step (11.2). Add the step and deploy again; the restart runs it.

**Admin page Courses tab shows no edits.**
`GET /api/courses/overrides` failed or timed out (10 s); the console shows "Course edits unavailable".

**`App` is undefined in the console.**
Use `App` directly or `typeof App`; it is a `const`, not `window.App`.

**Saved courses or flags disappear after signing in.**
`_syncLocalToServer()` uploads local items once (`cf_synced`). If the upload failed midway, flags stay local. Clear `cf_synced` to retry.

**The daily update did not publish.**
Read the end of `/var/log/countsfor/scrape.log` on the server; 15.19 lists the usual causes.

**Tests fail with role assertions.**
See the known failures in 16.2.

**My page changes do not show on the live site.**
Merging does not deploy anything: copy the code to the server (15.16). Apache makes browsers revalidate every file, so a normal reload shows the new version. (Before the cutover, GitHub Pages deploys `main` and Render auto-deploys it.)

---

## 21. Open issues and roadmap

### 21.1 Security issues (fix first)

1. **Faculty can make themselves admin.** All `/api/directory/entries` write routes accept `role: "admin"` from any faculty user (verified locally: a professor upserted their own entry to admin and was admin after signing in again). Restrict admin grants (and probably all directory writes) to `ROLE_GROUP_ADMIN`.
2. Students can read `admin_notes` on non-dismissed flags (`GET /api/flags`). Decide whether notes should be private.
3. **The daily scraper can rewrite the code it runs next to.** On the server `countsfor` owns every deployed file (15.3, 15.4): the API code, `backend/.venv` and the served JS, and the same user runs the scraper, from cron, with no sandbox, on HTML fetched from the SOC servlet. The API is sandboxed (`ProtectSystem=strict`); the scraper is not. A bug exploited in the scrape could change the API code (run on the next restart) or the served JS (every visitor, and the sign-in tokens in their browser storage). The scraper only needs to write `backend/data/`, `frontend/data/` and `backend/var/`. Two ways to close this, not done because each changes the deploy and must be tested on the server: deploy the code as `root:countsfor` (folders 750, files 640, `frontend/` world-readable, `pip` run as root) and give `countsfor` write access only to those three folders; or run the update from a systemd service and timer with `ProtectSystem=strict` and `ReadWritePaths=` limited to them, in place of the cron line.

### 21.2 Operational and data issues

1. **The move to the CMU-Q server is not done.** The live site still runs on GitHub Pages and Render from `main`, and the old scrape workflow still commits to `main` with the old parser. Follow 15.15.
2. **Saved data under the old Psychology numbers.** The old Psychology numbers were removed on 2026-11-09 after their mappings moved to the current numbers. Wishlist items, flags, schedule plan items, search counts and admin course edits saved under them in production must be moved with 15.8 step 8 when the database is imported.
3. **6 backend tests fail** (16.2). The tests are stale, not the code. No CI runs any tests.
4. Role edits in the Users tab do not persist (7.1). Either make `PATCH /api/users` also write a directory entry, or show a warning in the UI.
5. Whether production has an email provider for password resets is not known (on Render the values were set only in the dashboard). Decide at the cutover (15.6).
6. The deploy files (15) have not been run on the real server yet; the certificate names, the time zone and outbound network access are unknown until then.
7. **A failed daily update is silent.** `MAILTO` in `deploy/countsfor.cron` is empty, so the failure line the job prints goes nowhere and the log is the only record. Decide who should be told, have IT confirm the server can send mail (a mailer such as `postfix` or `msmtp-mta` through the campus relay), then set `MAILTO` (15.12). Until then, check the last scrape date on Admin, Overview.
8. Render naming and ownership are unclear until the old hosting is retired (15.20): who pays, and whether the stray `countsfor-backend` service and `countsfor-db` database still exist.
9. M25 in `backend/data/soc.json` was written by the old scraper, which read every row as 10 cells, so the summer Session column shifted every field after the title (units hold "summer two" or "qatar summer", the section cell holds the units, and later courses sit inside earlier courses' `sections`). M25 is no longer on the SOC form, so a new scrape cannot repair it, and it is kept as it is (90 courses, 827 rows). The pipeline ignores such data instead of deleting it: reconcile and the coverage check skip a course whose units cell is not units and a section whose section cell is not a section id (`soc_parse.usable_sections`, 14.3 step 3). All 90 M25 courses and their 827 rows are ignored; no semester on the form has any. Effects: 79-234, 17-403 and 67-313 no longer get `offered_qatar` from their bad M25 rows, 14 rows lose `offered_pitts` that only bad summer rows gave, and 45-920 keeps its catalog name "Data Science for Finance This Section Cancelled" because its only SOC title is in M25. 85-372 and 85-822 also keep their catalog names (their only SOC title is "tba This Section Cancelled").
10. **Open questions from the November 8, 2026 catalog regeneration** (6,704 to 6,795 rows; 91 rows added for courses that only the correctly parsed M26 lists):
    - The 8 SOC-created rows that `soc.json` no longer lists (04-801, 54-382, 54-757, 54-882, 57-453, 57-579, 57-753, 62-318) keep `offered: ["F26"]` from the base catalog, because reconcile leaves `offered` unchanged on a row that is not in `soc.json` at all. Whether they should keep F26 is open, since the SOC is the rule and F26 is still on the form (04-801 is in none of the checked `soc.json` versions for F26).
    - 144 SOC-created rows have an empty `offered` (143 because their only semester is now cancelled-only, and 57-979 because F26 no longer lists it and F25 lists it cancelled-only); 12 SOC-created rows lost an F26 that the current F26 does not list (45-706, 54-389, 54-653, 54-889, 57-391, 57-584, 57-787, 57-788, 57-884, 57-979, 57-982, 66-400).
    - 23 codes got a `previous_course_name` for the first time because their SOC title shares no words with the old name; reconcile prints them under `REVIEW` and keeps their mappings: 12-711, 15-435, 15-635, 36-690, 36-712, 36-795, 42-663, 45-986, 47-900, 48-516, 48-616, 48-648, 51-907, 54-152, 54-195, 54-653, 76-802, 79-329, 82-196, 90-874, 94-784, 94-816, 95-877. Some look like renames of the same course rather than reused numbers (54-152 and 54-653 "Stagecraft" to "Stage and Shop Craft"); check them before relying on the mappings.
11. The Psychology questions (85-426, 85-102 and 85-421) are in 14.6.

### 21.3 Code hygiene

- The no-dash rule (section 18) covers user-facing text and text that comes from data: requirement bucket names have no dash punctuation (`frontend/tests/catalog-data.test.js` checks the catalog), and meeting times show "to" instead of a hyphen. `frontend/tests/dash-guard.test.js` checks it on every run. Meeting strings that are not in the `DAYS hh:mmAM-hh:mmPM` form, including scraper junk such as "Pittsburgh, Pennsylvania" (21.2 item 9), are still shown as stored.
- Dead code: unused `users.reset_token_hash` and `reset_token_expires` columns (kept on purpose: dropping them is a schema change). The rest of the dead code found in the November 2026 audit was removed (see `git log` on the `cleanup` branch).
- The 30 MB catalog download makes the first load slow on a slow connection (UX review items 4 to 12); on the server Apache sends it gzipped (about 1.2 MB).
- `cf_flags` local queue has no cap.

### 21.4 Product roadmap (from docs and code comments)

- GS major: waiting on an authoritative requirement spec (`MAJOR_ORDER` in `frontend/js/data.js`).
- Course statuses (8.10) on the account: today they live in the browser only (`cf_course_status`), so they do not follow a student to another device or to a new site address. A table such as `course_statuses (user_id, course_code, status)` with `GET` and `PUT /api/me/course-statuses`, and a one-time upload of the local copy at sign-in (like `_syncLocalToServer()`), would add server sync.
- Minors: the open questions of the minors review (double counting where the Scotty page and the audit differ, codes not in the catalog) are noted in each minor's "About this minor"; settle them with the advisors and update `frontend/data/minors.json`.
- Server-side storage of a user's own schedule plans (today they are browser-only, which also means they do not survive a change of site address, 15.15).
- UX review (`docs/archive/UX_REVIEW_2026-07-17.md`): dark theme parity, copy consistency, accessibility (keyboard navigation of the tree, ARIA for typeahead), slimmer boot payload.
- Not done yet: CMU Andrew SSO (Shibboleth, needs IT; easier now that the site is on a CMU-Q server), ML-based offering prediction (current `predictOffering()` is rule-based), deduplication of `courses.json`.
- Analytics Phase 2 (feature usage counts, onboarding funnel) and Phase 3 (weekly digest, semester report): proposals in `docs/analytics-plan/`. Phase 1 (section 13) is live.

---

## 22. Known stale docs

On November 3, 2026 the repo was cleaned: the old deploy and setup guides (`docs/RENDER_*.md`, `DEPLOY_*.md`, `SETUP_AUTH.md`, `SUPABASE_HOSTING.md`, `BACKEND_API_CONTRACT.md`), AI session notes, about 90 MB of screenshots, an old React bundle, unused JSON scaffolds, a session log and dead code were deleted, and planning documents were moved to `docs/archive/`. The Render, GitHub Actions and GitHub Pages files followed on the `cleanup` branch. Everything still useful from them is in this README. They remain in git history (`git log --all -- docs/RENDER_UPGRADE.md`, `git show 49d22b2:render.yaml`).

What is still out of date:

| Document | What is wrong |
|---|---|
| `docs/archive/*` | History only. Plans, proposals and design specs from 2026; many details no longer match the code, and they mention GitHub Pages, Render and `Testing/`. |
| `docs/landing-DESIGN_NOTES.md` | Refers to `docs/scotty-head.png`; the image is `frontend/assets/img/scotty-head.png`. |
| `backend/data/mapping_overlays.json`, its `description` field | Says `data/apply_mapping_overlays.py`; the script is `backend/scraper/apply_mapping_overlays.py`. |
| `backend/.env` (local, not in git) | An old copy may say an empty `SMTP_HOST` returns the reset link inline; that only happens with `EXPOSE_RESET_TOKEN=1`. Compare with `backend/.env.example`. |
| Code comments | `backend/users.py` mentions area heads managing users; `backend/models.py` says there is no password column. |
| `CONTEXT.md` | Not in git at all (gitignored). Successors will not have it. |

---

## 23. Handover checklist

No secret values belong in this file or in git. Hand secrets over in person or through a password manager.

### 23.1 Accounts and access the successor needs

- [ ] **CMU-Q server**: an account with `sudo` on the Ubuntu server, and the name of the IT contact who manages it, its DNS (`countsfor.qatar.cmu.edu`), its certificate (renewal date) and its backups.
- [ ] **Server secrets**: the filled-in `/etc/countsfor/countsfor.env` (`SECRET_KEY`, email credentials) in a password manager.
- [ ] **GitHub**: admin (or at least write) access to `Adicmu/Countsfor-Summer-26`. Consider transferring the repo to a CMU-Q organization so it does not depend on a personal account.
- [ ] **GitHub fork and working repo**: decide what happens to `Hindjendara/Countsfor-Summer-26` and `Hindjendara/CMUQ-CountsFor`. Once the server's cron scrape runs, the fork's scrape is not needed.
- [ ] **Render (until it is retired)**: membership on the Render account or team that owns the `countsfor-summer-26` web service and the `CountsFor_Summer_2026` database, including billing (paid `starter` plans). Record who pays, and delete both after the cutover (15.15 step 9).
- [ ] **Database**: `sudo -u countsfor psql -d countsfor` on the server, and the nightly dumps (15.17) copied somewhere off the server. Keep the final Render dump.
- [ ] **Google Cloud**: owner or editor on the project that holds the OAuth client `378923997481-...` (to edit authorized origins and the consent screen).
- [ ] **Email**: the Resend account, the Gmail account (with app password) or the campus SMTP relay used for reset emails, if configured. If none is configured, decide whether to set one up.
- [ ] **At least one production admin account** belonging to a staff member (not a student who will graduate), created through the directory (19.7).
- [ ] **Faculty directory owner**: someone who decides who gets faculty access and refreshes `backend/data/faculty_directory.json`.
- [ ] **Data owner**: someone with authority to answer the open data questions (14.6, 21.2 item 10) and to confirm possible renumberings.

### 23.2 Knowledge transfer

- [ ] Walk the successor through sections 5, 7, 11.2, 14, 15 and 21.1 of this manual.
- [ ] Hand over `CONTEXT.md` and any other gitignored notes from the original laptop, or commit what is still relevant.
- [ ] After the first real deploy, correct section 15 wherever the server differed (certificate names, time zone, proxy), and record the date.
- [ ] Record in 6.1 whether an email provider is configured in production.

### 23.3 Before the owner leaves

- [ ] Finish the cutover (15.15) and retire GitHub Pages and Render.
- [ ] Fix the security issues in 21.1.
- [ ] Confirm the server's daily update publishes successfully (`tail -n 50 /var/log/countsfor/scrape.log`) and that the nightly database dump runs and is copied off the server.
- [ ] Move saved data off the old Psychology numbers when the database is imported (15.8 step 8).
- [x] Merge and deploy `feat/admin-page` and the sign-in analytics (done November 3, 2026).
- [ ] Rotate `SECRET_KEY` and any email credentials, then give the new values only to the successor.
- [ ] Remove the original owner's personal admin entry from `backend/data/directory_admins.json` and the directory if appropriate.
