/**
 * The plugin directory routes — local upload, remote download, the directory listing, export
 * and delete — and the two pure readers behind them (the archive parser and the URL reader).
 *
 * Two things are the point here. First, what an import must refuse: an archive with no plugin
 * in it, one carrying two, an entry path that would land outside the plugin directory, and a
 * name the build already ships (which the loader would go on serving). Second, who may do it:
 * the user plugin directory is installation-level — every Project reads it and its hook scripts
 * run with the server's rights — so these routes are the admin's, like installing to a machine,
 * not a Project owner's.
 *
 * The tests pin PENGUIN_HOME at the app's temp root, because that is the production invariant
 * being relied on: the server's data root and the library's plugin root are one directory.
 */
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PluginDirectoryResponse,
  PluginImportResponse,
  PluginLibraryResponse,
} from "../src/api/types.js";
import { parsePluginArchive } from "../src/http/routes/plugins.js";
import { isBlockedHost, normalizePluginUrl } from "../src/services/plugin-download.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A minimal valid plugin: manifest, icon and one skill (the loader requires the SKILL.md frontmatter name). */
function pluginFiles(version = "2026.09.01.1"): Record<string, string> {
  return {
    "plugin.json": `${JSON.stringify(
      {
        description: "A plugin that arrived from outside the build.",
        short_description: "Imported plugin.",
        version,
        category: "software-development",
      },
      null,
      2,
    )}\n`,
    "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n',
    "skills/imported-skill/SKILL.md":
      "---\nname: imported-skill\ndescription: A skill the plugin ships.\n---\n\nBody.\n",
  };
}

function zip(files: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {};
  for (const [rel, text] of Object.entries(files)) entries[rel] = strToU8(text);
  return Buffer.from(zipSync(entries));
}

const readErrorCode = async (res: Response): Promise<string> =>
  ((await res.json()) as { error: { code: string } }).error.code;

describe("parsePluginArchive", () => {
  it("takes the archive's own directory as the plugin root and its name", () => {
    const inner: Record<string, string> = {};
    for (const [rel, text] of Object.entries(pluginFiles())) inner[`imported/${rel}`] = text;
    const parsed = parsePluginArchive(zip(inner));
    expect(parsed.name).toBe("imported");
    expect(Object.keys(parsed.files).sort()).toEqual([
      "icon.svg",
      "plugin.json",
      "skills/imported-skill/SKILL.md",
    ]);
  });

  it("needs a name when plugin.json sits at the archive root, and takes the one it is given", () => {
    expect(() => parsePluginArchive(zip(pluginFiles()))).toThrow(/name is required/);
    const parsed = parsePluginArchive(zip(pluginFiles()), { name: "named-by-request" });
    expect(parsed.name).toBe("named-by-request");
  });

  it("locates the plugin under the subdirectory a tree URL names, ignoring the host's wrapper directory", () => {
    // The shape a GitHub tree archive has: everything wrapped in `<repo>-<ref>/`, with the
    // plugin (and other plugins, and everything else) below it.
    const inner: Record<string, string> = {};
    for (const [rel, text] of Object.entries(pluginFiles())) {
      inner[`penguin-harness-local/plugins/imported/${rel}`] = text;
    }
    for (const [rel, text] of Object.entries(pluginFiles())) {
      inner[`penguin-harness-local/plugins/other/${rel}`] = text;
    }
    const parsed = parsePluginArchive(zip(inner), { subdir: "plugins/imported" });
    expect(parsed.name).toBe("imported");
    expect(Object.keys(parsed.files).sort()).toEqual([
      "icon.svg",
      "plugin.json",
      "skills/imported-skill/SKILL.md",
    ]);
  });

  it("reads one plugin out of a repository archive, without the repository's own limits applying", () => {
    // A checkout is not a plugin: 400 unrelated files around a 3-file plugin must neither fail
    // the 200-file cap nor be inflated — the caps bound the plugin that comes out (`wanted`).
    const inner: Record<string, string> = {};
    for (const [rel, text] of Object.entries(pluginFiles())) {
      inner[`penguin-harness-main/plugins/wanted/${rel}`] = text;
    }
    for (let i = 0; i < 400; i += 1) {
      inner[`penguin-harness-main/docs/page-${i}.md`] = `# page ${i}\n`;
    }
    const parsed = parsePluginArchive(zip(inner), { subdir: "plugins/wanted" });
    expect(parsed.name).toBe("wanted");
    expect(Object.keys(parsed.files).sort()).toEqual([
      "icon.svg",
      "plugin.json",
      "skills/imported-skill/SKILL.md",
    ]);
    // The same archive read as a whole still refuses: two directories carry plugin.json only
    // in the plugin case above, so here it is the plugin's own file count that has to fail.
    const crowded: Record<string, string> = {};
    for (const [rel, text] of Object.entries(pluginFiles())) crowded[`crowded/${rel}`] = text;
    for (let i = 0; i < 200; i += 1) {
      crowded[`crowded/skills/extra-${i}/SKILL.md`] =
        `---\nname: extra-${i}\ndescription: Filler.\n---\n`;
    }
    expect(() => parsePluginArchive(zip(crowded))).toThrow(/200-file limit/);
  });

  it("refuses an archive that carries two plugins side by side", () => {
    const inner: Record<string, string> = {};
    for (const [rel, text] of Object.entries(pluginFiles())) {
      inner[`one/${rel}`] = text;
      inner[`two/${rel}`] = text;
    }
    expect(() => parsePluginArchive(zip(inner))).toThrow(/more than one plugin/);
  });

  it("refuses an archive with no plugin, an empty archive, and a zip-slip entry path", () => {
    expect(() => parsePluginArchive(zip({ "readme.md": "nothing here" }))).toThrow(
      /no plugin.json/,
    );
    expect(() => parsePluginArchive(zip({}))).toThrow(/no files/);
    const escaping = { ...pluginFiles(), "../outside.txt": "not inside" };
    expect(() => parsePluginArchive(zip({ ...escaping }))).toThrow(/Invalid zip entry path/);
  });

  it("refuses bytes that are not a zip at all", () => {
    expect(() => parsePluginArchive(Buffer.from("not a zip"))).toThrow(/not a valid zip/);
  });

  it("refuses a plugin name the loader would never accept", () => {
    const inner: Record<string, string> = {};
    for (const [rel, text] of Object.entries(pluginFiles())) inner[`../evil/${rel}`] = text;
    // The entry path is checked first (zip-slip) — a name check is what the request's own
    // `name` field goes through.
    expect(() => parsePluginArchive(zip(pluginFiles()), { name: "../evil" })).toThrow(
      /Not a valid plugin name/,
    );
  });
});

describe("normalizePluginUrl", () => {
  it("turns a GitHub repository page into its default-branch archive", () => {
    expect(normalizePluginUrl("https://github.com/Prism-Shadow/penguin-harness")).toEqual({
      fetchUrl: "https://github.com/Prism-Shadow/penguin-harness/archive/HEAD.zip",
      subdir: "",
      name: "penguin-harness",
    });
  });

  it("turns a GitHub tree URL into that ref's archive plus the subdirectory to look in", () => {
    expect(normalizePluginUrl("https://github.com/o/r/tree/main/plugins/humanizer")).toEqual({
      fetchUrl: "https://github.com/o/r/archive/main.zip",
      subdir: "plugins/humanizer",
      name: "humanizer",
    });
    expect(normalizePluginUrl("https://github.com/o/r/tree/v1.2.3")).toEqual({
      fetchUrl: "https://github.com/o/r/archive/v1.2.3.zip",
      subdir: "",
      name: "r",
    });
  });

  it("passes a plain download link through, suggesting a name only when it is a zip", () => {
    expect(normalizePluginUrl("https://example.com/plugins/thing.zip")).toEqual({
      fetchUrl: "https://example.com/plugins/thing.zip",
      subdir: "",
      name: "thing",
    });
    expect(normalizePluginUrl("https://example.com/download?id=7")).toEqual({
      fetchUrl: "https://example.com/download?id=7",
      subdir: "",
    });
  });

  it("refuses a protocol or a host that is the server's own network", () => {
    expect(() => normalizePluginUrl("ftp://example.com/thing.zip")).toThrow(/http\(s\)/);
    expect(() => normalizePluginUrl("not a url")).toThrow(/absolute http\(s\) URL/);
    for (const url of [
      "http://localhost:8080/thing.zip",
      "http://127.0.0.1/thing.zip",
      "http://10.0.0.5/thing.zip",
      "http://192.168.1.7/thing.zip",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/thing.zip",
      "http://box.internal/thing.zip",
    ]) {
      expect(() => normalizePluginUrl(url), url).toThrow(/local or private host/);
    }
    // The literal-host guard, stated as a table: public addresses and names pass.
    expect(isBlockedHost("github.com")).toBe(false);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
  });
});

describe("the plugin directory routes", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let prevHome: string | undefined;

  beforeEach(async () => {
    t = await createTestApp();
    prevHome = process.env.PENGUIN_HOME;
    process.env.PENGUIN_HOME = t.root;
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    member = apiClient(t.app, (await provisionUser(t.app, "plain_member")).cookie);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    if (prevHome === undefined) delete process.env.PENGUIN_HOME;
    else process.env.PENGUIN_HOME = prevHome;
    await t.cleanup();
  });

  const upload = (files: Record<string, string>, body: Record<string, unknown> = {}) =>
    admin.post("/api/plugins/upload", {
      dataBase64: zip(files).toString("base64"),
      ...body,
    });

  const libraryNames = async (client = admin): Promise<string[]> => {
    const res = await client.get("/api/plugins");
    const body = (await res.json()) as PluginLibraryResponse;
    return body.groups.flatMap((g) => g.plugins.map((p) => p.name)).sort();
  };

  it("installs an uploaded plugin into the library, lists the directory and deletes it again", async () => {
    const res = await upload(pluginFiles(), { name: "imported" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as PluginImportResponse;
    expect(body.plugin).toMatchObject({
      name: "imported",
      source: "user",
      version: "2026.09.01.1",
    });
    expect(body.path).toBe(path.join(t.root, "plugins", "imported"));
    // On disk under the data root, and in the library every other surface reads.
    expect(await libraryNames()).toContain("imported");
    const dir = (await (
      await admin.get("/api/plugins/directory")
    ).json()) as PluginDirectoryResponse;
    expect(dir).toEqual({ path: path.join(t.root, "plugins"), plugins: ["imported"] });
    const files = (await (await admin.get("/api/plugins/imported/files")).json()) as {
      files: Record<string, string>;
    };
    expect(Object.keys(files.files)).toContain("skills/imported-skill/SKILL.md");

    expect((await admin.delete("/api/plugins/imported")).status).toBe(204);
    expect(await libraryNames()).not.toContain("imported");
    // Gone from disk too — the delete is the directory, not a tombstone.
    expect((await admin.get("/api/plugins/imported/files")).status).toBe(404);
    expect((await admin.delete("/api/plugins/imported")).status).toBe(404);
  });

  it("answers one code for an archive past the cap, uploaded or downloaded alike", async () => {
    const res = await admin.post("/api/plugins/upload", {
      dataBase64: Buffer.alloc(15 * 1024 * 1024).toString("base64"),
      name: "oversize",
    });
    expect(res.status).toBe(413);
    expect(await readErrorCode(res)).toBe("plugin_too_large");
    // Nothing was written on the way to the refusal.
    const dir = (await (
      await admin.get("/api/plugins/directory")
    ).json()) as PluginDirectoryResponse;
    expect(dir.plugins).toEqual([]);
  });

  it("keeps the import to admins", async () => {
    const res = await upload(pluginFiles(), { name: "imported" });
    expect(res.status).toBe(201);
    expect(
      (
        await member.post("/api/plugins/upload", {
          dataBase64: zip(pluginFiles()).toString("base64"),
          name: "by-member",
        })
      ).status,
    ).toBe(403);
    expect((await member.delete("/api/plugins/imported")).status).toBe(403);
    // Reading stays open: the library listing and the directory line are not an admin's screen.
    expect((await member.get("/api/plugins")).status).toBe(200);
    expect((await member.get("/api/plugins/directory")).status).toBe(200);
  });

  it("refuses a name the build already ships, and asks before overwriting a user plugin", async () => {
    const builtin = await upload(pluginFiles(), { name: "goal" });
    expect(builtin.status).toBe(409);
    expect(await readErrorCode(builtin)).toBe("plugin_builtin");

    expect((await upload(pluginFiles(), { name: "imported" })).status).toBe(201);
    const again = await upload(pluginFiles("2026.09.02.1"), { name: "imported" });
    expect(again.status).toBe(409);
    expect(await readErrorCode(again)).toBe("plugin_exists");
    const overwritten = await upload(pluginFiles("2026.09.02.1"), {
      name: "imported",
      overwrite: true,
    });
    expect(overwritten.status).toBe(201);
    expect(((await overwritten.json()) as PluginImportResponse).plugin.version).toBe(
      "2026.09.02.1",
    );
  });

  it("exports a plugin as an archive that imports back", async () => {
    await upload(pluginFiles(), { name: "imported" });
    const res = await admin.get("/api/plugins/imported/archive");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toContain("imported-v2026.09.01.1.zip");
    const archive = Buffer.from(await res.arrayBuffer());
    // The archive carries the plugin as the library holds it, so it re-imports under a new name.
    const parsed = parsePluginArchive(archive, { name: "imported-again" });
    expect(Object.keys(parsed.files).sort()).toEqual([
      "icon.svg",
      "plugin.json",
      "skills/imported-skill/SKILL.md",
    ]);
    const again = await admin.post("/api/plugins/upload", {
      dataBase64: archive.toString("base64"),
      name: "imported-again",
    });
    expect(again.status).toBe(201);
    expect(await libraryNames()).toEqual(expect.arrayContaining(["imported", "imported-again"]));
  });

  it("downloads an archive from a URL, and refuses one the host will not serve", async () => {
    const calls: string[] = [];
    // What that archive really looks like: the repository wrapped in `<repo>-<ref>/`.
    const fromGitHub: Record<string, string> = {};
    for (const [rel, text] of Object.entries(pluginFiles())) {
      fromGitHub[`penguin-harness-main/plugins/from-github/${rel}`] = text;
    }
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0]) => {
      calls.push(String(input));
      return new Response(new Uint8Array(zip(fromGitHub)), { status: 200 });
    });
    const res = await admin.post("/api/plugins/download", {
      url: "https://github.com/Prism-Shadow/penguin-harness/tree/main/plugins/from-github",
    });
    expect(res.status).toBe(201);
    // The GitHub page became the archive it stands for, and the tree's directory named the plugin.
    expect(calls).toEqual(["https://github.com/Prism-Shadow/penguin-harness/archive/main.zip"]);
    expect(((await res.json()) as PluginImportResponse).plugin.name).toBe("from-github");

    vi.stubGlobal("fetch", async () => new Response("nope", { status: 404 }));
    const failed = await admin.post("/api/plugins/download", { url: "https://example.com/x.zip" });
    expect(failed.status).toBe(400);
    expect(await readErrorCode(failed)).toBe("download_failed");

    vi.stubGlobal("fetch", async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    const unreachable = await admin.post("/api/plugins/download", {
      url: "https://example.com/x.zip",
    });
    expect(unreachable.status).toBe(400);
    expect(await readErrorCode(unreachable)).toBe("download_failed");

    // Past the cap, refused while streaming rather than after buffering it whole.
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("x", { status: 200, headers: { "content-length": String(64 * 1024 * 1024) } }),
    );
    const tooBig = await admin.post("/api/plugins/download", {
      url: "https://example.com/big.zip",
    });
    expect(tooBig.status).toBe(413);
    expect(await readErrorCode(tooBig)).toBe("plugin_too_large");

    // What is fetched whole is often a repository, so the download cap is larger than the upload
    // one: 20MB is past the base64 body limit and inside this one, and what the route says about
    // it is "not a zip" — the body is a zip's problem, not its size.
    vi.stubGlobal(
      "fetch",
      async () => new Response(Buffer.alloc(20 * 1024 * 1024, 0x7a), { status: 200 }),
    );
    const repositorySized = await admin.post("/api/plugins/download", {
      url: "https://example.com/repo.zip",
    });
    expect(repositorySized.status).toBe(400);
    expect(await readErrorCode(repositorySized)).toBe("bad_request");
  });

  it("refuses a URL aimed at the server's own network before fetching anything", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await admin.post("/api/plugins/download", { url: "http://127.0.0.1:7364/x.zip" });
    expect(res.status).toBe(400);
    expect(await readErrorCode(res)).toBe("blocked_url");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
