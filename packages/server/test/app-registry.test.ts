/**
 * App registry files: parse / serialize round trip, the validation a hand-edited file meets
 * (required fields, http(s) URLs, the kind enum, timestamps), id derivation from a name, and
 * the directory access helpers over a temp root.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appsDir,
  deleteAppFile,
  listAppFiles,
  parseAppFile,
  readAppFile,
  serializeApp,
  slugifyAppId,
  writeAppFile,
} from "../src/runtime/app-registry.js";
import { makeTempRoot } from "./helpers.js";

const FULL = {
  name: "Todo",
  description: "A todo app",
  sessionId: "session-2026-09-02-10-00-00-aabbccdd",
  agentId: "default_agent",
  workspace: "/tmp/ws",
  url: "http://localhost:3000",
  healthUrl: "http://localhost:3000/health",
  startCommand: "npm start",
  stopCommand: "pkill -f 'node server.js'",
  kind: "web" as const,
  registeredAt: "2026-09-02T10:00:00.000Z",
  updatedAt: "2026-09-02T11:00:00.000Z",
};

describe("parseAppFile / serializeApp", () => {
  it("round-trips every field through TOML", () => {
    const raw = serializeApp(FULL);
    expect(raw).toContain('session_id = "session-2026-09-02-10-00-00-aabbccdd"');
    expect(raw).toContain('health_url = "http://localhost:3000/health"');
    expect(parseAppFile("todo", raw)).toEqual({ ok: true, def: { id: "todo", ...FULL } });
  });

  it("a minimal hand-written file parses with kind web and no timestamps", () => {
    const parsed = parseAppFile(
      "api",
      'name = "API"\nsession_id = "s1"\nagent_id = "default_agent"\nworkspace = "/w"\n',
    );
    expect(parsed).toEqual({
      ok: true,
      def: {
        id: "api",
        name: "API",
        sessionId: "s1",
        agentId: "default_agent",
        workspace: "/w",
        kind: "web",
      },
    });
  });

  it("rejects missing required fields, non-http URLs, an unknown kind, and bad timestamps", () => {
    const base = 'name = "x"\nsession_id = "s"\nagent_id = "a"\nworkspace = "/w"\n';
    expect(parseAppFile("x", 'name = "x"\nagent_id = "a"\nworkspace = "/w"\n')).toMatchObject({
      ok: false,
      error: "Missing required field session_id",
    });
    expect(parseAppFile("x", `${base}url = "localhost:3000"\n`)).toMatchObject({
      ok: false,
      error: "url must be an absolute http(s) URL",
    });
    expect(parseAppFile("x", `${base}kind = "desktop"\n`)).toMatchObject({
      ok: false,
      error: "kind must be one of web / api / cli / other",
    });
    expect(parseAppFile("x", `${base}registered_at = "yesterday"\n`)).toMatchObject({
      ok: false,
      error: "registered_at is not a valid ISO 8601 instant",
    });
    expect(parseAppFile("x", "name = [\n")).toMatchObject({ ok: false });
    expect(parseAppFile("x", `${base}description = ""\n`)).toMatchObject({
      ok: false,
      error: "description must be a non-empty string",
    });
  });

  it("accepts a TOML datetime for the timestamps and normalizes it to ISO", () => {
    const parsed = parseAppFile(
      "x",
      'name = "x"\nsession_id = "s"\nagent_id = "a"\nworkspace = "/w"\nregistered_at = 2026-09-02T10:00:00Z\n',
    );
    expect(parsed).toMatchObject({ ok: true, def: { registeredAt: "2026-09-02T10:00:00.000Z" } });
  });
});

describe("slugifyAppId", () => {
  it("lowercases, collapses punctuation and spaces into hyphens, and never yields an empty id", () => {
    expect(slugifyAppId("Todo App")).toBe("todo-app");
    expect(slugifyAppId("  My  API (v2)! ")).toBe("my-api-v2");
    expect(slugifyAppId("snake_case_ok")).toBe("snake_case_ok");
    expect(slugifyAppId("!!!")).toBe("app");
    expect(slugifyAppId("待办事项")).toBe("app");
    expect(slugifyAppId("a".repeat(80))).toHaveLength(64);
  });
});

describe("registry directory access", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("a missing directory lists as empty; write creates it; list is name-ordered with parse results; delete reports existence", async () => {
    expect(await listAppFiles(root, "p1")).toEqual([]);
    await writeAppFile(root, "p1", "zeta", serializeApp(FULL));
    await writeAppFile(root, "p1", "alpha", "name = [\n");
    expect(appsDir(root, "p1")).toBe(path.join(root, "p1", "apps"));
    const entries = await listAppFiles(root, "p1");
    expect(entries.map((e) => e.id)).toEqual(["alpha", "zeta"]);
    expect(entries[0]!.parsed.ok).toBe(false);
    expect(entries[1]!.parsed).toMatchObject({ ok: true, def: { name: "Todo" } });
    expect(entries[1]!.mtimeMs).toBeGreaterThan(0);
    expect((await readAppFile(root, "p1", "zeta"))?.parsed.ok).toBe(true);
    expect(await readAppFile(root, "p1", "nope")).toBeNull();
    expect(await deleteAppFile(root, "p1", "zeta")).toBe(true);
    expect(await deleteAppFile(root, "p1", "zeta")).toBe(false);
  });
});
