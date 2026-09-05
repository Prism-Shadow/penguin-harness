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
 * What a booting platform does when the capabilities are missing or wrong — refuse, or
 * run terminals-only for a declared bare kernel — is {@link RuntimeClaim}'s story, below.
 *
 * There is no reverse direction here: the runtime reaches the current App through the
 * instance `hmr.ensure()` already returns (in-process api members), never through the
 * registry.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Resources, Opaque, ModuleClass } from "@prismshadow/penguin-core/kernel";
import type { ServerConfig } from "../config.js";
import type { AuthRuntimeState } from "../auth/runtime-state.js";
import { newAuthRuntimeState } from "../auth/runtime-state.js";
import type { ChannelHub, Channel } from "../runtime/channel.js";
import type { ProxySettings } from "../net/proxy.js";
import type { HmrHost } from "./host.js";
import type { DesktopService } from "../services/desktop-service.js";
import type { LifecycleService } from "../services/lifecycle-service.js";
import { Interface, Component, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";

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
  channels: MembersOf<ChannelHub>;
  proxy: MembersOf<ProxyControl>;
  hmr: MembersOf<HmrHost>;
  desktop: MembersOf<DesktopService>;
  lifecycle: MembersOf<LifecycleService>;
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
    "supervised",
  ],
  db: ["prepare", "exec", "close"],
  channels: ["get", "peek", "broadcast", "dispose", "setActivityProbe"],
  proxy: [],
  hmr: ["resources", "ensure", "resolveWebSource", "assetsDir", "dispose"],
  // The replacement seam (Replacements): production publishes [], tests publish the nodes
  // they stand in for. Presence-only — a list has no members to verify.
  overrides: [],
  desktop: ["onShutdownRequest", "requestShutdown", "verifyToken", "redeemLoginToken"],
  lifecycle: ["supervised", "onRestartRequest", "requestRestart"],
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
/**
 * Process-scoped auth STATE (auth/runtime-state.ts), not an auth service: authentication is
 * business behaviour the platform builds for itself, so it ships by push. Only the values that
 * must ride across a swap and die at a restart live here. Claimed optionally — a runtime older
 * than this resource simply gives the platform a fresh holder, which costs one reprint of the
 * first-login link and nothing else.
 */
export const RUNTIME_AUTH_STATE_RESOURCE_ID = "runtime:auth-state";
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
/**
 * Process lifecycle (services/lifecycle-service.ts): whether a supervisor relaunches this
 * process, and the restart trigger. Always published — the platform's restart route needs
 * a definite "nobody would relaunch me" to refuse with, not a missing capability.
 */
export const RUNTIME_LIFECYCLE_RESOURCE_ID = "runtime:lifecycle";
/** Test-only: the node Replacements published by bootAppDeps for the platform boot to claim. */
export const RUNTIME_OVERRIDES_RESOURCE_ID = "runtime:overrides";

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

/*
 * There is deliberately NO reverse-direction registry entry. The runtime already holds
 * the current App — it is `hmr.ensure()`'s instance — and everything it needs from the
 * business side is an in-process member on that instance's api (`business()`,
 * `shutdown()`, `drained()`) or a hook the App installs over a claimed capability
 * (ChannelHub.setActivityProbe). A "current App" pointer in
 * the registry was a duplicate of the host's own instance field, and the registry should
 * carry only what has no other channel: resources, capabilities, and the contract
 * declarations about them.
 */

/** Applies proxy settings to the RUNTIME's global dispatcher (see net/proxy.ts). */
export type ProxyControl = (settings: ProxySettings) => void;

/** Everything buildAppDeps needs, claimed in one place. */
export interface RuntimeCapabilities {
  config: ServerConfig;
  db: DatabaseSync;
  /** Process-scoped auth values; the AuthService itself is built per App (see buildAppDeps). */
  authState: AuthRuntimeState;
  channels: ChannelHub;
  proxyControl: ProxyControl;
  hmr: HmrHost;
  /** Null on a non-desktop server (a real value, not an absent capability). */
  desktop: DesktopService | null;
  lifecycle: LifecycleService;
  /** Nodes a test stands in for (see Replacements); [] outside tests. */
  replacements: Replacements;
}

/**
 * The outcome of asking the host what it is, decided entirely by what it published:
 *
 * - `claimed` — a descriptor of this family offering the full capability set, with every
 *   live object carrying the members the descriptor names.
 * - `bare` — a descriptor of this family offering NONE of the capabilities: the host's
 *   own declaration that there is no business runtime behind it (a bare kernel in
 *   tests). Terminals-only is legal there. The declaration rides the descriptor the
 *   handshake already reads — a host that offers nothing SAYS so, in the same document
 *   every host describes itself in, rather than through a side-channel marker.
 * - `refused` — everything else, with the reason: no descriptor (a runtime too old for
 *   the handshake), a different family, a partial offer, or a live object that does not
 *   carry what the descriptor promised. Booting a business platform over any of these
 *   would put a new frontend in front of an older runtime's own routes.
 */
export type RuntimeClaim =
  | { kind: "claimed"; caps: RuntimeCapabilities }
  | { kind: "bare" }
  | { kind: "refused"; reason: string };

export function claimRuntimeCapabilities(resources: Resources): RuntimeClaim {
  const offered = resources.claim<Interfaces>(RUNTIME_INTERFACES_RESOURCE_ID);
  if (offered === undefined) {
    return { kind: "refused", reason: "no interface descriptor published" };
  }
  if (offered.family !== RUNTIME_INTERFACES.family) {
    return {
      kind: "refused",
      reason: `family '${String(offered.family)}' != '${String(RUNTIME_INTERFACES.family)}'`,
    };
  }
  // A family-matching descriptor that offers none of the required capabilities IS the
  // bare-kernel declaration; offering SOME of them is a broken runtime, refused below.
  const required = Object.keys(RUNTIME_INTERFACES).filter((name) => name !== "family");
  if (required.every((name) => members(offered, name) === undefined)) {
    return { kind: "bare" };
  }
  const mismatch = interfaceMismatch(offered, RUNTIME_INTERFACES);
  if (mismatch !== null) return { kind: "refused", reason: mismatch };
  const config = resources.claim<ServerConfig>(RUNTIME_CONFIG_RESOURCE_ID);
  const db = resources.claim<DatabaseSync>(RUNTIME_DB_RESOURCE_ID);
  const channels = resources.claim<ChannelHub>(RUNTIME_CHANNELS_RESOURCE_ID);
  const proxyControl = resources.claim<ProxyControl>(RUNTIME_PROXY_RESOURCE_ID);
  const hmr = resources.claim<HmrHost>(RUNTIME_HMR_RESOURCE_ID);
  const lifecycle = resources.claim<LifecycleService>(RUNTIME_LIFECYCLE_RESOURCE_ID);
  if (!config || !db || !channels || !proxyControl || !hmr || !lifecycle) {
    return { kind: "refused", reason: "a declared capability was not actually published" };
  }
  // Desktop is nullable by meaning, so it sits outside the all-present check.
  const desktop = resources.claim<DesktopService | null>(RUNTIME_DESKTOP_RESOURCE_ID) ?? null;
  const replacements = resources.claim<Replacements>(RUNTIME_OVERRIDES_RESOURCE_ID) ?? [];
  // Optional by design (see the resource's own note): an older runtime published no such
  // holder, and a fresh one is a correct, slightly forgetful substitute. A runtime older
  // than this platform may also publish a holder missing the fields added since; they are
  // filled IN PLACE, never by copying — the bag is shared with the runtime by identity, and
  // a copy would strand every write the App makes to it.
  const authState =
    resources.claim<AuthRuntimeState>(RUNTIME_AUTH_STATE_RESOURCE_ID) ?? newAuthRuntimeState();
  authState.firstLoginToken ??= null;
  authState.apiToken ??= null;
  // …then the objects themselves. A descriptor is a claim about what is there; this is
  // the part that checks it, so an honest-but-wrong runtime is caught here rather than at
  // the first call site. `desktop` is exempt when null — that is a value, not a shortfall.
  const live: Array<[string, unknown]> = [
    ["config", config],
    ["db", db],
    ["channels", channels],
    ["proxy", proxyControl],
    ["hmr", hmr],
    ["lifecycle", lifecycle],
    ...(desktop === null ? [] : ([["desktop", desktop]] as Array<[string, unknown]>)),
  ];
  for (const [name, value] of live) {
    const need = RUNTIME_INTERFACES[name];
    if (!Array.isArray(need)) continue;
    const lacking = lacksMembers(value, need);
    if (lacking.length > 0) {
      return { kind: "refused", reason: `runtime ${name} lacks ${lacking.join(", ")}` };
    }
  }
  return {
    kind: "claimed",
    caps: { config, db, authState, channels, proxyControl, hmr, desktop, lifecycle, replacements },
  };
}

/**
 * What the runtime publishes, as the tree sees it. The runtime registers live objects in
 * the resource registry; the platform claims them once and hands each to a node of its own
 * (RuntimeDb, RuntimeChannels, …) that provides it under an interface declared here. Every
 * other node reaches the runtime only through these — `@Use() db!: Db` — so what a bundle
 * needs from its host is written down and checked, not assumed.
 */

/** The process configuration object — one per process; the listen callback writes the real port into it. */
export abstract class Config extends Interface<ServerConfig>() {}

/** The SQLite handle (single-writer, one per process). Statements are host objects. */
export abstract class Db extends Interface<{
  prepare(sql: string): Opaque<"StatementSync", ReturnType<DatabaseSync["prepare"]>>;
  exec(sql: string): void;
  close(): void;
}>() {}

/** One SSE channel (the class in runtime/channel.ts satisfies this). */
export type ChannelApi = Pick<Channel, "publish" | "sendTo" | "subscribe" | "replayAfter">;

export abstract class Channels extends Interface<{
  get(key: string): ChannelApi;
  peek(key: string): ChannelApi | undefined;
  broadcast(prefix: string, data: unknown, event?: string): void;
  dispose(): void;
  setActivityProbe(probe: (key: string) => boolean): void;
}>() {}
/** Compile-time proof the hub satisfies the contract. */
export type _ChannelsCheck = ChannelHub extends Channels ? true : never;

/** The global fetch dispatcher's settings — runtime-owned, since a bundle's own undici is not the one `globalThis.fetch` routes through. */
export abstract class Proxy extends Interface<{
  apply(settings: ProxySettings): void;
}>() {}

/** The hot-update host: the cross-generation resource registry and the current App. */
export abstract class Hmr extends Interface<{
  resources: Resources;
  ensure(): Promise<Opaque<"PlatformInstance", Awaited<ReturnType<HmrHost["ensure"]>>>>;
  resolveWebSource(): Opaque<
    "WebSource",
    NonNullable<ReturnType<HmrHost["resolveWebSource"]>>
  > | null;
  assetsDir(): string | null;
  dispose(): void;
}>() {}
export type _HmrCheck = HmrHost extends Hmr ? true : never;

export type DesktopApi = Pick<
  DesktopService,
  | "verifyToken"
  | "redeemLoginToken"
  | "onShutdownRequest"
  | "requestShutdown"
  | "getUpdateStatus"
  | "setUpdateStatus"
  | "onUpdateCommand"
  | "requestUpdateCommand"
>;

/** The desktop shell's service, or null when this server is not the shell's child. */
export abstract class Desktop extends Interface<{
  current(): DesktopApi | null;
}>() {}

export abstract class AuthState extends Interface<AuthRuntimeState>() {}

/** Process lifecycle: whether a supervisor relaunches this process, and the restart trigger. */
export abstract class Lifecycle extends Interface<
  Pick<LifecycleService, "supervised" | "onRestartRequest" | "requestRestart">
>() {}

export abstract class Log extends Interface<{
  line(text: string): void;
}>() {}

/**
 * Whether a registry resource group inherited from the previous App may be adopted — the
 * platform node decides from the resource-interfaces declaration (hmr/platform.ts); a
 * module that parks handles asks before claiming them back.
 */
export abstract class ResourceGroups extends Interface<{
  adoptable(group: string): boolean;
}>() {}

/** A clock every node reads time through; a test replaces it. */
export abstract class Clock extends Interface<{ now(): Date }>() {}

/** Where the data lives — what most nodes actually want from the config. */
export abstract class Paths extends Interface<{ root: string }>() {}

/**
 * A replacement for one node of the tree: the class the platform would build, and the
 * instance to boot in its place. Tests publish these (bootAppDeps) for the platform to
 * claim; production publishes none. A replacement is checked exactly like the node it
 * stands in for — the table says what the class provides, the instance has to have it.
 */
export type Replacements = ReadonlyArray<readonly [ModuleClass, object]>;

/**
 * The claimed capabilities enter the tree one node each, so a consumer names the one it
 * needs and nothing else. They are the only classes with constructor arguments; the
 * platform pre-builds their instances (platform.ts) from the claim, which is the one
 * place the registry is read.
 */
@Module()
export class RuntimeConfig {
  @Provide() config!: Config;
  constructor(private readonly caps: RuntimeCapabilities) {}
  setup() {
    this.config = this.caps.config;
  }
}
@Module()
export class RuntimeDb {
  @Provide() db!: Db;
  constructor(private readonly caps: RuntimeCapabilities) {}
  setup() {
    this.db = this.caps.db;
  }
}
@Module()
export class RuntimeChannels {
  @Provide() channels!: Channels;
  constructor(private readonly caps: RuntimeCapabilities) {}
  setup() {
    this.channels = this.caps.channels;
  }
}
@Module()
export class RuntimeProxy {
  @Provide() proxy!: Proxy;
  constructor(private readonly caps: RuntimeCapabilities) {}
  setup() {
    this.proxy = { apply: this.caps.proxyControl };
  }
}
@Module()
export class RuntimeHmr {
  @Provide() hmr!: Hmr;
  constructor(private readonly caps: RuntimeCapabilities) {}
  setup() {
    this.hmr = this.caps.hmr;
  }
}
@Module()
export class RuntimeDesktop {
  @Provide() desktop!: Desktop;
  constructor(private readonly caps: RuntimeCapabilities) {}
  setup() {
    const { desktop } = this.caps;
    this.desktop = { current: () => desktop };
  }
}
@Module()
export class RuntimeLifecycle {
  @Provide() lifecycle!: Lifecycle;
  constructor(private readonly caps: RuntimeCapabilities) {}
  setup() {
    this.lifecycle = this.caps.lifecycle;
  }
}
@Module()
export class RuntimeAuthState {
  @Provide() authState!: AuthState;
  constructor(private readonly caps: RuntimeCapabilities) {}
  setup() {
    this.authState = this.caps.authState;
  }
}
@Module()
export class RuntimeResourceGroups {
  @Provide() resourceGroups!: ResourceGroups;
  constructor(private readonly adoptable: (group: string) => boolean) {}
  setup() {
    this.resourceGroups = { adoptable: this.adoptable };
  }
}

/** The process log; a test replaces it with a sink. */
@Component()
export class ConsoleLog implements Log {
  line(text: string): void {
    console.log(text);
  }
}

/** Wall-clock time; a test replaces it with a frozen one. */
@Component()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** The data root, read off the config. */
@Component()
export class ConfigPaths implements Paths {
  @Use() private readonly config!: Config;
  get root(): string {
    return this.config.root;
  }
}
