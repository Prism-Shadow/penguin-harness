/**
 * A release's install image: the harness its build shipped beside its program, laid down as
 * an hmr store under this server's data root.
 *
 * Every command this side runs on a machine goes through the CLI in that machine's hmr store
 * (commands.ts's remotePenguin), so an install has to leave one there. A server that was
 * hot-pushed replicates its own pushed state; a source checkout builds an image with the hot
 * push's packer (checkout-image.ts). A release nothing was pushed to has no state of its
 * own, so its build ships one: the body that packer writes (`scripts/deploy.mjs --out`),
 * compiled from the release's sources, as `dist/install-image.gz` beside the program's entry —
 * in a tarball's `lib/`, and in the desktop app's `app/` (install-server.ts's shippedImage).
 *
 * It ships as that body, not as a store: one opaque file, which nothing that inspects an
 * app bundle (signing, notarization) reads as code, and which is the shape a checkout's
 * image is laid down from too. It is laid down with the same writer (hmr/pushed-build.ts's
 * writePushedBuild), so the store a machine receives is the store a push would have left.
 *
 * Laid down once per body, under `<root>/machines/release-image/<id>/hmr`, the id naming the
 * body's own bytes. Nothing on disk points at an image: the directory is found from the body
 * the running program ships, so after an upgrade the new body names a new directory and the
 * old one is never read again — it is removed when the new one is laid down.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { writePushedBuild } from "../hmr/pushed-build.js";
import type { PushedBuild } from "../hmr/pushed-build.js";
import { planOver } from "./install-server.js";
import type { PushPlan } from "./install-server.js";

/** An image directory's name: 16 hex digits of the shipped body. */
const IMAGE_ID = /^[0-9a-f]{16}$/;

export class ShippedImage {
  /** The shipped body's id, read once: the program on disk does not change under a process. */
  #id: string | null | undefined;
  #laying: Promise<{ ok: true; plan: PushPlan } | { ok: false; detail: string }> | null = null;

  constructor(
    /** `<root>/machines/release-image`. */
    private readonly dir: string,
    /** The release the image stands on: the program's own version. */
    private readonly baseVersion: string,
    /** The shipped body: `<program>/dist/install-image.gz`. */
    private readonly body: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** The image an install uses, once laid down; null before that, and when the body is unreadable. */
  plan(): PushPlan | null {
    const id = this.#bodyId();
    if (id === null) return null;
    const plan = planOver(this.baseVersion, path.join(this.dir, id, "hmr"));
    return plan.harness === null ? null : plan;
  }

  /** Lays the image down unless it is already, or joins the lay-down in flight. Never throws. */
  ready(): Promise<{ ok: true; plan: PushPlan } | { ok: false; detail: string }> {
    const plan = this.plan();
    if (plan !== null) return Promise.resolve({ ok: true, plan });
    this.#laying ??= this.#layDown().finally(() => {
      this.#laying = null;
    });
    return this.#laying;
  }

  #bodyId(): string | null {
    if (this.#id === undefined) {
      try {
        const hash = crypto.createHash("sha256").update(fs.readFileSync(this.body));
        this.#id = hash.digest("hex").slice(0, 16);
      } catch {
        this.#id = null;
      }
    }
    return this.#id;
  }

  async #layDown(): Promise<{ ok: true; plan: PushPlan } | { ok: false; detail: string }> {
    const id = this.#bodyId();
    if (id === null) {
      return { ok: false, detail: `cannot read this release's image (${this.body}).` };
    }
    const staging = path.join(this.dir, `.staging-${process.pid}-${id}`);
    try {
      await fsp.mkdir(this.dir, { recursive: true });
      let build: PushedBuild;
      try {
        build = JSON.parse(zlib.gunzipSync(await fsp.readFile(this.body)).toString("utf8"));
      } catch (err) {
        return { ok: false, detail: `this release's image is not readable: ${message(err)}` };
      }
      await fsp.rm(staging, { recursive: true, force: true });
      await writePushedBuild(path.join(staging, "hmr"), build, this.now());
      await fsp.rm(path.join(this.dir, id), { recursive: true, force: true });
      await fsp.rename(staging, path.join(this.dir, id));
      // Every other image is an older release's, or a lay-down that died with its process:
      // nothing reads either again.
      for (const name of await fsp.readdir(this.dir)) {
        if (name !== id && (IMAGE_ID.test(name) || name.startsWith(".staging-"))) {
          await fsp.rm(path.join(this.dir, name), { recursive: true, force: true }).catch(() => {});
        }
      }
      const plan = this.plan();
      return plan === null
        ? { ok: false, detail: "the image was written but cannot be read back." }
        : { ok: true, plan };
    } catch (err) {
      return { ok: false, detail: message(err) };
    } finally {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
