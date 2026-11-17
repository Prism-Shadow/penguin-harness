import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/**
 * The sample plugin under test. Declarative end to end: its test units are declared in
 * the component's contributes (below), so the table carries them and the driver reads
 * them from the loading surface without running this package — the same way the library
 * reads a plugin's skills or hooks.
 */
@Component({
  contributes: {
    "PluginLibraryModule.skills": [
      {
        id: "penguin-testing-electron-sample.skill.penguin-testing-electron-sample",
        name: "penguin-testing-electron-sample",
        path: "skills/penguin-testing-electron-sample",
      },
    ],
    // The declarative test units this package carries: each names the shell surface it
    // asserts against. The driver collects them through the loading surface after the
    // link lands and the next generation of the loader carries the plugin.
    "PluginTestUnits.units": [
      {
        id: "penguin-testing-electron-sample.unit.window-renders",
        description: "The shell's first window renders the app root.",
        assert: "window",
      },
    ],
  },
})
export class SamplePlugin {}

export default { modules: [SamplePlugin] } satisfies Plugin;
