/**
 * The server's one-time migrations of a `.project_config.toml` (project-config-migrations.ts),
 * through the server's read path and the startup sweep. Removed at the 0.3.0 release preparation
 * with the migrations themselves.
 *
 * The DeepSeek and MiniMax presets' vendor endpoints (the vendor URL with the vendor's own client
 * pinned beside it, as every preset-written copy has it):
 * - Given a Project from main with the DeepSeek preset's pair hoisted onto `[providers.deepseek]`
 *   and the MiniMax preset's on its row (in its pre-MMSP spelling), the server's read drops both
 *   pairs, once: keys stay, and a keyless row of those groups is handed nothing again instead of
 *   refused. A second read leaves the file alone.
 * - Given a base URL the user typed — the vendor's own with no pin beside it, a proxy, the
 *   vendor's second host — or another vendor's preset-shaped pair, nothing changes and the file is
 *   not rewritten.
 * - Given a pair whose removal would move a request or a key — a generic protocol beside the URL,
 *   a row keeping a base URL of its own on the group's origin, a row that would follow another
 *   group URL, an id that reaches the client only through the group's pin — the pair stays.
 * - Given the App starts, every Project's file is migrated before anything opens it, one no
 *   request read included; a file that does not parse is left for its own read to report.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import {
  getModel,
  projectConfigPath,
  providerConnectionShape,
  resolveEntryCredential,
} from "@prismshadow/penguin-core";
import { wire } from "@prismshadow/penguin-core/kernel";
import { ProjectConfigService } from "../src/services/project-config-service.js";
import { makeTempRoot } from "./helpers.js";

/** One `[[models]]` row, its fields in order. */
const row = (fields: Record<string, string>): string[] => [
  "[[models]]",
  ...Object.entries(fields).map(([key, value]) => `${key} = "${value}"`),
  "",
];

/** A Project main wrote between the presets' vendor URLs and their removal, then hoisted. */
const FROM_MAIN = [
  "[providers.deepseek]",
  'base_url = "https://api.deepseek.com/"',
  'client_type = "deepseek-official"',
  "[providers.minimax]",
  'api_key = "sk-mm-group-0001"',
  "[providers.zhipu]",
  'base_url = "https://api.z.ai/api/paas/v4"',
  'client_type = "zai-official"',
  "",
  ...row({ provider: "deepseek", model_id: "deepseek-flash" }),
  ...row({ provider: "deepseek", model_id: "deepseek-v4-pro" }),
  ...row({
    provider: "minimax",
    model_id: "MiniMax-M3",
    client_type: "minimax-m3",
    base_url: "https://api.minimax.io/v1",
  }),
  ...row({ provider: "zhipu", model_id: "glm-5.3" }),
].join("\n");

const tables = (text: string) =>
  ((parseToml(text) as Record<string, unknown>).providers ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
const rows = (text: string) =>
  ((parseToml(text) as Record<string, unknown>).models ?? []) as Array<Record<string, unknown>>;

describe("the presets' vendor endpoints leave the file once", () => {
  let root: string;
  let svc: ProjectConfigService;
  const write = async (id: string, text: string): Promise<string> => {
    const file = projectConfigPath(root, id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, "utf8");
    return file;
  };

  beforeEach(async () => {
    root = await makeTempRoot();
    svc = wire(ProjectConfigService, { paths: { root } });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("drops the DeepSeek and MiniMax presets' URL and pin from the group and the row, keeps keys, and a keyless row is handed nothing again", async () => {
    const file = await write("from-main", FROM_MAIN);
    const cfg = await svc.loadConfig("from-main");
    const text = await fs.readFile(file, "utf8");
    expect(tables(text).deepseek).toBeUndefined();
    expect(tables(text).minimax).toEqual({ api_key: "sk-mm-group-0001" });
    // Another vendor's pair is not one the presets wrote: it stays.
    expect(tables(text).zhipu).toEqual({
      base_url: "https://api.z.ai/api/paas/v4",
      client_type: "zai-official",
    });
    const minimax = rows(text).find((r) => r.provider === "minimax")!;
    expect(minimax).not.toHaveProperty("base_url");
    expect(minimax).not.toHaveProperty("client_type");
    // What a Session on the default model now gets: nothing handed over, so DeepSeek's client
    // reads DEEPSEEK_API_KEY — where before the read it was refused for the URL in the file.
    const flash = getModel(cfg, { provider: "deepseek", model_id: "deepseek-flash" })!;
    expect(resolveEntryCredential(flash, providerConnectionShape(cfg.providers?.deepseek))).toEqual(
      {},
    );
    // Once: a second read finds nothing to drop and does not write.
    const stat = await fs.stat(file);
    await svc.readRaw("from-main");
    expect(await fs.readFile(file, "utf8")).toBe(text);
    expect((await fs.stat(file)).mtimeMs).toBe(stat.mtimeMs);
  });

  it("leaves a URL the user typed — the vendor's own with no pin, a proxy, the vendor's second host — and does not rewrite the file", async () => {
    const typed = [
      "[providers.deepseek]",
      'base_url = "https://api.deepseek.com"',
      "[providers.minimax]",
      'base_url = "https://api.minimaxi.com/v1"',
      'client_type = "minimax-official"',
      "",
      ...row({ provider: "deepseek", model_id: "deepseek-flash" }),
      ...row({
        provider: "deepseek",
        model_id: "deepseek-v4-pro",
        base_url: "https://proxy.example/deepseek",
        client_type: "deepseek-official",
      }),
      ...row({ provider: "minimax", model_id: "MiniMax-M3" }),
    ].join("\n");
    const file = await write("typed", typed);
    await svc.readRaw("typed");
    expect(await fs.readFile(file, "utf8")).toBe(typed);
  });

  it("keeps a pair whose removal would move a request or a key", async () => {
    const guarded = [
      "[providers.deepseek]",
      'base_url = "https://api.deepseek.com"',
      'client_type = "deepseek-official"',
      'api_key = "sk-ds-group-0002"',
      "[providers.minimax]",
      'base_url = "https://proxy.example/minimax"',
      "",
      ...row({ provider: "deepseek", model_id: "deepseek-flash" }),
      // The group key reaches this row only through the group's origin.
      ...row({
        provider: "deepseek",
        model_id: "deepseek-messages",
        client_type: "ant-messages",
        base_url: "https://api.deepseek.com/anthropic",
      }),
      // A generic protocol beside the URL: without it, the OpenAI client would go to OpenAI.
      ...row({
        provider: "deepseek",
        model_id: "deepseek-v4-pro",
        client_type: "openai-chat",
        base_url: "https://api.deepseek.com",
      }),
      // Without its own pair this row would follow the group's proxy instead.
      ...row({
        provider: "minimax",
        model_id: "MiniMax-M3",
        client_type: "minimax-official",
        base_url: "https://api.minimax.io/v1",
      }),
    ].join("\n");
    const pinOnly = [
      "[providers.deepseek]",
      'base_url = "https://api.deepseek.com"',
      'client_type = "deepseek-official"',
      "",
      // An id of no vendor family reaches DeepSeek's client only through the group's pin.
      ...row({ provider: "deepseek", model_id: "my-deepseek-finetune" }),
    ].join("\n");
    for (const [id, text] of [
      ["guarded", guarded],
      ["pin-only", pinOnly],
    ] as const) {
      const file = await write(id, text);
      await svc.readRaw(id);
      expect(await fs.readFile(file, "utf8"), id).toBe(text);
    }
  });

  it("the App's start migrates every Project's file before anything opens it, one no request read included", async () => {
    const files = [await write("one", FROM_MAIN), await write("never-read", FROM_MAIN)];
    // Not a Project: no config file, and a broken one is left for its own read to report.
    await fs.mkdir(path.join(root, "store"), { recursive: true });
    const broken = await write("broken", "this is = = not toml");
    await svc.migrateStoredConfigs();
    for (const file of files) {
      expect(tables(await fs.readFile(file, "utf8")).deepseek, file).toBeUndefined();
    }
    expect(await fs.readFile(broken, "utf8")).toBe("this is = = not toml");
  });
});
