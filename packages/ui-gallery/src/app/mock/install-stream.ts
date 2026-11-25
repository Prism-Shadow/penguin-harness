/**
 * A server install in the demo: what the Project's plugin list becomes (`landInstall`), and the
 * same install read as it arrives (`installStream`) — the event stream the server answers an
 * install with, scripted: `npm`, the registry check, the registry tried, the release channel's
 * download in ticks, the App's re-assembly, then `result` or `error`.
 *
 * A plugin the build ships is listed with no download. A market package the fixtures script
 * (`marketInstalls`) either lands its library plugin or fails part-way through its download; any
 * other name is refused, as a build that does not carry it would.
 *
 * The waits are real timers, so the Web App's stages show the way they do against a server, and
 * a browser check that owns the clock can stand on any of them. Under Node (the tests) nothing
 * waits.
 */
import type { InstalledPluginsResponse } from "@prismshadow/penguin-server/api";
import { ApiError } from "./errors";
import type { DemoStore } from "./store";

/** How long each scripted step stands, in ms. */
const STEP_MS = { checking: 900, registry: 1400, tick: 220, loading: 1200 } as const;
/** The download arrives in this many ticks. */
const TICKS = 16;

const wait = (ms: number) =>
  typeof window === "undefined"
    ? Promise.resolve()
    : new Promise<void>((resolve) => setTimeout(resolve, ms));

const specifierOf = (body: unknown): string => {
  const value = (body as { specifier?: unknown } | null)?.specifier;
  // `name@version` installs that version of the name; a scope's own `@` leads the name.
  const text = typeof value === "string" ? value : "";
  const at = text.lastIndexOf("@");
  return at > 0 ? text.slice(0, at) : text;
};

/** Lists the package for the Project, landing its library plugin; refuses what cannot install. */
export function landInstall(store: DemoStore, body: unknown): InstalledPluginsResponse {
  const specifier = specifierOf(body);
  const listed = store.f.installedPlugins;
  const scripted = store.f.marketInstalls[specifier];
  const shipped = listed.shipped.includes(specifier);
  if (!shipped && scripted === undefined) {
    throw new ApiError(404, "plugin_not_shipped", "This build does not ship that plugin.");
  }
  if (scripted?.fails !== undefined) {
    throw new ApiError(400, "plugin_install_failed", scripted.fails.message);
  }
  if (!listed.plugins.some((p) => p.specifier === specifier)) {
    listed.plugins.push({
      specifier,
      active: !shipped,
      builtin: shipped,
      modules: [],
      replaces: [],
      everywhere: true,
      machines: [],
      here: true,
    });
    if (shipped) listed.restartPending = true;
  }
  const lands = scripted?.lands;
  if (lands !== undefined) {
    const group = store.f.library.groups.find((g) => g.id === scripted?.category);
    if (group !== undefined && !group.plugins.some((p) => p.name === lands.name)) {
      group.plugins.push(lands);
    }
  }
  return {
    ...listed,
    modules: store.f.pluginModules,
    ...(lands !== undefined
      ? {
          installed: {
            name: specifier,
            version: lands.version ?? null,
            library: true,
            modules: true,
            from: "channel" as const,
          },
        }
      : {}),
  };
}

/** The install as the server streams it: a `text/event-stream` Response the page reads. */
export function installStream(store: DemoStore, body: unknown): Response {
  const encoder = new TextEncoder();
  const specifier = specifierOf(body);
  const scripted = store.f.marketInstalls[specifier];
  const machineId = (body as { machineId?: unknown } | null)?.machineId;
  const listed = store.f.installedPlugins;
  const here = typeof machineId !== "string" || machineId === listed.machineId;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      try {
        send("npm", {});
        if (scripted !== undefined && here) {
          send("stage", { stage: "checking" });
          await wait(STEP_MS.checking);
          send("stage", { stage: "installing", source: "registry" });
          await wait(STEP_MS.registry);
          send("stage", { stage: "installing", source: "channel" });
          const stopAt = scripted.fails?.at ?? 1;
          for (let tick = 0; tick <= TICKS && tick / TICKS <= stopAt; tick += 1) {
            send("download", {
              received: Math.round((scripted.bytes * tick) / TICKS),
              total: scripted.bytes,
            });
            await wait(STEP_MS.tick);
          }
        }
        // A failing script, and a name nothing can install, refuse before anything loads.
        const installs = scripted !== undefined || listed.shipped.includes(specifier);
        if (installs && scripted?.fails === undefined) {
          send("stage", { stage: "loading" });
          await wait(STEP_MS.loading);
        }
        send("result", landInstall(store, body));
      } catch (error) {
        const failure =
          error instanceof ApiError
            ? { status: error.status, code: error.code, message: error.message }
            : { status: 500, code: "internal_error", message: String(error) };
        send("error", failure);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8" },
  });
}
