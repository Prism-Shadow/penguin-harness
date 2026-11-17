# penguin-testing-electron drives a real harness shell end to end

- **Date:** 2026-11-17
- **Type:** feature
- **Scope:** `plugins`
- **PR:** [#1581](https://github.com/Prism-Shadow/penguin-harness/pull/1581)

[中文版](2026-11-17-electron-e2e-testing-plugin.zh.md)

A new plugin, `penguin-testing-electron`, tests another plugin against a real harness desktop shell (the Electron runtime) instead of a mocked one. Playwright's Electron channel launches the current checkout's shell (or a given build), the driver sets the instance's data root up from the current harness's configuration and vault — the instance never asks for credentials — and links the plugin under test in through the instance's own plugin management surface. Once the next loading generation carries the plugin, its test-unit components (`@Component()` classes with a `run(context)` method) run inside the real shell as ordinary Playwright assertions, and the driver removes the plugin and closes the shell afterwards. Several plugins under test can share one shell instance, installed and removed one at a time. The instance's PENGUIN_HOME and browser data live under `.data/penguin-testing-electron/` in the repository root — a git-ignored, surviving-across-runs location.

## Details

- `testPlugin(options)` runs the whole lifecycle: launch, setup, link, wait for the generation that carries the plugin, run the declared units, remove, close — and reports each unit's result individually, so one failing unit does not hide the others.
- The units arrive as modules: `@Component` (or `@Module`) classes with a `run(context)` method, the same unit the harness itself is built from; the class's name is the unit's name in the results. The window handle the context carries is a standard Playwright `Page`, so every locator and `expect` assertion works unchanged inside a unit.
- Installing and removing go through the instance's HTTP management surface (the same verbs the author-facing `penguin plugin link` uses): the plugin directory is referenced in place, nothing is packaged or copied, and the instance's own generation flip carries the load.
- The e2e case (the e2e group) launches the current checkout's shell, installs the sample plugin carried with the case, runs both of its units, and removes it; on Linux without Xvfb it skips itself with the reason and never fakes a pass.
