/**
 * Given a plugin with a workbench, installing on any Agent copies its runnable source and Skill.
 * Given an installed copy, updating removes retired source but preserves state, history and user files.
 * Given a manually owned name or a second plugin with that name, installation refuses before writing Skills.
 * Given a symlink parent or an unsafe payload, installation never writes outside the Agent.
 * Given a restored package version, installed metadata reflects the restored source rather than the last install.
 * Given an interrupted installation receipt, retry completes the original plugin's install.
 * Given a workbench-only package, the library loads it and rejects runtime data in the payload.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  installPlugin,
  libraryPlugin,
  listInstalledWorkbenches,
  readLibraryPackage,
  isLibraryPackage,
  assertPluginWorkbenchesInstallable,
} from "../src/index.js";
let root: string;
const project = "default_project",
  agent = "custom_support";
const plugin = () => structuredClone(libraryPlugin("penguin-support")!);
const base = () => path.join(root, project, "agents", agent);
const dir = () => path.join(base(), "workbenches/support");
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-plugin-wb-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it("installs a plugin's runnable workbench and Skill on an ordinary Agent", async () => {
  await installPlugin(root, project, agent, plugin());
  expect(
    (await listInstalledWorkbenches(root, project, agent)).map((w) => [w.name, w.plugin]),
  ).toEqual([["support", "penguin-support"]]);
  expect(await fs.readFile(path.join(dir(), "ui/index.html"), "utf8")).toContain("./app.js");
  expect(
    await fs.readFile(path.join(base(), "agent_state/skills/penguin-support/SKILL.md"), "utf8"),
  ).toContain("https://penguin.ooo/docs/");
});
it("updates source and removes retired files while keeping state, history and local additions", async () => {
  const original = plugin();
  original.workbenches![0]!.files["old.js"] = "obsolete";
  await installPlugin(root, project, agent, original);
  await fs.writeFile(path.join(dir(), "state.json"), '{"tickets":[{"id":"keep"}]}');
  await fs.writeFile(path.join(dir(), "notes.txt"), "mine");
  const history = path.join(base(), "workbenches-history/support");
  await fs.mkdir(history, { recursive: true });
  await fs.writeFile(path.join(history, "saved"), "old revision");
  const update = plugin();
  update.workbenches![0]!.version = "2026.10.14.2";
  const pkg = JSON.parse(update.workbenches![0]!.files["package.json"]!);
  pkg.penguin.version = "2026.10.14.2";
  update.workbenches![0]!.files["package.json"] = JSON.stringify(pkg);
  update.workbenches![0]!.files["ui/app.js"] = "updated";
  await installPlugin(root, project, agent, update);
  expect(await fs.readFile(path.join(dir(), "ui/app.js"), "utf8")).toBe("updated");
  expect(await fs.readFile(path.join(dir(), "state.json"), "utf8")).toBe(
    '{"tickets":[{"id":"keep"}]}',
  );
  expect(await fs.readFile(path.join(dir(), "notes.txt"), "utf8")).toBe("mine");
  expect(await fs.readFile(path.join(history, "saved"), "utf8")).toBe("old revision");
  await expect(fs.stat(path.join(dir(), "old.js"))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await listInstalledWorkbenches(root, project, agent))[0]?.version).toBe("2026.10.14.2");
});
it("refuses a manual workbench before installing any Skill", async () => {
  await fs.mkdir(dir(), { recursive: true });
  await fs.writeFile(path.join(dir(), "package.json"), "{}");
  await expect(installPlugin(root, project, agent, plugin())).rejects.toThrow("already exists");
  await expect(fs.stat(path.join(base(), "agent_state/skills"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const other = plugin();
  other.name = "other";
  await expect(
    assertPluginWorkbenchesInstallable(root, project, "empty", [plugin(), other]),
  ).rejects.toThrow("already exists");
});
it("refuses redirected source directories and runtime data without changing files", async () => {
  await installPlugin(root, project, agent, plugin());
  const outside = path.join(root, "outside");
  await fs.mkdir(outside);
  await fs.rm(path.join(dir(), "ui"), { recursive: true });
  await fs.symlink(outside, path.join(dir(), "ui"), "dir");
  await expect(installPlugin(root, project, agent, plugin())).rejects.toThrow("symlink");
  expect(await fs.readdir(outside)).toEqual([]);
  const unsafe = plugin();
  unsafe.workbenches![0]!.files["state.json"] = "{}";
  await expect(installPlugin(root, project, "empty", unsafe)).rejects.toThrow("Invalid workbench");
});
it("retries an interrupted install owned by the same plugin", async () => {
  await fs.mkdir(dir(), { recursive: true });
  await fs.writeFile(
    path.join(dir(), ".plugin.json"),
    JSON.stringify({
      name: "support",
      plugin: "penguin-support",
      version: "",
      files: ["ui/app.js"],
    }),
  );
  await installPlugin(root, project, agent, plugin());
  expect((await listInstalledWorkbenches(root, project, agent))[0]?.version).toBe(
    plugin().workbenches![0]!.version,
  );
});
it("loads workbench-only packages and leaves unsafe payloads out of the library", async () => {
  const pkg = path.join(root, "package");
  const wb = path.join(pkg, "workbenches/support");
  await fs.mkdir(wb, { recursive: true });
  await fs.writeFile(
    path.join(pkg, "package.json"),
    JSON.stringify({ name: "example-workbench", version: "1.0.0" }),
  );
  for (const [rel, text] of Object.entries(plugin().workbenches![0]!.files)) {
    await fs.mkdir(path.dirname(path.join(wb, rel)), { recursive: true });
    await fs.writeFile(path.join(wb, rel), text);
  }
  expect(isLibraryPackage(pkg)).toBe(true);
  expect(readLibraryPackage(pkg)?.workbenches?.[0]?.name).toBe("support");
  await fs.writeFile(path.join(wb, "state.json"), "{}");
  expect(readLibraryPackage(pkg)?.workbenches ?? []).toEqual([]);
});

it("reports a restored source version for plugin update checks", async () => {
  await installPlugin(root, project, agent, plugin());
  const file = path.join(dir(), "package.json");
  const pkg = JSON.parse(await fs.readFile(file, "utf8"));
  pkg.penguin.version = "2026.10.01.1";
  await fs.writeFile(file, JSON.stringify(pkg));
  expect((await listInstalledWorkbenches(root, project, agent))[0]?.version).toBe("2026.10.01.1");
});
