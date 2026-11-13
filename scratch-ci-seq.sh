#!/bin/bash
# Reproduce the CI build order on the build host's cache tree, then run the two failing tests.
set -x
cd /home/kamiyoru/vps-tool/build-cache/penguin-c8574e165944432b54fe885b05cab7f82dd9e608/wt
git checkout -q fix-l3-ci
pnpm --config.verify-deps-before-run=false --filter "@prismshadow/penguin-server..." --filter "@prismshadow/penguin-cli..." --filter "!@prismshadow/penguin-ui" --if-present build 2>&1 | grep -E "packages/(cli|server) build.*(gen-ifaces:|error)" | head -10
echo BUILD-DONE
cd packages/server
../../node_modules/.bin/vitest run --passWithNoTests test/cli-shim.test.ts test/terminal-cli-target.test.ts 2>&1 | grep -E "FAIL|Test Files|Tests |children are" | head -10
