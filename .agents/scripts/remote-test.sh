#!/usr/bin/env bash
# Run a package's tests on another machine, when the user has asked for that.
#
#   PENGUIN_TEST_HOST=<ssh-destination> \
#     .agents/scripts/remote-test.sh <worktree> [--build "<pkg> <pkg>"] -- <pnpm args...>
#
#   PENGUIN_TEST_HOST=box .agents/scripts/remote-test.sh . -- --filter @prismshadow/penguin-web test
#   PENGUIN_TEST_HOST=box .agents/scripts/remote-test.sh ~/dev/penguin-harness-wt/foo \
#       --build "@prismshadow/penguin-core @prismshadow/penguin-server" -- \
#       --filter @prismshadow/penguin-cli exec vitest run test/agent-porting.test.ts
#
# Tests run on the developer's own machine by default; this script exists for the times the user
# asks for a different one, and it is never the automatic choice. The destination comes from the
# environment — an ssh alias or user@host that the caller's ssh config already resolves — because
# the address belongs to whoever runs this, not to the repository.
#
# It syncs sources only (node_modules, dist and .git stay behind and the remote rebuilds its own),
# installs with the frozen lockfile, optionally builds the packages whose dist the suite reads,
# then runs pnpm there. A remote result describes the remote environment: when it disagrees with a
# local run, that disagreement is the finding.
set -euo pipefail

usage() { sed -n '2,18p' "$0"; exit 2; }

HOST="${PENGUIN_TEST_HOST:-}"
[ -n "$HOST" ] || { echo "PENGUIN_TEST_HOST is unset: pass the ssh destination to use." >&2; exit 2; }

[ $# -ge 1 ] || usage
WORKTREE=$(cd "$1" && pwd) || usage
shift
BUILD_FILTERS=""
if [ "${1:-}" = "--build" ]; then
  BUILD_FILTERS="$2"
  shift 2
fi
[ "${1:-}" = "--" ] || usage
shift
[ $# -ge 1 ] || usage

NAME=$(basename "$WORKTREE")
# Resolved once, then used absolute everywhere: rsync does not expand `$HOME` in a remote
# destination, and a `~` inside double quotes is not expanded by the remote shell either — either
# spelling silently creates a directory literally named after the variable.
REMOTE_HOME=$(ssh "$HOST" 'printf %s "$HOME"')
REMOTE="$REMOTE_HOME/penguin-remote-test/$NAME"

echo "== sync $NAME -> $HOST:$REMOTE =="
ssh "$HOST" "mkdir -p '$REMOTE'"
# --delete keeps a file left by an earlier run out of the suite; the excludes are what the remote
# rebuilds for itself, and shipping them would be both slower and wrong.
rsync -az --delete \
  --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
  --exclude 'test-results' --exclude '.turbo' --exclude 'out' \
  -e ssh "$WORKTREE/" "$HOST:$REMOTE/"

# A non-login ssh shell sources no profile, so a version manager's Node and a corepack-installed
# pnpm are both off PATH — `node -v` there can report a version below this repo's >=24 engine while
# the intended one sits unloaded. Load them explicitly; both blocks are no-ops when absent.
REMOTE_ENV='
  if [ -s "$HOME/.nvm/nvm.sh" ]; then export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null; fi
  [ -d "$HOME/.local/bin" ] && export PATH="$HOME/.local/bin:$PATH";
'

# One core test resolves the checkout root beside pnpm-workspace.yaml. A worktree's .git is a
# pointer file, so it is excluded above; an empty repository is cleaner than a dangling gitdir.
ssh "$HOST" "$REMOTE_ENV cd '$REMOTE' && [ -e .git ] || git init -q"

echo "== install =="
ssh "$HOST" "$REMOTE_ENV cd '$REMOTE' && pnpm install --frozen-lockfile --reporter=silent"

if [ -n "$BUILD_FILTERS" ]; then
  echo "== build $BUILD_FILTERS =="
  FILTER_ARGS=""
  for f in $BUILD_FILTERS; do FILTER_ARGS="$FILTER_ARGS --filter $f"; done
  # The flag goes BEFORE the command; after it, pnpm forwards it to the build script itself.
  ssh "$HOST" "$REMOTE_ENV cd '$REMOTE' && pnpm --config.verify-deps-before-run=false $FILTER_ARGS build"
fi

echo "== pnpm $* =="
ssh "$HOST" "$REMOTE_ENV cd '$REMOTE' && pnpm $*"
