# The npm publish job ran its test suites with an empty npm user config

- **Date:** 2026-11-26
- **Type:** process
- **Scope:** `ci`

[中文版](2026-11-26-release-npm-test-npmrc.zh.md)

The `Publish npm packages` job in `release.yml` ran `scripts/release-npm.sh test` with an empty npm user config, the same as CI's test jobs: `NPM_CONFIG_USERCONFIG` pointed at an empty file under `$RUNNER_TEMP`, for that one command. Until then the suites inherited the `.npmrc` that `actions/setup-node` writes for `registry-url`, whose `always-auth` line made npm print a warning ahead of its own output on every run. The build and publish steps kept setup-node's file, so trusted publishing was configured as before.
