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
  raise?: (script: string, log: string) => void;
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
function raisePrompt(script: string, log: string): void {
  const inner = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    `'${script.replace(/'/g, "''")}'`,
  ].join("','");
  // No redirection here on purpose: -Verb RunAs goes through ShellExecute, which cannot
  // redirect at all — the script keeps its own transcript at `log` instead.
  const command =
    `$ErrorActionPreference='Stop'; ` +
    `Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -WindowStyle Hidden ` +
    `-ArgumentList '${inner}'`;
  const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
    stdio: "ignore",
    windowsHide: true,
    detached: true,
  });
  // Nothing here waits on it, and the server must not be kept alive by a dialog either — but a
  // prompt that could not even be ASKED for must not vanish silently, so the reason is written
  // where the failure path reads from.
  child.on("error", (err) => note(log, `could not start powershell: ${err.message}`));
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      note(log, `the elevation request exited ${code} (the prompt was refused, or not shown)`);
    }
  });
  child.unref();
}

/** Leaves a line where the failure path looks, for something that happened after we let go. */
function note(log: string, line: string): void {
  try {
    fs.mkdirSync(path.win32.dirname(log), { recursive: true });
    fs.appendFileSync(log, `${new Date().toISOString()} penguin-winuser: ${line}\n`);
  } catch {
    // Nothing to do: this is the path that reports failures, and it just failed.
  }
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
  (internals.raise ?? raisePrompt)(script, log);
  const present = internals.state ?? (() => readState() !== null);
  // Long enough for a prompt answered right away to finish, short enough that a page waiting on
  // this never feels stuck. An unanswered prompt is reported as what it is, not waited out.
  const waitMs = internals.waitMs ?? 20_000;
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
  const reason = tail(log);
  // A transcript means the elevated run started, so the prompt was answered and something else
  // went wrong; no transcript means nobody has answered it yet, or it was refused.
  if (reason !== "") {
    return {
      ok: false,
      message: `The setup ran but left no accounts behind. It said: ${reason}`,
      messageZh: `安装脚本执行了，但没有留下账户。它的输出是：${reason}`,
    };
  }
  return {
    ok: false,
    message:
      "Windows is asking for permission on the machine's own screen — accept the prompt, then reopen these settings. " +
      `If no prompt appeared (a server that is not on that desktop cannot raise one), run ${script} from an elevated PowerShell instead.`,
    messageZh:
      "Windows 正在这台机器的屏幕上请求授权——确认那个弹窗，然后重新打开本页设置。" +
      `如果没有看到弹窗（不在该桌面会话中的服务端无法弹出它），请改为在管理员 PowerShell 中执行 ${script}。`,
  };
}

/** Where the state file is expected, for a notice that needs to name it. */
export { stateFile };
