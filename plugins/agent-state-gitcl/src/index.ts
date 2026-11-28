import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type { GitEngineSource, Plugin } from "@prismshadow/penguin-core/plugin";
import { openGitclGitEngine } from "./git-engine.js";

export { gitclGitEngine, openGitclGitEngine } from "./git-engine.js";
export { probeGit, type FoundGit, type GitProgram } from "./binary.js";

@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "agent-state-gitcl.card",
        title: "Git CLI for Agent State",
        titleZh: "Agent State Git 命令行",
        descriptionZh:
          "PenguinHarness 的 Agent State 历史由本机已装的 git 命令行（纯 plumbing）写入与读回 Workbench 版本，与 gitoxide 引擎完全字节级互换。",
        shortDescription: "Record workbench versions with the host's git (plumbing).",
        shortDescriptionZh: "以本机 git 命令行（plumbing）记录 Workbench 版本。",
        icon: "icon.svg",
        preinstall: false,
      },
    ],
    "AgentStateHistoryModule.engines": [
      { id: "agent-state-gitcl.engine", name: "agent-state-gitcl" },
    ],
  },
})
export class AgentStateGitcl {
  @Bind("agent-state-gitcl.engine") engine!: GitEngineSource;

  setup() {
    this.engine = (host) => openGitclGitEngine(host);
  }
}

const plugin: Plugin = { modules: [AgentStateGitcl] };
export default plugin;
