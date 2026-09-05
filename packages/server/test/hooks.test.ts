/**
 * Integration tests for the hook package routes: the installed list carrying the switch, the
 * owner-only PATCH that writes `enabled: false` into hooks.json (and removes it again, and
 * survives a library reinstall), the zip archive install (layouts, manifest validation,
 * zip-slip, 409 hook_exists + overwrite) and the byte-identical export round-trip.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hooksDir } from "@prismshadow/penguin-core";
import type { AgentHooksResponse, HookItem, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("hooks api", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  const base = (agentId: string) => `/api/projects/${projectId}/agents/${agentId}/hooks`;
  const plugins = (agentId: string) => `/api/projects/${projectId}/agents/${agentId}/plugins`;
  const manifestFile = (agentId: string, name: string) =>
    path.join(hooksDir(t.root, projectId, agentId), name, "hooks.json");

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_h");
    const b = await provisionUser(t.app, "member_h");
    const c = await provisionUser(t.app, "outsider_h");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_h-hooks", name: "hooks project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_h" })).status,
    ).toBe(201);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  /** Creates a plain Agent with no plugins preinstalled. */
  async function createPlainAgent(agentId: string): Promise<void> {
    const res = await owner.post(`/api/projects/${projectId}/agents`, { agentId });
    expect(res.status).toBe(201);
  }

  /** A canonical manifest, in the field order the installer writes, so an upload of it re-exports byte-identically. */
  const MANIFEST = {
    name: "zip-hook",
    description: "Zip demo hook",
    description_zh: "示例钩子",
    version: "2026-09-02.1",
    stop: [{ command: "stop.mjs", timeout: 5 }],
    pre_tool_use: [],
    user_prompt: [],
  };
  const STOP_MJS = "process.stdout.write('{}');\n";
  const manifestText = (manifest: unknown): string => `${JSON.stringify(manifest, null, 2)}\n`;
  /** Builds an in-memory zip and returns it base64-encoded (the request wire format). */
  const zipB64 = (files: Record<string, Uint8Array>): string =>
    Buffer.from(zipSync(files)).toString("base64");
  /** A package under one top-level directory: the manifest plus its one script. */
  const packageFiles = (
    dir = "zip-hook",
    manifest: unknown = MANIFEST,
  ): Record<string, Uint8Array> => ({
    [`${dir}/hooks.json`]: strToU8(manifestText(manifest)),
    [`${dir}/stop.mjs`]: strToU8(STOP_MJS),
  });
  /**
   * Rewrites one entry's declared uncompressed size in both the local and the central header
   * (fflate reads the central one) and reports that record's compression method. No zip writer
   * produces this; a hand-rolled archive does, and the declared size is what unzipSync
   * allocates — but only on the deflate path: a stored entry (method 0) is sliced at its
   * compressed size and never reads the declared one, so a fixture that stored its payload
   * would reproduce nothing. The caller asserts the method for that reason.
   */
  const declareSize = (
    zip: Uint8Array,
    entry: string,
    declared: number,
  ): { zip: Uint8Array; method: number } => {
    const want = strToU8(entry);
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const nameAt = (off: number): boolean => want.every((b, k) => zip[off + k] === b);
    let method = -1;
    for (let i = 0; i + 46 <= zip.length; i++) {
      const sig = dv.getUint32(i, true);
      // Local file header: method at +8, uncompressed size at +22, name length at +26, name at +30.
      if (sig === 0x04034b50 && dv.getUint16(i + 26, true) === want.length && nameAt(i + 30)) {
        dv.setUint32(i + 22, declared, true);
      }
      // Central directory header: method at +10, uncompressed size at +24, name length at +28, name at +46.
      if (sig === 0x02014b50 && dv.getUint16(i + 28, true) === want.length && nameAt(i + 46)) {
        method = dv.getUint16(i + 10, true);
        dv.setUint32(i + 24, declared, true);
      }
    }
    return { zip, method };
  };

  it("lists installed packages with the switch on; PATCH is the owner's and writes enabled into hooks.json", async () => {
    await createPlainAgent("sw_agent");
    expect((await member.post(plugins("sw_agent"), { names: ["goal"] })).status).toBe(201);
    const list = (await (await member.get(base("sw_agent"))).json()) as AgentHooksResponse;
    expect(list.hooks.map((h) => [h.name, h.enabled, h.events])).toEqual([
      ["goal", true, ["user_prompt", "stop"]],
    ]);

    // Members read the state but cannot flip it; an outsider never sees the Project.
    expect((await member.patch(`${base("sw_agent")}/goal`, { enabled: false })).status).toBe(403);
    expect((await outsider.patch(`${base("sw_agent")}/goal`, { enabled: false })).status).toBe(404);
    // The body must carry a boolean; a package that is not installed is 404.
    expect((await owner.patch(`${base("sw_agent")}/goal`, {})).status).toBe(400);
    expect((await owner.patch(`${base("sw_agent")}/goal`, { enabled: "no" })).status).toBe(400);
    expect((await owner.patch(`${base("sw_agent")}/nope`, { enabled: false })).status).toBe(404);

    const off = await owner.patch(`${base("sw_agent")}/goal`, { enabled: false });
    expect(off.status).toBe(200);
    expect((await off.json()) as HookItem).toMatchObject({ name: "goal", enabled: false });
    const file = manifestFile("sw_agent", "goal");
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toMatchObject({ enabled: false });
    const after = (await (await member.get(base("sw_agent"))).json()) as AgentHooksResponse;
    expect(after.hooks[0]!.enabled).toBe(false);

    // A library reinstall (an update) replaces the content and keeps the switch off.
    expect((await member.post(plugins("sw_agent"), { names: ["goal"] })).status).toBe(201);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toMatchObject({ enabled: false });

    // Switching back on removes the field: the manifest reads as the installer wrote it.
    const on = await owner.patch(`${base("sw_agent")}/goal`, { enabled: true });
    expect(on.status).toBe(200);
    expect(((await on.json()) as HookItem).enabled).toBe(true);
    expect("enabled" in JSON.parse(await fs.readFile(file, "utf8"))).toBe(false);
  });

  it("archive: the single-top-dir layout installs under the directory name, the root layout under the manifest's; uninstall works on it", async () => {
    await createPlainAgent("zip_agent");
    const url = `${base("zip_agent")}/archive`;
    // The manifest says zip-hook, but the top-level directory is dir-hook: the directory
    // name is the identity (the rule listInstalledHooks applies), and the written manifest
    // says so too. The explicit directory entry ("dir-hook/") is ignored, not read as a file.
    const res = await member.post(url, {
      dataBase64: zipB64({
        "dir-hook/": new Uint8Array(0),
        ...packageFiles("dir-hook"),
        "dir-hook/lib/util.mjs": strToU8("export const x = 1;\n"),
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AgentHooksResponse;
    expect(body.hooks.map((h) => [h.name, h.version, h.events, h.enabled])).toEqual([
      ["dir-hook", "2026-09-02.1", ["stop"], true],
    ]);
    expect(body.hooks[0]!.descriptionZh).toBe("示例钩子");
    const dir = path.join(hooksDir(t.root, projectId, "zip_agent"), "dir-hook");
    expect(JSON.parse(await fs.readFile(path.join(dir, "hooks.json"), "utf8"))).toMatchObject({
      name: "dir-hook",
      stop: [{ command: "stop.mjs", timeout: 5 }],
    });
    expect(await fs.readFile(path.join(dir, "stop.mjs"), "utf8")).toBe(STOP_MJS);
    expect(await fs.readFile(path.join(dir, "lib", "util.mjs"), "utf8")).toBe(
      "export const x = 1;\n",
    );

    // Root layout: the name comes from the manifest; the point lists it omits are written
    // as empty arrays, so the loader and the Session always find arrays.
    const root = await member.post(url, {
      dataBase64: zipB64({
        "hooks.json": strToU8(
          manifestText({
            name: "root-hook",
            version: "2026-09-02.2",
            user_prompt: [{ command: "expand.mjs" }],
          }),
        ),
        "expand.mjs": strToU8(STOP_MJS),
      }),
    });
    expect(root.status).toBe(201);
    const both = (await root.json()) as AgentHooksResponse;
    expect(both.hooks.map((h) => h.name)).toEqual(["dir-hook", "root-hook"]);
    expect(both.hooks[1]).toMatchObject({ description: "", events: ["user_prompt"] });
    expect(JSON.parse(await fs.readFile(manifestFile("zip_agent", "root-hook"), "utf8"))).toEqual({
      name: "root-hook",
      version: "2026-09-02.2",
      user_prompt: [{ command: "expand.mjs" }],
      description: "",
      stop: [],
      pre_tool_use: [],
    });

    // Uninstall goes through the same DELETE as library packages: 204, directory gone.
    expect((await member.delete(`${base("zip_agent")}/root-hook`)).status).toBe(204);
    await expect(
      fs.access(path.join(hooksDir(t.root, projectId, "zip_agent"), "root-hook")),
    ).rejects.toThrow();
    // Outsiders never reach the archive routes.
    expect((await outsider.post(url, { dataBase64: "AAAA" })).status).toBe(404);
    expect((await outsider.get(`${base("zip_agent")}/dir-hook/archive`)).status).toBe(404);
  });

  it("archive: manifest validation rejects what the loader and the Session could not run, writing nothing", async () => {
    await createPlainAgent("zip_manifest_agent");
    const url = `${base("zip_manifest_agent")}/archive`;
    const cases: Array<[string, Record<string, Uint8Array>]> = [
      ["not JSON", { "h/hooks.json": strToU8("{"), "h/stop.mjs": strToU8(STOP_MJS) }],
      ["an array", { "h/hooks.json": strToU8("[]"), "h/stop.mjs": strToU8(STOP_MJS) }],
      [
        "an invalid name (root layout)",
        {
          "hooks.json": strToU8(manifestText({ ...MANIFEST, name: "bad name!" })),
          "stop.mjs": strToU8(STOP_MJS),
        },
      ],
      [
        "an invalid directory name",
        {
          "bad name!/hooks.json": strToU8(manifestText(MANIFEST)),
          "bad name!/stop.mjs": strToU8(STOP_MJS),
        },
      ],
      [
        "a command missing from the archive",
        packageFiles("h", { ...MANIFEST, stop: [{ command: "missing.mjs" }] }),
      ],
      [
        "a command pointing outside the package",
        { ...packageFiles("h", { ...MANIFEST, stop: [{ command: "../stop.mjs" }] }) },
      ],
      ["an absolute command", packageFiles("h", { ...MANIFEST, stop: [{ command: "/stop.mjs" }] })],
      ["a non-object command", packageFiles("h", { ...MANIFEST, stop: ["stop.mjs"] })],
      ["a non-array point list", packageFiles("h", { ...MANIFEST, stop: { command: "stop.mjs" } })],
      [
        "a non-positive timeout",
        packageFiles("h", { ...MANIFEST, stop: [{ command: "stop.mjs", timeout: 0 }] }),
      ],
      ["no commands at all", packageFiles("h", { ...MANIFEST, stop: [] })],
      ["a non-boolean enabled", packageFiles("h", { ...MANIFEST, enabled: "yes" })],
      ["a non-string description", packageFiles("h", { ...MANIFEST, description: 1 })],
    ];
    for (const [label, files] of cases) {
      const res = await member.post(url, { dataBase64: zipB64(files) });
      expect(res.status, label).toBe(400);
    }
    const list = (await (
      await member.get(base("zip_manifest_agent"))
    ).json()) as AgentHooksResponse;
    expect(list.hooks).toEqual([]);
  });

  it("archive: zip-slip entry paths and malformed bodies are rejected with 400, nothing written", async () => {
    await createPlainAgent("zip_shape_agent");
    const url = `${base("zip_shape_agent")}/archive`;
    for (const entry of ["../evil.mjs", "/abs/hooks.json", "C:/x/hooks.json", "h\\hooks.json"]) {
      const res = await member.post(url, {
        dataBase64: zipB64({ ...packageFiles("h"), [entry]: strToU8("x") }),
      });
      expect(res.status, entry).toBe(400);
    }
    // Not base64 / not a zip / empty / no manifest / two top-level directories.
    expect((await member.post(url, { dataBase64: "" })).status).toBe(400);
    expect((await member.post(url, { dataBase64: "AAAA" })).status).toBe(400);
    expect((await member.post(url, { dataBase64: zipB64({}) })).status).toBe(400);
    expect(
      (await member.post(url, { dataBase64: zipB64({ "h/stop.mjs": strToU8(STOP_MJS) }) })).status,
    ).toBe(400);
    expect(
      (
        await member.post(url, {
          dataBase64: zipB64({ ...packageFiles("a"), ...packageFiles("b") }),
        })
      ).status,
    ).toBe(400);
    // A file entry named exactly like the single top level: its relative path would be empty,
    // and writing it would land on the staging directory itself.
    expect(
      (await member.post(url, { dataBase64: zipB64({ ...packageFiles("h"), h: strToU8("x") }) }))
        .status,
    ).toBe(400);
    await expect(fs.readdir(hooksDir(t.root, projectId, "zip_shape_agent"))).resolves.toEqual([]);
  });

  it("archive: an entry over the per-file cap is refused however small the archive is", async () => {
    await createPlainAgent("zip_bomb_agent");
    const url = `${base("zip_bomb_agent")}/archive`;
    // 8MB of zeros deflate to a few KB, so the request caps never see it coming: the only
    // thing between this upload and 8MB of heap is where the per-file cap is applied.
    const zip = zipSync({ ...packageFiles("h"), "h/pad.bin": new Uint8Array(8 * 1024 * 1024) });
    expect(zip.byteLength).toBeLessThan(64 * 1024);
    const res = await member.post(url, { dataBase64: Buffer.from(zip).toString("base64") });
    expect(res.status).toBe(400);
    // Naming the entry pins the refusal to the per-file declared-size branch, rather than to
    // some total measured later; the sub-64KB archive is the proof nothing post-inflation
    // could have done it without first putting the 8MB on the heap.
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      "5MB uncompressed limit: h/pad.bin",
    );
    await expect(fs.readdir(hooksDir(t.root, projectId, "zip_bomb_agent"))).resolves.toEqual([]);
  });

  it("archive: an entry that lies about its uncompressed size is refused, not installed", async () => {
    await createPlainAgent("zip_lie_agent");
    const url = `${base("zip_lie_agent")}/archive`;
    // The other half of the bomb, and the one a cap on the inflated bytes cannot see at all:
    // unzipSync allocates the DECLARED size and inflates into it, then hands back a view of
    // the real length. So a sub-kilobyte archive whose 5-byte entry declares 512MB takes
    // 512MB of heap and returns 5 bytes — a check on the returned bytes reads 5 and installs
    // the package (pre-fix this route answered 201 here).
    const { zip, method } = declareSize(
      zipSync({ ...packageFiles("h"), "h/pad.bin": strToU8("hello") }),
      "h/pad.bin",
      512 * 1024 * 1024,
    );
    // Deflate, not stored: a stored entry is sliced at its compressed size and never reads
    // the declared one, which would make this fixture prove nothing.
    expect(method).toBe(8);
    expect(zip.byteLength).toBeLessThan(1024);
    const res = await member.post(url, { dataBase64: Buffer.from(zip).toString("base64") });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain(
      "5MB uncompressed limit: h/pad.bin",
    );
    await expect(fs.readdir(hooksDir(t.root, projectId, "zip_lie_agent"))).resolves.toEqual([]);
  });

  it("archive: already installed is 409 hook_exists; overwrite replaces the directory (stale files removed)", async () => {
    await createPlainAgent("zip_over_agent");
    const url = `${base("zip_over_agent")}/archive`;
    const first = await member.post(url, {
      dataBase64: zipB64({ ...packageFiles(), "zip-hook/old.txt": strToU8("old\n") }),
    });
    expect(first.status).toBe(201);

    // Same name again without overwrite: 409 with the name at the end of the message (the
    // web tab reads it from there for the overwrite confirmation copy).
    const again = await member.post(url, { dataBase64: zipB64(packageFiles()) });
    expect(again.status).toBe(409);
    const err = (await again.json()) as { error: { code: string; message: string } };
    expect(err.error.code).toBe("hook_exists");
    expect(err.error.message).toMatch(/: zip-hook$/);

    // overwrite: true replaces the whole directory: old.txt is gone, new.txt appears.
    const res = await member.post(url, {
      dataBase64: zipB64({
        ...packageFiles("zip-hook", { ...MANIFEST, version: "2026-09-02.3" }),
        "zip-hook/new.txt": strToU8("new\n"),
      }),
      overwrite: true,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as AgentHooksResponse;
    expect(body.hooks.find((h) => h.name === "zip-hook")!.version).toBe("2026-09-02.3");
    const dir = path.join(hooksDir(t.root, projectId, "zip_over_agent"), "zip-hook");
    expect(await fs.readFile(path.join(dir, "new.txt"), "utf8")).toBe("new\n");
    await expect(fs.access(path.join(dir, "old.txt"))).rejects.toThrow();
  });

  it("archive export: single-top-dir zip round-trips byte-identically, the switch travels with it; a non-installed name is 404", async () => {
    await createPlainAgent("zip_export_agent");
    const url = base("zip_export_agent");
    const files: Record<string, Uint8Array> = {
      ...packageFiles(),
      "zip-hook/icon.svg": strToU8('<svg viewBox="0 0 24 24"><path d="M2 2h20"/></svg>\n'),
      "zip-hook/lib/util.mjs": strToU8("export const x = 1;\n"),
    };
    expect((await member.post(`${url}/archive`, { dataBase64: zipB64(files) })).status).toBe(201);

    // A direct binary attachment (application/zip); the manifest's version names the file.
    const res = await member.get(`${url}/zip-hook/archive`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''zip-hook-v2026-09-02.1.zip",
    );
    const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
    const fileNames = Object.keys(entries).filter((n) => !n.endsWith("/"));
    expect(fileNames.sort()).toEqual(Object.keys(files).sort());
    for (const [name, data] of Object.entries(files)) {
      expect(Buffer.from(entries[name]!), name).toEqual(Buffer.from(data));
    }

    // Switched off, the package exports with `enabled: false` and re-imports switched off.
    expect((await owner.patch(`${url}/zip-hook`, { enabled: false })).status).toBe(200);
    const off = await member.get(`${url}/zip-hook/archive`);
    const offEntries = unzipSync(new Uint8Array(await off.arrayBuffer()));
    expect(
      JSON.parse(Buffer.from(offEntries["zip-hook/hooks.json"]!).toString("utf8")),
    ).toMatchObject({
      enabled: false,
    });
    await createPlainAgent("zip_import_agent");
    const moved = await member.post(`${base("zip_import_agent")}/archive`, {
      dataBase64: Buffer.from(
        await (await member.get(`${url}/zip-hook/archive`)).arrayBuffer(),
      ).toString("base64"),
    });
    expect(moved.status).toBe(201);
    expect(((await moved.json()) as AgentHooksResponse).hooks).toMatchObject([
      { name: "zip-hook", enabled: false },
    ]);

    // Not installed → 404 (the same criterion as uninstall); no real version → bare filename.
    expect((await member.get(`${url}/no-such-hook/archive`)).status).toBe(404);
    expect(
      (
        await member.post(`${url}/archive`, {
          dataBase64: zipB64(packageFiles("nover-hook", { ...MANIFEST, version: "v1" })),
        })
      ).status,
    ).toBe(201);
    const plain = await member.get(`${url}/nover-hook/archive`);
    expect(plain.status).toBe(200);
    expect(plain.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''nover-hook.zip",
    );
  });
});
