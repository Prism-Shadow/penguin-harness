import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/**
 * Everything this plugin carries, declared for the plugin library. Data only: the class has no
 * body and the package no entry point; `build` writes this literal into `ifaces.json`.
 * The driver library itself lives in `src/driver.ts` and is imported directly by test code.
 */
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "penguin-testing-electron.card",
        title: "Penguin Testing Electron",
        titleZh: "Penguin Electron 测试",
        descriptionZh:
          "驱动真实的 harness 桌面壳（Electron）做端到端验证：起当前检出或指定版本的实例、从当前 harness 的配置与保险库完成 setup、装入被测插件、把测试单元（@Component 模块）跑在真实壳里、测完移除还原。",
        shortDescription:
          "Drive a real harness shell end to end: launch, set up, install the plugin under test, run its test-unit modules in the shell.",
        shortDescriptionZh: "起真实壳、装入被测插件、把测试单元模块跑在壳里、测完还原。",
        category: "software-development",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Launch a harness instance and run the test units of the plugin in plugins/sandbox-dsh.",
          promptZh: "起一个 harness 实例，跑 plugins/sandbox-dsh 里插件的测试单元。",
          skills: ["penguin-testing-electron"],
        },
      },
    ],
    "PluginLibraryModule.skills": [
      {
        id: "penguin-testing-electron.skill.penguin-testing-electron",
        name: "penguin-testing-electron",
        path: "skills/penguin-testing-electron",
      },
    ],
  },
})
export class PenguinTestingElectronPlugin {}

export default { modules: [PenguinTestingElectronPlugin] } satisfies Plugin;
