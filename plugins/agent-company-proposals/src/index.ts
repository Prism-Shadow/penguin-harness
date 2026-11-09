/**
 * @penguinharness/agent-company-proposals — the proposal and roadmap protocol of a company
 * mode, as one Skill with a section per role any employee takes.
 *
 * A PLUGIN PACKAGE, not part of the harness: a Project lists it in its config and the harness
 * resolves it from the installation. It ships a Skill and no code — the penguin org commands
 * the Skill teaches run in the employee's own CLI — so its module carries no members and its
 * only contribution is the Skill itself, listed for the plugin library (the card comes from
 * the package's `penguin` metadata).
 */
import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

@Component({
  contributes: {
    "PluginLibraryModule.skills": [
      {
        id: "agent-company-proposals.skill.penguin-proposal",
        name: "penguin-proposal",
        path: "skills/penguin-proposal",
      },
    ],
  },
})
export class AgentCompanyProposalsPlugin {}

export default { modules: [AgentCompanyProposalsPlugin] } satisfies Plugin;
