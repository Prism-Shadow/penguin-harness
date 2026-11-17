---
name: penguin-testing-electron
description: "Drive a real harness desktop shell (Electron) end to end from the shell: launch the current checkout or a given build, set the instance up from the current harness's config and vault, install the plugin under test, run its test-unit modules inside the shell, and remove them afterwards. Use it to verify that a plugin's UI contributions and registered capabilities actually work in a real shell."
version: 2026.11.16.1
---

# Penguin testing (Electron)

`penguin-testing-electron` turns "does my plugin really work in the desktop shell" into one repeatable step: launch a real harness instance, install the plugin under test, run its test-unit modules in the shell, and put the instance back to a clean state.

## What it does

1. **Launch** — `_electron.launch` starts the harness desktop shell (the current checkout by default, or a given build's path), over Playwright's Electron channel. The shell's first window comes back as a standard Playwright page, so every locator and `expect` assertion works unchanged.
2. **Set up** — the instance gets its own data root; the project config and API keys are taken from the current harness's config and vault, so the instance never asks for credentials.
3. **Test data** — the instance's home and browser data live at `<git root>/.data/penguin-testing-electron/penguin` and `.../chrome` by default (an alternative base can be named). The path survives across test rounds; the system does not clean it.
4. **Install and remove** — the plugin under test is installed into the running instance so its real UI and capabilities load; the test units are handed to the driver as modules and run against that real shell; after the run the plugin is removed so the instance returns to a clean state.

## Writing a test unit

A test unit is a module — a `@Component` class with a `run(context)` method, the unit the harness itself is built from. `run` receives the shell's first window as a standard Playwright page:

```ts
import { Component } from "@prismshadow/penguin-core/plugin";

@Component()
export class WindowRenders {
  async run({ window }) {
    await window.waitForLoadState("domcontentloaded");
    expect(window.isClosed()).toBe(false);
  }
}
```

The class's name is the unit's name in the results. Hand the classes to the driver — in a list, or as part of the plugin's whole module list (the driver picks out the classes that declare `run`).

## Running from test code

Import the driver directly instead of going through the skill:

```ts
import { testPlugin } from "@penguinharness/penguin-testing-electron/src/driver";
import { WindowRenders } from "./test-unit.js";

const results = await testPlugin({
  pluginDir: "plugins/my-plugin",
  units: [WindowRenders], // or the plugin's whole module list
});
// results: [{ unit: "WindowRenders", ok: true, durationMs }, ...]
```

On Linux the shell runs headless under Xvfb; without a display the cases skip themselves instead of failing.
