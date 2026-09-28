# Run an activity's acceptance tests against the played module

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

Added **Test results** to an activity's Module section, below Quality. **Run tests** had the
chosen agent write one check for each acceptance criterion in the specification
(`acceptance_criterias`) against a small Penguin harness, and run the checks in the test browser
against the assembled module: they opened the player, tapped, held and dragged its tap targets,
and waited for the states and sounds a criterion named. The section then listed each criterion
with its test, its status in words beside a coloured dot (Passed, Failed or Skipped), how long it
took and why it failed, under the overall status, how many criteria passed and when the tests
last ran. Running again when neither the criteria nor the rest of the specification had changed
reused the checks the last run wrote. When the specification changed after a run, the section
marked its results out of date. A
specification without criteria finished at once as skipped, with no Session. Without the test
browser, Run tests was not offered and the section said an admin installs it in System
settings. A failed test did not stop an author assembling the module. **Run all stages** gained
a last step, **Run tests**, after Assemble module.

## Details

- Added the run kind `test`. With criteria it was an ordinary agent run through
  `ActivityGeneration.start` (a traced Session with approvals, on a Penguin agent or a coding
  agent); without them the server recorded it itself, succeeded, with a skipped report. The run
  record kept the criteria, the specification revision and the harness version it tested
  (`test`), and whether it reused earlier checks.
- A test run's workspace held `acceptance-input.json` (the signed play link, the viewport from
  `runtime.resolution`, the criteria, the test browser's executable and the scene ids),
  `activity-harness.mjs` (the harness: `criterion`, `openActivity`, `state`, `history`,
  `mediaHistory`, `waitForState`, `waitForMedia`, `interactables`, `tap`, `hold`, `drag`,
  `expect`, `skip`, over the player's `window.Activity.Inspection` bridge and
  `data-interactable-id` targets), `run-acceptance.mjs` (started Chromium from the input's
  executable, ran the agent's `acceptance.test.mjs` criterion by criterion with a two-minute
  limit each, and wrote `acceptance-results.json`), and a `package.json` pinning the
  `playwright-core` the server drives. Neither script read the environment or printed request
  headers. The agent ran `npm install --ignore-scripts` and `node run-acceptance.mjs` through the
  normal approvals.
- When the latest succeeded test run had tested the same criteria of the same specification
  with the same harness, its `acceptance.test.mjs` was copied into the new workspace and the
  agent was told to run it without rewriting it. The report said the checks were reused only
  when the test file was unchanged at the end of the run (`test.cachedTestHash`).
- The collector read `acceptance-results.json` (at most 1 MB, shape-checked) into
  `reports/test.json`: `{ overallStatus, results: [{ criterion, testName, status, durationMs,
  error, code? }], checkedAt, specRevision, reused, skippedReason? }`, one result per criterion
  in the specification's order. A criterion no check reported on was failed with code
  `not_run`; a malformed or oversized results file failed the run with a worded error.
- Added `POST /api/projects/:projectId/activities/:activityId/test` (project owner;
  `agentId` or `codingAgentId`, and `expectedRevision`), answering 202 with the run: 409
  `test_browser_missing` without the test browser, 409 `preview_not_built` without a module to
  play, 409 `draft_conflict` on a stale revision, 400 `test_spec_required` without a valid
  specification. Added `GET .../:activityId/test-report`, answering `{ report, runId, criteria,
  stale, browserInstalled }`, where `stale` said the report tested another specification
  revision than the saved one.
- Added the kernel service `ActivityAcceptance`, and the pipeline step `test` after `module`,
  skipped with the note `noCriteria` without criteria and `noBrowser` without the test browser.
- The run history and its toasts named the new run **Acceptance tests**.
