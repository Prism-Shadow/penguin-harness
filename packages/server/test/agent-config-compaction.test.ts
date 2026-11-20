/**
 * The compaction's tool rounds, reminder and hand-off note through the Agent config route
 * (GET / PUT …/agents/:agentId/config, POST …/config/reset).
 *
 * - A file written before the three keys existed reports the values its Sessions run with: the
 *   built-in defaults. A save writes each one into the file and reads back as stored.
 * - A blank text is kept blank, as the prompt's is: it means "no line" for the reminder and the
 *   quoted data alone for the note, so it never reads back as the default.
 * - Tool rounds are an integer of 0 or more; anything else is refused with nothing written.
 * - Restoring the defaults brings the built-in values back.
 */
import fs from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  DEFAULT_COMPACTION_HANDOFF_NOTE,
  DEFAULT_COMPACTION_MAX_ROUNDS,
  DEFAULT_COMPACTION_PROMPT,
  DEFAULT_COMPACTION_REMINDER,
  systemConfigPath,
} from "@prismshadow/penguin-core";
import type { AgentConfigResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("the compaction's rounds and texts on the Agent config route", () => {
  let t: TestApp;
  let alice: ReturnType<typeof apiClient>;
  let projectId: string;
  const configUrl = () => `/api/projects/${projectId}/agents/default_agent/config`;
  const configFile = () => systemConfigPath(t.root, projectId, "default_agent");
  const storedCompaction = async (): Promise<Record<string, unknown>> =>
    (parseYaml(await fs.readFile(configFile(), "utf8")) as { compaction: Record<string, unknown> })
      .compaction;
  const read = async (): Promise<AgentConfigResponse> =>
    (await (await alice.get(configUrl())).json()) as AgentConfigResponse;

  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "alice");
    alice = apiClient(t.app, a.cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // Every case works in a Project of its own.
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await alice.post("/api/projects", {
        projectId: `alice-compaction_${projects}`,
        name: "Compaction project",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });

  /** Rewrites the Agent's file into the shape written before the three keys existed. */
  async function dropTheKeys(): Promise<void> {
    const config = parseYaml(await fs.readFile(configFile(), "utf8")) as {
      compaction: Record<string, unknown>;
    };
    delete config.compaction.max_rounds;
    delete config.compaction.reminder;
    delete config.compaction.handoff_note;
    await fs.writeFile(configFile(), stringifyYaml(config), "utf8");
  }

  it("reports the built-in values for a file without the keys, and the stored ones once saved", async () => {
    await dropTheKeys();
    const before = await read();
    expect(before.config.compaction).toMatchObject({
      maxRounds: DEFAULT_COMPACTION_MAX_ROUNDS,
      reminder: DEFAULT_COMPACTION_REMINDER,
      handoffNote: DEFAULT_COMPACTION_HANDOFF_NOTE,
    });

    const put = await alice.put(configUrl(), {
      config: {
        compaction: {
          maxRounds: 3,
          reminder: "Round {{ROUNDS_USED}} of 3 done.",
          handoffNote: "No summary.\n{{LAST_TURN}}",
        },
      },
    });
    expect(put.status, await put.clone().text()).toBe(200);
    const saved = (await put.json()) as AgentConfigResponse;
    const want = {
      maxRounds: 3,
      reminder: "Round {{ROUNDS_USED}} of 3 done.",
      handoffNote: "No summary.\n{{LAST_TURN}}",
      // A save of the three leaves the rest of the section as it was.
      prompt: DEFAULT_COMPACTION_PROMPT,
      mode: "summarize",
    };
    expect(saved.config.compaction).toMatchObject(want);
    expect((await read()).config.compaction).toMatchObject(want);
    expect(await storedCompaction()).toMatchObject({
      max_rounds: 3,
      reminder: "Round {{ROUNDS_USED}} of 3 done.",
      handoff_note: "No summary.\n{{LAST_TURN}}",
    });
  });

  it("keeps a blank text blank, as the prompt does, and takes 0 tool rounds", async () => {
    const put = await alice.put(configUrl(), {
      config: { compaction: { maxRounds: 0, reminder: "", handoffNote: "", prompt: "" } },
    });
    expect(put.status, await put.clone().text()).toBe(200);
    const got = await read();
    expect(got.config.compaction).toMatchObject({
      maxRounds: 0,
      reminder: "",
      handoffNote: "",
      prompt: "",
    });
    expect(await storedCompaction()).toMatchObject({
      max_rounds: 0,
      reminder: "",
      handoff_note: "",
      prompt: "",
    });
  });

  it("refuses tool rounds that are not an integer of 0 or more, writing nothing", async () => {
    const before = await fs.readFile(configFile(), "utf8");
    for (const maxRounds of [-1, 1.5, "3"]) {
      const put = await alice.put(configUrl(), {
        config: { compaction: { maxRounds, reminder: "Changed." } },
      });
      expect(put.status, `maxRounds ${JSON.stringify(maxRounds)}`).toBe(400);
    }
    expect(await fs.readFile(configFile(), "utf8")).toBe(before);
  });

  it("brings the built-in values back on restore defaults", async () => {
    const put = await alice.put(configUrl(), {
      config: { compaction: { maxRounds: 2, reminder: "", handoffNote: "Mine." } },
    });
    expect(put.status).toBe(200);

    const reset = await alice.post(`${configUrl()}/reset`);
    expect(reset.status).toBe(200);
    const body = (await reset.json()) as AgentConfigResponse;
    expect(body.config.compaction).toMatchObject({
      maxRounds: DEFAULT_COMPACTION_MAX_ROUNDS,
      reminder: DEFAULT_COMPACTION_REMINDER,
      handoffNote: DEFAULT_COMPACTION_HANDOFF_NOTE,
    });
    expect(await storedCompaction()).toMatchObject({
      max_rounds: DEFAULT_COMPACTION_MAX_ROUNDS,
      reminder: DEFAULT_COMPACTION_REMINDER,
      handoff_note: DEFAULT_COMPACTION_HANDOFF_NOTE,
    });
  });
});
