/**
 * Example: an Agent that builds another Agent — programmatically, via the SDK.
 *
 * This is the "Harness for Building Agents" pillar in code. It runs entirely on a local
 * open-weight model (Ollama serving qwen3.6:35b) — see README.md for the one-time setup.
 *
 * Two phases, both driven purely through the SDK:
 *   1. BUILD  — drive `default_agent` with the `agent-creation` skill to scaffold a brand-new
 *               agent (`commit-helper`) from a plain-language requirement.
 *   2. RUN    — load the freshly-created agent and have it do its job (write a commit message),
 *               proving the generated AGENTS.md actually shapes its behavior.
 *
 * Run:  pnpm --dir examples/build-agent-with-agent start
 *   or: npx tsx examples/build-agent-with-agent/build-agent.ts
 */
import {
  createAgent,
  userText,
  isCompleteModelMessage,
  type OmniMessage,
} from "@prismshadow/penguin-core";

/** Stream a Session run to stdout and collect the assistant's final text. */
async function runToStdout(run: AsyncGenerator<OmniMessage>): Promise<string> {
  let finalText = "";
  for await (const msg of run) {
    if (isCompleteModelMessage(msg) && msg.payload.type === "text") {
      finalText += msg.payload.text;
      process.stdout.write(msg.payload.text + "\n");
    }
  }
  return finalText;
}

const BUILD_REQUEST = `Use the agent-creation skill to create a brand-new agent in this project.

Requirement: an agent called "commit-helper" that writes high-quality git commit messages.
Given a diff or a description of changes, it must produce a Conventional Commits message: a
\`type(scope): subject\` header (type one of feat/fix/docs/refactor/test/chore), subject in
imperative mood and under 50 characters, then a blank line and a short body explaining the "why".

Do everything the agent-creation skill specifies: create the agent directory layout, copy the
base system_config.yaml, write a concise AGENTS.md capturing this requirement, and set the new
agent's name and description in system_config.yaml. Report the files you created when done.`;

const COMMIT_TASK = `Write a commit message for this change: I added retry-with-backoff logic to
the payment API client because transient 503s from the gateway were causing checkout failures.
Touched packages/core/src/payment/client.ts.`;

async function main(): Promise<void> {
  // --- Phase 1: an Agent builds an Agent ------------------------------------------------
  console.log("=== Phase 1: default_agent is building a new agent via the agent-creation skill ===\n");
  const builder = await createAgent({ agentId: "default_agent" });
  const buildSession = await builder.createSession({ workspaceDir: process.cwd() });

  // approve: () => "allow" lets the builder run its shell tool calls unattended. In a real
  // integration you would inspect each tool_call and decide — that is the whole point of the
  // per-call approval callback.
  await runToStdout(
    buildSession.run([userText(BUILD_REQUEST)], { approve: async () => "allow" }),
  );

  // --- Phase 2: run the agent that was just built ---------------------------------------
  console.log("\n=== Phase 2: running the freshly-created commit-helper agent ===\n");
  const helper = await createAgent({ agentId: "commit-helper" });
  const helperSession = await helper.createSession({ workspaceDir: process.cwd() });

  const commitMessage = await runToStdout(
    helperSession.run([userText(COMMIT_TASK)], { approve: async () => "allow" }),
  );

  console.log("\n=== Done. commit-helper produced the message above. ===");
  if (!commitMessage.trim()) {
    console.error("(No text output — check that Ollama is running and the model is configured.)");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Example failed:", err);
  process.exitCode = 1;
});
