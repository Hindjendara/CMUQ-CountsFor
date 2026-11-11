# CountsFor

A role-aware curriculum explorer for Carnegie Mellon University in Qatar. Students, faculty and advisors look up any course and see exactly which major, minor and Gen Ed requirements it counts for, plan schedules, save courses and flag catalog mistakes. Admins edit the catalog and see usage.

**Real home:** `https://countsfor.qatar.cmu.edu` on a CMU-Q Ubuntu server ([section 15](#15-deploy-to-the-cmu-q-server)), not live yet. **Production until then:** [adicmu.github.io/Countsfor-Summer-26](https://adicmu.github.io/Countsfor-Summer-26/) (GitHub Pages, built from `main`), whose API on Render (`https://countsfor-summer-26.onrender.com`) answered 503 "This service has been suspended by its owner" on November 11, 2026, so nothing there that needs the server worked that day. **Test copy** of the `cleanup` frontend, guest only: [hindjendara.github.io/CMUQ-CountsFor](https://hindjendara.github.io/CMUQ-CountsFor/) ([15.21](#1521-test-copy-on-github-pages)). **Repos:** [Adicmu/Countsfor-Summer-26](https://github.com/Adicmu/Countsfor-Summer-26) (`main`) and [Hindjendara/CMUQ-CountsFor](https://github.com/Hindjendara/CMUQ-CountsFor) (`cleanup` and the test copy, [17.1](#171-remotes)).

**Quick start:** see [section 5](#5-local-setup-from-a-fresh-mac). In short, from the repo root: create a virtualenv in `.venv` and `pip install -r backend/requirements.txt`, copy `backend/.env.example` to `backend/.env`, run the API with `python -m backend.app` (port 5050), serve the site with `python scripts/dev_server.py` (port 8765; it serves `frontend/` and proxies `/api` to the API), and open `http://localhost:8765/`.

## About this README

This README is the project's complete maintainer manual. It was written so that a new student developer can take over CountsFor alone, with no access to the original authors. Every statement was checked against the code on the `cleanup` branch in November 2026 unless it is explicitly marked as uncertain. If anything else in the repo disagrees with this file, trust this file and the code, and then fix whichever is wrong.

> **Where things stand (November 11, 2026).** The `cleanup` branch moves CountsFor from GitHub Pages and Render to a CMU-Q server: the repo is split into `frontend/` (the static site) and `backend/` (the Flask API, the scraper and private data), every setting comes from the environment, the site calls the API by relative path, a system cron job replaces the GitHub Actions scrape, and `deploy/` holds the server files (systemd, Apache, cron, logrotate, environment templates). The branch is **not merged into `main` yet**; it is on Hind's working repo, `Hindjendara/CMUQ-CountsFor` (pushed November 10, 2026; newer commits were made after that push, 15.4). Until someone carries out the cutover in [15.15](#1515-cutover-from-github-pages-and-render), production is the old site from `main`, with the old layout: its pages still load on GitHub Pages, but on November 11, 2026 its API on Render answered 503 "This service has been suspended by its owner", so signing in and everything else that needs the server failed there. A guest-only test copy of the `cleanup` frontend runs on GitHub Pages ([15.21](#1521-test-copy-on-github-pages)); the CMU-Q server is CountsFor's real home. Sections that describe the old hosting say so.

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
    - [15.21 Test copy on GitHub Pages](#1521-test-copy-on-github-pages)
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
| **Semester codes** | `F26` = Fall 2026, `S26` = Spring 2026, `M26` = Summer 2026, `N26` = Fall mini (see `SEASON_NAME` in `js/data.js`). Backend validates with regex `^[FSMN]\d{2}$`. No list of semesters is kept in code: the semester picker lists exactly the semesters the SOC search form lists (`soc_semesters` in `courses.json`, written by the daily update), so a new one (Spring 2027, a summer) appears the day the daily update scrapes it, and one that leaves the SOC goes (8.3). |
| **Course code** | Always normalized to `NN-NNN`, e.g. `15-122`. `normalizeCourseCode()` in `js/data.js` and `_normalize_code()` in `backend/course_overrides.py` accept `15122`, `15122.0`, `15-122`. |
| **Requirement path** | A string of segments joined by three hyphens, e.g. `GenEd---Foundations---Contextual Thinking`. The frontend splits on `---` to build the requirement tree. The bucket names are the 2026-27 catalog's (14.10). |
| **`type` on a requirement** | Boolean. `true` means GenEd, `false` means a major (core) requirement. |
| **GenEd** | General Education. University core requirements every student in a major must satisfy (humanities, cultural analysis and so on). Every major keeps it under the `GenEd` root, and `splitTreeSections()` treats that root as GenEd. |
| **Majors** | `CS` Computer Science, `IS` Information Systems, `BA` Business Administration, `BS` Biological Sciences, `AI` Artificial Intelligence. Live in `MAJOR_ORDER`. Scaffolded but not live: `GS`. |
| **`AS`** | "Arts & Sciences". Not a major. A grouping used as the `primary_program` of cross-program faculty and as the default program for directory entries (`DEFAULT_DIRECTORY_PROGRAM = "AS"`). Students can never pick it. |
| **Minors** | The 17 minors of `frontend/data/minors.json`, built from the official files in `backend/data/minors/` and, for `product` (Product Management, which has no official file), from its 2026-27 catalog page (4.4): arabic, biology, business, business_analytics, comp_bio, cs, economics, finance, history, math, neuroscience, product, writing, psychology, sociology, self_defined, tech_entre. The same codes are in `VALID_MINORS_FOR_PATCH` (`backend/auth.py`) and in the fallback `MINOR_LIST` (`js/profile.js`). Some majors may not declare some minors (`blocked_majors` in the file, `MAJOR_MINOR_COLLISION` in `auth.py`, `MINOR_BLOCKED_MAJORS` in `profile.js`): CS not `cs`, BS not `biology`, BA not `business`, `business_analytics`, `finance` or `product`. A student's minors show in their requirement tree, and every minor in the Minors tab (8.10). |
| **Role** | Exact title stored on the user: `student`, `professor`, `area_head`, `associate_area_head`, `advisor`, `admin`. |
| **Role group** | Permission bucket computed by `User.role_group()`: `student`, `faculty` (the four faculty titles), `admin`. **All permission checks use role groups**, except a few student-only routes that use the exact role. |
| **Directory** | The list of people who get faculty or admin access. Two layers: a JSON seed file (static) plus the `directory_entries` table (editable, wins on conflict). Your role is recomputed from the directory **on every sign-in**. |
| **Flag** | A data-problem report a faculty member files against a course (reason codes in `backend/flags.py`). Statuses: `pending`, `reviewed`, `resolved`, `dismissed`. |
| **Wishlist / Saved** | A student's saved courses with optional notes (`wishlist_items`). The UI calls it "Saved". |
| **Plan / schedule plan** | A weekly schedule built from course offerings: a lecture planned with one of its sections (a recitation or lab), or a section on its own (8.11). Stored in browser localStorage; the server only stores shared copies. |
| **Override** | An admin edit stored in the database and applied in the browser on top of the served files: a course edit (`course_overrides`: the changed fields, and what the course counts for as a change per program or minor, 12.2) or a minor setting (`minor_overrides`: unit total, double counting limits, a note for students, 12.6). |
| **Mapping overlay** | A manual complement to the SOC scrape in `backend/data/mapping_overlays.json` (additive mappings, rule buckets, mapping removals, Qatar visibility), applied to the catalog file by the scrape pipeline. |
| **Rule bucket** | A requirement bucket the catalog defines by a rule ("any SCS course, 200-level or above, at least 9 units") instead of a list. The daily pipeline adds every course that meets the rule, as a row tagged `"source": "rule"` (14.5.1). |
| **Demo mode / guest mode** | Running the frontend without a signed-in user. Everything is local to the browser. |
| **The server** | The CMU-Q Ubuntu 24.04 machine for `countsfor.qatar.cmu.edu`: Apache serves `frontend/`, Gunicorn runs the API, PostgreSQL holds the database, cron runs the scraper (section 15). |
| **Deploy root** | `/var/www/html/countsfor` on the server, holding `frontend/` and `backend/`. `CF_DEPLOY_ROOT` in the daily update. |
| **Daily update** | `backend/scraper/update_data.py`, run by cron through `run_scrape.sh`: scrape, rebuild, check and publish the catalog in place (14.2). |
| **`countsfor`** | The system user that owns the deploy root, runs the API and the daily update, and owns the PostgreSQL database of the same name. |
| **Render** | Old hosting: the company that runs the Flask backend and its Postgres database until the cutover (15.20). |
| **GitHub Pages** | Static hosting: the old production frontend until the cutover (15.20), and the guest-only test copy of the `cleanup` frontend (15.21). |

---

## 3. Architecture

### 3.1 Big picture

This is the CMU-Q server setup (section 15). Until the cutover, production is the old site on GitHub Pages and Render (15.20; its Render API answered 503 "suspended by its owner" on November 11, 2026), and a guest-only test copy of this frontend runs on GitHub Pages (15.21). Locally, `scripts/dev_server.py` plays Apache's part and SQLite stands in for PostgreSQL (section 5).

```
  Browser
    index.html (landing): js/utils.js, js/api.js, js/landing.js
    app.html (main app):  js/utils.js -> js/data.js -> js/profile.js -> js/api.js -> js/app.js
    localStorage / sessionStorage (token, profile, plans, theme, ...)
          |                                         |
          | pages, js, css, data/courses.json       | /api/... on the same origin (relative URLs)
          | (sent gzipped, about 1 MB)              | Authorization: Bearer <token>, cookie cf_session
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
2. **The course catalog is a static file.** `frontend/data/courses.json` (6,791 courses, about 19 MB, about 1 MB gzipped) is downloaded by the browser on every app load (Apache answers 304 when it has not changed). The API does not serve course data. On the server the daily update rewrites this file in place (14.2); nothing commits it to git any more.
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

`fetchCatalog()` loads only the bundled `frontend/data/courses.json` and returns its courses and its `soc_semesters` list. There is no remote fallback: if the file cannot be loaded or has no courses, it throws and `App.loadData()` shows "Failed to load data". `fetchMinors()` loads `frontend/data/minors.json` the same way, at the same time; when it fails, the app still runs and each minor section says its requirements could not be loaded.

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
|   |-- data/            served catalog: courses.json, minors.json, requirement_buckets.json
|   `-- tests/           JS unit tests (not deployed)
|-- backend/             Flask API (Python package "backend")
|   |-- *.py             app, config, models, routes
|   |-- data/            private data, never served: soc.json, mapping_overlays.json,
|   |                    faculty_directory.json, directory_admins.json, minors/
|   |-- scraper/         SOC scrape pipeline, the cron entry point and their tests
|   |-- tests/           API tests
|   `-- requirements.txt
|-- deploy/              server files: systemd unit, Apache site, cron, logrotate, env templates
|-- scripts/             dev_server.py, bump_cf_build.py, run-data-tests.js, publish_test_site.sh
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
| `frontend/data/` | yes | Served catalog: `courses.json` (6,791 courses, about 19 MB), `minors.json` (minor requirements) and `requirement_buckets.json` (every requirement bucket per program, for the admin course editor). On the server the daily update rewrites `courses.json` and `requirement_buckets.json` and adds `courses.json.gz` and `courses.json.prev` (both gitignored or never committed). See [4.4](#44-backenddata-and-backendscraper). | Live |
| `frontend/tests/` | yes | Browser test page (`test.html`) and JS unit tests. Not deployed (the rsync in 15.4 skips it, and Apache denies `/tests/`). | Live |
| `backend/` | yes | Flask API, private data and the scraper. See [4.2](#42-backend) and [section 9](#9-backend-walkthrough). | Live |
| `deploy/` | yes | Everything the CMU-Q server needs besides the code. No secrets. See [4.3](#43-deploy). | Live |
| `scripts/dev_server.py` | yes | Local server that mirrors production: serves `frontend/` on port 8765 and proxies `/api` and `/health` to the API on `127.0.0.1:5050` (5.6). Standard library only. | Live |
| `scripts/bump_cf_build.py` | yes | Rewrites the `cf-build` meta and every `?v=` tag in `frontend/app.html`, and every `?v=` tag in `frontend/index.html`. A release tool, run by hand. Optional on the server, where Apache makes browsers revalidate (15.16). | Live |
| `scripts/run-data-tests.js` | yes | Node runner for `frontend/tests/profile.test.js`, `data.test.js`, `minors.test.js`, `course-edits.test.js` and `utils.test.js`, with an in-memory `localStorage`, plus the Node-only `dash-guard.test.js`, `minors-file.test.js`, `app-views.test.js`, `admin-editor.test.js` and `catalog-data.test.js`. It waits for tests that return a promise. | Live |
| `scripts/publish_test_site.sh` | yes | Publishes `frontend/` of a commit (without `tests/`, plus `.nojekyll`) to the `gh-pages` branch of Hind's working repo, the GitHub Pages test copy, as a fast-forward push; refuses a dirty tree, the main repo, and a remote that pushes to more than one repo (15.21). Run by hand. | Live |
| `pytest.ini` | yes | Lets `python -m pytest` from the repo root run `backend/tests` and `backend/scraper/tests` together. | Live |
| `.gitattributes` | yes | Keeps `*.sh` and everything in `deploy/` at LF line endings in every checkout (a CR breaks bash, cron and systemd, for example on Windows with `core.autocrlf`), and marks the archived source pages in `backend/data/sources/*/` as `-text`, so git never converts their bytes. | Live |
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
| `models.py` | All ORM models (15 tables) and role constants (`VALID_ROLES`, `FACULTY_ROLES`, `VALID_DEPARTMENTS`, `FLAG_STATUSES`). |
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
| `course_overrides.py` | `/api/courses/overrides` routes for course edits, including the batch route of the category view, and their checks (12.2, 12.3). |
| `minor_overrides.py` | `/api/minors/overrides` routes for minor settings (12.6). |
| `minors_file.py` | Reads `frontend/data/minors.json` (the plain setting `MINORS_JSON_PATH`) for both editors: which minors exist and which of their categories hold courses. Callers fall back to `VALID_MINORS_FOR_PATCH` when the file cannot be read. |
| `migrate_override_paths.py` | `python -m backend.migrate_override_paths`: moves course edits saved in the old whole list shape to the 2026-27 names (12.7, 15.8 step 8). A dry run unless `--apply`. |
| `flags.py` | `/api/flags` routes. |
| `wishlist.py` | `/api/wishlist` routes. |
| `plans.py` | `/api/plans` routes (list, share by email, share link, accept link). |
| `search_analytics.py` | `/api/search-analytics` (course lookup counts per program and semester). |
| `semesters.py` | Semester codes: `normalize_semester()` (any code matching the regex), `semester_rank()` (newest first) and `default_semester()` (the newest fall or spring with Qatar sections in `soc.json`, read again when the file changes). |
| `email_util.py` | Password reset email via Resend API or SMTP. |
| `requirements.txt` | Pinned Python dependencies (Flask 3.0.3, Flask-SQLAlchemy 3.1.1, flask-cors 4.0.1, SQLAlchemy 2.0.51, psycopg2-binary 2.9.10, google-auth, requests, itsdangerous, gunicorn 22.0.0, python-dotenv, pytest 8.3.2). pytest is installed on the server too: the daily update runs the parser tests before it scrapes. |
| `.env.example` | Template for `backend/.env`: every variable the API reads, with local values and the production value in a comment. |
| `.env` | Your local settings. Gitignored. Never used on the server (secrets live in `/etc/countsfor/`). |
| `seed_users.example.json` | Example directory seed rows. |
| `seed_users.json` | Optional local directory seed. Gitignored by `backend/.gitignore`. |
| `README.md` | Points to this manual. |
| `tests/` | API pytest suite (section 16), including `test_config.py` (production guards, cookies, `TRUST_PROXY`), `test_env_example.py` (the env templates match the code), `test_deploy_files.py` (the `deploy/` files match the repo) and `test_sources_archive.py` (the archived source pages match their manifest). |
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

The served catalog (`courses.json`, `minors.json`) is in `frontend/data/`. The private data files are in `backend/data/`. The scripts and their `tests/` are in `backend/scraper/`; `pipeline_paths.py` there holds the default file locations, derived from the script folder, so the scripts work from any working directory, in a checkout and on the server.

| File | Purpose |
|---|---|
| `frontend/data/courses.json` | **The catalog the app loads.** `{ "soc_semesters": [ ... ], "courses": [ ... ] }`. `soc_semesters` is the SOC's current semester list, newest first (`["S27", "F26", "M26", "S26", "F25"]`), copied by reconcile from `soc.json` (14.3 step 3): the semester picker lists exactly these. 6,791 courses, about 19 MB (about 1 MB gzipped). Each course: `course_code`, `course_name`, `department`, `units`, `description`, `prerequisites`, `offered` (semester codes), `offered_qatar`, `offered_pitts`, `requirements` (`{CS: [...], IS: [...], BA: [...], BS: [...]}`, plus `AI: [...]` on courses that count for AI; each row `{requirement, type, major}`, plus `"source": "rule"` on a row a rule bucket added, 14.5.1 and 14.10), `offerings` (the SOC sections, newest semester first; set by reconcile). Until November 11, 2026 each row also had `soc_sections`, a legacy copy of its offerings with blank times that nothing read; reconcile now removes it, which took the file from 30.5 MB to 19.1 MB (gzipped from 1.26 MB to 1.02 MB). Set by the overlay step (14.5): `qatar_only`. Set by reconcile: `previous_course_name` when a number was reused for a different course. On a row created from the Psychology renumbering list (14.6): `source` (`"Psychology renumbering list"`). |
| `frontend/data/requirement_buckets.json` | `{program: [bucket paths]}`: every requirement bucket of CS, IS, BA, BS and AI (235 paths), parents included, in the order the tree shows them, with the buckets that have no rows yet (BA Free Electives, IS Emerging Technology Management). Written by `apply_mapping_overlays.py` from `catalog_buckets` in `mapping_overlays.json` plus any row path that list lacks, so it always covers every row; the daily update publishes it with the catalog. For the admin course editor's pick list. |
| `frontend/data/minors.json` | Minor requirements: the 15 minors that have an official file in `backend/data/minors/`, `product` (Product Management, which has no official file, built from its 2026-27 catalog page: its `source_file` is the archived page) and `self_defined` (no fixed requirements). Each minor has its blocked majors, unit total (none for `product`: the page states none), double counting limits (the audit file's, or the catalog page's for `product`), grade rules, notes, the `version` its official file names (kept for reference; the app never shows it) and a tree of categories; each category has a rule and lists its courses by code (`courses`), matches them by number (`select`) or holds sub categories (`children`). One course fills one category. Built by hand from the official files, with old Psychology numbers shown as their new numbers from the department's renumbering list (14.6); `backend/scraper/tests/test_minors_file.py` checks it against them, and `product` against its catalog page (category names, course lists and rules word for word, nothing the page does not state). It has no campus notes: as for the majors, whether a course runs at CMU-Q comes from the Schedule of Classes. The daily update does not touch it. The app loads it with `fetchMinors()` and builds each minor's tree against the catalog (8.10). |
| `backend/data/soc.json` | Raw SOC scrape output (`metadata.last_scrape`, `metadata.semesters_on_form`: the semesters the SOC search form lists, `semesters`: every semester scraped, also ones that have left the form). About 31 MB. The admin Overview reads `last_scrape` from its first 4 KB. A cancelled section stays in a course's `sections` with `cancelled: true` but is left out of its `offerings` and `campus`; a section subtitle is in `section_title`; summer sections carry `session`. Data scraped before November 7, 2026 has none of these fields (see 21.2). |
| `backend/data/mapping_overlays.json` | The one place for Qatar information and other manual complements to the SOC scrape (14.5): `overlays` (additive mappings, 21 entries, including the H&SS Course Offerings sheet), `rule_buckets` (12 catalog rules, 14.5.1), `remove_mappings` (85-426, and 03-351 for AI), `qatar_visibility` (empty since November 11, 2026), `campus_overrides` (82-289 in Qatar) and `catalog_buckets` (every bucket path per program, for `requirement_buckets.json`). |
| `backend/data/psychology_renumbering.json` | The Psychology department's official course renumbering list, verbatim (93 entries: old number, new number or `x` for discontinued, Long Title, units), provided on 2026-11-10 (14.6). The overlay step and the coverage check read it. |
| `backend/data/faculty_directory.json` | 65 CMU-Q faculty scraped from the public People page. The directory seed in production (`SEED_USERS_PATH` in `deploy/countsfor.env.example`). |
| `backend/data/directory_admins.json` | Hand-kept admins layered over the faculty seed (7.1, 19.7). |
| `backend/data/requirement_path_renames.json` | Old to new requirement paths from the move to the 2026-27 catalog bucket names (14.10). Only needed to update admin course edits saved before that change (15.8 step 8). |
| `backend/data/minors/` | The official CMU-Q minor requirement files (15 `cmu_minor_*.json` audit exports, Markdown versions of two of them and the Scotty "Minors" general information page). The source of truth for minor requirements; `frontend/data/minors.json` is built from them. |
| `backend/data/sources/` | Frozen copies of the official pages that define what counts for what (`README.md` there lists them). `catalog-2026-27/` holds the 2026-2027 CMU Undergraduate Catalog pages of the five majors, the SCS, MCS, Dietrich and Tepper general education pages, the CMU-Q page, the catalog pages of the app's minors (with `minors/product-management-minor.html`, the source of the `product` minor, which has no official file), and the cmu.edu pages the catalog names as the up-to-date course lists (the SCS Science and Engineering and Humanities and Arts lists as JSON, the MCS nontechnical breadth page, the Dietrich GenEd site). `manifest.json` records each file's URL, fetch time (UTC), sha256, title and catalog year. Never edit a file there: `.gitattributes` keeps the bytes as served, and `backend/tests/test_sources_archive.py` checks every file against its sha256 and the manifest. |
| `backend/scraper/update_data.py` | **The daily update** run by cron (14.2): lock, parser tests, staged pipeline run, checks, publish in place with `.prev` copies, a `.gz` and the bucket list. |
| `backend/scraper/run_scrape.sh` | The cron entry point: refuses to run as anyone but the owner of `backend/data/` (`countsfor` on the server; a run as root would leave root-owned files that break every later run), sources `/etc/countsfor/scraper.env` if it exists, changes to the deploy root and runs `backend/.venv/bin/python backend/scraper/update_data.py` with its arguments. Executable, LF line endings. |
| `backend/scraper/scrape_soc.py` | Scraper. Splits each results table into rows on `</tr>` (only the first row of each course opens with `<tr>`), maps table cells by the `<th>` header (summer pages have an extra Session column), strips the "This Section Cancelled" note from titles and marks those sections cancelled. Records the form's semesters in `metadata.semesters_on_form` and stops, writing nothing, when it cannot read them (no semester list is kept in code). Keeps semesters that dropped off the SOC form by reading the file it overwrites. |
| `backend/scraper/soc_parse.py`, `soc_departments.py` | Shared parsing helpers. `soc_parse.semester_rank()` is the one semester order of the pipeline scripts (within a year spring, summer, fall mini, fall, as `semester_rank()` in `backend/semesters.py` and `semesterRank()` in `js/data.js`; a test checks the two Python ones agree). `soc_parse.clean_soc_title()` cleans titles already stored in `soc.json` (cancelled note, " : subtitle", trailing ": TBA") and returns `None` when nothing usable is left. |
| `backend/scraper/json_io.py`, `pipeline_paths.py` | Shared `load_json` and `save_json` helpers; default file locations. |
| `backend/scraper/reconcile_offerings.py` | Merges `soc.json` into `courses.json` and copies the SOC's semester list into it (`soc_semesters`, 14.3 step 3). |
| `backend/scraper/apply_mapping_overlays.py` | Runs the daily step of the Psychology renumbering list, then applies every section of `mapping_overlays.json` to `courses.json`, in a fixed order (14.5, 14.6), and writes `requirement_buckets.json` next to it. |
| `backend/scraper/psychology_renumbering.py` | Reads `psychology_renumbering.json` and holds its daily step (14.6). |
| `backend/scraper/migrate_psychology_numbers.py` | The one-time migration that applied the renumbering list to `courses.json` by course on 2026-11-10 (14.6). Dry run by default, `--apply` writes; a second run changes nothing. |
| `backend/scraper/validate_soc_coverage.py` | Fails if a SOC course is missing from `courses.json` (a course under a retired old Psychology number counts as its new number). Warns about same-title pairs that may be renumberings. |
| `backend/scraper/scrape_faculty_directory.py` | Builds `faculty_directory.json` or `backend/seed_users.json` from the CMU-Q People page (Algolia search). Run by hand (14.8). |
| `backend/scraper/tests/` | Pytest tests for the pipeline, the daily update, `scripts/dev_server.py`, `scripts/bump_cf_build.py` and `frontend/data/minors.json` (295 tests). `tests/fixtures/` holds real, untrimmed SOC result pages for Psychology (F26, S27, M26 Pittsburgh and S26 Qatar) and `soc_malformed_summer.json` (two malformed summer courses copied from `soc.json`). |

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
| `SEMESTERS_TO_TRY` | `soc_departments.py` | from the SOC form | Comma list override of the semesters to scrape. `soc.json` still records the form's semesters (the app's semester list). |
| `SOC_JSON_PATH`, `COURSES_JSON_PATH` | reconcile and validate | `backend/data/soc.json`, `frontend/data/courses.json` | File locations. |
| `CATALOG_PATHS` | `apply_mapping_overlays.py` | `frontend/data/courses.json` | Semicolon list of catalogs to patch. |
| `MAPPING_OVERLAYS_PATH` | `apply_mapping_overlays.py`, `validate_soc_coverage.py` | `backend/data/mapping_overlays.json` | Overlay file location. `update_data.py` passes it on unchanged (default `<deploy root>/backend/data/mapping_overlays.json`). |
| `PSYCHOLOGY_RENUMBERING_PATH` | `apply_mapping_overlays.py`, `validate_soc_coverage.py`, `migrate_psychology_numbers.py` | `backend/data/psychology_renumbering.json` (found from the script) | The Psychology department's renumbering list (14.6). |
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
| `<meta name="cf-build">` in `app.html` | Cache tag appended to the data files (`data/courses.json`, `data/minors.json`, and `data/requirement_buckets.json` for the admin course editor). Bumped by `scripts/bump_cf_build.py`. |
| `?v=...` on script and CSS tags | Manual cache busting, in `app.html` and `index.html` (today `?v=release-2026-11-10d`). `scripts/bump_cf_build.py` bumps both pages. On the server Apache sends these files with `no-cache`, so a bump is no longer needed for browsers to see a new version. |
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

`app.html` loads, in order: `js/utils.js`, `js/data.js`, `js/profile.js`, `js/api.js`, `js/app.js`. There are no modules; every top-level `function` and `const` is a global. Later files depend on earlier ones. `tests/test.html` loads `utils.js`, `data.js`, `profile.js` in the same order, then the profile, data, minors, course edits and utils tests.

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

### 8.3 `js/data.js` (about 1,930 lines): catalog logic, pure functions

| Lines (approx.) | Item | Purpose |
|---|---|---|
| 6 to 27 | `MAJOR_META`, `MAJOR_ORDER`, `MAJOR_BRAND` | Majors, their labels, degree names and colors. `MAJOR_ORDER = ['CS','IS','BA','BS','AI']` controls which programs get trees and columns. |
| 28 to 46 | `ACCENT_RULES`, `pickAccentColor()` | Accent color by requirement label. |
| 47 to 63 | `LABEL_OVERRIDES` | Display names for the few segments that should not show as stored: the degree roots ("CS Degree Requirements") and four Biological Sciences track comment rows. Every other bucket shows its 2026-27 catalog name. The stored path never changes. Show a segment with `requirementLeafLabel()` or `formatRequirementPath()`, never raw. |
| 64 to 294 | `FULFILLMENT_RULES`, `setRule()` | Rule chips ("Choose 1", "Take all", "At least 36 units") per major and bucket name, from the 2026-27 catalog, listed in catalog order. A rule's optional `note` shows as the chip's tooltip. |
| 295 to 307 | `courseOfferedInQatar()`, `isCourseHidden()` | A row is hidden everywhere (tree, search, typeahead, home lists, also counts for, double counters) when it has `qatar_only` without a running Qatar offering. |
| 308 to 426 | `buildRequirementTree()`, `normalizeTree()`, `ruleOrder()`, `countTreeCourses()`, `findRule()`, `splitTreeSections()` | Build each major's requirement tree from `course.requirements[major]` paths; sibling buckets follow the order of the major's rules (catalog order); split into degree and GenEd sections. |
| 427 | `normalizeCourseCode()` | Canonical `NN-NNN`. |
| 436 to 525 | `COURSE_EDIT_FIELDS`, `MINOR_EDIT_PREFIX`, `DEGREE_ROOTS`, `requirementPathRootOk()`, `applyProgramEdit()`, `programEditDelta()`, `sameRequirementEdit()` | What a course counts for, edited as a change per program (12.2). `applyProgramEdit(baseRows, edit, prog)` applies `{ add, remove }` to one program's catalog rows (a list saved before November 10, 2026 replaces them, with any old earlier flags dropped). `programEditDelta(base, draft)` is the smallest change from the catalog, or null when both list the same paths. A row's Gen Ed flag always comes from its root (`GenEd`). |
| 526 to 612 | `applyCourseOverrides(courses, overrides)` | Apply admin edits. Returns `{ courses, archived }`. Edited courses get `_edit` (the override) and `_catalog` (the scraped values replaced, `requirements` included). A program key changes only that program; a `MINOR:<code>` key goes to `course._minorEdits`, which `buildMinorIndex()` applies (8.10). Added courses get `_added`. Archived courses are removed from `courses` and returned in `archived`. Copies objects so a reload starts from scraped data. |
| 613 to 680 | `knownRequirementPaths(courses, buckets)`, `parseRequirementBuckets()` | The course editor's pick list per program: the buckets of `data/requirement_buckets.json` when the pipeline wrote it (empty buckets included; a heading with buckets under it only when catalog rows use it), then every path of the scraped rows. Pass the scraped courses, so a path that only an edit uses is not offered. |
| 681 to 741 | `buildCourseIndex()`, `lookupCourse()`, `findTreeNode()`, `collectCoursesForRequirement()`, `formatRequirementPath()`, `requirementLeafLabel()` | Index by `15-122` and `15122`. Tree lookups. |
| 742 to 807 | `getCourseMappings()`, `orderCfColumns()`, `summarizeFlagsByStatus()`, `getAlsoCountsFor()` | Display data for the course card. |
| 808 to 868 | `predictOffering()`, `semesterRank()`, `sortSemesters()` | Rule-based offering hint (no ML) from the semesters a course ran in: its `offered` history and the semesters of its SOC sections, as the course card's Offered line lists them. The card shows the hint (`_renderOfferingPredictionHtml()`) only for a semester the SOC lists no section of the course in. Semesters sort newest first; within a year spring, summer, fall. |
| 869 to 890 | `DEPT_NAMES`, `getDeptName()` | Department number to name. |
| 891 to 1055 | `MODALITY_OPTIONS`, `catalogSemesters()`, `semesterOptions()`, `resolveSemesterChoice()`, `semesterLabel()`, `normalizeSemesterCode()`, `getCourseOfferings()`, `semesterFilterMatches()`, `filterOfferings()`, `courseHasMatchingOffering()` | Semester, campus and modality filters over SOC offerings. The semester list is exactly the SOC's (`soc_semesters` of `courses.json`; a catalog without it falls back to the semesters its offerings have), newest first, after "All semesters", which means those semesters; labels come from the code ("S27" is "Spring 2027"). Sections of a semester that left the SOC stay in the offerings as history: the course card lists the semester under Offered, but no filter shows its sections, and a course with only such sections is filtered like one without sections (by `offered` and its campus flags). The app opens on the newest fall or spring of the list with a Qatar section (summer only when there is no fall or spring), or on the semester picked last (`cf_semester`, 8.8) while the SOC still lists it. `pick_default_semester()` in `backend/semesters.py` applies the same rule to `soc.json`. |
| 1056 to 1166 | `PLAN_DAY_COLUMNS`, `parseDaysTimes()`, `formatDaysTimesForDisplay()`, `planOfferingKey()`, `planSectionKey()`, `offeringDaysTimes()` and friends | Schedule planner math: times and plan keys. Stored `days_times` keep the SOC form `MW 03:30PM-04:50PM` (plan keys and `parseDaysTimes` read it); `formatDaysTimesForDisplay()` shows it as `MW 3:30 PM to 4:50 PM` on course cards and the plan list, and returns any other string unchanged. |
| 1167 to 1352 | `isLectureSection()`, `planSectionLabel()`, `linkOfferingGroups()`, `offeringGroupParts()`, `filterOfferingGroups()`, `offeringGroupKey()`, `findOfferingGroup()`, `quickPlanGroup()`, `offeringGroupChoice()`, `planItemOfferingGroup()`, `planItemOfferingGroups()`, `groupPlanItemsByOffering()` | Offerings (8.11): a lecture with the sections the SOC lists under it, linked in the stored order before any filter; the filters applied to whole offerings; what planning one section means (its lecture with it, in place of the lecture's other sections); planned meetings grouped per offering for the plan views. |
| 1353 to 1475 | `planEntriesOverlap()`, `planConflictPairs()`, `findPlanConflicts()`, `countPlanConflictPairs()`, `planBlocksTimeOverlap()`, `layoutPlanDayBlocks()` | Time conflicts (never between meetings of one offering, 8.11) and the calendar layout (7:00 to 22:00). |
| 1476 to 1898 | `courseMatchesSelect()`, `expandMinorCategory()`, `minorRuleLabel()` (chips worded like the major chips), `buildMinorTree()`, `buildMinorIndex()`, `courseCountsForMinor()`, `majorCountKind()`, `minorDoubleCountRules()`, `minorDoubleCountLimitText()`, `minorSourceKind()`, `plainDataText()`; for the admin edits `minorLeafCategories()`, `minorFileCategories()`, `collectMinorEdits()` (the `MINOR:<code>` course edits, which `buildMinorTree()` and `buildMinorIndex()` apply, 12.2), `MINOR_SETTING_FIELDS` and `applyMinorOverrides()` (the minor settings, on a copy of the file, 12.6) | Minors: each minor of `data/minors.json` as a tree against the catalog, with the admin edits, and the double counting limit text (8.10). |
| 1899 to end | `annotateDoubleCounters()`, `annotateMultiProgram()` | Profile-aware flags on courses: for a student `_majorKind` (`degree`, `gened` or none for their major), `_minorMatches` (their minors the course can count for) and `_doubleCounter` (both); `_programCount`. |

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

### 8.5 `js/api.js` (about 390 lines): all network calls

`apiFetch(path, opts)` is the single wrapper. It requests `CF_BACKEND_URL + path` (normally just the relative path), always sends `credentials: 'include'` and the bearer token, times out after 20 s by default (`opts.timeoutMs`), never throws on HTTP errors, saves any `auth_token` it sees in a response, and returns `{ ok, status, data, error, message }`. `status: 0` means the API could not be reached: network failure, timeout, or a 502/503/504 without a JSON body (the proxy, Apache or `scripts/dev_server.py`, reporting the API down). Flask's own JSON error responses pass through unchanged.

| Group | Functions | Endpoint |
|---|---|---|
| Course data | `fetchCatalog()` (`{ courses, socSemesters }`), `fetchMinors()`, `fetchRequirementBuckets()` (null when `data/requirement_buckets.json` is missing or unreadable; only the admin Courses tab asks for it) | static files (see 3.3) |
| Backend URL and token | `getBackendUrl()`, `getAuthToken()`, `saveAuthToken(token, persist)`, `clearAuthToken()`, `getGoogleClientId()` | none |
| Auth | `apiSignInWithGoogle`, `apiRegister`, `apiLogin`, `apiForgotPassword`, `apiResetPassword`, `apiSetPassword` (these six are called by `landing.js`), `apiLogout`, `apiGetMe`, `apiPatchMe` | `/api/auth/*`, `/api/me` |
| Users | `apiListUsers(query)`, `apiPatchUser(id, patch)` | `/api/users` |
| Admin console | `apiAdminOverview`, `apiAdminInsights(semester)`, `apiAdminActivity(query)` | `/api/admin/*` |
| Course edits | `apiGetCourseOverrides` (10 s timeout), `apiAddCourse`, `apiEditCourse`, `apiBatchEditCourses`, `apiArchiveCourse`, `apiRestoreCourse`, `apiRevertCourse` | `/api/courses/overrides` |
| Minor settings | `apiGetMinorOverrides` (10 s timeout, fetched with the course edits), `apiEditMinor`, `apiRevertMinor` | `/api/minors/overrides` |
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

### 8.7 `js/app.js` (about 7,630 lines): the `App` object

Everything lives on one object literal `const App = { ... }`, started by `App.init()` on `DOMContentLoaded` (last lines of the file). Line numbers below are for the `cleanup` branch after the wave A merges (final data, Psychology renumbering, semesters from the SOC, minors dropdown), the admin editor merge, the release integration (lectures and sections planned as one offering, the course status feature removed), the review fixes (November 10, 2026) and the review follow ups (November 11, 2026); they will drift as the file is edited. Search for the function name.

| Lines (approx.) | Section | Key functions |
|---|---|---|
| 5 to 14 | Home constants | `HOME_POPULAR_COURSES`, `HOME_SEARCH_CHIPS`, `HOME_RECENT_MAPPINGS`, `MINORS_TAB` (id of the Minors tab) |
| 15 to 41 | State | `courses`, `courseIndex`, `trees` (the majors and `minor:<code>`), `treeSections`, `minorsData`, `minorIndex`, `browseMinorCode`, `layoutMode`, `activeMajor` (a major code or `MINORS_TAB`), `selectedCourse`, filters (`locationFilter`, `activeSemester` (a semester code or `all`; null until the catalog loads), `modalityFilter`), `_semesters` (the catalog's semester codes and default), `profile`, `authedUser`, `authMode` (`authed`, `demo`, `login`), `isGuest`, `serverFlags` |
| 42 to 226 | Boot and auth state | `init()`, `_redirectToLogin()`, `_restorePendingSharePlan()`, `_afterAuthed()`, `_syncLocalToServer()` (one-time upload of local flags and wishlist), `_loadServerFlags()`, `_needsOnboarding()`, `_hydrateProfileFromServer()` (drops minors the app no longer offers) |
| 227 to 238 | Theme | `applyTheme()`, `toggleTheme()` |
| 239 to 365 | Data loading | `_prepareCatalog()` (fetch the catalog, `minors.json`, the course edits and the minor settings), `_buildCatalog()` (apply the course edits and the minor settings, index, annotate, build the major and minor trees), `loadData()`, `autoExpandFirstLevel()` |
| 366 to 615 | Onboarding (students only) | `renderOnboarding()`, `_renderOnboardingScreen()`, `_obPickMajor()`, `_obPickMinor()`, `_obAddMinor()`, `_obRemoveMinor()`, `_finishOnboarding()` (PATCHes `/api/me`) |
| 616 to 871 | Sign-in result, guest, sign-out, role badge | `_afterSignIn()`, `_readGuestFlag()`, `exitGuest()`, `setGuestRole()` (keeps the guest student's major and minors in `cf_guest_student` while the Faculty view is on), `signOut()`, `_roleBadgeHtml()`, `editRole()`, `_visibleMajors()`, `_guestBannerHtml()` |
| 872 to 1087 | Shell rendering | `renderShell()` (navbar with Saved, Plans, Admin or Flag review buttons, directory button; redraws the requirement map in split view), `_syncDirectoryFabLayout()`, `_initPanelResizer()` (split view drag handle) |
| 1088 to 1386 | Events and filters | `bindGlobalEvents()`, `_filterParams()`, `_resolveSemesters()` (the semester list and the semester shown, once the catalog loads), `_semesterOptionsHtml()`, `_refreshSemesterOptions()`, `setSemester()` (also saves `cf_semester`), `setModalityFilter()`, `setLocation()`, `setMobileLens()`, `reset()` |
| 1387 to 1606 | Explorer mode and course search | `enterExplorer()`, `exitExplorer()`, `handleSearchKeydown()`, `_selectCourse()`, `selectSearchResult()` |
| 1607 to 1843 | Category index and unified home search | `_buildCategoryIndex()` (requirement categories and one entry per minor), `selectCategoryResult()`, `handleUnifiedSearchKeydown()`, `selectUnifiedResult()`, `runHomeSearchChip()` |
| 1844 to 2243 | Home screen | `renderLeftEmpty()`, `_renderHome()`, `_renderHomeDock()`, popular courses (`_popularSemester()`, the semester shown or the default under "All semesters"; `_recordCourseSearch()`, `_loadPopularCourses()`, local fallback counts), `_renderQuickStart()`, navbar counters |
| 2244 to 2273 | Flag counts for the home screen | `_loadStudentFlagsSummary()`, `_loadMyFlagsSummary()` |
| 2274 to 2523 | Course card | `renderCourseCard()` (the minors the course counts for; the schedule of the semester shown, one block per offering, 8.11), `_schedLineCount()`, `_renderSchedBlock()` (the lecture line, then its section lines), `_schedPlanBtnHtml()` (one "+ Plan" per offering), `_renderSchedRowGroup()`, `expandScheduleV2()` |
| 2524 to 2999 | Requirement tree | `_renderMajorTabs()` (the majors and the Minors tab), `switchMajor()`, `toggleNode()`, `renderTree()`, `renderTreeNode()`, `downloadRequirementExcel()` (CSV), `_renderLeafCourse()`, `_renderRowActions()`, `_renderCardActions()` (also the Edit course data button for admins), `_leafPassesTreeFilter()` |
| 3000 to 3016 | Cross-linking | `selectCourseFromTree()` |
| 3017 to 3177 | Wishlist (Saved) | `_getWishlistItems()`, `toggleWishlist()`, `showWishlistView()`, `_saveWishlistNote()` |
| 3178 to 4020 | Schedule plans (8.11) | `_loadPlansStore()` (localStorage `cf_plans_v2`, migrates legacy `cf_plan`), `createNewPlan()`, `deletePlan()`, `renamePlan()`, `_loadServerPlans()`, `_mergeServerPlan()`, `_handlePendingSharePlanLink()`, `openSharePlanModal()`, `submitSharePlanEmail()`, `copySharePlanLink()`, `_planItemForMeeting()`, `_offeringGroups()`, `_visibleOfferingGroups()`, `_countPlannedCourses()`, `_planSummary()`, `_groupPlanItems()`, `_planOfferingKeyOf()` (the offering key the conflict check uses), `addFirstSectionToPlan()`, `togglePlanSection()` (a section with its lecture), `removePlanSection()` (the whole offering), `_renderPlanCalendar()`, `_renderPlanList()`, `showPlanView()`, `openPlanDetail()` |
| 4021 to 4081 | Student flag view and favourites | `showStudentFlagsView()`, `showStudentFavorites()` |
| 4082 to 4255 | Flags | `FLAG_REASONS` (must match `VALID_REASON_CODES` in `backend/flags.py`), `_getFlags()` (local `cf_flags`), `openFlagModal()`, `submitFlag()` |
| 4256 to 4489 | Directory panel | `toggleDirectoryPanel()`, `_loadDirectoryPanel()`, `_renderDirectoryPanel()`, `_editDirectoryRow()`, `_revokeDirectoryRow()`, `_submitDirectoryForm()` |
| 4490 to 4622 | Admin console shell | `_adminConsole` state, `ADMIN_TABS`, `showAdminConsole()`, `_setAdminTab()`, `_loadAdminTab()` (dispatch), helpers `_admEl()`, `_admError()`, `_admWhen()`, `_admStat()` |
| 4623 to 6000 | Admin: Courses tab (12.5 to 12.7) | `_courseAdmin` state and its three views (`COURSE_VIEWS`). Courses: `_renderAdminCourses()`, `_renderCourseResults()` (filters Edited, Added here, Check these, Archived), `_courseEditSummary()`, `_courseEditProblems()`, `_openCourseEditor()`, `_editCourseInAdmin()` (from the Edit course data button `_renderCardActions()` shows admins on a course card, or from the Activity log), `_openCourseAdd()`, `_renderCourseEditor()`, `_courseReqGroupHtml()` (Added here, Removed here, Put back, Reset to the catalog, Not in the 2026-27 catalog), `_courseMinorSectionHtml()`, `_addCourseReq()`, `_addCourseMinor()`, `_courseRequirementsPatch()` (the change per program and minor), `_saveCourse()`, `_archiveCourse()`, `_restoreCourse()`, `_revertCourse()`, `_reloadCatalog()`. Courses in a category: `_renderCategoryView()`, `_categoryChange()` (one batch save). Minor settings: `_renderMinorSettings()`, `_saveMinorSettings()`, `_revertMinorSettings()` |
| 6001 to 6334 | Admin: Overview tab and sign-in activity | `_loadAdminOverview()`, `_openIncompleteUsers()`, `_openSignIns()`, `_renderSignIns()`, `_exportSignInsCsv()` |
| 6335 to 6374 | Admin: Faculty access tab | `_loadAdminAccess()`, `_openDirectoryFromAdmin()` |
| 6375 to 6466 | Admin: Insights tab | `_loadAdminInsights()` |
| 6467 to 6646 | Admin: Activity log tab | `_loadAdminActivity()`, `_renderAdminActivity()` (filters Everything, Courses, Minors, User changes, Flag reviews, Faculty access), `_describeAdminEvent()` (human text per audit action: fields from and to, the categories added and removed per program and minor, what an undo dropped), `_adminEventOpenHtml()` (an Open button on each course and minor event) |
| 6647 to 6857 | Admin: Users tab | `_loadUserAdmin()`, `_exportUsersCsv()`, `_renderUserAdmin()`, `_renderUserAdminRow()`, `_saveUserAdmin()` (opened with `showAdminConsole('users')`) |
| 6858 to 6987 | Admin and faculty: Flags review | `showFlagReview()`, `_loadFlagReview()`, `_renderFlagReview()`, `_setFlagStatus()`, `_promptFlagNote()` |
| 6988 to 7582 | Minors (8.10) | `_isStudentView()` (the programs bar, a student's minor sections and the "Also counts for" tags), `_courseCardMinorsHtml()`, `_minorTextHtml()` (keeps course codes whole at a line end), `_minorNodeInfoHtml()`, `_studentProgramsBarHtml()` (the Major and Minors rows), `_programSelectEvents()`, `_onProgramSelectKey()`, `_onProgramSelectChange()`, `_onProgramSelectPointer()`, `_onProgramSelectBlur()` and `_applyProgramPick()` (a choice made with the arrow keys or by typing waits for Enter or Tab), `_focusById()`, `_focusBeside()`, `_iconClose()`, `_iconCheck()`, `_iconPlus()`, `setStudentMajor()`, `addStudentMinor()`, `removeStudentMinor()`, `_applyStudentPrograms()`, `_saveStudentProgramsToAccount()` (one `PATCH /api/me` at a time), `browseMinor()`, `openMinorRequirements()`, `_navigateToMinorNode()`, `_renderMinorsBrowse()` (the Minors tab dropdown), `_minorsBrowseBodyHtml()`, `_onBrowseMinorPick()` (draws only the minor under the dropdown), `_renderMinorSection()` |
| 7583 to 7626 | Deep links into the tree | `navigateToReqNode()` (a `minor:<code>` target goes to `_navigateToMinorNode()`) |
| 7627 to 7633 | Bootstrap | `DOMContentLoaded` handler, picks dark theme from OS if no saved theme, calls `App.init()` |

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
| `cf_course_status` | local | nothing now (legacy) | The course statuses of the course status feature, removed on November 10, 2026 (8.10). The app no longer reads or writes the key and leaves an old value in place. |
| `cf_guest_student` | local | `app.js` | The guest Student view's major and minors, kept while the guest looks at the Faculty view |
| `cf_plan` | local | legacy | Old single plan, migrated into `cf_plans_v2` on load |
| `cf_split_left_px` | local | `app.js` | Split view panel width |
| `cf_semester` | local | `app.js` | The semester picked last, `{ code, defaultCode }` (`defaultCode` is the default when it was picked). The app opens on it while the SOC lists that semester, unless a newer default has come out since (a new fall or spring with Qatar sections): then it opens on the new one. "All semesters" is always kept. |
| `cf_search_counts_<PROGRAM>_<SEMESTER>` | local | `app.js` | Local fallback for "popular courses" (under "All semesters", the default semester's counts) |

Note: schedule plans live only in the browser. The server stores a plan only when someone shares it (`/api/plans/share`, `/api/plans/accept-share`), and `GET /api/plans` returns those copies. There is no endpoint that saves a user's own plans.

### 8.9 CSS

`css/styles.css` starts with light theme custom properties in `:root` (line 9, including `--major-cs`, `--major-is` and friends, `--minor-accent`, and `--minor-mine-check` for the check of "Your minor"), then `[data-theme="dark"]` overrides, then sections for layout (focused and split mode), search, course card, tree (with the minors styles right after it, `.mn-*`, `.tr-dc-tag`, `.cc-mn-*`; the minors dropdowns, labels and buttons are `.mn-select`, `.mn-label` and `.mn-add-btn`, 34px high like the navbar controls, and on phones of 480px and below each label sits above a full width dropdown), onboarding, navbar, plans, directory panel, and the Admin page and course editor. The theme is switched by setting `data-theme` on `<html>`.

The navbar: the semester, campus and modality filters sit inline from 1280px and are a Filters popover below that (inline they take about 615px, and from 769px to about 1100px they covered Saved and Plan); up to 720px the popover opens at the navbar's right edge, 8px below the Filters button, so it stays on screen. Saved and Plan keep their width and one line of text; the role badge takes the room the other controls leave, up to its own width, on one line (clipped when the room is short). When the controls on the right do not fit beside Scotty, the wordmark, Saved and Plan, they move to a second row instead of covering them. A signed-in student's navbar (it adds Sign out) takes two rows up to about 430px and at a few wider widths (about 481 to 500px, 769px, and 1280 to 1300px, where the filters go inline); a staff navbar (Admin, Flag review or Student favorites, and Sign out) takes two rows up to about 900px and from 1280 to about 1440px. Where a signed-in navbar just fits on one row, its role badge can be clipped to a sliver (2 to 22px at a few widths). Phones: at 720px and below Saved and Plan show only their icons; at 540px and below the navbar's spacing tightens (12px at the sides); at 480px and below the "CountsFor" wordmark hides (Scotty stays); below 390px a student's navbar has no role badge (the major and minors are in the programs bar); below 340px the spacing tightens again. So a guest's navbar is one row from 300px up, with Plan clear of Filters. The plan views keep to the panel's width, so only the calendar scrolls sideways (inside `.plan-cal-wrap`).

### 8.10 Minors in the requirement map

**Data.** `frontend/data/minors.json` (4.4) lists each minor as a tree of categories. `fetchMinors()` loads it with the catalog; `applyMinorsCatalog()` rebuilds `MINOR_LIST` and `MINOR_BLOCKED_MAJORS` from it, and `buildMinorIndex()` builds every minor's tree against the loaded catalog (`App.minorIndex`, and `App.trees['minor:<code>']`). A category's courses are its listed codes that have a catalog row plus every course its `select` rule matches (prefix, number range, excluded codes and ranges, unit floor), sorted by code; listed codes with no catalog row are named under the category ("Also listed, but not in the course catalog"). There are no campus notes: as for the majors, whether a course runs at CMU-Q comes from the Schedule of Classes. Minor trees have the same node shape as the major trees, so the same cards, rows, rule chips and course rows render them; their paths are category ids joined by `---`. Their rule chips are worded like the 2026-27 catalog chips of the majors (`minorRuleLabel()`: "Take all", "Choose 2", "Choose 1 (at least 9 units)", "At least 27 units", "Up to 9 units").

**Student view.** On their own major tab, a student (guest or signed in) sees a programs bar with two labelled rows (Major: a dropdown; Minors: each chosen minor as a token with a remove button, then the "Add a minor" dropdown). A pick in a dropdown's open list, with the mouse or the keyboard, applies at once. On a closed dropdown the arrow keys and typed letters only move the choice (Chrome, Edge and Firefox would otherwise apply every key: three presses of the down arrow added three minors): Enter, or Tab on to the next control, applies it, and Escape or a click elsewhere puts the dropdown back. After a change the tree is drawn again and the focus goes back to the redrawn dropdown (after Tab, to the control after it), the major's cards, then one section per chosen minor: "Psychology minor" with, under the title, the official name when it says more than the title and the unit total, the action on the right, the double counting limit in plain English with the rule's own words ("Audit rule", or "Catalog rule" for Product Management, whose source is its catalog page), the limit and note an admin set (12.6), and "About this minor" (notes, grade rules, double counting notes). The header never shows the official file's version (it stays in `minors.json`) or a campus note. Changes are saved locally (`saveProfile()`) and, when signed in, on the account (`PATCH /api/me`, one request at a time). The role badge's Edit (onboarding) still works too.

**No course statuses or progress.** A student cannot mark a course as taken or in progress, and the app tracks no progress: the course status feature (a round control on every tree row, status buttons on the course card, progress bars and "N of M requirements done" lines in the minor headers, status chips on the categories, and warnings built from the marked courses) was added and removed again on November 10, 2026; it was never in the original app. Every tree row follows the semester, campus and modality filters. A `cf_course_status` value an older version saved stays in the browser, unread (8.8).

**Double counting.** A course in a minor's tree that also counts for the student's major is tagged "Also counts for CS" (a major requirement) or "Also counts for CS Gen Ed"; in the major tree a course a chosen minor can use is tagged "Also counts for Psychology minor". A course counts for the major through any of its rows for that major, older audit rows and rule rows included (14.10, 14.5.1). The header states the limit (`minorDoubleCountLimitText()`, from `minorDoubleCountRules()`): "At most 2 courses may also count toward your major or another minor", "No course may ..." with the categories that are free, "... without a limit" with the categories that may never be shared, or "Confirm double counting with your advisor" when the file states no rule (Biological Sciences, Student-defined). The limit is the file's (`max_with_major`, which equals `max_with_other_minors` in every file) unless an admin set one (12.6). The app does not check a student's courses against it: without course statuses it does not know which courses a student took, so there are no double counting warnings. The app offers every minor to every major, AI included, except to the majors a minor's `blocked_majors` names.

**Browse view.** Every role has a Minors tab after the major tabs: one dropdown (`#mnBrowsePick`, "Minor") lists all 17 minors, a student's own first under "Your minors", then "Other minors"; until one is chosen it shows "Choose a minor" and an empty state. Choosing one shows its full tree; only the part under the dropdown is drawn again, so the dropdown keeps the focus and its typing ("Psy" reaches Psychology) while the arrow keys move through the minors. Course codes in notes never break at their hyphen (`.mn-code`). Students also see an "Add to my minors" button there (or "Not open to BA majors"); an advisor with minor scope starts on their minor. Course cards list the minors a course counts for ("Psychology: Survey Courses or Psychology Elective", the student's own first), and the home search offers each minor ("Minor · Neuroscience minor").

Tests: `tests/minors.test.js` (selection rules, trees, the double counting limit text), `tests/minors-file.test.js` (the real file through `fetchMinors()`, the fallback list, every category's rule) and the minors part of `tests/app-views.test.js` (the student tree, no status controls, progress, version line or warnings, an old `cf_course_status` ignored and kept, the Minors tab dropdown for faculty and for a student, Product Management, no campus note, guest changes, the save queue, a missing file).

**Admin edits** (12.2, 12.6). Two kinds of admin edits change the minors without touching the file. Which courses fill a category is a course edit: the course editor's Minors section and the category view save a `MINOR:<code>` key with the category paths to add or remove. `applyCourseOverrides()` puts them on `course._minorEdits`, `collectMinorEdits()` gathers them, and `buildMinorTree()` applies them after the file's list and select rule: a removed code leaves the category, an added code joins it when it has a catalog row and is not hidden. The codes an edit changed are on the node (`adminAdded`, `adminRemoved`) and named under the category for admins only; for admins, a listed code the admin archived is named "Archived on the admin page" instead of missing (students and guests see it as not in the catalog, like any listed code without a row). `minorLeafCategories()` lists a minor's categories that hold courses (the editor's picker) and `minorFileCategories()` the ones that take a course by the file alone. The minor settings are applied by `applyMinorOverrides()` to a copy of the file before the index is built: the unit total, a note from CMU-Q in the header, and the double counting limits. When an admin sets `max_with_major` and `max_with_other_minors` to different values, each applies on its own (`minorDoubleCountRules().separate`: courses shared with the major, and courses shared with another minor); equal values stay one shared limit, as in the files. The header then says that CMU-Q set the limit and that it replaces the quoted rule (the audit rule, or the catalog rule for Product Management). Admins also get an Edit minor settings button in the Minors tab. Tests: `tests/course-edits.test.js` and `tests/admin-editor.test.js`.

### 8.11 Schedule planner: a lecture and its section are one offering

**Offerings.** The Schedule of Classes lists each lecture ("Lec 2") followed by its own sections (recitations and labs: "W", "A"), which usually meet at other times of the week, and a student takes the lecture with one of its sections. `linkOfferingGroups()` (8.3) links a course's offerings in their stored order, before any filter: within one semester and campus, a section that is not a lecture belongs to the nearest lecture listed before it; a section with no such lecture, or a lecture with no sections, stands alone. Only the list order counts, so the pipeline keeps the SOC row order (`backend/scraper/tests/test_offering_order.py`). The semester, campus and modality filters then show or hide whole offerings (`filterOfferingGroups()`; the modality filter keeps an offering when any of its meetings matches).

**Course card.** Each offering is one block, as in the SOC: the lecture line, then its section lines. A lecture with one section has one "+ Plan", on the section line, which plans both (09-207 Fall 2026: Lec 2 and W). With several sections each section line has its own, and picking another section of the same lecture replaces the planned one (15-112 Pittsburgh: A, then B). A lecture or a section alone keeps its own button. Under All semesters each block names its semester. Whole blocks show until at least four lines do; the rest wait behind "+N more sections", which stays open when the card redraws.

**Plan items.** Planning adds every meeting of the lecture and of the section; "Planned" takes the whole offering out again. Plan items keep their shape (one item per meeting, its `id` from `planOfferingKey()`), so saved plans, share links and imported shared plans work as before, with no backend change. A plan saved with only part of an offering still loads, and "+ Plan" adds the missing part. The typeahead "+ Plan" (and "Add to plan" on the card) adds the first matching lecture with its first section (`quickPlanGroup()`); when the campus filter shows both campuses it takes the first Qatar offering of that semester, since the SOC lists Pittsburgh first and CMU-Q students take the Doha sections.

**Plan views.** One entry per offering ("Lec 2 + Sec W", with each part's meeting times), counts in courses ("2 courses · 21 units", the units once per course), calendar blocks labelled "Lec 2" or "Sec W", and Remove takes the whole offering, both in the course list and under "No time listed" (a meeting without a time, such as 15-210 Pittsburgh Lec 2, whose section M has one); both Remove buttons name all of it for screen readers ("Remove 15-210 Lec 2 + Sec M from plan"). A schedule with no courses in the semester on screen but some in others (a Fall 2026 plan opened on the Spring 2027 default) says so ("This schedule has 2 courses in Fall 2026") with a button per semester that switches to it, or "Show all semesters" for a semester the SOC no longer lists. The navbar's plan button ("Plan · 24u", the units in the semester on screen) is drawn again once the catalog has loaded and after every semester switch.

**Conflicts.** Two planned meetings conflict when they meet on the same day at overlapping times, except when they belong to one offering: same course, semester, campus and lecture, which includes a section's own rows (`planConflictPairs()`, with the key `_planOfferingKeyOf()` gives each meeting). The SOC itself lists some lectures inside their lab's time (03-117 Lec 1, TR 1:00 PM to 1:50 PM, inside lab A, TR 1:00 PM to 4:00 PM; 177 lecture and section pairs in the catalog of November 10, 2026) and some sections with overlapping rows of their own (09-207 Pittsburgh A; 64 sections), and none of those is a real conflict, so before this rule 241 offerings conflicted with themselves when planned alone. The conflict count, the "Time conflict" marks and the count on the schedule card all skip them; meetings of different courses, or of two offerings of one course, still conflict. Meetings on different campuses never conflict (`planEntriesOverlap()`): Doha and Pittsburgh times are local times.

Tests: the planner part of `tests/data.test.js` (linking, filters, choices, grouping, conflicts, campuses, the quick "+ Plan" group) and of `tests/app-views.test.js` (the course card blocks and buttons, replacing a section, a plan saved with part of an offering, the typeahead "+ Plan" in Qatar, the plan views, Remove under "No time listed", a schedule for another semester, conflicts, the navbar label, a shared snapshot); `tests/catalog-data.test.js` plans every offering of the catalog alone and checks that none conflicts with itself.

---

## 9. Backend walkthrough

### 9.1 App factory (`backend/app.py`)

`create_app(config_class=Config, *, bootstrap_db=None)`:

1. Loads config.
2. If `TRUST_PROXY` is on, wraps the WSGI app in `ProxyFix(x_for=1, x_proto=1)`; then `db.init_app(app)`.
3. Unless `SKIP_DB_BOOTSTRAP` is truthy, runs `init_database(app)`: imports models, `db.create_all()`, then `run_migrations()`.
4. Enables CORS for `/api/*` only, for `FRONTEND_ORIGINS`, with credentials and the `Content-Type` and `Authorization` headers.
5. Registers blueprints: `auth`, `flags`, `wishlist`, `users`, `directory`, `search_analytics`, `plans`, `admin`, `course_overrides`, `minor_overrides`.
6. Adds a `before_request` hook: a POST, PUT, PATCH or DELETE whose JSON body is not an object (a list, a number, a string, true or false) gets 400 `{"error": "invalid_body", "message": "The request body must be a JSON object."}`. Every route reads its body as an object, so such a body used to end in a 500 inside the route. No body, `null` and a body that is not JSON still reach the route, which reads them as `{}`.
7. Adds `GET /health` (no `/api` prefix, so no CORS). It runs `SELECT 1` and checks `REQUIRED_TABLES`, and returns 503 if tables are missing or the DB errors. With SQLite it also lists the table names (`table_names`), so a local bootstrap can be checked by eye; with Postgres it reports only their count (`tables`).
8. JSON 404 handler: `{"error":"not_found","message":"Route not found."}`.

On the server systemd runs `gunicorn --workers 3 --bind 127.0.0.1:8000 --timeout 120 --forwarded-allow-ips 127.0.0.1 ... 'backend.app:create_app()'` from `/var/www/html/countsfor`, with `SKIP_DB_BOOTSTRAP=1` and `TRUST_PROXY=1` from `/etc/countsfor/countsfor.env` (15.9).

### 9.2 Permissions (`backend/permissions.py`)

- `_load_user()`: session `uid` first, then `Authorization: Bearer <token>`. Cached on `g._current_user` per request.
- `@require_login`: 401 unless signed in. Sets `g.user`.
- `@require_role_group("faculty", "admin")`: 403 unless the user's role group is listed. **Use this for permissions.**
- `@require_role("student")`: exact role match. Used for student-only routes (wishlist, search event).
- `current_user()` and `is_admin(user)`: for a public route that shows admins more, such as the editor's email in the course and minor edit lists (12.2).
- Constants: `ROLE_GROUP_STUDENT`, `ROLE_GROUP_FACULTY`, `ROLE_GROUP_ADMIN`.

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

Admin only: both routes have `@require_role_group(ROLE_GROUP_ADMIN)`. List with `search`, `role_group`, `incomplete`, `limit` (max 1000). Patch validates like `PATCH /api/me`, writes a `user.update` audit row with before and after values. Remember 7.1: the role part is overwritten on next sign-in unless the directory agrees. Some code comments still mention area heads managing users; that is no longer allowed.

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

When a signed-in **student** opens a course, the frontend posts `/api/search-analytics/events`; the server increments a counter keyed by (student's program, semester, course). `GET /popular?program=CS&semester=F26&limit=5` is public and returns only aggregates. No per-user data is stored. Any semester code is accepted (`^[FSMN]\d{2}$`, no fixed list). Without one, the server uses the newest fall or spring with Qatar sections in `soc.json` (`default_semester()` in `backend/semesters.py`), or answers 400 `invalid_semester` when `soc.json` cannot be read. Under "All semesters" the app counts and shows lookups for its default semester.

### 9.10 Admin console API and audit log (`backend/admin.py`)

- `record_event(actor, action, target, **details)` adds an `admin_audit_events` row to the current session; the caller's commit saves it together with the change.
- Actions written today: `user.update`, `directory.add`, `directory.update`, `directory.remove`, `directory.revoke`, `flag.status`, `flag.note`, `course.add`, `course.update`, `course.revert`, `course.archive`, `course.restore`, `course.migrate` (written by `migrate_override_paths.py`, actor `system: migrate_override_paths`), `minor.update`, `minor.revert`.
- Course and minor events say what changed. `course.update`: `fields` (the changed field names, plus `counts for` when a program changed and `minors` when a minor changed; older rows hold only this), `changes` (`{field: {"from", "to"}}`, where null is the Schedule of Classes value; text is cut to 300 characters) and `requirements` (the new value of every changed program or `MINOR:<code>` key, null meaning back to the catalog). `course.add` carries the `requirements` it was added with. `course.revert` keeps what it dropped in `before` (`fields`, `requirements`, `archived`), with `reason: "matches the catalog"` when a save left nothing to store. `minor.update` has `fields` and `changes`; `minor.revert` has `before` (with `reason: "matches the minor file"` when a save set every value back). A save that changes nothing writes no event and no new editor stamp.
- `GET /api/admin/overview`: user counts by role and group, new users in 7 and 30 days, active in 7 days (by `last_login`), incomplete profiles, flag counts by status, wishlist totals, plan count, total course lookups, directory row count, `course_data.last_scrape` (read from the top of the server's `soc.json`: `SOC_JSON_PATH`, default `backend/data/soc.json`), six most recent signups.
- `GET /api/admin/insights?semester=F26`: top lookups, top lookups per program, most saved, most flagged, students per program, signups per week for 12 weeks, list of semesters with data (newest first).
- `GET /api/admin/sign-ins?days=7|30|90`: sign-in activity (active people, sign-ins, app opens, daily series, breakdowns, per-person table). See section 13.
- `GET /api/admin/activity?action=course.&page=1&limit=50`: paginated audit log; `action` is a prefix match (a trailing `*` is ignored).

### 9.11 Email (`backend/email_util.py`)

`send_password_reset_email(to, url)` tries Resend (HTTPS API), then SMTP (STARTTLS by default), and returns False if neither is configured or both fail. Never raises.

---

## 10. API reference (every route)

All `/api/*` routes return JSON. "Login" means any signed-in user. Files are under `backend/`. A write whose JSON body is not an object gets 400 `invalid_body` (9.1).

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
| GET | `/api/courses/overrides` | public | `course_overrides.py` | All catalog edits (`Cache-Control: no-cache`); who saved each one (`updated_by_email`) only for admins |
| POST | `/api/courses/overrides` | admin | `course_overrides.py` | Add a new course |
| PATCH | `/api/courses/overrides/<code>` | admin | `course_overrides.py` | Edit a course (creates the override); `requirements` changes only the keys it names (12.2) |
| POST | `/api/courses/overrides/<code>/archive` | admin | `course_overrides.py` | Hide a course |
| POST | `/api/courses/overrides/<code>/restore` | admin | `course_overrides.py` | Unhide |
| DELETE | `/api/courses/overrides/<code>` | admin | `course_overrides.py` | Revert a scraped course to the scrape (added courses cannot be reverted, only archived) |
| POST | `/api/courses/overrides/batch` | admin | `course_overrides.py` | Change what several courses count for at once (`{"items": [{"course_code", "requirements"}]}`, at most 200): one transaction, one `course.update` event per course |
| GET | `/api/minors/overrides` | public | `minor_overrides.py` | All minor settings (`Cache-Control: no-cache`); who saved each one (`updated_by_email`) only for admins |
| PATCH | `/api/minors/overrides/<code>` | admin | `minor_overrides.py` | Set a minor's `total_units`, `max_with_major`, `max_with_other_minors` or `admin_note` (12.6) |
| DELETE | `/api/minors/overrides/<code>` | admin | `minor_overrides.py` | Back to what `minors.json` says |


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
| `course_overrides` | `CourseOverride` | `course_code` (unique), `is_new`, `archived`, `fields` (JSON text), `requirements` (JSON text), `updated_by_*` | `requirements` is one change per program or minor (12.2). |
| `minor_overrides` | `MinorOverride` | `minor_code` (unique), `fields` (JSON text: only the values that differ from `minors.json`), `updated_by_*` | Minor settings (12.6). |

`backend/db_schema.py` `REQUIRED_TABLES` lists all 15. `backend/models.py` is the source of truth for the schema.

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

From November 3, 2026 production `/health` on Render reported `"tables": 14` (the admin page and sign-in analytics were deployed); on November 11, 2026 the Render web service answered 503 "This service has been suspended by its owner" instead. The deploy created `admin_audit_events`, `course_overrides`, `sign_in_events` and `user_activity_days` through `create_all()` and backfilled sign-in history once (section 13.2). `minor_overrides` (November 2026) is a new table, so the next bootstrap creates it with no migration step, and the count becomes 15.

---

## 12. Course overrides (admin catalog edits)

### 12.1 Why they exist

`frontend/data/courses.json` is rebuilt from the SOC every day by the daily update on the server (14.2), and on every deploy (15.16). Any manual edit to that file would be overwritten. So admin edits are stored in the `course_overrides` table and applied by the browser after it loads the file.

### 12.2 Data model

One row per course code:

- Scraped course edited: `is_new = false`, `course_code` = the catalog code (even if the admin renumbers it; the new number is stored inside `fields.course_code`), `fields` = only the changed fields (`course_name`, `department`, `units`, `description`, `prerequisites`, `offered_qatar`, `offered_pitts`, `offered`, optionally `course_code`).
- `requirements` = what the course counts for, as a change to the catalog per program and per minor, or null:

  ```json
  {"CS": {"add": [{"requirement": "GenEd---Humanities and Arts---C. Humanities and Arts Electives", "type": true, "major": "CS"}],
          "remove": ["BS in Computer Science---Computer Science---Computer Science Core"]},
   "MINOR:psychology": {"add": ["statistics---intro_stats"], "remove": ["survey"]}}
  ```

  A key that is present means that program (or minor) is edited for this course; a missing key follows the catalog (or `minors.json`) as it is, including what the daily pipeline adds later. So a fix keeps exactly the admin's decision (a removed row stays removed, an added row stays added) while everything else keeps flowing in. Minor values are category paths: category ids joined by `---`, as the minor trees build them, and only categories that hold courses.
- A list value (`"CS": [rows]`) is the whole list shape the editor saved before November 10, 2026. The browser still applies it, as the rows of its own program only (old `earlier` flags on it are ignored), and the editor flags it; the API never writes one again (12.7 converts them).
- Course added by an admin: `is_new = true`, keyed by its own code; renumbering moves the key. Its `requirements` are changes against an empty catalog, so additions only.
- `archived = true` hides the course from everyone; nothing is deleted.
- If an edit leaves a scraped course identical to the scrape (no fields, no requirements, not archived) the row is deleted.
- `updated_by_id`, `updated_by_email` and `updated_at` record the last save. Everyone reads the edits (`GET /api/courses/overrides`), but only an admin's request gets `updated_by_email`, for the editor's "Last edited ... by" line; other visitors, guests included, get the edits without it. `minor_overrides` works the same way.

### 12.3 Validation rules (`course_overrides.py`)

Code must match `NN-NNN`. Name 1 to 200 chars, description up to 5000, prerequisites up to 1000; each must be text (null empties the description or the prerequisites). Students read these texts, so like category paths they may not contain long dashes (U+2012 to U+2015, the characters the dash guard tests look for); the message names the field, for example "Use plain hyphens in the course name, not long dashes." The editor sends only the fields an admin changed, so a save is refused only for text the admin typed. Department is the numeric department code (for example `15`). Units 0 to 48. Offered semesters must match `^[FSMN]\d{2}$`.

What a course counts for:

- A key is a program in `CS IS BA BS AI GS`, or `MINOR:<code>` for a minor of `minors.json`. A value is `{"add": [...], "remove": [...]}` (at most 200 each), or null, which puts that key back to the catalog. `PATCH` changes only the keys it names and keeps the others; when nothing is left, `requirements` becomes null.
- A program path has at least two parts joined by `---`, each trimmed and not empty, at most 400 characters and no dash punctuation, and starts with `GenEd` or the program's degree root (`BS in Computer Science`, `BS in Information Systems`, `BS in Business Administration`, `BS in Biological Sciences`, `BS in Artificial Intelligence`, `BS in General Studies`). The Gen Ed flag (`type`) comes from the root, whatever the client sends, and any other field of a row (for example an old `earlier` flag) is dropped.
- A minor path must be one of that minor's categories that hold courses. `backend/minors_file.py` reads `frontend/data/minors.json` (cached by its modification time), so a minor added to the file is accepted with no code change; when the file cannot be read, the minor must be in `VALID_MINORS_FOR_PATCH` and a path must look like category ids joined by `---`.
- Duplicates are dropped, and a path both added and removed is refused. A list value is refused with `stale_page` ("This page is out of date. Reload it and try again."), so a tab opened before the change cannot freeze every program again.
- The server does not check that a path is a 2026-27 category; the editor does (12.5).

### 12.4 How the browser applies them

`App._prepareCatalog()` calls `fetchCatalog()` and `fetchMinors()`, then `apiGetCourseOverrides()` and `apiGetMinorOverrides()` together (10 s timeout each; on failure it logs a warning and shows the plain files), then `_buildCatalog()`: `applyMinorOverrides()` on a copy of the minor file, `applyCourseOverrides()` (each program key through `applyProgramEdit()` on that program's catalog rows; minor keys to `course._minorEdits`), the index, `buildMinorIndex()` (which applies the minor edits, 8.10) and the trees. Overrides match exact codes. After every save the editor calls `_reloadCatalog()` to rebuild from scratch.

The overrides are applied after the pipeline output, so the daily update needs nothing from the editor and the changes survive it (an admin's removal of a course that a rule bucket adds stays removed). What the pipeline must respect: bucket paths stay stable. A rename needs an entry in `backend/data/requirement_path_renames.json` and a run of `migrate_override_paths.py` (12.7); otherwise a change on the old path does nothing (a removal) or makes a ghost bucket (an addition), which the editor's Check these filter lists.

### 12.5 Using the course editor

Admin page, **Courses** tab, **Courses** view: search by number or title, filter (all, Edited, Added here, Check these, Archived), open a course (or press **Edit course data** on its course card), edit the fields and what it counts for, then Save. Under each edited course the list says what changed, for example "Units · Computer Science: 1 added, 1 removed · Psychology minor: 1 added".

- **What it counts for**, one group per major. The pick list is the 2026-27 catalog: the categories of the scraped catalog before any edit, plus the empty buckets of `data/requirement_buckets.json` (tracked in git and rewritten by every pipeline run, 14.5.1; the editor loads it when the Courses tab opens, and without it offers the scraped categories only). A category under another program's root is refused. A category that is not in the list is added only after a confirmation and is tagged **Not in the 2026-27 catalog**; the **Check these** filter lists every course whose edits use one (or a minor category the minor file does not have, or a list saved before the change). A category typed into a "Pick or type" box but never added with its Add button is added on save when it is in the list; otherwise the save stops with a notice.
- A row the admin added says **Added here**. A catalog row the admin removed stays listed, struck through, as **Removed here**, with **Put back**. An edited group says **Edited here** and has **Reset to the catalog**. When CS and AI list the same Gen Ed category (AI's general education rows are copies of the SCS rows CS uses), the editor reminds you to change it in both.
- **Minors**: the minor categories the course fills (From the minor file, or Added here), the removed ones with Put back, and a picker of every minor category that holds courses.
- Save sends, per program and per minor, only the change from the catalog, and only for the keys that differ from what is stored; a group set back to the catalog sends null. A list saved before the change shows a notice ("These categories were saved before the 2026-27 catalog names.") and saving turns it into a change against today's catalog.

A successful Add course or Save changes opens a confirmation screen (`_renderCourseSaved` in `js/app.js`, state `_courseAdmin.view === 'saved'`) listing what changed; validation errors appear in the `#ce-notice` box next to the buttons, not as toasts. Buttons: Archive, Restore, Undo all edits (drops all edits of a scraped course). Saving under a number another row or an archived row already has is refused. "Add course" creates a new course. Every action is in the Activity log, which says what changed and has an Open button per course.

**Courses in a category** (the second view) is for group decisions, such as a rule bucket: pick a major or a minor and one of its categories to see all its courses, the ones added and removed here included; remove or put back one course or the selected ones, or type course numbers to add. Each course keeps its own change, and all of them are saved in one `POST /api/courses/overrides/batch` (one transaction, one event per course).

### 12.6 Minor settings

`frontend/data/minors.json` is built by hand (4.4) and some of its numbers are open questions (double counting limits, unit totals). The **Minor settings** view of the Courses tab (also opened with **Edit minor settings** in the Minors tab) corrects them for everyone without editing the file: `total_units` (a whole number, or empty when the minor states none), `max_with_major` and `max_with_other_minors` (0 to 10, or No limit) and `admin_note` (up to 1000 characters, shown to students in the minor's header as a note from CMU-Q; long dashes are refused with "Use plain hyphens in the note, not long dashes.", the rule the minor file's own text follows). They are stored in the `minor_overrides` table (`backend/minor_overrides.py`, `/api/minors/overrides`: read by everyone, with who saved them for admins only, and written by admins), one row per minor with only the values that differ from the file; a value set back to the file's is removed, and **Undo all edits** deletes the row. The browser applies them with `applyMinorOverrides()` (8.10). Which courses fill a category is a course edit instead (12.2).

### 12.7 Edits saved before the 2026-27 names

Before November 10, 2026 the editor saved the whole "counts for" list of every program of a course, in the bucket names of the time. `python -m backend.migrate_override_paths` updates them (15.8 step 8). With `--baseline FILE` it renames both the saved list and that course's baseline rows with `backend/data/requirement_path_renames.json` (its `per_course` exceptions first) and keeps only their difference, as a change; a program the old editor saved without a change goes back to the catalog. Without `--baseline` it renames the paths in place and keeps the list for a look in the editor.

The baseline must be the catalog those edits were saved against: `main`'s `data/courses.json` at `79e29ec` (`git show 79e29ec:data/courses.json > FILE`). Production served the same requirement rows from November 3, 2026, when the editor shipped, and still did on November 11. A catalog of the `cleanup` branch is the wrong baseline: its Psychology rows moved to the department's new numbers (14.6), so an edit saved on a new number (85-150 had no rows in production) would turn into removals of the rows that moved onto it. The script refuses a baseline without rows for the old numbers in `PRODUCTION_ONLY_CODES` (85-211, 85-219, 85-221, 85-241, 85-253, 85-261, 85-340, 85-359, 85-377 and 85-442: production's catalog has rows for them, and no catalog from November 9, 2026 on does), before it reads the database.

It prints the database it reads, the baseline, every course, each program before and after, and every path that is still not in today's catalog. It is a dry run unless `--apply`, which writes the rows, deletes a row left with no edit, and adds one `course.migrate` event per course. `backend/tests/test_migrate_override_paths.py` converts saved edits of 26 Psychology numbers against production's rows (`backend/tests/data/production_psychology_rows.json`) and checks that only the admin's change is left: the 24 numbers whose rows differ between production's catalog and the `cleanup` catalog of November 9, 2026 (`174e856`), and 85-482 and 85-798, which only the latter has.

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

The catalog the app loads, `frontend/data/courses.json`, is built from three things: the base catalog (the file itself, with the requirement mappings that came from the upstream project), the Schedule of Classes scrape (`backend/data/soc.json`) and the Qatar overlays and catalog rules (`backend/data/mapping_overlays.json`). On the CMU-Q server a daily system cron job rebuilds it in place (14.2). Nothing commits data to git any more. Until the cutover, the old GitHub Actions workflow on `main` still runs (14.9).

### 14.1 Data rules (do not break)

1. **The SOC scrape is the rule.** Offerings, campus, units and titles come from it. When the SOC and another source disagree about what is offered, the SOC wins.
2. **Qatar information lives only in `backend/data/mapping_overlays.json`.** Never hand-edit `courses.json` for content, and never put Qatar facts into the scraper or reconcile code.
3. **Never infer a renumbering.** Treat an old and a new number as the same course only when an official source says so (the Psychology department's renumbering list, the H&SS Course Offerings sheet, an official minor file). Same titles, same meeting times or the validator's warnings are hints, not evidence. Every Psychology number follows the department's list (14.6).
4. **The catalog is the base and the sheet only adds.** The mappings in `courses.json` come from the upstream catalog; the H&SS sheet and the other overlays only add mappings. A mapping is removed only by an explicit `remove_mappings` entry with a reason, or, for a row a rule bucket added (`"source": "rule"`), by the rule step when its course no longer meets the rule (14.5.1).
5. **The pipeline never deletes catalog rows**, with one exception: a row under an old Psychology number that the department's list retires (no course has that number now) moves to its new number and is deleted (14.6): its mappings, text, SOC sections and offered semesters go to the new number. The published catalog has no such rows, so none is ever lost. Rows the SOC no longer lists keep their history. The daily update refuses to publish a catalog that lost any course code.

### 14.2 The daily update on the server

Cron (`/etc/cron.d/countsfor`, from `deploy/countsfor.cron`) runs `backend/scraper/run_scrape.sh` as the `countsfor` user every day at 15:00 server time. The script refuses to run as any other user (it compares `id -un` with the owner of `backend/data/`; `CF_ALLOW_ANY_USER=1` skips the check), because a run as root would leave root-owned files in `backend/var/` and the data folders that make every later cron run fail. It then sources `/etc/countsfor/scraper.env` (template: `deploy/scraper.env.example`; every setting is optional), changes to the deploy root and runs `backend/scraper/update_data.py` with the virtual environment's Python. `update_data.py`:

1. Takes an exclusive lock on `backend/var/update.lock` (flock). If another update holds it, it exits 75. If the lock file cannot be opened at all (for example it belongs to root after a run as root), it logs why and how to fix the ownership, and exits 1. Cron also wraps the run in `flock -n /run/lock/countsfor-scrape.lock` and `timeout 3h`.
2. Runs the SOC parser tests, as the old workflow did: `python -m pytest backend/scraper/tests/test_scrape_soc.py backend/scraper/tests/test_soc_parse.py` (44 tests). `--skip-tests` skips them.
3. Copies the live `backend/data/soc.json` and `frontend/data/courses.json` into `backend/var/staging/` (`CF_STAGING_DIR`). `scrape_soc.py` carries old semesters forward from the file it overwrites, so it must start from a copy of the live file. `apply_mapping_overlays.py` writes `requirement_buckets.json` next to the staged catalog.
4. Runs the four pipeline steps of 14.3 on the staged copies, stopping at the first failure: `scrape_soc.py`, `reconcile_offerings.py`, `apply_mapping_overlays.py`, `validate_soc_coverage.py`. `--no-scrape` skips the scrape and rebuilds the catalog from the live `soc.json` (after a deploy, or after you change `mapping_overlays.json`).
5. Checks the result. It publishes only if both files parse; `metadata.last_scrape` is set (and changed, when this run scraped); every semester and campus present in both the live and the new `soc.json` keeps at least `CF_MIN_SECTION_RATIO` (0.98) of its live section count; and the catalog keeps at least `CF_MIN_CATALOG_RATIO` (0.95) of its rows and loses no course code; `requirement_buckets.json` must parse as `{program: [paths]}`.
6. Publishes with `os.replace`: `courses.json` (the old one kept as `courses.json.prev`), then `courses.json.gz` (gzip level 9, which Apache sends to browsers that accept gzip: about 1 MB instead of 19 MB), then `requirement_buckets.json` (no `.prev`: it is rebuilt from the catalog on every run), then `soc.json` (the old one kept as `soc.json.prev`). Files are mode 644. A file that is unchanged byte for byte is not rewritten, so its modification time and ETag stay and browsers keep their cached copy; `soc.json` is still updated, so the admin Overview shows the last successful scrape.

Exit codes: 0 published (or nothing changed), 1 failed, 75 another update is running. On any failure the live files stay as they were and the staged files stay in `backend/var/staging/` for inspection until the next run. Every log line starts with a timestamp, and each step's output is prefixed with the step name, for example `2026-11-08T15:41:12+03:00 [validate_soc_coverage] OK: every SOC course is present in courses.json.` Read the log with `tail -n 50 /var/log/countsfor/scrape.log`.

It does not commit or push anything, and it does not run `scripts/bump_cf_build.py`: Apache sends the data with `no-cache` and an ETag, so browsers ask for it again on every load and get a 304 when nothing changed. Tests: `backend/scraper/tests/test_update_data.py` (no network; success with a fake scrape, each failing step and each check leaves the live files untouched, the bucket list is published only when it changed, the lock, `--no-scrape`, and the real reconcile, overlay and validation steps on a copy of the repo data).

Settings (`/etc/countsfor/scraper.env`): `CF_DEPLOY_ROOT` (default: the folder that holds `backend/`, which is `/var/www/html/countsfor` on the server and the repo root in a checkout), `CF_STAGING_DIR`, `CF_MIN_SECTION_RATIO`, `CF_MIN_CATALOG_RATIO`, plus the scraper settings in 6.2 and `https_proxy` if the server needs an outbound proxy.

### 14.3 What each step does

1. **Gate:** the two parser test files (14.2 step 2).
2. **`scrape_soc.py`:** scrapes every semester on the SOC form for Pittsburgh and Qatar, all departments, and records the form's semesters in `metadata.semesters_on_form` (the app's semester list; with `SEMESTERS_TO_TRY` it scrapes only those, and still records the form's list). If it cannot read the form's semester dropdown it stops and writes nothing: no semester list is kept in code. It writes `soc.json` only if the scrape is non-empty and above `MIN_COURSES_FOR_VALID_SCRAPE` (100; `MIN_COURSES_FOR_SUMMER_SCRAPE`, 10, for summer). A semester below the threshold counts as not released yet and its previous data is kept. Rows are split on `</tr>`, because only the first row of each course has an opening `<tr>` (the first header-based parser, before November 8, 2026, read only complete `<tr>...</tr>` pairs and kept only the first section of each course; that output was never adopted). Columns are read from each table's header, so the summer Session column does not shift cells. Cancelled sections are kept with `cancelled: true`; a table without a header is skipped rather than guessed. Pages are decoded with the charset the server declares (the SOC sends ISO-8859-1, read as windows-1252), so accented titles such as "Production Prep: L'étoile" are kept; before November 8, 2026 they were decoded as UTF-8 and the letter became U+FFFD. Semesters from earlier runs that have left the form stay in `soc.json`: their sections are history. A full scrape takes 30 to 90 minutes with polite delays.
3. **`reconcile_offerings.py`:** merges SOC sections into `courses.json` (offerings, campus flags, units), and writes the form's semester list, newest first, as `soc_semesters` at the top of `courses.json`: the semester picker lists exactly these, and "All semesters" means them. Sections of semesters that have left the form stay in the offerings as history (the course card lists the semester under Offered), but the picker does not list those semesters and no filter shows their sections. Without `metadata.semesters_on_form` in `soc.json` it writes no list and prints a `WARNING`; the app then lists the semesters its offerings have. Cancelled sections do not count as offerings and do not set `offered_qatar` or `offered_pitts`. For each field the newest semester wins (within a year: spring, then summer, then fall). `course_name` becomes the newest SOC title after `clean_soc_title()` (the catalog name stays only when cleaning leaves nothing). A title with a "TBA" placeholder, such as "Production Prep: TBA 5", is used only when no semester has another title. When the old name and the SOC title share no words, the number was probably reused: the old name, cleaned with `clean_soc_title()`, goes into `previous_course_name` (an existing `previous_course_name` is kept) and the code is printed under `REVIEW`; a SOC title that matches the stored `previous_course_name` is not a reuse. Mappings are never removed here. A SOC course missing from the catalog gets a new row (`soc_ingested`). `offered` on those rows is rebuilt from their SOC offerings for every semester in `soc.json`, so a semester that does not list the row, or lists it with only cancelled sections, drops out, and `offered` can become empty; semesters `soc.json` does not hold are kept, and a row that is no longer in `soc.json` at all keeps its `offered` unchanged. Catalog rows keep their history. Malformed SOC data is ignored, not deleted: a course whose units cell is not units (a number, a range or list of numbers, or VAR; the old fixed-column parser put the summer Session text such as "qatar summer" there) and a section whose section cell is not a section id (`soc_parse.usable_sections`) give no offerings, campus flags, titles or new rows; a course whose sections are all cancelled or malformed, with at least one malformed, is ignored whole (`soc_parse.is_ignored_course`, also used by step 5), and a semester where a `soc_ingested` row appears only as malformed data stays in its `offered`. Reconcile prints the ignored counts per semester (`IGNORED malformed SOC data in M25: 90 course(s), 827 section(s)`). It does **not** create requirement mappings.
4. **`apply_mapping_overlays.py`:** first runs the daily step of the Psychology renumbering list (14.6), then applies `backend/data/mapping_overlays.json` (14.5): additive mappings, rule buckets, mapping removals, Qatar visibility, campus overrides, and writes `requirement_buckets.json` next to the catalog. It fails, without saving, if either file is invalid or the overlay file names a retired old Psychology number. It prints the renumbering line (`courses.json: renumbering created=0 merged=3 (85-251->85-151, 85-294->85-501, 85-482->85-503) sections=4`, with the number of SOC sections the old numbers gave their new numbers), one line per rule (`rule cs-scs-electives: matched=194 added=0`) and a `NOTE` for a rule addition the catalog has no row for (for a retired Psychology number it names the new one: `85-314 (a retired Psychology number, now 85-370)`). It then prints a verification line (`verify courses.json: OK IGI=60 missing=[]`) and an audit line (`audit courses.json: OK checked=19 gaps=0`).
5. **`validate_soc_coverage.py`:** fails if `soc_semesters` in the catalog is not the form's list in `soc.json` (it prints `Semester picker (soc_semesters): S27, F26, M26, S26, F25, as on the SOC form`), and if a SOC course is missing from the catalog (courses with only cancelled sections and courses reconcile ignores as malformed are not required; a course under a retired old Psychology number counts as present when its new number has a row, and is printed, 14.6). It also fails if any semester the newest scrape wrote (`scraped_at` equal to `metadata.last_scrape`) has malformed data, because the current parser should produce none and the pipeline would silently drop those courses; semesters carried forward from older scrapes, such as M25, are allowed. It also prints a `WARNING` (not a failure) listing same-department, same-title pairs where one row is outside the SOC (45 pairs on November 10, 2026; the two in Psychology are 85-420 against 85-473 and 85-873, 14.6), so possible renumberings show up in the log. Nothing is changed automatically.

### 14.4 Run the pipeline by hand

Locally, from the repo root:

```bash
source .venv/bin/activate
python -m pytest backend/scraper/tests -q            # 295 tests
python backend/scraper/update_data.py --no-scrape    # rebuild frontend/data/courses.json from backend/data/soc.json
python backend/scraper/update_data.py                # full run: scrape, rebuild, check, publish (30 to 90 minutes)
git diff --stat
```

`update_data.py` works in a checkout exactly as on the server (its deploy root defaults to the folder that holds `backend/`). It also writes `frontend/data/courses.json.gz` and, when a file changed, `courses.json.prev` and `soc.json.prev`; all three are gitignored. `frontend/data/requirement_buckets.json` is tracked, like the catalog. You can also run the steps one by one, which writes the files in place without the checks:

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
    {"course_code": "85-426", "programs": "all", "reason": "..."}
  ],
  "rule_buckets": [
    {
      "id": "cs-scs-electives",
      "program": "CS",
      "path": "BS in Computer Science---Computer Science---Two School of Computer Science electives",
      "type": false,
      "select": {
        "prefixes": ["02", "05", "07", "10", "11", "15", "16", "17"],
        "min_number": 200,
        "max_number": 599,
        "min_units_per_course": 9,
        "include": ["02-180", "05-180", "07-180", "16-180", "15-195", "15-295"],
        "exclude": ["02-201", "...", {"from": "17-300", "to": "17-399"}]
      },
      "source": [{"file": "backend/data/sources/catalog-2026-27/majors/computer-science-bs.html", "heading": "..."}],
      "note": "..."
    }
  ],
  "qatar_visibility": [],
  "campus_overrides": [
    {"course_code": "82-289", "campus": "Qatar", "note": "..."}
  ],
  "catalog_buckets": {
    "CS": ["BS in Computer Science---Computer Science", "..."]
  }
}
```

`apply_mapping_overlays.py` applies the sections in this order, in one step. Running it twice gives the same file. Before them it runs the daily step of the Psychology renumbering list (14.6), so the file names new Psychology numbers only: an entry naming a retired old number fails the step.

1. **`overlays`**: additive mappings. `create_missing: false` skips (with a warning) a code the catalog lacks instead of creating a `manual_seed` row. `ensure_course_defaults_codes` limits `ensure_course_defaults` (and creation) to those codes.
2. **`rule_buckets`**: buckets the 2026-27 catalog defines by a rule instead of a list (14.5.1). Every course row that meets a rule gets a row tagged `"source": "rule"`; a tagged row whose course no longer meets its rule is removed. Rows without the tag are never touched.
3. **`remove_mappings`**: removes the requirement rows of the listed programs (`["BA", "BS"]` or `"all"`, which covers CS, IS, BA, BS and AI). It runs after steps 1 and 2, and both skip those programs, so nothing re-adds them: 85-426 stays without rows although the BA Scientific Reasoning rule (85-102 or higher) selects it. 03-351 loses only its AI row (an older audit copy of a CS row): it is cross-listed with 02-262, which has its own AI rows, and the SCS Science and Engineering rule rules it out (14.10). 85-414 has no entry since the Psychology renumbering (14.6), so the rules count it like any other course. An AI list a removal empties goes, as on every course without AI rows.
4. **`qatar_visibility`**: an entry `{"course_code": "...", "rule": "show_only_if_offered_qatar", "note": "..."}` sets `qatar_only`, and the app hides the course everywhere unless its SOC offerings include the Qatar campus. The list is empty since November 11, 2026: its one entry, 85-100 Introduction to Psychology, was removed when the user asked to show the course (14.6).
5. **`campus_overrides`**: a course the SOC lists at the wrong campus. Every SOC offering of a listed course gets the listed campus (`Qatar` or `Pittsburgh`), and `offered_qatar` and `offered_pitts` follow (the listed campus true, the other false). Only listed codes change; the scraper and reconcile keep the campus the SOC gives and never read a campus from a title. The one entry, 82-289 Tutoring for Community Outreach - CMUQ in Qatar, was hard-coded in the scraper (`CAMPUS_FIXTURES` in `soc_parse.py`, with a rule that read "CMUQ" or "Qatar only" in a title as Qatar) until November 11, 2026. It changes nothing today: the SOC lists the S26 and S27 sections of 82-289 in Qatar, and no other title matched that rule.

`qatar_only` belongs to step 4: a row the file no longer lists loses it. Use the file for mapping fixes that should live in git and apply to every deploy; use the admin course editor for quick fixes by non-developers. After you change the file, deploy it (15.16), which runs `--no-scrape`. Tests: `backend/scraper/tests/test_mapping_overlay_sections.py` (also checks that every requirement path in the file exists in `frontend/data/courses.json`) and `backend/scraper/tests/test_is_igi_modern_languages.py`.

#### 14.5.1 Rule buckets (`rule_buckets`) and the bucket list

Where the 2026-27 catalog defines a bucket by a rule instead of a list ("any SCS course, 200-level or above, at least 9 units each"), the bucket counts every course that meets the rule (decision of November 10, 2026). The overlay step expands each rule against every course row on every run, so a new SOC course counts from the next daily update, and a course that stops meeting its rule loses its rule row.

An entry has `id` (a slug, not also an overlay id; the log prints it), `program`, `path` (the catalog bucket, which must be listed in `catalog_buckets`), `type` (true for a `GenEd` path), `select`, `source` (the archived catalog page or pages in `backend/data/sources/catalog-2026-27/` and the heading the rule is under) and `note` (how the rule was read). `select` holds:

- `prefixes` (two digit subject codes) with `min_number` and `max_number` (both inclusive), `ranges` (`{"from": "85-102", "to": "85-599"}`, one subject per range), or both;
- `min_units_per_course` (optional);
- `include`: the catalog's additions. They count whatever their number or units;
- `exclude`: the catalog's deletions, codes or ranges (`{"from": "36-000", "to": "36-999"}`);
- `non_technical: true` where the catalog limits the bucket to nontechnical courses and names the technical ones by list (that list is `exclude`). Without such a list the flag is left out.

How a course is matched:

1. A course in `include` matches. Otherwise it must not be in `exclude`, its number must fall in a prefix range or in one of `ranges`, and with `min_units_per_course` it must be able to carry that many units: the most of its numeric `units` and of every number in the units of its SOC offerings (cancelled sections left out). A `3-12` or `3,6,9,12` offering counts as 12, so a variable unit independent study can match; a `VAR` offering holds no number, so the numeric `units` decide (0 for a course the SOC lists only as VAR).
2. Each rule states its number range. Graduate courses (600 and above) are left out: no rule covers them ("200-level or above" is read as an undergraduate floor; an advisor may still allow a graduate course, which an admin adds by hand). Numbers below 100 (study abroad, internships, practica, seminars) are left out unless the rule names them: BA's "84-001 or higher" and BS's "82-xxx Any course from Modern Languages" (study abroad courses count there).
3. Rows the overlay step created (`manual_seed`) never match.
4. A course that already has a row on the bucket (from the catalog, the older CMU-Q audits or an overlay) gets no second row. Rows without the tag are never changed or removed by this step. When an overlay states a row a rule added, the overlay takes the row over (its tag goes).
5. `remove_mappings` wins: the step skips the programs `remove_mappings` lists for a course.

The rules (November 10, 2026, before the Psychology renumbering). "Rows" counts the courses on the bucket in `courses.json` before and after the rules; "Doha" counts the added courses that the SOC offers at the Qatar campus.

| Rule | Bucket | Rule as written | Rows | Added (Doha) |
|---|---|---|---|---|
| `cs-scs-electives` | CS: Two School of Computer Science electives | 02, 05, 07, 10, 11, 15, 16, 17; 200 to 599; 9 units or more; the CS page's additions (the first year minis, 15-195 and 15-295) and deletions | 101 to 219 | 118 (5) |
| `cs-science-engineering` | CS: GenEd Science and Engineering | 03, 06, 09, 12, 18, 24, 27, 33, 42; 100 to 599; 9 units or more; the catalog's and the official SCS list's additions and deletions, plus the courses the page rules out as cross-listed with SCS or affiliated with IDeATe (named in the note) | 153 to 331 | 178 (2) |
| `cs-humanities-arts-c` | CS: GenEd C. Humanities and Arts Electives | the Dietrich College and College of Fine Arts departments (48, 51, 54, 57, 60, 62, 65, 66, 76, 79, 80, 82, 84, 85, 88); 100 to 599; 9 units or more; the additions (Tepper and other schools); the deletions, with all of Statistics (36), Information Systems (67) and Economics (73) except the additions; non technical | 743 to 1476 | 733 (9) |
| `ai-scs-electives` | AI: School of Computer Science Electives | as CS, with the AI page's own additions (the first year minis and the 07-599 thesis) and deletions | 478 to 199 | 37 (10), 316 removed |
| `ai-science-engineering` | AI: GenEd Science and Engineering | the CS rule: the AI page sends this component to the SCS General Education page | 135 to 313 | 178 (2) |
| `ai-humanities-arts-c` | AI: GenEd C. Humanities and Arts Electives | the CS rule, for the same reason | 738 to 1471 | 733 (9) |
| `ba-scientific-reasoning` | BA: University Core 2, Scientific Reasoning | 03-100, 09-100, 02-100, 15-100, 33-100, 85-102 and 16-100 or higher (to 599) | 230 to 424 | 194 (6) |
| `ba-information-literacy` | BA: University Core 3, Information Literacy | 80-100, 67-100 and 88-100 or higher (to 599) | 120 to 234 | 114 (5) |
| `ba-global-perspectives` | BA: University Core 4, Global, Cultural, and Diverse Perspectives | 79-100, 76-200, 84-001 and 82-100 or higher (to 599) | 480 to 757 | 277 (7) |
| `ba-business-electives` | BA: Business Electives | 70-300 to 70-399, 21-270, 73-300 to 73-599 | 165 to 173 | 8 (1) |
| `bs-cultural-global-languages` | BS: GenEd D. Cultural/Global Understanding Course | the list's rule line "82-xxx Any course from Modern Languages" (82-000 to 82-599); the rest of the list stays as list rows | 322 to 322 | 0 |
| `bs-nontechnical-electives` | BS: GenEd E. Nontechnical Elective Courses | the College of Fine Arts, Tepper and Dietrich College (48, 51, 54, 57, 60, 62, 70, 73, 36, 65, 66, 67, 76, 79, 80, 82, 84, 85, 88); 100 to 599; the MCS additions and deletions; non technical | 732 to 2300 | 1568 (79) |

In all, 4,138 rows were added (135 on courses offered in Doha, for example 85-458 Psychology of Sleep, which now counts for BA Scientific Reasoning, CS and AI Humanities and Arts electives and BS Nontechnical electives) and 316 removed, all from the AI School of Computer Science Electives (below). No row outside the rule buckets changed. Catalog buckets the rules do not cover (lists, "others as designated", free electives) are not rule buckets.

After the Psychology renumbering (14.6), the rules count the new numbers like every other course. The run after the migration (November 10, 2026) added 58 rule rows, all on Psychology rows: BA Scientific Reasoning 17, BS E. Nontechnical Elective Courses 17, and the CS and AI C. Humanities and Arts Electives 12 each. They went to 85-414 Cognition in the Age of AI (BA and BS only: the SCS Humanities and Arts Deletions list names it) and to 16 of the 18 rows created from the list (85-104, 85-109, 85-200, 85-303, 85-400, 85-402, 85-415, 85-420, 85-430, 85-431, 85-432, 85-451, 85-455, 85-457, 85-459 and 85-504; the ones with 0 units, such as 85-200, get only BA and BS, whose rules set no unit minimum). The other two, 85-151 and 85-418, already have those buckets from the mappings of their old numbers. The rule rows of the 11 deleted old numbers went with their rows, and the moved mappings of old 85-414 took over 85-472's BA and BS rule rows. The rule lists keep the codes the 2026-27 pages print: the SCS Science and Engineering list names 85-314 next to 85-370 (the same course, Cognitive Neuroscience Research Methods), so the overlay step prints a `NOTE` that 85-314 is a retired Psychology number, now 85-370.

AI is new and has no older version (decision 3). Its School of Computer Science Electives rows were the AI page's rule written out once by the move to the catalog names (14.10: every SCS course in `courses.json` that met the rule, graduate courses included), so on November 10, 2026 those 478 rows were tagged as rule rows and the rule now keeps them: 162 stay, 37 were added (the first year minis, AI's required 07-280, 07-380, 15-210, 15-213 and 15-251, independent studies that can carry 9 units or more, and SCS courses the SOC does not list) and 316 went (graduate courses). 07-599, the SCS Honors Undergraduate Research Thesis, is one of the AI page's additions: the page counts up to 18 units of it toward SCS elective requirements, while the SOC lists it only as VAR (3 units in the catalog), which no unit minimum can read. It was removed by the first version of the rule and is back since November 10, 2026. No other row was tagged. The AI Science and Engineering and Humanities and Arts electives rows are the CS rows (without the older audit rows decision 3 removed), and like the CS, BA and BS rows from the older audits they count as they are (decision 2): the rules only add to them. Units are not a safe reason to remove a row: a course the SOC does not list often has placeholder units (3) in `courses.json`.

Read with care, and fix in the admin course editor (12.5) where an advisor disagrees:

- **BS E. Nontechnical Elective Courses.** The MCS Deletions list says it is not exhaustive, and the rule adds every Dietrich, CFA and Tepper course it does not name, also technical ones: 29 Statistics (36) courses such as 36-218, 77 Information Systems (67) courses such as 67-262 and 67-272, and Tepper analytics courses such as 70-374 and 70-467.
- **CS and AI Humanities and Arts electives.** The page's other test, a humanities or arts course with a computer science or mathematics prerequisite does not count, is not a list and is not applied (for example 65-200 and 65-203, Applied Quantitative Social Science).
- **Variable unit courses** (independent study, research, practicum) match a 9 unit minimum when they can be taken for 9 or more units, for example 15-591 to 15-593 for the SCS electives. They count only when taken for that many units, with the advisor's approval.
- **Courses the SOC does not list.** Their units in `courses.json` are often a placeholder (3), so a rule with a 9 unit minimum leaves them out until the SOC lists them with their real units.
- **Required courses.** A course counts once. The CS School of Computer Science electives list the CS core (from the older audit), and the AI ones now list AI's required 07-280, 07-380, 15-210, 15-213 and 15-251, because the rules do not exclude them.
- **Numbers below 100.** 48-095, 82-080 and 18-095 are regular courses of 9 or more units the rules leave out.

**The bucket list.** `catalog_buckets` lists every bucket path per program in the order the tree shows them (degree buckets, then `GenEd`; siblings in rule chip order), parents included, with the catalog buckets that have no rows yet. Each run writes `frontend/data/requirement_buckets.json` next to the catalog it updates: that list, then any row or rule path (or parent of one) the list lacks, sorted. The admin course editor offers these paths. When you add a bucket, add its path to `catalog_buckets` and its rule chip to `js/data.js`; `frontend/tests/catalog-data.test.js` fails until the list covers every row in tree order and every chip names a listed bucket.

Tests: `backend/scraper/tests/test_rule_buckets.py` (prefixes, ranges, levels, units, additions and deletions; stale rule rows go and untagged rows stay; an overlay takes a rule row over; `manual_seed` rows never match; `remove_mappings` wins; a second run changes nothing; invalid rules are refused without saving; the bucket list keeps the catalog order and covers every row; and on the real files: every rule cites archived pages listed in the manifest, every addition and deletion is printed on a cited page or named in the note, no rule reaches graduate courses, the served catalog and bucket list are the pipeline's output, rule rows sit only on rule buckets, and of the rows from before the rules only the AI School of Computer Science Electives rows are rule rows).

### 14.6 Psychology numbers and open data questions

**The renumbering list.** The Psychology department renumbered its courses from Fall 2025. Its official list, provided by the CountsFor maintainer on 2026-11-10, is `backend/data/psychology_renumbering.json`, kept verbatim: one entry per course with `Old Course #`, `New Course #` (`x` means discontinued), `Long Title` and `Units` (a number, `VAR` or null); an old number of `CMUQ` or null marks a new course. The list is one renaming applied all at once, never a chain: 85-314 becomes 85-370 and stops there, although old 85-370 itself becomes 85-413. Its terms (`backend/scraper/psychology_renumbering.py`):

- **renumbered**: an old number whose new number is a different code (46);
- **reused**: a renumbered old number that is also another course's new number (8): 85-104, 85-330, 85-350, 85-370, 85-409, 85-414, 85-418 and 85-432;
- **retired**: a renumbered old number that is no course's new number (38), such as 85-102 (now 85-100) and 85-251 (now 85-151);
- **discontinued**: `x` (19). Their rows stay as past courses with their mappings, except 85-426 (below).

Titles come from the SOC when it lists the course (reconcile keeps setting them); a row created from the list has its Long Title.

**The migration** (`backend/scraper/migrate_psychology_numbers.py`, run once on 2026-11-10: `--dry-run` by default, `--apply` writes, `--report` writes a Markdown report). The requirement rows from the old 2023-24 audits belong to the course that had the number then. Their provenance is `git show 79e29ec:data/courses.json` with the paths translated by `requirement_path_renames.json`, plus the AI rows that mirror those CS rows. For each renumbered number:

- its old course's rows go to the new number;
- a retired number's row also gives its new number every other row and its empty description and prerequisites, and is deleted (11 rows: 85-101, 85-102, 85-251, 85-294, 85-314, 85-360, 85-361, 85-372, 85-407, 85-482 and 85-483);
- a reused number keeps its row for the course that has the number now, with only that course's rows: the old audit rows of its own old number (85-314's for 85-370), and the rows the 2026-27 catalog lists or the H&SS sheet gave the number as it is now (both name current numbers). The old course's other rows leave it. Rule rows (`"source": "rule"`) stay; the rule step recomputes them;
- the offered history before Fall 2025 follows the course too (`correct_history`, from the same provenance): each new number gets the history of its old number, and 85-190 also that of 85-253 and 85-261 (merged into it on 2026-11-09, `EARLIER_MERGES`); a reused number keeps none of its own history from before Fall 2025, which is its old course's. So 85-370 has 85-314's S21 to S25 and 85-413 Perception has old 85-370's F20 to F24; 85-350 has 85-340's history and 85-450 old 85-350's; 85-414 keeps only F25 and 85-472 has old 85-414's S18 to F24; 85-100 has 85-102's S18 to M25. Semesters from Fall 2025 on stay as the SOC gave them. On a row the SOC created (`soc_ingested`), reconcile rebuilds every semester `soc.json` holds, so the history leaves those out: M25, which `soc.json` holds as malformed data only, is not added to 85-150 (from 85-241) and 85-450 (from old 85-350). The first version of the migration moved only the mappings, so the course card listed Perception's falls under 85-370 and `predictOffering()` said 85-370 was "Not offered in Spring in recent years"; the correction ran on 2026-11-10 (15 rows).

New numbers without a row got one from the list (18 rows with `"source": "Psychology renumbering list"`: the Long Title, the units, 0 for `VAR` or none, no offerings, and `offered` set to the old row's history before F25). A moved row is a plain `{requirement, type, major}` row and counts like every other row, older audit rows included (14.10); no empty AI list is left on a row. The result depends only on the provenance, the list, the catalog's rows and the semesters `soc.json` holds, so the script can run again on a catalog that other changes reshaped (with rule rows), and a second run changes nothing. It stops if a number the SOC lists has no row yet (run reconcile first). On the `cleanup` branch it ran after the wave A merges, on the catalog with the rule rows and the trimmed AI rows (6,784 to 6,791 rows), and the overlay step then gave the new numbers their rule rows (14.5.1).

**The daily step** (`psychology_renumbering.apply_renumbering()`, which `apply_mapping_overlays.py` runs before the overlays): a new number without a row gets one from the list, and a retired number that has a row again gives its requirement rows (not its rule rows), its empty text fields, its SOC sections and its offered semesters to its new number and is deleted. Reconcile creates such a row when the SOC still lists the old number: M26 lists 85-251 Personality and 85-482, and F25 to S27 list 85-294. Their sections show under the new number: 85-151 has the M26 section A6, 85-501 the S26 and S27 sections A, and 85-503 the M26 section I. A section counts once by semester, section and campus (`offering_key`: the SOC lists 85-294 A and 85-501 A in F25 and F26), and each semester and campus keeps its lecture then section order (`merge_offerings`). The campus flags follow the sections, so 85-151 now counts as offered in Pittsburgh, and 85-503 meets the 9 unit minimum of the CS and AI Humanities and Arts rules through the 3-12 units of its M26 section (14.5.1, variable unit courses). A reused number's row is never deleted. `validate_soc_coverage.py` counts such a SOC course as covered by its new number and prints it. Running the step again changes nothing. Tests: `backend/scraper/tests/test_psychology_renumbering.py`.

Settled decisions (the Entry column says where each one lives):

| Decision | Entry |
|---|---|
| Every Psychology number follows the department's list (above). Before it, on 2026-11-09, the mappings of 11 old numbers were copied onto their current numbers and the old rows removed (85-104, 85-253 and 85-261 to 85-190, 85-211 to 85-110, 85-219 to 85-170, 85-221 to 85-130, 85-241 to 85-150, 85-377 to 85-452, 85-442 to 85-454, 85-359 to 85-411, 85-340 to 85-350). The list agrees with each of them; 85-253 and 85-261 are not on it. | `psychology_renumbering.json`, the migration, the daily step |
| 85-102 Introduction to Psychology is now 85-100: its mappings are 85-100's and its row is gone. | the migration |
| 85-100 Introduction to Psychology, with 85-102's former mappings, shows like any other course: in search, the major trees and the minors, as a Pittsburgh course while the SOC lists it only in Pittsburgh (F25 to S27). From November 7 to 11, 2026 a `qatar_visibility` entry hid it until the SOC listed a Qatar section (the user, 2026-11-07: "85-102 is a past course not on rotation in Qatar. 85-100 is not in my sheet, so only show it if the Schedule of Classes lists it for Qatar."); on November 11, 2026 the user asked to show it, and the entry was removed. | `qatar_visibility` (empty) |
| The approved H&SS sheet mappings for 85-110, 85-130, 85-150, 85-151, 85-170, 85-190, 85-300, 85-310, 85-364, 85-413, 85-450 and 85-452. The sheet lists Personality as 85-251, which the list makes 85-151. | `overlays`, one `hss-sheet-<code>` entry each |
| 85-414 is now Cognition in the Age of AI (old 85-372). The mappings it had belonged to its old course, Cognitive Neuropsychology, now 85-472, which has them (BA Scientific Reasoning, BS Nontechnical Elective Courses). 85-414 keeps none of them; the 2026-27 rules give it BA Scientific Reasoning and BS E. Nontechnical Elective Courses as rule rows (14.5.1), so it needs no `remove_mappings` entry any more. | the migration, `rule_buckets` |
| 85-350 is now Research Methods in Social Psychology (old 85-340), and 85-370 is Cognitive Neuroscience Research Methods (old 85-314). They lost the mappings of their old courses, now 85-450 Psychology of Prejudice (IS Perspectives on Justice and Injustice, BS Cultural/Global Understanding) and 85-413 Perception (CS Category 1 and Humanities and Arts Electives; their AI copies were gone already, as AI keeps only its own lists, 14.10). | the migration |
| 85-426 has no mappings: the list discontinues 85-426 Learning in Humans and Machines, where the mappings came from, and the SOC now lists 85-426 as "Reverse Engineering Brains and Machines". | `remove_mappings` |
| Kept as separate courses: 85-421 and 85-210, and graduate versions such as 85-852 and 85-854. | none |
| `frontend/data/minors.json` shows the old numbers in the minor files as their new numbers, by course: a reused number changes only when the file means its old course. Sociology's 85-350 Psychology of Prejudice is 85-450; Neuroscience lists 85-370 and 85-414 with the titles of the courses that have those numbers now, so they stay. | `minors.json`, `test_minors_file.py` |
| The Psychology minor's Advanced Courses range (85-350 to 85-499) comes from the official file, which uses the numbers from before Fall 2025. Two new numbers inside it were below it under their old numbers: the research methods courses 85-350 (old 85-340) and 85-370 (old 85-314), so the category excludes them (the 2026-27 catalog page also limits it to advanced content courses). The other courses in the range keep counting, for example 85-364 and 85-390. | `minors.json` (`exclude`), `test_minors_file.py` (`RANGE_EXCLUDES`) |
| Sections the SOC still lists under a retired number show under its new number (the daily step, above). | `psychology_renumbering.py` |

Open questions (nothing in the data changes until someone with authority answers them):

1. **85-426** has no mappings until it is confirmed what "Reverse Engineering Brains and Machines" should count for.
2. **85-421** (Language and Thought, last offered F25, not in Qatar) keeps its base catalog mappings (CS, BA, BS); the 2026-27 AI page lists it for Category 1A. Are they still right?
3. **85-473**: the list names it "TBA - COG Course by Dr. Feathers", while the SOC lists it (and 85-873) as "Biologically Intelligent Exploration", the title the list gives 85-420 (old 85-435). The SOC title stays, and the validator logs 85-420 with 85-473 and with 85-873 as same-title pairs. Which is right?
4. **SOC titles that differ from the list**: the catalog keeps the SOC title for 85-030, 85-130, 85-301, 85-302, 85-330, 85-370, 85-470 (SOC "Frontiers in Brain and Behavior", list "Big Data in Cognitive Neuroscience") and 85-530, and for 85-490 and 85-505, where only case or punctuation differ.
5. **The 45 same-title pairs** that `validate_soc_coverage.py` logs as warnings on every run are hints only; change nothing without an official source.

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
- Courses the catalog lists but the mapping lacked were added, when `courses.json` has a row for them. Where the catalog gives a rule instead of a list ("any 70-3xx course"), a rule bucket (14.5.1) adds every course that meets the rule, on every daily run; the rows that were already there stay, except the AI School of Computer Science Electives rows, which were that rule written out once and are now rule rows (graduate courses left out).
- Courses the older CMU-Q audits (2023-24) allowed in a bucket but the 2026-27 catalog does not list there were **kept**, and they count like every other course: the 2026-27 requirements apply to CMU-Q students as they are, and courses allowed by the older audits still count for current students (decisions of November 10, 2026). A row has no "earlier" flag and the app shows no "Earlier requirement" tag (the first version of this change had both; they were dropped as confusing).
- Old buckets with no 2026-27 heading keep their name and their rows (the Biological Sciences Biophysics and Computational Biology options, under `Options`, with an "Optional" chip; the Information Systems Digitalization concentration, under `IS Concentrations`).
- AI became a live major, built from its catalog page; its general education rows are the SCS ones CS uses, with Category 1A (Cognitive Studies) in place of Category 1. AI is new and has no older version, so it keeps only what its catalog page and the official SCS general education lists state: the 39 AI rows that were only copies of CS rows from the older audits were removed (18 Science and Engineering, 2 Laboratory Requirement, 6 Category 2, 7 Category 3, 1 Category 1A and 5 Humanities and Arts electives), and later one more, 03-351's Science and Engineering row (a `remove_mappings` entry: 03-351 is cross-listed with 02-262, which has its own AI rows, and the SCS rule rules it out).

Every bucket name has a rule chip in `FULFILLMENT_RULES` (`js/data.js`), and the rules are listed in catalog order, which is also the order the tree shows sibling buckets in. `frontend/tests/catalog-data.test.js` checks the served catalog against `js/data.js`: known roots only, no dash punctuation in bucket names, a rule chip for every bucket, no stale `LABEL_OVERRIDES` or rule keys, the same plain row shape everywhere (no earlier flag; a rule row adds `"source": "rule"`), and a bucket list (`data/requirement_buckets.json`, 14.5.1) that holds every row path in tree order.

The minors did not change with the bucket names: `frontend/data/minors.json` lists course codes and number rules, not requirement paths (8.10).

The old to new paths are in `backend/data/requirement_path_renames.json`. The pipeline does not read it: `courses.json` carries the new paths, and reconcile keeps them; `mapping_overlays.json` and the constants in `apply_mapping_overlays.py` use the new paths, so the daily overlay step adds no old path back.

---

## 15. Deploy to the CMU-Q server

CountsFor's new home is an Ubuntu 24.04 server at CMU-Q, `https://countsfor.qatar.cmu.edu`. Apache serves the static frontend over HTTPS and proxies `/api` to the Flask API, which runs under Gunicorn on `127.0.0.1:8000`. The database is a local PostgreSQL. A system cron job runs the scraper once a day.

> **Status on November 11, 2026: not deployed yet.** Everything below is written from the files in `deploy/` and checked against the code, but nobody has run it on the real server yet. Production is still the old site from `main` (15.20) until the cutover (15.15), but that day its API on Render answered 503 "This service has been suspended by its owner": read the note at the top of 15.8 before you plan the import. The `cleanup` frontend can be tried as a guest on the GitHub Pages test copy (15.21), which has no API. When you do the first deploy, correct this section wherever reality differs, and record the date.

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

**Before the merge (the rehearsal, 15.15 step 1)** `main` still has the old layout. The `cleanup` branch is on Hind's working repo, `Hindjendara/CMUQ-CountsFor` (public, 17.1), and on no branch of the main repo. It was pushed there on November 10, 2026 (`5106dd7`), and the checkout it was made in had newer commits on November 11: push them first, with `git push origin cleanup` in that checkout (`git status` there shows how far the branch is ahead of `origin/cleanup`). Then clone that repo and check out `cleanup` instead of `main`:

```bash
git clone https://github.com/Hindjendara/CMUQ-CountsFor.git ~/countsfor-src
cd ~/countsfor-src
git checkout cleanup
git status --short         # must print nothing
```

After the merge, replace that checkout with a fresh clone of the main repo on `main`, as above (`rm -rf ~/countsfor-src` first). Whichever repo you use, the server must be able to clone it (a private repo needs a deploy key or token).

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

> **Render on November 11, 2026:** the web service `countsfor-summer-26` answered 503 "This service has been suspended by its owner" (who suspended it, and when, is not recorded). While it is suspended nothing writes to the database, which is what the final copy needs (15.15 step 4). The import needs the database itself, which that answer says nothing about: before you plan the cutover, check in the Render dashboard that `CountsFor_Summer_2026` still exists and is available, and run steps 1 to 3 as soon as you can. Keep that dump off the server like the final one (step 10): if the database is deleted before the cutover, it is the only copy. If the database is already gone, there is nothing to import: start from an empty database and skip this section (15.7).

**Restore before the first bootstrap or service start.** `python -m backend.bootstrap_db`, and the service's `ExecStartPre` that runs it, create every missing table, empty. `pg_restore` then stops at "relation ... already exists", and because the restore runs as one transaction, nothing is imported.

Do it twice: a **rehearsal** (below) and the **final copy** during the cutover (15.15), after writes have stopped.

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

8. **Move saved data off the old Psychology numbers** (14.6). The catalog no longer has rows for them, so wishlist items, flags, schedule plan items and search counts saved under them would match nothing. The pairs are the retired numbers of the department's renumbering list with their new numbers, plus 85-104, 85-253 and 85-261, which moved to 85-190 on 2026-11-09. 85-201 is left out: it never had a row, and its new number 85-104 is moved here itself. The other reused numbers (14.6) are not moved: their rows are the courses that have those numbers now. In the same `psql` session, paste this once:

   ```sql
   BEGIN;
   CREATE TEMP TABLE psych_numbers (old_code text PRIMARY KEY, new_code text NOT NULL) ON COMMIT DROP;
   INSERT INTO psych_numbers VALUES
     ('85-104','85-190'), ('85-253','85-190'), ('85-261','85-190'), ('85-101','85-030'),
     ('85-102','85-100'), ('85-117','85-109'), ('85-211','85-110'), ('85-219','85-170'),
     ('85-221','85-130'), ('85-241','85-150'), ('85-251','85-151'), ('85-293','85-500'),
     ('85-294','85-501'), ('85-311','85-302'), ('85-314','85-370'), ('85-320','85-330'),
     ('85-340','85-350'), ('85-354','85-430'), ('85-358','85-451'), ('85-359','85-411'),
     ('85-360','85-418'), ('85-361','85-431'), ('85-372','85-414'), ('85-375','85-409'),
     ('85-377','85-452'), ('85-385','85-415'), ('85-394','85-432'), ('85-395','85-416'),
     ('85-398','85-470'), ('85-407','85-471'), ('85-422','85-490'), ('85-435','85-420'),
     ('85-442','85-454'), ('85-443','85-455'), ('85-444','85-456'), ('85-446','85-457'),
     ('85-480','85-590'), ('85-482','85-503'), ('85-483','85-504'), ('85-484','85-530');
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
   WHERE course_code IN ('85-104','85-253','85-261','85-101','85-102','85-117','85-211','85-219',
     '85-221','85-241','85-251','85-293','85-294','85-311','85-314','85-320','85-340','85-354',
     '85-358','85-359','85-360','85-361','85-372','85-375','85-377','85-385','85-394','85-395',
     '85-398','85-407','85-422','85-435','85-442','85-443','85-444','85-446','85-480','85-482',
     '85-483','85-484');
   ```

   The last query lists admin course edits saved under an old number. An edit there no longer applies to anything, and a row with `is_new` true would bring the old number back as an added course. No rows: nothing to do. Otherwise keep them until the conversion below has shown what each one changed (it compares a saved list with production's rows of the old number). Once the site runs (15.9), an admin redoes each change on the current number in the course editor, and then you delete the old rows:

   ```sql
   DELETE FROM course_overrides
   WHERE course_code IN ('85-104','85-253','85-261','85-101','85-102','85-117','85-211','85-219',
     '85-221','85-241','85-251','85-293','85-294','85-311','85-314','85-320','85-340','85-354',
     '85-358','85-359','85-360','85-361','85-372','85-375','85-377','85-385','85-394','85-395',
     '85-398','85-407','85-422','85-435','85-442','85-443','85-444','85-446','85-480','85-482',
     '85-483','85-484');
   ```

   Admin edits saved before November 10, 2026 that changed what a course counts for are whole lists in the old requirement paths (14.10, 12.7). The browser applies such a list to its own program only, but the course shows under an old bucket with no rule chip and that program no longer follows the catalog. List them:

   ```sql
   SELECT course_code, updated_by_email, updated_at FROM course_overrides WHERE requirements IS NOT NULL;
   ```

   No rows: nothing to do. Otherwise leave `psql` (`\q`) and convert them with `backend/migrate_override_paths.py` (12.7), as a dry run first. Its baseline is the catalog those edits were saved against: `main`'s `data/courses.json` at `79e29ec`, the merge-base of `main` and `cleanup`, so both repos have it and it stays in history after the merge. Not a catalog of `cleanup`: its Psychology rows differ (14.6), and the script refuses it. Your shell still has `umask 077` from step 1, so the first command writes a file only you can read; the second hands `countsfor` a readable copy, as step 4 does with the dump:

   ```bash
   git -C ~/countsfor-src show 79e29ec:data/courses.json > ~/courses-main.json
   sudo install -m 644 -o countsfor -g countsfor ~/courses-main.json /var/tmp/countsfor-courses-main.json
   sudo -u countsfor bash -c 'set -a; . /etc/countsfor/countsfor.env; set +a; cd /var/www/html/countsfor && backend/.venv/bin/python -m backend.migrate_override_paths --baseline /var/tmp/countsfor-courses-main.json'
   ```

   The report starts with `Database target: postgresql:/countsfor` and `Baseline: /var/tmp/countsfor-courses-main.json (6704 courses)`. Read it and run the same command again with `--apply`. For a course under an old Psychology number (the list above), the report shows the change its admin made: that is what to redo on the new number. An edit on a reused number or on 85-426 (14.6) was saved while the number still had its old course's rows: check in the course editor that the change fits the course that has the number now. Then an admin checks the courses the report lists under "not in today's catalog" in the course editor's **Check these** filter. The script runs `create_app(bootstrap_db=False)`, so it works before step 9. If it stops with `ERROR: cannot read ...`, `countsfor` cannot read the baseline file: copy it again with the `install` line.

   Then the minors a BA major may not declare (`business`, `business_analytics`, `finance`, `product`). The app already ignores them, but a saved one makes every later profile save of that student fail ("That minor is not open to students in your major."). Back in `sudo -u countsfor psql -d countsfor`, list them, then remove them:

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
   Required tables present (15): admin_audit_events, course_overrides, course_search_counts, directory_entries, flags, minor_overrides, password_reset_tokens, schedule_plan_items, schedule_plan_share_tokens, schedule_plans, sign_in_events, user_activity_days, user_minors, users, wishlist_items
   Database bootstrap OK
   ```

   (`postgresql:/countsfor` is how the redaction helper prints a socket URL.) Lines such as `Added users.department` before them mean a migration ran because the Render database lacked a column; a second run prints none. A line starting with `FATAL` means it failed: read it, fix the cause, run it again. The Render database has no `minor_overrides` table; `create_all()` adds it here without printing a line.

10. **Clean up:** `sudo rm -f /var/tmp/countsfor-render.dump /var/tmp/countsfor-courses-main.json` and `rm -f ~/.pg_service.conf ~/courses-main.json` (`.pg_service.conf` holds the Render password). Keep the final dump file off the server as the last backup of the Render database.

**Rehearsal:** for the full rehearsal (15.15 step 1), run steps 1 to 9 as written, into `countsfor` (its dump is simply older than the final one). Then 15.9 starts the service on the imported accounts, and every check in 15.13 can pass. At the cutover the database is recreated and imported again (15.15 step 5).

To try only the import, without touching `countsfor` (for example after the service already created empty tables in it), use a scratch database, `countsfor_rehearsal`, after steps 1 to 4. Do not use the commands of steps 5 to 9 as printed above for this: they name `countsfor`, and the two Python commands read `DATABASE_URL=postgresql:///countsfor` from the environment file. Every command below names the scratch database instead.

- **Restore** (step 5):

  ```bash
  sudo -u postgres createdb -O countsfor countsfor_rehearsal
  sudo -u countsfor pg_restore --no-owner --no-acl --single-transaction -n public -d countsfor_rehearsal /var/tmp/countsfor-render.dump
  ```

- **Row counts** (step 6):

  ```bash
  for t in users directory_entries flags wishlist_items schedule_plans course_overrides admin_audit_events sign_in_events; do
    printf '%-20s render %-7s rehearsal %s\n' "$t" \
      "$(psql service=render -Atc "select count(*) from $t")" \
      "$(sudo -u countsfor psql -d countsfor_rehearsal -Atc "select count(*) from $t")"
  done
  ```

- **The SQL of steps 7 and 8:** open a session on the scratch database, paste the sequence check of step 7 and the SQL blocks of step 8 (the `DELETE` of edits under old numbers waits for an admin in the real import, so leave it out here), then leave with `\q`:

  ```bash
  sudo -u countsfor psql -d countsfor_rehearsal
  ```

- **Old course edits** (step 8): the baseline file, then the conversion as a dry run. Add `--apply` to try the writes.

  ```bash
  git -C ~/countsfor-src show 79e29ec:data/courses.json > ~/courses-main.json
  sudo install -m 644 -o countsfor -g countsfor ~/courses-main.json /var/tmp/countsfor-courses-main.json
  sudo -u countsfor bash -c 'set -a; . /etc/countsfor/countsfor.env; set +a; export DATABASE_URL=postgresql:///countsfor_rehearsal; cd /var/www/html/countsfor && backend/.venv/bin/python -m backend.migrate_override_paths --baseline /var/tmp/countsfor-courses-main.json'
  ```

- **Bootstrap** (step 9):

  ```bash
  sudo -u countsfor bash -c 'set -a; . /etc/countsfor/countsfor.env; set +a; export DATABASE_URL=postgresql:///countsfor_rehearsal; cd /var/www/html/countsfor && backend/.venv/bin/python -m backend.bootstrap_db'
  ```

- **Drop it**, then clean up as in step 10:

  ```bash
  sudo -u postgres dropdb countsfor_rehearsal
  ```

Both Python commands print the database they use: the conversion on its first line, before it reads the database, and the bootstrap after any migration lines (step 9). Here both must say `Database target: postgresql:/countsfor_rehearsal`; the `export` comes after the environment file is read, so it wins. Check the conversion's line before you add `--apply`.

### 15.9 Start the API with systemd

```bash
cd ~/countsfor-src
sudo install -m 644 deploy/countsfor-api.service /etc/systemd/system/countsfor-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now countsfor-api
systemctl status countsfor-api --no-pager
curl -s http://127.0.0.1:8000/health
```

`active (running)` only means the Gunicorn master is up (it reports ready to systemd before its workers import the app); the `curl` is the real check. Expected: `{"database":"connected","db_host":"","status":"ok","tables":15}`. `tables` counts every table in the database: the 15 of `backend/models.py`, or 16 on an imported Render database that still has the legacy `staff_directory_entries` table (15.8 step 3; the import gets `minor_overrides` from the bootstrap, step 9). `db_host` is empty for a socket connection. On every start systemd first runs `python -m backend.bootstrap_db` (`ExecStartPre`); if it fails the API does not start, and `journalctl -u countsfor-api -n 50` shows why. The workers skip the bootstrap because the env file sets `SKIP_DB_BOOTSTRAP=1`. Gunicorn logs requests and errors to the journal (`journalctl -u countsfor-api -f`). systemd restarts the API if it crashes; `sudo systemctl restart countsfor-api` loads new code.

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

What the site does: port 80 answers with a permanent redirect to the same path on HTTPS (password reset links keep their `?token=`); port 443 serves `frontend/`, proxies `/api/` to `http://127.0.0.1:8000/api/` (the prefix stays, because every Flask route starts with `/api`), and sends `Cache-Control: no-store` on API answers (it removes the backend's own `Cache-Control` first, so there is only one). `/health` is not proxied, because it reveals the database host and errors; check it on the server, or uncomment the `<Location /health>` block and limit it to a monitoring address range. Server wide, `/var/www/html/countsfor` and its `backend/` are denied, so even a re-enabled `000-default` cannot serve them; on the site, `/tests/`, dotfiles and source, notes, env and backup files (the daily update's `.prev` copies included) are denied. Browsers that accept gzip get `data/courses.json.gz` with `Content-Encoding: gzip` (about 1 MB). HTML, JS, CSS and JSON are sent with `no-cache`, so browsers revalidate them on every load and get a 304 when unchanged; images are cached for 30 days. Security headers: HSTS (one year, this host only), `nosniff`, `Referrer-Policy`, `X-Frame-Options`, `frame-ancestors 'self'` and `Permissions-Policy`. The file also suggests `ServerTokens Prod`, `ServerSignature Off` and `TraceEnable Off` in `/etc/apache2/conf-available/security.conf`.

### 15.11 First data build

```bash
sudo -u countsfor /var/www/html/countsfor/backend/scraper/run_scrape.sh --no-scrape
```

This runs the parser tests, rebuilds the catalog from the deployed `soc.json`, checks it and writes `courses.json.gz`. It takes under a minute. The last lines should look like this (dates and counts will differ):

```
... Gates passed (last_scrape 2026-11-07T22:10:04.404911+00:00, 6795 courses)
... courses.json: unchanged, not rewritten
... courses.json.gz: written
... requirement_buckets.json: unchanged
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
# {"database":"connected","db_host":"","status":"ok","tables":15}   (16 with the legacy table, 15.9)
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
5. In the developer tools Network tab, `courses.json` transfers about 1 MB, and a reload answers 304.

### 15.14 Google OAuth

In the Google Cloud Console, **APIs & Services**, **Credentials**, the OAuth 2.0 client `378923997481-...apps.googleusercontent.com`, add `https://countsfor.qatar.cmu.edu` to **Authorized JavaScript origins** (exactly that: scheme and host, no path, no trailing slash). Keep `http://localhost:8765` for local development. No redirect URIs are needed (popup flow). Changes can take a few minutes to apply. After the cutover, remove `https://adicmu.github.io` (and `https://hindjendara.github.io` if listed). `GOOGLE_CLIENT_ID` in `/etc/countsfor/countsfor.env` must equal the `cf-google-client-id` meta in `frontend/index.html` and `frontend/app.html`. The Google Cloud project and its owner are not recorded in the repo (23.1).

### 15.15 Cutover from GitHub Pages and Render

As of November 11, 2026 production is still the old site: GitHub Pages serves the frontend from `main`, and the GitHub Actions scrape still commits data to `main`. Render holds the API and the database, but that day its web service answered 503 "This service has been suspended by its owner", so the old site could not sign anyone in or reach anything else on the server. Nothing has been deployed to the CMU-Q server, and `cleanup` is not merged; a guest-only test copy of its frontend runs on GitHub Pages (15.21). The cutover, in order:

1. **Rehearse** 15.2 to 15.14 on the server, deploying the `cleanup` branch (push it first, 15.4) and importing a current dump into `countsfor` (15.8, "Rehearsal"; read the note at the top of 15.8 first). The server can be fully tested, sign-in with existing accounts included, before anyone uses it.
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
4. **Stop writes:** on November 11, 2026 the Render web service was already suspended (`curl -s -o /dev/null -w '%{http_code}\n' https://countsfor-summer-26.onrender.com/health` printed 503). If it runs again by now, announce a short downtime, then in the Render dashboard **Suspend** the web service. While it is suspended, the old site shows "Could not reach the server" and nothing writes to the database.
5. **Final database copy:** `sudo systemctl stop countsfor-api`, then drop and recreate the `countsfor` database, which holds the rehearsal import (the two commands at the end of 15.8 step 5), and run 15.8 steps 3 to 10 (recreate `~/.pg_service.conf` first, step 1, if you already removed it).
6. **Deploy the merged `main`** (15.16) and start the API: `sudo systemctl start countsfor-api`. Run the checks in 15.13.
7. **DNS and Google:** make sure IT points `countsfor.qatar.cmu.edu` at the server, and that the Google origin is in place (15.14).
8. **Tell users:** everyone signs in again (sign-in tokens are kept per site). Accounts, saved courses, flags and shared plans moved with the database. Schedule plans that were never shared live only in the browser's storage for the old address and do not move; a student can carry one over by creating a share link on the old site before step 4 and opening it on the new site with the host changed (the link token is in the database).
9. **Retire the old hosting**, once the new site has worked for a few days: unpublish GitHub Pages (repo **Settings**, **Pages**) or replace it with a page that links to the new address; keep the final dump in two places; then delete the Render web service and database (they are paid plans). Decide whether the GitHub Pages test copy (15.21) stays; if not, unpublish it in Hind's working repo (**Settings**, **Pages**). Update the top of this README, sections 15.20 and 15.21, and 23.1.

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
- `--no-scrape` matters: rsync replaced the live `courses.json` with the repo copy, which lacks the daily updates. The rebuild brings it back from the live `soc.json` and the deployed `mapping_overlays.json` and rewrites both files, and `requirement_buckets.json` with them. For the minute in between, browsers (which accept gzip) still get the previous catalog from the untouched `courses.json.gz`, and only clients without gzip get the repo copy.
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

This is how CountsFor was hosted until the cutover. **It is still production on November 11, 2026, but without its API:** that day the Render web service answered 503 "This service has been suspended by its owner", while the GitHub Pages frontend still loaded. Its configuration files were removed on the `cleanup` branch (they are in git history: `git show 49d22b2:render.yaml`, `git show 49d22b2:.github/workflows/pages.yml`).

**Frontend: GitHub Pages.** Repo settings: build type "workflow" (GitHub Actions), public, URL `https://adicmu.github.io/Countsfor-Summer-26/`, HTTPS enforced, no custom domain. `pages.yml` deployed on every push to `main`, copying only what the browser loads (`index.html`, `app.html`, `reset.html`, `js/`, `css/`, `assets/`, `landing/`, `data/courses.json`, `data/minor_courses.json`). The main repo's `gh-pages` branch (last commit August 9, 2026) is a leftover from an experiment and is not served. (Hind's working repo has its own `gh-pages` branch: the test copy, 15.21. It is built on top of the main repo's `gh-pages` commit `25dfa31`, so git would accept a push of it to the main repo as a plain fast-forward: never push it there. `scripts/publish_test_site.sh` refuses that repo.)

**Backend: Render.** Web service `countsfor-summer-26` (`https://countsfor-summer-26.onrender.com`; the blueprint called it `countsfor-backend`), Python, plan `starter`, region Ohio, auto-deploying from `main` (confirmed November 3, 2026). Build `pip install -r requirements.txt`, pre-deploy `python -m backend.bootstrap_db`, start `SKIP_DB_BOOTSTRAP=1 gunicorn --workers=1 --bind 0.0.0.0:$PORT --timeout 120 --access-logfile - 'backend.app:create_app()'`, health check `/health`. Database `CountsFor_Summer_2026` (Postgres, plan `starter`, Ohio, host `dpg-d9osve67...`; an older host `dpg-d8nqt2...` was used earlier in 2026, so it was recreated at least once after a free trial expired and the data was lost). Environment: `FLASK_ENV=production`, `DATABASE_URL` from the database, a generated `SECRET_KEY`, `ALLOWED_EMAIL_DOMAIN`, `FRONTEND_ORIGIN`, `SEED_USERS_PATH`, `FRONTEND_RESET_BASE`, and dashboard-only values (`GOOGLE_CLIENT_ID`, `RESEND_API_KEY`, `MAIL_FROM`, `SMTP_*`). `keepalive.yml` pinged `/health` every 10 minutes during the day. Older notes mention a second service `countsfor-backend.onrender.com` and an Oregon database `countsfor-db`; check the dashboard and delete them if they still exist. Who pays for the Render account is not recorded.

**Supabase** was once considered instead of Render Postgres. Nothing in the code is Supabase specific and there is no sign it was ever used.

**`countsfor.qatar.cmu.edu` before this move:** older docs called it "the CMU-Q deployment" of the original open-cmuq CountsFor app. It is not known what it serves today; ask CMU-Q IT before you point it at the new server.

### 15.21 Test copy on GitHub Pages

Until the server runs, the `cleanup` frontend can be tried at **[hindjendara.github.io/CMUQ-CountsFor](https://hindjendara.github.io/CMUQ-CountsFor/)**. It is a test copy, not production and not a home for CountsFor: the CMU-Q server is (this section), and nothing on the test copy is backed up or monitored. GitHub Pages serves it from the `gh-pages` branch of Hind's working repo, `Hindjendara/CMUQ-CountsFor` (public; `origin` in the checkout where `cleanup` was made, 17.1). The main repo's `gh-pages` branch is a different, unused branch (15.20).

- **What the branch holds:** only the site, `frontend/` of one commit without `tests/`, plus an empty `.nojekyll`, so GitHub serves the files as they are (no Jekyll). Each publish adds one commit on top of the last.
- **No backend.** Every `/api` request answers 404 there (checked November 11, 2026), so the app runs as a guest: search, course cards, the requirement trees, the minors and the planner work, with plans and saved courses kept in the browser. Signing in, flags, shared plans and the admin pages need the server, and admin course edits and minor settings are not applied (the app shows the catalog and `minors.json` as they are).
- **What it serves:** on November 11, 2026, `gh-pages` was `a116b27` ("Deploy cleanup 8b599b2 to GitHub Pages"), with the `cf-build` tag `release-2026-11-10b`. To see what it serves now, compare `curl -s https://hindjendara.github.io/CMUQ-CountsFor/app.html | grep cf-build` with `frontend/app.html`.

To publish a commit (usually the tip of `cleanup`), use `scripts/publish_test_site.sh` with bash (Git Bash on Windows), from a checkout whose `origin` is Hind's working repo. After a frontend change, first give the pages a new cache tag and commit it: `python scripts/bump_cf_build.py release-$(date +%F)` (add a letter for a second release on the same day, as in `release-2026-11-10b`). Then:

```bash
git remote -v                  # origin: Hindjendara/CMUQ-CountsFor only, for fetch and for push
git status --short             # must print nothing: the script refuses otherwise
git push origin cleanup        # so the commit the test copy names is on GitHub too
scripts/publish_test_site.sh   # publishes HEAD; or: scripts/publish_test_site.sh [--no-wait] COMMIT
```

The script:

1. Refuses a working tree with uncommitted or untracked files, and refuses the main repo, whose Pages site was production: a remote named `adi`, or a remote with any fetch or push URL of the `Adicmu` account (it reads every URL of the remote, not only the first, and the push URLs after any `pushInsteadOf` rewrite). It also refuses a remote that pushes to more than one repo, since `git push` pushes to every push URL.
2. Builds the site from the commit itself, so nothing uncommitted can reach it: `frontend/` without `tests/`, plus `.nojekyll`.
3. Commits that tree on top of the `gh-pages` it has just fetched and pushes it as a fast-forward. It never forces: if `gh-pages` moved in the meantime, the push is refused, nothing changes, and you run it again. If the copy already matches the commit, it publishes nothing.
4. Waits up to 5 minutes until the live `app.html` shows the commit's `cf-build` tag (`--no-wait` skips this). GitHub's "pages build and deployment" run usually takes a minute or two; if the wait runs out, look at that run in the repo's **Actions** tab.

GitHub Pages lets browsers keep each file for 10 minutes (`Cache-Control: max-age=600`), so after a frontend change a returning visitor can get old files mixed with new ones unless the `?v=` tags changed: bump them, as above, before you publish. The script warns when the published copy already had the same `cf-build` tag, and notes when the commit is on no branch of `origin`. Never publish to the main repo, and never force-push `gh-pages`.

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

# Frontend (Node): tests/profile.test.js, data.test.js, minors.test.js, course-edits.test.js and utils.test.js like
# tests/test.html, then the Node-only dash-guard.test.js, minors-file.test.js, app-views.test.js, admin-editor.test.js and catalog-data.test.js
node scripts/run-data-tests.js

# Frontend in the browser (profile, data, minors, course edits and utils tests)
python scripts/dev_server.py
# open http://localhost:8765/tests/test.html
```

### 16.2 Results on November 11, 2026 (`cleanup` branch, after the wave A merges, the admin editor merge, the release integration, the review fixes and the merge of the backend and frontend fixes of November 11)

| Suite | Result |
|---|---|
| `python -m pytest backend/tests` | **240 passed, 6 failed** (the known failures below) |
| `python -m pytest backend/scraper/tests` | 295 passed |
| `node scripts/run-data-tests.js` | 245 passed (profile 51/51, data 86/86, minors 9/9, course edits 14/14, utils 5/5, dash guard 3/3, minors file 8/8, app views 45/45, admin editor 13/13, catalog data 11/11) |

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
- `backend/tests/test_admin.py`, `test_course_overrides.py` (the change per program and minor, the path and minor checks, the merge per key, `stale_page`, the batch route, the audit details), `test_minor_overrides.py` (minor settings and the `/health` table list) and `test_migrate_override_paths.py` (12.7) cover the admin page. `test_request_bodies.py` sends the admin write routes and `/api/auth/login` JSON bodies that are not objects (a number, a list, a string, true) and expects 400 `invalid_body` (9.1).
- `backend/tests/test_config.py`: cookie defaults, the production guards (no `SECRET_KEY` or `DATABASE_URL`), `TRUST_PROXY`, `SOC_JSON_PATH`, the SMTP relay check end to end, and that production never returns a reset token or reads `backend/.env`.
- `backend/tests/test_env_example.py`: `backend/.env.example`, `deploy/countsfor.env.example` and `deploy/scraper.env.example` list exactly the variables the code reads. Add a new variable to the templates or this test fails.
- `backend/tests/test_deploy_files.py`: the `deploy/` files agree with the repo (4.3).
- `backend/tests/test_sources_archive.py`: every file in an archive folder of `backend/data/sources/` is listed in its `manifest.json` (URL on a cmu.edu host, UTC fetch time, sha256, title, catalog year for catalog pages) and still hashes to the recorded sha256; the manifest lists no missing file.
- `backend/scraper/tests/` cover SOC parsing, title reconciliation, the coverage validator, every section of the overlay file (`test_mapping_overlay_sections.py`, and `test_rule_buckets.py` for the rule buckets and the bucket list, 14.5.1), the Psychology renumbering list, its daily step and its migration (`test_psychology_renumbering.py`), the IS Intercultural and Global Inquiry list, the daily update (`test_update_data.py`), the Schedule of Classes row order the planner links lectures and sections by (`test_offering_order.py`, 8.11), `scripts/dev_server.py` (`test_dev_server.py`), `scripts/bump_cf_build.py` and `frontend/data/minors.json` (`test_minors_file.py`: every course code comes from that minor's official file, with old Psychology numbers as their new numbers from the department's list, no listed code is lost, the number ranges, rule numbers, unit totals and double counting sentences match the file, every category has a rule, no category lists a code twice, no minor carries a campus note, and the user-facing text has no dashes; Product Management against its archived catalog page: the page's sha256, title and catalog year, its category names, course lists and rules, its footnote and its double counting paragraph word for word, and no unit total, grade rule or note the page does not state). `backend/scraper/tests/` has no `__init__.py`; its `conftest.py` puts `backend/scraper/` on `sys.path`, which is why the scripts are imported as top-level modules there.
- `frontend/tests/test-runner.js` is a 48-line assertion helper; `scripts/run-data-tests.js` loads it with Node's `vm`, gives the tests an in-memory `localStorage` and `sessionStorage` (cleared before each test), waits for a test that returns a promise, and prints counts per file and in total. It exits non-zero if any test fails.
- `frontend/tests/minors.test.js` covers the minors logic of `js/data.js` with small fixtures: selection rules, category expansion, rule chips, the trees and their eligible courses, `majorCountKind()` and `courseCountsForMinor()` (the major and minor tags), the double counting limit text and `plainDataText()`. `frontend/tests/minors-file.test.js` (Node only) loads the real `data/minors.json` through `fetchMinors()` with a fake `fetch`, checks that the fallback `MINOR_LIST` and `MINOR_BLOCKED_MAJORS` match it, that every category has a known rule and builds, that Product Management builds from its catalog page (`minorSourceKind()`), that no minor carries a campus note, and that the text the app shows has no dashes. `backend/tests/test_auth.py` checks that `VALID_MINORS_FOR_PATCH` and `MAJOR_MINOR_COLLISION` match the file.
- `frontend/tests/dash-guard.test.js` (Node only) enforces rule 18.1: it scans string and template literals in `js/*.js`, the four HTML pages (`index.html`, `app.html`, `reset.html`, `landing/index.html`, including inline scripts and styles) and CSS `content:` values, skipping comments, and fails on any em or en dash (also written as an HTML entity) or a spaced hyphen between words. Its `ALLOWLIST` holds the strings that must keep a spaced hyphen, each with a reason; it is empty since the 2026-27 catalog bucket names (no requirement path has a spaced hyphen).
- `frontend/tests/catalog-data.test.js` (Node only) reads `data/courses.json` and `data/requirement_buckets.json` and checks them against `js/data.js` (14.10, 14.5.1). It also plans every offering of the catalog alone, as "+ Plan" does, and checks that none conflicts with itself (8.11).
- `frontend/tests/app-views.test.js` (Node only) runs the real `js/app.js` in a `vm` context with a small fake DOM in which every `renderShell()` replaces `#leftBody`, as a browser does. It checks that going home (`renderLeftEmpty()`, `reset()`, the guest Student and Faculty switch) with a course or schedule open writes the home view into the `#leftBody` on screen, that the guest Student toast describes the app as it is (no marking of courses taken), and that the course editor saves a row under its own code and refuses a number another row already has. Its minors tests run the real `renderTree()` with a small catalog and the real `minors.json`: a student's minor sections after the major with the limit line and the double counting tags, no status control, progress, version line or warning anywhere (an old `cf_course_status` value is ignored and kept, and the tree filters hide a course it marked), the Minors tab dropdown (all 17 minors for faculty; a student's own minors first, with the add button or "Your minor"), Product Management with its catalog rule (and not open to BA majors), no campus note on any minor, a guest adding and removing minors across a view switch, one account save at a time, and a missing minors file. Its planner tests run the real course card, `togglePlanSection()` and plan views with a small catalog in SOC order (8.11): a lecture and its section as one block with one "+ Plan", replacing a section, a plan saved with part of an offering, the typeahead "+ Plan" (the Qatar offering when both campuses show), the plan views counting courses, Remove under "No time listed" (the whole offering), a schedule with courses only in other semesters (it names them, with a button that switches), conflicts (none within one offering or between campuses, a real one between two courses), the navbar plan label (drawn again once the catalog loads and after a semester switch) and a shared snapshot.
- `frontend/tests/utils.test.js` covers `hasTypedText()` (the landing page check for typed text).
- Semesters: `backend/tests/test_semesters.py` covers `backend/semesters.py` (any code accepted, newest first, the default rule, `soc.json` read again when it changes) and `test_search_analytics.py` stores any code and takes the default from `soc.json`. In `frontend/tests/data.test.js` and the semester tests of `app-views.test.js` the picker lists the SOC's semesters (`soc_semesters`) newest first and opens on Spring 2027, keeps the choice in `cf_semester`, lists a fake new semester F27 with no code change (also before it has sections), which becomes the default once it has Qatar sections, leaves out a semester that left the SOC (its sections show only as history, also under "All semesters"), and falls back to the semesters with sections in a catalog without the list. `frontend/tests/catalog-data.test.js` checks the served list, and `backend/scraper/tests/test_soc_semesters.py` the pipeline: the scrape records the form's list (also with `SEMESTERS_TO_TRY`) and stops without one, reconcile writes it first in `courses.json` while older sections stay as offerings, and the coverage check fails when the two lists differ.
- `frontend/tests/course-edits.test.js` covers the edit logic of `js/data.js`: `applyProgramEdit()`, `programEditDelta()` (a round trip), `applyCourseOverrides()` per key (an edit of CS keeps the AI rows, a legacy list stays in its own program, minor keys stay out of `requirements`), the pick list with `requirement_buckets.json`, minor edits in `buildMinorTree()` and `buildMinorIndex()`, and `applyMinorOverrides()` with the double counting limits set apart. `frontend/tests/admin-editor.test.js` (Node only) runs the real `js/app.js` like `app-views.test.js`, with a fake API that records every write: the course editor (only the changed keys are sent, Added here and Removed here, Put back, Reset, a category not in the catalog, the minor picker, a legacy list, adding a course), the Check these filter, the category view's batch, the minor settings form and header, the minor tree notes, and the course card button and Activity log text with their Open buttons.

There is no CI that runs the tests. On the server, the daily update runs the two SOC parser test files before every scrape (14.2), which is why pytest is in `backend/requirements.txt`.

---

## 17. Git workflow

### 17.1 Remotes

| Repo | URL | Role |
|---|---|---|
| Main repo | `https://github.com/Adicmu/Countsfor-Summer-26.git` | Public, not a fork. GitHub Pages and Render are attached to its `main` until the cutover (15.15). A fresh clone calls it `origin`. |
| Partner fork | `https://github.com/Hindjendara/Countsfor-Summer-26.git` | Hind's public fork (remote `hind` in 5.2). Its own scrape workflow commits data there. |
| Hind's working repo | `https://github.com/Hindjendara/CMUQ-CountsFor.git` | Public. The checkout where the `cleanup` branch was made uses this as `origin` and the main repo as `adi`, with pushing to `adi` disabled. Its `gh-pages` branch is the GitHub Pages test copy (15.21). Check `git remote -v` in any checkout before you push. |

### 17.2 Branches (November 2026)

| Branch | State |
|---|---|
| `main` | Production today (GitHub Pages and Render deploy it; the Render web service answered 503 "suspended by its owner" on November 11, 2026). Old layout (`js/`, `data/` at the root), Render and GitHub Actions files. Includes the admin page, course editor and sign-in analytics (November 3, 2026). The scrape bot still commits to it daily. |
| `cleanup` | The work this README describes: dead code removal, the parser and data fixes, the Qatar overlay sections, the `frontend/` and `backend/` layout, environment-only configuration, the cron scraper, the `deploy/` files and the removal of the Render, GitHub Actions and Pages files. On Hind's working repo since November 10, 2026 (`origin/cleanup` in the checkout where it was made; push newer commits before you rely on that copy, 15.4), on no branch of the main repo, and not merged. Merge it at the cutover (15.15 step 3), not before. |
| `feat/admin-page` | Merged into `main` on November 3, 2026. Safe to delete. |
| `feature/password-reset-email` | Merged (PR #13). Safe to delete. |
| `feat/login-landing-guest-flags`, `feat/multiple-minors` | Old branches with open PRs #10 and #12 (June 2026). Each has one commit not on `main`, but guest mode, the landing page and multiple minors already exist on `main` in reworked form. Review, then close the PRs and delete the branches. |
| `feat/ui-ux-overhaul`, `landing-copy-and-signin-fixes`, `roster-and-role-views-backup`, `worktree-role-aware-onboarding` | Local-only branches on the original laptop. |
| `gh-pages` | On the main repo: stale, unused (15.20). On Hind's working repo: the GitHub Pages test copy; publish to it only with `scripts/publish_test_site.sh` (15.21). |
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
2. Add mappings: either an overlay in `backend/data/mapping_overlays.json` per course (`"requirements": {"AI": [...]}`) and run `python backend/scraper/apply_mapping_overlays.py`, or use the admin course editor (backend already accepts `AI` and `GS` in `REQUIREMENT_PROGRAMS`). A bucket the catalog defines by a rule goes in `rule_buckets`, and every bucket path in `catalog_buckets` (14.5.1).
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

Sign in as admin, open **Admin**, tab **Courses**, search the course and click it (or press **Edit course data** on its course card), change fields, categories or minor categories, **Save**. The change is visible to everyone on their next page load (overrides are fetched on every load with `no-cache`). To undo one category press **Put back** (or **Reset to the catalog** for a whole program) and save; to undo everything, **Undo all edits** (scraped course) or **Archive** (added course). Several courses at once: **Courses in a category**. A minor's unit total, double counting limits or note: **Minor settings** (12.6).

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
Merging does not deploy anything: copy the code to the server (15.16). Apache makes browsers revalidate every file, so a normal reload shows the new version. (Before the cutover, GitHub Pages deploys `main` and Render auto-deploys it.) The GitHub Pages test copy changes only when you publish it (15.21), and browsers may keep its old files for up to 10 minutes unless the `?v=` tags changed.

---

## 21. Open issues and roadmap

### 21.1 Security issues (fix first)

1. **Faculty can make themselves admin.** All `/api/directory/entries` write routes accept `role: "admin"` from any faculty user (verified locally: a professor upserted their own entry to admin and was admin after signing in again). Restrict admin grants (and probably all directory writes) to `ROLE_GROUP_ADMIN`.
2. Students can read `admin_notes` on non-dismissed flags (`GET /api/flags`). Decide whether notes should be private.
3. **The daily scraper can rewrite the code it runs next to.** On the server `countsfor` owns every deployed file (15.3, 15.4): the API code, `backend/.venv` and the served JS, and the same user runs the scraper, from cron, with no sandbox, on HTML fetched from the SOC servlet. The API is sandboxed (`ProtectSystem=strict`); the scraper is not. A bug exploited in the scrape could change the API code (run on the next restart) or the served JS (every visitor, and the sign-in tokens in their browser storage). The scraper only needs to write `backend/data/`, `frontend/data/` and `backend/var/`. Two ways to close this, not done because each changes the deploy and must be tested on the server: deploy the code as `root:countsfor` (folders 750, files 640, `frontend/` world-readable, `pip` run as root) and give `countsfor` write access only to those three folders; or run the update from a systemd service and timer with `ProtectSystem=strict` and `ReadWritePaths=` limited to them, in place of the cron line.

### 21.2 Operational and data issues

1. **The move to the CMU-Q server is not done.** Production is still the old site from `main` on GitHub Pages and Render, whose web service answered 503 "suspended by its owner" on November 11, 2026, and the old scrape workflow still commits to `main` with the old parser. Follow 15.15.
2. **Saved data under the old Psychology numbers.** The catalog has no rows for the old Psychology numbers that the department's renumbering list retires (14.6), nor for 85-253 and 85-261; their mappings moved to the new numbers. Wishlist items, flags, schedule plan items, search counts and admin course edits saved under them in production must be moved with 15.8 step 8 when the database is imported.
3. **6 backend tests fail** (16.2). The tests are stale, not the code. No CI runs any tests.
4. Role edits in the Users tab do not persist (7.1). Either make `PATCH /api/users` also write a directory entry, or show a warning in the UI.
5. Whether production has an email provider for password resets is not known (on Render the values were set only in the dashboard). Decide at the cutover (15.6).
6. The deploy files (15) have not been run on the real server yet; the certificate names, the time zone and outbound network access are unknown until then.
7. **A failed daily update is silent.** `MAILTO` in `deploy/countsfor.cron` is empty, so the failure line the job prints goes nowhere and the log is the only record. Decide who should be told, have IT confirm the server can send mail (a mailer such as `postfix` or `msmtp-mta` through the campus relay), then set `MAILTO` (15.12). Until then, check the last scrape date on Admin, Overview.
8. Render naming and ownership are unclear until the old hosting is retired (15.20): who pays, and whether the stray `countsfor-backend` service and `countsfor-db` database still exist.
9. M25 in `backend/data/soc.json` was written by the old scraper, which read every row as 10 cells, so the summer Session column shifted every field after the title (units hold "summer two" or "qatar summer", the section cell holds the units, and later courses sit inside earlier courses' `sections`). M25 is no longer on the SOC form, so a new scrape cannot repair it, and it is kept as it is (90 courses, 827 rows). Since November 11, 2026 the semester picker lists only the semesters on the form (14.3 step 3), so M25 would not be listed even with good rows. The pipeline ignores such data instead of deleting it: reconcile and the coverage check skip a course whose units cell is not units and a section whose section cell is not a section id (`soc_parse.usable_sections`, 14.3 step 3). All 90 M25 courses and their 827 rows are ignored; no semester on the form has any. Effects: 79-234, 17-403 and 67-313 no longer get `offered_qatar` from their bad M25 rows, 14 rows lose `offered_pitts` that only bad summer rows gave, and 45-920 keeps its catalog name "Data Science for Finance This Section Cancelled" because its only SOC title is in M25. 85-822 also keeps its catalog name (its only SOC title is "tba This Section Cancelled"); 85-372, which had the same title, is now 85-414 (14.6).
10. **Open questions from the November 8, 2026 catalog regeneration** (6,704 to 6,795 rows; 91 rows added for courses that only the correctly parsed M26 lists):
    - The 8 SOC-created rows that `soc.json` no longer lists (04-801, 54-382, 54-757, 54-882, 57-453, 57-579, 57-753, 62-318) keep `offered: ["F26"]` from the base catalog, because reconcile leaves `offered` unchanged on a row that is not in `soc.json` at all. Whether they should keep F26 is open, since the SOC is the rule and F26 is still on the form (04-801 is in none of the checked `soc.json` versions for F26).
    - 144 SOC-created rows have an empty `offered` (143 because their only semester is now cancelled-only, and 57-979 because F26 no longer lists it and F25 lists it cancelled-only); 12 SOC-created rows lost an F26 that the current F26 does not list (45-706, 54-389, 54-653, 54-889, 57-391, 57-584, 57-787, 57-788, 57-884, 57-979, 57-982, 66-400).
    - 23 codes got a `previous_course_name` for the first time because their SOC title shares no words with the old name; reconcile prints them under `REVIEW` and keeps their mappings: 12-711, 15-435, 15-635, 36-690, 36-712, 36-795, 42-663, 45-986, 47-900, 48-516, 48-616, 48-648, 51-907, 54-152, 54-195, 54-653, 76-802, 79-329, 82-196, 90-874, 94-784, 94-816, 95-877. Some look like renames of the same course rather than reused numbers (54-152 and 54-653 "Stagecraft" to "Stage and Shop Craft"); check them before relying on the mappings.
11. The Psychology questions (85-426, 85-421, 85-473, the titles that differ from the department's list, the Psychology minor's advanced range and the sections listed under old numbers) are in 14.6.

### 21.3 Code hygiene

- The no-dash rule (section 18) covers user-facing text and text that comes from data: requirement bucket names have no dash punctuation (`frontend/tests/catalog-data.test.js` checks the catalog), and meeting times show "to" instead of a hyphen. `frontend/tests/dash-guard.test.js` checks it on every run. Meeting strings that are not in the `DAYS hh:mmAM-hh:mmPM` form, including scraper junk such as "Pittsburgh, Pennsylvania" (21.2 item 9), are still shown as stored.
- Dead code: unused `users.reset_token_hash` and `reset_token_expires` columns (kept on purpose: dropping them is a schema change). The rest of the dead code found in the November 2026 audit was removed (see `git log` on the `cleanup` branch).
- The 19 MB catalog download makes the first load slow on a slow connection (UX review items 4 to 12); on the server Apache sends it gzipped (about 1 MB).
- `cf_flags` local queue has no cap.

### 21.4 Product roadmap (from docs and code comments)

- GS major: waiting on an authoritative requirement spec (`MAJOR_ORDER` in `frontend/js/data.js`).
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
- [ ] **GitHub fork and working repo**: decide what happens to `Hindjendara/Countsfor-Summer-26` and `Hindjendara/CMUQ-CountsFor` (which holds the `cleanup` branch and serves the GitHub Pages test copy, 15.21). Once the server's cron scrape runs, the fork's scrape is not needed.
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
