/**
 * The machines API: who may use it, what the list answers, and the install job's lifecycle
 * as the Machines page sees it — start, poll, finish, and every way a start is refused
 * before an ssh runs.
 *
 * The service's three reaching-out effects are faked (see MachinesEffects): the real ones
 * read the developer's own ~/.ssh/config and spawn ssh against whatever it names. What the
 * push actually does over ssh is covered by machines-push.test.ts, against a fake ssh
 * binary and the real installOnRemote.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MachinesResponse } from "../src/api/types.js";
import { MachinesService } from "../src/machines/service.js";
import type { MachinesEffects } from "../src/machines/service.js";
import type { RemoteInstallOutcome } from "../src/machines/install-server.js";
import type { RemoteIdentity } from "../src/machines/detect.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const IDENTITY: RemoteIdentity = {
  platform: "linux",
  arch: "x64",
  nodeVersion: "v24.0.0",
  installedVersion: null,
};

/** An effects set that names two hosts and installs successfully, with the parts a test cares about overridden. */
function effects(over: Partial<MachinesEffects> = {}): Partial<MachinesEffects> {
  return {
    listAliases: () => ["build-box", "nas"],
    resolveTarget: async (alias) => ({
      alias,
      settings: {
        user: "deploy",
        hostname: `${alias}.example`,
        port: 22,
        identityFiles: [],
        proxyJump: null,
      },
      machine: `deploy@${alias}`,
    }),
    resolveImage: () => ({ version: "9.9.9", pack: () => Buffer.alloc(0) }),
    install: async (opts): Promise<RemoteInstallOutcome> => {
      opts.onProgress?.("Pushing…");
      return { kind: "installed", output: "done", identity: IDENTITY };
    },
    ...over,
  };
}

describe("machines API", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;

  const boot = async (over: Partial<MachinesEffects> = {}) => {
    t = await createTestApp({
      machines: new MachinesService("/tmp/penguin-test-root", effects(over)),
    });
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
  };

  afterEach(async () => {
    await t.cleanup();
  });

  describe("permission", () => {
    beforeEach(() => boot());

    it("is admin-only: a provisioned user gets 403", async () => {
      const user = await provisionUser(t.app, "member");
      const member = apiClient(t.app, user.cookie);
      expect((await member.get("/api/machines")).status).toBe(403);
      expect((await member.post("/api/machines/ssh:nas/install")).status).toBe(403);
    });

    it("needs a session at all", async () => {
      expect((await t.app.request("/api/machines")).status).toBe(401);
    });
  });

  describe("the list", () => {
    it("is the ssh config's aliases, with the version this server would push", async () => {
      await boot();
      const body = (await (await admin.get("/api/machines")).json()) as MachinesResponse;
      expect(body.machines).toEqual([
        { id: "ssh:build-box", alias: "build-box" },
        { id: "ssh:nas", alias: "nas" },
      ]);
      expect(body.imageVersion).toBe("9.9.9");
      expect(body.job).toBeNull();
    });

    it("an empty or unreadable ssh config is a list of none, not an error", async () => {
      await boot({ listAliases: () => [] });
      const res = await admin.get("/api/machines");
      expect(res.status).toBe(200);
      expect(((await res.json()) as MachinesResponse).machines).toEqual([]);
    });

    it("reports no image when this server has none to push", async () => {
      await boot({ resolveImage: () => null });
      const body = (await (await admin.get("/api/machines")).json()) as MachinesResponse;
      expect(body.imageVersion).toBeNull();
    });
  });

  describe("installing", () => {
    it("starts a job, narrates it, and finishes", async () => {
      // Held open so the 202 is observed mid-flight, which is the real shape: a push takes
      // minutes, and the page has to render a running job from this very body.
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await boot({
        install: async (opts) => {
          opts.onProgress?.("Pushing…");
          await held;
          return { kind: "installed", output: "done", identity: IDENTITY };
        },
      });
      const started = await admin.post("/api/machines/ssh:nas/install");
      expect(started.status).toBe(202);
      expect(((await started.json()) as MachinesResponse).job).toMatchObject({
        machineId: "ssh:nas",
        alias: "nas",
        running: true,
        result: null,
      });

      release();
      await waitFor(() => t.deps.machines.job()?.running === false);
      const body = (await (await admin.get("/api/machines")).json()) as MachinesResponse;
      expect(body.job?.result).toEqual({ ok: true, kind: "installed", version: "9.9.9" });
      // The first line is this server's own, the rest are the push's.
      expect(body.job?.log[0]).toBe("Installing 9.9.9 on deploy@nas…");
      expect(body.job?.log).toContain("Pushing…");
    });

    it("reports the far side's own words when the push fails", async () => {
      await boot({
        install: async () => ({
          kind: "failed",
          step: "connect",
          detail: "Permission denied (publickey).",
        }),
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toEqual({
        ok: false,
        step: "connect",
        message: "Permission denied (publickey).",
      });
    });

    it("a machine already on this version is a result, not a failure", async () => {
      await boot({
        install: async () => ({ kind: "already-installed", version: "9.9.9", identity: IDENTITY }),
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toEqual({
        ok: true,
        kind: "already-installed",
        version: "9.9.9",
      });
    });

    it("a throw from the push path still ends the job", async () => {
      await boot({
        install: () => {
          throw new Error("scp vanished");
        },
      });
      await admin.post("/api/machines/ssh:nas/install");
      await waitFor(() => t.deps.machines.job()?.running === false);
      expect(t.deps.machines.job()?.result).toMatchObject({ ok: false, message: "scp vanished" });
    });
  });

  describe("refusals decided before any ssh runs", () => {
    it("409s a second install while one is running", async () => {
      let release = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await boot({
        install: async () => {
          await held;
          return { kind: "installed", output: "", identity: IDENTITY };
        },
      });
      expect((await admin.post("/api/machines/ssh:nas/install")).status).toBe(202);
      const second = await admin.post("/api/machines/ssh:build-box/install");
      expect(second.status).toBe(409);
      expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
        "install_running",
      );
      release();
      await waitFor(() => t.deps.machines.job()?.running === false);
    });

    it("404s a host this server's config does not declare", async () => {
      await boot();
      const res = await admin.post("/api/machines/ssh:not-in-config/install");
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "unknown_machine",
      );
      expect(t.deps.machines.job()).toBeNull();
    });

    it("409s when this server carries no install image", async () => {
      await boot({ resolveImage: () => null });
      const res = await admin.post("/api/machines/ssh:nas/install");
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "no_install_image",
      );
    });

    it("502s a host ssh itself cannot resolve", async () => {
      await boot({ resolveTarget: async () => null });
      const res = await admin.post("/api/machines/ssh:nas/install");
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "unresolvable_host",
      );
    });
  });
});
