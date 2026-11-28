/**
 * @penguinharness/agent-state-git — native Git for the Agent State repository.
 *
 * The product ships this plugin for new Projects. Administrators manage it on the Plugins page,
 * and the harness resolves it from the installation (see the server's plugin/loader.ts). It
 * compiles against `@prismshadow/penguin-core/plugin` alone and contributes one engine to the
 * server's `AgentStateHistoryModule.engines` slot.
 *
 * Contributes `dugiteGitEngine` (implementing the unified `GitEngine` / `GitRepo` contract in
 * `./git-engine.ts`) backed by GitHub Desktop's packaged Git binary (`./binary.ts`). All engines
 * produce byte-identical commits, trees, and history walks so repositories are freely portable.
 */
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type { GitEngineSource, Plugin } from "@prismshadow/penguin-core/plugin";
import { openGitEngine } from "./engine.js";

export { gitEngine, importStream, openGitEngine, quotePath, zoneOf } from "./engine.js";
export { dugiteGitEngine } from "./git-engine.js";
export { keptFiles, locateGit, pinFor } from "./binary.js";

@Component({
  contributes: {
    // How the Plugins page shows this module (read from ifaces.json, never by booting it).
    "PluginLibraryModule.cards": [
      {
        id: "agent-state-git.card",
        title: "Native Git for Agent State",
        titleZh: "Agent State 原生 Git",
        descriptionZh:
          "PenguinHarness 的 Agent State 历史原生 Git：以 GitHub Desktop 的 dugite 构建记录 Workbench 版本并读回。",
        shortDescription: "Record workbench versions with native Git.",
        shortDescriptionZh: "以原生 Git 记录 Workbench 版本。",
        icon: "icon.svg",
        preinstall: true,
        preinstallExistingProjects: false,
      },
    ],
    // The engine; its id also names its directory under the data root's `cache/`.
    "AgentStateHistoryModule.engines": [{ id: "agent-state-git.engine", name: "agent-state-git" }],
  },
})
export class AgentStateGit {
  @Bind("agent-state-git.engine") engine!: GitEngineSource;

  setup() {
    this.engine = (host) => openGitEngine(host);
  }
}

const plugin: Plugin = { modules: [AgentStateGit] };
export default plugin;
