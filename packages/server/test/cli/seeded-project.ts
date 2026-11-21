/**
 * A Project as the server seeds one when it creates it: core's default config with the built-in
 * catalog's default model, group tables (none for the first-party groups) and preset rows.
 * Core carries no catalog (PRN-021), so the CLI's config commands, which talk to the server's
 * models and vault HTTP routes, find a missing file empty; these tests start from a seeded
 * Project and a lightweight in-process HTTP server bound to `root`.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach } from "vitest";
import { Hono } from "hono";
import {
  DEFAULT_PROJECT_ID,
  defaultProjectConfig,
  saveProjectConfig,
} from "@prismshadow/penguin-core";
import { wire } from "@prismshadow/penguin-core/kernel";
import {
  PRESET_DEFAULT_MODEL,
  presetModelEntries,
  presetProviderTable,
} from "@prismshadow/penguin-server/model-catalog";
import type { Access } from "@prismshadow/penguin-library-project";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import type { AppEnv } from "../../src/auth/middleware.js";
import type { Paths } from "../../src/hmr/capabilities.js";
import { handleError } from "../../src/http/errors.js";
import { modelsRoutes } from "../../src/http/routes/models.js";
import { vaultRoutes } from "../../src/http/routes/vault.js";
import type { Machines } from "../../src/machines/service.js";
import type { ChannelHub } from "../../src/runtime/channel.js";
import type { SessionManager } from "../../src/runtime/session-manager.js";
import { AgentConfigService } from "../../src/services/agent-config-service.js";
import { ProjectConfigService } from "../../src/services/project-config-service.js";

const appsByOrigin = new Map<string, Hono<AppEnv>>();
const listeners: net.Server[] = [];
let savedFetch: typeof globalThis.fetch | null = null;
let savedApiUrl: string | undefined;
let hasSavedApiUrl = false;

function buildConfigApp(root: string): Hono<AppEnv> {
  const paths = { root } as Paths;
  const projectConfigService = wire(ProjectConfigService, { paths });
  const agentConfigService = wire(AgentConfigService, { paths });
  const access = {
    requireProjectAccess: () => {},
    requireProjectOwner: () => {},
    canAccessProject: () => true,
    isProjectOwner: () => true,
  } as unknown as Access;
  const manager = { invalidateProjectRuntimes: () => {} } as unknown as SessionManager;

  const app = new Hono<AppEnv>();
  app.onError((err, c) => handleError(err, c));
  app.use("*", async (c, next) => {
    c.set("user", {
      userId: "admin",
      isAdmin: true,
      passwordIsInitial: false,
      passwordHash: "",
      displayName: null,
      avatar: null,
      createdAt: "",
    });
    c.set("sessionVia", "token");
    await next();
  });
  app.route(
    "/api/projects/:projectId/models",
    modelsRoutes({
      projectConfigService,
      access,
      machines: { syncConfigEverywhere: async () => {} } as unknown as Machines,
      channels: { peek: () => undefined } as unknown as ChannelHub,
      manager,
      sessionsRepo: { listByProject: () => [] } as unknown as SessionIndex,
    }),
  );
  app.route(
    "/api/projects/:projectId/agents/:agentId/vault",
    vaultRoutes({
      agentConfigService,
      access,
      manager,
    }),
  );
  return app;
}

/**
 * Mounts an in-process HTTP server for `root` (writes `<root>/server.lock` and routes `fetch`
 * for `http://localhost:<port>` to the models and vault Hono routes backed by `root`).
 */
export async function serveConfigRoot(root: string): Promise<void> {
  if (!hasSavedApiUrl) {
    savedApiUrl = process.env.PENGUIN_API_URL;
    hasSavedApiUrl = true;
    delete process.env.PENGUIN_API_URL;
  }
  if (savedFetch === null) {
    const origFetch = globalThis.fetch;
    savedFetch = origFetch;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const urlStr =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const origin = new URL(urlStr).origin;
      const app = appsByOrigin.get(origin);
      if (app !== undefined) {
        return app.fetch(new Request(urlStr, init));
      }
      return origFetch(input, init);
    }) as typeof globalThis.fetch;
  }

  const listener = net.createServer();
  await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
  listener.unref();
  listeners.push(listener);
  const { port } = listener.address() as net.AddressInfo;
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "server.lock"),
    `${JSON.stringify({ pid: process.pid, port, startedAt: "now" })}\n`,
  );
  fs.writeFileSync(path.join(root, "api-token"), "test-api-token\n", { mode: 0o600 });
  appsByOrigin.set(`http://localhost:${port}`, buildConfigApp(root));
}

export async function closeConfigServers(): Promise<void> {
  appsByOrigin.clear();
  while (listeners.length > 0) {
    const l = listeners.pop()!;
    await new Promise<void>((resolve) => l.close(() => resolve()));
  }
  if (savedFetch !== null) {
    globalThis.fetch = savedFetch;
    savedFetch = null;
  }
  if (hasSavedApiUrl) {
    if (savedApiUrl === undefined) delete process.env.PENGUIN_API_URL;
    else process.env.PENGUIN_API_URL = savedApiUrl;
    savedApiUrl = undefined;
    hasSavedApiUrl = false;
  }
}

afterEach(async () => {
  await closeConfigServers();
});

/** Writes the seeded Project's config under `root` and mounts the in-process config server. */
export async function seedProject(root: string, projectId = DEFAULT_PROJECT_ID): Promise<void> {
  await saveProjectConfig(root, projectId, {
    ...defaultProjectConfig(),
    default_model: { ...PRESET_DEFAULT_MODEL },
    providers: presetProviderTable(),
    models: presetModelEntries(),
  });
  await serveConfigRoot(root);
}
