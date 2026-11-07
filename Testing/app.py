"""
Mini SOC server for testing the scraper locally.

Endpoints the scraper hits:
  GET  /open/SOC/SOCServlet/search   -> form HTML with DEPT dropdown
  POST /open/SOC/SOCServlet/search   -> course-listing HTML for a given DEPT

Admin UI for you to add/remove test courses:
  GET  /admin                        -> table of all courses + add form
  POST /admin/add                    -> add a course
  POST /admin/delete                 -> remove a course
  GET  /admin/data                   -> raw courses.json (debugging)

Run:
    pip install flask
    python app.py
    # serves on http://localhost:5000

Then point the scraper at it (in another terminal):
    SOC_BASE_URL=http://localhost:5000/open/SOC/SOCServlet \
    MIN_COURSES_FOR_VALID_SCRAPE=1 \
    SOC_OUTPUT_PATH=/tmp/test_soc.json \
    python scraper/scrape_soc.py
"""
import json
from pathlib import Path
from flask import Flask, request, redirect, jsonify, abort

app = Flask(__name__)
DATA_FILE = Path(__file__).parent / "courses.json"


def load_data():
    with open(DATA_FILE) as f:
        return json.load(f)


def save_data(data):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)


# ---------- HTML the scraper parses ----------

def render_search_form(data):
    """GET /search — must contain <select name="DEPT"> for get_department_list()."""
    options = "\n".join(
        f'<option value="{d["code"]}">{d["name"]} ({d["code"]}XXX)</option>'
        for d in data["departments"]
    )
    return f"""<!doctype html>
<html><body>
<h1>SOC Test Server</h1>
<form method="POST" action="/open/SOC/SOCServlet/search">
  <select name="DEPT">
    <option value="All">All</option>
    {options}
  </select>
  <input name="SEMESTER" value="F26">
  <input name="MINI" value="NO">
  <input name="GRAD_UNDER" value="All">
  <input name="PRG_LOCATION" value="All">
  <input name="COURSE" value="">
  <button>Search</button>
</form>
<p><a href="/admin">Admin: add/remove courses</a></p>
</body></html>
"""


def render_courses_table(courses_for_dept):
    """
    POST /search response. The scraper maps cells by the <th class="col-...">
    header, like the real SOC page (fall and spring layout, 10 columns):
      cell 0: course number (5 digits) on course rows, empty on section rows
      cell 1: title
      cell 2: units
      cell 3: section
      cell 4: mini
      cell 5: days
      cell 6: begin_time
      cell 7: end_time
      cell 8: location
      cell 9: delivery_mode
    """
    rows = []
    for c in courses_for_dept:
        rows.append(
            f"<tr>"
            f"<td>{c['course_number']}</td>"
            f"<td>{c['title']}</td>"
            f"<td>{c['units']}</td>"
            f"<td></td><td></td><td></td><td></td><td></td><td></td><td></td>"
            f"</tr>"
        )
        for s in c["sections"]:
            rows.append(
                f"<tr>"
                f"<td></td><td></td><td></td>"
                f"<td>{s['section']}</td>"
                f"<td>{s['mini']}</td>"
                f"<td>{s['days']}</td>"
                f"<td>{s['begin_time']}</td>"
                f"<td>{s['end_time']}</td>"
                f"<td>{s['location']}</td>"
                f"<td>{s['delivery_mode']}</td>"
                f"</tr>"
            )

    return f"""<!doctype html>
<html><body>
<table border="1">
<thead><tr>
<th class="col-course">Course</th><th class="col-title">Course Title</th>
<th class="col-units">Units</th><th class="col-section">Sec</th>
<th class="col-mini">Mini</th><th class="col-days">Days</th>
<th class="col-begin">Begin</th><th class="col-end">End</th>
<th class="col-location">Teaching Location</th>
<th class="col-deliverymode">Delivery Mode</th>
</tr></thead>
{''.join(rows)}
</table>
</body></html>
"""


# ---------- Scraper-facing routes ----------

@app.route("/open/SOC/SOCServlet/search", methods=["GET", "POST"])
def search():
    data = load_data()
    if request.method == "GET":
        return render_search_form(data)

    semester = request.form.get("SEMESTER", "")
    dept = request.form.get("DEPT", "")

    courses = data["semesters"].get(semester, [])
    if dept and dept != "All":
        courses = [c for c in courses if c["department_code"] == dept]

    return render_courses_table(courses)


# ---------- Admin UI ----------
# NOTE: this template is built with string concatenation (not .format())
# because the embedded CSS contains literal { } characters.

ADMIN_CSS = """
  body { font-family: ui-monospace, monospace; max-width: 900px; margin: 2em auto; padding: 0 1em; }
  h1, h2 { font-family: Georgia, serif; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #f4f4f4; }
  form.add { background: #f9f9f9; padding: 1em; border: 1px solid #ddd; }
  form.add label { display: block; margin: 0.4em 0; }
  form.add input, form.add select { width: 100%; padding: 4px; }
  .delete { background: #c00; color: white; border: none; padding: 4px 10px; cursor: pointer; }
  .small { font-size: 0.85em; color: #666; }
"""


@app.route("/admin")
def admin():
    data = load_data()

    semester_sections = []
    for sem in sorted(data["semesters"].keys()):
        rows = []
        for c in data["semesters"][sem]:
            rows.append(
                f"<tr><td>{c['course_number']}</td><td>{c['title']}</td>"
                f"<td>{c['department_code']}</td><td>{len(c['sections'])}</td>"
                f"<td><form method='POST' action='/admin/delete' style='margin:0'>"
                f"<input type='hidden' name='semester' value='{sem}'>"
                f"<input type='hidden' name='course_number' value='{c['course_number']}'>"
                f"<button class='delete'>delete</button></form></td></tr>"
            )
        semester_sections.append(
            f"<h2>{sem} <span class='small'>({len(data['semesters'][sem])} courses)</span></h2>"
            f"<table><tr><th>#</th><th>Title</th><th>Dept</th><th>Sections</th><th></th></tr>"
            f"{''.join(rows)}</table>"
        )

    dept_options = "".join(
        f'<option value="{d["code"]}">{d["code"]} &mdash; {d["name"]}</option>'
        for d in data["departments"]
    )

    return (
        '<!doctype html><html><head><title>SOC Test Admin</title>'
        f'<style>{ADMIN_CSS}</style></head><body>'
        '<h1>SOC Test Site &mdash; Admin</h1>'
        '<p class="small">Edits here change <code>courses.json</code>. '
        'Run the scraper after making changes to see them reflected in <code>data/soc.json</code>.</p>'
        + "\n".join(semester_sections) +
        '<h2>Add a course</h2>'
        '<form class="add" method="POST" action="/admin/add">'
        '  <label>Semester (e.g. F26, S27)<input name="semester" required value="F26"></label>'
        '  <label>Course number (5 digits)<input name="course_number" required pattern="\\d{5}" placeholder="15122"></label>'
        '  <label>Title<input name="title" required placeholder="Principles of Imperative Computation"></label>'
        '  <label>Units<input name="units" value="10"></label>'
        f'  <label>Department<select name="department_code">{dept_options}</select></label>'
        '  <h3>First section</h3>'
        '  <label>Section <input name="section" value="A"></label>'
        '  <label>Days <input name="days" value="MWF"></label>'
        '  <label>Begin time <input name="begin_time" value="10:00AM"></label>'
        '  <label>End time <input name="end_time" value="10:50AM"></label>'
        '  <label>Location <input name="location" value="GHC 4401"></label>'
        '  <label>Delivery mode <input name="delivery_mode" value="In-Person"></label>'
        '  <button type="submit">Add course</button>'
        '</form></body></html>'
    )


@app.route("/admin/add", methods=["POST"])
def admin_add():
    f = request.form
    data = load_data()
    sem = f["semester"]
    data["semesters"].setdefault(sem, [])

    if any(c["course_number"] == f["course_number"] for c in data["semesters"][sem]):
        return (
            f"Course {f['course_number']} already exists in {sem}. "
            f"<a href='/admin'>back</a>"
        ), 400

    data["semesters"][sem].append({
        "course_number": f["course_number"],
        "title": f["title"],
        "units": f.get("units", ""),
        "department_code": f["department_code"],
        "sections": [{
            "section": f.get("section", "A"),
            "mini": "NO",
            "days": f.get("days", ""),
            "begin_time": f.get("begin_time", ""),
            "end_time": f.get("end_time", ""),
            "location": f.get("location", ""),
            "delivery_mode": f.get("delivery_mode", "In-Person"),
        }],
    })
    save_data(data)
    return redirect("/admin")


@app.route("/admin/delete", methods=["POST"])
def admin_delete():
    sem = request.form["semester"]
    cnum = request.form["course_number"]
    data = load_data()
    if sem not in data["semesters"]:
        abort(404)
    data["semesters"][sem] = [
        c for c in data["semesters"][sem] if c["course_number"] != cnum
    ]
    save_data(data)
    return redirect("/admin")


@app.route("/admin/data")
def admin_data():
    return jsonify(load_data())


@app.route("/")
def index():
    return redirect("/admin")


if __name__ == "__main__":
    # port 5000 by default
    app.run(debug=False, port=5000, host="127.0.0.1")