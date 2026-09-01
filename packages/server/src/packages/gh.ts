/**
 * The `gh` CLI as a publishing identity.
 *
 * A GitHub token stored in the harness is one way to publish; the other is the `gh` CLI
 * already logged in on the machine the server runs on. Its credential cannot be read out of
 * gh's own store — and should not be — so the server does not try: it hands the request TO
 * gh (`gh api`), which supplies its own auth. Nothing is copied, nothing is persisted, and
 * revoking `gh auth logout` revokes this too.
 *
 * A component so a test can replace it, and so the spawn stays in one place.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Component, Interface } from "@prismshadow/penguin-core/kernel";

const execFileAsync = promisify(execFile);

/** How long an availability probe is trusted (gh may be installed or logged out meanwhile). */
const PROBE_TTL_MS = 5 * 60_000;
const TIMEOUT_MS = 60_000;

export class GhError extends Error {}

@Component()
export class GhCliRunner implements GhCli {
  private probe: { at: number; ok: boolean } | null = null;

  /** Whether a `gh` on PATH is logged in — the only question that decides if it can publish. */
  async available(): Promise<boolean> {
    const now = Date.now();
    if (this.probe !== null && now - this.probe.at < PROBE_TTL_MS) return this.probe.ok;
    let ok = false;
    try {
      await execFileAsync("gh", ["auth", "status", "--active"], {
        timeout: 10_000,
        maxBuffer: 256 * 1024,
      });
      ok = true;
    } catch {
      ok = false;
    }
    this.probe = { at: now, ok };
    return ok;
  }

  /**
   * One GitHub API call through gh. `body` is sent on stdin (`--input -`), so nothing large
   * or quoted ends up on a command line. Returns the parsed JSON response.
   */
  async api(path: string, method: string, body?: unknown): Promise<unknown> {
    const args = ["api", "--method", method, path];
    if (body !== undefined) args.push("--input", "-");
    let stdout: string;
    try {
      const run = execFileAsync("gh", args, { timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 });
      if (body !== undefined) {
        run.child.stdin?.end(JSON.stringify(body));
      }
      ({ stdout } = await run);
    } catch (err) {
      const stderr = (err as { stderr?: string }).stderr?.trim();
      throw new GhError(
        stderr === undefined || stderr === "" ? String(err) : stderr.split("\n").at(-1)!,
      );
    }
    try {
      return JSON.parse(stdout) as unknown;
    } catch {
      throw new GhError("gh returned a response that is not JSON.");
    }
  }
}

/** What the package service needs of the `gh` CLI. */
export abstract class GhCli extends Interface<{
  available(): Promise<boolean>;
  api(path: string, method: string, body?: unknown): Promise<unknown>;
}>() {}
