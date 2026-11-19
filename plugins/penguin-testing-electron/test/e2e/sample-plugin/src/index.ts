import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/**
 * The sample plugin under test — built exactly like any plugin: its build generates the
 * table (gen-ifaces) and bundles the entry (tsup), the loader imports `main`. Its test
 * units are ordinary components with a `run(context)` method, in `test-unit.ts`; the test
 * code hands those classes to the driver's `testPlugin` — no test-specific slot anywhere.
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
  },
})
export class SamplePlugin {}

export default { modules: [SamplePlugin] } satisfies Plugin;
