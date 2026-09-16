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
  raise?: (script: string, log: string) => Promise<number | null>;
  waitMs?: number;
  pollMs?: number;
  state?: () => boolean;
}

/**
 * Raises the consent prompt and waits for the accounts to appear.
 *
 * PowerShell is asked to start PowerShell elevated: the outer process exits as soon as the
 * prompt is answered, so its exit code says whether the person consented, never whether the
 * setup worked. That is what the polling below is for.
 */
function raisePrompt(script: string, log: string): Promise<number | null> {
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
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", () => resolve(null));
    child.on("exit", (code) => resolve(code));
  });
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
  const code = await (internals.raise ?? raisePrompt)(script, log);
  const present = internals.state ?? (() => readState() !== null);
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
  const reason = tail(log);
  const because = reason === "" ? "" : ` It said: ${reason}`;
  const becauseZh = reason === "" ? "" : `它的输出是：${reason}`;
  return {
    ok: false,
    message:
      code === null || code !== 0
        ? `The Windows permission prompt was declined or could not be shown, so nothing was created. Run ${script} from an elevated PowerShell instead.${because}`
        : `The setup ran but left no accounts behind. Run ${script} from an elevated PowerShell to see why.${because}`,
    messageZh:
      code === null || code !== 0
        ? `Windows 的权限确认被拒绝或无法弹出，因此什么都没有创建。请改为在管理员 PowerShell 中执行 ${script}。${becauseZh}`
        : `安装脚本执行了，但没有留下账户。请在管理员 PowerShell 中执行 ${script} 查看原因。${becauseZh}`,
  };
}

/** Where the state file is expected, for a notice that needs to name it. */
export { stateFile };
