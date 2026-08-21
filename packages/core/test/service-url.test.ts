/**
 * Service-URL detection tests: the pure URL extractor, the incremental output-stream
 * scanner (chunk and ANSI boundaries), the per-platform listen-port probe parsers over
 * fixtures, a live linux probe against a real listener, and the ManagedSession /
 * Environment wiring (output scan wins over the probe; the list carries serviceUrl).
 */
import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Environment } from "../src/environment/index.js";
import {
  CommandSessionManager,
  ServiceUrlScanner,
  extractLastLocalUrl,
  parseLsofListenPorts,
  parsePsPids,
  parseSsListenPorts,
  parseWindowsProbe,
  probeGroupListenPorts,
} from "../src/environment/tools/command/index.js";
import type { ToolConfig } from "../src/interfaces.js";

const ESC = String.fromCharCode(0x1b);

describe("extractLastLocalUrl", () => {
  it("finds a plain localhost URL with port and path", () => {
    expect(extractLastLocalUrl("Local:   http://localhost:5173/app/ ready")).toBe(
      "http://localhost:5173/app/",
    );
  });

  it("strips ANSI color and hyperlink wrapping around the URL", () => {
    const text = `  ${ESC}[32m➜${ESC}[39m  Local: ${ESC}[36mhttp://localhost:5173/${ESC}[39m`;
    expect(extractLastLocalUrl(text)).toBe("http://localhost:5173/");
    const osc = `${ESC}]8;;http://localhost:9999/${ESC}\\http://localhost:5173/${ESC}]8;;${ESC}\\`;
    expect(extractLastLocalUrl(osc)).toBe("http://localhost:5173/");
  });

  it("takes the last URL when several are printed", () => {
    const text = "http://localhost:3000/ then restarted on http://localhost:3001/";
    expect(extractLastLocalUrl(text)).toBe("http://localhost:3001/");
  });

  it("normalizes listen-side wildcard hosts to localhost", () => {
    expect(extractLastLocalUrl("on http://0.0.0.0:8080")).toBe("http://localhost:8080");
    expect(extractLastLocalUrl("on http://[::]:8080")).toBe("http://localhost:8080");
  });

  it("keeps loopback hosts as printed", () => {
    expect(extractLastLocalUrl("http://127.0.0.1:9090/x")).toBe("http://127.0.0.1:9090/x");
    expect(extractLastLocalUrl("http://[::1]:9090")).toBe("http://[::1]:9090");
  });

  it("trims sentence punctuation but keeps the path's own slash", () => {
    expect(extractLastLocalUrl("Listening on http://localhost:4000/.")).toBe(
      "http://localhost:4000/",
    );
  });

  it("accepts https and a port-less origin", () => {
    expect(extractLastLocalUrl("at https://localhost/admin")).toBe("https://localhost/admin");
  });

  it("ignores remote hosts and URL-less text", () => {
    expect(extractLastLocalUrl("see https://example.com:5173/")).toBeNull();
    expect(extractLastLocalUrl("compiled in 130ms")).toBeNull();
  });
});

describe("ServiceUrlScanner (incremental)", () => {
  it("finds a URL split across chunk boundaries", () => {
    const s = new ServiceUrlScanner();
    s.push("  Local: http://loca");
    s.push("lhost:5173/app");
    s.push("/ ready\n");
    expect(s.url).toBe("http://localhost:5173/app/");
  });

  it("re-extends a match the boundary cut mid-URL (latest hit wins)", () => {
    const s = new ServiceUrlScanner();
    s.push("on http://localhost:51");
    // The cut prefix is itself a well-formed URL; the continuation must replace it.
    expect(s.url).toBe("http://localhost:51");
    s.push("73/deep/path");
    expect(s.url).toBe("http://localhost:5173/deep/path");
  });

  it("survives an ANSI escape split across chunks", () => {
    const s = new ServiceUrlScanner();
    s.push(`Local: ${ESC}[3`);
    s.push("6mhttp://localhost:3000/");
    s.push(`${ESC}[39m\n`);
    expect(s.url).toBe("http://localhost:3000/");
  });

  it("keeps the latest URL across pushes and stays null without one", () => {
    const s = new ServiceUrlScanner();
    expect(s.url).toBeNull();
    s.push("http://localhost:3000/\n");
    s.push("x".repeat(2000)); // far beyond the carry window
    s.push("restarted on http://localhost:3001/\n");
    expect(s.url).toBe("http://localhost:3001/");
    s.push("plain build output\n");
    expect(s.url).toBe("http://localhost:3001/");
  });
});

describe("port-probe parsers", () => {
  it("parsePsPids reads one pid per padded line", () => {
    expect(parsePsPids("  123\n  124\n\n")).toEqual([123, 124]);
  });

  it("parseSsListenPorts reads ports and every owner pid, skipping the header", () => {
    const out = [
      "State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process",
      'LISTEN 0      511          *:5173             *:*    users:(("node",pid=123,fd=23))',
      'LISTEN 0      4096   127.0.0.1:8080       0.0.0.0:*  users:(("python3",pid=999,fd=3))',
      'LISTEN 0      511     [::1]:9231              [::]:*  users:(("node",pid=123,fd=30),("node",pid=124,fd=30))',
      "",
    ].join("\n");
    expect(parseSsListenPorts(out)).toEqual([
      { port: 5173, pid: 123 },
      { port: 8080, pid: 999 },
      { port: 9231, pid: 123 },
      { port: 9231, pid: 124 },
    ]);
  });

  it("parseLsofListenPorts attributes -F name lines to the current pid paragraph", () => {
    const out = ["p123", "n*:5173", "n127.0.0.1:8080", "p456", "n[::1]:9090", ""].join("\n");
    expect(parseLsofListenPorts(out)).toEqual([
      { port: 5173, pid: 123 },
      { port: 8080, pid: 123 },
      { port: 9090, pid: 456 },
    ]);
  });

  it("parseWindowsProbe walks the process tree from the root pid", () => {
    const json = JSON.stringify({
      c: [
        { LocalPort: 5173, OwningProcess: 300 },
        { LocalPort: 9999, OwningProcess: 999 },
      ],
      p: [
        { ProcessId: 200, ParentProcessId: 100 },
        { ProcessId: 300, ParentProcessId: 200 },
        { ProcessId: 999, ParentProcessId: 1 },
      ],
    });
    expect(parseWindowsProbe(json, 100)).toEqual([5173]);
  });

  it("parseWindowsProbe handles ConvertTo-Json's single-object collapse and bad JSON", () => {
    const json = JSON.stringify({
      c: { LocalPort: 80, OwningProcess: 50 },
      p: { ProcessId: 50, ParentProcessId: 10 },
    });
    expect(parseWindowsProbe(json, 10)).toEqual([80]);
    expect(parseWindowsProbe("not json", 10)).toBeNull();
  });

  it("probeGroupListenPorts answers null on an unsupported platform", async () => {
    expect(await probeGroupListenPorts(1, "freebsd" as NodeJS.Platform)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Live wiring: output scan on the session, probe fallback, list field
// ---------------------------------------------------------------------------

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function toolConfig(): ToolConfig {
  return {
    customTools: [
      {
        name: "exec_command",
        description: "run",
        permission: "rw",
        maxOutputLength: 16000,
      },
    ],
    mcpServers: [],
  };
}

async function waitFor(pred: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("session service-url wiring", () => {
  it("scans the output stream (foreground and background alike) and surfaces serviceUrl on the list", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "penguin-url-"));
    const env = new Environment({ workspaceDir: dir, toolConfig: toolConfig() });
    cleanups.push(async () => {
      env.dispose();
      // Retries: the command launched below keeps this dir as its cwd, and on Windows a
      // just-killed process releases that lock asynchronously — an immediate recursive rm
      // hits EBUSY. fs.rm retries those with a linear backoff.
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    });
    // Launch via the tool path with run_in_background: the model never polls, yet the URL
    // must still be picked up — core sees the output stream directly.
    const gen = env.executeTool({
      toolCall: {
        timestamp: new Date().toISOString(),
        type: "model_msg",
        payload: {
          type: "tool_call",
          role: "assistant",
          name: "exec_command",
          arguments: JSON.stringify({
            cmd: "printf 'Local: http://0.0.0.0:5199/app\\n'; sleep 30",
            run_in_background: true,
          }),
          tool_call_id: "tc_url",
        },
      },
    });
    for await (const _ of gen) void _;
    await waitFor(() => env.listBackgroundCommands().some((p) => p.serviceUrl !== undefined));
    const info = env.listBackgroundCommands()[0]!;
    expect(info.running).toBe(true);
    expect(info.serviceUrl).toBe("http://localhost:5199/app");
  });

  it("linux: probes the process group's listening port when the output printed no URL", async () => {
    if (process.platform !== "linux") return; // live probe exercised on linux only; other platforms are covered by the parser fixtures
    // A real listener inside a detached session: `node -e` opens a server on a port the
    // test picked, prints nothing, and stays alive until killed.
    const server = await new Promise<Server>((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => resolve(s));
    });
    const probePort = (server.address() as { port: number }).port;
    await new Promise<void>((r) => server.close(() => r()));

    const manager = new CommandSessionManager();
    const session = manager.spawn({
      cmd: `node -e "require('net').createServer().listen(${probePort}, '127.0.0.1', () => {}); setInterval(() => {}, 1000)"`,
      cwd: tmpdir(),
    });
    cleanups.push(() => {
      session.kill();
      manager.dispose();
    });
    await waitFor(() => session.running && session.pid !== null);
    // The child needs a moment to bind; retry the raw probe until it sees the port (the
    // session-level refresh below then answers from a fresh TTL window).
    let ports: number[] | null = null;
    const deadline = Date.now() + 5000;
    for (;;) {
      ports = await probeGroupListenPorts(session.pid!);
      if (ports !== null && ports.includes(probePort)) break;
      if (Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(ports).not.toBeNull();
    expect(ports!).toContain(probePort);

    // And the session-level refresh composes the origin (no scanned URL to outrank it).
    await session.refreshServiceProbe();
    expect(session.serviceUrl).toBe(`http://localhost:${ports![0]}`);
  });
});
