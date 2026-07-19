/**
 * Language persistence: write `PENGUIN_LANG` into the user's shell startup file, then restart
 * the shell so it takes effect.
 *
 * A child process can't modify its parent shell's environment variables directly, so
 * `penguin config lang` uses a "write the startup file + restart the shell" approach: write
 * `export PENGUIN_LANG=<lang>` into the shell startup file inside a marked block (idempotent,
 * updates in place), then open an interactive shell carrying the new language env var. New
 * terminals will read the variable from the startup file, so it persists.
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Language } from "./i18n.js";

const BEGIN = "# >>> PenguinHarness PENGUIN_LANG >>>";
const END = "# <<< PenguinHarness PENGUIN_LANG <<<";

export type ShellKind = "zsh" | "bash" | "fish" | "unknown";

export interface ShellRc {
  kind: ShellKind;
  /** Absolute path to the startup file. */
  rcPath: string;
  /** Generate the export line for a given language (shell-syntax specific). */
  body(lang: Language): string;
}

/** Resolve the startup file and export syntax from `$SHELL`. Falls back to `~/.profile` for an unknown shell. */
export function resolveShellRc(shell: string | undefined, home: string): ShellRc {
  const base = (shell ?? "").split("/").pop()?.toLowerCase() ?? "";
  if (base.includes("fish")) {
    return {
      kind: "fish",
      rcPath: join(home, ".config", "fish", "config.fish"),
      body: (lang) => `set -gx PENGUIN_LANG ${lang}`,
    };
  }
  if (base.includes("zsh")) {
    return {
      kind: "zsh",
      rcPath: join(home, ".zshrc"),
      body: (lang) => `export PENGUIN_LANG=${lang}`,
    };
  }
  if (base.includes("bash")) {
    return {
      kind: "bash",
      rcPath: join(home, ".bashrc"),
      body: (lang) => `export PENGUIN_LANG=${lang}`,
    };
  }
  return {
    kind: "unknown",
    rcPath: join(home, ".profile"),
    body: (lang) => `export PENGUIN_LANG=${lang}`,
  };
}

/** Insert or update the marked PenguinHarness block in place within the text; leaves the rest of the content unchanged. */
export function upsertBlock(content: string, bodyLine: string): string {
  const block = `${BEGIN}\n${bodyLine}\n${END}`;
  const begin = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  if (begin !== -1 && end !== -1 && end > begin) {
    const before = content.slice(0, begin);
    const after = content.slice(end + END.length);
    return `${before}${block}${after}`;
  }
  // Append at the end: leave a blank line before it if there's existing content.
  if (content.length === 0) return `${block}\n`;
  const sep = content.endsWith("\n") ? "" : "\n";
  return `${content}${sep}\n${block}\n`;
}

/** Write the language into the shell startup file (creating the directory if needed). Returns the file path written and the shell kind. */
export async function applyLanguageToRc(
  lang: Language,
  opts: { shell: string | undefined; home: string },
): Promise<{ rcPath: string; kind: ShellKind }> {
  const rc = resolveShellRc(opts.shell, opts.home);
  await mkdir(dirname(rc.rcPath), { recursive: true });
  let content = "";
  try {
    content = await readFile(rc.rcPath, "utf8");
  } catch {
    /* File doesn't exist yet; treat as empty content */
  }
  await writeFile(rc.rcPath, upsertBlock(content, rc.body(lang)), "utf8");
  return { rcPath: rc.rcPath, kind: rc.kind };
}

/** Open an interactive shell carrying the new language env var; this process exits when the user exits that shell. */
export function restartShell(lang: Language): void {
  const shell = process.env.SHELL || "/bin/zsh";
  const child = spawn(shell, ["-i"], {
    stdio: "inherit",
    env: { ...process.env, PENGUIN_LANG: lang },
  });
  child.on("exit", (code) => process.exit(code ?? 0));
  child.on("error", () => process.exit(1));
}
