/**
 * The machines node of a server that connects machines, as a suite stands it in: the Project's
 * machines, each with a client to its API while it is connected (null otherwise), and no forward
 * for the proxy (`/server/<id>/…` answers 503 `not_connected`). Whatever else the node offers is
 * no part of such a suite, and says so if anything reaches for it.
 *
 * A machine's client is usually {@link appApi} over a second in-process app: that app's real
 * routes, called with its admin's session, the way machines/service.ts projectApis builds one.
 */
import type { Hono } from "hono";
import type { AppEnv } from "../../src/auth/middleware.js";
import type { MachineApi } from "../../src/machines/machine-api.js";
import type { MachinesService } from "../../src/machines/service.js";

/** One machine of a Project, as projectApis lists it. */
export interface FleetMachineDouble {
  machineId: string;
  alias: string;
  api: Pick<MachineApi, "request"> | null;
}

export function fakeMachinesNode(
  projectApis: (projectId: string) => FleetMachineDouble[],
): MachinesService {
  const used = {
    start: async () => {},
    stop: () => {},
    syncConfigEverywhere: async () => {},
    proxyTarget: async () => null,
    noteApiSeen: () => {},
    projectApis: async (projectId: string) => projectApis(projectId),
  };
  return new Proxy(used, {
    get: (target, key) =>
      key in target
        ? Reflect.get(target, key)
        : key === "then"
          ? undefined
          : () => {
              throw new Error(`machines.${String(key)} is not part of this suite`);
            },
  }) as unknown as MachinesService;
}

/** A client to an in-process app's API, carrying that app's admin session on every call. */
export function appApi(app: Hono<AppEnv>, cookie: string): Pick<MachineApi, "request"> {
  return {
    request: async (method, path, body) => {
      const res = await app.request(path, {
        method,
        headers: {
          cookie,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: res.status, text: await res.text() };
    },
  };
}
