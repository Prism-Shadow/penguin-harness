/**
 * @penguinharness/agent-state-gitcl — the Git command line for the Agent State repository.
 *
 * A PLUGIN PACKAGE, not part of the platform: an administrator installs it on the Plugins page,
 * and the harness resolves it from the installation (see the server's plugin/loader.ts). It
 * compiles against `@prismshadow/penguin-core/plugin` alone and contributes one engine to the
 * server's `AgentStateHistoryModule.engines` slot: of the engines a harness has, the harness's
 * own side prefers this one — a host Git over a fetched build — and the agent-state-dugite
 * plugin's is the fallback for a host this one cannot serve.
 *
 * The harness keeps every cheap step of the repository in-process — HEAD, whether a load changed
 * anything, the history walk — and hands an engine only the two steps that grow with a
 * workbench: writing a commit, and reading a version's files back. This one does them with the
 * Git command line the host already has (./binary.ts), in one process each (./engine.ts) — the
 * same two steps the dugite plugin does with the build it fetches, so a host with git needs no
 * download. Where there is no git, or it cannot run, the harness falls back: the dugite plugin's
 * engine when that plugin is installed, else the built-in engine; all of them write the same
 * commits, so the repository never notices which one wrote.
 */
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type { AgentStateEngineSource, Plugin } from "@prismshadow/penguin-core/plugin";
import { openGitEngine } from "./engine.js";

@Component({
  contributes: {
    // How the Plugins page shows this module (read from ifaces.json, never by booting it).
    "PluginLibraryModule.cards": [
      {
        id: "agent-state-gitcl.card",
        title: "Git CLI for Agent State",
        titleZh: "Agent State Git 命令行",
        descriptionZh:
          "PenguinHarness 的 Agent State 历史由本机已装的 git 命令行写入与读回 Workbench 版本，应用越大越比内置引擎快；无需下载，主机没有 git 时由 agent-state-dugite 插件接管。",
        shortDescription: "Record workbench versions with the host's git.",
        shortDescriptionZh: "以本机 git 命令行记录 Workbench 版本。",
        icon: "icon.svg",
        preinstall: false,
      },
    ],
    // The engine; its id also names its directory under the data root's `cache/`. Which engine
    // runs first is the harness's own side's decision (it prefers this name), not a contributor's.
    "AgentStateHistoryModule.engines": [
      { id: "agent-state-gitcl.engine", name: "agent-state-gitcl" },
    ],
  },
})
export class AgentStateGitcl {
  @Bind("agent-state-gitcl.engine") engine!: AgentStateEngineSource;

  setup() {
    this.engine = (host) => openGitEngine(host);
  }
}

const plugin: Plugin = { modules: [AgentStateGitcl] };
export default plugin;
