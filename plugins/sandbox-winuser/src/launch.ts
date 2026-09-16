/**
 * The launcher: one confined command, run as a sandbox account.
 *
 * A process cannot change who it is, so confinement here needs a second process — this one.
 * The harness rewrites a command's argv into `node launch.js <job>`, and this program logs the
 * real command in as the sandbox account the policy asks for, hands it the caller's stdin,
 * stdout and stderr, waits, and exits with the command's own code. To the rest of the harness
 * it is the command: same streams, same exit code, same lifetime.
 *
 * The password never travels in that argv — every process on the machine can read another's
 * command line. The job names a POLICY; the launcher reads the credentials itself from the
 * state file, whose permissions are the secret's protection (see state.ts).
 *
 * `CreateProcessWithLogonW` is what .NET's own `Process` uses for `UserName`/`Password`, and
 * like .NET this passes the standard handles through STARTUPINFO after marking them
 * inheritable — the one requirement for redirection to reach another logon session.
 */
import fs from "node:fs";
import path from "node:path";
import koffi from "koffi";
import { deny, grant } from "./grants.js";
import { readState, sandboxHome } from "./state.js";

/** What the provider hands the launcher: the policy, and the command to run under it. */
export interface LaunchJob {
  /** The confinement the Workspace gets: `modify` for workspace-write, `read` for read-only. */
  access: "modify" | "read";
  workspaceRoot: string;
  /** "none" picks the account the firewall blocks; anything else picks the open one. */
  network?: "none";
  maskPaths?: string[];
  /** The command line, already quoted the way `CommandLineToArgvW` will parse it. */
  commandLine: string;
  /** The program's own directory, opened read-only so the shell can load its files. */
  programDir?: string;
}

const STARTF_USESTDHANDLES = 0x0000_0100;
const CREATE_UNICODE_ENVIRONMENT = 0x0000_0400;
const HANDLE_FLAG_INHERIT = 0x0000_0001;
const INFINITE = 0xffff_ffff;
/** The command inherits the caller's streams; it must NOT get a console of its own. */
const LOGON_WITH_PROFILE = 0x0000_0001;

const STARTUPINFOW = koffi.struct("STARTUPINFOW", {
  cb: "uint32",
  lpReserved: "void *",
  lpDesktop: "void *",
  lpTitle: "void *",
  dwX: "uint32",
  dwY: "uint32",
  dwXSize: "uint32",
  dwYSize: "uint32",
  dwXCountChars: "uint32",
  dwYCountChars: "uint32",
  dwFillAttribute: "uint32",
  dwFlags: "uint32",
  wShowWindow: "uint16",
  cbReserved2: "uint16",
  lpReserved2: "void *",
  hStdInput: "void *",
  hStdOutput: "void *",
  hStdError: "void *",
});

const PROCESS_INFORMATION = koffi.struct("PROCESS_INFORMATION", {
  hProcess: "void *",
  hThread: "void *",
  dwProcessId: "uint32",
  dwThreadId: "uint32",
});

/** The Win32 entry points this launcher needs, bound once. */
function win32() {
  const advapi32 = koffi.load("advapi32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  return {
    createProcessWithLogon: advapi32.func("__stdcall", "CreateProcessWithLogonW", "bool", [
      "str16",
      "str16",
      "str16",
      "uint32",
      "str16",
      "uint16 *",
      "uint32",
      "void *",
      "str16",
      koffi.pointer(STARTUPINFOW),
      koffi.out(koffi.pointer(PROCESS_INFORMATION)),
    ]),
    getStdHandle: kernel32.func("__stdcall", "GetStdHandle", "void *", ["int32"]),
    setHandleInformation: kernel32.func("__stdcall", "SetHandleInformation", "bool", [
      "void *",
      "uint32",
      "uint32",
    ]),
    waitForSingleObject: kernel32.func("__stdcall", "WaitForSingleObject", "uint32", [
      "void *",
      "uint32",
    ]),
    getExitCodeProcess: kernel32.func("__stdcall", "GetExitCodeProcess", "bool", [
      "void *",
      koffi.out(koffi.pointer("uint32")),
    ]),
    closeHandle: kernel32.func("__stdcall", "CloseHandle", "bool", ["void *"]),
    getLastError: kernel32.func("__stdcall", "GetLastError", "uint32", []),
  };
}

/** A NUL-terminated UTF-16 buffer: what a Win32 `LPWSTR` the callee may rewrite needs. */
function wide(value: string): Uint16Array {
  const buffer = new Uint16Array(value.length + 1);
  for (let i = 0; i < value.length; i++) buffer[i] = value.charCodeAt(i);
  buffer[value.length] = 0;
  return buffer;
}

/** A process environment block: `K=V\0K=V\0\0`, UTF-16, which CREATE_UNICODE_ENVIRONMENT expects. */
function environmentBlock(env: Record<string, string>): Buffer {
  const entries = Object.entries(env)
    .filter(([key, value]) => key !== "" && value !== undefined)
    .map(([key, value]) => `${key}=${value}\0`)
    .sort();
  return Buffer.from(`${entries.join("")}\0`, "utf16le");
}

/**
 * The environment the confined command runs in: the harness's own, minus the places that
 * belong to the account the harness runs as. A sandbox account has no profile directory, so
 * HOME and the temp variables point into the sandbox's own home — which the group may write,
 * and which is where an MSYS shell puts its files.
 */
export function sandboxEnvironment(
  parent: NodeJS.ProcessEnv,
  home: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined) out[key] = value;
  }
  const temp = path.win32.join(home, "temp");
  return {
    ...out,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.win32.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.win32.join(home, "AppData", "Local"),
    TEMP: temp,
    TMP: temp,
  };
}

/** Opens the paths the policy allows, and hides the ones it masks. Returns what failed. */
export function applyPolicy(job: LaunchJob, group: string, home: string): string[] {
  const failures: string[] = [];
  for (const dir of [home, path.win32.join(home, "temp")]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const steps: Array<string | null> = [
    grant(home, group, "modify"),
    grant(job.workspaceRoot, group, job.access),
    ...(job.programDir !== undefined && job.programDir !== ""
      ? [grant(job.programDir, group, "read")]
      : []),
    ...(job.maskPaths ?? []).map((target) => deny(target, group)),
  ];
  for (const step of steps) if (step !== null) failures.push(step);
  return failures;
}

/** Runs the job, returning the command's exit code. */
function launch(job: LaunchJob): number {
  const state = readState();
  if (state === null) {
    process.stderr.write(
      "penguin-winuser: this host has no sandbox accounts; run the setup script (see the plugin's README).\n",
    );
    return 126;
  }
  const home = sandboxHome();
  const failures = applyPolicy(job, state.group, home);
  if (failures.length > 0) {
    // Fail closed: a policy that could not be applied must never run the command anyway.
    process.stderr.write(`penguin-winuser: ${failures.join("; ")}\n`);
    return 126;
  }
  const account = job.network === "none" ? state.offline : state.online;
  const api = win32();
  const handles = [-10, -11, -12].map((id) => api.getStdHandle(id));
  for (const handle of handles) api.setHandleInformation(handle, HANDLE_FLAG_INHERIT, 1);
  const startup = {
    cb: 0,
    lpReserved: null,
    lpDesktop: null,
    lpTitle: null,
    dwX: 0,
    dwY: 0,
    dwXSize: 0,
    dwYSize: 0,
    dwXCountChars: 0,
    dwYCountChars: 0,
    dwFillAttribute: 0,
    dwFlags: STARTF_USESTDHANDLES,
    wShowWindow: 0,
    cbReserved2: 0,
    lpReserved2: null,
    hStdInput: handles[0],
    hStdOutput: handles[1],
    hStdError: handles[2],
  };
  const info: Record<string, unknown> = {};
  const ok = api.createProcessWithLogon(
    account.user,
    ".",
    account.password,
    LOGON_WITH_PROFILE,
    null,
    wide(job.commandLine),
    CREATE_UNICODE_ENVIRONMENT,
    environmentBlock(sandboxEnvironment(process.env, home)),
    job.workspaceRoot,
    startup,
    info,
  );
  if (!ok) {
    process.stderr.write(
      `penguin-winuser: could not start the command as ${account.user} (Win32 error ${api.getLastError()}); refusing to run it unconfined.\n`,
    );
    return 126;
  }
  const process_ = info.hProcess as unknown;
  api.waitForSingleObject(process_, INFINITE);
  const code: Record<string, number> = {};
  api.getExitCodeProcess(process_, code);
  api.closeHandle(info.hThread as unknown);
  api.closeHandle(process_);
  return Number(Object.values(code)[0] ?? 0);
}

/** `node launch.js <base64 job>` — the shape the provider rewrites a command into. */
function main(): void {
  const encoded = process.argv[2];
  if (encoded === undefined) {
    process.stderr.write("penguin-winuser: the launcher takes one base64 job argument.\n");
    process.exit(2);
  }
  let job: LaunchJob;
  try {
    job = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as LaunchJob;
  } catch (err) {
    process.stderr.write(
      `penguin-winuser: unreadable job (${err instanceof Error ? err.message : String(err)}).\n`,
    );
    process.exit(2);
  }
  process.exit(launch(job));
}

// Imported by the tests for its pure halves; run as a program only when it IS the program.
if (process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main();
}
