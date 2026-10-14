#!/usr/bin/env bash
# The npm publishing job's own steps, kept in one place so CI walks exactly what the release does.
#
#   bash scripts/release-npm.sh stamp <tag>   stamp the tag's version where the npm job stamps it
#   bash scripts/release-npm.sh test          the suites the npm job runs on the stamped, built tree
#   bash scripts/release-npm.sh test-smoke    known stamp regressions for pull-request packaging checks
#
# release.yml's publish-npm job stamps, builds and runs the full suites on the tag's checkout.
# CI's npm packaging job stamps with the repo's own version, builds, then runs the focused suites
# below so known failures on a stamped tree are caught at review time instead of after the tag.
# v0.2.14 was lost that way: the job stamped the sandbox backends but not the server's embedded
# index of them, and plugin-registry.test.ts failed on the stamped tree while CI was green.
#
# EVENT_NAME is the triggering event (`push` for a tag push); only a push turns a tag that does not
# match the repo version into an error. GITHUB_SHA, when set, is stamped as the build commit.
set -euo pipefail

cmd="${1:-}"
case "$cmd" in
  stamp)
    TAG="${2:?usage: release-npm.sh stamp <tag>}"
    V="${TAG#v}"
    # Same repo-version guard as the release job: both jobs start from a tag push in parallel, so
    # the check must fail here too or npm would publish from a tag whose repo version was never
    # bumped. Any other event only warns (legacy-tag retries, CI).
    if [ -f package.json ]; then
      PKG_V="$(node -p 'require("./package.json").version')"
      if [ "$PKG_V" != "$V" ]; then
        MSG="tag $TAG does not match the repo version $PKG_V; bump root + every workspace package.json (packages/*, plugins/*) and core VERSION during release prep, then re-tag (see .github/CONTRIBUTING.md)."
        if [ "${EVENT_NAME:-}" = "push" ]; then
          echo "error: $MSG" >&2
          exit 1
        fi
        echo "warning: $MSG (continuing: not a tag push)" >&2
      fi
    fi
    grep -q 'export const VERSION = "' packages/core/src/index.ts
    sed -i "s/export const VERSION = \"[^\"]*\"/export const VERSION = \"$V\"/" packages/core/src/index.ts
    D="$(date -u +%Y-%m-%d)"
    # BRE: the unescaped | in these patterns is literal (grep/sed default to POSIX BRE, where | is not alternation).
    grep -q 'export const BUILD_DATE: string | null = ' packages/core/src/index.ts
    sed -i "s/export const BUILD_DATE: string | null = [^;]*/export const BUILD_DATE: string | null = \"$D\"/" packages/core/src/index.ts
    # The commit is what separates two builds of the same version, which BUILD_DATE cannot.
    # GITHUB_SHA is the checked-out sha and needs no git; outside Actions there is none to stamp.
    if [ -z "${GITHUB_SHA:-}" ]; then
      echo "GITHUB_SHA is unset; leaving the commit unstamped."
    else
      sed -i "s/export const BUILD_COMMIT: string | null = [^;]*/export const BUILD_COMMIT: string | null = \"$GITHUB_SHA\"/" packages/core/src/index.ts
      grep -Fq "export const BUILD_COMMIT: string | null = \"$GITHUB_SHA\"" packages/core/src/index.ts
    fi
    for dir in plugins/*/; do
      (cd "$dir" && npm version --no-git-tag-version --allow-same-version "$V" >/dev/null)
    done
    for p in amsp core server cli; do
      (cd "packages/$p" && npm version --no-git-tag-version --allow-same-version "$V" >/dev/null)
    done
    # The server embeds an index of the sandbox backends it ships, each at the version its
    # package.json carries; those packages were just stamped, so the index follows. Left behind,
    # the server would advertise a version that was never published.
    INDEX=packages/server/src/plugin/builtin-index.json
    sed -i -E "s/(\"version\": \")[^\"]*\"/\1$V\"/" "$INDEX"
    node -e '
      const [v, file] = process.argv.slice(1);
      const off = require("./" + file).filter((e) => e.version !== v).map((e) => e.name);
      if (off.length) { console.error("builtin index not stamped: " + off.join(", ")); process.exit(1); }
    ' "$V" "$INDEX"
    echo "stamped $V"
    ;;
  test)
    pnpm --filter @prismshadow/amsp test
    pnpm --filter @prismshadow/penguin-core test
    pnpm --filter @prismshadow/penguin-server test
    pnpm --filter @prismshadow/penguin-cli test
    ;;
  test-smoke)
    # These cover the release/source build identity, the embedded plugin index matching the
    # stamped package versions, and the HTTP/CLI version reports. Other behaviour is already
    # checked by the affected-package jobs; the release still runs every suite above.
    pnpm --filter @prismshadow/penguin-core exec vitest run test/build-info.test.ts
    # `exec vitest` does not run the server's script, which normally generates this table.
    pnpm --filter @prismshadow/penguin-server gen:ifaces
    pnpm --filter @prismshadow/penguin-server exec vitest run \
      test/plugin-registry.test.ts test/version.test.ts test/deploy-same-build.test.ts
    pnpm --filter @prismshadow/penguin-cli exec vitest run test/version.test.ts
    ;;
  *)
    sed -n '2,7p' "$0" >&2
    exit 2
    ;;
esac
