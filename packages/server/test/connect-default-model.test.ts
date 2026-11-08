/**
 * Connecting TokenDance or Penguin Go makes that group's DeepSeek V4.1 Flash the Project's default
 * model, here through the group settings (`PUT /models/providers/:provider` with a key). The
 * connect flows land on the same rule: model-oauth.test.ts and platform-auth.test.ts cover them.
 *
 * - Given a new Project, whose TokenDance group holds no key, when the owner saves a TokenDance
 *   key, then the default is TokenDance's DeepSeek V4.1 Flash, and the answer names it and the
 *   default it replaced.
 * - Given a Project with no default model, the same save sets it, and the answer names no
 *   default replaced.
 * - Nothing moves, and the answer names no switch, when the group already held a key, when
 *   another group gets its first key, when the Project no longer holds the row, and when the
 *   default already is that model.
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
/** A new Project's default model. */
const DEEPSEEK_FLASH: ModelRefDto = { provider: "deepseek", modelId: "deepseek-flash" };

describe("a group's first key moves the default model", () => {
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

  it("a TokenDance key saved by hand makes its DeepSeek V4.1 Flash the default, and says which one it replaced", async () => {
    expect((await models()).defaultModel).toEqual(DEEPSEEK_FLASH);

    const res = await saveKey("tokendance");

    expect(res.defaultSwitch).toEqual({
      defaultModel: TOKENDANCE_FLASH,
      previousDefault: DEEPSEEK_FLASH,
    });
    expect(res.defaultModel).toEqual(TOKENDANCE_FLASH);
    expect((await models()).defaultModel).toEqual(TOKENDANCE_FLASH);
  });

  it("a Project with no default gets one, and the answer names none replaced", async () => {
    await dropRows((m) => m.provider === "deepseek");
    expect((await models()).defaultModel).toBeUndefined();

    const res = await saveKey("tokendance");

    expect(res.defaultSwitch).toEqual({ defaultModel: TOKENDANCE_FLASH });
    expect((await models()).defaultModel).toEqual(TOKENDANCE_FLASH);
  });

  it.each([
    {
      when: "the group already held a key",
      arrange: async () => {
        await saveKey("tokendance", "sk-first-0001");
        await owner.put(`${url()}/default`, DEEPSEEK_FLASH);
      },
      provider: "tokendance",
      expected: DEEPSEEK_FLASH,
    },
    {
      when: "another group gets its first key",
      arrange: async () => {},
      provider: "openrouter",
      expected: DEEPSEEK_FLASH,
    },
    {
      when: "the Project no longer holds the row",
      arrange: () =>
        dropRows((m) => m.provider === "tokendance" && m.modelId === TOKENDANCE_FLASH.modelId),
      provider: "tokendance",
      expected: DEEPSEEK_FLASH,
    },
    {
      when: "the default already is that model",
      arrange: async () => {
        await owner.put(`${url()}/default`, TOKENDANCE_FLASH);
      },
      provider: "tokendance",
      expected: TOKENDANCE_FLASH,
    },
  ])("nothing moves when $when", async ({ arrange, provider, expected }) => {
    await arrange();

    const res = await saveKey(provider);

    expect(res.defaultSwitch).toBeUndefined();
    expect((await models()).defaultModel).toEqual(expected);
  });
});
