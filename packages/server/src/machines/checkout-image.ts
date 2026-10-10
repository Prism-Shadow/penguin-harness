/**
 * A source checkout's install image: what this server puts on a machine when it runs from
 * the repository (`pnpm dev`, `pnpm desktop`) rather than from an installed release.
 *
 * An install puts two things on a machine (install-server.ts): a release, which the far side
 * downloads itself, and this server's hmr state, replicated over ssh. The second is what runs
 * there — every command this side sends goes through the CLI in that state (commands.ts's
 * remotePenguin), and that CLI carries the whole server — so the release contributes the Node
 * runtime and the loader. A packaged server reads both halves off its own install. A checkout
 * has neither: no release tree around its entry, and no store unless something pushed to it,
 * which would make the dev server run that copy instead of its source from its next start on.
 *
 * So a checkout builds the state half itself, with the hot push's own packer (`node
 * scripts/deploy.mjs --out`), and lays it down as a store of its own under the data root:
 * `<root>/machines/checkout-image/<id>/hmr`, never `<root>/hmr`. The release half is the
 * checkout's own VERSION. The version is `<VERSION>+hmr.<platform sha>`, the form a hot-pushed
 * server reports — and the form the machine then reports of itself.
 *
 * Built when an install asks, never at boot and never for a page that only lists machines,
 * so a dev server starts as fast as it did. One build at a time; an ask while one runs gets
 * that one. The packer is deterministic and an image is named by its content, so rebuilding
 * an unchanged tree lands on the image already there: the same harness, the same version,
 * nothing for an install to send. A build prunes the older images, never one a job is still
 * installing (`holding`).
 */
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import type { MachinesCheckoutImage } from "../api/types.js";
import { writePushedBuild } from "../hmr/pushed-build.js";
import type { PushedBuild } from "../hmr/pushed-build.js";
import { planOver } from "./install-server.js";
import type { PushPlan } from "./install-server.js";

/**
 * Packs this checkout's build into `outFile` as a gzipped upgrade body, telling `onLine` what
 * it is doing. Never throws: a failure is the answer, in the packer's own words.
 */
export type CheckoutPacker = (
  outFile: string,
  onLine: (line: string) => void,
) => Promise<{ ok: true } | { ok: false; detail: string }>;

/** A build's outcome: the plan an install now uses, or why there is none. */
export type CheckoutBuild = { ok: true; plan: PushPlan } | { ok: false; detail: string };

/** The file naming the image an install uses: the id of one directory beside it. */
const CURRENT = "current";
/** An image directory's name: 16 hex digits of its content. */
const IMAGE_ID = /^[0-9a-f]{16}$/;

export class CheckoutImage {
  #building: Promise<CheckoutBuild> | null = null;
  /** Whoever asked for the build in flight, so a job that joined it hears it too. */
  readonly #listeners = new Set<(line: string) => void>();
  /** The last build's failure, until a build succeeds. */
  #failure: string | null = null;
  #runs = 0;
  /**
   * The images jobs are still installing or handing over, by id, with how many hold each: a
   * job copies its image minutes after the build, once the far side has its release, and the
   * builds that land meanwhile must not prune it.
   */
  readonly #held = new Map<string, number>();

  constructor(
    /** `<root>/machines/checkout-image`. */
    private readonly dir: string,
    /** The release a machine downloads under the image: the checkout's own VERSION. */
    private readonly baseVersion: string,
    private readonly pack: CheckoutPacker,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** What the Machines page says about the image. */
  status(): MachinesCheckoutImage {
    if (this.#building !== null) return { state: "building" };
    if (this.#failure !== null) return { state: "failed", detail: this.#failure };
    return { state: this.plan() === null ? "unbuilt" : "built" };
  }

  /**
   * The image an install would use now: the last one built, which outlives a restart, or
   * null before the first build.
   */
  plan(): PushPlan | null {
    const id = this.#currentId();
    if (id === null) return null;
    const plan = planOver(this.baseVersion, path.join(this.dir, id, "hmr"));
    return plan.harness === null ? null : plan;
  }

  /** Builds the image from the checkout as it is now, or joins the build already running. */
  build(onLine: (line: string) => void): Promise<CheckoutBuild> {
    this.#listeners.add(onLine);
    this.#building ??= this.#run().finally(() => {
      this.#building = null;
      this.#listeners.clear();
    });
    return this.#building;
  }

  /**
   * Runs `work` with the plan's image held, so no build prunes it before `work` is done. A
   * plan that is not one of these images runs as it is.
   */
  async holding<T>(plan: PushPlan, work: () => Promise<T>): Promise<T> {
    const image = plan.hmrDir === null ? null : path.dirname(plan.hmrDir);
    const id = image !== null && path.dirname(image) === this.dir ? path.basename(image) : null;
    if (id === null || !IMAGE_ID.test(id)) return work();
    this.#held.set(id, (this.#held.get(id) ?? 0) + 1);
    try {
      return await work();
    } finally {
      const left = (this.#held.get(id) ?? 1) - 1;
      if (left > 0) this.#held.set(id, left);
      else this.#held.delete(id);
    }
  }

  #currentId(): string | null {
    try {
      const id = fs.readFileSync(path.join(this.dir, CURRENT), "utf8").trim();
      return IMAGE_ID.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  async #run(): Promise<CheckoutBuild> {
    const say = (line: string) => {
      for (const listener of this.#listeners) listener(line);
    };
    this.#runs += 1;
    const body = path.join(this.dir, `.build-${process.pid}-${this.#runs}.gz`);
    const staging = path.join(this.dir, `.staging-${process.pid}-${this.#runs}`);
    try {
      await fsp.mkdir(this.dir, { recursive: true });
      await this.#sweepLeftovers();
      const packed = await this.pack(body, say);
      if (!packed.ok) return this.#failed(packed.detail);
      let build: PushedBuild;
      try {
        build = JSON.parse(zlib.gunzipSync(await fsp.readFile(body)).toString("utf8"));
      } catch (err) {
        return this.#failed(`the packer did not leave a readable build: ${message(err)}`);
      }
      const harness = await writePushedBuild(path.join(staging, "hmr"), build, this.now());
      const id = imageId(harness);
      // Built before, byte for byte: that image stays as it is, its harness.json included,
      // so a machine that already carries it reads as current.
      if (!fs.existsSync(path.join(this.dir, id, "hmr", "harness.json"))) {
        await fsp.rm(path.join(this.dir, id), { recursive: true, force: true });
        await fsp.rename(staging, path.join(this.dir, id));
      }
      const previous = this.#currentId();
      const pointer = path.join(this.dir, `${CURRENT}.${process.pid}.tmp`);
      await fsp.writeFile(pointer, id);
      await fsp.rename(pointer, path.join(this.dir, CURRENT));
      // The image this build replaces stays, and so does any image a job still holds; the
      // rest go.
      await this.#prune(new Set([id, ...(previous === null ? [] : [previous])]));
      const plan = this.plan();
      if (plan === null) return this.#failed("the image was written but cannot be read back.");
      this.#failure = null;
      return { ok: true, plan };
    } catch (err) {
      return this.#failed(message(err));
    } finally {
      await fsp.rm(body, { force: true }).catch(() => {});
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  #failed(detail: string): CheckoutBuild {
    this.#failure = detail;
    return { ok: false, detail };
  }

  /** What a build that died with its process left behind; only one server holds a data root. */
  async #sweepLeftovers(): Promise<void> {
    for (const name of await fsp.readdir(this.dir)) {
      if (
        name.startsWith(".build-") ||
        name.startsWith(".staging-") ||
        name.startsWith(`${CURRENT}.`)
      ) {
        await fsp.rm(path.join(this.dir, name), { recursive: true, force: true });
      }
    }
  }

  async #prune(keep: ReadonlySet<string>): Promise<void> {
    for (const name of await fsp.readdir(this.dir)) {
      if (IMAGE_ID.test(name) && !keep.has(name) && !this.#held.has(name)) {
        await fsp.rm(path.join(this.dir, name), { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}

/**
 * Where an image's assets sit — the installers it was packed with among them — or null. An
 * install reads its installer from here: the copy beside the module is in a built `dist/`,
 * which a `tsx` run of the checkout does not have.
 */
export function imageAssets(plan: PushPlan): string | null {
  if (plan.hmrDir === null || plan.harness === null) return null;
  try {
    const dir = (JSON.parse(plan.harness) as { assets?: { dir?: unknown } }).assets?.dir;
    return typeof dir === "string" ? path.join(plan.hmrDir, ...dir.split("/")) : null;
  } catch {
    return null;
  }
}

/**
 * An image's id: its harness record minus the time it was written, so the same parts always
 * name the same directory.
 */
function imageId(harness: string): string {
  const { pushedAt: _at, ...parts } = JSON.parse(harness) as Record<string, unknown>;
  return crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

/** The root package of this repository, which tells its checkout from any other workspace. */
const REPOSITORY_PACKAGE = "penguin-harness";

/**
 * The checkout this module runs from, or null when it runs from anything else: the directory
 * holding `pnpm-workspace.yaml`, when that workspace is this repository and has the packer.
 * Walked up to rather than counted, because the depth differs between a `tsx` run, a built
 * one and the desktop shell's bundle (the same walk as services/cli-shim.ts). A packaged
 * program, and a platform pushed into a data root's store, have no such directory above
 * them. A server installed as a dependency of another pnpm workspace stops at that
 * workspace, and it is not this repository: its `scripts/deploy.mjs`, if it has one,
 * deploys something else and must never run.
 */
export function findCheckout(fromDir: string): string | null {
  let dir = path.resolve(fromDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      const ours = rootPackageName(dir) === REPOSITORY_PACKAGE;
      return ours && fs.existsSync(path.join(dir, "scripts", "deploy.mjs")) ? dir : null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The `name` in a directory's package.json, or null. */
function rootPackageName(dir: string): string | null {
  try {
    const manifest: { name?: unknown } = JSON.parse(
      fs.readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    return typeof manifest.name === "string" ? manifest.name : null;
  } catch {
    return null;
  }
}

/** A cold build fetches the builtin plugins' dependencies from the registry; this is far past that. */
const PACK_TIMEOUT_MS = 20 * 60_000;
/** How many of the packer's last lines a failure quotes. */
const TAIL_LINES = 10;
/** The packer's own lines: its narration, told without the prefix. */
const OWN = "[deploy] ";
/**
 * Whether a build can lead a process group of its own (POSIX), so that one signal reaches
 * every process it started. Windows has no groups; there the tree is walked instead.
 */
const PROCESS_GROUPS = process.platform !== "win32";

/**
 * The packer: `node scripts/deploy.mjs --out <file>` in the checkout, on this server's own
 * runtime — under the desktop shell that is the Electron binary, which runs a script as Node
 * only with ELECTRON_RUN_AS_NODE. Its `[deploy] …` lines are the narration. A failure quotes
 * its last lines whoever printed them (pnpm, vite, the packer), which is where the reason is
 * — less the stack frames, which say where a tool failed rather than why, and would push the
 * why out of the quote.
 *
 * A build is stopped whole — the packer and the pnpm, vite and plugin installs it started —
 * when it runs out of time and when this server exits. On POSIX it leads a process group of
 * its own for that, so the terminal's Ctrl-C reaches this server alone; the server's SIGINT
 * and SIGTERM end in process.exit, and the exit takes the group with it. On Windows it stays
 * on the server's console, which Ctrl-C reaches as before, and `taskkill /T` stops its tree.
 */
export function deployPacker(checkoutRoot: string): CheckoutPacker {
  return (outFile, onLine) =>
    new Promise((resolve) => {
      const tail: string[] = [];
      const take = (raw: string) => {
        const line = raw.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "").trim();
        if (line === "" || /^at\s/.test(line)) return;
        const own = line.startsWith(OWN) ? line.slice(OWN.length) : null;
        tail.push(own ?? line);
        if (tail.length > TAIL_LINES) tail.shift();
        if (own !== null) onLine(own);
      };
      const read = (stream: Readable | null) => {
        if (stream === null) return;
        let rest = "";
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => {
          const lines = (rest + chunk).split(/\r?\n/);
          rest = lines.pop() ?? "";
          for (const line of lines) take(line);
        });
        stream.on("end", () => take(rest));
      };
      let child: ChildProcess;
      try {
        child = spawn(
          process.execPath,
          [path.join(checkoutRoot, "scripts", "deploy.mjs"), "--out", outFile],
          {
            cwd: checkoutRoot,
            env: {
              ...process.env,
              ...(process.versions.electron === undefined ? {} : { ELECTRON_RUN_AS_NODE: "1" }),
              // Words, not escape codes: these lines end up in a job log and a notice.
              FORCE_COLOR: "0",
              NO_COLOR: "1",
            },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
            detached: PROCESS_GROUPS,
          },
        );
      } catch (err) {
        resolve({ ok: false, detail: message(err) });
        return;
      }
      // Ctrl-C in the dev terminal, a tsx-watch restart, the desktop quitting: the build goes
      // with the server.
      const onExit = () => stopTree(child, "SIGTERM", true);
      process.once("exit", onExit);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        stopTree(child, "SIGKILL", false);
      }, PACK_TIMEOUT_MS);
      timer.unref?.();
      const settled = () => {
        clearTimeout(timer);
        process.off("exit", onExit);
      };
      read(child.stdout);
      read(child.stderr);
      child.on("error", (err) => {
        settled();
        resolve({ ok: false, detail: message(err) });
      });
      child.on("close", (code, signal) => {
        settled();
        if (code === 0) {
          resolve({ ok: true });
          return;
        }
        const said = tail.join("\n");
        resolve({
          ok: false,
          detail: timedOut
            ? `the build did not finish within ${PACK_TIMEOUT_MS / 60_000} minutes.${said === "" ? "" : `\n${said}`}`
            : said === ""
              ? `the packer exited with ${code ?? signal} and said nothing.`
              : said,
        });
      });
    });
}

/**
 * Stops a build and every process it started: a signal to the process group it leads, or on
 * Windows `taskkill /T` over its tree — through spawnSync while this process is exiting, when
 * nothing asynchronous runs any more — and the build's own process when taskkill cannot.
 */
function stopTree(child: ChildProcess, signal: NodeJS.Signals, exiting: boolean): void {
  const pid = child.pid;
  if (pid === undefined) return;
  if (PROCESS_GROUPS) {
    try {
      process.kill(-pid, signal);
    } catch {
      // The group has ended already.
    }
    return;
  }
  const args = ["/pid", String(pid), "/T", "/F"];
  if (exiting) {
    const done = spawnSync("taskkill", args, { stdio: "ignore", windowsHide: true });
    if (done.error !== undefined || done.status !== 0) child.kill();
    return;
  }
  try {
    const killer = spawn("taskkill", args, { stdio: "ignore", windowsHide: true });
    killer.on("error", () => child.kill());
    killer.on("exit", (code) => {
      if (code !== 0) child.kill();
    });
  } catch {
    child.kill();
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
