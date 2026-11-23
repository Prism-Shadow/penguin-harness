/**
 * @penguinharness/agent-state-git — native Git for the Agent State repository.
 *
 * A PLUGIN PACKAGE, not part of the platform: an administrator installs it on the Plugins page,
 * and the harness resolves it from the installation (see the server's plugin/loader.ts). It
 * compiles against `@prismshadow/penguin-core/plugin` alone and contributes one engine to the
 * server's `AgentStateHistoryModule.engines` slot.
 *
 * The harness keeps every cheap step of the repository in-process — HEAD, whether a load changed
 * anything, the history walk — and hands an engine only the two steps that grow with a
 * workbench: writing a commit, and reading a version's files back. This one does them with
 * GitHub Desktop's build of Git as dugite pins it (./binary.ts), in one process each
 * (./engine.ts). On hosts where the packaged Git cannot run, the built-in engine records versions; the two write the same
 * commits, so the repository never notices which one wrote.
 */
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type { AgentStateEngineSource, Plugin } from "@prismshadow/penguin-core/plugin";
import { openGitEngine } from "./engine.js";

export { gitEngine, importStream, openGitEngine, quotePath, zoneOf } from "./engine.js";
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
          "PenguinHarness 的 Agent State 历史原生 Git：以 GitHub Desktop 的 dugite 构建写入与读回 Workbench 版本，应用越大越比内置引擎快。",
        shortDescription: "Record workbench versions with native Git.",
        shortDescriptionZh: "以原生 Git 记录 Workbench 版本。",
        icon: "icon.svg",
        preinstall: false,
      },
    ],
    // The engine; its id also names its directory under the data root's `cache/`.
    "AgentStateHistoryModule.engines": [{ id: "agent-state-git.engine", name: "agent-state-git" }],
  },
})
export class AgentStateGit {
  @Bind("agent-state-git.engine") engine!: AgentStateEngineSource;

  setup() {
    this.engine = (host) => openGitEngine(host);
  }
}

const plugin: Plugin = { modules: [AgentStateGit] };
export default plugin;
