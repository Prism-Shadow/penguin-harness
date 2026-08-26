/**
 * The machines service: this server's own `~/.ssh/config` as a list of targets, and putting
 * this build on one of them.
 *
 * An install is a JOB, not a request. It probes the far side, may fetch and verify a ~30 MB
 * Node runtime, copies an image over scp and runs an installer there — minutes, in the bad
 * case — so POST starts it and the Web App polls for the progress lines. One at a time: the
 * surface is a person installing on one machine, and a second concurrent push would compete
 * for the same runtime cache directory.
 *
 * The JOB is not persisted. It lives in this App's memory and dies with it (see the park
 * list in ../hmr/platform.ts — it is on the SUSPENDED side): a hot push during an install
 * loses the progress log, and the recovery is to run it again, which is safe because every
 * step is idempotent — the far side's installer stages, smoke-tests and swaps, and an
 * unchanged version is a no-op.
 *
 * The RESULT is. Which machines carry this program is not a property of the last job — it
 * has to outlive the job, the process and the next install somewhere else — so a successful
 * install is written to `<data root>/machines-installs.json` (installs.ts) and read back
 * into every list(). Without it "installed" would blink out the moment anything else
 * happened, which is exactly what it did before this file wrote anything down.
 */
import fs from "node:fs";
import path from "node:path";
import type { MachineInfo, MachineInstallJob } from "../api/types.js";
import { listHostAliases, resolveTarget } from "./targets.js";
import { installOnRemote, resolvePayloadImage } from "./install-server.js";
import { parseInstallRecords, withInstallRecord } from "./installs.js";
import type { InstallRecord } from "./installs.js";

/** Why a start was refused before any ssh ran. */
export type InstallRefusal = "busy" | "unknown-machine" | "unresolvable" | "no-image";

/**
 * The three things this service does to the world, injectable as a set. Production passes
 * none of them; tests pass all three, because the real ones read the developer's own
 * ~/.ssh/config and spawn ssh against whatever it names. The push path itself is covered
 * where it belongs — machines-push.test.ts drives the real installOnRemote against a fake
 * ssh binary — so what is faked here is only the reaching-out, never the logic under test.
 */
export interface MachinesEffects {
  listAliases: typeof listHostAliases;
  resolveTarget: typeof resolveTarget;
  resolveImage: typeof resolvePayloadImage;
  install: typeof installOnRemote;
  /** Injected so a test can pin the recorded timestamp instead of asserting around the clock. */
  now: () => Date;
}

export class MachinesService {
  #job: MachineInstallJob | null = null;
  readonly #effects: MachinesEffects;

  /**
   * `dataRoot` is the server's own data root: it holds the hmr store the pushable image is
   * assembled from, and the runtime cache verified Node downloads are kept in, so the second
   * host of a given platform-arch costs no download.
   */
  /** Where a pushed bundle's assets were unpacked; null in a packaged server (hmr.assetsDir). */
  readonly #assets: () => string | null;

  constructor(
    private readonly dataRoot: string,
    effects: Partial<MachinesEffects> = {},
    assets: () => string | null = () => null,
  ) {
    this.#assets = assets;
    this.#effects = {
      listAliases: listHostAliases,
      resolveTarget,
      resolveImage: resolvePayloadImage,
      install: installOnRemote,
      now: () => new Date(),
      ...effects,
    };
  }

  /** Where the install records live — beside the other per-machine state in the data root. */
  get #recordsFile(): string {
    return path.join(this.dataRoot, "machines-installs.json");
  }

  /** The records file's text, or null when there is none yet (or it cannot be read). */
  #readRecords(): string | null {
    try {
      return fs.readFileSync(this.#recordsFile, "utf8");
    } catch {
      return null; // Never installed from this server yet, or an unreadable file: nothing remembered.
    }
  }

  /**
   * The ssh config's host aliases, each carrying what this server last installed there.
   * Empty when there is no config, which is not an error.
   */
  list(): MachineInfo[] {
    const records = parseInstallRecords(this.#readRecords());
    return this.#effects.listAliases().map((alias) => {
      const id = `ssh:${alias}`;
      return { id, alias, installed: records[id] ?? null };
    });
  }

  /**
   * The version this server would install, or null when it has no image to push — a dev
   * checkout that has never been pushed to is the one shape with none. The page asks for it
   * so it can say so up front, rather than letting every install fail at the same step.
   */
  imageVersion(): string | null {
    return this.#effects.resolveImage(this.dataRoot)?.version ?? null;
  }

  /** The running or last job; null before the first one. */
  job(): MachineInstallJob | null {
    return this.#job;
  }

  /**
   * Starts an install, refusing rather than queueing. The refusals that can be decided here —
   * a job already running, an alias this config does not declare, an ssh that cannot resolve
   * it, no image to send — are answered synchronously, so the page distinguishes "did not
   * start" from "started and failed" without reading the log.
   */
  async startInstall(
    machineId: string,
  ): Promise<{ ok: true } | { ok: false; why: InstallRefusal }> {
    if (this.#job?.running === true) return { ok: false, why: "busy" };

    const machine = this.list().find((entry) => entry.id === machineId);
    if (machine === undefined) return { ok: false, why: "unknown-machine" };

    const image = this.#effects.resolveImage(this.dataRoot);
    if (image === null) return { ok: false, why: "no-image" };

    const resolved = await this.#effects.resolveTarget(machine.alias);
    if (resolved === null) return { ok: false, why: "unresolvable" };

    const job: MachineInstallJob = {
      machineId,
      alias: machine.alias,
      running: true,
      log: [],
      result: null,
    };
    this.#job = job;

    const say = (line: string) => {
      job.log.push(line);
    };
    // Deliberately not awaited: the caller is an HTTP handler answering 202. Failures land
    // in the job's own result — the catch below is the last resort for a throw the install
    // path does not turn into a `failed` outcome itself.
    void (async () => {
      try {
        say(`Installing ${image.version} on ${resolved.machine}…`);
        // No identity passed: installOnRemote runs the probe itself as its first step and
        // narrates it, so the page shows what the machine turned out to be.
        const outcome = await this.#effects.install({
          target: { alias: machine.alias, user: resolved.settings.user },
          image,
          runtimeCacheDir: path.join(this.dataRoot, "runtime-cache"),
          onProgress: say,
          assets: this.#assets,
        });
        if (outcome.kind === "failed") {
          job.result = { ok: false, step: outcome.step, message: outcome.detail };
          return;
        }
        const version = outcome.kind === "already-installed" ? outcome.version : image.version;
        // Remember it BEFORE the job settles, so the first poll that sees `running: false`
        // already sees the machine marked installed — otherwise the page would flash the
        // verdict and a still-uninstalled row in the same frame.
        this.#remember(machineId, { version, at: this.#effects.now().toISOString() });
        job.result = { ok: true, kind: outcome.kind, version };
      } catch (err) {
        job.result = {
          ok: false,
          step: "install",
          message: err instanceof Error ? err.message : String(err),
        };
      } finally {
        job.running = false;
      }
    })();

    return { ok: true };
  }

  /**
   * Writes one machine's record.
   *
   * Through a temp file and a rename rather than straight onto the target: a plain write
   * truncates first, so a crash mid-write leaves bytes the parser reads as "nothing
   * installed anywhere" — treating damage as empty is right for a cache, but it means a
   * torn write silently forgets every OTHER machine too, not just the one being recorded.
   * Rename is one step; a reader sees the old file or the new one.
   *
   * A failure here is swallowed: the install itself already succeeded, and the far side has
   * the program whether or not this side managed to note it down. Forgetting costs one
   * needless reinstall, which is a no-op on the remote.
   */
  #remember(machineId: string, record: InstallRecord): void {
    const next = withInstallRecord(this.#readRecords(), machineId, record);
    const tmp = `${this.#recordsFile}.tmp-${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(this.#recordsFile), { recursive: true });
      fs.writeFileSync(tmp, next);
      fs.renameSync(tmp, this.#recordsFile);
    } catch {
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* the temp file is litter at worst */
      }
    }
  }
}
