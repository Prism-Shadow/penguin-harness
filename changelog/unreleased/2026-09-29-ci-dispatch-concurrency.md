# Two dispatches of CI on the same ref both run to the end

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `ci`

[中文版](2026-09-29-ci-dispatch-concurrency.zh.md)

Each manual dispatch of the `CI` workflow is now its own concurrency group, so a second dispatch of
the same ref no longer cancels the first. Pushes and pull requests keep their per-ref group and
still cancel the run a newer commit supersedes.

## Details

- The group key is the run id for `workflow_dispatch` and the ref for every other event;
  `cancel-in-progress` is unchanged.
- The aggregate `ci` gate still fails a cancelled run, but when no job failed it now says the run
  was cancelled rather than reporting that a CI job did not succeed.
