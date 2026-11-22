/**
 * The data slots a server module's system app contributes through (PRFC-0036), read back by the
 * real routes: a plugin module booted into the platform tree contributing kinds of semantic id
 * and start-page counts.
 *
 * Semantic-id kinds (`SemanticIdModule.kinds`):
 * - Given a contributed kind, `POST …/suggest-id` proposes a kebab-case id for it from the model's
 *   answer and steps around the ids its `takenIds` names for that Project; a placeholder carries
 *   the kind's name.
 * - A kind contributed as the owner's is refused 403 to a member who does not own the Project,
 *   and nothing asks the model; a member's kind answers any member.
 * - A contribution naming one of the host's own kinds is left out: the host's rule still answers.
 * - A kind nobody contributes is 400.
 *
 * Start-page counts (`StartPageModule.metrics`):
 * - `GET /api/contributions` delivers each contributed count as data, attributed to the
 *   contribution and the module, under `startMetrics`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { UtilityCompletion } from "@prismshadow/penguin-library-project";
import type { ContributionsResponse, SemanticIdSuggestResponse } from "../src/api/types.js";
import { PluginHost } from "../src/plugin/host.js";
import type { SemanticIdKindSource } from "../src/services/semantic-id-kinds.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const answered = (text: string): UtilityCompletion => ({ ok: true, text });
const NO_MODEL: UtilityCompletion = { ok: false, cause: "no_model", error: "no default model" };

/** The Projects each kind's `takenIds` was asked about. */
const askedAbout: string[] = [];

function slotsPlugin(): ModuleDef {
  const deck: SemanticIdKindSource = {
    takenIds: async (projectId) => {
      askedAbout.push(projectId);
      return ["quarterly-review"];
    },
  };
  const note: SemanticIdKindSource = { takenIds: async () => [] };
  return {
    manifest: parseManifest({
      name: "AcmeApp",
      requires: {},
      provides: {},
      contributes: {
        "SemanticIdModule.kinds": [
          { id: "acme.deck", kind: "deck", access: "owner" },
          { id: "acme.note", kind: "note" },
          { id: "acme.agent", kind: "agent" },
        ],
        "StartPageModule.metrics": [
          {
            id: "acme.decks",
            key: "decks",
            title: "Decks",
            titleZh: "演示稿",
            icon: "presentation",
            order: 10,
            value: 7,
            app: "deck",
          },
        ],
      },
      children: [],
    }),
    create: () => ({
      api: {},
      bind: {
        "acme.deck": deck,
        "acme.note": note,
        // Never consulted: the host's `agent` kind is its own.
        "acme.agent": { takenIds: async () => ["report_writer"] },
      },
    }),
  };
}

describe("a system app's data slots", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  const project = "olivia-default_project";
  const url = `/api/projects/${project}/suggest-id`;
  const completion = { prompts: [] as string[], answers: [] as UtilityCompletion[] };

  beforeAll(async () => {
    const host = new PluginHost();
    host.use({ specifier: "@acme/app", modules: [slotsPlugin()], replaces: [] });
    t = await createTestApp({ plugins: host });
    t.deps.projectConfigService.completeOnce = async (_projectId, prompt) => {
      completion.prompts.push(prompt);
      return completion.answers.shift() ?? NO_MODEL;
    };
    owner = apiClient(t.app, (await provisionUser(t.app, "olivia")).cookie);
    const mia = await provisionUser(t.app, "mia");
    expect((await owner.post(`/api/projects/${project}/members`, { userId: "mia" })).status).toBe(
      201,
    );
    member = apiClient(t.app, mia.cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const suggest = async (client: ReturnType<typeof apiClient>, body: unknown) => {
    const res = await client.post(url, body);
    expect(res.status, await res.clone().text()).toBe(200);
    return (await res.json()) as SemanticIdSuggestResponse;
  };

  it("proposes a kebab-case id for a contributed kind, around the ids it names as taken", async () => {
    completion.answers = [answered("quarterly_review")];
    expect(await suggest(owner, { name: "季度复盘", kind: "deck" })).toEqual({
      id: "quarterly-review-2",
      source: "model",
    });
    expect(askedAbout).toEqual([project]);
    expect((await suggest(owner, { name: "季度复盘", kind: "deck" })).id).toMatch(/^deck-\d{8}$/);
  });

  it("asks the owner only for an owner's kind, and any member for a member's", async () => {
    const asked = completion.prompts.length;
    const refused = await member.post(url, { name: "Review", kind: "deck" });
    expect(refused.status).toBe(403);
    expect(completion.prompts).toHaveLength(asked);
    completion.answers = [answered("standup")];
    expect(await suggest(member, { name: "站会", kind: "note" })).toEqual({
      id: "standup",
      source: "model",
    });
  });

  it("keeps the host's own kinds and refuses a kind nobody contributes", async () => {
    completion.answers = [answered("report_writer")];
    expect(await suggest(owner, { name: "报告写手", kind: "agent" })).toEqual({
      id: "report_writer",
      source: "model",
    });
    expect((await owner.post(url, { name: "Team", kind: "team" })).status).toBe(400);
  });

  it("delivers the contributed start-page counts in GET /api/contributions", async () => {
    const answer = (await (await owner.get("/api/contributions")).json()) as ContributionsResponse;
    expect(answer.startMetrics).toEqual([
      {
        id: "acme.decks",
        from: "AcmeApp",
        key: "decks",
        title: "Decks",
        titleZh: "演示稿",
        icon: "presentation",
        order: 10,
        value: 7,
        app: "deck",
      },
    ]);
  });
});
