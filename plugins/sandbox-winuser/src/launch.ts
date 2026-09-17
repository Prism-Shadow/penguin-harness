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
import { readState, sandboxBase, sandboxTemp } from "./state.js";

/** What the provider hands the launcher: the policy, and the command to run under it. */
export interface LaunchJob {
  /** The confinement the Workspace gets: `modify` for workspace-write and full-access, `read` for read-only. */
  access: "modify" | "read";
  /**
   * Full filesystem access: picks an account the setup granted MODIFY on the real home, so the
   * command may write `~`. `false` picks one granted only READ, so the home stays read-only.
   */
  full: boolean;
  workspaceRoot: string;
  /** "none" picks an account the firewall blocks; anything else picks an open one. */
  network?: "none";
  /** Redirect TEMP/TMP to the shared writable sandbox temp; off leaves the real (read-only) temp. */
  writableTemp?: boolean;
  maskPaths?: string[];
  /** The command line, already quoted the way `CommandLineToArgvW` will parse it. */
  commandLine: string;
  /** The program's own directory, opened read-only so the shell can load its files. */
  programDir?: string;
}

const STARTF_USESTDHANDLES = 0x0000_0100;
/**
 * The window the new logon session's console would otherwise show.
 *
 * `CreateProcessWithLogonW` hands the work to the secondary logon service, which creates the
 * process itself — and ignores CREATE_NO_WINDOW while doing it, so every confined command
 * flashed a console window on the desktop. What that service DOES honour is the startup info:
 * `STARTF_USESHOWWINDOW` with `SW_HIDE` is the ask it passes on.
 */
const STARTF_USESHOWWINDOW = 0x0000_0001;
const SW_HIDE = 0;
const CREATE_UNICODE_ENVIRONMENT = 0x0000_0400;
/**
 * No console for the confined command.
 *
 * The command runs in ANOTHER logon session, so Windows will not let it share this process's
 * console and gives it one of its own — a window that pops up (minimized, if the harness runs
 * without a desktop of its own) for every command an agent runs, and whose buffer is where the
 * output goes when the standard handles do not reach the child. Denying the console keeps the
 * window away; the handles below are what carry the output.
 */
const CREATE_NO_WINDOW = 0x0800_0000;
const HANDLE_FLAG_INHERIT = 0x0000_0001;
const INFINITE = 0xffff_ffff;
/**
 * How the sandbox account is logged in: WITHOUT loading its profile.
 *
 * `LOGON_WITH_PROFILE` makes Windows load (and on first use, CREATE) that account's user
 * profile for every command — a registry hive mounted and unmounted, a `C:\Users\<account>`
 * built, and the shell told about a logon. A person watching their desktop sees the harness's
 * own window drop to the taskbar while that happens, which is what a sandbox must never do to
 * someone's machine. Nothing here needs the profile: the launcher points HOME, USERPROFILE and
 * the temp variables at the sandbox's own directory (see sandboxEnvironment), which is where an
 * MSYS shell keeps its files.
 */
const LOGON_WITHOUT_PROFILE = 0x0000_0000;

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
 * The environment the confined command runs in: the harness's own, unchanged, EXCEPT the temp
 * directory. HOME, USERPROFILE and the AppData variables are left real — the setup granted the
 * sandbox accounts access to that profile, so `~` reads (and, under full access, writes) as
 * itself, the same shape the Linux and macOS sandboxes give. Only the temp is redirected, to a
 * folder every account may write, and only when the policy allows a writable temp.
 */
export function sandboxEnvironment(
  parent: NodeJS.ProcessEnv,
  tempDir: string | null,
  cutNetwork = false,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parent)) {
    if (value !== undefined) out[key] = value;
  }
  // A cut network that leaves a proxy behind is not cut: Windows' firewall does not filter
  // loopback, so a harness whose own environment names `http_proxy=http://127.0.0.1:…` would
  // hand every confined command a way out through it. Measured on a Windows host, where a
  // "blocked" command fetched the internet through exactly that. Direct connections ARE blocked
  // by the offline account's rules; these variables are what would route around them.
  if (cutNetwork) {
    for (const key of Object.keys(out)) {
      if (/^(https?|all|ftp)_proxy$/i.test(key)) delete out[key];
    }
  }
  // The provider's switch for THIS launcher's interpreter (see index.ts): it describes the
  // runner, and a confined command that inherited it would run the desktop app as Node.
  delete out.ELECTRON_RUN_AS_NODE;
  // A writable temp when the policy grants one; otherwise the real temp, which the account
  // cannot write — which is what "temp not writable" means. HOME is never touched.
  return tempDir === null ? out : { ...out, TEMP: tempDir, TMP: tempDir };
}

/**
 * Opens the paths the policy allows, and hides the ones it masks. Returns what failed. The
 * home is NOT among them: the setup granted it to the accounts once, standing, so no command
 * re-permissions the profile (which on a large one would take minutes). Only the Workspace,
 * the program directory and the masked paths are per-command.
 */
export function applyPolicy(job: LaunchJob, group: string): string[] {
  const failures: string[] = [];
  if (job.writableTemp !== false) fs.mkdirSync(sandboxTemp(), { recursive: true });
  const steps: Array<string | null> = [
    grant(job.workspaceRoot, group, job.access),
    ...(job.programDir !== undefined && job.programDir !== ""
      ? [grant(job.programDir, group, "read")]
      : []),
    ...(job.maskPaths ?? []).map((target) => deny(target, group)),
  ];
  for (const step of steps) if (step !== null) failures.push(step);
  return failures;
}

/**
 * One line per confined command, where the harness can read it afterwards.
 *
 * A launcher writes to the streams its caller gave it, and when those streams are the thing
 * under suspicion — a command that returns nothing at all — there is nowhere else for a
 * diagnosis to go. This file is that place: what the standard handles were, whether the command
 * started, and how it ended.
 */
function trace(line: string): void {
  try {
    const file = path.win32.join(sandboxBase(), "sandbox-launch.log");
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // A diagnosis that cannot be written is not worth failing a command over.
  }
}

/** A handle as the trace shows it: a value, and whether Windows considers it one. */
function describe(handle: unknown): string {
  const value = koffi.address(handle as never);
  return value === 0n || value === 0xffff_ffff_ffff_ffffn ? `INVALID(${value})` : `ok(${value})`;
}

/**
 * Where the confined command runs: this process's own directory, which the harness set to the
 * command's cwd, and the Workspace root when that is somehow gone (a deleted directory would
 * otherwise fail the spawn with a Win32 error rather than a reason).
 */
export function workingDirectory(
  job: LaunchJob,
  cwd: string = process.cwd(),
  exists: (p: string) => boolean = fs.existsSync,
): string {
  return exists(cwd) ? cwd : job.workspaceRoot;
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
  const failures = applyPolicy(job, state.group);
  if (failures.length > 0) {
    // Fail closed: a policy that could not be applied must never run the command anyway.
    process.stderr.write(`penguin-winuser: ${failures.join("; ")}\n`);
    return 126;
  }
  // The account is the filesystem axis (full = home writable) crossed with the network axis.
  const account = job.full
    ? job.network === "none"
      ? state.fullOffline
      : state.fullOnline
    : job.network === "none"
      ? state.offline
      : state.online;
  const api = win32();
  const handles = [-10, -11, -12].map((id) => api.getStdHandle(id));
  for (const handle of handles) api.setHandleInformation(handle, HANDLE_FLAG_INHERIT, 1);
  trace(
    `handles in=${describe(handles[0])} out=${describe(handles[1])} err=${describe(handles[2])}`,
  );
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
    dwFlags: STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW,
    wShowWindow: SW_HIDE,
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
    LOGON_WITHOUT_PROFILE,
    null,
    wide(job.commandLine),
    CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
    environmentBlock(
      sandboxEnvironment(
        process.env,
        job.writableTemp !== false ? sandboxTemp() : null,
        job.network === "none",
      ),
    ),
    // The directory the HARNESS put this launcher in, which is the command's own working
    // directory — a command may run in a subdirectory of the Workspace, and handing the child
    // the Workspace root instead would silently run it somewhere else.
    workingDirectory(job),
    startup,
    info,
  );
  trace(`started=${ok} user=${account.user} lastError=${ok ? 0 : api.getLastError()}`);
  if (!ok) {
    process.stderr.write(
      `penguin-winuser: could not start the command as ${account.user} (Win32 error ${api.getLastError()}); refusing to run it unconfined.\n`,
    );
    return 126;
  }
  const process_ = info.hProcess as unknown;
  api.waitForSingleObject(process_, INFINITE);
  // koffi fills an out pointer through an array cell, not a bare object — and if reading the
  // code ever fails, the command itself already ran: report success rather than turning a
  // finished command into a launcher crash.
  let code = 0;
  try {
    const out = [0];
    api.getExitCodeProcess(process_, out);
    code = Number(out[0] ?? 0);
  } catch (err) {
    process.stderr.write(
      `penguin-winuser: the command finished, but its exit code could not be read (${err instanceof Error ? err.message : String(err)}).\n`,
    );
  }
  api.closeHandle(info.hThread as unknown);
  api.closeHandle(process_);
  trace(`exit=${code}`);
  return code;
}

/** `node launch.js <base64 job>` — the shape the provider rewrites a command into. */
function main(): void {
  const encoded = process.argv[2];
  if (encoded === undefined) {
    process.stderr.write("penguin-winuser: the launcher takes one base64 job argument.\n");
    process.exit(2);
  }
  // The first line a command leaves: a run with none never reached this launcher at all.
  trace(`invoked cwd=${process.cwd()}`);
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
