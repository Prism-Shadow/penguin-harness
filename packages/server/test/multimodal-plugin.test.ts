import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import type {
  AgentPluginsInstallResponse,
  CapabilitySettings,
  SessionCreateResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, restartTestApp, type TestApp } from "./helpers.js";

const name = "multimodal-tools";
const specifier = "@penguinharness/multimodal-tools";
const shipped = fileURLToPath(new URL("../../../plugins/multimodal-tools/", import.meta.url));
const project = "/api/projects/default_project";
const agentPlugins = project + "/agents/default_agent/plugins";
const actions = ["fetch", "image", "search", "stt", "tts", "video"];

/** Install exactly the package's distributable files under the same prefix a release carries. */
async function shipPlugin(root: string): Promise<void> {
  const prefix = path.join(root, "install", "plugins");
  process.argv[1] = path.join(root, "install", "bin", "server.js");
  const target = path.join(prefix, "node_modules", ...specifier.split("/"));
  await mkdir(target, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(shipped, "package.json"), "utf8")) as {
    version: string;
    files: string[];
  };
  await writeFile(
    path.join(prefix, "package.json"),
    JSON.stringify({ dependencies: { [specifier]: manifest.version } }),
  );
  for (const rel of ["package.json", ...manifest.files]) {
    await cp(path.join(shipped, rel), path.join(target, rel), { recursive: true });
  }
}

it("uses the shipped module and Skill on a fresh Project, keeps opt-outs across restart and restores each at its own scope", async () => {
  const program = process.argv[1];
  let t: TestApp | undefined;
  try {
    t = await createTestApp({ durableDatabase: true, beforeSeed: shipPlugin });
    let api = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const available = async (base: string) => {
      const response = await api.get(base + "/capabilities");
      expect(response.status).toBe(200);
      const settings = (await response.json()) as CapabilitySettings;
      return settings.available
        .filter((row) => row.package === specifier)
        .map((row) => row.key)
        .sort();
    };
    const hasSkill = async () => {
      const res = await api.get(agentPlugins);
      expect(res.status).toBe(200);
      return ((await res.json()) as AgentPluginsInstallResponse).skills.some(
        (item) => item.name === name,
      );
    };
    expect(await available(project)).toEqual(actions);
    expect(await hasSkill()).toBe(true);
    const model = { provider: "custom", modelId: "lifecycle-test" };
    const configured = await api.put(project + "/models", {
      defaultModel: model,
      models: [
        {
          ...model,
          clientType: "openai",
          baseUrl: "https://lifecycle.invalid/v1",
          apiKey: "test-only",
          contextWindow: 128000,
        },
      ],
    });
    expect(configured.status, await configured.text()).toBe(200);
    const session = await api.post(project + "/agents/default_agent/sessions", {});
    expect(session.status, await session.clone().text()).toBe(201);
    const { sessionId } = ((await session.json()) as SessionCreateResponse).session;

    const installed = project + "/plugins/installed";
    expect(
      (await api.delete(installed + "?specifier=" + encodeURIComponent(specifier))).status,
    ).toBe(200);
    expect(await available(project)).toEqual([]);
    expect(await hasSkill()).toBe(true);
    t = await restartTestApp(t);
    api = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect(await available(project)).toEqual([]);

    // All Projects had turned it off. Creating another Project must load the server module
    // again for the new Project, without advertising its actions to the old one.
    expect((await api.post("/api/projects", { projectId: "research" })).status).toBe(201);
    expect(await available("/api/projects/research")).toEqual(actions);
    expect(await available(project)).toEqual([]);
    expect((await api.post(installed, { specifier })).status).toBe(200);
    expect(await available(project)).toEqual(actions);
    expect((await api.get("/api/sessions/" + sessionId)).status).toBe(200);

    expect((await api.delete(agentPlugins + "/" + name)).status).toBe(200);
    expect(await hasSkill()).toBe(false);
    expect(await available(project)).toEqual(actions);
    expect((await api.post(agentPlugins, { names: [name] })).status).toBe(201);
    expect(await hasSkill()).toBe(true);
  } finally {
    if (program !== undefined) process.argv[1] = program;
    await t?.cleanup();
  }
}, 30_000);
