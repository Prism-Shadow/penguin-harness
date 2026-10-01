/**
 * The user plugin directory (`<data root>/plugins`): the library's second source — what an
 * import writes, what the loader reads back from it (source "user"), what a bad directory does
 * (skipped, never fatal) and how a name that collides with a built-in is resolved.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { libraryPlugin, loadLibraryPlugins, userPluginRoots } from "../src/plugins/index.js";
import {
  installUserPlugin,
  removeUserPlugin,
  userPluginInstalled,
  userPluginsDir,
} from "../src/state/index.js";

let tmpRoot: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-plugin-store-"));
  process.env.PENGUIN_HOME = tmpRoot;
});

afterEach(async () => {
  if (prevHome === undefined) {
    delete process.env.PENGUIN_HOME;
  } else {
    process.env.PENGUIN_HOME = prevHome;
  }
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

/** A minimal but complete plugin: manifest, icon and one skill (the reader requires the SKILL.md frontmatter name). */
function pluginFiles(version = "2026.09.01.1"): Record<string, string> {
  return {
    "plugin.json": `${JSON.stringify(
      {
        description: "A plugin installed from outside the build.",
        short_description: "Imported plugin.",
        version,
        category: "software-development",
      },
      null,
      2,
    )}\n`,
    "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>\n',
    "skills/imported-skill/SKILL.md":
      "---\nname: imported-skill\ndescription: A skill the plugin ships.\n---\n\nBody.\n",
  };
}

const installedDir = (name: string): string => path.join(userPluginsDir(tmpRoot), name);

describe("installUserPlugin", () => {
  it("writes the plugin directory and reads it back as a library plugin of the user source", async () => {
    const plugin = await installUserPlugin(tmpRoot, "imported", pluginFiles());
    expect(plugin).toMatchObject({
      name: "imported",
      source: "user",
      version: "2026.09.01.1",
      category: "software-development",
      preinstall: true,
    });
    // The manifest's UI fields are stamped onto the skill the way a built-in's are.
    expect(plugin.skills.map((s) => s.name)).toEqual(["imported-skill"]);
    expect(plugin.skills[0]?.shortDescription).toBe("Imported plugin.");
    expect(plugin.skills[0]?.content).toContain("description: A skill the plugin ships.");
    expect(plugin.icon).toContain("<svg");
    // On disk: the archive's paths, verbatim, under <root>/plugins/<name>/.
    await expect(fs.readFile(installedDir("imported") + "/plugin.json", "utf8")).resolves.toContain(
      "2026.09.01.1",
    );
    // And the library every other surface reads now carries it.
    expect(libraryPlugin("imported")?.source).toBe("user");
    expect(loadLibraryPlugins().map((p) => p.name)).toContain("imported");
    await expect(userPluginInstalled(tmpRoot, "imported")).resolves.toBe(true);
  });

  it("replaces an existing install whole: a file the new copy does not ship is gone", async () => {
    await installUserPlugin(tmpRoot, "imported", {
      ...pluginFiles(),
      "skills/stale/SKILL.md": "---\nname: stale\ndescription: Not shipped any more.\n---\n",
    });
    await installUserPlugin(tmpRoot, "imported", pluginFiles("2026.09.02.1"));
    await expect(
      fs.access(path.join(installedDir("imported"), "skills", "stale", "SKILL.md")),
    ).rejects.toThrow();
    expect(libraryPlugin("imported")?.version).toBe("2026.09.02.1");
  });

  it("rejects files that are not a plugin, leaving neither the directory nor its staging behind", async () => {
    const noManifest = { ...pluginFiles() } as Record<string, string>;
    delete noManifest["plugin.json"];
    await expect(installUserPlugin(tmpRoot, "broken", noManifest)).rejects.toThrow();
    // A version the library does not accept is the manifest's only hard rule.
    await expect(installUserPlugin(tmpRoot, "broken", pluginFiles("1"))).rejects.toThrow(
      /YYYY\.MM\.DD\.N/,
    );
    await expect(fs.stat(installedDir("broken"))).rejects.toThrow();
    await expect(fs.stat(path.join(userPluginsDir(tmpRoot), ".broken.incoming"))).rejects.toThrow();
  });

  it("refuses a file path that would land outside the plugin directory", async () => {
    await expect(
      installUserPlugin(tmpRoot, "escapee", {
        ...pluginFiles(),
        "../outside.txt": "not inside",
      }),
    ).rejects.toThrow(/Invalid plugin file path/);
    await expect(fs.stat(path.join(userPluginsDir(tmpRoot), "outside.txt"))).rejects.toThrow();
  });

  it("refuses a name that is not a plugin name", async () => {
    await expect(installUserPlugin(tmpRoot, "../evil", pluginFiles())).rejects.toThrow(
      /Invalid plugin name/,
    );
  });
});

describe("the loader over the user plugin directory", () => {
  it("keeps a broken user directory out of the library without breaking it, and still lists it as installed", async () => {
    await installUserPlugin(tmpRoot, "imported", pluginFiles());
    // A directory left there by hand (an interrupted copy, a hand-edited manifest) must not
    // take the whole library down with it.
    const broken = path.join(userPluginsDir(tmpRoot), "handmade");
    await fs.mkdir(broken, { recursive: true });
    await fs.writeFile(path.join(broken, "plugin.json"), "{ not json", "utf8");
    expect(loadLibraryPlugins().map((p) => p.name)).toContain("imported");
    expect(libraryPlugin("handmade")).toBeUndefined();
    // The scan still sees it — the management listing is how its owner gets rid of it.
    expect([...userPluginRoots(tmpRoot).keys()]).toEqual(["handmade", "imported"]);
  });

  it("never lets a user plugin shadow a built-in of the same name", async () => {
    await installUserPlugin(tmpRoot, "goal", {
      ...pluginFiles(),
      "plugin.json": JSON.stringify({
        description: "Not the built-in goal.",
        version: "2099.01.01.1",
      }),
    });
    expect(libraryPlugin("goal")?.source).toBe("builtin");
    expect(libraryPlugin("goal")?.description).not.toBe("Not the built-in goal.");
  });
});

describe("removeUserPlugin", () => {
  it("deletes the directory and is idempotent", async () => {
    await installUserPlugin(tmpRoot, "imported", pluginFiles());
    await expect(removeUserPlugin(tmpRoot, "imported")).resolves.toBe(true);
    await expect(fs.stat(installedDir("imported"))).rejects.toThrow();
    expect(libraryPlugin("imported")).toBeUndefined();
    await expect(removeUserPlugin(tmpRoot, "imported")).resolves.toBe(false);
  });
});
