/**
 * Sending THIS server's hot-pushed build to a machine, and applying it there.
 *
 * The same three artifacts the local server was pushed — platform, cli, web (plus any native
 * assets) — are re-packed into the body `/api/hmr/upgrade` takes, copied over ssh, and
 * applied by a script that runs on the far side (./remote-upgrade.cjs, shipped as a real
 * file beside this module — see this package's tsup.config.ts).
 *
 * The applier runs THERE for one reason: the upgrade endpoint takes an admin cookie session,
 * so something has to log in, and the password must not travel the wire to do it. Over there
 * it does not have to — the machine reads its own seeded password off its own disk and logs
 * in over 127.0.0.1. Only the bundle crosses the network, and the bundle is not a secret.
 *
 * The result is a hot swap: seconds, no restart, and nothing that machine was running dies.
 * That is the difference between this and reinstalling, which replaces the program on disk
 * and needs the server bounced to take effect.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { randomBytes } from "node:crypto";
import { cleanupCommand, makeScratchCommand, scpArgs, sshArgs } from "./commands.js";
import type { RemoteTarget } from "./commands.js";
import { fileURLToPath } from "node:url";
import type { ExecResult } from "./exec.js";
import { mintTokenOnRemote } from "./remote-token.js";
import { run } from "./exec.js";

/** Markers the far-side script prints, so an outcome is read rather than guessed from prose. */
const OK_MARK = "---penguin-upgrade-ok---";
const FAIL_MARK = "---penguin-upgrade-failed---";

export type UpgradeOutcome =
  | { kind: "upgraded"; detail: string }
  /** The machine answered, and said no — a changed admin password, a refused body. */
  | { kind: "refused"; detail: string }
  /** Nothing to send: this server has never been pushed to. */
  | { kind: "no-build" }
  /** ssh or scp failed; `detail` is their own words. */
  | { kind: "failed"; step: string; detail: string };

/**
 * The upgrade body, rebuilt from this server's own hmr store: exactly what it was pushed,
 * forwarded unchanged. Null when nothing has been pushed here — a server running its
 * packaged build has no bundle to hand on, and pretending otherwise would send a machine
 * something that never existed as a version.
 */
export function readPushedBuild(dataRoot: string): Buffer | null {
  try {
    const hmrDir = path.join(dataRoot, "hmr");
    const manifest = JSON.parse(fs.readFileSync(path.join(hmrDir, "harness.json"), "utf8")) as {
      platform?: { bundle?: string };
      cli?: { bundle?: string };
      web?: { manifest?: string };
    };
    if (
      typeof manifest.platform?.bundle !== "string" ||
      typeof manifest.cli?.bundle !== "string" ||
      typeof manifest.web?.manifest !== "string"
    ) {
      return null;
    }
    const platform = fs.readFileSync(path.join(hmrDir, manifest.platform.bundle), "utf8");
    const cli = fs.readFileSync(path.join(hmrDir, manifest.cli.bundle), "utf8");
    // The web artifact is stored as gzip(JSON.stringify({ files })) — the same shape the
    // upgrade body carries, so it is unwrapped once here rather than re-encoded.
    const web = JSON.parse(
      zlib.gunzipSync(fs.readFileSync(path.join(hmrDir, manifest.web.manifest))).toString("utf8"),
    ) as { files: Record<string, string> };
    return zlib.gzipSync(Buffer.from(JSON.stringify({ platform, cli, web })));
  } catch {
    return null; // No store, a partial record, or damage: nothing safe to forward.
  }
}

/**
 * Copies the build to `target` and applies it there. Never throws: every failure is one of
 * the outcomes above, carrying the far side's own words where there are any.
 */
export async function upgradeRemote(opts: {
  target: RemoteTarget;
  dataRoot: string;
  onProgress?: (line: string) => void;
  /** The hmr capability's assetsDir accessor: where a pushed bundle's assets were unpacked. */
  assets?: () => string | null;
  /**
   * Runs one command on the machine, used to ask its CLI for a session token. Without it the
   * far side falls back to reading that machine's seeded admin password — which is gone on
   * any machine whose password a person has set, and those are exactly the machines that then
   * silently stop receiving hot updates.
   */
  runOn?: (target: RemoteTarget, command: string) => Promise<ExecResult>;
}): Promise<UpgradeOutcome> {
  const say = opts.onProgress ?? (() => {});
  const payload = readPushedBuild(opts.dataRoot);
  if (payload === null) return { kind: "no-build" };

  // Asked BEFORE anything is copied: it is one command over a connection that already exists,
  // and a machine that cannot authenticate should not first be sent 8 MB.
  const minted =
    opts.runOn === undefined
      ? null
      : await mintTokenOnRemote(opts.target, opts.runOn).then((outcome) =>
          outcome.kind === "minted" ? outcome.token : null,
        );

  const scratchName = `penguin-upgrade-${randomBytes(6).toString("hex")}`;
  const made = await run("ssh", sshArgs(opts.target, makeScratchCommand("linux", scratchName)), {
    timeoutMs: 60_000,
  });
  const scratch = made.stdout.trim().split("\n").pop()?.trim() ?? "";
  if (made.code !== 0 || scratch === "") {
    return {
      kind: "failed",
      step: "connect",
      detail: made.stderr.trim() || "no scratch directory",
    };
  }

  const localTmp = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-upgrade-"));
  try {
    const payloadName = "upgrade.gz";
    fs.writeFileSync(path.join(localTmp, payloadName), payload);
    // Beside this module in a packaged install (dist/), among the published assets in a
    // hot-pushed one — the same rule the installer follows.
    const applierHome = opts.assets?.() ?? path.dirname(fileURLToPath(import.meta.url));
    fs.copyFileSync(
      path.join(applierHome, "remote-upgrade.cjs"),
      path.join(localTmp, "remote-upgrade.cjs"),
    );
    fs.writeFileSync(
      path.join(localTmp, "upgrade-job.json"),
      // No dataRoot: the far side resolves its own home (see remote-upgrade.cjs).
      // The token, when the machine could mint one: the far side then authenticates with it
      // instead of reading a seeded password that may no longer exist.
      JSON.stringify({ payloadName, ...(minted === null ? {} : { token: minted }) }),
    );

    say(`Sending this build (${(payload.byteLength / 1048576).toFixed(1)} MB)…`);
    const sent = await run(
      "scp",
      scpArgs(
        opts.target,
        ["upgrade.gz", "remote-upgrade.cjs", "upgrade-job.json"].map((f) => path.join(localTmp, f)),
        scratch,
      ),
      { timeoutMs: 10 * 60_000 },
    );
    if (sent.code !== 0) {
      return { kind: "failed", step: "copy", detail: sent.stderr.trim() || "scp failed" };
    }

    say("Applying it there…");
    const applied = await run(
      "ssh",
      sshArgs(
        opts.target,
        `cd ${scratch} && ` +
          `"\${XDG_DATA_HOME:-$HOME/.local/share}/penguin/lib/runtime/bin/node" remote-upgrade.cjs 2>&1 || ` +
          `node remote-upgrade.cjs 2>&1`,
      ),
      { timeoutMs: 10 * 60_000 },
    );
    const out = applied.stdout;
    if (out.includes(OK_MARK)) {
      return { kind: "upgraded", detail: out.split(OK_MARK)[1]?.trim().slice(0, 400) ?? "" };
    }
    if (out.includes(FAIL_MARK)) {
      return { kind: "refused", detail: out.split(FAIL_MARK)[1]?.trim().slice(0, 400) ?? "" };
    }
    return {
      kind: "failed",
      step: "apply",
      detail: (applied.stderr.trim() || out.trim() || "the applier said nothing").slice(0, 400),
    };
  } finally {
    fs.rmSync(localTmp, { recursive: true, force: true });
    // Litter we created, on someone else's machine: removed either way.
    await run("ssh", sshArgs(opts.target, cleanupCommand("linux", scratch)), {
      timeoutMs: 60_000,
    }).catch(() => undefined);
  }
}
