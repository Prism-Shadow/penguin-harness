/**
 * The process plumbing this kind needs of its own: running wsl.exe once, and a TCP connection
 * into a distro.
 *
 * A distro has no SOCKS port to dial through, so a connection to its loopback is a BRIDGE: a
 * short-lived process over there — the Node the installed program carries — connects to
 * `127.0.0.1:<port>` inside the distro, writes one byte to say it did, and then pipes the
 * socket to its stdio. This side hands back a real `net.Socket`: a loopback pair of its own,
 * one end piped to the bridge's stdio. The bridge ends with the socket.
 *
 * Carried in this plugin rather than shared with plugins/machine-docker or sandbox-wsl: a
 * builtin plugin bundles what it runs (scripts/build-plugins.mjs), and two plugins are not to
 * depend on each other.
 */
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";

/** A command's answer, in the host's ExecResult shape. */
export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Enough for a payload over a slow link, short enough not to hang a menu forever. */
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** A program run once, its stdout as bytes, an optional stdin payload. Never throws. */
export function runProgram(
  program: string,
  args: string[],
  opts: { input?: Buffer; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: Buffer; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(program, args, {
        stdio: ["pipe", "pipe", "pipe"],
        ...(opts.env === undefined ? {} : { env: { ...process.env, ...opts.env } }),
      });
    } catch (err) {
      resolve({
        code: 1,
        stdout: Buffer.alloc(0),
        stderr: err instanceof Error ? err.message : String(err),
        timedOut: false,
      });
      return;
    }
    const out: Buffer[] = [];
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => (stderr += text));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: Buffer.concat(out), stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        code: 1,
        stdout: Buffer.concat(out),
        stderr: `${stderr}${err.message}\n`,
        timedOut,
      });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(opts.input ?? Buffer.alloc(0));
  });
}

/** The same, answered as text — what the host's oneShot and copyTo speak. */
export async function runText(
  program: string,
  args: string[],
  opts: { input?: Buffer; env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<RunResult> {
  const result = await runProgram(program, args, opts);
  return { ...result, stdout: result.stdout.toString("utf8") };
}

/**
 * The bridge, as `node -e` runs it over there: connect, say so with one byte, then pipe. Its
 * one argument is the port; a refusal is its own words on stderr and a non-zero exit.
 */
export const BRIDGE_SCRIPT =
  'const s=require("net").connect(Number(process.argv[1]),"127.0.0.1");' +
  's.on("connect",()=>{process.stdout.write("\\x01");s.pipe(process.stdout);process.stdin.pipe(s);});' +
  's.on("error",(e)=>{process.stderr.write(e.message+"\\n");process.exit(1);});' +
  's.on("close",()=>process.exit(0));';

/**
 * The shell command that runs the bridge with the machine's own Node. `node` is a shell word
 * that may name `$HOME` (mechanisms/machines.ts MachineDial.node), which is why it goes
 * through `sh -c`; the script and the port ride as positional arguments, never spliced in.
 */
export function bridgeArgs(node: string, port: number): string[] {
  return ["sh", "-c", `exec ${node} -e "$1" "$2"`, "sh", BRIDGE_SCRIPT, String(port)];
}

/** How long a bridge may take to say it connected. */
const BRIDGE_TIMEOUT_MS = 20_000;

/**
 * A TCP connection through a bridge process: `program args…` must run the bridge (bridgeArgs)
 * on the machine. Rejects with what the far side said when the bridge could not connect.
 */
export function dialViaBridge(
  program: string,
  args: string[],
  env?: Record<string, string>,
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      stdio: ["pipe", "pipe", "pipe"],
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    });
    let stderr = "";
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail("the bridge did not connect in time"), BRIDGE_TIMEOUT_MS);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text: string) => (stderr = (stderr + text).slice(-4096)));
    child.stdin.on("error", () => {});
    child.on("error", (err) => fail(`could not start ${program}: ${err.message}`));
    child.on("close", (code) =>
      fail(stderr.trim().split("\n").pop()?.trim() || `the bridge exited ${code ?? 1}`),
    );
    const onFirst = (chunk: Buffer) => {
      if (chunk[0] !== 1) return fail("the bridge answered something other than its greeting");
      child.stdout.removeListener("data", onFirst);
      child.stdout.pause();
      const rest = chunk.subarray(1);
      // A loopback pair of our own: the caller gets a genuine net.Socket, and the other end is
      // piped to the bridge.
      const server = net.createServer((inner) => {
        server.close();
        if (rest.length > 0) inner.write(rest);
        child.stdout.pipe(inner);
        inner.pipe(child.stdin);
        inner.on("close", () => child.kill());
        inner.on("error", () => child.kill());
        child.on("close", () => inner.destroy());
      });
      server.once("error", (err) => fail(err.message));
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (typeof address !== "object" || address === null) return fail("no loopback port");
        const outer = net.connect({ host: "127.0.0.1", port: address.port }, () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(outer);
        });
        outer.once("error", (err) => fail(err.message));
      });
    };
    child.stdout.on("data", onFirst);
  });
}
