/** SDK host for one isolated role. Model transport stays outside the role container. */
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ToolRecovery, RecoveryError } from "./recovery.mjs";

export function confiner(config) {
  return (argv, opts) => {
    if (!config.container?.match(/^openskill-[a-f0-9]{32}$/)) {
      throw new Error("An isolated container is required");
    }
    const cwd = path.resolve(opts.cwd);
    const roots = [config.writable ?? config.work, config.work, ...config.readonly];
    if (!roots.some((root) => cwd === root || cwd.startsWith(root + path.sep))) {
      throw new Error("Tool working directory is outside the role mounts");
    }
    const command = [...argv];
    if (command[0] === process.execPath) command[0] = "/opt/openskill-node";
    return {
      argv: [
        config.docker,
        "exec",
        "-i",
        "--user",
        `${config.uid}:${config.gid}`,
        "--workdir",
        cwd,
        config.container,
        "/usr/bin/env",
        "-i",
        "PATH=/usr/local/bin:/usr/bin:/bin",
        "HOME=/tmp",
        "LANG=C.UTF-8",
        "PYTHONDONTWRITEBYTECODE=1",
        "PYTEST_DISABLE_PLUGIN_AUTOLOAD=1",
        ...command,
      ],
    };
  };
}

export function roleConfig(sdk, config) {
  const defaults = sdk.defaultSystemConfig();
  const allowed = new Set([
    "read_file",
    "write_file",
    "edit_file",
    "exec_command",
    "input_command",
  ]);
  return {
    version: 1,
    system_prompt:
      `You are the OpenSkill ${config.role}. Follow the supplied role contract. ` +
      "Use only the provided public evidence. Work in the Workspace; external network is unavailable. " +
      "Keep exec_command workdir omitted or equal to the Workspace. inputs/ contains read-only evidence. " +
      "All paths in the current role request are beneath this Workspace; do not use their parent " +
      "or paths remembered from previous turns. For official practice, the Workspace is a fresh " +
      "writable output directory and skills/ is read-only. Relative file paths resolve against the Workspace. " +
      "Do not seek benchmark scores, hidden tests, other agents, credentials or host files. " +
      "Report unavailable evidence honestly. Never claim that a self-report is an executor measurement.",
    max_turns: -1,
    model: { ...defaults.model, thinking_level: config.runtime.thinking_level },
    compaction: defaults.compaction,
    memory: { enabled: false },
    vault: { enabled: false },
    skills: { enabled: false },
    schedules: { enabled: false },
    tools: {
      builtin: defaults.tools.builtin.filter((tool) => allowed.has(tool.name)),
      mcpServers: [],
    },
  };
}

async function writeOnce(file, text) {
  try {
    await fs.writeFile(file, text, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST" || (await fs.readFile(file, "utf8")) !== text) throw error;
  }
}

let stage = "sdk_import";
async function main(file) {
  const config = JSON.parse(await fs.readFile(file, "utf8"));
  const sdk = await import(pathToFileURL(config.sdk).href);
  stage = "agent_setup";
  if (!/^openskill_[a-f0-9]{32}$/.test(config.agent_id))
    throw new Error("Dedicated agent id required");
  const state = path.join(
    config.penguin_home,
    config.project_id,
    "agents",
    config.agent_id,
    "agent_state",
  );
  await fs.mkdir(state, { recursive: true });
  await writeOnce(path.join(state, "system_config.yaml"), JSON.stringify(roleConfig(sdk, config)));
  await writeOnce(path.join(state, "AGENTS.md"), "");
  const agent = await sdk.createAgent({
    root: config.penguin_home,
    projectId: config.project_id,
    agentId: config.agent_id,
    confineSpawn: () => confiner(config),
    // Role tools receive no proxy or control credentials; docker exec also clears their env.
    proxyEnv: () => null,
    controlEnv: () => ({}),
  });
  stage = "session_setup";
  const session = config.session_id
    ? await agent.resumeSession({ sessionId: config.session_id })
    : await agent.createSession({
        workspaceDir: config.work,
        provider: config.runtime.provider,
        modelId: config.runtime.model_id,
        thinkingLevel: config.runtime.thinking_level,
      });
  if (session.provider !== config.runtime.provider || session.modelId !== config.runtime.model_id) {
    throw new Error("Construction model changed on resume");
  }
  // This SDK property is the live override, not the createSession default getter.
  session.thinkingLevel = config.runtime.thinking_level;
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  const timer = setTimeout(stop, Math.max(0, Date.parse(config.deadline) - Date.now()));
  const log = await fs.open(config.messages, "wx", 0o600);
  const recovery = config.recovery_policy
    ? new ToolRecovery(
        config.recovery_policy,
        config.tool_recovery,
        path.join(config.work, "skills"),
      )
    : null;
  let recoveryTimer;
  let recoveryTimeout = false;
  try {
    // The executor registers the actual identity before authorizing the first model call.
    process.stdout.write(JSON.stringify({ session_id: session.sessionId }) + "\n");
    const go = await new Promise((resolve) => {
      process.stdin.once("data", (data) => resolve(data.toString().trim()));
      process.stdin.once("end", () => resolve(""));
      abort.signal.addEventListener("abort", () => resolve(""), { once: true });
    });
    process.stdin.pause();
    if (go !== "go" || abort.signal.aborted)
      throw new Error("Launch was not authorized before deadline");
    stage = "model_turn";
    const iterator = session.run([sdk.userText(config.prompt)], {
      approve: async () => "allow",
      signal: abort.signal,
    });
    let cutoff;
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        cutoff = next.value;
        break;
      }
      await log.write(JSON.stringify(next.value) + "\n");
      const output = next.value.type === "model_msg" ? next.value.payload : null;
      if (recovery) {
        try {
          // Request boundaries are event_msg records; tool records are model_msg.
          recovery.observe(next.value.payload);
          clearTimeout(recoveryTimer);
          if (recovery.pending)
            recoveryTimer = setTimeout(
              () => {
                recoveryTimeout = true;
                abort.abort();
              },
              Math.max(0, recovery.pending.deadline - Date.now()),
            );
        } catch (error) {
          abort.abort();
          await iterator.return();
          throw error;
        }
      }
      if (
        config.stop_on_tool_failure &&
        output?.type === "tool_call_output" &&
        ["fatal", "aborted"].includes(output.stop_reason)
      ) {
        abort.abort();
        await iterator.return();
        const error = new Error(`Official practice tool failed: ${output.tool_call_id}`);
        error.code = "PRACTICE_TOOL_FAILED";
        throw error;
      }
    }
    if (recoveryTimeout)
      throw new RecoveryError("RECOVERY_TIME_EXHAUSTED", "Practice correction deadline reached");
    if (abort.signal.aborted || cutoff)
      throw new Error(`Role did not complete: ${JSON.stringify(cutoff)}`);
    recovery?.finish();
    await fs.writeFile(
      config.result,
      JSON.stringify({ session_id: session.sessionId, completed: true }),
    );
  } finally {
    clearTimeout(recoveryTimer);
    clearTimeout(timer);
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await session.dispose();
    await log.close();
    if (recovery)
      await fs.writeFile(
        path.join(path.dirname(config.result), "recovery.json"),
        JSON.stringify(recovery.report(), null, 2),
        { flag: "wx", mode: 0o600 },
      );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv[2]).catch(async (error) => {
    const message =
      stage === "session_setup"
        ? "Session setup failed; check the configured model privately"
        : error.message;
    try {
      const config = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
      await fs.writeFile(
        config.result,
        JSON.stringify({
          completed: false,
          stage,
          error_code: error.code ?? error.name,
          error: message,
        }),
        { flag: "wx", mode: 0o600 },
      );
    } catch {
      /* Preserve launcher stderr even if its result path is unavailable. */
    }
    console.error(`${stage}: ${message}`);
    process.exitCode = 1;
  });
}
