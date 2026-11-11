/**
 * Connecting TokenDance or Penguin Go offers that group's DeepSeek V4.1 Flash as the Project's
 * default model, here through the group settings (`PUT /models/providers/:provider` with a key).
 * The connect flows land on the same rule: model-oauth.test.ts and platform-auth.test.ts cover
 * them. The default only moves when the user accepts, through `PUT /models/default`.
 *
 * - Given a new Project, whose default is DeepSeek's and whose TokenDance group holds no key,
 *   when the owner saves a TokenDance key, then the answer offers TokenDance's DeepSeek V4.1
 *   Flash and names the current default, and the stored default is still DeepSeek's.
 * - Given a Project with no default model, the same save offers it and names no current default,
 *   and the Project still has none.
 * - No offer when the group already held a key, when another group gets its first key, when the
 *   Project no longer holds the row, and when the default already is a model of the group.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  ModelRefDto,
  ModelsResponse,
  ProjectCreateResponse,
  ProviderConnectionResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const TOKENDANCE_FLASH: ModelRefDto = { provider: "tokendance", modelId: "deepseek-v4.1-flash" };
const TOKENDANCE_PRO: ModelRefDto = { provider: "tokendance", modelId: "deepseek-v4-pro-0813" };
/** A new Project's default model. */
const DEEPSEEK_FLASH: ModelRefDto = { provider: "deepseek", modelId: "deepseek-flash" };

describe("a group's first key offers its default model", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  let projects = 0;

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "owner_o")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  // Every case runs against a new Project of its own.
  beforeEach(async () => {
    projects += 1;
    const res = await owner.post("/api/projects", { projectId: `owner_o-p${projects}` });
    projectId = ((await res.json()) as ProjectCreateResponse).project.projectId;
  });

  const url = () => `/api/projects/${projectId}/models`;
  const models = async () => (await (await owner.get(url())).json()) as ModelsResponse;
  const saveKey = async (provider: string, apiKey = `sk-${provider}-0001`) => {
    const res = await owner.put(`${url()}/providers/${provider}`, { apiKey });
    expect(res.status).toBe(200);
    return (await res.json()) as ProviderConnectionResponse;
  };
  /** Rewrites the table without the rows `drop` names; the default goes if it was one of them. */
  const dropRows = async (drop: (m: ModelsResponse["models"][number]) => boolean) => {
    const kept = (await models()).models.filter((m) => !drop(m));
    const res = await owner.put(url(), {
      models: kept.map(({ provider, modelId }) => ({ provider, modelId })),
    });
    expect(res.status).toBe(200);
  };

  it("a TokenDance key saved by hand offers its DeepSeek V4.1 Flash, naming the current default, and moves nothing", async () => {
    expect((await models()).defaultModel).toEqual(DEEPSEEK_FLASH);

    const res = await saveKey("tokendance");

    expect(res.defaultOffer).toEqual({ model: TOKENDANCE_FLASH, current: DEEPSEEK_FLASH });
    expect(res.defaultModel).toEqual(DEEPSEEK_FLASH);
    expect((await models()).defaultModel).toEqual(DEEPSEEK_FLASH);
  });

  it("a Project with no default is offered one, and still has none", async () => {
    await dropRows((m) => m.provider === "deepseek");
    expect((await models()).defaultModel).toBeUndefined();

    const res = await saveKey("tokendance");

    expect(res.defaultOffer).toEqual({ model: TOKENDANCE_FLASH });
    expect((await models()).defaultModel).toBeUndefined();
  });

  it.each([
    {
      when: "the group already held a key",
      arrange: () => saveKey("tokendance", "sk-first-0001"),
      provider: "tokendance",
    },
    {
      when: "another group gets its first key",
      arrange: async () => {},
      provider: "openrouter",
    },
    {
      when: "the Project no longer holds the row",
      arrange: () =>
        dropRows((m) => m.provider === "tokendance" && m.modelId === TOKENDANCE_FLASH.modelId),
      provider: "tokendance",
    },
    {
      when: "the default already is a model of the group",
      arrange: () => owner.put(`${url()}/default`, TOKENDANCE_PRO),
      provider: "tokendance",
    },
  ])("no offer when $when", async ({ arrange, provider }) => {
    await arrange();
    const before = (await models()).defaultModel;

    const res = await saveKey(provider);

    expect(res.defaultOffer).toBeUndefined();
    expect((await models()).defaultModel).toEqual(before);
  });
});
