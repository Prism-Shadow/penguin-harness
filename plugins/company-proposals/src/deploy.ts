/**
 * Deploys, for the company modules that contribute them. A deploy is an Action like any other —
 * `deploy.<id>`, contributed by a company module and bound by the organization — whose subject
 * is a proposal (its impl's head), a change request or a branch, and whose run starts a process
 * on that subject's commit. How a project is built and where it ships differs from one company
 * to the next, so the plugin decides none of it; this module is what it lends a deploy:
 *
 *   DEPLOY_PARAMS   the parameters a deploy takes: `expectedHead` (the registry refuses the run
 *                   when the subject has moved past it) and extra `args`
 *   deployGuard     the default guard: one run of the Action at a time
 *   deployProcess   the run's effect: the argument vector (no shell) started in the
 *                   organization's shared workspace with the commit in its environment, its
 *                   output kept (the last OUTPUT_LIMIT characters), stopped after an hour
 *
 * The process's environment is the server's plus:
 *   PENGUIN_DEPLOY_ID        the deploy's id (`desktop` of `deploy.desktop`)
 *   PENGUIN_DEPLOY_RUN       the run id
 *   PENGUIN_DEPLOY_REPO      owner/repo of the head   PENGUIN_DEPLOY_PR      the PR number (empty: no PR)
 *   PENGUIN_DEPLOY_PR_URL    the PR's URL (empty)     PENGUIN_DEPLOY_BRANCH  the head branch
 *   PENGUIN_DEPLOY_HEAD      the head commit (full sha) — what to deploy
 *   PENGUIN_DEPLOY_PROPOSAL  the proposal number, empty for a head no proposal registered
 *   PENGUIN_DEPLOY_BY        who started it (`user:<id>` / `agent:<id>`)
 *
 * A module imports this from `@prismshadow/penguin-plugin-company-proposals/deploy`, a bundle
 * of its own with nothing of the plugin's services in it.
 */
import { ActionFailure, ActionRefusal, type Guard, type RunContext } from "./action-model.js";

export { OUTPUT_LIMIT, PROCESS_TIMEOUT_MS as DEPLOY_TIMEOUT_MS } from "./action-live.js";

/** The parameters of a deploy Action, as its contribution declares them. */
export const DEPLOY_PARAMS: Record<string, string> = {
  "expectedHead?": "string",
  "args?": "string[]",
};

/** The subjects a deploy acts on. */
export const DEPLOY_SUBJECTS = ["proposal", "change_request", "branch"];

const MAX_ARGS = 64;
const MAX_ARG_LENGTH = 4096;

/** The default guard of a deploy: one run of the Action at a time. */
export const deployGuard: Guard = ({ running, subject }) => {
  if (running > 0) {
    throw new ActionRefusal(
      409,
      "deploy_busy",
      `A run of this deploy is still going; wait for it to finish before deploying ${subject.text}.`,
    );
  }
};

/** The extra arguments a run carries, checked. */
export function argsOf(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_ARGS) {
    throw new ActionRefusal(
      400,
      "bad_params",
      `args must be a list of at most ${MAX_ARGS} strings.`,
    );
  }
  return raw.map((a) => {
    if (typeof a !== "string" || a.length > MAX_ARG_LENGTH || a.includes("\0")) {
      throw new ActionRefusal(
        400,
        "bad_params",
        `args: every item must be a string of at most ${MAX_ARG_LENGTH} characters.`,
      );
    }
    return a;
  });
}

/** The environment a deploy's process gets on top of the server's. */
export function deployEnv(
  ctx: Pick<RunContext, "runId" | "commit" | "caller"> & { key: string },
): Record<string, string> {
  const c = ctx.commit;
  return {
    PENGUIN_DEPLOY_ID: ctx.key.startsWith("deploy.") ? ctx.key.slice("deploy.".length) : ctx.key,
    PENGUIN_DEPLOY_RUN: ctx.runId,
    PENGUIN_DEPLOY_REPO: c?.repo ?? "",
    PENGUIN_DEPLOY_PR: c?.pr == null ? "" : String(c.pr),
    PENGUIN_DEPLOY_PR_URL: c?.prUrl ?? "",
    PENGUIN_DEPLOY_BRANCH: c?.branch ?? "",
    PENGUIN_DEPLOY_HEAD: c?.sha ?? "",
    PENGUIN_DEPLOY_PROPOSAL: c?.proposal == null ? "" : String(c.proposal),
    PENGUIN_DEPLOY_BY: ctx.caller.principal,
  };
}

/**
 * Runs `argv` (then the run's extra `args`) as the deploy `key`: resolves with the exit once it
 * exited 0; a run that exits otherwise, is stopped, or never starts fails with the reason.
 */
export async function deployProcess(
  ctx: RunContext,
  key: string,
  argv: readonly string[],
): Promise<{ exitCode: number; head: string }> {
  if (ctx.commit === null) {
    throw new ActionRefusal(409, "no_commit", `${ctx.subject.text} has no commit to deploy.`);
  }
  const end = await ctx.process([...argv, ...argsOf(ctx.params.args)], {
    env: deployEnv({ ...ctx, key }),
  });
  if (end.exitCode === 0) return { exitCode: 0, head: ctx.commit.sha };
  const why = end.timedOut
    ? (end.error ?? "stopped after the time limit")
    : end.exitCode === null
      ? (end.error ?? "the process did not exit")
      : `exited with ${end.exitCode}${end.error === null ? "" : `: ${end.error}`}`;
  throw new ActionFailure(
    500,
    end.timedOut ? "deploy_timed_out" : "deploy_failed",
    `${key} ${why}.`,
  );
}
