# CountsFor backend

The Flask API for CountsFor. Everything about it (setup, environment
variables, every route, the database and migrations, deployment on Render,
tests) is documented in the main [README](../README.md):

- Run locally: section 5
- Environment variables: section 6
- Backend walkthrough: section 9
- API reference: section 10
- Database and migrations: section 11
- Deployment: section 15

Quick start from the repo root:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m backend.app          # http://localhost:5050
.venv/bin/python -m pytest backend/tests backend/scraper/tests -q
```
