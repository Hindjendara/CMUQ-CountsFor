#!/usr/bin/env bash
# Daily data update on the server: scrape the SOC, rebuild the catalog, check it
# and publish it in place (backend/scraper/update_data.py). Run by cron as the
# countsfor user, in /etc/cron.d/countsfor (deploy/countsfor.cron):
#
#   0 15 * * * countsfor /usr/bin/flock -n /run/lock/countsfor-scrape.lock /usr/bin/timeout -k 5m 3h /var/www/html/countsfor/backend/scraper/run_scrape.sh >> /var/log/countsfor/scrape.log 2>&1 || echo "CountsFor daily update failed (exit $?): see /var/log/countsfor/scrape.log"
#
# By hand, always as the owner of the data: sudo -u countsfor .../run_scrape.sh
# Arguments go to update_data.py: --skip-tests, --no-scrape (rebuild after a deploy).
# Exit status is update_data.py's: 0 published or nothing to do, 1 failed (live
# files untouched), 75 another update is running.
set -euo pipefail

SCRAPER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRAPER_DIR")"

# Run as the user that owns the live data (countsfor on the server). A run as
# root would leave root-owned files in backend/var/ and backend/data/ that make
# every later cron run fail. CF_ALLOW_ANY_USER=1 skips this check.
OWNER="$(stat -c %U "$BACKEND_DIR/data" 2>/dev/null || echo countsfor)"
if [ "$(id -un)" != "$OWNER" ] && [ -z "${CF_ALLOW_ANY_USER:-}" ]; then
  echo "$(date -Iseconds) ERROR: run this as $OWNER, the owner of $BACKEND_DIR/data: sudo -u $OWNER $0 $*" >&2
  exit 1
fi

# Settings for the pipeline (deploy/scraper.env.example), all optional.
if [ -r /etc/countsfor/scraper.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /etc/countsfor/scraper.env
  set +a
fi

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
