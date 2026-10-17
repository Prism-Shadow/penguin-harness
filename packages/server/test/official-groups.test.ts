/**
 * The `official` flag in `[providers.<id>]`, as the server keeps it (PRN-021): core lends a
 * vendor's environment variable only to the keyless rows of an official group that name no base
 * URL of their own, and reads nothing but the flag — the server decides it from its catalog.
 *
 * - Given a file whose first-party groups carry no flag (from before it), the server's read
 *   marks exactly the groups on their vendor's own endpoint (or none) with a protocol that reads
 *   the vendor's variable, adds the vendor's client where such a group names a base URL, and
 *   touches no gateway, adapter, custom or user-defined group.
 * - Given that read happened, the file is not rewritten again, and a flag edited by hand stands.
 * - Given a first-party group without the flag appears later (a row the CLI or the SDK wrote),
 *   the next read fills it in too — a standing rule, not a one-time migration — and leaves every
 *   flag already there alone.
 * - Given the App starts, every Project's file is read and filled in before anything opens one, a
 *   file no request ever read included.
 * - Given a group's base URL or protocol written through the API, the flag is recomputed; a key
 *   alone leaves it as the file has it.
 * - Given a new Project, or "Restore defaults", the first-party vendor groups are official and no
 *   other group is.
 * - Given an official group on a base URL, a probe of a row that follows the group's protocol
 *   carries the group protocol's variable to that endpoint; a row pinned to another vendor's
 *   client is refused before any request, and that vendor's key never reaches the endpoint.
 */
import fs from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseToml } from "smol-toml";
import { projectConfigPath, renderProjectConfigToml } from "@prismshadow/penguin-core";
import { wire } from "@prismshadow/penguin-core/kernel";
import { ProjectConfigService } from "../src/services/project-config-service.js";
import type { ModelsResponse, ModelTestResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, makeTempRoot, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const VENDORS = ["anthropic", "deepseek", "google", "minimax", "moonshot", "openai", "zhipu"];

/** A file as a release before the flag wrote it: group tables without `official`. */
const PRE_FLAG = [
  "[providers.deepseek]",
  'base_url = "https://api.deepseek.com/"',
  "[providers.zhipu]",
  'base_url = "https://open.bigmodel.cn/api/paas/v4"',
  "[providers.anthropic]",
  'base_url = "https://proxy.example/anthropic"',
  "[providers.openai]",
  'client_type = "ant-messages"',
  "[providers.minimax]",
  'client_type = "minimax-official"',
  'api_key = "mm-key"',
  "[providers.tokendance]",
  'base_url = "https://tokendance.space/gateway/v1"',
  'client_type = "openai-chat"',
  "[providers.penguin-go]",
  'base_url = "https://go.penguin.ooo/api/v1"',
  'client_type = "mmsp"',
  "",
  ...[
    ["google", "gemini-3.8-flash"],
    ["deepseek", "deepseek-flash"],
    ["zhipu", "glm-5.3"],
    ["anthropic", "claude-sonnet-5"],
    ["openai", "gpt-6-luna"],
    ["minimax", "MiniMax-M3"],
    ["custom", "local"],
    ["myproxy", "claude-sonnet-5"],
  ].flatMap(([provider, modelId]) => [
    "[[models]]",
    `provider = "${provider}"`,
    `model_id = "${modelId}"`,
    "",
  ]),
].join("\n");

const tables = (raw: Record<string, unknown>) =>
  (raw.providers ?? {}) as Record<string, Record<string, unknown>>;

describe("the server fills in a missing official flag", () => {
  let root: string;
  let svc: ProjectConfigService;
  const P = "pre-flag";
  const file = () => projectConfigPath(root, P);

  beforeEach(async () => {
    root = await makeTempRoot();
    svc = wire(ProjectConfigService, { paths: { root } });
    await fs.mkdir(path.dirname(file()), { recursive: true });
    await fs.writeFile(file(), PRE_FLAG, "utf8");
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("marks exactly the groups the old rule lent a vendor key to, and gives those on a base URL the vendor's client", async () => {
    await svc.readRaw(P);
    const stored = tables(parseToml(await fs.readFile(file(), "utf8")));
    expect(stored.deepseek).toEqual({
      base_url: "https://api.deepseek.com/",
      official: true,
      client_type: "deepseek-official",
    });
    expect(stored.zhipu).toEqual({
      base_url: "https://open.bigmodel.cn/api/paas/v4",
      official: true,
      client_type: "zai-official",
    });
    // Named by a row alone: a table appears for the flag.
    expect(stored.google).toEqual({ official: true });
    // A protocol that reads the vendor's variable, and the key beside it, stay as they were.
    expect(stored.minimax).toEqual({
      client_type: "minimax-official",
      api_key: "mm-key",
      official: true,
    });
    // A proxy, or a protocol reading another vendor's variable: not the vendor's own.
    expect(stored.anthropic).toMatchObject({ official: false });
    expect(stored.openai).toMatchObject({ official: false });
    // Gateways, the relay, custom and user-defined groups carry no flag.
    expect(stored.tokendance).not.toHaveProperty("official");
    expect(stored["penguin-go"]).not.toHaveProperty("official");
    expect(stored).not.toHaveProperty("custom");
    expect(stored).not.toHaveProperty("myproxy");
    expect(
      Object.keys(stored)
        .filter((id) => stored[id]!.official === true)
        .sort(),
    ).toEqual(["deepseek", "google", "minimax", "zhipu"]);
  });

  it("writes once: a second read leaves the file alone, and a flag edited by hand stands", async () => {
    await svc.readRaw(P);
    const migrated = await fs.readFile(file(), "utf8");
    // A fresh service (a restart) reads the migrated file and writes nothing.
    await wire(ProjectConfigService, { paths: { root } }).readRaw(P);
    expect(await fs.readFile(file(), "utf8")).toBe(migrated);
    // The user turns the environment off for Google by hand: the next read keeps it off.
    const edited = migrated.replace(
      /\[providers\.google\]\nofficial = true/,
      "[providers.google]\nofficial = false",
    );
    expect(edited).not.toBe(migrated);
    await fs.writeFile(file(), edited, "utf8");
    const raw = await wire(ProjectConfigService, { paths: { root } }).readRaw(P);
    expect(tables(raw).google).toEqual({ official: false });
    expect(await fs.readFile(file(), "utf8")).toBe(edited);
  });

  it("a first-party group that shows up later without the flag gets it at the next read, every flag already there untouched", async () => {
    await svc.readRaw(P);
    const before = tables(parseToml(await fs.readFile(file(), "utf8")));
    // A Moonshot row added by a writer that knows no catalog (the CLI, the SDK): no table.
    const text = await fs.readFile(file(), "utf8");
    await fs.writeFile(
      file(),
      `${text}\n[[models]]\nprovider = "moonshot"\nmodel_id = "kimi-k3"\n`,
      "utf8",
    );
    const after = tables(await wire(ProjectConfigService, { paths: { root } }).readRaw(P));
    expect(after.moonshot).toEqual({ official: true });
    const { moonshot: _added, ...rest } = after;
    expect(rest).toEqual(before);
  });

  it("the App's start fills in every Project's file before anything opens it, one no request read included", async () => {
    const other = projectConfigPath(root, "never-read");
    await fs.mkdir(path.dirname(other), { recursive: true });
    await fs.writeFile(other, PRE_FLAG, "utf8");
    // Not a Project: no config file, and a broken one is left for its own read to report.
    await fs.mkdir(path.join(root, "store"), { recursive: true });
    const broken = projectConfigPath(root, "broken");
    await fs.mkdir(path.dirname(broken), { recursive: true });
    await fs.writeFile(broken, "this is = = not toml", "utf8");
    await svc.migrateStoredConfigs();
    for (const migrated of [file(), other]) {
      expect(tables(parseToml(await fs.readFile(migrated, "utf8"))).google).toEqual({
        official: true,
      });
    }
    expect(await fs.readFile(broken, "utf8")).toBe("this is = = not toml");
  });
});

describe("the official flag through the API", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  let sequence = 0;
  const group = (id: string) => `/api/projects/${projectId}/models/providers/${id}`;
  const providers = async () =>
    ((await (await owner.get(`/api/projects/${projectId}/models`)).json()) as ModelsResponse)
      .providers;

  beforeAll(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "flag_owner");
    owner = apiClient(t.app, cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(async () => {
    const created = (await (
      await owner.post("/api/projects", { projectId: `flag_owner-p${++sequence}`, name: "Flags" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });

  it("a new Project marks the first-party vendor groups official, and no other group", async () => {
    const seeded = await providers();
    expect(
      Object.entries(seeded)
        .filter(([, g]) => g.official === true)
        .map(([id]) => id)
        .sort(),
    ).toEqual(VENDORS);
  });

  it("writing a group's base URL or protocol recomputes the flag; a key alone leaves it as the file has it", async () => {
    expect(
      (await owner.put(group("deepseek"), { baseUrl: "https://proxy.example/ds" })).status,
    ).toBe(200);
    expect((await providers()).deepseek).toMatchObject({
      baseUrl: "https://proxy.example/ds",
    });
    expect((await providers()).deepseek?.official).toBeUndefined();
    // Back on the vendor's own endpoint: official again, with the client that names the variable.
    await owner.put(group("deepseek"), { baseUrl: "https://api.deepseek.com" });
    expect((await providers()).deepseek).toMatchObject({
      baseUrl: "https://api.deepseek.com",
      clientType: "deepseek-official",
      official: true,
    });
    // A protocol reading another vendor's variable takes it away again.
    await owner.put(group("deepseek"), { clientType: "openai-chat" });
    expect((await providers()).deepseek?.official).toBeUndefined();
    // A gateway never gains one, whatever it is pointed at.
    await owner.put(group("tokendance"), { baseUrl: "https://api.openai.com/v1" });
    expect((await providers()).tokendance?.official).toBeUndefined();
    // A key alone keeps the flag the file has — even one a user turned off by hand.
    const file = projectConfigPath(t.root, projectId);
    const text = await fs.readFile(file, "utf8");
    await fs.writeFile(
      file,
      text.replace(
        /\[providers\.google\]\nofficial = true/,
        "[providers.google]\nofficial = false",
      ),
      "utf8",
    );
    await owner.put(group("google"), { apiKey: "g-key" });
    expect((await providers()).google?.official).toBeUndefined();
    expect(tables(parseToml(await fs.readFile(file, "utf8"))).google).toMatchObject({
      official: false,
      api_key: "g-key",
    });
  });

  it("an official group on a base URL lends its variable only to rows that read it: a row pinned to Anthropic's client in the OpenAI group is refused, and ANTHROPIC_API_KEY is never sent", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-openai-env-lent-0001");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-anthropic-env-must-not-cross");
    // The group's endpoint, played by a local server that records what each request carried.
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(JSON.stringify(req.headers));
      req.resume();
      req.on("end", () => {
        res.statusCode = 401;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: { message: "test-reject", type: "invalid_request" } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      // The file is the truth: the OpenAI group is official on this endpoint, as a user who
      // runs their own OpenAI-compatible mirror may mark it by hand.
      await fs.writeFile(
        projectConfigPath(t.root, projectId),
        renderProjectConfigToml({
          providers: {
            openai: {
              base_url: `http://127.0.0.1:${port}/v1`,
              client_type: "openai-official",
              official: true,
            },
          },
          models: [
            { provider: "openai", model_id: "gpt-6-luna" },
            { provider: "openai", model_id: "claude-sonnet-5", client_type: "anthropic-official" },
          ],
        }),
        "utf8",
      );
      const probe = async (modelId: string) =>
        (await (
          await owner.post(`/api/projects/${projectId}/models/test`, {
            provider: "openai",
            modelId,
          })
        ).json()) as ModelTestResponse;

      const pinned = await probe("claude-sonnet-5");
      expect(pinned.ok).toBe(false);
      expect(pinned.message).toMatch(/has no API key.*set the API key on the model entry/);
      expect(seen).toEqual([]);

      // The row on the group's own protocol reaches the endpoint with the group's variable.
      expect((await probe("gpt-6-luna")).ok).toBe(false);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.join("\n")).toContain("sk-openai-env-lent-0001");
      expect(seen.join("\n")).not.toContain("sk-anthropic-env-must-not-cross");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      vi.unstubAllEnvs();
    }
  });

  it("Restore defaults puts the flags back with the catalog's tables", async () => {
    await owner.put(group("anthropic"), { baseUrl: "https://proxy.example/anthropic" });
    expect((await providers()).anthropic?.official).toBeUndefined();
    const restored = await owner.post(`/api/projects/${projectId}/models/sync-presets`, {
      mode: "restore",
    });
    expect(restored.status).toBe(200);
    expect((await providers()).anthropic).toEqual({ official: true });
  });
});
