import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { AcpConnection, type SpawnProcess } from "../src/connection.js";
import { CodingAgentManager } from "../src/manager.js";

const CLIENT_INFO = { name: "penguin-test", version: "0.0.0" };
const HANDLERS = {
  onEvent: () => undefined,
  onPermissionRequest: async () => ({ outcome: { outcome: "cancelled" } as const }),
};

describe("CodingAgentManager over a real subprocess", () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agents-e2e-"));
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it("spawns the agent, handshakes, and streams a full turn over stdio", async () => {
    const manager = new CodingAgentManager({
      clientInfo: CLIENT_INFO,
      envFor: () => ({}),
    });
    manager.setDefinitions([
      {
        id: "fake",
        command: process.execPath,
        args: [fileURLToPath(new URL("./agent-main.mjs", import.meta.url))],
      },
    ]);
    const session = await manager.createSession("fake", workspace);
    await manager.prompt(session.sessionId, "hi");
    const view = manager.sessionView(session.sessionId);
    expect(view?.events).toEqual([
      {
        type: "message_chunk",
        sessionId: session.sessionId,
        delta: "hello from subprocess",
      },
      { type: "turn_end", sessionId: session.sessionId, stopReason: "end_turn" },
    ]);
    await manager.disposeSession(session.sessionId);
    manager.dispose();
  });

  // Node refuses to spawn .cmd/.bat without a shell; the cmd.exe routing is what makes
  // npm-shim agents (gemini, npx-run adapters) startable on Windows at all.
  it.skipIf(process.platform !== "win32")("spawns a .cmd shim end to end via cmd.exe", async () => {
    const shim = path.join(workspace, "fake-agent.cmd");
    const agentMain = fileURLToPath(new URL("./agent-main.mjs", import.meta.url));
    await fs.writeFile(shim, `@node "${agentMain}"\r\n`);
    const manager = new CodingAgentManager({
      clientInfo: CLIENT_INFO,
      envFor: () => ({}),
    });
    manager.setDefinitions([{ id: "fake", command: shim }]);
    const session = await manager.createSession("fake", workspace);
    await manager.prompt(session.sessionId, "hi");
    const view = manager.sessionView(session.sessionId);
    expect(view?.events.at(-1)).toEqual({
      type: "turn_end",
      sessionId: session.sessionId,
      stopReason: "end_turn",
    });
    await manager.disposeSession(session.sessionId);
    manager.dispose();
  });
});

describe("AcpConnection spawn routing", () => {
  /**
   * A child process good enough for the connection plumbing; no pid, so never killed.
   * Cast through unknown: the real ChildProcess types stdin/stdout/stderr as nullable.
   */
  function fakeProc(): ChildProcess {
    const streams = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    };
    const fake = {
      ...streams,
      on: () => streams.stdout,
      kill: () => true,
    };
    return fake as unknown as ChildProcess;
  }

  /** Record the (file, args, options) a spawn received; the spawn type's overload union is not worth matching literally. */
  function recordingSpawn(
    record: (entry: { file: string; args: string[]; options: SpawnOptions }) => void,
  ): SpawnProcess {
    return ((file: string, args: string[], options: SpawnOptions) => {
      record({ file, args: [...args], options });
      return fakeProc();
    }) as unknown as SpawnProcess;
  }

  it("hands .cmd shims to cmd.exe as one pre-quoted line on Windows", async () => {
    const seen: { file: string; args: string[]; options: SpawnOptions }[] = [];
    const connection = await AcpConnection.spawn(
      "C:\\npm\\gemini.cmd",
      ["--experimental-acp"],
      {},
      CLIENT_INFO,
      HANDLERS,
      recordingSpawn((entry) => seen.push(entry)),
    );
    connection.dispose();
    if (process.platform === "win32") {
      expect(seen[0]?.file).toBe("cmd.exe");
      expect(seen[0]?.args).toEqual(["/d", "/s", "/c", '"C:\\npm\\gemini.cmd --experimental-acp"']);
      expect(seen[0]?.options.windowsVerbatimArguments).toBe(true);
    } else {
      expect(seen[0]?.file).toBe("C:\\npm\\gemini.cmd");
    }
  });

  it("passes ordinary commands through untouched", async () => {
    const seen: { file: string; args: string[]; options: SpawnOptions }[] = [];
    const connection = await AcpConnection.spawn(
      process.execPath,
      ["--version"],
      {},
      CLIENT_INFO,
      HANDLERS,
      recordingSpawn((entry) => seen.push(entry)),
    );
    connection.dispose();
    expect(seen[0]?.file).toBe(process.execPath);
    expect(seen[0]?.args).toEqual(["--version"]);
    expect(seen[0]?.options).not.toHaveProperty("windowsVerbatimArguments");
  });

  // A shim under "C:\Program Files\..." must keep its own quotes once cmd strips the
  // outer pair; otherwise cmd's prefix guessing picks "C:\program".
  it.skipIf(process.platform !== "win32")(
    "quotes shim paths that contain spaces on their own",
    async () => {
      const seen: { file: string; args: string[] }[] = [];
      const connection = await AcpConnection.spawn(
        "C:\\Program Files\\nodejs\\npx.cmd",
        ["-y", "claude-agent-acp"],
        {},
        CLIENT_INFO,
        HANDLERS,
        recordingSpawn((entry) => seen.push(entry)),
      );
      connection.dispose();
      expect(seen[0]?.file).toBe("cmd.exe");
      // The doubled outer pair is the cross-spawn form: cmd /s strips the outermost
      // quotes, leaving the spaced path quoted for cmd's own parsing.
      expect(seen[0]?.args).toEqual([
        "/d",
        "/s",
        "/c",
        '""C:\\Program Files\\nodejs\\npx.cmd" -y claude-agent-acp"',
      ]);
    },
  );
});
