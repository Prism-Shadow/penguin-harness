/**
 * @penguinharness/agent-state-gix — gitoxide for the Agent State repository.
 *
 * It compiles against `@prismshadow/penguin-core/plugin` alone and contributes one engine to
 * the server's `AgentStateHistoryModule.engines` slot.
 *
 * The harness keeps every cheap step of the repository in-process — HEAD, whether a load changed
 * anything, the history walk — and hands an engine only the two steps that grow with a
 * workbench: writing a commit, and reading a version's files back. This one does both in native
 * code through gitoxide (./engine.ts), in-process — no Git process, no packaged Git to ship.
 * Its commits are the same bytes the real-Git engines write, so the repository never notices
 * which one wrote.
 */
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type { GitEngineSource, Plugin } from "@prismshadow/penguin-core/plugin";
import { openGixGitEngine } from "./git-engine.js";

export { gixEngine, openGixEngine } from "./engine.js";
export { gixGitEngine, openGixGitEngine } from "./git-engine.js";
export { loadNative } from "./binary.js";

@Component({
  contributes: {
    // How the Plugins page shows this module (read from ifaces.json, never by booting it).
    "PluginLibraryModule.cards": [
      {
        id: "agent-state-gix.card",
        title: "gitoxide for Agent State",
        titleZh: "Agent State 的 gitoxide 引擎",
        descriptionZh:
          "PenguinHarness 的 Agent State 历史由 gitoxide 进程内写入与读回 Workbench 版本：无 Git 进程、无打包 Git 分发。",
        shortDescription: "Record workbench versions with gitoxide in-process.",
        shortDescriptionZh: "以 gitoxide 进程内记录 Workbench 版本。",
        icon: "icon.svg",
        preinstall: true,
        preinstallExistingProjects: false,
      },
    ],
    // The engine; its id also names its directory under the data root's `cache/`.
    "AgentStateHistoryModule.engines": [{ id: "agent-state-gix.engine", name: "agent-state-gix" }],
  },
})
export class AgentStateGix {
  @Bind("agent-state-gix.engine") engine!: GitEngineSource;

  setup() {
    this.engine = (host) => openGixGitEngine(host);
  }
}

const plugin: Plugin = { modules: [AgentStateGix] };
export default plugin;
