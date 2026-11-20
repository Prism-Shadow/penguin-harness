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
import { execFile } from "node:child_process";
import path from "node:path";
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
) => Promise<string>;

const run: ExecFile = (file, args, env) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { env, timeout: 4_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(String(stdout))),
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

/** GetLastInputInfo's age, in milliseconds, on stdout. */
const WIN_PS = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class PenguinIdle {
  [StructLayout(LayoutKind.Sequential)] public struct LastInput { public uint Size; public uint Time; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LastInput info);
  public static long Ms() {
    var info = new LastInput(); info.Size = (uint)Marshal.SizeOf(info);
    if (!GetLastInputInfo(ref info)) return -1;
    return (long)unchecked((uint)Environment.TickCount - info.Time);
  }
}
'@
[PenguinIdle]::Ms()`;

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
}

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
      const root = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
      const ps = path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      const out = await exec(
        ps,
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WIN_PS],
        pass([
          "SystemRoot",
          "SYSTEMROOT",
          "windir",
          "TEMP",
          "TMP",
          "USERPROFILE",
          "LOCALAPPDATA",
          "APPDATA",
          "PATH",
        ]),
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
                : `the X11 idle time could not be read (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`,
        );
      }
      const ms = Number(out.trim());
      if (!Number.isFinite(ms)) return unknown("the X11 idle time could not be read");
      return { seconds: ms / 1000, source: "XScreenSaver" };
    }
    return unknown(`${opts.platform} has no idle-time reader here`);
  } catch (err) {
    return unknown(
      `the idle time could not be read (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`,
    );
  }
}
