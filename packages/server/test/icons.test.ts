/**
 * Icons are images this server serves by URL: a listing names `{ url, tint }`, never markup, and
 * the route answers with the bytes under the type they are, sandboxed.
 *
 * - Given an Agent with the preinstalled plugins, when its Skills, its hook packages and the
 *   library are listed, then each icon is a URL with a content revision, marked to take the text
 *   colour (the shipped icons are line art), and fetching it answers the SVG as
 *   `image/svg+xml`, `nosniff`, under a sandboxing Content-Security-Policy, same-origin only and
 *   cached for good.
 * - Given a Skill whose icon is replaced (a PNG, then another PNG), then its URL's revision
 *   follows the content and the URL serves the new image as `image/png`, not tinted; an icon of
 *   another format left from before is gone.
 * - Given a Skill uploaded with an SVG icon that carries an `onload` script, or a hook package
 *   with one that animates a link, then the listing names no icon and the route refuses to serve
 *   it.
 * - Given someone outside the Project, then the Skill and hook icon routes answer 404, as for
 *   anything else of the Project's.
 */
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AgentHooksResponse,
  AgentSkillsResponse,
  PluginLibraryResponse,
  ProjectsResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PNG_A = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1]);
const PNG_B = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 2]);
const SKILL_MD = "---\nname: own-icon\ndescription: Carries its own icon.\n---\n\nBody\n";

const zipB64 = (files: Record<string, string | Uint8Array>) =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v]),
      ),
    ),
  ).toString("base64");

describe("icons", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  const agent = (rest: string) => `/api/projects/${projectId}/agents/default_agent${rest}`;

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "icon_owner")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "icon_outsider")).cookie);
    const projects = (await (await owner.get("/api/projects")).json()) as ProjectsResponse;
    projectId = projects.projects[0]!.projectId;
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const skills = async () =>
    ((await (await owner.get(agent("/skills"))).json()) as AgentSkillsResponse).skills;
  const iconOf = async (name: string) => (await skills()).find((s) => s.name === name)?.icon;

  it("names every shipped icon by URL, to take the text colour, and serves it sandboxed", async () => {
    const library = (await (await owner.get("/api/plugins")).json()) as PluginLibraryResponse;
    const hooks = ((await (await owner.get(agent("/hooks"))).json()) as AgentHooksResponse).hooks;
    const icons = [
      ...library.groups.flatMap((g) => g.plugins.map((p) => p.icon)),
      ...(await skills()).map((s) => s.icon),
      ...hooks.map((h) => h.icon),
    ];
    expect(icons.length).toBeGreaterThan(3);
    for (const icon of icons) {
      expect(icon).toEqual({
        url: expect.stringMatching(/^\/api\/.+[?&]rev=[0-9a-f]{12}$/),
        tint: true,
      });
    }
    for (const icon of [icons[0]!, icons[icons.length - 1]!]) {
      const res = await owner.get(icon.url);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-security-policy")).toMatch(/default-src 'none'.*; sandbox$/);
      expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
      expect(res.headers.get("cache-control")).toContain("immutable");
      expect(await res.text()).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
    }
  });

  it("follows a replaced icon with a new revision, and serves the new image as itself", async () => {
    const upload = (files: Record<string, string | Uint8Array>) =>
      owner.post(agent("/skills/archive"), { dataBase64: zipB64(files), overwrite: true });
    expect(
      (
        await upload({
          "own-icon/SKILL.md": SKILL_MD,
          "own-icon/icon.svg": '<svg fill="none" stroke="currentColor"/>',
        })
      ).status,
    ).toBe(201);
    const first = await iconOf("own-icon");
    expect(first?.tint).toBe(true);

    expect(
      (await upload({ "own-icon/SKILL.md": SKILL_MD, "own-icon/icon.png": PNG_A })).status,
    ).toBe(201);
    const second = await iconOf("own-icon");
    expect(
      (await upload({ "own-icon/SKILL.md": SKILL_MD, "own-icon/icon.png": PNG_B })).status,
    ).toBe(201);
    const third = await iconOf("own-icon");

    expect(second).toMatchObject({ tint: false });
    expect(new Set([first!.url, second!.url, third!.url]).size).toBe(3);
    const res = await owner.get(third!.url);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG_B);
  });

  it("names no icon for an SVG that carries a script, and will not serve it", async () => {
    const payload = '<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(\'/api/me\')"/>';
    const skill = await owner.post(agent("/skills/archive"), {
      dataBase64: zipB64({
        "evil/SKILL.md": SKILL_MD.replace("own-icon", "evil"),
        "evil/icon.svg": payload,
      }),
    });
    const hook = await owner.post(agent("/hooks/archive"), {
      dataBase64: zipB64({
        "evil-hook/hooks.json": JSON.stringify({ stop: [{ command: "stop.mjs" }] }),
        "evil-hook/stop.mjs": "process.stdout.write('{}');\n",
        "evil-hook/icon.svg":
          '<svg xmlns="http://www.w3.org/2000/svg"><a><animate attributeName="href" values="&#106;avascript:alert(1)"/></a></svg>',
      }),
    });
    expect([skill.status, hook.status]).toEqual([201, 201]);
    expect((await skills()).find((s) => s.name === "evil")).not.toHaveProperty("icon");
    const hooks = ((await (await owner.get(agent("/hooks"))).json()) as AgentHooksResponse).hooks;
    expect(hooks.find((h) => h.name === "evil-hook")).not.toHaveProperty("icon");
    expect((await owner.get(agent("/skills/evil/icon"))).status).toBe(404);
    expect((await owner.get(agent("/hooks/evil-hook/icon"))).status).toBe(404);
  });

  it("answers 404 to someone outside the Project", async () => {
    const skill = (await skills()).find((s) => s.icon !== undefined)!;
    expect((await owner.get(skill.icon!.url)).status).toBe(200);
    expect((await outsider.get(skill.icon!.url)).status).toBe(404);
    expect((await outsider.get(agent("/hooks/goal/icon"))).status).toBe(404);
  });
});
