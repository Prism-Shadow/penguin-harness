/**
 * The server registry (servers.ts): nothing on it by default — no server registers itself;
 * a repeat refused by name, by normalised address, or by the install id the address answers
 * with; a registration written as one `server` line under the caller's name — and a check
 * that no concurrent registration can slip between.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { OrgActor, OrgGateway, OrgView } from "@prismshadow/penguin-server/plugin";
import { Ledger, ledgerPath } from "../src/ledger.js";
import { DeployService, ProposalService, proposalRoutes } from "../src/index.js";
import {
  identityOf,
  normalizeServerUrl,
  placeServer,
  requireUnregistered,
  serverNameOf,
  type ProbeServer,
  type ServerReading,
} from "../src/servers.js";

const PROJECT = "default_project";
const ORG = "acme";

describe("names and addresses", () => {
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

  it("refuses a malformed name; `this` is a name like any other", () => {
    expect(serverNameOf(" desk-1 ")).toBe("desk-1");
    expect(serverNameOf("this")).toBe("this");
    expect(() => serverNameOf("a b")).toThrow(expect.objectContaining({ code: "bad_request" }));
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
    { name: "desk", url: "http://localhost:53531", installId: "desk-id", at: "t", by: "agent:a" },
  ];
  const refused = (candidate: { name: string; url: string; installId: string | null }) => {
    try {
      requireUnregistered(registered, candidate);
    } catch (err) {
      return err as { code: string; message: string };
    }
    return null;
  };

  it("refuses a repeat by name, by address, and by install id — naming the entry there", () => {
    expect(refused({ name: "DESK", url: "http://h:1", installId: "n" })?.message).toContain("desk");
    expect(refused({ name: "y", url: "http://localhost:53531", installId: "n" })?.message).toContain(
      "as desk",
    );
    expect(
      refused({ name: "y", url: "http://127.0.0.1:53531", installId: "desk-id" })?.message,
    ).toContain("same server as desk");
    expect(refused({ name: "y", url: "http://h:2", installId: "n" })).toBeNull();
  });

  it("checks name and address alone before the address is read", () => {
    expect(refused({ name: "y", url: "http://localhost:53531", installId: null })?.code).toBe(
      "server_registered",
    );
    expect(refused({ name: "y", url: "http://127.0.0.1:53531", installId: null })).toBeNull();
  });
});

describe("placeServer", () => {
  const reading = (commit: string | null): ServerReading => ({
    name: "s",
    url: "http://h",
    commit,
    describe: null,
    error: null,
  });
  const layers = [
    { number: 0, head: "0".repeat(40) },
    { number: 11, head: "a".repeat(40) },
    { number: 12, head: "b".repeat(40) },
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
    expect(placeServer(reading("AAAAAAA"), layers, compare)).toMatchObject({
      at: 11,
      relation: "same",
      ahead: 0,
    });
  });

  it("sits on the nearest layer the commit contains, with the commits past it", () => {
    expect(placeServer(reading("c"), layers, compare)).toMatchObject({
      at: 11,
      relation: "ahead",
      ahead: 3,
    });
  });

  it("sits on no layer when the commit is unknown or compares with none", () => {
    expect(placeServer(reading(null), layers, compare)).toMatchObject({ at: null, relation: null });
    expect(placeServer(reading("d"), layers, compare)).toMatchObject({ at: null, relation: null });
  });
});

describe("registering over the routes", () => {
  let root: string;
  let service: ProposalService;
  let answers: Record<
    string,
    { installId: string; commit: string | null; describe: string | null } | Error
  >;

  const org: OrgView = {
    orgId: ORG,
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
    root = await fs.mkdtemp(path.join(os.tmpdir(), "proposals-servers-"));
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
      settings: { get: () => undefined, set: () => {} } as never,
      log: { line: () => {} },
      probe,
    });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const app = () => {
    const a = new Hono();
    a.use(async (c, next) => {
      c.set("user" as never, { userId: "boss" } as never);
      c.set("sessionVia" as never, "token" as never);
      await next();
    });
    // The deploy half of the routes, unused here: these tests never reach a deploy route.
    const deploys = new DeployService({
      scope: (projectId, orgId, actor) => service.deployScope(projectId, orgId, actor),
      root: os.tmpdir(),
      log: () => undefined,
    });
    a.route("/p/:projectId/o/:orgId/proposals", proposalRoutes(service, deploys));
    return a;
  };
  const call = (method: string, suffix: string, body?: unknown) =>
    app().request(`http://localhost/p/${PROJECT}/o/${ORG}/proposals${suffix}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  const lines = async () =>
    (await fs.readFile(ledgerPath(root, PROJECT, ORG), "utf8").catch(() => ""))
      .split("\n")
      .filter((l) => l !== "")
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  it("lists nothing before anything is registered: no server registers itself", async () => {
    const res = await call("GET", "/servers");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ servers: [] });
    // The answering server's own address is registered like any other, once.
    const own = await call("POST", "/servers", { name: "here", url: "http://localhost" });
    expect(own.status).toBe(200);
    const again = await call("POST", "/servers", { name: "loop", url: "http://127.0.0.1:9" });
    expect(again.status).toBe(409);
  });

  it("registers a server as one `server` line under the caller, and refuses every kind of repeat without a line", async () => {
    const ok = await call("POST", "/servers", {
      name: "desk",
      url: "http://LOCALHOST:53531/",
      agentId: "acme_dev",
    });
    expect(ok.status).toBe(200);
    const { servers } = (await ok.json()) as {
      servers: Array<{ name: string; url: string }>;
    };
    expect(servers.map((s) => [s.name, s.url])).toEqual([["desk", "http://localhost:53531"]]);
    expect(await lines()).toEqual([
      expect.objectContaining({
        kind: "server",
        name: "desk",
        url: "http://localhost:53531",
        installId: "desk-id",
        by: "agent:acme_dev",
      }),
    ]);

    for (const [body, fragment] of [
      [{ name: "desk", url: "http://h:1" }, "name desk"],
      [{ name: "again", url: "http://localhost:53531" }, "as desk"],
      [{ name: "tunnel", url: "http://127.0.0.1:53531" }, "same server as desk"],
    ] as const) {
      const res = await call("POST", "/servers", body);
      expect(res.status, JSON.stringify(body)).toBe(409);
      const err = ((await res.json()) as { error: { code: string; message: string } }).error;
      expect(err.code).toBe("server_registered");
      expect(err.message).toContain(fragment);
    }
    expect(await lines()).toHaveLength(1);
  });

  it("answers 422 for an address that is not read as a penguin server", async () => {
    const res = await call("POST", "/servers", { name: "gone", url: "http://localhost:1" });
    expect(res.status).toBe(422);
    expect(
      ((await res.json()) as { error: { code: string; message: string } }).error,
    ).toMatchObject({
      code: "server_unreachable",
      message: expect.stringContaining("ECONNREFUSED"),
    });
    expect(await lines()).toEqual([]);
  });

  it("lets only one of two concurrent registrations of the same server through", async () => {
    const both = await Promise.all([
      call("POST", "/servers", { name: "a", url: "http://localhost:53531" }),
      call("POST", "/servers", { name: "b", url: "http://127.0.0.1:53531" }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await lines()).filter((l) => l.kind === "server")).toHaveLength(1);
  });

  it("keeps the registry across a restart: the fold of the ledger file", async () => {
    await call("POST", "/servers", { name: "desk", url: "http://localhost:53531" });
    const again = new Ledger(ledgerPath(root, PROJECT, ORG));
    await again.load();
    expect(again.servers().map((s) => [s.name, s.installId])).toEqual([["desk", "desk-id"]]);
    // A line about no proposal leaves the proposals alone.
    expect(again.proposals()).toEqual([]);
  });
});
