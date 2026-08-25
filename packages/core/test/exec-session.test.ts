/**
 * Behavior tests for long-running command sessions (exec_command yield + input_command).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Environment, ManagedSession } from "../src/environment/index.js";
import { toolCall } from "../src/omnimessage/index.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import type { ProxyEnvPolicy, ToolConfig, ToolDefinitionConfig } from "../src/interfaces.js";

function execTool(overrides: Partial<ToolDefinitionConfig> = {}): ToolDefinitionConfig {
  return {
    name: "exec_command",
    description: "Run a shell command.",
    parameters: {
      type: "object",
      properties: {
        cmd: { type: "string" },
        workdir: { type: "string" },
        yield_time_ms: { type: "number" },
      },
      required: ["cmd"],
    },
    permission: "rw",
    maxOutputLength: 16000,
    ...overrides,
  };
}

function inputCommandTool(overrides: Partial<ToolDefinitionConfig> = {}): ToolDefinitionConfig {
  return {
    name: "input_command",
    description: "Interact with a running command session.",
    parameters: {
      type: "object",
      properties: {
        process_id: { type: "string" },
        chars: { type: "string" },
        yield_time_ms: { type: "number" },
      },
      required: ["process_id"],
    },
    permission: "rw",
    maxOutputLength: 16000,
    ...overrides,
  };
}

function sessionConfig(): ToolConfig {
  return { customTools: [execTool(), inputCommandTool()], mcpServers: [] };
}

interface FinalOutput {
  output: string;
  stopReason?: string;
}

/** Runs one tool call and returns the final tool_call_output's content and stop_reason. */
async function runTool(
  env: Environment,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<FinalOutput> {
  let last: OmniMessage | null = null;
  for await (const msg of env.executeTool({
    toolCall: toolCall({ name, arguments: JSON.stringify(args), toolCallId: `call_${name}` }),
    ...(signal ? { signal } : {}),
  })) {
    if ((msg.payload as { type?: string }).type === "tool_call_output") last = msg;
  }
  const p = (last?.payload ?? {}) as { output?: string; stop_reason?: string };
  return { output: p.output ?? "", stopReason: p.stop_reason };
}

function extractProcessId(output: string): string {
  const m = output.match(/process_id (proc-[0-9a-f]+)/);
  expect(m, `expected a process_id in: ${JSON.stringify(output)}`).toBeTruthy();
  return m![1]!;
}

let tmp: string;
let env: Environment;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "penguin-exec-session-"));
  env = new Environment({ workspaceDir: tmp, toolConfig: sessionConfig() });
});

afterEach(async () => {
  env.dispose();
  // Retries: on Windows a just-killed process tree releases its cwd/file locks asynchronously,
  // so an immediate recursive rm can hit EBUSY; fs.rm retries those with a linear backoff.
  await rm(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe("exec_command — long-running command sessions", () => {
  it("returns promptly when a command backgrounds a long-lived child", async () => {
    // node stays resident in the background and inherits the pipes; bash exits immediately
    // after the foreground echo. The old implementation waited for close (pipe EOF) -> stuck
    // for 5s; the new implementation goes by the foreground exit + a short drain, returning
    // within seconds, and reaps the leftover background process.
    const startedAt = Date.now();
    const res = await runTool(env, "exec_command", {
      cmd: 'node -e "setTimeout(()=>{},5000)" & echo hello',
    });
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(2000);
    expect(res.output).toContain("hello");
    expect(res.output).not.toContain("process running with process_id");
    expect(res.stopReason).toBe("completed");
  });

  it("streams output incrementally while the command is running", async () => {
    // Two output chunks arrive 400ms apart: they should be produced as separate delta segments,
    // not returned all at once when the window ends.
    const deltas: string[] = [];
    for await (const msg of env.executeTool({
      toolCall: toolCall({
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "echo first; sleep 0.4; echo second" }),
        toolCallId: "call_stream",
      }),
    })) {
      const p = msg.payload as { type?: string; event_type?: string; output?: string };
      if (p.type === "partial_tool_call_output" && p.event_type === "delta" && p.output) {
        deltas.push(p.output);
      }
    }
    const firstIdx = deltas.findIndex((d) => d.includes("first"));
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(deltas[firstIdx]).not.toContain("second"); // first arrives earlier, not in the same segment as second
    expect(deltas.slice(firstIdx + 1).some((d) => d.includes("second"))).toBe(true);
  });

  it("yields a process_id when the command is still running past yield_time_ms", async () => {
    const res = await runTool(env, "exec_command", {
      cmd: "sleep 30",
      yield_time_ms: 300,
    });
    expect(res.stopReason).toBe("completed");
    expect(res.output).toContain("process running with process_id proc-");
  });

  it("input_command drives a running session: write stdin, get output and exit status", async () => {
    const start = await runTool(env, "exec_command", {
      cmd: "read line; echo got:$line",
      yield_time_ms: 300,
    });
    const pid = extractProcessId(start.output);

    const res = await runTool(env, "input_command", {
      process_id: pid,
      chars: "penguin\n",
      yield_time_ms: 2000,
    });
    expect(res.output).toContain("got:penguin");
    expect(res.stopReason).toBe("completed");
  });

  it("input_command with an empty chars polls new output without writing", async () => {
    const start = await runTool(env, "exec_command", {
      cmd: "for i in 1 2 3; do echo line$i; sleep 0.2; done",
      yield_time_ms: 100,
    });
    const pid = extractProcessId(start.output);

    const res = await runTool(env, "input_command", {
      process_id: pid,
      chars: "",
      yield_time_ms: 2000,
    });
    // The command finishes during polling, yielding the remaining output and exit status.
    expect(res.output).toContain("line3");
    expect(res.stopReason).toBe("completed");
  });

  it("input_command sends Ctrl-C (U+0003) to interrupt a running session", async () => {
    const start = await runTool(env, "exec_command", {
      cmd: "sleep 30",
      yield_time_ms: 300,
    });
    const pid = extractProcessId(start.output);

    const startedAt = Date.now();
    const res = await runTool(env, "input_command", {
      process_id: pid,
      chars: String.fromCharCode(3), // U+0003 = Ctrl-C
      yield_time_ms: 2000,
    });
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(3000); // Did not wait for the full sleep 30
    expect(res.output).not.toContain("still running");
    expect(res.stopReason).toBe("fatal"); // Interrupted by signal -> non-zero exit
  });

  it("input_command rejects chars mixing U+0003 with other content", async () => {
    const start = await runTool(env, "exec_command", {
      cmd: "sleep 30",
      yield_time_ms: 300,
    });
    const pid = extractProcessId(start.output);

    const res = await runTool(env, "input_command", {
      process_id: pid,
      chars: `q${String.fromCharCode(3)}`, // Mixed with other content: errors, neither writes nor sends the signal
      yield_time_ms: 2000,
    });
    expect(res.output).toContain('send "\\u0003" alone');
    expect(res.stopReason).toBe("fatal");

    // The session was not mistakenly killed: still running.
    const poll = await runTool(env, "input_command", { process_id: pid, yield_time_ms: 300 });
    expect(poll.output).toContain("still running");
  });

  it("input_command reports an unknown process_id without throwing", async () => {
    const res = await runTool(env, "input_command", { process_id: "proc-deadbeef" });
    expect(res.output).toContain("unknown process_id proc-deadbeef");
    expect(res.stopReason).toBe("fatal");
  });

  it("input_command ignores writes to a closed stdin pipe without crashing", async () => {
    const start = await runTool(env, "exec_command", {
      cmd: "exec 0<&-; sleep 30",
      yield_time_ms: 300,
    });
    const pid = extractProcessId(start.output);

    const res = await runTool(env, "input_command", {
      process_id: pid,
      chars: "ignored\n",
      yield_time_ms: 300,
    });
    expect(res.output).toContain(`process still running with process_id ${pid}`);
    expect(res.stopReason).toBe("completed");
  });

  it("runs commands through pipes, not a TTY (isTTY=false)", async () => {
    const res = await runTool(env, "exec_command", {
      cmd: 'node -e "process.stdout.write(String(Boolean(process.stdout.isTTY)))"',
      yield_time_ms: 3000,
    });
    expect(res.output).toContain("false");
    expect(res.stopReason).toBe("completed");
  });

  it("hardens the child env against interactive hangs (editor/credentials/pager)", async () => {
    const res = await runTool(env, "exec_command", {
      cmd: 'echo "$GIT_EDITOR|$GIT_TERMINAL_PROMPT|$PAGER|$TERM"',
      yield_time_ms: 3000,
    });
    expect(res.output).toContain("true|0|cat|dumb");
    expect(res.stopReason).toBe("completed");
  });

  it("does not start new command sessions after the environment is disposed", async () => {
    env.dispose();
    const res = await runTool(env, "exec_command", {
      cmd: "echo should-not-run",
      yield_time_ms: 3000,
    });
    expect(res.output).toContain("command session manager disposed");
    expect(res.output).not.toContain("should-not-run");
    expect(res.stopReason).toBe("fatal");
  });

  it("delivers output arriving while the consumer is suspended without waiting out the window", async () => {
    // Wake-race regression: when data arrives while suspended at `yield`, its wakeup happens
    // before the next wait begins (so it would be missed). collect must re-check the buffer
    // right before sleeping, otherwise this batch of data would not be produced until the
    // window ends (here, 5s).
    const session = new ManagedSession({ cmd: "echo first; cat", cwd: tmp, env: process.env });
    try {
      const gen = session.collect(5000);
      const first = await gen.next();
      expect(first.done).toBe(false);
      expect(String(first.value)).toContain("first");
      // The generator is still suspended at the yield above: writing to stdin now, with cat
      // echoing it back, means both the data event and the wakeup have already happened.
      session.write("second\n");
      await new Promise((r) => setTimeout(r, 300));
      const startedAt = Date.now();
      const next = await gen.next();
      expect(String(next.value)).toContain("second");
      expect(Date.now() - startedAt).toBeLessThan(1500);
      await gen.return(undefined);
    } finally {
      session.kill();
    }
  });
});

describe("harness environment variables never reach a spawned command", () => {
  const KEYS = [
    "PORT",
    "HOST",
    "PENGUIN_CLI_ENTRY",
    "PENGUIN_WEB_DIST",
    "PENGUIN_DESKTOP_TOKEN",
    "PENGUIN_PORT_FILE",
    "PENGUIN_SEED_ADMIN_PASSWORD",
    "PENGUIN_HOME",
    "PENGUIN_WEB_DB",
    // A sample of the PENGUIN_* the prefix rule covers that no by-name list ever named: the
    // resolved shell, the release feed, the UI language and the install location. Whether these
    // specific ones are set at run time is beside the point — the rule is the prefix, and a new
    // variable added next release has to be covered without anyone remembering this file.
    "PENGUIN_SHELL",
    "PENGUIN_UPDATE_FEED_URL",
    "PENGUIN_LANG",
    "PENGUIN_INSTALL_DIR",
  ] as const;
  const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    // `penguin web` writes PORT/HOST into its own process env as the channel to the server
    // module, so this is exactly the state a real serving process is in.
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.PORT = "7364";
    process.env.HOST = "127.0.0.1";
    process.env.PENGUIN_CLI_ENTRY = "/opt/penguin/lib/dist/index.js";
    process.env.PENGUIN_WEB_DIST = "/opt/penguin/web";
    // The desktop shell's process credentials: a leaked token
    // would let an Agent-run command call the server's shutdown endpoint.
    process.env.PENGUIN_DESKTOP_TOKEN = "secret-desktop-token";
    process.env.PENGUIN_PORT_FILE = "/tmp/port-file";
    process.env.PENGUIN_SEED_ADMIN_PASSWORD = "penguin-0000";
    // The data roots this very process is serving from. Inherited, they aim an Agent-started
    // harness at the running one's data — where the lock is already held, so it cannot start.
    process.env.PENGUIN_HOME = "/home/someone/.penguin/data";
    process.env.PENGUIN_WEB_DB = "/home/someone/.penguin/data/web.db";
    process.env.PENGUIN_SHELL = "/opt/penguin/bin/bash";
    process.env.PENGUIN_UPDATE_FEED_URL = "https://example.invalid/feed";
    process.env.PENGUIN_LANG = "zh";
    process.env.PENGUIN_INSTALL_DIR = "/opt/penguin";
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  // Read through node rather than the shell: `echo $PORT` would mean different things in
  // bash and PowerShell, and the resolver picks either depending on the machine.
  const READ_ENV = KEYS.map((k) => `${k}=[' + (process.env.${k} ?? '') + ']`).join(", ");

  it("PORT/HOST and the CLI plumbing are absent, so a dev server the Agent starts picks its own port", async () => {
    const res = await runTool(env, "exec_command", {
      cmd: `node -e "console.log('${READ_ENV}')"`,
    });
    for (const k of KEYS) {
      expect(res.output, `${k} must not reach the child`).toContain(`${k}=[]`);
    }
  });

  it("a differently-cased spelling is stripped too, for Windows' sake", async () => {
    // Windows looks environment names up without regard to case but stores the casing that was
    // written, so `set Port=3000` before `penguin web` reaches a child as PORT — invisible to a
    // strip that only removes the upper-case name. POSIX keeps `Port` and `PORT` apart, which is
    // what lets this run here at all: without the case-insensitive match it passes through.
    process.env.Port = "3000";
    try {
      const res = await runTool(env, "exec_command", {
        cmd: `node -e "console.log('Port=[' + (process.env.Port ?? '') + ']')"`,
      });
      expect(res.output).toContain("Port=[]");
    } finally {
      delete process.env.Port;
    }
  });

  it("inherited FORCE_COLOR is removed, so the NO_COLOR=1 hardening actually wins", async () => {
    // Node deliberately lets FORCE_COLOR defeat NO_COLOR, so a nested `penguin run` under a
    // color-forcing parent (issue #102 observed FORCE_COLOR=3, NO_COLOR=1, TERM=dumb at once)
    // would keep emitting ANSI escapes unless the inherited override is removed outright.
    const saved = {
      FORCE_COLOR: process.env.FORCE_COLOR,
      CLICOLOR_FORCE: process.env.CLICOLOR_FORCE,
    };
    process.env.FORCE_COLOR = "3";
    process.env.CLICOLOR_FORCE = "1";
    try {
      const res = await runTool(env, "exec_command", {
        cmd: `node -e "console.log('F=[' + (process.env.FORCE_COLOR ?? '') + '] C=[' + (process.env.CLICOLOR_FORCE ?? '') + '] N=[' + (process.env.NO_COLOR ?? '') + ']')"`,
      });
      expect(res.output).toContain("F=[] C=[] N=[1]");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("the rest of the host environment still passes through", async () => {
    // Deliberately not a PENGUIN_* name any more. This case asserts that stripping is narrow —
    // that a variable the user's own project relies on survives — and a harness-prefixed name
    // can no longer stand for that, since the prefix is itself the rule.
    process.env.MY_PROJECT_TEST_PASSTHROUGH = "kept";
    try {
      const res = await runTool(env, "exec_command", {
        cmd: `node -e "console.log('V=[' + (process.env.MY_PROJECT_TEST_PASSTHROUGH ?? '') + ']')"`,
      });
      expect(res.output).toContain("V=[kept]");
    } finally {
      delete process.env.MY_PROJECT_TEST_PASSTHROUGH;
    }
  });

  it("the vault can put PORT back — stripping the host value is not a hard ban", async () => {
    const vaultEnv = new Environment({
      workspaceDir: tmp,
      toolConfig: sessionConfig(),
      vault: { PORT: "3000" },
    });
    try {
      const res = await runTool(vaultEnv, "exec_command", {
        cmd: `node -e "console.log('PORT=[' + (process.env.PORT ?? '') + ']')"`,
      });
      expect(res.output).toContain("PORT=[3000]");
    } finally {
      vaultEnv.dispose();
    }
  });

  it("a PENGUIN_* nobody has invented yet is stripped, because the rule is the prefix", async () => {
    // The point of matching on the prefix: this variable exists in no list, and a feature that
    // adds one next release inherits the protection without anyone editing this file.
    process.env.PENGUIN_SOME_FUTURE_SETTING = "leaked";
    try {
      const res = await runTool(env, "exec_command", {
        cmd: `node -e "console.log('X=[' + (process.env.PENGUIN_SOME_FUTURE_SETTING ?? '') + ']')"`,
      });
      expect(res.output).toContain("X=[]");
    } finally {
      delete process.env.PENGUIN_SOME_FUTURE_SETTING;
    }
  });

  it("the vault can put PENGUIN_HOME back, which is how a shared data root is asked for", async () => {
    // Sharing a root with the running harness is a legitimate config decision; inheriting it from
    // whichever process happens to be serving is not. The vault is where that decision is made.
    // The value is deliberately not path-shaped. Git Bash's MSYS layer rewrites POSIX-looking
    // *values* into Windows paths when it launches a native program, so a real root would come
    // back as `C:/Program Files/Git/home/...` on ci-windows and say nothing about the vault. What
    // is under test is that a stripped name is restored at all — the sibling PORT case above uses
    // a plain "3000" for the same reason.
    const vaultEnv = new Environment({
      workspaceDir: tmp,
      toolConfig: sessionConfig(),
      vault: { PENGUIN_HOME: "vault-supplied-root" },
    });
    try {
      const res = await runTool(vaultEnv, "exec_command", {
        cmd: `node -e "console.log('PENGUIN_HOME=[' + (process.env.PENGUIN_HOME ?? '') + ']')"`,
      });
      expect(res.output).toContain("PENGUIN_HOME=[vault-supplied-root]");
    } finally {
      vaultEnv.dispose();
    }
  });
});

describe("proxyEnv policy governs the proxy variables commands inherit", () => {
  // The Web server's proxy settings thread a ProxyEnvPolicy getter through
  // Agent -> Environment -> CommandSessionManager: strip (switch off), inject (explicit
  // address), or null (passthrough); standalone Environments (no getter) keep the
  // historical pass-through.
  const KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"] as const;
  const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};
  let policy: ProxyEnvPolicy | null = null;
  let policyEnv: Environment;

  const INJECT: ProxyEnvPolicy = {
    mode: "inject",
    url: "http://explicit.example:3128",
    noProxy: "corp.example,localhost,127.0.0.1,::1",
  };

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.HTTP_PROXY = "http://proxy.corp.example:8080";
    process.env.HTTPS_PROXY = "http://proxy.corp.example:8443";
    process.env.ALL_PROXY = "socks5://proxy.corp.example:1080";
    process.env.NO_PROXY = "localhost,127.0.0.1,::1";
    policy = { mode: "strip" };
    policyEnv = new Environment({
      workspaceDir: tmp,
      toolConfig: sessionConfig(),
      proxyEnv: () => policy,
    });
  });
  afterEach(() => {
    policyEnv.dispose();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("strip: HTTP(S)_PROXY/ALL_PROXY are removed, NO_PROXY stays (inert without them)", async () => {
    const READ = KEYS.map((k) => `${k}=[' + (process.env.${k} ?? '') + ']`).join(" ");
    const res = await runTool(policyEnv, "exec_command", {
      cmd: `node -e "console.log('${READ}')"`,
    });
    expect(res.output).toContain(
      "HTTP_PROXY=[] HTTPS_PROXY=[] ALL_PROXY=[] NO_PROXY=[localhost,127.0.0.1,::1]",
    );
  });

  it("strip: a lowercase spelling is stripped too (the conventional POSIX form)", async () => {
    process.env.https_proxy = "http://proxy.corp.example:8443";
    try {
      const res = await runTool(policyEnv, "exec_command", {
        cmd: `node -e "console.log('s=[' + (process.env.https_proxy ?? '') + ']')"`,
      });
      expect(res.output).toContain("s=[]");
    } finally {
      delete process.env.https_proxy;
    }
  });

  it("inject: the explicit proxy overrides the inherited variables, both spellings", async () => {
    policy = INJECT;
    const READ =
      "H=[' + (process.env.HTTP_PROXY ?? '') + '] h=[' + (process.env.http_proxy ?? '') + '] " +
      "S=[' + (process.env.HTTPS_PROXY ?? '') + '] s=[' + (process.env.https_proxy ?? '') + ']";
    const res = await runTool(policyEnv, "exec_command", {
      cmd: `node -e "console.log('${READ}')"`,
    });
    expect(res.output).toContain(
      "H=[http://explicit.example:3128] h=[http://explicit.example:3128] " +
        "S=[http://explicit.example:3128] s=[http://explicit.example:3128]",
    );
  });

  it("inject: NO_PROXY is replaced with the policy's merged list and ALL_PROXY is removed", async () => {
    policy = INJECT;
    const READ =
      "N=[' + (process.env.NO_PROXY ?? '') + '] n=[' + (process.env.no_proxy ?? '') + '] " +
      "A=[' + (process.env.ALL_PROXY ?? '') + ']";
    const res = await runTool(policyEnv, "exec_command", {
      cmd: `node -e "console.log('${READ}')"`,
    });
    expect(res.output).toContain(
      "N=[corp.example,localhost,127.0.0.1,::1] n=[corp.example,localhost,127.0.0.1,::1] A=[]",
    );
  });

  it("inject: the vault still wins — a per-Agent proxy outranks the injected one", async () => {
    policy = INJECT;
    const vaultEnv = new Environment({
      workspaceDir: tmp,
      toolConfig: sessionConfig(),
      vault: { HTTP_PROXY: "http://vault.example:9999" },
      proxyEnv: () => policy,
    });
    try {
      const res = await runTool(vaultEnv, "exec_command", {
        cmd: `node -e "console.log('H=[' + (process.env.HTTP_PROXY ?? '') + ']')"`,
      });
      expect(res.output).toContain("H=[http://vault.example:9999]");
    } finally {
      vaultEnv.dispose();
    }
  });

  it("the getter is re-read at every spawn, so a live settings change needs no new Environment", async () => {
    policy = null;
    const res = await runTool(policyEnv, "exec_command", {
      cmd: `node -e "console.log('H=[' + (process.env.HTTP_PROXY ?? '') + ']')"`,
    });
    expect(res.output).toContain("H=[http://proxy.corp.example:8080]");
  });

  it("without the getter (SDK/CLI standalone), proxy variables pass through", async () => {
    const res = await runTool(env, "exec_command", {
      cmd: `node -e "console.log('H=[' + (process.env.HTTP_PROXY ?? '') + ']')"`,
    });
    expect(res.output).toContain("H=[http://proxy.corp.example:8080]");
  });
});
