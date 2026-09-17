/**
 * Asking Windows for the one permission this backend needs.
 *
 * Creating local accounts and firewall rules requires an administrator, and the harness does not
 * run as one — nor should it. What it CAN do is ask: `Start-Process -Verb RunAs` raises the
 * consent prompt on the interactive desktop, the same dialog any installer shows, and the person
 * at the machine answers it. That is the whole of the elevation here: one prompt, which they see
 * and accept, for a script whose source ships beside this file.
 *
 * The elevated process is not this one's child in any useful sense: `-Verb RunAs` goes through
 * ShellExecute, which cannot redirect a stream, so nothing it prints can be read from here. The
 * script therefore keeps its own transcript beside its state file, and this module reports from
 * that plus the state itself — the accounts existing being the real answer to "did it work". A
 * prompt the person dismisses leaves both untouched, and the card keeps saying what it said.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readState, stateFile } from "./state.js";

/** The script the prompt runs: shipped inside this package, beside its built module. */
export function setupScript(): string {
  return fileURLToPath(new URL("../setup/penguin-sandbox-setup.ps1", import.meta.url));
}

/** Where the elevated run leaves its transcript, since its console is another session's. */
export function setupLog(env: NodeJS.ProcessEnv = process.env): string {
  return path.win32.join(env.ProgramData ?? "C:\\ProgramData", "penguin", "sandbox-setup.log");
}

/** What `run` answers with: whether the accounts exist now, and what to tell the person. */
export interface SetupOutcome {
  ok: boolean;
  message: string;
  messageZh: string;
}

/** Test seam: how the prompt is raised, and how long the accounts are waited for. */
export interface SetupInternals {
  raise?: (script: string, log: string) => { failure: string };
  waitMs?: number;
  pollMs?: number;
  state?: () => boolean;
}

/**
 * Raises the consent prompt — and does NOT wait for it.
 *
 * `ShellExecute` with the RunAs verb blocks until the person answers the dialog, which may be
 * never: they can leave it open, or not notice it behind a window. Waiting on that process
 * would hold the page's request open for exactly as long, which is the difference between a
 * button that reports and a button that hangs. So this fires and lets go; whether it worked is
 * read from the machine afterwards, not from this process.
 */
export function elevationCommand(script: string, extra: readonly string[] = []): string {
  // Each argument quoted once, as its own element of a PowerShell array: quoting the script
  // AND wrapping the list produced `'…ps1''`, a parse error that raised no prompt at all and
  // looked exactly like a prompt nobody had answered. Hence the test beside this.
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...extra]
    .map((arg) => `'${arg.replace(/'/g, "''")}'`)
    .join(",");
  // No redirection here on purpose: -Verb RunAs goes through ShellExecute, which cannot
  // redirect at all — the script keeps its own transcript instead.
  return (
    `$ErrorActionPreference='Stop'; ` +
    `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden ` +
    `-ArgumentList @(${args})`
  );
}

/**
 * Windows PowerShell, by its full path.
 *
 * A bare `powershell.exe` is a PATH lookup, and a server started from something with a trimmed
 * PATH has no System32 in it: the spawn then fails with ENOENT, the failure has nowhere to go,
 * and the button reports a prompt that was never raised. The interpreter is always at this path
 * on a Windows install, so it is named rather than searched for.
 */
export function powershellPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.win32.join(
    env.SystemRoot ?? "C:\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

/** What the request left behind, read after the wait: the reason it never became a prompt. */
interface RaisedPrompt {
  failure: string;
}

/**
 * Who the setup grants the profile to, and which profile. Elevation runs the script as an
 * administrator, which may not be the account the harness runs as — so the harness names its
 * OWN user and home here, rather than letting the script default to the elevated identity's.
 */
export function setupArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const args: string[] = [];
  const domain = env.USERDOMAIN;
  const user = env.USERNAME;
  if (user) args.push("-ServerUser", domain ? `${domain}\\${user}` : user);
  if (env.USERPROFILE) args.push("-UserProfile", env.USERPROFILE);
  return args;
}

function raisePrompt(script: string): RaisedPrompt {
  const raised: RaisedPrompt = { failure: "" };
  const command = elevationCommand(script, setupArgs());
  // NOT detached: a detached child on Windows has no console and no usable window station, and
  // ShellExecute's RunAs verb then does nothing at all — the outer PowerShell exits 0, no prompt
  // is raised, no elevated process starts, and nothing anywhere says why. Measured on a Windows
  // 11 host: the same spawn without this flag elevates and runs. `unref` below is what keeps the
  // server free of it, which is all that was wanted from detaching.
  const child = spawn(powershellPath(), ["-NoProfile", "-Command", command], {
    stdio: "ignore",
    windowsHide: true,
  });
  // Nothing waits on the prompt, and the server must not be kept alive by a dialog — but a
  // request that could not even be MADE has to end up somewhere the failure path can read, and
  // it cannot be a file: the transcript directory belongs to the elevated runs that wrote it.
  child.on("error", (err) => {
    raised.failure = `the elevation request could not be started: ${err.message}`;
  });
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      raised.failure = `the elevation request exited ${code}, so no prompt was shown`;
    }
  });
  child.unref();
  return raised;
}

/** The last few lines the elevated run wrote, for a failure that needs a reason. */
function tail(log: string, lines = 4): string {
  try {
    return fs
      .readFileSync(log, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "")
      .slice(-lines)
      .join(" / ");
  } catch {
    return "";
  }
}

/**
 * Runs the setup behind a consent prompt, and reports what the machine says afterwards — the
 * accounts existing, not the prompt's exit code, is what counts as success.
 */
export async function runSetup(internals: SetupInternals = {}): Promise<SetupOutcome> {
  const script = setupScript();
  if (!fs.existsSync(script)) {
    return {
      ok: false,
      message: `the setup script is missing from this installation (${script}).`,
      messageZh: `本次安装缺少安装脚本（${script}）。`,
    };
  }
  const log = setupLog();
  // A transcript from an earlier attempt would be read as THIS run's outcome, which turns a
  // prompt nobody answered into "it ran and failed", with last week's reason attached.
  try {
    fs.rmSync(log, { force: true });
  } catch {
    // Left behind at worst; the reason below says which run it belongs to by naming the script.
  }
  const raised = (internals.raise ?? ((s: string) => raisePrompt(s)))(script, log);
  const present = internals.state ?? (() => readState() !== null);
  // Long enough for a prompt answered right away to finish, short enough that a page waiting on
  // this never feels stuck. An unanswered prompt is reported as what it is, not waited out.
  // The first run also grants the accounts access to the profile — an icacls tree walk that
  // is slow on a large one — so the wait is generous before it falls back to "reopen later".
  const waitMs = internals.waitMs ?? 60_000;
  const pollMs = internals.pollMs ?? 500;
  for (let waited = 0; waited <= waitMs; waited += pollMs) {
    if (present()) {
      return {
        ok: true,
        message:
          "The sandbox accounts are ready: agent commands now run as one of them. Pick a mode above — no restart needed.",
        messageZh:
          "沙盒账户已就绪：Agent 的命令现在以其中一个账户执行。在上方选择模式即可，无需重启。",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  // What stopped it being a prompt at all outranks anything a previous run left in the log.
  if (raised.failure !== "") {
    return {
      ok: false,
      message: `${raised.failure}. Run ${script} from an elevated PowerShell instead.`,
      messageZh: `${raised.failure}。请改为在管理员 PowerShell 中执行 ${script}。`,
    };
  }
  const reason = tail(log);
  // A transcript means the elevated run started, so the prompt was answered and something else
  // went wrong; no transcript means nobody has answered it yet, or it was refused.
  if (reason !== "") {
    return {
      ok: false,
      message: `${script} ran but left no accounts behind. It said: ${reason}`,
      messageZh: `${script} 执行了，但没有留下账户。它的输出是：${reason}`,
    };
  }
  return {
    ok: false,
    message:
      "Windows is asking for permission on the machine's own screen — accept the prompt, then reopen these settings. " +
      "The first setup grants the sandbox accounts access to your profile, which can take a minute on a large one. " +
      `If no prompt appeared (a server that is not on that desktop cannot raise one), run ${script} from an elevated PowerShell instead.`,
    messageZh:
      "Windows 正在这台机器的屏幕上请求授权——确认那个弹窗，然后重新打开本页设置。" +
      "首次安装还会把用户目录的访问权授予沙盒账户，目录较大时可能需要一分钟。" +
      `如果没有看到弹窗（不在该桌面会话中的服务端无法弹出它），请改为在管理员 PowerShell 中执行 ${script}。`,
  };
}

/** Where the state file is expected, for a notice that needs to name it. */
export { stateFile };
