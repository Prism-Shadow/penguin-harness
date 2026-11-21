/**
 * How long ago the person at this computer last touched the keyboard or the mouse — the input
 * idle time of the desktop session the server runs in. Best effort per system, and "unknown" is
 * an answer, never a guess:
 *
 *   macOS    `ioreg -c IOHIDSystem`, its HIDIdleTime (nanoseconds)
 *   Windows  GetLastInputInfo through Windows PowerShell (`Add-Type`: no native module here)
 *   Linux    X11: the MIT-SCREEN-SAVER extension, through `xprintidle` when installed, else a few
 *            lines of Python against libXss over ctypes; Wayland has no such query: unknown
 *
 * Every program is run by absolute path, only from a directory the server's user can neither
 * write nor owns (launch-name.ts systemOnly) — a reader the Agent could plant would run outside
 * the sandbox — with the desktop session's variables and nothing else.
 *
 * Input the plugin itself sent (a `press`, physical input) also counts as input to the system; the
 * caller tells it apart (cli.ts).
 */
import { execFile, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { passedNames } from "./env.js";
import { systemOnly } from "./launch-name.js";

export interface IdleReading {
  /** Seconds since the last keyboard or mouse input; null when it cannot be told here. */
  seconds: number | null;
  /** What it was read with. */
  source: "HIDIdleTime" | "GetLastInputInfo" | "XScreenSaver" | null;
  /** Why it is unknown (English), when it is. */
  reason?: string;
}

/** Runs a program and hands back its stdout, or throws. */
export type ExecFile = (
  file: string,
  args: readonly string[],
  env: Record<string, string>,
  timeoutMs?: number,
) => Promise<string>;

const run: ExecFile = (file, args, env, timeoutMs = 4_000) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { env, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) =>
        err
          ? reject(Object.assign(err, { stderr: String(stderr), stdout: String(stdout) }))
          : resolve(String(stdout)),
    );
  });

/** The query on X11: XScreenSaverQueryInfo's `idle`, in milliseconds, on stdout. */
const XSS_PY = `import ctypes, sys
try:
    x11 = ctypes.CDLL("libX11.so.6"); xss = ctypes.CDLL("libXss.so.1")
except OSError:
    sys.exit(5)
class Info(ctypes.Structure):
    _fields_ = [("window", ctypes.c_ulong), ("state", ctypes.c_int), ("kind", ctypes.c_int),
                ("til_or_since", ctypes.c_ulong), ("idle", ctypes.c_ulong), ("event_mask", ctypes.c_ulong)]
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
xss.XScreenSaverQueryExtension.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_int)]
xss.XScreenSaverAllocInfo.restype = ctypes.POINTER(Info)
xss.XScreenSaverQueryInfo.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(Info)]
d = x11.XOpenDisplay(None)
if not d:
    sys.exit(3)
a, b = ctypes.c_int(), ctypes.c_int()
if not xss.XScreenSaverQueryExtension(d, ctypes.byref(a), ctypes.byref(b)):
    sys.exit(4)
info = xss.XScreenSaverAllocInfo()
xss.XScreenSaverQueryInfo(d, x11.XDefaultRootWindow(d), info)
print(info.contents.idle)
`;

/** The C# behind GetLastInputInfo's age, compiled once per PowerShell by Add-Type. */
const WIN_TYPE = `using System; using System.Runtime.InteropServices;
public static class PenguinIdle {
  [StructLayout(LayoutKind.Sequential)] public struct LastInput { public uint Size; public uint Time; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInput info);
  public static long Ms() {
    var info = new LastInput(); info.Size = (uint)Marshal.SizeOf(info);
    if (!GetLastInputInfo(ref info)) return -1;
    return (long)unchecked((uint)Environment.TickCount - info.Time);
  }
}`;

/** One run of PowerShell: compile, then print GetLastInputInfo's age in milliseconds. */
const WIN_PS = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${WIN_TYPE}
'@
[PenguinIdle]::Ms()`;

/** The PowerShell every Windows reading goes through. */
function powershellOf(env: Readonly<Record<string, string | undefined>>): string {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
  return path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/**
 * Windows: one PowerShell kept running for this service, which compiled the reader once and
 * answers each `[PenguinIdle]::Ms()` with a line — a PowerShell start and an Add-Type compile per
 * input command would cost seconds. Lines answer requests in order; a request that timed out
 * still owns the line that answers it, so the order never slips.
 */
export class WindowsIdle {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private waiting: Array<(line: string | Error) => void> = [];
  private buffer = "";
  private warm = false;

  constructor(private readonly env: Record<string, string>) {}

  private start(): ChildProcessWithoutNullStreams {
    const proc = spawn(
      powershellOf(this.env),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-"],
      { env: this.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      this.buffer += chunk;
      for (let at = this.buffer.indexOf("\n"); at >= 0; at = this.buffer.indexOf("\n")) {
        const line = this.buffer.slice(0, at).trim();
        this.buffer = this.buffer.slice(at + 1);
        // A number on its own line (behind a prompt, should the host print one) answers.
        const answer = /^(?:PS [^>]*> *)?(-?\d+)$/.exec(line)?.[1];
        if (answer !== undefined) this.waiting.shift()?.(answer);
      }
    });
    proc.stderr.resume();
    const gone = () => {
      if (this.proc === proc) this.proc = null;
      this.warm = false;
      for (const answer of this.waiting.splice(0)) answer(new Error("PowerShell exited"));
    };
    proc.on("exit", gone);
    proc.on("error", gone);
    proc.unref();
    const type = Buffer.from(WIN_TYPE, "utf16le").toString("base64");
    proc.stdin.write(
      `Add-Type -TypeDefinition ([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${type}')))\n`,
    );
    this.proc = proc;
    return proc;
  }

  /** GetLastInputInfo's age in milliseconds; the first answer waits for the compile. */
  read(): Promise<number> {
    const proc = this.proc ?? this.start();
    const timeoutMs = this.warm ? 3_000 : 20_000;
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        done = true;
        reject(new Error(`PowerShell did not answer within ${timeoutMs / 1000} s`));
      }, timeoutMs);
      this.waiting.push((line) => {
        clearTimeout(timer);
        if (done) return;
        if (line instanceof Error) return reject(line);
        this.warm = true;
        resolve(Number(line));
      });
      proc.stdin.write("[PenguinIdle]::Ms()\n");
    });
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }
}

const unknown = (reason: string): IdleReading => ({ seconds: null, source: null, reason });

/** The first of `candidates` that exists and the server's user can neither write nor owns. */
async function trustedProgram(
  candidates: readonly string[],
  trusted: (file: string) => Promise<boolean>,
): Promise<string | null> {
  for (const file of candidates) {
    if (await trusted(file)) return file;
  }
  return null;
}

export interface IdleOptions {
  platform: NodeJS.Platform;
  /** The desktop session's variables (DISPLAY, WAYLAND_DISPLAY, XAUTHORITY, SystemRoot …). */
  env: Readonly<Record<string, string | undefined>>;
  exec?: ExecFile;
  trusted?: (file: string) => Promise<boolean>;
  /** Windows: the service's long-running PowerShell (WindowsIdle); absent, one run per reading. */
  windows?: { read(): Promise<number> };
}

/**
 * The variables a Windows reader is given: the system's own, non-secret ones agent-desktop gets
 * too (env.ts) — PowerShell and Add-Type need the profile, program and module paths.
 */
export const WINDOWS_READER_ENV: readonly string[] = passedNames("win32");

/** The input idle time of this desktop session, or why it is unknown. */
export async function readIdle(opts: IdleOptions): Promise<IdleReading> {
  const exec = opts.exec ?? run;
  const trusted = opts.trusted ?? systemOnly;
  const env = opts.env;
  const pass = (names: readonly string[]): Record<string, string> =>
    Object.fromEntries(
      names.flatMap((n) => (env[n] !== undefined && env[n] !== "" ? [[n, env[n]!]] : [])),
    );
  try {
    if (opts.platform === "darwin") {
      const ioreg = await trustedProgram(["/usr/sbin/ioreg"], trusted);
      if (ioreg === null) return unknown("ioreg is not where macOS keeps it");
      const out = await exec(ioreg, ["-c", "IOHIDSystem"], pass(["HOME"]));
      const ns = /"HIDIdleTime"\s*=\s*(\d+)/.exec(out)?.[1];
      if (ns === undefined) return unknown("ioreg reported no HIDIdleTime");
      return { seconds: Number(ns) / 1e9, source: "HIDIdleTime" };
    }
    if (opts.platform === "win32") {
      if (opts.windows !== undefined) {
        try {
          const ms = await opts.windows.read();
          if (Number.isFinite(ms) && ms >= 0) {
            return { seconds: ms / 1000, source: "GetLastInputInfo" };
          }
        } catch {
          // The long-running PowerShell failed: one run of its own below.
        }
      }
      const out = await exec(
        powershellOf(env),
        // Encoded: a script with quotes and a here-string survives no command-line quoting.
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-EncodedCommand",
          Buffer.from(WIN_PS, "utf16le").toString("base64"),
        ],
        pass(WINDOWS_READER_ENV),
        20_000,
      );
      const ms = Number(out.trim().split(/\s+/).at(-1));
      if (!Number.isFinite(ms) || ms < 0) return unknown("GetLastInputInfo did not answer");
      return { seconds: ms / 1000, source: "GetLastInputInfo" };
    }
    if (opts.platform === "linux") {
      if (!env.DISPLAY) {
        return unknown(
          env.WAYLAND_DISPLAY
            ? "Wayland offers no way to read the input idle time"
            : "the server has no display",
        );
      }
      const x = pass(["DISPLAY", "XAUTHORITY", "HOME"]);
      const xprintidle = await trustedProgram(
        ["/usr/bin/xprintidle", "/usr/local/bin/xprintidle"],
        trusted,
      );
      if (xprintidle !== null) {
        const ms = Number((await exec(xprintidle, [], x)).trim());
        if (Number.isFinite(ms)) return { seconds: ms / 1000, source: "XScreenSaver" };
      }
      const python = await trustedProgram(["/usr/bin/python3"], trusted);
      if (python === null) {
        return unknown("neither xprintidle nor python3 is installed to read X11's idle time");
      }
      let out: string;
      try {
        out = await exec(python, ["-I", "-S", "-c", XSS_PY], x);
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        return unknown(
          code === 5
            ? "libXss (the X11 screen saver library) is not installed"
            : code === 4
              ? "the X server has no MIT-SCREEN-SAVER extension"
              : code === 3
                ? `the display ${env.DISPLAY} could not be opened`
                : `the X11 idle time could not be read (${firstLine(err)})`,
        );
      }
      const ms = Number(out.trim());
      if (!Number.isFinite(ms)) return unknown("the X11 idle time could not be read");
      return { seconds: ms / 1000, source: "XScreenSaver" };
    }
    return unknown(`${opts.platform} has no idle-time reader here`);
  } catch (err) {
    return unknown(`the idle time could not be read (${firstLine(err)})`);
  }
}

/** What a failed reader said: its stderr's first line, else its stdout's, else its error's. */
function firstLine(err: unknown): string {
  const code = (err as { code?: unknown; killed?: unknown }).killed === true ? "timed out" : null;
  if (code !== null) return code;
  const stderr = (err as { stderr?: unknown }).stderr;
  const stdout = (err as { stdout?: unknown }).stdout;
  if (
    typeof stdout === "string" &&
    stdout.trim() !== "" &&
    (typeof stderr !== "string" || stderr.trim() === "")
  ) {
    return stdout.trim().split(/\r?\n/)[0]!;
  }
  if (typeof stderr === "string" && stderr.trim() !== "") return stderr.trim().split(/\r?\n/)[0]!;
  return err instanceof Error ? err.message.split("\n")[0]! : String(err);
}
