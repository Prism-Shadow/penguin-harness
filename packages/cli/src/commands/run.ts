/**
 * `penguin run` — send a single Task in one shot.
 *
 *   penguin run -m <msg> [--model-id <id> --provider <group>] [--workspace <path>]
 *               [--project-id <id>] [--agent-id <id>]
 *               [--approve <allow-all|deny-all|read-only|always-ask>]
 *               [--goal [budget]] [--skills <a,b>]
 *
 * Uses the current directory when Workspace is unspecified; uses the Project's default model
 * when model is unspecified. A model reference is always an explicit `(provider, model_id)`
 * pair, so `--model-id` and `--provider` must be given together — giving only one of them is
 * an error, never a lookup. Defaults to interactive per-call approval; `--approve`
 * selects the permission mode.
 * `--goal` switches to goal mode: `-m` becomes the objective and the run loops until the
 * goal reaches a terminal state (optional value = token budget, e.g. `--goal 500k`); only a
 * completed goal exits 0. `--skills` (goal mode only) lists installed skills to apply to
 * every round.
 * Docs: /docs/cli § "penguin run".
 */
import type { Command } from "commander";
import { UNLIMITED_BUDGET, createAgent, goalFilePath, userText } from "@prismshadow/penguin-core";
import { StreamRenderer } from "../render.js";
import { runTask } from "../task-loop.js";
import { runGoalLoop, unknownSkills } from "../goal-loop.js";
import { parseSkillNames, parseTokenBudget } from "../goal-command.js";
import { denyActivePrompt, resolveApprovalMode } from "../approval.js";
import type { Messages } from "../i18n.js";

export function registerRunCommand(program: Command, t: Messages): void {
  program
    .command("run")
    .description(t.run.desc)
    .requiredOption("-m, --message <message>", t.run.message)
    .option("--model-id <id>", t.common.modelId)
    .option("--provider <group>", t.common.provider)
    .option("--project-id <id>", t.common.projectId)
    .option("--agent-id <id>", t.common.agentId)
    .option("--workspace <path>", t.common.workspace)
    .option("--approve <mode>", t.common.approve)
    .option("--goal [budget]", t.run.goal)
    .option("--skills <names>", t.run.skills)
    .action(async (opts) => {
      // The model reference is a pair: commander can only require each option on its own,
      // so the "both or neither" rule is enforced here. Giving neither is the normal case
      // and falls back to the Project's default model.
      if (Boolean(opts.modelId) !== Boolean(opts.provider)) {
        process.stderr.write(`${t.error(t.modelRefIncomplete())}\n`);
        process.exitCode = 1;
        return;
      }
      // --goal's optional value is the token budget (`--goal 500k`); a bare --goal means no
      // budget. Validated before any Session is created, like the model-pair check above.
      let goalBudget: number | null = null;
      if (opts.goal !== undefined) {
        goalBudget = opts.goal === true ? UNLIMITED_BUDGET : parseTokenBudget(String(opts.goal));
        if (goalBudget === null) {
          process.stderr.write(`${t.error(t.goalBudgetInvalid(String(opts.goal)))}\n`);
          process.exitCode = 1;
          return;
        }
      }
      // --skills belongs to goal mode (the names ride every round's goal block); shape is
      // validated here, installed-ness after the agent is loaded (needs the state dir).
      let goalSkills: string[] = [];
      if (opts.skills !== undefined) {
        if (goalBudget === null) {
          process.stderr.write(`${t.error(t.skillsRequireGoal())}\n`);
          process.exitCode = 1;
          return;
        }
        const names = parseSkillNames(String(opts.skills));
        if (names === null) {
          process.stderr.write(`${t.error(t.goalSkillsInvalid(String(opts.skills)))}\n`);
          process.exitCode = 1;
          return;
        }
        goalSkills = names;
      }
      const mode = resolveApprovalMode(opts.approve, t);

      const agent = await createAgent({
        ...(opts.agentId ? { agentId: opts.agentId } : {}),
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
      });

      // Unknown skills refuse to start the goal (checked before the Session exists, so a
      // typo doesn't leave an empty Session behind).
      const unknown = await unknownSkills(goalSkills, agent.state);
      if (unknown !== null) {
        process.stderr.write(`${t.error(t.goalSkillsUnknown(unknown.names, unknown.installed))}\n`);
        process.exitCode = 1;
        return;
      }

      const session = await agent.createSession({
        workspaceDir: opts.workspace ?? process.cwd(),
        ...(opts.modelId ? { modelId: opts.modelId } : {}),
        ...(opts.provider ? { provider: opts.provider } : {}),
      });

      const out = process.stdout;
      out.write(`${t.header("run", agent.state.agentId, session.workspaceDir, session.modelId)}\n`);

      const controller = new AbortController();
      const onSigint = () => {
        // Single SIGINT handler: Ctrl-C during approval collapses to "deny this tool" (see
        // approval.ts); at all other times it interrupts the whole turn.
        if (denyActivePrompt()) return;
        controller.abort();
      };
      process.on("SIGINT", onSigint);

      const renderer = new StreamRenderer(out, t);
      try {
        if (goalBudget !== null) {
          // Goal mode: -m is the objective; the loop runs to a terminal state. Exit code
          // follows the outcome — only a completed goal exits 0 (blocked / budget_limited /
          // aborted are all "the goal did not finish", for scripts/CI to check).
          const outcome = await runGoalLoop(
            session,
            {
              objective: opts.message,
              goalFilePath: goalFilePath(
                agent.state.root,
                agent.state.projectId,
                agent.state.agentId,
                session.sessionId,
              ),
              budget: goalBudget,
              skills: goalSkills,
            },
            { mode, signal: controller.signal, renderer, t, out },
          );
          if (outcome.outcome !== "complete") process.exitCode = 1;
        } else {
          const result = await runTask(session, [userText(opts.message)], {
            mode,
            signal: controller.signal,
            renderer,
            t,
          });
          // Task ended with an abort (LLM failure/reconnect exhausted/user interrupt): non-zero
          // exit code, for scripts/CI to check.
          if (result.aborted) process.exitCode = 1;
        }
      } finally {
        process.off("SIGINT", onSigint);
        session.dispose(); // Tear down managed long-running command sessions to avoid leaking background processes
      }
      out.write("\n");
    });
}
