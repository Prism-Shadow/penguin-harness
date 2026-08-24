/**
 * Obtaining a session ON a machine without its password crossing the wire.
 *
 * A machine is a separate server with its own accounts, so reaching its API needs a session
 * there. Asking a person to type that machine's password into this window would work, and is
 * the fallback — but for a machine THIS server installed there is no need: it already has
 * ssh, which can already read that machine's whole data root. So the sign-in happens over
 * there (remote-signin.cjs) and only the Set-Cookie line comes back.
 *
 * What that buys, precisely: a session token crosses ssh instead of a password crossing the
 * tunnel. The token is short-lived and revocable; the password is neither.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { cleanupCommand, makeScratchCommand, scpArgs, sshArgs } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { fileURLToPath } from "node:url";
import { execFailureText, run } from "./exec.js";

const OK_MARK = "---penguin-signin-ok---";
const FAIL_MARK = "---penguin-signin-failed---";

export type SignInOutcome =
  /** The Set-Cookie lines that machine's server issued, verbatim. */
  | { kind: "signed-in"; setCookie: string[] }
  /** It answered and said no — most often because its admin password was changed. */
  | { kind: "refused"; detail: string }
  | { kind: "failed"; detail: string };

/** Signs in on `target` and brings back its cookies. Never throws. */
export async function signInOnRemote(opts: {
  target: RemoteTarget;
  userId?: string;
  /** The hmr capability's assetsDir accessor: where a pushed bundle's assets were unpacked. */
  assets?: () => string | null;
}): Promise<SignInOutcome> {
  const scratchName = `penguin-signin-${randomBytes(6).toString("hex")}`;
  const made = await run("ssh", sshArgs(opts.target, makeScratchCommand("linux", scratchName)), {
    timeoutMs: 60_000,
  });
  const scratch = made.stdout.trim().split("\n").pop()?.trim() ?? "";
  if (made.code !== 0 || scratch === "") {
    return { kind: "failed", detail: execFailureText(made, "no scratch directory on the remote") };
  }

  const localTmp = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-signin-"));
  try {
    // Beside this module in a packaged install (dist/), among the published assets in a
    // hot-pushed one — the same rule the installer and the upgrade applier follow.
    const scriptHome = opts.assets?.() ?? path.dirname(fileURLToPath(import.meta.url));
    fs.copyFileSync(
      path.join(scriptHome, "remote-signin.cjs"),
      path.join(localTmp, "remote-signin.cjs"),
    );
    fs.writeFileSync(
      path.join(localTmp, "signin-job.json"),
      JSON.stringify({ dataRoot: "$HOME/.penguin/data", userId: opts.userId ?? "admin" }),
    );
    const sent = await run(
      "scp",
      scpArgs(
        opts.target,
        ["remote-signin.cjs", "signin-job.json"].map((f) => path.join(localTmp, f)),
        scratch,
      ),
      { timeoutMs: 120_000 },
    );
    if (sent.code !== 0) {
      return { kind: "failed", detail: execFailureText(sent, "could not copy the sign-in script") };
    }

    // `$HOME` is expanded by the far side's shell, so the data root resolves to that
    // machine's home rather than being sent as a literal from here.
    const ran = await run(
      "ssh",
      sshArgs(
        opts.target,
        `cd ${scratch} && sed -i "s|\\\\$HOME|$HOME|" signin-job.json && ` +
          `"\${XDG_DATA_HOME:-$HOME/.local/share}/penguin/lib/runtime/bin/node" remote-signin.cjs 2>&1 || ` +
          `node remote-signin.cjs 2>&1`,
      ),
      { timeoutMs: 120_000 },
    );
    const out = ran.stdout;
    if (out.includes(OK_MARK)) {
      const setCookie = (out.split(OK_MARK)[1] ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
      return setCookie.length > 0
        ? { kind: "signed-in", setCookie }
        : { kind: "failed", detail: "the machine returned no cookie" };
    }
    if (out.includes(FAIL_MARK)) {
      return { kind: "refused", detail: (out.split(FAIL_MARK)[1] ?? "").trim().slice(0, 300) };
    }
    return {
      kind: "failed",
      detail: execFailureText(ran, "the sign-in said nothing").slice(0, 300),
    };
  } finally {
    fs.rmSync(localTmp, { recursive: true, force: true });
    await run("ssh", sshArgs(opts.target, cleanupCommand("linux", scratch)), {
      timeoutMs: 60_000,
    }).catch(() => undefined);
  }
}
