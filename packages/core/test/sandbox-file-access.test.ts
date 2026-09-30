/**
 * The sandbox as the file tools apply it (tools/file-access.ts): the Session's policy —
 * the one its commands are confined under — decided in-process, on the real path, before
 * read_file, edit_file and write_file touch anything.
 *
 * - `read-only` denies every write but the temporary directory's; `workspace-write` allows
 *   the Workspace, the Session's scratchpad and the temporary directory and denies the rest.
 * - A symlink is followed to where the write would land, so a link planted inside the
 *   Workspace does not carry a write outside it; a path that does not exist yet is judged
 *   through its deepest existing ancestor.
 * - A masked path is unreadable and unwritable under every mode.
 * - A URL read follows the network level.
 * - The Environment hands the guard to every tool call from `sandboxPolicy`, re-read per call.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SandboxFileAccess, canonicalPath } from "../src/environment/tools/file-access.js";
import { READ_FILE_NAME, createReadFileTool } from "../src/environment/tools/read-file.js";
import { EDIT_FILE_NAME, createEditFileTool } from "../src/environment/tools/edit-file.js";
import { WRITE_FILE_NAME, createWriteFileTool } from "../src/environment/tools/write-file.js";
import { Environment } from "../src/environment/index.js";
import { toolCall } from "../src/omnimessage/index.js";
import type { BuiltinTool, ToolResult } from "../src/environment/tools/types.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import type { ToolConfig, ToolDefinitionConfig } from "../src/interfaces/index.js";
import type { SandboxSettings } from "../src/plugin/sandbox.js";

function def(name: string, permission: "r" | "rw"): ToolDefinitionConfig {
  return { name, description: "test", permission };
}

async function run(
  tool: BuiltinTool,
  args: Record<string, unknown>,
  workspaceDir: string,
  fileAccess?: SandboxFileAccess,
): Promise<{ result: ToolResult | void; text: string }> {
  const gen = tool.execute(args, {
    workspaceDir,
    toolCallId: "c1",
    ...(fileAccess ? { fileAccess } : {}),
  });
  const messages: OmniMessage[] = [];
  let result: ToolResult | void;
  for (;;) {
    const res = await gen.next();
    if (res.done) {
      result = res.value;
      break;
    }
    messages.push(res.value);
  }
  const text = messages.map((m) => (m.payload as { output?: string }).output ?? "").join("");
  return { result, text };
}

let tmp: string;
let workspace: string;
let scratchpad: string;
let outside: string;

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(path.join(tmpdir(), "penguin-sandbox-fs-")));
  workspace = path.join(tmp, "ws");
  scratchpad = path.join(tmp, "scratchpad", "session-1");
  outside = path.join(tmp, "elsewhere");
  await mkdir(workspace, { recursive: true });
  await mkdir(scratchpad, { recursive: true });
  await mkdir(outside, { recursive: true });
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/**
 * A guard over the fixture. The fixture itself lives under the temporary directory, which
 * a policy keeps writable unless told otherwise, so the temp grant is off here except where
 * a case is about it.
 */
const guard = (policy: SandboxSettings): SandboxFileAccess =>
  new SandboxFileAccess({
    policy: { writableTemp: false, ...policy },
    workspaceDir: workspace,
    scratchpadDir: scratchpad,
  });

describe("SandboxFileAccess", () => {
  it("under workspace-write, writes land in the Workspace, the scratchpad and the temporary directory only", async () => {
    const access = guard({ mode: "workspace-write" });
    expect(await access.denyWrite(path.join(workspace, "new", "file.txt"))).toBeNull();
    expect(await access.denyWrite(path.join(scratchpad, "PLAN.md"))).toBeNull();
    expect(await access.denyWrite(path.join(tmpdir(), "penguin-sandbox-scratch.txt"))).toContain(
      "Denied by the sandbox",
    );
    expect(
      await guard({ mode: "workspace-write", writableTemp: true }).denyWrite(
        path.join(tmpdir(), "penguin-sandbox-scratch.txt"),
      ),
    ).toBeNull();
    const denied = await access.denyWrite(path.join(outside, "file.txt"));
    expect(denied).toContain("Denied by the sandbox");
    expect(denied).toContain("workspace-write");
    expect(denied).toContain(workspace);
    expect(denied).toContain(scratchpad);
    // The Agent's own state lies outside too.
    expect(
      await access.denyWrite(path.join(tmp, "agent_state", "hooks", "x", "hooks.json")),
    ).toContain("Denied by the sandbox");
  });

  it("under read-only, nothing but the temporary directory is writable, and not even that once it is off", async () => {
    const access = guard({ mode: "read-only" });
    expect(await access.denyWrite(path.join(workspace, "file.txt"))).toContain("read-only");
    expect(await access.denyWrite(path.join(scratchpad, "PLAN.md"))).toContain("read-only");
    expect(await access.denyWrite(path.join(tmpdir(), "penguin-sandbox-scratch.txt"))).toContain(
      "read-only",
    );
    const withTemp = guard({ mode: "read-only", writableTemp: true });
    expect(await withTemp.denyWrite(path.join(tmpdir(), "penguin-sandbox-scratch.txt"))).toBeNull();
  });

  it("follows a symlink to where the write would land", async () => {
    const access = guard({ mode: "workspace-write" });
    // A link inside the Workspace pointing at a file outside it: the write is judged there.
    await writeFile(path.join(outside, "target.txt"), "x");
    await symlink(path.join(outside, "target.txt"), path.join(workspace, "link.txt"));
    expect(await access.denyWrite(path.join(workspace, "link.txt"))).toContain("Denied");
    // A linked directory, and a file that does not exist yet beneath it.
    await symlink(outside, path.join(workspace, "linkdir"));
    expect(await access.denyWrite(path.join(workspace, "linkdir", "new.txt"))).toContain("Denied");
    // A dangling link whose target would be created outside.
    await symlink(path.join(outside, "missing.txt"), path.join(workspace, "dangling.txt"));
    expect(await access.denyWrite(path.join(workspace, "dangling.txt"))).toContain("Denied");
    // The other way round stays allowed: a link outside that lands inside the Workspace.
    await symlink(path.join(workspace, "real.txt"), path.join(outside, "into-ws.txt"));
    expect(await access.denyWrite(path.join(outside, "into-ws.txt"))).toBeNull();
  });

  it("denies reading and writing under a masked path, whatever the mode", async () => {
    const secrets = path.join(workspace, "secrets");
    await mkdir(secrets);
    await writeFile(path.join(secrets, "key.txt"), "k");
    const access = guard({ mode: "danger-full-access", maskPaths: [secrets] });
    expect(await access.denyRead(path.join(secrets, "key.txt"))).toContain("masked");
    expect(await access.denyWrite(path.join(secrets, "other.txt"))).toContain("masked");
    expect(await access.denyRead(path.join(workspace, "open.txt"))).toBeNull();
    expect(await access.denyWrite(path.join(outside, "anything.txt"))).toBeNull();
  });

  it("lets a URL through by the network level: none reaches nothing, local reaches loopback only", () => {
    const open = guard({ mode: "workspace-write" });
    expect(open.denyUrl("https://example.com/a.png")).toBeNull();
    const none = guard({ mode: "workspace-write", network: "none" });
    expect(none.denyUrl("http://127.0.0.1:8080/a.png")).toContain("no network access");
    const local = guard({ mode: "workspace-write", network: "local" });
    expect(local.denyUrl("http://localhost:3000/a.png")).toBeNull();
    expect(local.denyUrl("http://127.0.0.1:3000/a.png")).toBeNull();
    expect(local.denyUrl("http://[::1]:3000/a.png")).toBeNull();
    expect(local.denyUrl("https://example.com/a.png")).toContain("local network");
  });

  it("canonicalPath resolves the existing part and keeps the missing tail", async () => {
    await symlink(outside, path.join(workspace, "linkdir"));
    expect(await canonicalPath(path.join(workspace, "linkdir", "a", "b.txt"))).toBe(
      path.join(outside, "a", "b.txt"),
    );
    expect(await canonicalPath(path.join(workspace, "nothing", "here"))).toBe(
      path.join(workspace, "nothing", "here"),
    );
  });
});

describe("the file tools under a sandbox policy", () => {
  const readTool = () => createReadFileTool(def(READ_FILE_NAME, "r"));
  const editTool = () => createEditFileTool(def(EDIT_FILE_NAME, "rw"));
  const writeTool = () => createWriteFileTool(def(WRITE_FILE_NAME, "rw"));

  it("write_file and edit_file refuse a path outside the writable roots, and touch nothing", async () => {
    const target = path.join(outside, "note.txt");
    await writeFile(target, "before");
    const access = guard({ mode: "workspace-write" });
    const written = await run(
      writeTool(),
      { file_path: target, content: "after" },
      workspace,
      access,
    );
    expect(written.result?.stopReason).toBe("fatal");
    expect(written.text).toContain("Denied by the sandbox");
    const edited = await run(
      editTool(),
      { file_path: target, old_string: "before", new_string: "after" },
      workspace,
      access,
    );
    expect(edited.result?.stopReason).toBe("fatal");
    expect(edited.text).toContain("Denied by the sandbox");
    expect(await readFile(target, "utf8")).toBe("before");
    // Inside the Workspace the same calls go through.
    const inside = path.join(workspace, "note.txt");
    expect(
      (await run(writeTool(), { file_path: inside, content: "before" }, workspace, access)).result
        ?.stopReason,
    ).toBeUndefined();
    expect(
      (
        await run(
          editTool(),
          { file_path: inside, old_string: "before", new_string: "after" },
          workspace,
          access,
        )
      ).result?.stopReason,
    ).toBeUndefined();
    expect(await readFile(inside, "utf8")).toBe("after");
  });

  it("read_file refuses a masked file and a URL the network level does not reach", async () => {
    const masked = path.join(outside, "masked.txt");
    await writeFile(masked, "secret");
    const access = guard({ mode: "workspace-write", network: "none", maskPaths: [outside] });
    const read = await run(readTool(), { file_path: masked }, workspace, access);
    expect(read.result?.stopReason).toBe("fatal");
    expect(read.text).toContain("masked");
    expect(read.text).not.toContain("secret");
    const url = await run(
      readTool(),
      { file_path: "https://example.com/a.png" },
      workspace,
      access,
    );
    expect(url.result?.stopReason).toBe("fatal");
    expect(url.text).toContain("no network access");
  });

  it("without a guard the tools are unconfined, as for an SDK embedder", async () => {
    const target = path.join(outside, "free.txt");
    const { result } = await run(writeTool(), { file_path: target, content: "x" }, workspace);
    expect(result?.stopReason).toBeUndefined();
    expect(await readFile(target, "utf8")).toBe("x");
  });
});

describe("Environment.sandboxPolicy", () => {
  const toolConfig = (): ToolConfig => ({
    customTools: [def(WRITE_FILE_NAME, "rw")],
    mcpServers: [],
  });

  async function execute(env: Environment, args: Record<string, unknown>): Promise<string> {
    const call = toolCall({
      name: WRITE_FILE_NAME,
      arguments: JSON.stringify(args),
      toolCallId: "t1",
    });
    let text = "";
    for await (const msg of env.executeTool({ toolCall: call })) {
      const p = msg.payload as { type?: string; output?: string };
      if (p.type === "tool_call_output" && p.output) text = p.output;
    }
    return text;
  }

  it("hands every call the policy as it is then, bound to the Workspace and the scratchpad", async () => {
    let policy: SandboxSettings | null = { mode: "workspace-write", writableTemp: false };
    const env = new Environment({
      workspaceDir: workspace,
      toolConfig: toolConfig(),
      sessionScratchpadDir: scratchpad,
      sandboxPolicy: () => policy,
    });
    try {
      await env.listTools();
      const outsideFile = path.join(outside, "x.txt");
      expect(await execute(env, { file_path: outsideFile, content: "1" })).toContain(
        "Denied by the sandbox",
      );
      expect(
        await execute(env, { file_path: path.join(scratchpad, "PLAN.md"), content: "plan" }),
      ).toContain("Created");
      // The policy is read at every call: switched off, the same write goes through.
      policy = null;
      expect(await execute(env, { file_path: outsideFile, content: "1" })).toContain("Created");
    } finally {
      env.dispose();
    }
  });
});
