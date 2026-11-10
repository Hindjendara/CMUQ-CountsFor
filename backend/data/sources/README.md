# Source documents

This folder keeps copies of the official pages that define what counts for
what: the major requirements, the general education rules, the CMU-Q section
and the minor pages. The app's requirement data is built from them, and every
requirement record can point back to one of these files.

## These files are frozen evidence

- Each file holds the raw bytes exactly as the server sent them. Never edit,
  reformat or "fix" a file here, not even its line endings.
- `.gitattributes` marks everything under `backend/data/sources/*/` as `-text`
  so git never converts line endings on checkout.
- `manifest.json` in each archive folder records, for every file, the URL it
  came from, when it was fetched (UTC), its sha256, the page title, and the
  catalog year (`null` for pages outside the catalog).
- `backend/tests/test_sources_archive.py` fails if a file no longer matches its
  recorded sha256, if a file is missing from the manifest, or if the manifest
  lists a file that is not there.

If a page changes upstream, do not overwrite the old copy. Fetch a new archive
folder instead (see "How to refresh").

## catalog-2026-27/

Fetched 9 November 2026 from the 2026-2027 CMU Undergraduate Catalog
(coursecatalog.web.cmu.edu), plus the cmu.edu pages the catalog sends readers
to for course lists. One page of the same catalog was added on 10 November
2026: `minors/product-management-minor.html` (see minors/ below). The five
major pages were checked against the printed 2026-2027 catalog PDFs (printed
9 November 2026) and agree with them.

### majors/

The requirement pages for the five CMU-Q degrees. Bucket names, course lists
and rules ("one of", "min. 9 units", "at least 18 units") come from here.

| File | Page |
| --- | --- |
| `computer-science-bs.html` | Computer Science, B.S. (students entering Fall 2026) |
| `artificial-intelligence-bs.html` | Artificial Intelligence, B.S. |
| `biological-sciences-bs.html` | Biological Sciences, B.S. (with tracks) |
| `business-administration-bs.html` | Business Administration, B.S. (with University Core and concentrations) |
| `information-systems-bs.html` | Information Systems, B.S. |

### gen-ed/

The general education pages the major pages link to.

| File | Page | Used by |
| --- | --- | --- |
| `scs-general-education.html` | SCS General Education: Science and Engineering (36 units, lab and same-department rules, approved departments, lab list, deletions, additions) and Humanities and Arts (63 units: First Year Writing, Breadth Categories 1, 1A, 2, 3 with full course lists, three Humanities and Arts electives with deletions and additions). Lists are "approved as of July 2026". | CS, AI |
| `mcs-general-education.html` | MCS General Education: Technical Breadth (per major, plus full category lists) and Nontechnical Breadth (First-Year courses, Science and Society, ENGAGE, Cultural/Global Understanding, Nontechnical Electives) and double counting rules. Science and Society, Cultural/Global and Nontechnical Electives show only the "top five" courses; the full lists are in a Google Sheet (see below). | Biological Sciences |
| `mcs-college.html` | The Mellon College of Science section page. The Biological Sciences page links to `#generaleducationrequirementstext` on it, but that anchor no longer exists; the content is on `mcs-general-education.html`. Kept because it is the literal link target. | Biological Sciences |
| `dietrich-general-education.html` | Dietrich College General Education: categories and units (Foundations 54, Disciplinary Perspectives 42, Special Seminars 18, Experiential Learning 1; total 115). Only Communication (76-101/76-102 or two of 76-106/107/108) and Data Analysis (36-200) name courses; for every other category it says the course list is on the GenEd website. | Information Systems |
| `tepper-university-core.html` | Tepper University Core (Requirements 1 to 5). Same text as the University Core section of the Business Administration page; kept as the standalone catalog page. | Business Administration |

### related/

| File | Page |
| --- | --- |
| `scs-concentrations.html` | SCS Concentrations. The CS page and the CMU-Q section link here for "minor or concentration". Kept for later cross-checking. |

### qatar/

| File | Page |
| --- | --- |
| `qatar.html` | Carnegie Mellon University in Qatar section (all tabs: overview, academic standards, faculty). Lists the degrees, the BA concentrations available in Qatar, the IS concentrations approved in Qatar, the minors offered in Qatar, and the CS/AI satisfactory progress courses. |

### minors/

Catalog pages for the minors the app has (one per file in
`backend/data/minors/`), kept to cross-check the user's minor files. The
minor files in `backend/data/minors/` stay the source for minors, except
Product Management, which has no official file:
`product-management-minor.html` (fetched 10 November 2026, the
`source_file` of the `product` minor in `frontend/data/minors.json`) is its
source, and `backend/scraper/tests/test_minors_file.py` checks the minor
against it.

`arabic-studies-minor.html`, `biological-sciences-minor.html`,
`business-administration-minor.html`, `business-analytics-optimization-minor.html`,
`computational-biology-minor.html`, `computer-science-minor.html`,
`economics-minor.html`, `financial-management-minor.html`, `history-minor.html`,
`mathematical-sciences-minor.html`, `neuroscience-minor.html`,
`product-management-minor.html`,
`professional-writing-minor.html`, `psychology-minor.html`, `sociology-minor.html`,
`tech-entrepreneurship-minor.html` (CMU-Q only; the only subpage of the catalog's
Qatar section).

### offsite/

Official cmu.edu pages that the catalog's general education pages name as the
up-to-date course lists. They are not the catalog; per the project's rule the
catalog page wins where they differ. They are kept so a difference can be seen
and raised, not silently used.

| File | Page |
| --- | --- |
| `scs-humanities-and-arts-requirements.html` | cs.cmu.edu Humanities and Arts page. Its lists load by JavaScript from the JSON files below. |
| `scs-science-and-engineering-requirements.html` | cs.cmu.edu Science and Engineering page. Same, lists load from JSON. |
| `scs-gen-ed-reqs-*.json` | The eight data sources behind those two pages: `cat1`, `cat2`, `cat3`, `arts-additions`, `arts-deletions`, `sci-approved`, `lab-approved`, `sci-deletions`. Each has a `data` array of [course, title, units]. |
| `mcs-nontechnical-breadth-requirements.html` | MCS advising page for Nontechnical Breadth (example Cultural/Global list, non-comprehensive additions and deletions). |
| `dietrich-gened-home.html` | Dietrich GenEd website home. |
| `dietrich-gened-curriculum.html` | Dietrich GenEd curriculum page (categories, units, timeline). |
| `dietrich-gened-policies.html` | Dietrich GenEd policies (letter grades, no petitions for non-approved courses, AP and transfer rules). |
| `dietrich-gened-course-options.html` | Dietrich GenEd "Course Options" page. The course lists themselves are in an embedded Power BI report (app.powerbi.com), which cannot be saved as a static page; only the host page is archived. |

### Not archived

- The MCS pre-approved lists (Science and Society, Cultural/Global
  Understanding, Nontechnical Electives additions and deletions) are a Google
  Sheet linked from `mcs-general-education.html`. It is not on a cmu.edu domain,
  so it is not archived here.
- The Dietrich GenEd course lists are in the Power BI report described above.

## How to refresh

1. Make a new folder named for the catalog year, for example
   `catalog-2027-28/`. Never overwrite or edit a file of an existing archive
   folder. A page of the same catalog year that was not fetched yet may be
   added to its folder with its own manifest entry, as the Product
   Management minor page was.
2. Fetch each URL from the previous `manifest.json` (and any new page the
   major pages now link to) one request at a time, about one second apart,
   with a normal browser User-Agent, saving the response body unchanged.
   Do not follow redirects silently: if a URL now redirects, record the new URL.
3. Write the new folder's `manifest.json` with `url`, `file`, `fetched_at`
   (UTC, `YYYY-MM-DDTHH:MM:SSZ`), `sha256` of the saved bytes, `title` (the
   page's `<title>`), and `catalog_year` (the year printed on catalog pages,
   `null` otherwise).
4. Check the major pages against the printed catalog PDFs, then run
   `python -m pytest backend/tests/test_sources_archive.py -q`.
5. Update this README with the new folder.
