/**
 * agent-desktop, installed by the plugin from the npm registry. The registry is the one fake
 * (fetch); the files are real, in a temp data root.
 *
 * - Given the pinned tarball, the install fetches it from the configured registry, keeps only this
 *   machine's program and helper under their plain names — private, one link each — and records
 *   what it installed, which reads back as installed.
 * - Given a tarball that does not match the pinned integrity, nothing is written and an install
 *   already there is left as it was.
 * - Given a program inside the tarball that does not match its pinned digest, it is not used.
 * - Given a machine the pin has no program for, nothing is fetched and the answer says so.
 * - Given an install whose program was changed on disk, it no longer reads as installed; given
 *   one another user could write to, its mode is put right.
 * - Given a directory above the helper that others can write, it is named (macOS refuses the
 *   helper below it).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  installAgentDesktop,
  installDirOf,
  readInstalled,
  tarballUrl,
  unsafeAncestor,
  UnsupportedPlatformError,
} from "../src/install.js";
import type { AgentDesktopPin } from "../src/pin.js";
import { sha256, sha512, tarGz, tempDir } from "./helpers.js";

const posix = process.platform !== "win32";

const PROGRAM = Buffer.from("linux program bytes");
const HELPER = Buffer.from("linux helper bytes");
const OTHER = Buffer.from("windows program bytes");

function fixture(overrides: { program?: Buffer } = {}) {
  const tarball = tarGz([
    { path: "package/package.json", data: Buffer.from('{"name":"agent-desktop"}'), mode: 0o644 },
    { path: "package/bin/agent-desktop-linux-x64", data: overrides.program ?? PROGRAM },
    {
      path: "package/bin/agent-desktop-linux-clipboard-owner-linux-x64",
      data: HELPER,
      mode: 0o775,
    },
    { path: "package/bin/agent-desktop-win32-x64.exe", data: OTHER },
  ]);
  const pin: AgentDesktopPin = {
    name: "agent-desktop",
    version: "9.9.9",
    integrity: sha512(tarball),
    size: tarball.length,
    targets: {
      "linux-x64": {
        program: {
          entry: "package/bin/agent-desktop-linux-x64",
          sha256: sha256(PROGRAM),
          name: "agent-desktop",
        },
        helper: {
          entry: "package/bin/agent-desktop-linux-clipboard-owner-linux-x64",
          sha256: sha256(HELPER),
          name: "agent-desktop-linux-clipboard-owner",
        },
      },
      "win32-x64": {
        program: {
          entry: "package/bin/agent-desktop-win32-x64.exe",
          sha256: sha256(OTHER),
          name: "agent-desktop.exe",
        },
      },
    },
  };
  return { tarball, pin };
}

/** The registry: answers the tarball at its npm path, records what was asked. */
function registry(tarball: Buffer) {
  const asked: string[] = [];
  const fetchFake = (async (input: string | URL | Request) => {
    const url = String(input);
    asked.push(url);
    if (!url.endsWith(".tgz")) return new Response("not found", { status: 404 });
    return new Response(new Uint8Array(tarball), {
      status: 200,
      headers: { "content-length": String(tarball.length) },
    });
  }) as typeof fetch;
  return { fetch: fetchFake, asked };
}

const linux = { platform: "linux" as const, arch: "x64" };

describe("installing agent-desktop", () => {
  it("fetches the pinned tarball from the registry and keeps only this machine's program and helper", async () => {
    const root = await tempDir();
    const { tarball, pin } = fixture();
    const reg = registry(tarball);
    const progress: string[] = [];
    const installed = await installAgentDesktop({
      root,
      registry: "https://registry.npmmirror.com/",
      fetch: reg.fetch,
      pin,
      ...linux,
      progress: (p) => progress.push(p.step),
    });
    expect(reg.asked).toEqual([tarballUrl("https://registry.npmmirror.com", pin)]);
    expect(reg.asked[0]).toBe(
      "https://registry.npmmirror.com/agent-desktop/-/agent-desktop-9.9.9.tgz",
    );
    const dir = installDirOf(root, pin);
    expect(installed).toMatchObject({
      version: "9.9.9",
      target: "linux-x64",
      program: path.join(dir, "agent-desktop"),
      helper: path.join(dir, "agent-desktop-linux-clipboard-owner"),
    });
    expect((await fs.readdir(dir)).sort()).toEqual([
      "agent-desktop",
      "agent-desktop-linux-clipboard-owner",
      "install.json",
    ]);
    expect(await fs.readFile(installed.program)).toEqual(PROGRAM);
    if (posix) {
      for (const file of [installed.program, installed.helper!]) {
        const st = await fs.stat(file);
        expect(st.mode & 0o777, file).toBe(0o755);
        expect(st.nlink).toBe(1);
      }
    }
    expect(progress).toContain("download");
    expect(progress.at(-1)).toBe("extract");
    expect(await readInstalled(root, { pin, ...linux })).toEqual(installed);
  });

  it("writes nothing for a tarball that does not match the pinned integrity", async () => {
    const root = await tempDir();
    const { tarball, pin } = fixture();
    await installAgentDesktop({
      root,
      registry: "https://r.example",
      fetch: registry(tarball).fetch,
      pin,
      ...linux,
    });
    const tampered = fixture({ program: Buffer.from("something else") }).tarball;
    await expect(
      installAgentDesktop({
        root,
        registry: "https://r.example",
        fetch: registry(tampered).fetch,
        pin,
        ...linux,
      }),
    ).rejects.toThrow(/does not match the pinned integrity/);
    // The install that was there still checks.
    expect(await readInstalled(root, { pin, ...linux })).not.toBeNull();
  });

  it("does not use a program whose digest is not the pinned one", async () => {
    const root = await tempDir();
    const { tarball, pin } = fixture({ program: Buffer.from("swapped program") });
    await expect(
      installAgentDesktop({
        root,
        registry: "https://r.example",
        fetch: registry(tarball).fetch,
        pin,
        ...linux,
      }),
    ).rejects.toThrow(/does not match its pinned sha256/);
    expect(await readInstalled(root, { pin, ...linux })).toBeNull();
  });

  it("fetches nothing for a machine the pin has no program for", async () => {
    const root = await tempDir();
    const { tarball, pin } = fixture();
    const reg = registry(tarball);
    await expect(
      installAgentDesktop({
        root,
        registry: "https://r.example",
        fetch: reg.fetch,
        pin,
        platform: "freebsd",
        arch: "x64",
      }),
    ).rejects.toBeInstanceOf(UnsupportedPlatformError);
    expect(reg.asked).toEqual([]);
  });

  it("an answer other than the tarball is a failure that names the address", async () => {
    const root = await tempDir();
    const { pin } = fixture();
    const missing = (async () => new Response("gone", { status: 404 })) as typeof fetch;
    await expect(
      installAgentDesktop({ root, registry: "https://r.example", fetch: missing, pin, ...linux }),
    ).rejects.toThrow(/r\.example.*answered 404/);
  });
});

describe("installing over an install", () => {
  it("replaces it whole and leaves no staging or old directory behind", async () => {
    const root = await tempDir();
    const { tarball, pin } = fixture();
    const opts = {
      root,
      registry: "https://r.example",
      fetch: registry(tarball).fetch,
      pin,
      ...linux,
    };
    await installAgentDesktop(opts);
    // What an install interrupted earlier would have left beside it.
    const dir = installDirOf(root, pin);
    await fs.mkdir(`${dir}.staging-dead1234`);
    await fs.mkdir(`${dir}.old-dead1234`);
    await installAgentDesktop(opts);
    expect((await fs.readdir(path.dirname(dir))).sort()).toEqual([path.basename(dir)]);
    expect(await readInstalled(root, { pin, ...linux })).not.toBeNull();
  });
});

describe("what is installed, read back", () => {
  it("is not an install once its program changed on disk", async () => {
    const root = await tempDir();
    const { tarball, pin } = fixture();
    const installed = await installAgentDesktop({
      root,
      registry: "https://r.example",
      fetch: registry(tarball).fetch,
      pin,
      ...linux,
    });
    await fs.writeFile(installed.program, "patched");
    expect(await readInstalled(root, { pin, ...linux })).toBeNull();
  });

  it.runIf(posix)("puts a mode another user could write through right", async () => {
    const root = await tempDir();
    const { tarball, pin } = fixture();
    const installed = await installAgentDesktop({
      root,
      registry: "https://r.example",
      fetch: registry(tarball).fetch,
      pin,
      ...linux,
    });
    await fs.chmod(installed.helper!, 0o775);
    expect(await readInstalled(root, { pin, ...linux })).not.toBeNull();
    expect((await fs.stat(installed.helper!)).mode & 0o777).toBe(0o755);
  });

  it.runIf(posix)("names a directory above the helper that others can write", async () => {
    const root = await tempDir();
    const shared = path.join(root, "shared");
    await fs.mkdir(path.join(shared, "inner"), { recursive: true });
    await fs.chmod(path.join(shared, "inner"), 0o755);
    await fs.chmod(shared, 0o777);
    expect(await unsafeAncestor(path.join(shared, "inner"))).toBe(shared);
    await fs.chmod(shared, 0o755);
  });
});
