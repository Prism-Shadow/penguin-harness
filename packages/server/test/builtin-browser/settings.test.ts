/**
 * The settings store: no file means no homepage, a write lands at
 * `<root>/builtin-browser/settings.json` and reads back, a file that cannot be used means the
 * defaults (logged), and writes made together keep the last one asked for.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsStore, settingsFile } from "../../src/builtin-browser/settings.js";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bb-settings-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("SettingsStore", () => {
  it("has no homepage while there is no file", async () => {
    const logs: string[] = [];
    const store = new SettingsStore(settingsFile(root), (line) => logs.push(line));
    expect(await store.read()).toEqual({ homepage: null });
    // A missing file is the normal first state, not something to report.
    expect(logs).toEqual([]);
  });

  it("writes the file under the data root and reads it back", async () => {
    const store = new SettingsStore(settingsFile(root));
    expect(await store.write({ homepage: "https://home.test/" })).toEqual({
      homepage: "https://home.test/",
    });
    const file = path.join(root, "builtin-browser", "settings.json");
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ homepage: "https://home.test/" });
    // Another store over the same file (the next App after a hot swap) reads the same.
    expect(await new SettingsStore(file).read()).toEqual({ homepage: "https://home.test/" });
    await store.write({ homepage: null });
    expect(await store.read()).toEqual({ homepage: null });
  });

  it("takes a file it cannot use for the defaults, and says so", async () => {
    const file = settingsFile(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const logs: string[] = [];
    const store = new SettingsStore(file, (line) => logs.push(line));
    await fs.writeFile(file, "{ not json");
    expect(await store.read()).toEqual({ homepage: null });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/the settings could not be read/);
  });

  it("holds no homepage the browser could not open", async () => {
    const file = settingsFile(root);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const store = new SettingsStore(file);
    for (const homepage of ["file:///etc/passwd", "javascript:alert(1)", "https://", 42, ""]) {
      await fs.writeFile(file, JSON.stringify({ homepage }));
      expect(await store.read()).toEqual({ homepage: null });
    }
    await fs.writeFile(file, JSON.stringify({ homepage: "HTTPS://Home.Test" }));
    expect(await store.read()).toEqual({ homepage: "https://home.test/" });
  });

  it("keeps the last of several writes made together", async () => {
    const store = new SettingsStore(settingsFile(root));
    await Promise.all([
      store.write({ homepage: "https://first.test/" }),
      store.write({ homepage: "https://second.test/" }),
      store.write({ homepage: "https://third.test/" }),
    ]);
    expect(await store.read()).toEqual({ homepage: "https://third.test/" });
  });
});
