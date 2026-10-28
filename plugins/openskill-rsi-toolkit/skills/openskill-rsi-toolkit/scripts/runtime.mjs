/** Host SDK checks. No model turn, task input or role container is needed. */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { roleConfig } from "./launch.mjs";

const hash = async (file) =>
  crypto
    .createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");

export async function inspectRuntime(config) {
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node 24+ is required");
  const entry = await fs.realpath(config.sdk);
  const sdk = await import(pathToFileURL(entry).href);
  for (const name of [
    "createAgent",
    "defaultSystemConfig",
    "userText",
    "Environment",
    "toolCall",
  ]) {
    if (typeof sdk[name] !== "function") throw new Error(`SDK export unavailable: ${name}`);
  }
  const files = {};
  async function visit(folder) {
    for (const item of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const file = path.join(folder, item.name);
      if (item.isDirectory()) await visit(file);
      else if (item.isFile()) files[file] = await hash(file);
      else throw new Error("SDK dist must contain regular files and directories");
    }
  }
  await visit(path.dirname(entry));
  const packageFile = path.join(path.dirname(entry), "..", "package.json");
  const pkg = JSON.parse(await fs.readFile(packageFile, "utf8"));
  if (pkg.name !== "@prismshadow/penguin-core") throw new Error("Expected Penguin core package");
  files[packageFile] = await hash(packageFile);
  const dependencies = {};
  for (const name of Object.keys(pkg.dependencies ?? {}).sort()) {
    let folder = path.dirname(packageFile),
      found;
    while (true) {
      const candidate = path.join(folder, "node_modules", name, "package.json");
      try {
        found = await fs.realpath(candidate);
        break;
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const parent = path.dirname(folder);
      if (parent === folder) throw new Error(`SDK dependency unavailable: ${name}`);
      folder = parent;
    }
    const metadata = JSON.parse(await fs.readFile(found, "utf8"));
    dependencies[name] = {
      version: metadata.version,
      package_file: found,
      sha256: await hash(found),
    };
  }
  const identity = {
    node: await fs.realpath(process.execPath),
    node_version: process.version,
    node_sha256: await hash(process.execPath),
    sdk: entry,
    sdk_version: pkg.version,
    files,
    dependencies,
  };
  return {
    sdk,
    identity,
    fingerprint: crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex"),
  };
}

async function main() {
  const request = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
  const report = { status: "checking", stage: "sdk_import", model_requests: 0 };
  let agentPath, session;
  try {
    const { sdk, identity, fingerprint } = await inspectRuntime(request.executor);
    Object.assign(report, { identity, fingerprint });
    if (request.check_session) {
      report.stage = "session_setup";
      const config = request.executor;
      const agentId = request.probe_agent_id;
      if (!/^openskill_probe_[a-f0-9]{32}$/.test(agentId))
        throw new Error("Invalid probe identity");
      agentPath = path.join(config.penguin_home, config.project_id, "agents", agentId);
      await fs.mkdir(path.join(agentPath, "agent_state"), { recursive: true });
      const work = path.join(agentPath, "scratchpad");
      await fs.mkdir(work);
      const role = roleConfig(sdk, { role: "creator", runtime: request.runtime.construction });
      await fs.writeFile(
        path.join(agentPath, "agent_state/system_config.yaml"),
        JSON.stringify(role),
      );
      await fs.writeFile(path.join(agentPath, "agent_state/AGENTS.md"), "");
      // No session.run or tool calls. A mistaken fetch must fail before leaving this process.
      globalThis.fetch = async () => {
        report.model_requests++;
        throw new Error("Network forbidden during runtime preflight");
      };
      const agent = await sdk.createAgent({
        root: config.penguin_home,
        projectId: config.project_id,
        agentId,
        proxyEnv: () => null,
        controlEnv: () => ({}),
        confineSpawn: () => () => {
          throw new Error("Tools forbidden during runtime preflight");
        },
      });
      const runtime = request.runtime.construction;
      session = await agent.createSession({
        workspaceDir: work,
        provider: runtime.provider,
        modelId: runtime.model_id,
        thinkingLevel: runtime.thinking_level,
      });
      if (session.provider !== runtime.provider || session.modelId !== runtime.model_id)
        throw new Error("Session model changed");
      session.thinkingLevel = runtime.thinking_level;
      await session.dispose();
      session = undefined;
      report.session = {
        created: true,
        disposed: true,
        resume_checked: false,
        resume_note:
          "A never-run Session has no resumable Trace; resume is covered by the scripted-provider integration test",
        provider: runtime.provider,
        model_id: runtime.model_id,
      };
    }
    report.status = "ready";
  } catch (error) {
    report.status = "failed";
    report.error_code = error.code ?? error.name;
    // SDK import errors identify missing packages. Project/client errors can contain credentials.
    report.error =
      report.stage === "sdk_import"
        ? error.message
        : "Agent/Session configuration check failed; inspect the configured model locally without publishing credentials";
    process.exitCode = 1;
  } finally {
    try {
      if (session) await session.dispose();
      if (agentPath) await fs.rm(agentPath, { recursive: true, force: true });
      report.cleanup_confirmed = true;
    } catch {
      report.status = "failed";
      report.cleanup_confirmed = false;
      report.error = "Runtime probe cleanup failed";
      process.exitCode = 1;
    }
    await fs.writeFile(process.argv[3], JSON.stringify(report, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error("Runtime probe could not save its report");
    process.exitCode = 1;
  });
}
