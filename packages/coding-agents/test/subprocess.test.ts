import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { AcpConnection, type SpawnProcess } from "../src/connection.js";
import { CodingAgentManager } from "../src/manager.js";
import { AcpAgentError } from "../src/types.js";

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

  // A command that cannot start (uninstalled CLI, dead shim path) must fail as the
  // kernel's safe error — a bare stream failure would surface as a raw 500.
  it("maps a failed spawn to the kernel's safe error", async () => {
    const manager = new CodingAgentManager({
      clientInfo: CLIENT_INFO,
      envFor: () => ({}),
    });
    manager.setDefinitions([{ id: "missing", command: "definitely-not-a-real-tool-xyz" }]);
    const error = await manager.createSession("missing", workspace).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AcpAgentError);
    expect((error as AcpAgentError).message).toContain("could not be started");
    manager.dispose();
  });
});

describe("AcpConnection spawn routing", () => {
  /**
   * A child process good enough for the connection plumbing; no pid, so never killed.
   * Cast through unknown: the real ChildProcess types stdin/stdout/stderr as nullable.
   */
  function fakeProc(): ChildProcess & { fail(error: Error): void; endStreams(): void } {
    const emitter = new EventEmitter();
    const streams = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    };
    const fake = {
      ...streams,
      on: (event: string, listener: (arg: unknown) => void) => emitter.on(event, listener),
      kill: () => true,
      fail: (error: Error) => emitter.emit("error", error),
      endStreams: () => {
        streams.stdin.end();
        streams.stdout.end();
        streams.stderr.end();
      },
    };
    return fake as unknown as ChildProcess & { fail(error: Error): void; endStreams(): void };
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

  // cmd.exe expands %VARS% even inside double quotes; the escape must sit outside a
  // fresh quote pair to survive.
  it.skipIf(process.platform !== "win32")("escapes percent signs in shim arguments", async () => {
    const seen: { file: string; args: string[] }[] = [];
    const connection = await AcpConnection.spawn(
      "C:\\npm\\tool.cmd",
      ["--rate", "100%"],
      {},
      CLIENT_INFO,
      HANDLERS,
      recordingSpawn((entry) => seen.push(entry)),
    );
    connection.dispose();
    expect(seen[0]?.file).toBe("cmd.exe");
    // "100"^%"" reads back as 100%: the ^ escape sits outside the quote pair.
    expect(seen[0]?.args).toEqual(["/d", "/s", "/c", '"C:\\npm\\tool.cmd --rate "100"^%"""']);
  });

  it("leads with the spawn error when the child never starts", async () => {
    const proc = fakeProc();
    const connection = await AcpConnection.spawn(
      "C:\\npm\\missing.cmd",
      [],
      {},
      CLIENT_INFO,
      HANDLERS,
      (() => proc) as unknown as SpawnProcess,
    );
    const pending = connection.initialize();
    proc.fail(new Error("spawn cmd.exe ENOENT"));
    proc.endStreams();
    await expect(pending).rejects.toThrow(/could not be started/);
    connection.dispose();
  });

  // A live agent answering the handshake with a JSON-RPC error is a refusal, not an
  // exit — its own diagnostic is what the user needs to see.
  it("relays the refusal when a live agent rejects the handshake", async () => {
    const streams = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    };
    const fake = {
      ...streams,
      on: () => streams.stdout,
      kill: () => true,
    } as unknown as ChildProcess;
    const connection = await AcpConnection.spawn(
      "node",
      [],
      {},
      CLIENT_INFO,
      HANDLERS,
      (() => fake) as unknown as SpawnProcess,
    );
    const pending = connection.initialize();
    const raw: Buffer = await new Promise((resolve) => streams.stdin.once("data", resolve));
    const request = JSON.parse(raw.toString()) as { id: number };
    streams.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: "initialize not supported" },
      }) + "\n",
    );
    await expect(pending).rejects.toThrow(/refused the ACP handshake: initialize not supported/);
    connection.dispose();
  });
});
