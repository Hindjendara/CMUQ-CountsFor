#!/usr/bin/env bash
# Daily data update on the server: scrape the SOC, rebuild the catalog, check it
# and publish it in place (backend/scraper/update_data.py). Run by cron as the
# countsfor user, for example in /etc/cron.d/countsfor:
#
#   0 15 * * * countsfor /usr/bin/flock -n /run/lock/countsfor-scrape.lock /usr/bin/timeout 3h /var/www/html/countsfor/backend/scraper/run_scrape.sh >> /var/log/countsfor/scrape.log 2>&1
#
# Arguments go to update_data.py: --skip-tests, --no-scrape (rebuild after a deploy).
# Exit status is update_data.py's: 0 published or nothing to do, 1 failed (live
# files untouched), 75 another update is running.
set -euo pipefail

# Settings for the pipeline (deploy/scraper.env.example), all optional.
if [ -r /etc/countsfor/scraper.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /etc/countsfor/scraper.env
  set +a
fi

SCRAPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRAPER_DIR")"
CF_DEPLOY_ROOT="${CF_DEPLOY_ROOT:-$(dirname "$BACKEND_DIR")}"
export CF_DEPLOY_ROOT
cd "$CF_DEPLOY_ROOT"

# The virtual environment that also runs the API (backend/.venv on the server).
PYTHON="$BACKEND_DIR/.venv/bin/python"
if [ ! -x "$PYTHON" ]; then
  echo "$(date -Iseconds) ERROR: no virtual environment at $BACKEND_DIR/.venv" >&2
  exit 1
fi

exec "$PYTHON" "$SCRAPER_DIR/update_data.py" "$@"
