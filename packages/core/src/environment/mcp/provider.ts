/**
 * McpToolProvider — connects the configured MCP Servers and bridges their tools into
 * Environment as BuiltinTool instances.
 *
 * Naming: every MCP tool is exposed to the LLM as `mcp__<server>__<tool>`, which keeps the
 * flat tool namespace collision-free (builtin names never carry the prefix, and the server
 * name — validated to a safe alphabet — separates servers from each other).
 *
 * Lifecycle: connection and tool discovery are lazy and single-flight — `Environment.listTools()`
 * triggers a connect phase for every configured server that has no live connection; the
 * pending servers connect in parallel, each bounded by its `connectTimeoutMs`. A server that
 * fails to connect (or an invalid config entry) is reported as a stderr warning and skipped —
 * MCP problems never break Session creation, matching Environment's stance on unrecognized
 * builtin tool names. A server the Agent's vault cannot set up (a `${KEY}` it references is
 * missing) or that needs an OAuth sign-in is never contacted: every phase reports it as a
 * failed result carrying its reason, without a transport ever being built. Discovery is a
 * snapshot per connection: `tools/list_changed` notifications are ignored. When a compaction
 * opens the next model context, `reconfigure` keeps every connection whose resolved entry —
 * vault values included — is unchanged (no respawn, no re-discovery), closes the removed or
 * changed ones, and leaves the new or changed ones pending for the next phase.
 *
 * A server may repeat what it was sent when it fails — a refusal quoting the request line or
 * a header, a process printing its environment on stderr — so every error text reported for a
 * server (the warning, the connect result the Trace records, a failed call's message the model
 * reads) carries its vault values as their `${KEY}` references.
 *
 * Execution: a call is bridged to `client.callTool` with the Environment-merged abort
 * signal passed through. The SDK's own per-request timeout is pushed out of the way
 * (`MAX_SDK_TIMEOUT_MS`) so Environment stays the single timekeeper — its per-tool
 * `timeoutMs` (server entry override or Environment default) aborts the signal, which
 * cancels the in-flight request. Result content maps as: text blocks → output text; image
 * blocks → `images` data URLs; audio/binary-resource blocks → placeholder lines;
 * `structuredContent` is serialized only when no text block was present; `isError` →
 * `stopReason: "fatal"`. Permission for the frontend's read-only mode comes from the
 * spec's `readOnlyHint` annotation (`true` → `"r"`, anything else → `"rw"` — hints are
 * untrusted, so the default is the restrictive direction), unless the entry sets an
 * explicit `permission`, which then applies to every tool of that server.
 * Docs: /docs/tools § "MCP servers".
 */
import {
  Client,
  SSEClientTransport,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { CallToolResult, FetchLike, Tool, Transport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { McpServerConnectResult, OmniMessage } from "../../omnimessage/index.js";
import { VERSION } from "../../index.js";
import type {
  ConfinedSpawn,
  MCPServerConfig,
  SpawnConfiner,
  ToolDefinition,
  ToolPermission,
} from "../../interfaces/index.js";
import type { BuiltinTool, ToolResult } from "../tools/types.js";
import {
  mcpSkipMessage,
  resolveMCPServers,
  type ResolvedMCPServer,
  type SkippedMCPServer,
} from "./config.js";

/** Prefix marking a tool as MCP-provided; the full form is `mcp__<server>__<tool>`. */
export const MCP_TOOL_PREFIX = "mcp__";

/** Builds the LLM-visible name of an MCP tool. */
export function mcpToolName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${serverName}__${toolName}`;
}

/**
 * What LLM APIs accept as a tool name (the strictest common contract: `[a-zA-Z0-9_-]`,
 * ≤128 chars). MCP itself does not restrict tool names — `slack.postMessage`-style names
 * exist in the wild — and ONE unusable name in the schema list would 400 every request of
 * the Session, so tools that don't fit are skipped with a warning (never block, matching
 * the module's warn-and-skip stance).
 */
const LLM_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

/**
 * Largest delay setTimeout can represent (~24.8 days): used as the SDK per-request timeout
 * so it never fires before Environment's own tool timeout, which is the single authority
 * (it aborts the shared signal; a larger value would overflow to an immediate fire).
 */
const MAX_SDK_TIMEOUT_MS = 2_147_483_647;

/** Rolling stderr tail kept per stdio server for connect-failure diagnostics (chars). */
const STDERR_TAIL_LIMIT = 2048;

/**
 * MCP handshake client info; informational only (shows up in server logs). A function,
 * not a const: the VERSION import is circular (index → agent → environment → here), so
 * the live binding must be read at connect time, after every module has evaluated —
 * a top-level read would hit the temporal dead zone.
 */
function clientInfo(): { name: string; version: string } {
  return { name: "penguin-harness", version: VERSION };
}

export interface McpToolProviderOptions {
  /** Session Workspace: the default working directory for stdio server processes. */
  workspaceDir?: string;
  /**
   * The Session's sandbox (see {@link EnvironmentConfig.confineSpawn}): a stdio server is a
   * process the harness starts for the Session, so its argv goes through the same confiner
   * a command's does, re-read at every start. A confiner that cannot enforce the policy
   * fails that server's connect — reported like any other connect failure — and the server
   * never starts unconfined. Absent, or a getter returning null = servers start unconfined.
   */
  confineSpawn?: () => SpawnConfiner | null;
  /** The Session's scratchpad, the confiner's scope beside the Workspace. */
  scratchpadDir?: string;
  /**
   * The Agent's vault, read for the `${KEY}` references of the entries (see config.ts); a
   * reference it cannot fill skips that server as "needs setup". Absent = an empty vault.
   */
  vault?: Readonly<Record<string, string>>;
  /** Warning sink; defaults to a `[penguin]`-prefixed stderr line. */
  warn?: (message: string) => void;
}

/** One connected server: its client and the executable wrappers built from the usable tools discovered on it (registered into the toolset in config order, see `rebuildRegistry`). */
interface McpConnection {
  server: ResolvedMCPServer;
  client: Client;
  wrappers: BuiltinTool[];
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A server's vault values, each with the key it fills, longest first: what its error texts are cleaned of. */
type VaultValues = ReadonlyArray<readonly [key: string, value: string]>;

/**
 * The shortest vault value an error text is cleaned of. A shorter one — a region such as `us`,
 * a flag, a port — is no secret, and replacing it would garble the text wherever those letters
 * occur ("stat${REGION}").
 */
const MIN_REDACTED_LENGTH = 6;

/**
 * `text` with every vault value the server was given — as written, percent-encoded as a URL
 * carries it, or escaped as JSON quotes it — replaced by its `${KEY}` reference. A server's
 * failure can repeat what it was sent (a refusal quoting the request line or a header, a
 * process printing its environment on stderr), and the text lands in the warning, the
 * connect result of the Trace and the tool result the model reads.
 */
function redactVaultValues(text: string, values: VaultValues): string {
  let out = text;
  for (const [key, value] of values) {
    if (value.length < MIN_REDACTED_LENGTH) continue;
    const forms = new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]);
    for (const form of forms) out = out.split(form).join(`\${${key}}`);
  }
  return out;
}

/**
 * `err` as it may leave the provider: itself when its message holds none of the server's vault
 * values (an abort stays the very error that classifies it), otherwise a plain Error of the
 * same name with the cleaned message — and nothing else of the original, whose other fields (an
 * HTTP error's body, a cause) can hold the values too.
 */
function redactError(err: unknown, values: VaultValues): unknown {
  const message = describeError(err);
  const clean = redactVaultValues(message, values);
  if (clean === message) return err;
  const out = new Error(clean);
  if (err instanceof Error) out.name = err.name;
  return out;
}

/** Wraps global fetch to add the configured headers to every request (stream GET and POSTs alike). */
function fetchWithHeaders(headers: Record<string, string>): FetchLike {
  return (url, init) => {
    const merged = new Headers(init?.headers);
    for (const [key, value] of Object.entries(headers)) {
      if (!merged.has(key)) merged.set(key, value);
    }
    return fetch(url, { ...init, headers: merged });
  };
}

/**
 * Flattens a CallToolResult into Environment's output shape: joined text plus data-URL
 * images. Defensive against loosely-shaped blocks — an unknown block type becomes a
 * placeholder line instead of an exception.
 */
export function renderCallToolResult(result: CallToolResult): { text: string; images: string[] } {
  const parts: string[] = [];
  const images: string[] = [];
  for (const block of result.content ?? []) {
    const b = block as Record<string, unknown>;
    switch (b["type"]) {
      case "text":
        if (typeof b["text"] === "string") parts.push(b["text"]);
        break;
      case "image":
        images.push(`data:${String(b["mimeType"])};base64,${String(b["data"])}`);
        break;
      case "audio":
        parts.push(`[audio content: ${String(b["mimeType"])}]`);
        break;
      case "resource_link":
        parts.push(
          `[resource: ${String(b["uri"])}]` +
            (typeof b["description"] === "string" ? ` ${b["description"]}` : ""),
        );
        break;
      case "resource": {
        const resource = b["resource"] as Record<string, unknown> | undefined;
        if (resource && typeof resource["text"] === "string") {
          parts.push(resource["text"]);
        } else {
          parts.push(`[resource: ${String(resource?.["uri"] ?? "unknown")} (binary)]`);
        }
        break;
      }
      default:
        parts.push(`[unsupported content type: ${String(b["type"])}]`);
    }
  }
  let text = parts.join("\n");
  // Servers with an outputSchema may return structured output only; serialize it rather
  // than handing the model an empty result (when text blocks exist they already carry the
  // serialized form per spec guidance, so this stays duplication-free).
  if (text === "" && result.structuredContent !== undefined) {
    text = JSON.stringify(result.structuredContent, null, 2);
  }
  return { text, images };
}

export class McpToolProvider {
  /** The servers of the current model context to connect (config order, vault references filled in); replaced by `reconfigure`. */
  private servers: ResolvedMCPServer[] = [];
  /** The valid servers of the current model context that cannot connect yet (needs setup, sign-in): reported at every phase, never contacted. */
  private skipped: SkippedMCPServer[] = [];
  /** Every configured server's name, connectable or skipped, in config order: the order the phase results follow. */
  private order: string[] = [];
  private configWarnings: string[] = [];
  /** The vault the current server list was resolved against: where a server's values are looked up to keep them out of its error texts. */
  private vault: Readonly<Record<string, string>> = {};
  private readonly workspaceDir: string | undefined;
  private readonly confineSpawn: (() => SpawnConfiner | null) | undefined;
  private readonly scratchpadDir: string | undefined;
  private readonly warn: (message: string) => void;
  /** Single-flight connect+discovery of the servers still pending; resolved results live in the fields below. */
  private ensurePromise: Promise<void> | null = null;
  /** Attempt token + abort handle of the in-flight connect; cancelConnect() invalidates the token so a cancelled attempt registers nothing. */
  private attempt = 0;
  private connectAbort: AbortController | null = null;
  /** Live connections, kept across `reconfigure` while their entry is unchanged, and closed by close(). */
  private connections: McpConnection[] = [];
  /** Full tool name (`mcp__server__tool`) → executable wrapper. */
  private readonly byName = new Map<string, BuiltinTool>();
  /** LLM-facing definitions in stable server-config order. */
  private defs: ToolDefinition[] = [];
  /** Per-server outcomes of the latest connect phase (config order) — every server on the first phase, only the pending ones after a `reconfigure`; feeds the mcp_connect_end event. */
  private results: McpServerConnectResult[] = [];
  private closed = false;

  constructor(entries: MCPServerConfig[], options?: McpToolProviderOptions) {
    this.configure(entries, options?.vault ?? {});
    this.workspaceDir = options?.workspaceDir;
    this.confineSpawn = options?.confineSpawn;
    this.scratchpadDir = options?.scratchpadDir;
    this.warn = options?.warn ?? ((message) => process.stderr.write(`[penguin] ${message}\n`));
  }

  /** Connects the pending servers (once per phase) and returns the LLM-facing definitions of every discovered MCP tool. */
  async listTools(): Promise<ToolDefinition[]> {
    await this.ensure();
    return this.defs;
  }

  /**
   * Configured servers without a live connection — never connected yet, failed on their
   * last phase, changed by `reconfigure`, or skipped (needs setup, sign-in): the ones the next
   * listTools() will contact or report. Empty once every configured server is connected.
   */
  pendingServerNames(): string[] {
    const connected = new Set(this.connections.map((c) => c.server.name));
    return this.order.filter((name) => !connected.has(name));
  }

  /** Per-server outcomes of the latest connect phase; empty before it completed, and after a phase that had nothing to connect. */
  connectResults(): McpServerConnectResult[] {
    return this.results;
  }

  /**
   * Replaces the server list for a new model context, keeping what it can: a server whose
   * resolved config is unchanged keeps its live connection and discovered tools — no
   * respawn, no re-discovery — a removed or changed server is closed, and a new or changed
   * one connects lazily on the next listTools(), exactly like a first connect, bounded by
   * its own connectTimeoutMs. A server that failed last time is pending again, so a rotation
   * retries it. Not for use while a connect is in flight (the composition layer calls it
   * between turns, after the first run's connect completed).
   */
  reconfigure(entries: MCPServerConfig[], vault: Readonly<Record<string, string>> = {}): void {
    this.configure(entries, vault);
    // The resolved server is plain data produced by one resolver — vault values filled in, so
    // a changed value reconnects — and its JSON is a stable identity for "the same entry".
    const wanted = new Map(this.servers.map((s) => [s.name, JSON.stringify(s)]));
    const kept: McpConnection[] = [];
    for (const conn of this.connections) {
      if (wanted.get(conn.server.name) === JSON.stringify(conn.server)) kept.push(conn);
      else void conn.client.close().catch(() => {});
    }
    this.connections = kept;
    this.ensurePromise = null;
    this.results = [];
    this.rebuildRegistry();
  }

  /** Resolves a server list against the vault into the connectable servers, the skipped ones and the config warnings, keeping config order across both. */
  private configure(entries: MCPServerConfig[], vault: Readonly<Record<string, string>>): void {
    const resolved = resolveMCPServers(entries, vault);
    this.vault = vault;
    this.servers = resolved.servers;
    this.skipped = resolved.skipped;
    this.configWarnings = resolved.warnings;
    const rank = new Map<string, number>();
    entries.forEach((entry, index) => {
      if (typeof entry?.name === "string" && !rank.has(entry.name)) rank.set(entry.name, index);
    });
    this.order = [...this.servers.map((s) => s.name), ...this.skipped.map((s) => s.name)].sort(
      (a, b) => rank.get(a)! - rank.get(b)!,
    );
  }

  /** The vault values `server` was given, longest first (see redactVaultValues). */
  private vaultValuesOf(server: ResolvedMCPServer): VaultValues {
    return (server.vaultKeys ?? [])
      .filter((key) => Object.hasOwn(this.vault, key))
      .map((key) => [key, this.vault[key]!] as const)
      .sort((a, b) => b[1].length - a[1].length);
  }

  /**
   * Resolves an executable wrapper by full tool name; connects first if discovery has not
   * run yet (executeTool can arrive without a prior listTools on embedder-driven runs).
   * Non-MCP names resolve to undefined without triggering a connect.
   */
  async resolveTool(name: string): Promise<BuiltinTool | undefined> {
    if (!name.startsWith(MCP_TOOL_PREFIX)) return undefined;
    await this.ensure();
    return this.byName.get(name);
  }

  /** Permission of a discovered MCP tool (undefined before discovery or for unknown names). */
  toolPermission(name: string): ToolPermission | undefined {
    const def = this.byName.get(name)?.definition;
    return def?.permission;
  }

  /** Closes every connected client (stdio child processes included). Idempotent. */
  async close(): Promise<void> {
    this.closed = true;
    const open = this.connections.splice(0);
    await Promise.allSettled(open.map((conn) => conn.client.close()));
  }

  /** Fire-and-forget close for Environment's synchronous dispose(). */
  closeQuietly(): void {
    void this.close().catch(() => {});
  }

  private ensure(): Promise<void> {
    this.ensurePromise ??= this.connectAll();
    return this.ensurePromise;
  }

  /**
   * Cancels the in-flight connect attempt (a user abort mid-connect): pending SDK
   * connects are aborted, connections the attempt already established are closed, and
   * the provider resets to the unconnected state — the next listTools() reconnects from
   * scratch. A no-op when no attempt is in flight (an already-connected provider keeps
   * its toolset).
   */
  cancelConnect(): void {
    if (this.ensurePromise === null || this.connectAbort === null) return;
    this.attempt += 1;
    this.connectAbort.abort();
    this.connectAbort = null;
    this.ensurePromise = null;
    this.results = [];
    // Connections the cancelled attempt established are closed by connectAll itself once it
    // settles (it sees the stale attempt token); the ones kept from an earlier phase stay.
    this.rebuildRegistry();
  }

  private async connectAll(): Promise<void> {
    for (const warning of this.configWarnings) this.warn(warning);
    const connected = new Set(this.connections.map((c) => c.server.name));
    const pending = this.servers.filter((s) => !connected.has(s.name));
    const attempt = ++this.attempt;
    const ac = new AbortController();
    this.connectAbort = ac;
    // Connect the pending servers in parallel, then register in config order so tool listing
    // order is stable. Each server's outcome (status + wall time, feeding the mcp_connect_end
    // event) is recorded either way; a failure also keeps the existing warning behavior.
    const settled = await Promise.all(
      pending.map(
        async (server): Promise<{ conn: McpConnection | null; result: McpServerConnectResult }> => {
          const startedAt = performance.now();
          const durationMs = (): number => Math.round(performance.now() - startedAt);
          try {
            const conn = await this.connectServer(server, ac.signal);
            return {
              conn,
              result: {
                server: server.name,
                transport: server.transport.kind,
                status: "completed",
                duration_ms: durationMs(),
                // What actually joined the toolset (duplicates and LLM-unusable names are
                // skipped), keeping the count consistent with tool_list_ready.
                tools: conn.wrappers.length,
              },
            };
          } catch (err) {
            const aborted = ac.signal.aborted;
            // The failure may repeat what the server was sent: its vault values go back to
            // their references before the text is printed or recorded.
            const detail = redactVaultValues(describeError(err), this.vaultValuesOf(server));
            if (!aborted) {
              this.warn(`MCP server "${server.name}" unavailable: ${detail}`);
            }
            return {
              conn: null,
              result: {
                server: server.name,
                transport: server.transport.kind,
                status: aborted ? "aborted" : "fatal",
                duration_ms: durationMs(),
                ...(aborted
                  ? {}
                  : { error_code: "connect_failed" as const, error_message: detail }),
              },
            };
          }
        },
      ),
    );
    if (attempt !== this.attempt) {
      // Cancelled while settling: close whatever connected and register nothing — the
      // next attempt starts from scratch.
      for (const { conn } of settled) {
        if (conn) void conn.client.close().catch(() => {});
      }
      throw new Error("MCP connect cancelled");
    }
    this.connectAbort = null;
    // A skipped server is a failed result of every phase, with its reason — key names only —
    // and no time spent: nothing was contacted.
    const skippedResults = this.skipped.map((server): McpServerConnectResult => {
      const message = mcpSkipMessage(server.skip);
      this.warn(`MCP server "${server.name}" skipped: ${message}`);
      return {
        server: server.name,
        transport: server.transport,
        status: "fatal",
        duration_ms: 0,
        error_code:
          server.skip.reason === "needs_setup" ? "mcp_needs_setup" : "mcp_sign_in_required",
        error_message: message,
      };
    });
    this.results = [...settled.map((s) => s.result), ...skippedResults].sort(
      (a, b) => this.order.indexOf(a.server) - this.order.indexOf(b.server),
    );
    for (const { conn, result } of settled) {
      if (!conn) continue;
      if (this.closed) {
        void conn.client.close().catch(() => {});
        continue;
      }
      this.connections.push(conn);
    }
    this.rebuildRegistry();
  }

  /** Rebuilds the name → wrapper map and the definition list from the live connections, in config order (kept connections keep their place; a closed server's tools drop out). */
  private rebuildRegistry(): void {
    this.byName.clear();
    this.defs = [];
    const byServer = new Map(this.connections.map((c) => [c.server.name, c]));
    for (const server of this.servers) {
      const conn = byServer.get(server.name);
      if (!conn) continue;
      for (const wrapper of conn.wrappers) {
        this.byName.set(wrapper.name, wrapper);
        this.defs.push({
          name: wrapper.name,
          description: wrapper.definition.description,
          ...(wrapper.definition.parameters !== undefined
            ? { parameters: wrapper.definition.parameters }
            : {}),
        });
      }
    }
  }

  private async connectServer(
    server: ResolvedMCPServer,
    signal?: AbortSignal,
  ): Promise<McpConnection> {
    const client = new Client(clientInfo());
    let stderrTail = "";
    let transport: Transport;
    const t = server.transport;
    if (t.kind === "stdio") {
      const cwd = t.cwd ?? this.workspaceDir;
      // The server's argv under the Session's sandbox, exactly as a command's: confined
      // before anything starts, so a policy nothing can enforce is this server's connect
      // failure and not a server running outside the sandbox.
      const confined = this.confine([t.command, ...t.args], cwd);
      const [command, ...args] = confined.argv;
      if (command === undefined) throw new Error("sandbox: the confiner returned an empty argv");
      const stdio = new StdioClientTransport({
        command,
        args,
        // Safe inherited defaults plus the entry's own env — and nothing else: the Agent
        // vault is deliberately NOT injected into MCP server processes (unlike command
        // subprocesses); a variable a server needs must be listed in the entry's env, where
        // a `${KEY}` reference names the vault value it takes (filled in by the resolver).
        // The SDK defaults are an allowlist (HOME/PATH/SHELL-class names only), so the
        // harness's own configuration — every PENGUIN_* variable, PORT/HOST and the rest —
        // never reaches a server: the same outcome the command-session strip enforces,
        // by the opposite mechanism. Widening this base (e.g. to process.env) would undo
        // that; the "harness variables never reach a stdio server" test pins it. A
        // sandbox runner's own entries lie over the result.
        env: { ...getDefaultEnvironment(), ...t.env, ...confined.env },
        ...(cwd !== undefined ? { cwd } : {}),
        stderr: "pipe",
      });
      // The tail makes spawn/startup failures diagnosable ("command not found", stack
      // traces); after a successful connect it keeps draining into the ring, never printed.
      stdio.stderr?.on("data", (chunk: unknown) => {
        stderrTail = (stderrTail + String(chunk)).slice(-STDERR_TAIL_LIMIT);
      });
      transport = stdio;
    } else if (t.kind === "http") {
      transport = new StreamableHTTPClientTransport(
        new URL(t.url),
        t.headers ? { fetch: fetchWithHeaders(t.headers) } : {},
      );
    } else {
      transport = new SSEClientTransport(
        new URL(t.url),
        t.headers ? { fetch: fetchWithHeaders(t.headers) } : {},
      );
    }
    try {
      const startedAt = Date.now();
      await client.connect(transport, {
        timeout: server.connectTimeoutMs,
        ...(signal ? { signal } : {}),
      });
      // One budget covers connect + discovery: the SDK's `timeout` is per-request, so
      // discovery gets whatever the handshake left over — granting the full value to
      // both calls would let the worst case run to twice the documented total.
      const remainingMs = Math.max(1, server.connectTimeoutMs - (Date.now() - startedAt));
      const listed = await client.listTools(undefined, {
        timeout: remainingMs,
        ...(signal ? { signal } : {}),
      });
      // Wrappers are built once, here — the usable-name check and its warning fire at
      // connect time, not at every registry rebuild a later context triggers.
      const wrappers: BuiltinTool[] = [];
      const seen = new Set<string>();
      const values = this.vaultValuesOf(server);
      for (const tool of listed.tools) {
        const wrapper = this.wrap(server, client, tool, seen, values);
        if (wrapper) wrappers.push(wrapper);
      }
      return { server, client, wrappers };
    } catch (err) {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
      const detail = describeError(err);
      throw new Error(stderrTail ? `${detail}; server stderr: ${stderrTail.trim()}` : detail);
    }
  }

  /**
   * The argv a stdio server is started with under the Session's sandbox: the confiner's
   * answer, with the server's working directory as `cwd` and the Session's Workspace and
   * scratchpad as scope; the argv itself when the Session has no confiner. A throw is the
   * server's connect failure.
   */
  private confine(argv: readonly string[], cwd: string | undefined): ConfinedSpawn {
    const confiner = this.confineSpawn?.() ?? null;
    if (confiner === null) return { argv };
    try {
      return confiner(argv, {
        cwd: cwd ?? process.cwd(),
        workspaceDir: this.workspaceDir ?? cwd ?? process.cwd(),
        ...(this.scratchpadDir !== undefined ? { scratchpadDir: this.scratchpadDir } : {}),
      });
    } catch (err) {
      throw new Error(`sandbox: ${describeError(err)}`);
    }
  }

  /**
   * Builds the executable wrapper of one discovered tool; null when it cannot join the toolset
   * (skips are warned, never thrown). `seen` holds the names already taken on this server, and
   * `values` the vault values it was given: a call that fails with an answer repeating them
   * reports their references instead.
   */
  private wrap(
    server: ResolvedMCPServer,
    client: Client,
    tool: Tool,
    seen: Set<string>,
    values: VaultValues,
  ): BuiltinTool | null {
    const name = mcpToolName(server.name, tool.name);
    if (!LLM_TOOL_NAME_PATTERN.test(name)) {
      this.warn(
        `MCP server "${server.name}" tool "${tool.name}" skipped: the prefixed name ` +
          `is not usable as an LLM tool name (allowed: letters, digits, _ and -, ≤128 chars total).`,
      );
      return null;
    }
    if (seen.has(name)) {
      this.warn(`MCP server "${server.name}" listed tool "${tool.name}" twice; keeping the first.`);
      return null;
    }
    seen.add(name);
    const description =
      tool.description ?? tool.title ?? `MCP tool "${tool.name}" on server "${server.name}".`;
    // The entry's own permission wins over the annotation for every tool of the server;
    // without one, readOnlyHint is an untrusted hint and only an explicit true relaxes to "r".
    const permission: ToolPermission =
      server.permission ?? (tool.annotations?.readOnlyHint === true ? "r" : "rw");
    return {
      name,
      definition: {
        name,
        description,
        parameters: tool.inputSchema as Record<string, unknown>,
        permission,
        ...(server.timeoutMs !== undefined ? { timeoutMs: server.timeoutMs } : {}),
        ...(server.maxOutputLength !== undefined
          ? { maxOutputLength: server.maxOutputLength }
          : {}),
      },
      execute: async function* (args, ctx): AsyncGenerator<OmniMessage, ToolResult> {
        const result = await client
          .callTool(
            { name: tool.name, arguments: args },
            {
              timeout: MAX_SDK_TIMEOUT_MS,
              ...(ctx.signal ? { signal: ctx.signal } : {}),
            },
          )
          .catch((err: unknown) => {
            throw redactError(err, values);
          });
        const rendered = renderCallToolResult(result);
        const failed = result.isError === true;
        const text =
          rendered.text === "" && failed && rendered.images.length === 0
            ? "[tool reported an error with no message]"
            : rendered.text;
        if (text !== "") {
          yield partialToolCallOutput({
            eventType: "delta",
            output: text,
            toolCallId: ctx.toolCallId,
          });
        }
        return {
          stopReason: failed ? "fatal" : "completed",
          ...(rendered.images.length > 0 ? { images: rendered.images } : {}),
        };
      },
    };
  }
}
