/**
 * `penguin run` — send a single Task in one shot.
 *
 *   penguin run -m <msg> [--model-id <id>] [--provider <group>] [--workspace <path>]
 *               [--project-id <id>] [--agent-id <id>]
 *               [--approve <allow-all|deny-all|read-only|always-ask>]
 *
 * Uses the current directory when Workspace is unspecified; uses the Project's default model
 * when model is unspecified. `--provider` is optional: when omitted, `--model-id` is resolved
 * via resolveModelRef semantics (only matches when the exact value is globally unique in the
 * config; ambiguity is an error). Defaults to interactive per-call approval; `--approve`
 * selects the permission mode.
 * Docs: /docs/cli § "penguin run".
 */
import type { Command } from "commander";
import { createAgent, userText } from "@prismshadow/penguin-core";
import { StreamRenderer } from "../render.js";
import { runTask } from "../task-loop.js";
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
    .action(async (opts) => {
      const mode = resolveApprovalMode(opts.approve, t);

      const agent = await createAgent({
        ...(opts.agentId ? { agentId: opts.agentId } : {}),
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
      });

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
        const result = await runTask(session, [userText(opts.message)], {
          mode,
          signal: controller.signal,
          renderer,
          t,
        });
        // Task ended with an abort (LLM failure/reconnect exhausted/user interrupt): non-zero
        // exit code, for scripts/CI to check.
        if (result.aborted) process.exitCode = 1;
      } finally {
        process.off("SIGINT", onSigint);
        session.dispose(); // Tear down managed long-running command sessions to avoid leaking background processes
      }
      out.write("\n");
    });
}
