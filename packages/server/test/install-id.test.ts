/**
 * Install identity of a data root: `<root>/install-id`, minted at boot and served publicly
 * by `GET /api/install`.
 *
 * What the web app depends on and this pins: the id survives a restart on the same root
 * (nothing gets swept on an ordinary restart), differs on a fresh root, and comes back new
 * after the root is deleted — which is the reported bug's trigger. Plus the failure modes
 * that must NOT read as "new root": a read error that is not ENOENT, and a root the id
 * cannot be written to.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InstallResponse } from "../src/api/types.js";
import { ensureInstallId, installIdPath, readInstallId } from "../src/install-id.js";
import { createTestApp, loginAdmin, makeTempRoot } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("install id (file)", () => {
  const roots: string[] = [];
  const tempRoot = async (): Promise<string> => {
    const root = await makeTempRoot();
    roots.push(root);
    return root;
  };
  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });

  it("mints once and returns the same id on every later call (a restart sweeps nothing)", async () => {
    const root = await tempRoot();
    const first = ensureInstallId(root);
    expect(first).not.toBeNull();
    expect(ensureInstallId(root)).toBe(first);
    expect(readInstallId(root)).toBe(first);
  });

  it("two roots never share an id", async () => {
    expect(ensureInstallId(await tempRoot())).not.toBe(ensureInstallId(await tempRoot()));
  });

  it("deleting the root mints a new id — the wipe the browser has to notice", async () => {
    const root = await tempRoot();
    const before = ensureInstallId(root);
    fs.rmSync(root, { recursive: true, force: true });

    const after = ensureInstallId(root);
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });

  it("creates the root directory when it does not exist yet", async () => {
    const parent = await tempRoot();
    const root = path.join(parent, "not", "created", "yet");
    expect(ensureInstallId(root)).not.toBeNull();
    expect(fs.existsSync(installIdPath(root))).toBe(true);
  });

  it("a junk id file is replaced rather than left unusable", async () => {
    const root = await tempRoot();
    const original = ensureInstallId(root);
    fs.writeFileSync(installIdPath(root), "  \n");

    const replaced = ensureInstallId(root);
    expect(replaced).not.toBeNull();
    expect(replaced).not.toBe(original);
    expect(readInstallId(root)).toBe(replaced);
  });

  it("reads only the first line, trimmed (a hand-written id is honoured as-is)", async () => {
    const root = await tempRoot();
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(installIdPath(root), "hand-written-id\ntrailing junk\n");
    expect(ensureInstallId(root)).toBe("hand-written-id");
  });

  it("a read failure that is not ENOENT is unknown, never a new root", async () => {
    const root = await tempRoot();
    // A directory where the file should be: readFileSync fails with EISDIR/EPERM, which is
    // not ENOENT. Minting here would report a new identity for a root nobody touched.
    fs.mkdirSync(installIdPath(root), { recursive: true });
    expect(ensureInstallId(root)).toBeNull();
  });

  it("a root that cannot be written is unknown, not a new id on every boot", async () => {
    const parent = await tempRoot();
    const file = path.join(parent, "a-file");
    fs.writeFileSync(file, "not a directory");
    // mkdir under a regular file fails (ENOTDIR), so the mint cannot be persisted.
    expect(ensureInstallId(path.join(file, "root"))).toBeNull();
  });

  it("readInstallId never mints", async () => {
    const root = path.join(os.tmpdir(), `penguin-install-id-absent-${process.pid}`);
    expect(readInstallId(root)).toBeNull();
    expect(fs.existsSync(installIdPath(root))).toBe(false);
  });
});

describe("GET /api/install", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("boot persists the id at <root>/install-id and the route reports it", async () => {
    const stored = readInstallId(t.root);
    expect(stored).not.toBeNull();

    const res = await t.app.request("/api/install");
    expect(res.status).toBe(200);
    expect(((await res.json()) as InstallResponse).installId).toBe(stored);
  });

  it("answers without a session — the sweep runs before anyone is signed in", async () => {
    // No cookie, no Bearer: a just-wiped root has nobody to sign in as, and the browser
    // must still be able to recognise it as a different root.
    const anonymous = await t.app.request("/api/install");
    expect(anonymous.status).toBe(200);

    const { cookie } = await loginAdmin(t.app);
    const authed = await t.app.request("/api/install", { headers: { cookie } });
    expect(((await authed.json()) as InstallResponse).installId).toBe(
      ((await anonymous.json()) as InstallResponse).installId,
    );
  });

  it("mounts in the PLATFORM, so a pushed web bundle can never outrun the route it calls", async () => {
    // A hot push carries platform + cli + web dist as ONE version and never the runtime
    // (hmr/host.ts), so the route the pushed bundle asks for has to travel with the platform.
    // Mounted in the runtime it would be missing from exactly the installations that received
    // the new web dist by push, and the platform's own auth gate would 401 a public route.
    const platform = t.deps.tree.api<{ fetch(request: Request): Promise<Response> }>(
      "HttpModule",
      "http",
    );

    const res = await platform.fetch(new Request("http://localhost/api/install"));
    expect(res.status).toBe(200);
    expect(((await res.json()) as InstallResponse).installId).toBe(readInstallId(t.root));
  });

  it("hands overlapping callers on a fresh root the same id", async () => {
    // Both requests are in flight before either resolves. A second, different id here would
    // sweep the browser's UI state on a page load that changed nothing. Two SERVER PROCESSES
    // cannot reach this: the root is locked (lock.ts) before either would mint.
    fs.rmSync(installIdPath(t.root), { force: true });

    const [first, second] = await Promise.all([
      t.app.request("/api/install"),
      t.app.request("/api/install"),
    ]);
    const idA = ((await first.json()) as InstallResponse).installId;
    const idB = ((await second.json()) as InstallResponse).installId;

    expect(idA).not.toBeNull();
    expect(idB).toBe(idA);
    expect(readInstallId(t.root)).toBe(idA);
  });

  it("follows the file: a root deleted under a running server reports a new id", async () => {
    const before = readInstallId(t.root);
    fs.rmSync(installIdPath(t.root), { force: true });

    const res = await t.app.request("/api/install");
    const after = ((await res.json()) as InstallResponse).installId;
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });
});
