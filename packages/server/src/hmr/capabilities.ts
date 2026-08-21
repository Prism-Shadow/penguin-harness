/**
 * The runtime→platform capability contract: what the runtime publishes through the
 * resource registry for the booting platform to claim.
 *
 * The registry is the only channel the kernel offers a booting platform (ctx carries
 * `resources`, nothing else), and everything here is published for one of two reasons:
 *
 * - it is runtime MECHANISM the platform must not re-implement (authentication, the SSE
 *   channel hub, the proxy dispatcher — a pushed bundle carries its own copy of every
 *   module, so a bundle-side `applyProxySettings` would configure the bundle's undici
 *   instance while `globalThis.fetch` still routes through the runtime's);
 * - or it is a live object that must be ONE per process (the SQLite handle — web.db is
 *   single-writer; the ServerConfig object — the listen callback writes the real port
 *   back into it and every reader must observe that write).
 *
 * A host that publishes none of this can build no business surface — the capability being
 * absent IS the signal. What the platform does with that signal depends on who is asking:
 * a bare kernel says so ({@link BARE_KERNEL_RESOURCE_ID}) and gets a terminals-only App,
 * while anything else is REFUSED (../hmr/platform.ts's create). A runtime too old to
 * publish capabilities is not a bare kernel: it still answers the business API out of its
 * own older routes, so a terminals-only App there would leave a freshly pushed frontend
 * talking to the previous version's API — one atomic push landing as half a version.
 *
 * The reverse direction is ONE entry: the pointer to the current App ({@link
 * PlatformCurrent}) — deps, route table and graceful wrap-up published together in a
 * single registry write.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Resources } from "@prismshadow/penguin-core/kernel";
import type { ServerConfig } from "../config.js";
import type { AuthService } from "../auth/service.js";
import type { ChannelHub } from "../runtime/channel.js";
import type { ProxySettings } from "../net/proxy.js";
import type { HmrHost } from "../hmr/host.js";
import type { DesktopService } from "../services/desktop-service.js";
import type { AppDeps } from "../app.js";

/**
 * What one side of the seam speaks: a family, and a Go-style structural interface per
 * name — the member set a consumer depends on, not a version number.
 *
 * Live objects cannot be strict-parsed the way a parked context document is (a claim is a
 * cast), so this descriptor is the agreement that stands in for a schema. It is
 * structural for the same reason the kernel's iface is (see boot()'s method-set check):
 * satisfaction is implicit — anything carrying those members satisfies it — and it can be
 * verified against the LIVE object rather than trusted. A number cannot be: it says
 * nothing about what is actually there, it has to be remembered and bumped by hand, and
 * every bump is global, so widening `db` would decline a bundle that only ever touches
 * `terminal`. A member set narrows that automatically: adding a member cannot break a
 * consumer that never named it, and removing one is caught by name at the claim.
 *
 * `family` names whose vocabulary these interface names belong to. Two descriptors of
 * different families share nothing — the same name means something else over there — so a
 * platform that does not want to inherit penguin's interfaces changes its family and
 * inherits none of them, rather than having to disagree with each entry one by one.
 */
export interface Interfaces {
  /** Whose vocabulary the names below belong to; {@link PENGUIN_FAMILY} for this build. */
  family: string;
  /** The members a consumer of that interface depends on. */
  [name: string]: string | readonly string[];
}

/**
 * Member names of `T`, checked by the compiler: a name `T` does not carry is an error
 * here, so a rename or a removal breaks the build at the declaration instead of drifting
 * into a descriptor that describes a shape nothing has. This is what keeps a hand-written
 * member set honest — the runtime check in {@link lacksMembers} verifies the live object,
 * and this verifies the list itself against the type it claims to describe.
 *
 * Names only: a changed SIGNATURE is out of reach of both checks, since the wire form is
 * strings. That is the documented limit of a structural descriptor carried across a
 * module boundary.
 */
export type MembersOf<T> = readonly (keyof T & string)[];

/** The family the interfaces this repo defines belong to. */
export const PENGUIN_FAMILY = "penguin";

/**
 * The interfaces the RUNTIME publishes for a platform to claim: per `runtime:*`
 * capability, the members a claimer reaches for. The runtime registers this descriptor
 * and a bundle checks it — and the live objects behind it — against the copy compiled
 * into itself, so a mismatch declines the claim at boot instead of surfacing as a
 * TypeError inside a request or a sweep timer.
 *
 * `proxy` is a bare callable: an empty member set means "nothing beyond being there".
 */
interface RuntimeInterfaces extends Interfaces {
  family: string;
  config: MembersOf<ServerConfig>;
  db: MembersOf<DatabaseSync>;
  auth: MembersOf<AuthService>;
  channels: MembersOf<ChannelHub>;
  proxy: MembersOf<ProxyControl>;
  hmr: MembersOf<HmrHost>;
  desktop: MembersOf<DesktopService>;
}

export const RUNTIME_INTERFACES: RuntimeInterfaces = {
  family: PENGUIN_FAMILY,
  config: [
    "root",
    "host",
    "port",
    "dbPath",
    "webDist",
    "previewOrigin",
    "seedAdminPassword",
    "authSessionTtlMs",
    "authSessionRenewMs",
    "desktopToken",
    "portFile",
    "trustProxy",
  ],
  db: ["prepare", "exec", "close"],
  auth: [
    "authenticateWithMeta",
    "seedAdmin",
    "adminPasswordIsInitial",
    "login",
    "logout",
    "changePassword",
    "loginDesktop",
    "setPasswordDesktop",
  ],
  channels: ["get", "peek", "broadcast", "dispose"],
  proxy: [],
  hmr: ["resources", "ensure", "resolveWebSource", "dispose"],
  desktop: ["onShutdownRequest", "requestShutdown", "verifyToken", "redeemLoginToken"],
};

export const RUNTIME_INTERFACES_RESOURCE_ID = "runtime:interfaces";

/** The member set an entry names, or [] when the entry is absent or is the family tag. */
function members(descriptor: Interfaces, name: string): readonly string[] | undefined {
  const entry = descriptor[name];
  return Array.isArray(entry) ? entry : undefined;
}

/**
 * The mismatch between what a side offers and what the claimer requires, or null when
 * every required interface is offered with at least the members named. Go semantics: the
 * offering side may carry more, never less. A different family short-circuits — the names
 * are not comparable at all.
 */
export function interfaceMismatch(
  offered: Interfaces | undefined,
  required: Interfaces,
): string | null {
  if (offered === undefined) return "no interface descriptor published";
  if (offered.family !== required.family) {
    return `family '${String(offered.family)}' != '${String(required.family)}'`;
  }
  for (const name of Object.keys(required)) {
    if (name === "family") continue;
    const need = members(required, name) ?? [];
    const have = members(offered, name);
    if (have === undefined) return `${name}: not offered`;
    const missing = need.filter((m) => !have.includes(m));
    if (missing.length > 0) return `${name}: missing ${missing.join(", ")}`;
  }
  return null;
}

/**
 * Whether a live object actually carries the members its interface names — the same check
 * boot() runs on an impl against its iface, applied to a claimed capability. This is what
 * a structural descriptor buys over a number: the declaration is verified, not trusted.
 */
export function lacksMembers(value: unknown, need: readonly string[]): string[] {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return [...need];
  }
  return need.filter((m) => (value as Record<string, unknown>)[m] === undefined);
}

export const RUNTIME_CONFIG_RESOURCE_ID = "runtime:config";
export const RUNTIME_DB_RESOURCE_ID = "runtime:db";
export const RUNTIME_AUTH_RESOURCE_ID = "runtime:auth-service";
export const RUNTIME_CHANNELS_RESOURCE_ID = "runtime:channels";
export const RUNTIME_PROXY_RESOURCE_ID = "runtime:proxy-control";
export const RUNTIME_HMR_RESOURCE_ID = "runtime:hmr-host";
/**
 * Desktop mode's one service (one-shot login + shutdown token holder). Registered even
 * when null: desktop-ness is the runtime's lifecycle fact, but the business surface
 * reads it too (`/api/me` reports desktopMode; single-user mode closes the multi-user
 * admin surfaces), so the claim must distinguish "not desktop" from "not published".
 */
export const RUNTIME_DESKTOP_RESOURCE_ID = "runtime:desktop";
/** Test-only: BuildDepsOverrides published by bootAppDeps for the platform boot to claim. */
export const RUNTIME_OVERRIDES_RESOURCE_ID = "runtime:overrides";

/**
 * Published by a host that has no business runtime behind it at all and knows it — a bare
 * kernel (the reconciliation and plugin tests). It makes a terminals-only platform legal:
 * without it, a boot that cannot claim the capabilities is refused rather than degraded,
 * because the shape it would otherwise silently produce on a too-old SERVER runtime is a
 * new frontend in front of that runtime's older business routes.
 *
 * Deliberately colon-free, for the same reason the interface declaration is: an ID without
 * a group is never swept by disposeGroup, so it survives every swap that reads it.
 */
export const BARE_KERNEL_RESOURCE_ID = "bare-kernel";
/** Reverse direction: THE pointer to the current App (see {@link PlatformCurrent}). */
export const PLATFORM_CURRENT_RESOURCE_ID = "platform:current";

/**
 * The {@link Interfaces} descriptor each App leaves for its successor, naming the
 * live-object contracts it parks by ID-prefix group (`terminal` covers every `terminal:*`
 * entry). The NEXT App's create() compares it against its own compiled-in declaration and
 * integrates a group only at the SAME version and family, hard-stopping the rest (reverse
 * registration order) before it adopts anything. Riding the registry, not the kernel
 * iface, keeps the swap mechanism untouched and the policy itself hot-pushable.
 *
 * Deliberately colon-free: an ID without a group can never be swept by disposeGroup —
 * the declaration must outlive the App that wrote it (its dispose effect does NOT
 * release it) to inform the successor.
 */
export const RESOURCE_IFACES_RESOURCE_ID = "resource-interfaces";

/**
 * The one object a swap publishes — deps, route table and wrap-up together, so flipping
 * to a new App is a single registry write and no reader can ever see a half-swapped pair
 * (new deps with the old routes, or the reverse). Everything runtime-side that needs the
 * current App resolves this pointer at use time: the seam middleware dispatches into
 * `app`, auth late-binds provisioning through `deps`, index.ts's shutdown awaits
 * `shutdown`.
 */
export interface PlatformCurrent {
  /** The business deps this App built, or null when the runtime published no capabilities. */
  deps: AppDeps | null;
  /** The App's whole Hono route table (terminal + business), fetch-shaped for cross-bundle safety. */
  app: { fetch(request: Request): Response | Promise<Response> };
  /** Process-exit graceful drain (manager ≤5s wrap-up); absent when no business runs. */
  shutdown?: () => Promise<void>;
}

/** Applies proxy settings to the RUNTIME's global dispatcher (see net/proxy.ts). */
export type ProxyControl = (settings: ProxySettings) => void;

/** Everything buildAppDeps needs, claimed in one place. */
export interface RuntimeCapabilities {
  config: ServerConfig;
  db: DatabaseSync;
  authService: AuthService;
  channels: ChannelHub;
  proxyControl: ProxyControl;
  hmr: HmrHost;
  /** Null on a non-desktop server (a real value, not an absent capability). */
  desktop: DesktopService | null;
}

/**
 * Claims the full capability set, or null when any piece is missing — a partial claim would
 * build a business surface over half a runtime, which is worse than not building one. Null
 * is not a mode to run in unless the host declared itself a bare kernel; see the caller
 * (../hmr/platform.ts's create).
 */
export function claimRuntimeCapabilities(resources: Resources): RuntimeCapabilities | null {
  // The handshake first: a runtime speaking different interfaces (or one too old to
  // publish a descriptor at all) must not be claimed against — the members behind the IDs
  // are exactly what the descriptor stands for.
  const mismatch = interfaceMismatch(
    resources.claim<Interfaces>(RUNTIME_INTERFACES_RESOURCE_ID),
    RUNTIME_INTERFACES,
  );
  if (mismatch !== null) {
    console.warn(`[platform] runtime interfaces: ${mismatch}; declining the claim`);
    return null;
  }
  const config = resources.claim<ServerConfig>(RUNTIME_CONFIG_RESOURCE_ID);
  const db = resources.claim<DatabaseSync>(RUNTIME_DB_RESOURCE_ID);
  const authService = resources.claim<AuthService>(RUNTIME_AUTH_RESOURCE_ID);
  const channels = resources.claim<ChannelHub>(RUNTIME_CHANNELS_RESOURCE_ID);
  const proxyControl = resources.claim<ProxyControl>(RUNTIME_PROXY_RESOURCE_ID);
  const hmr = resources.claim<HmrHost>(RUNTIME_HMR_RESOURCE_ID);
  if (!config || !db || !authService || !channels || !proxyControl || !hmr) return null;
  // Desktop is nullable by meaning, so it sits outside the all-present check.
  const desktop = resources.claim<DesktopService | null>(RUNTIME_DESKTOP_RESOURCE_ID) ?? null;
  // …then the objects themselves. A descriptor is a claim about what is there; this is
  // the part that checks it, so an honest-but-wrong runtime is caught here rather than at
  // the first call site. `desktop` is exempt when null — that is a value, not a shortfall.
  const live: Array<[string, unknown]> = [
    ["config", config],
    ["db", db],
    ["auth", authService],
    ["channels", channels],
    ["proxy", proxyControl],
    ["hmr", hmr],
    ...(desktop === null ? [] : ([["desktop", desktop]] as Array<[string, unknown]>)),
  ];
  for (const [name, value] of live) {
    const need = RUNTIME_INTERFACES[name];
    if (!Array.isArray(need)) continue;
    const lacking = lacksMembers(value, need);
    if (lacking.length > 0) {
      console.warn(`[platform] runtime ${name} lacks ${lacking.join(", ")}; declining the claim`);
      return null;
    }
  }
  return { config, db, authService, channels, proxyControl, hmr, desktop };
}
