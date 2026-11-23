import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgent,
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  tracesDir,
  userText,
} from "../src/index.js";
import { seedProject } from "./seeded-project.js";
import { stubProviderKeys } from "./provider-keys.js";
import { movedPath } from "../src/state/layout-migration/rewrite.js";
import { resolveRoot } from "../src/state/paths.js";
import { installedWindowsDataLocation } from "../src/state/windows-data-location.js";

describe.skipIf(process.platform !== "win32")("the installed Windows data location", () => {
  let home: string;
  let control: string;
  let base: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-location-"));
    control = path.join(home, ".penguin");
    base = path.join(home, "Other volume");
    fs.mkdirSync(control);
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.stubEnv("PENGUIN_HOME", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("moves only paths on the named Windows volume and preserves slash-only records", () => {
    const drive = [{ from: "C:/Penguin/Data", to: "D:\\Moved\\Data" }];
    expect(movedPath("c:/PENGUIN/data/agents/one", drive)).toBe("D:\\Moved\\Data\\agents\\one");
    expect(movedPath("/Penguin/Data/agents/one", drive)).toBeNull();
    expect(movedPath("C:/Penguin/Data2/work", drive)).toBeNull();
    expect(movedPath("E:/Penguin/Data/work", drive)).toBeNull();

    const share = [{ from: "\\\\host\\share\\Data", to: "D:\\Moved" }];
    expect(movedPath("//HOST/share/data/notes", share)).toBe("D:\\Moved\\notes");
    expect(movedPath("//host/other/data/notes", share)).toBeNull();

    expect(movedPath("/data/acme/notes", [{ from: "/data/acme", to: "/new/acme" }])).toBe(
      "/new/acme/notes",
    );
  });

  it("keeps the standard location until Setup commits both halves of a custom installation", () => {
    expect(resolveRoot()).toBe(path.join(control, "data"));
    fs.mkdirSync(path.join(base, "data"), { recursive: true });
    fs.writeFileSync(path.join(control, "windows-data-location"), "\ufeff" + base, "utf16le");
    expect(() => resolveRoot()).toThrow(/Reconnect the drive/);
    fs.mkdirSync(path.join(base, "desktop"));
    expect(installedWindowsDataLocation()).toBe(base);
    expect(resolveRoot()).toBe(path.join(base, "data"));
    vi.stubEnv("PENGUIN_HOME", path.join(home, "explicit"));
    expect(resolveRoot()).toBe(path.join(home, "explicit"));
  });

  it("resumes an immutable Session Trace into its copied Workspace while keeping outside directories", async () => {
    const restoreKeys = stubProviderKeys();
    const oldData = path.join(control, "data");
    const newData = path.join(base, "data");
    const external = path.join(home, "outside");
    fs.mkdirSync(external);
    try {
      await seedProject(oldData);
      const original = await createAgent({ root: oldData });
      const inside = await original.createSession();
      const outside = await original.createSession({ workspaceDir: external });
      const records = new Map<string, string>();
      for (const session of [inside, outside]) {
        const dir = path.join(
          tracesDir(oldData, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
          "2026-11-23",
        );
        fs.mkdirSync(dir, { recursive: true });
        const trace = path.join(dir, session.sessionId + "_001.jsonl");
        const bytes =
          JSON.stringify(session.metaMessage) +
          "\n" +
          JSON.stringify(userText("A local note")) +
          "\n";
        fs.writeFileSync(trace, bytes);
        records.set(trace, bytes);
        await session.dispose();
      }
      const oldFile = path.join(inside.workspaceDir, "draft.txt");
      fs.writeFileSync(oldFile, "before moving");
      fs.cpSync(oldData, newData, { recursive: true });
      fs.writeFileSync(
        path.join(base, "windows-data-roots.json"),
        JSON.stringify({ from: [oldData], to: newData }),
      );
      const agent = await createAgent({ root: newData });
      const resumed = await agent.resumeSession({ sessionId: inside.sessionId });
      const retained = await agent.resumeSession({ sessionId: outside.sessionId });
      try {
        expect(retained.workspaceDir).toBe(external);
        expect(resumed.workspaceDir).toBe(
          path.join(newData, path.relative(oldData, inside.workspaceDir)),
        );
        expect(
          (resumed.metaMessage.payload as { system_prompt: string }).system_prompt,
        ).not.toContain(oldData);
        const active = path.join(resumed.workspaceDir, "draft.txt");
        expect(fs.readFileSync(active, "utf8")).toBe("before moving");
        fs.writeFileSync(active, "after moving");
        expect(fs.readFileSync(oldFile, "utf8")).toBe("before moving");
        for (const [trace, bytes] of records) {
          expect(fs.readFileSync(trace, "utf8")).toBe(bytes);
          expect(fs.readFileSync(path.join(newData, path.relative(oldData, trace)), "utf8")).toBe(
            bytes,
          );
        }
      } finally {
        await Promise.all([resumed.dispose(), retained.dispose()]);
      }
    } finally {
      restoreKeys();
    }
  });

  it("keeps an unavailable or corrupt pointer in place", () => {
    const pointer = path.join(control, "windows-data-location");
    fs.writeFileSync(pointer, "\ufeff" + base, "utf16le");
    expect(() => resolveRoot()).toThrow(/Reconnect the drive/);
    expect(fs.existsSync(path.join(control, "data"))).toBe(false);
    expect(fs.readFileSync(pointer, "utf16le")).toBe("\ufeff" + base);
    fs.writeFileSync(pointer, "relative", "utf16le");
    expect(() => resolveRoot()).toThrow(/Invalid Windows data location/);
  });
});
