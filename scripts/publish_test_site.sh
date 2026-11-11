#!/usr/bin/env bash
# Publish the frontend of a commit to the GitHub Pages test copy (README 15.21).
#
#   scripts/publish_test_site.sh [--no-wait] [COMMIT]      (COMMIT defaults to HEAD)
#
# The test copy is the gh-pages branch of Hind's working repo,
# Hindjendara/CMUQ-CountsFor (remote origin in the checkout where cleanup was
# made), served at https://hindjendara.github.io/CMUQ-CountsFor/. It has no
# backend: every /api request answers 404, so the app runs as a guest.
# CountsFor's real home is the CMU-Q server (README 15).
#
# What it does:
#   1. Refuses to run when the working tree has uncommitted or untracked files,
#      and refuses the main repo (Adicmu/Countsfor-Summer-26, remote adi in that
#      checkout): its GitHub Pages site was the production site.
#   2. Builds the site from the commit itself: frontend/ without tests/, plus an
#      empty .nojekyll. Nothing outside the commit can reach the site.
#   3. Commits that tree on top of the remote's gh-pages and pushes it as a
#      fast-forward. It never forces: if gh-pages moved after the fetch, the push
#      is refused, nothing changes, and you run the script again.
#   4. Waits up to 5 minutes until the live app.html has the commit's cf-build
#      tag (skip with --no-wait).
#
# Environment: PAGES_REMOTE (default origin); PAGES_URL (default
# https://<owner>.github.io/<repo>/ from the remote's GitHub URL).
set -euo pipefail

die() { echo "publish_test_site: $*" >&2; exit 1; }
# The cf-build tag of the app.html on stdin (reads all of it, so no writer gets SIGPIPE).
cf_build() { sed -n 's/.*<meta name="cf-build" content="\([^"]*\)".*/\1/p' | sed -n '1p'; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

WAIT=1
if [ "${1:-}" = "--no-wait" ]; then WAIT=0; shift; fi
[ $# -le 1 ] || die "usage: scripts/publish_test_site.sh [--no-wait] [COMMIT]"
REMOTE=${PAGES_REMOTE:-origin}

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || die "run it inside a CountsFor checkout"
cd "$ROOT"

if [ -n "$(git status --porcelain)" ]; then
  git status --short >&2
  die "the working tree has uncommitted or untracked files (above). Commit, stash or remove them first: the site is built from a commit, so they would not be published."
fi

COMMIT=$(git rev-parse --verify --quiet "${1:-HEAD}^{commit}") || die "not a commit: ${1:-HEAD}"
SHORT=$(git rev-parse --short "$COMMIT")
git cat-file -e "$COMMIT:frontend/app.html" 2>/dev/null || die "$SHORT has no frontend/app.html"

URL=$(git remote get-url "$REMOTE" 2>/dev/null) || die "there is no remote named $REMOTE"
PUSH_URL=$(git remote get-url --push "$REMOTE" 2>/dev/null || printf '%s' "$URL")
SHOWN=$URL
[ "$PUSH_URL" = "$URL" ] || SHOWN="$URL, pushing to $PUSH_URL"
# GitHub owner names ignore case, so compare in lower case, the push URL included.
case "$(lower "$REMOTE $URL $PUSH_URL")" in
  "adi "* | *adicmu/*)
    die "refusing to publish to $REMOTE ($SHOWN): that is the main repo, whose GitHub Pages site was the production site. The test copy is the gh-pages branch of Hindjendara/CMUQ-CountsFor." ;;
esac

# The Pages address of a GitHub remote; none for any other remote (set PAGES_URL then).
SITE=${PAGES_URL:-}
if [ -z "$SITE" ]; then
  case "$URL" in
    https://github.com/* | git@github.com:* | ssh://git@github.com/*)
      SLUG=$(printf '%s\n' "$URL" | sed -E 's#^(https://github\.com/|git@github\.com:|ssh://git@github\.com/)##; s#/$##; s#\.git$##')
      OWNER=$(lower "${SLUG%%/*}")
      NAME=${SLUG#*/}
      if [ -n "$OWNER" ] && [ -n "$NAME" ] && [ "$NAME" != "$SLUG" ]; then
        if [ "$(lower "$NAME")" = "$OWNER.github.io" ]; then
          SITE="https://$OWNER.github.io/"
        else
          SITE="https://$OWNER.github.io/$NAME/"
        fi
      fi ;;
  esac
fi
case "$SITE" in "" | */) ;; *) SITE="$SITE/" ;; esac

git fetch --quiet "$REMOTE" gh-pages || die "cannot fetch gh-pages from $REMOTE"
BASE=$(git rev-parse --verify "FETCH_HEAD^{commit}")

# The site's tree: frontend/ of the commit without tests/, plus an empty .nojekyll
# (so GitHub Pages serves the files as they are, without Jekyll).
EMPTY=$(git hash-object -w --stdin </dev/null)
TREE=$( { git ls-tree "$COMMIT:frontend" | awk -F '\t' '$2 != "tests" && $2 != ".nojekyll"'
          printf '100644 blob %s\t.nojekyll\n' "$EMPTY"; } | git mktree )

WANT=$(git show "$COMMIT:frontend/app.html" | cf_build)
OLD=$(git show "$BASE:app.html" 2>/dev/null | cf_build || true)
if [ "$TREE" = "$(git rev-parse "$BASE^{tree}")" ]; then
  echo "$REMOTE gh-pages already has the frontend of $SHORT (cf-build $WANT). Nothing to publish."
else
  SUBJECT=$(git log -1 --format=%s "$COMMIT")
  NEW=$(git commit-tree "$TREE" -p "$BASE" -F - <<EOF
Publish the frontend of $SHORT to the GitHub Pages test copy

frontend/ of commit $COMMIT
("$SUBJECT"), without tests/, plus .nojekyll, made by
scripts/publish_test_site.sh. GitHub Pages has no backend: the app runs
as a guest here. CountsFor's real home is the CMU-Q server (README 15).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)
  # A plain push, never forced: refused unless it fast-forwards the gh-pages just fetched.
  git push --quiet "$REMOTE" "$NEW:refs/heads/gh-pages" \
    || die "the push was refused (did gh-pages move since the fetch?). Nothing was published; run the script again."
  echo "Pushed $(git rev-parse --short "$NEW") to $REMOTE gh-pages: the frontend of $SHORT (cf-build $WANT)."
  if [ "$WANT" = "$OLD" ]; then
    echo "Note: the published copy already had cf-build $WANT, so returning browsers may keep cached files, and the live check below cannot tell the copies apart. Run python scripts/bump_cf_build.py, commit, and publish again." >&2
    WAIT=0
  fi
fi

if ! git branch -r --contains "$COMMIT" 2>/dev/null | grep -q "^ *$REMOTE/"; then
  echo "Note: $SHORT is on no $REMOTE branch this clone knows of. Push its branch as well, so the commit the test copy names can be found." >&2
fi

if [ "$WAIT" = 1 ] && [ -z "$SITE" ]; then
  echo "Note: $REMOTE is not a GitHub remote, so the live copy is not checked. Set PAGES_URL to check it." >&2
fi
if [ "$WAIT" = 1 ] && [ -n "$SITE" ]; then
  echo "Waiting for ${SITE}app.html to show cf-build $WANT (GitHub Pages usually takes a minute or two)..."
  LIVE=""
  for _ in $(seq 1 30); do
    LIVE=$(curl -fsSL --max-time 20 "${SITE}app.html?publish-check=$(date +%s)" 2>/dev/null | cf_build || true)
    if [ "$LIVE" = "$WANT" ]; then
      echo "Live: ${SITE} serves cf-build $LIVE."
      exit 0
    fi
    sleep 10
  done
  die "gh-pages has the new copy, but after 5 minutes ${SITE}app.html still shows cf-build '${LIVE:-none}', not $WANT. Look at the repo's Actions tab (pages build and deployment) and its Pages settings; run the script again later to check (it then publishes nothing)."
fi
