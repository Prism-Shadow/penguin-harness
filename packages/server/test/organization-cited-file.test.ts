/**
 * Opening a file an employee cited (`GET …/organizations/:orgId/file?path=`), over the real
 * service and an organization written to disk.
 *
 * - Given a handbook page, a shared-workspace file and a file in an employee's workspace that a
 *   person pointed outside the organization, a member opens each by its citation: the
 *   `<app_data_dir>` spelling, the real absolute spelling, and the employee's own directory.
 * - Given a file of the Project that is in none of those roots (an Agent's state, the
 *   organization's own config, reached directly or through `..`), it is refused and its bytes are
 *   not sent.
 * - Given a Project config or an Agent vault inside a root (a workspace pointed at the Project
 *   directory), or a link in a workspace that resolves to one, it is refused by name.
 * - Given an employee's workspace re-pointed elsewhere, its old directory stops being served.
 * - Given nothing at the path, or a directory, the answer is 404; given no path or a relative
 *   one, 400; given a caller outside the Project, 404.
 * - An HTML file is served as text, as the Files panel serves it.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectDir } from "@prismshadow/penguin-core";
import { ORG_CONFIG_DEFAULTS } from "../src/organization/files.js";
import type { OrgEmployee } from "../src/organization/files.js";
import { OrgStore } from "../src/organization/store.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const projectId = "olivia-default_project";
const ORG = "<app_data_dir>/organizations/acme";

describe("opening a cited organization file", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let store: OrgStore;
  let orgDir: string;
  let appDataDir: string;
  /** A directory a person picked for an employee, outside the organization. */
  let external: string;

  const open = (cited: string, client = api) =>
    client.get(
      `/api/projects/${projectId}/organizations/acme/file?path=${encodeURIComponent(cited)}`,
    );
  const code = async (res: Response) =>
    ((await res.json()) as { error?: { code?: string } }).error?.code;
  const writeChart = (dev: Partial<OrgEmployee>) =>
    store.writeChart(orgDir, {
      employees: [
        { agentId: "acme_ceo", title: "CEO", reportsTo: null, workspace: "ceo" },
        { agentId: "acme_dev", title: "Developer", reportsTo: "acme_ceo", workspace: ".", ...dev },
      ],
    });
  const put = async (file: string, content: string) => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  };

  beforeAll(async () => {
    t = await createTestApp();
    t.deps.serverSettingsRepo.setCompanyMode(true);
    api = apiClient(t.app, (await provisionUser(t.app, "olivia")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "mallory")).cookie);
    appDataDir = projectDir(t.deps.config.root, projectId);
    store = new OrgStore(t.deps.config.root);
    orgDir = store.dir(projectId, "acme");
    await store.createLayout(orgDir);
    await store.writeConfig(orgDir, {
      ...ORG_CONFIG_DEFAULTS,
      name: "Acme",
      mission: "Ship the site",
      timezone: "UTC",
      createdBy: "olivia",
    });
    external = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-cited-"));
    await writeChart({ workspace: external });
    await put(path.join(orgDir, "handbook", "hiring.md"), "# Hiring");
    await put(path.join(orgDir, "workspace", "growth", "weekly.md"), "weekly numbers");
    await put(path.join(orgDir, "workspace", "page.html"), "<script>alert(1)</script>");
    await put(path.join(external, "notes.md"), "dev notes");
    await put(path.join(appDataDir, "agents", "acme_dev", "agent_state", "memo.md"), "private");
    await put(path.join(appDataDir, "agents", "acme_dev", "agent_state", ".vault.toml"), "K='s'");
    await put(path.join(appDataDir, ".project_config.toml"), "api_key = 'secret'");
  });
  afterAll(async () => {
    await t.cleanup();
    await fs.rm(external, { recursive: true, force: true });
  });

  it("opens the handbook, the shared workspace and an employee's own directory by their citations", async () => {
    const hiring = await open(`${ORG}/handbook/hiring.md`);
    expect(hiring.status).toBe(200);
    expect(await hiring.text()).toBe("# Hiring");

    const real = path.join(orgDir, "workspace", "growth", "weekly.md");
    const weekly = await open(real);
    expect(weekly.status).toBe(200);
    expect(await weekly.text()).toBe("weekly numbers");

    const notes = await open(path.join(external, "notes.md"));
    expect(notes.status).toBe(200);
    expect(await notes.text()).toBe("dev notes");
  });

  it.each([
    ["an Agent's state", "<app_data_dir>/agents/acme_dev/agent_state/memo.md"],
    ["the organization's config", `${ORG}/org_config.toml`],
    ["a climb out of the workspace", `${ORG}/workspace/../org_config.toml`],
  ])("refuses %s, and sends none of it", async (_what, cited) => {
    const res = await open(cited);
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).toContain("org_file_refused");
    expect(body).not.toContain("private");
    expect(body).not.toContain("Acme");
  });

  it("refuses a vault and a Project config by name, even inside a workspace", async () => {
    await writeChart({ workspace: appDataDir });
    try {
      for (const cited of [
        "<app_data_dir>/.project_config.toml",
        "<app_data_dir>/agents/acme_dev/agent_state/.vault.toml",
      ]) {
        const res = await open(cited);
        expect(res.status).toBe(403);
        expect(await res.text()).not.toContain("secret");
      }
      // The same directory is otherwise the employee's, and served.
      expect((await open("<app_data_dir>/agents/acme_dev/agent_state/memo.md")).status).toBe(200);
    } finally {
      await writeChart({ workspace: external });
    }
  });

  it.skipIf(process.platform === "win32")(
    "refuses a link in a workspace that resolves to a vault, though the vault lies in a root",
    async () => {
      await writeChart({ workspace: appDataDir });
      const link = path.join(orgDir, "workspace", "keys.toml");
      await fs.symlink(
        path.join(appDataDir, "agents", "acme_dev", "agent_state", ".vault.toml"),
        link,
      );
      try {
        const res = await open(`${ORG}/workspace/keys.toml`);
        expect(res.status).toBe(403);
        expect(await res.text()).not.toContain("K='s'");
      } finally {
        await fs.rm(link);
        await writeChart({ workspace: external });
      }
    },
  );

  it("stops serving an employee's old directory once the workspace is re-pointed", async () => {
    await writeChart({ workspace: "dev" });
    try {
      expect((await open(path.join(external, "notes.md"))).status).toBe(403);
    } finally {
      await writeChart({ workspace: external });
    }
  });

  it("answers 404 for nothing at the path and for a directory, 400 for no path or a relative one", async () => {
    expect(await code(await open(`${ORG}/workspace/missing.md`))).toBe("org_file_not_found");
    expect(await code(await open(`${ORG}/workspace/growth/`))).toBe("org_file_not_found");
    expect((await open("")).status).toBe(400);
    expect(await code(await open("workspace/growth/weekly.md"))).toBe("org_file_invalid");
  });

  it("answers 404 to a caller outside the Project", async () => {
    expect((await open(`${ORG}/handbook/hiring.md`, outsider)).status).toBe(404);
  });

  it("serves an HTML file as text", async () => {
    const res = await open(`${ORG}/workspace/page.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
  });
});
