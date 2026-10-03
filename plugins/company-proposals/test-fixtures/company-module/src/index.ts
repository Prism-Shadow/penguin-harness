/**
 * A company module, as the company-module test builds and loads it: a plugin package of its own
 * that contributes to company-proposals' Action registry —
 *
 *   deploy.fixture   a deploy Action whose process prints the commit it was given
 *   a guard          replacing proposal.approve's: the QA employee may not approve, everybody
 *                    else as the default says
 *   an after hook    on proposal.approve, recording each run it follows
 *
 * None of it takes effect in an organization until the organization binds it.
 */
import { Bind, Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import {
  ActionRefusal,
  deployGuard,
  deployProcess,
  type ActionCode,
  type Guard,
  type GuardCode,
  type HookCode,
} from "@prismshadow/penguin-plugin-company-proposals/deploy";

/** What the after hook saw, in order (the test reads it). */
export const followed: Array<{ key: string; outcome: string | undefined; by: string }> = [];

/** The deploy's argument vector: a no-op that prints the head it was given. */
export const DEPLOY_ARGV = [
  process.execPath,
  "-e",
  "console.log('deploying ' + process.env.PENGUIN_DEPLOY_HEAD)",
];

export const deployCode: ActionCode = {
  guard: deployGuard,
  run: (ctx) => deployProcess(ctx, "deploy.fixture", DEPLOY_ARGV),
};

export const approveGuard: GuardCode =
  (defaults: Guard): Guard =>
  (input) => {
    if (input.caller.agentId === "acme_qa") {
      throw new ActionRefusal(403, "qa_does_not_approve", "QA does not approve in this company.");
    }
    defaults(input);
  };

export const approveHook: HookCode = (event) => {
  followed.push({ key: event.key, outcome: event.outcome, by: event.caller.principal });
};

@Component({
  contributes: {
    "CompanyActionRegistry.actions": [
      {
        id: "fixture.deploy",
        kind: "action",
        key: "deploy.fixture",
        subjects: ["proposal", "change_request", "branch"],
        params: { "expectedHead?": "string", "args?": "string[]" },
        commit: true,
        description: "Deploy the subject's commit with a no-op process.",
      },
      { id: "fixture.approve-guard", kind: "guard", key: "proposal.approve" },
      { id: "fixture.approve-hook", kind: "hook", key: "proposal.approve", when: "after" },
    ],
  },
})
export class FixtureCompanyModule {
  @Bind("fixture.deploy") deploy!: unknown;
  @Bind("fixture.approve-guard") guard!: unknown;
  @Bind("fixture.approve-hook") hook!: unknown;

  setup() {
    this.deploy = deployCode;
    this.guard = approveGuard;
    this.hook = approveHook;
  }
}

const plugin: Plugin = { modules: [FixtureCompanyModule] };

export default plugin;
