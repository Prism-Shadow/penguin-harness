import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/**
 * The sample plugin under test: its class is real plugin source, its ifaces.json is
 * generated from this file by penguin-gen-ifaces (its build below) — never hand-written.
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
