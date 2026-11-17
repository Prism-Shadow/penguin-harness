---
name: penguin-testing-electron
description: "Drive a real harness desktop shell (Electron) end to end from the shell: launch the current checkout or a given build, set the instance up from the current harness's config and vault, install the plugin under test, run its TestUnit components inside the shell, and remove them afterwards. Use it to verify that a plugin's UI contributions and registered capabilities actually work in a real shell."
version: 2026.11.16.1
---

# Penguin testing (Electron)

`penguin-testing-electron` turns "does my plugin really work in the desktop shell" into one repeatable step: launch a real harness instance, install the plugin under test, run its TestUnit components in the shell, and put the instance back to a clean state.

## What it does

1. **Launch** — `_electron.launch` starts the harness desktop shell (the current checkout by default, or a given build's path), over Playwright's Electron channel. The shell's first window comes back as a standard Playwright page, so every locator and `expect` assertion works unchanged.
2. **Set up** — the instance gets its own data root; the project config and API keys are taken from the current harness's config and vault, so the instance never asks for credentials.
3. **Test data** — the instance's home and browser data live at `<git root>/.data/penguin-testing-electron/penguin` and `.../chrome` by default (an alternative base can be named). The path survives across test rounds; the system does not clean it.
4. **Install and remove** — the plugin under test is installed into the running instance, its TestUnit components are collected through the plugin loading surface and executed in the real shell, and after the run the plugin is removed so the instance returns to a clean state.

## Writing a TestUnit

A plugin under test declares its test units as components:

```ts
@Component()
class TestUnit {
  // executed inside the running shell against the real UI
}
```

The slot name and execution contract are settled with the implementation; this skill's copy follows what `plugins/penguin-testing-electron/src/driver.ts` actually does.

## Running from test code

Import the driver directly instead of going through the skill:

```ts
import { launchHarness } from "@penguinharness/penguin-testing-electron/src/driver";

const instance = await launchHarness();
await instance.install("<plugin dir>");
// assert against instance.window with Playwright locators
await instance.remove("<plugin name>");
await instance.app.close();
```

On Linux the shell runs headless under Xvfb; without a display the cases skip themselves instead of failing.
