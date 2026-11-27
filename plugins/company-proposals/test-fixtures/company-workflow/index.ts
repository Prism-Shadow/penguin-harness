/**
 * A company workflow, as company-workflow.test.ts writes it into an organization: what it
 * contributes to company-proposals' Action registry takes effect there once it loads —
 *
 *   deploy.fixture   a deploy Action whose process prints the commit it was given
 *   a guard          replacing proposal.approve's: the QA employee may not approve, everybody
 *                    else as the default says
 *   an after hook    on proposal.approve, logging each run it follows
 *
 * Its imports are types only: nothing is installed beside a company workflow, and what it does
 * at run time goes through its host.
 */
import type { WorkflowPackage } from "@prismshadow/penguin-server/plugin";
import type {
  ActionCode,
  GuardCode,
  HookCode,
} from "@prismshadow/penguin-plugin-company-proposals/deploy";

/** An error the registry reads as a refusal: a 4xx status and a code. */
function refusal(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code });
}

export default {
  modules: {
    Workflow: {
      create(ctx) {
        const host = ctx.use.host;
        const deploy: ActionCode = {
          guard: ({ running, subject }) => {
            if (running > 0) {
              throw refusal(409, "deploy_busy", `A deploy is still going on ${subject.text}.`);
            }
          },
          run: (run) =>
            host.deploy(run.runId, [
              "node",
              "-e",
              "console.log('deploying ' + process.env.PENGUIN_DEPLOY_HEAD)",
            ]),
        };
        const approveGuard: GuardCode = (defaults) => (input, options) => {
          if (input.caller.agentId === "acme_qa") {
            throw refusal(403, "qa_does_not_approve", "QA does not approve in this company.");
          }
          return defaults(input, options);
        };
        const approveHook: HookCode = (event) => {
          host.log(`followed ${event.key} ${event.outcome ?? ""} ${event.caller.principal}`);
        };
        return {
          bind: {
            "fixture.deploy": deploy,
            "fixture.approve-guard": approveGuard,
            "fixture.approve-hook": approveHook,
          },
        };
      },
    },
  },
} satisfies WorkflowPackage;
