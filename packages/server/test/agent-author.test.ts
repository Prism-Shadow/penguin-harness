/**
 * An Agent's author (`author` in system_config.yaml), over the real app: who made it, set by
 * each creation path, read as `user` when missing, editable in the Agent's config, and stamped
 * `company` once on the organization employees that predate it.
 *
 * - Given a create request with no author, the new Agent's config says `user`; given
 *   `author: agent`, it says `agent`; given any other value, the request is refused and no Agent
 *   is created.
 * - Given an import, the Agent keeps the author its package carries: an export of a `company`
 *   Agent stays `company`, and a hand-written package (the agent-porting Skill's, over the
 *   template) that names `agent` is `agent`; one that names none reads `user`.
 * - Given company mode hiring a new Agent, that Agent is `company`; hiring an existing Agent
 *   leaves its author as it was.
 * - Given a config without the field, the list and the config view both read `user`, and the
 *   file is not written.
 * - Given a PUT of `author`, the list and the config view read the new value and the file keeps
 *   its comments; an unknown value is refused and the file is left as it was.
 * - Given organization employees from before authors existed, the first listing writes
 *   `author: company` into each config that has none, in place after the description with every
 *   comment kept; a second listing writes nothing; an employee whose file already names an
 *   author, any value, keeps it; an Agent no organization employs is not touched; an employee
 *   the chart names without a folder gets no file.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agentDir, systemConfigPath } from "@prismshadow/penguin-core";
import type { AgentConfigResponse, AgentsResponse } from "../src/api/types.js";
import { ORG_CONFIG_DEFAULTS } from "../src/organization/files.js";
import type { OrgEmployee } from "../src/organization/files.js";
import { OrgStore } from "../src/organization/store.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "olivia-default_project";
const AGENTS = `/api/projects/${PROJECT}/agents`;

/** A config as an Agent made before authors existed has it: no `author`, with comments. */
const PRE_AUTHOR_CONFIG = [
  "# Hand-tuned; keep these notes.",
  "name: Old hand",
  "description: Writes the site # the copy desk",
  "system_prompt: You write.",
  "version: 3",
  "",
].join("\n");

describe("an Agent's author", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let store: OrgStore;

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "olivia")).cookie);
    store = new OrgStore(t.deps.config.root);
  });

  afterAll(async () => {
    await t.cleanup();
  });

  const configFile = (agentId: string) => systemConfigPath(t.root, PROJECT, agentId);
  const readConfigFile = (agentId: string) => fs.readFile(configFile(agentId), "utf8");

  async function create(body: Record<string, unknown>): Promise<number> {
    return (await api.post(AGENTS, body)).status;
  }

  async function listed(): Promise<Map<string, string | undefined>> {
    const res = await api.get(AGENTS);
    expect(res.status).toBe(200);
    const { agents } = (await res.json()) as AgentsResponse;
    return new Map(agents.map((a) => [a.agentId, a.author]));
  }

  async function configAuthor(agentId: string): Promise<string | undefined> {
    const res = await api.get(`${AGENTS}/${agentId}/config`);
    expect(res.status).toBe(200);
    return ((await res.json()) as AgentConfigResponse).config.author;
  }

  /** An organization written straight to disk, as its files describe it. */
  async function writeOrg(orgId: string, employees: OrgEmployee[]): Promise<void> {
    const dir = store.dir(PROJECT, orgId);
    await store.createLayout(dir);
    await store.writeConfig(dir, {
      ...ORG_CONFIG_DEFAULTS,
      name: orgId,
      mission: "Ship the site",
      timezone: "UTC",
      createdBy: "olivia",
    });
    await store.writeChart(dir, { employees });
  }

  const employee = (agentId: string, reportsTo: string | null): OrgEmployee => ({
    agentId,
    title: reportsTo === null ? "CEO" : "Writer",
    reportsTo,
    workspace: agentId,
  });

  it("records `user` when the request names no author, and what it names otherwise", async () => {
    expect(await create({ agentId: "by_hand" })).toBe(201);
    expect(await create({ agentId: "by_agent", author: "agent" })).toBe(201);
    expect(await readConfigFile("by_hand")).toMatch(/^author: user$/m);
    const authors = await listed();
    expect(authors.get("by_hand")).toBe("user");
    expect(authors.get("by_agent")).toBe("agent");
    expect(await configAuthor("by_agent")).toBe("agent");
  });

  it("refuses an unknown author and creates nothing", async () => {
    expect(await create({ agentId: "by_robot", author: "robot" })).toBe(400);
    expect((await listed()).has("by_robot")).toBe(false);
    await expect(fs.access(agentDir(t.root, PROJECT, "by_robot"))).rejects.toThrow();
  });

  it("keeps the author an imported package carries", async () => {
    const importAs = async (agentId: string, bytes: Uint8Array) =>
      (await api.upload(`${AGENTS}/import?agentId=${agentId}`, bytes)).status;
    expect(await create({ agentId: "exported", author: "company" })).toBe(201);
    const exported = await api.get(`${AGENTS}/exported/archive`);
    expect(exported.status).toBe(200);
    expect(await importAs("from_export", new Uint8Array(await exported.arrayBuffer()))).toBe(201);
    const handWritten = (config: string) =>
      zipSync({ "ported/agent_state/system_config.yaml": strToU8(config) });
    expect(await importAs("ported", handWritten("name: Ported\nauthor: agent\n"))).toBe(201);
    expect(await importAs("ported_plain", handWritten("name: Ported\n"))).toBe(201);
    expect(await configAuthor("from_export")).toBe("company");
    expect(await configAuthor("ported")).toBe("agent");
    expect(await configAuthor("ported_plain")).toBe("user");
  });

  it("records `company` for an Agent a hire creates, and keeps an existing hire's author", async () => {
    expect(await create({ agentId: "acme_ceo" })).toBe(201);
    expect(await create({ agentId: "helper", author: "agent" })).toBe(201);
    await writeOrg("acme", [employee("acme_ceo", null)]);
    await t.deps.orgService.hire(PROJECT, "acme", {
      title: "Writer",
      reportsTo: "acme_ceo",
      newAgent: { agentId: "acme_writer" },
    });
    await t.deps.orgService.hire(PROJECT, "acme", {
      title: "Helper",
      reportsTo: "acme_ceo",
      agentId: "helper",
    });
    const authors = await listed();
    expect(authors.get("acme_writer")).toBe("company");
    expect(authors.get("helper")).toBe("agent");
    expect(authors.get("acme_ceo")).toBe("user");
  });

  it("reads `user` from a config with no author, and writes nothing to it", async () => {
    expect(await create({ agentId: "legacy" })).toBe(201);
    await fs.writeFile(configFile("legacy"), PRE_AUTHOR_CONFIG, "utf8");
    expect((await listed()).get("legacy")).toBe("user");
    expect(await configAuthor("legacy")).toBe("user");
    expect(await readConfigFile("legacy")).toBe(PRE_AUTHOR_CONFIG);
  });

  it("saves an edited author in place, and refuses an unknown one", async () => {
    expect(await create({ agentId: "edited" })).toBe(201);
    await fs.writeFile(configFile("edited"), PRE_AUTHOR_CONFIG, "utf8");
    const put = await api.put(`${AGENTS}/edited/config`, { config: { author: "agent" } });
    expect(put.status).toBe(200);
    expect(await configAuthor("edited")).toBe("agent");
    expect((await listed()).get("edited")).toBe("agent");
    const saved = await readConfigFile("edited");
    expect(saved).toContain("# Hand-tuned; keep these notes.");
    expect(saved).toContain("# the copy desk");

    const refused = await api.put(`${AGENTS}/edited/config`, { config: { author: "robot" } });
    expect(refused.status).toBe(400);
    expect(await readConfigFile("edited")).toBe(saved);
  });

  describe("the employees that predate authors", () => {
    const BEFORE: Record<string, string> = {};

    beforeAll(async () => {
      for (const agentId of ["old_ceo", "old_writer", "old_user", "old_odd", "not_employed"]) {
        expect(await create({ agentId })).toBe(201);
      }
      BEFORE.old_ceo = PRE_AUTHOR_CONFIG;
      BEFORE.old_writer = PRE_AUTHOR_CONFIG.replace("version: 3", "version: 1");
      BEFORE.old_user = `author: user\n${PRE_AUTHOR_CONFIG}`;
      BEFORE.old_odd = `${PRE_AUTHOR_CONFIG}author: robot\n`;
      BEFORE.not_employed = PRE_AUTHOR_CONFIG;
      for (const [agentId, text] of Object.entries(BEFORE)) {
        await fs.writeFile(configFile(agentId), text, "utf8");
      }
      await writeOrg("old", [
        employee("old_ceo", null),
        employee("old_writer", "old_ceo"),
        employee("old_user", "old_ceo"),
        employee("old_odd", "old_ceo"),
        employee("old_ghost", "old_ceo"),
      ]);
    });

    it("stamps `company` once, after the description, with every comment kept", async () => {
      const authors = await listed();
      expect(authors.get("old_ceo")).toBe("company");
      expect(authors.get("old_writer")).toBe("company");
      const migrated = await readConfigFile("old_ceo");
      expect(migrated).toContain("# Hand-tuned; keep these notes.");
      expect(migrated).toMatch(/description: Writes the site # the copy desk\nauthor: company\n/);
      // Nothing but the one key changed.
      expect(migrated.replace("author: company\n", "")).toBe(BEFORE.old_ceo);

      const stamped = await fs.stat(configFile("old_writer"));
      await listed();
      expect(await readConfigFile("old_ceo")).toBe(migrated);
      expect((await fs.stat(configFile("old_writer"))).mtimeMs).toBe(stamped.mtimeMs);
    });

    it("never overwrites an author the file names, nor touches an Agent no one employs", async () => {
      const authors = await listed();
      expect(authors.get("old_user")).toBe("user");
      expect(authors.get("old_odd")).toBe("user");
      expect(authors.get("not_employed")).toBe("user");
      for (const agentId of ["old_user", "old_odd", "not_employed"]) {
        expect(await readConfigFile(agentId)).toBe(BEFORE[agentId]);
      }
    });

    it("creates no config for an employee whose folder has none", async () => {
      await listed();
      await expect(fs.access(path.dirname(configFile("old_ghost")))).rejects.toThrow();
    });
  });
});
