/**
 * The deployment registry (deployments.ts): nothing on it by default — no server registers
 * itself; a deployment is an id, and a penguin server deployment also has a url; a repeat
 * refused by id, by normalised url, or by the install id the url answers with; a registration
 * written as one `deployment` line of the organization's deployments.jsonl under the caller's
 * name, through the `target.register` Action — and a check that no concurrent registration can
 * slip between.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import { DeploymentStore, deploymentsPath } from "../src/deploy-store.js";
import { ProposalService } from "../src/index.js";
import { actionApp, proposalContributions, type ActionApp } from "./action-harness.js";
import {
  deploymentIdOf,
  identityOf,
  normalizeServerUrl,
  placeDeployment,
  readDeployments,
  requireUnregistered,
  type DeploymentReading,
  type ProbeServer,
} from "../src/deployments.js";

const PROJECT = "default_project";
const ORG = "acme";

describe("ids and urls", () => {
  it("normalises an address so two spellings of one compare equal", () => {
    expect(normalizeServerUrl("HTTP://LocalHost:80/")).toBe("http://localhost");
    expect(normalizeServerUrl(" http://localhost:53531/ ")).toBe("http://localhost:53531");
    expect(normalizeServerUrl("https://h.example:443/base//")).toBe("https://h.example/base");
  });

  it("refuses an address that is not http(s), carries credentials, a query or a fragment", () => {
    for (const bad of ["ftp://h", "http://u:p@h", "http://h/?a=1", "http://h/#x", "not a url"]) {
      expect(() => normalizeServerUrl(bad), bad).toThrow(expect.objectContaining({ status: 400 }));
    }
  });

  it("refuses a malformed id; `this` is an id like any other", () => {
    expect(deploymentIdOf(" desk-1 ")).toBe("desk-1");
    expect(deploymentIdOf("this")).toBe("this");
    expect(() => deploymentIdOf("a b")).toThrow(expect.objectContaining({ code: "bad_request" }));
  });

  it("reads an install answer, and refuses one without an id", () => {
    expect(identityOf({ installId: "i", commit: "abc1234", describe: "v1-1-gabc1234" })).toEqual({
      installId: "i",
      commit: "abc1234",
      describe: "v1-1-gabc1234",
    });
    // A server older than the commit fields still has an id.
    expect(identityOf({ installId: "i" })).toEqual({
      installId: "i",
      commit: null,
      describe: null,
    });
    expect(() => identityOf({ installId: null })).toThrow(/no install id/);
    expect(() => identityOf("<html>")).toThrow(/no install id/);
  });
});

describe("requireUnregistered", () => {
  const registered = [
    { id: "desk", url: "http://localhost:53531", installId: "desk-id", at: "t", by: "agent:a" },
    { id: "firmware", url: null, installId: null, at: "t", by: "agent:a" },
  ];
  const refused = (candidate: { id: string; url: string | null; installId: string | null }) => {
    try {
      requireUnregistered(registered, candidate);
    } catch (err) {
      return err as { code: string; message: string };
    }
    return null;
  };

  it("refuses a repeat by id, by url, and by install id — naming the entry there", () => {
    expect(refused({ id: "DESK", url: "http://h:1", installId: "n" })?.message).toContain("desk");
    expect(refused({ id: "Firmware", url: null, installId: null })?.message).toContain("firmware");
    expect(refused({ id: "y", url: "http://localhost:53531", installId: "n" })?.message).toContain(
      "as desk",
    );
    expect(
      refused({ id: "y", url: "http://127.0.0.1:53531", installId: "desk-id" })?.message,
    ).toContain("same server as desk");
    expect(refused({ id: "y", url: "http://h:2", installId: "n" })).toBeNull();
    // Two deployments without a url are two deployments: only the id tells them apart.
    expect(refused({ id: "board", url: null, installId: null })).toBeNull();
  });

  it("checks id and url alone before the url is read", () => {
    expect(refused({ id: "y", url: "http://localhost:53531", installId: null })?.code).toBe(
      "deployment_registered",
    );
    expect(refused({ id: "y", url: "http://127.0.0.1:53531", installId: null })).toBeNull();
  });
});

describe("placeDeployment", () => {
  const reading = (commit: string | null): DeploymentReading => ({
    id: "s",
    url: "http://h",
    commit,
    describe: null,
    error: null,
  });
  const layers = [
    { key: "", head: "0".repeat(40) },
    { key: "feat/a", head: "a".repeat(40) },
    { key: "feat/b", head: "b".repeat(40) },
  ];
  const compare = (from: string, to: string) =>
    (
      ({
        [`${"0".repeat(40)}...c`]: { relation: "ahead", ahead: 5 },
        [`${"a".repeat(40)}...c`]: { relation: "ahead", ahead: 3 },
        [`${"b".repeat(40)}...c`]: { relation: "diverged", ahead: 1 },
      }) as Record<string, { relation: "ahead" | "diverged"; ahead: number }>
    )[`${from}...${to}`];

  it("sits on the layer whose head the commit is, by a short sha too", () => {
    expect(placeDeployment(reading("AAAAAAA"), layers, compare)).toMatchObject({
      at: "feat/a",
      relation: "same",
      ahead: 0,
    });
  });

  it("sits on the nearest layer the commit contains, with the commits past it", () => {
    expect(placeDeployment(reading("c"), layers, compare)).toMatchObject({
      at: "feat/a",
      relation: "ahead",
      ahead: 3,
    });
  });

  it("sits on no layer when the commit is unknown or compares with none", () => {
    expect(placeDeployment(reading(null), layers, compare)).toMatchObject({
      at: null,
      relation: null,
    });
    expect(placeDeployment(reading("d"), layers, compare)).toMatchObject({
      at: null,
      relation: null,
    });
  });
});

describe("readDeployments", () => {
  it("reads a server deployment over its url, and says why a deployment without one has no commit", async () => {
    const asked: string[] = [];
    const probe: ProbeServer = async (url) => {
      asked.push(url);
      return { installId: "desk-id", commit: "abc1234", describe: "v1-1-gabc1234" };
    };
    const read = await readDeployments(
      [
        { id: "desk", url: "http://h:1", installId: "desk-id", at: "t", by: "agent:a" },
        { id: "firmware", url: null, installId: null, at: "t", by: "agent:a" },
      ],
      probe,
    );
    expect(asked).toEqual(["http://h:1"]);
    expect(read).toEqual([
      { id: "desk", url: "http://h:1", commit: "abc1234", describe: "v1-1-gabc1234", error: null },
      {
        id: "firmware",
        url: null,
        commit: null,
        describe: null,
        error: "the deployment has no url, so nothing reports the commit it runs",
      },
    ]);
  });
});

describe("registering over the routes", () => {
  let root: string;
  let service: ProposalService;
  let harness: ActionApp | undefined;
  let answers: Record<
    string,
    { installId: string; commit: string | null; describe: string | null } | Error
  >;

  const org: OrgView = {
    projectId: PROJECT,
    orgId: ORG,
    machineId: null,
    userIds: ["boss"],
    employees: [{ agentId: "acme_dev" }],
  } as unknown as OrgView;
  const gateway = {
    companyModeEnabled: () => true,
    organization: async (_p: string, o: string) => (o === ORG ? org : null),
    principalOf: async (_p: string, _o: string, actor: OrgActor) =>
      actor.agentId !== undefined ? `agent:${actor.agentId}` : `user:${actor.userId}`,
  } as unknown as OrgGateway;
  const probe: ProbeServer = async (url) => {
    const a = answers[url];
    if (a === undefined) throw new Error("connect ECONNREFUSED");
    if (a instanceof Error) throw a;
    return a;
  };

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "proposals-deployments-"));
    harness = undefined;
    answers = {
      "http://localhost": { installId: "self-id", commit: "a".repeat(40), describe: "v1" },
      "http://localhost:53531": {
        installId: "desk-id",
        commit: "abc1234",
        describe: "v1-1-gabc1234",
      },
      "http://127.0.0.1:53531": {
        installId: "desk-id",
        commit: "abc1234",
        describe: "v1-1-gabc1234",
      },
      "http://127.0.0.1:9": { installId: "self-id", commit: null, describe: null },
    };
    service = new ProposalService({
      gateway,
      agents: { pluginVersion: async () => null, updatePlugin: async () => {} } as never,
      root,
      log: { line: () => {} },
      probe,
    });
  });
  afterEach(async () => {
    harness?.registry.stop();
    service.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  /**
   * The registry's reads and its one write: GET …/proposals/deployments, and the
   * `target.register` Action standing for what POST …/deployments was. A write answers like
   * the route did: the Action's result, or its refusal.
   */
  const call = async (method: string, suffix: string, body?: Record<string, unknown>) => {
    const a = (harness ??= actionApp({
      gateway,
      root,
      project: PROJECT,
      org: ORG,
      contributions: proposalContributions(service),
      service,
    }));
    if (method === "GET") {
      return a.app.request(`http://localhost/p/${PROJECT}/o/${ORG}/proposals${suffix}`);
    }
    const { agentId, ...params } = body ?? {};
    const actor: OrgActor = {
      userId: "boss",
      ...(typeof agentId === "string" ? { agentId } : {}),
    };
    const { status, body: answer } = await a.run("target.register", "organization", params, actor);
    return {
      status,
      json: async () => (status === 200 ? answer.result : answer),
    };
  };
  const lines = async () =>
    (await fs.readFile(deploymentsPath(root, PROJECT, ORG), "utf8").catch(() => ""))
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  it("lists nothing before anything is registered: no server registers itself", async () => {
    const res = await call("GET", "/deployments");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deployments: [] });
    // The answering server's own url is registered like any other, once.
    const own = await call("POST", "/deployments", { id: "here", url: "http://localhost" });
    expect(own.status).toBe(200);
    const again = await call("POST", "/deployments", { id: "loop", url: "http://127.0.0.1:9" });
    expect(again.status).toBe(409);
  });

  it("registers a server deployment as one `deployment` line with its url under the caller, and refuses every kind of repeat without a line", async () => {
    const ok = await call("POST", "/deployments", {
      id: "desk",
      url: "http://LOCALHOST:53531/",
      agentId: "acme_dev",
    });
    expect(ok.status).toBe(200);
    const { deployments } = (await ok.json()) as {
      deployments: Array<{ id: string; url: string | null; installId: string | null }>;
    };
    expect(deployments.map((d) => [d.id, d.url, d.installId])).toEqual([
      ["desk", "http://localhost:53531", "desk-id"],
    ]);
    expect(await lines()).toEqual([
      expect.objectContaining({
        kind: "deployment",
        id: "desk",
        url: "http://localhost:53531",
        installId: "desk-id",
        by: "agent:acme_dev",
      }),
    ]);

    for (const [body, fragment] of [
      [{ id: "desk", url: "http://h:1" }, "id desk"],
      [{ id: "desk" }, "id desk"],
      [{ id: "again", url: "http://localhost:53531" }, "as desk"],
      [{ id: "tunnel", url: "http://127.0.0.1:53531" }, "same server as desk"],
    ] as const) {
      const res = await call("POST", "/deployments", body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      const err = ((await res.json()) as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("deployment_registered");
      expect(err.message).toContain(fragment);
    }
    expect(await lines()).toHaveLength(1);
  });

  it("registers a deployment without a url as its id alone, reading nothing", async () => {
    answers = {};
    const ok = await call("POST", "/deployments", { id: "firmware", agentId: "acme_dev" });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      deployments: [
        {
          id: "firmware",
          url: null,
          installId: null,
          registeredAt: expect.any(String),
          by: "agent:acme_dev",
        },
      ],
    });
    const written = await lines();
    expect(written).toHaveLength(1);
    expect(written[0]).not.toHaveProperty("url");
    expect(written[0]).not.toHaveProperty("installId");
    const repeat = await call("POST", "/deployments", { id: "FIRMWARE" });
    expect(repeat.status).toBe(409);
  });

  it("answers 422 for a url that is not read as a penguin server", async () => {
    const res = await call("POST", "/deployments", { id: "gone", url: "http://localhost:1" });
    expect(res.status).toBe(422);
    expect(
      ((await res.json()) as { error: { code: string; message: string } }).error,
    ).toMatchObject({
      code: "deployment_unreachable",
      message: expect.stringContaining("ECONNREFUSED"),
    });
    expect(await lines()).toEqual([]);
  });

  it("lets only one of two concurrent registrations of the same server through", async () => {
    const both = await Promise.all([
      call("POST", "/deployments", { id: "a", url: "http://localhost:53531" }),
      call("POST", "/deployments", { id: "b", url: "http://127.0.0.1:53531" }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await lines()).filter((l) => l.kind === "deployment")).toHaveLength(1);
  });

  it("keeps the registry across a restart: its own deployments.jsonl, apart from the proposals", async () => {
    await call("POST", "/deployments", { id: "desk", url: "http://localhost:53531" });
    await call("POST", "/deployments", { id: "firmware" });
    const again = new DeploymentStore(deploymentsPath(root, PROJECT, ORG));
    expect((await again.list()).map((d) => [d.id, d.url, d.installId])).toEqual([
      ["desk", "http://localhost:53531", "desk-id"],
      ["firmware", null, null],
    ]);
    // The lines keep their shape: a seq, the time, the kind, who.
    expect((await lines()).map((l) => [l.seq, l.kind, typeof l.at, l.by])).toEqual([
      [1, "deployment", "string", "user:boss"],
      [2, "deployment", "string", "user:boss"],
    ]);
  });
});
