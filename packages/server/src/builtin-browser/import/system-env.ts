/**
 * The {@link ImportEnv} of the machine the server runs on. `exec` runs the key helpers
 * (`security`, `secret-tool`, `powershell`) without a shell, feeding `input` on stdin. Its
 * stdout carries secrets, so a failure reports the exit status and never the output.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import type { ImportEnv } from "./index.js";

/** Long enough for a person to answer the macOS Keychain prompt. */
const HELPER_TIMEOUT_MS = 120_000;

export function systemImportEnv(): ImportEnv {
  return {
    platform: process.platform,
    homedir: os.homedir(),
    env: process.env,
    tmpdir: os.tmpdir(),
    exec: runHelper,
  };
}

function runHelper(file: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      timeout: HELPER_TIMEOUT_MS,
    });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (err) => reject(new Error(`${file} could not be started: ${err.message}`)));
    child.on("close", (code, signal) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString("utf8"));
      else reject(new Error(`${file} exited with ${signal ?? `code ${code}`}`));
    });
    // A helper that exits before reading stdin closes the pipe; the exit code tells the story.
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}
