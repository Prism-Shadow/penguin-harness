/**
 * `penguin agent` — list and create agents through the server, and manage an agent's public API.
 *
 *   penguin agent ls [--project-id <id>] [--json] [--server <url>]
 *   penguin agent create --agent-id <id> [--name <s>] [--description <s>]
 *                        [--plugins <a,b>] [--project-id <id>] [--json] [--server <url>]
 *   penguin agent api status  --agent-id <id> [--project-id <id>] [--json] [--server <url>]
 *   penguin agent api enable  --agent-id <id> [--open | --no-open] [--approve <mode>] …
 *   penguin agent api disable --agent-id <id> …
 *   penguin agent api set     --agent-id <id> [--open | --no-open] [--approve <mode>] …
 *   penguin agent api keys ls     --agent-id <id> …
 *   penguin agent api keys create --agent-id <id> --name <s> …
 *   penguin agent api keys rm <keyId> --agent-id <id> …
 *   penguin agent api server on|off [--json] [--server <url>]
 *
 * `create` mirrors the Web dialog's fields: id (required), display name, description,
 * and library plugins to seed (comma-separated names; unknown names are rejected by the
 * server before anything is created).
 *
 * `api` is the Agent page's API tab over /api/projects/:p/agents/:a/api: whether external
 * programs may talk to the agent, keyless access, the approval mode API conversations are
 * created with (`--approve`, validated as `run` and `chat` validate theirs), and the keys. The
 * agent is always named with `--agent-id` — exposing one is never left to a default. `enable`,
 * `disable` and `set` print the resulting status, as `status` does; its last line is the
 * server-wide switch, which the settings read reports to any member and which `server on|off`
 * (admins only) writes. `keys
 * create` prints the key bare on stdout — the only time it exists anywhere — and everything else
 * on stderr, so `KEY=$(penguin agent api keys create …)` captures exactly the key.
 *
 * The writes (`enable`, `disable`, `set`, `keys create`, `keys rm`, `server`) take a person's
 * sign-in: the server refuses the local API token on them with 403 `sign_in_required`, so that
 * an Agent cannot expose itself from its own shell. Outside a Session the client sends the
 * stored `penguin auth login` first (client.ts); a refusal prints what to run instead.
 * Docs: /docs/cli § "penguin agent".
 */
import type { Command } from "commander";
import type {
  AgentApiKeyCreateResponse,
  AgentApiResponse,
  AgentApiSettings,
  AgentApiUpdateRequest,
  AgentCreateResponse,
  AgentSummary,
  ServerSettingsResponse,
} from "@prismshadow/penguin-server/api";
import { resolveApprovalMode } from "../approval.js";
import { ApiError, resolveConnection, resolveProjectId, ServerClient } from "../client.js";
import { listAgents } from "../server-session.js";
import { displayWidth, renderTable } from "../table.js";
import type { Messages } from "../i18n.js";

const enc = encodeURIComponent;

interface ApiOpts {
  agentId: string;
  projectId?: string;
  json?: boolean;
  server?: string;
  open?: boolean;
  approve?: string;
  name?: string;
}

async function connect(opts: { server?: string }, t: Messages): Promise<ServerClient> {
  return new ServerClient(await resolveConnection({ server: opts.server }, t), t);
}

/** The agent's API, as the server names it: project and agent ids, and the routes under it. */
function target(opts: ApiOpts): { projectId: string; agentId: string; ref: string; path: string } {
  const projectId = resolveProjectId(opts.projectId);
  const agentId = String(opts.agentId).trim();
  return {
    projectId,
    agentId,
    ref: `${projectId}/${agentId}`,
    path: `/api/projects/${enc(projectId)}/agents/${enc(agentId)}/api`,
  };
}

/** What `--open` / `--no-open` / `--approve` ask to change; an invalid mode exits before any request. */
function settingsPatch(opts: ApiOpts, t: Messages): AgentApiUpdateRequest {
  return {
    ...(typeof opts.open === "boolean" ? { open: opts.open } : {}),
    ...(opts.approve !== undefined ? { approvalMode: resolveApprovalMode(opts.approve, t) } : {}),
  };
}

/** Prints the settings as `status` shows them: a heading and one aligned line per fact, or JSON. */
function printStatus(
  client: ServerClient,
  ref: string,
  res: AgentApiResponse,
  json: boolean,
  t: Messages,
): void {
  const baseUrl = `${client.conn.baseUrl}/api/amsp/v1`;
  const settings: AgentApiSettings = res.api;
  const server = res.serverEnabled;
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ agent: ref, baseUrl, api: settings, serverEnabled: server })}\n`,
    );
    return;
  }
  const yesNo = (on: boolean) => (on ? t.agent.apiYes() : t.agent.apiNo());
  const rows: Array<[string, string]> = [
    [t.agent.apiFieldEnabled(), yesNo(settings.enabled)],
    [t.agent.apiFieldOpen(), yesNo(settings.open)],
    [t.agent.apiFieldApproval(), settings.approvalMode],
    [t.agent.apiFieldBaseUrl(), baseUrl],
    [t.agent.apiFieldAgentId(), ref],
    [t.agent.apiFieldKeys(), String(settings.keys.length)],
    [t.agent.apiFieldServer(), server ? t.agent.apiServerOn() : t.agent.apiServerOff()],
  ];
  const width = Math.max(...rows.map(([label]) => displayWidth(label)));
  const lines = rows.map(
    ([label, value]) => `  ${label}${" ".repeat(width - displayWidth(label))}  ${value}`,
  );
  process.stdout.write(`${t.agent.apiStatusTitle(ref)}\n${lines.join("\n")}\n`);
}

/**
 * A write that changes who can reach an agent. The server's 403 `sign_in_required` — the request
 * carried the local API token, not a person's sign-in — becomes the line saying what to run.
 */
async function exposureWrite<T>(
  client: ServerClient,
  method: string,
  apiPath: string,
  body: unknown,
  t: Messages,
): Promise<T> {
  try {
    return await client.request<T>(method, apiPath, body);
  } catch (err) {
    if (err instanceof ApiError && err.code === "sign_in_required") {
      throw new Error(t.agent.apiSignInRequired());
    }
    throw err;
  }
}

/** One PUT of the agent's API settings, then the status it left. */
async function writeSettings(opts: ApiOpts, patch: AgentApiUpdateRequest, t: Messages) {
  const { path, ref } = target(opts);
  const client = await connect(opts, t);
  const res = await exposureWrite<AgentApiResponse>(client, "PUT", path, patch, t);
  printStatus(client, ref, res, opts.json === true, t);
}

function registerApiCommands(agent: Command, t: Messages): void {
  const api = agent.command("api").description(t.agent.apiDesc);
  /** The options every command naming an agent takes. */
  const forAgent = (cmd: Command): Command =>
    cmd
      .requiredOption("--agent-id <id>", t.common.agentId)
      .option("--project-id <id>", t.common.projectId)
      .option("--json", t.common.json)
      .option("--server <url>", t.common.server);
  /** `--open` / `--no-open` / `--approve`: neither switch given leaves `open` undefined. */
  const settingsOptions = (cmd: Command): Command =>
    cmd
      .option("--open", t.agent.apiOpen)
      .option("--no-open", t.agent.apiNoOpen)
      .option("--approve <mode>", t.agent.apiApprove);

  forAgent(api.command("status").description(t.agent.apiStatusDesc)).action(
    async (opts: ApiOpts) => {
      const { path, ref } = target(opts);
      const client = await connect(opts, t);
      const res = await client.request<AgentApiResponse>("GET", path);
      printStatus(client, ref, res, opts.json === true, t);
    },
  );

  settingsOptions(forAgent(api.command("enable").description(t.agent.apiEnableDesc))).action(
    async (opts: ApiOpts) => {
      await writeSettings(opts, { enabled: true, ...settingsPatch(opts, t) }, t);
    },
  );

  forAgent(api.command("disable").description(t.agent.apiDisableDesc)).action(
    async (opts: ApiOpts) => {
      await writeSettings(opts, { enabled: false }, t);
    },
  );

  settingsOptions(forAgent(api.command("set").description(t.agent.apiSetDesc))).action(
    async (opts: ApiOpts) => {
      const patch = settingsPatch(opts, t);
      if (Object.keys(patch).length === 0) {
        process.stderr.write(`${t.agent.apiNothingToSet()}\n`);
        process.exitCode = 1;
        return;
      }
      await writeSettings(opts, patch, t);
    },
  );

  const keys = api.command("keys").description(t.agent.apiKeysDesc);

  forAgent(keys.command("ls").description(t.agent.apiKeysLsDesc)).action(async (opts: ApiOpts) => {
    const { path, ref } = target(opts);
    const client = await connect(opts, t);
    const res = await client.request<AgentApiResponse>("GET", path);
    if (opts.json === true) {
      process.stdout.write(`${JSON.stringify(res.api.keys)}\n`);
      return;
    }
    if (res.api.keys.length === 0) {
      process.stdout.write(`${t.agent.apiKeysEmpty(ref)}\n`);
      return;
    }
    process.stdout.write(
      renderTable(
        [
          t.agent.apiColKeyId(),
          t.agent.apiColKeyName(),
          t.agent.apiColPrefix(),
          t.agent.apiColCreated(),
          t.agent.apiColLastUsed(),
        ],
        res.api.keys.map((k) => [
          k.keyId,
          k.name,
          `${k.prefix}…`,
          k.createdAt,
          k.lastUsedAt ?? t.agent.apiKeyNever(),
        ]),
      ),
    );
  });

  forAgent(keys.command("create").description(t.agent.apiKeysCreateDesc))
    .requiredOption("--name <name>", t.agent.apiKeyName)
    .action(async (opts: ApiOpts) => {
      const { path, ref } = target(opts);
      const client = await connect(opts, t);
      const res = await exposureWrite<AgentApiKeyCreateResponse>(
        client,
        "POST",
        `${path}/keys`,
        { name: String(opts.name) },
        t,
      );
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(res)}\n`);
        return;
      }
      process.stdout.write(`${res.secret}\n`);
      process.stderr.write(`${t.agent.apiKeyCreated(res.key.name, res.key.prefix, ref)}\n`);
    });

  forAgent(keys.command("rm <keyId>").description(t.agent.apiKeysRmDesc)).action(
    async (keyId: string, opts: ApiOpts) => {
      const { path, ref } = target(opts);
      const client = await connect(opts, t);
      await exposureWrite<void>(client, "DELETE", `${path}/keys/${enc(keyId)}`, undefined, t);
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify({ deleted: keyId })}\n`);
        return;
      }
      process.stdout.write(`${t.agent.apiKeyDeleted(keyId, ref)}\n`);
    },
  );

  api
    .command("server <state>")
    .description(t.agent.apiServerDesc)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (state: string, opts: { json?: boolean; server?: string }) => {
      const wanted = state.trim().toLowerCase();
      if (wanted !== "on" && wanted !== "off") {
        process.stderr.write(`${t.agent.apiServerStateInvalid(state)}\n`);
        process.exitCode = 1;
        return;
      }
      const client = await connect(opts, t);
      const res = await exposureWrite<ServerSettingsResponse>(
        client,
        "PUT",
        "/api/admin/settings",
        { agentApiEnabled: wanted === "on" },
        t,
      );
      const on = res.settings.agentApiEnabled;
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify({ agentApiEnabled: on })}\n`);
        return;
      }
      process.stdout.write(`${t.agent.apiServerSet(on)}\n`);
    });
}

export function registerAgentCommand(program: Command, t: Messages): void {
  const agent = program.command("agent").description(t.agent.desc);

  agent
    .command("ls")
    .description(t.agent.lsDesc)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const agents = await listAgents(client, projectId);
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(agents)}\n`);
        return;
      }
      process.stdout.write(
        renderTable(
          [t.agent.colId(), t.agent.colName(), t.agent.colSessions(), t.agent.colDescription()],
          agents.map((a: AgentSummary) => [
            a.agentId,
            a.name ?? "",
            String(a.sessionCount),
            (a.description ?? "").slice(0, 60),
          ]),
        ),
      );
    });

  agent
    .command("create")
    .description(t.agent.createDesc)
    .requiredOption("--agent-id <id>", t.agent.createId)
    .option("--name <name>", t.agent.createName)
    .option("--description <text>", t.agent.createDescription)
    .option("--plugins <names>", t.agent.createPlugins)
    .option("--project-id <id>", t.common.projectId)
    .option("--json", t.common.json)
    .option("--server <url>", t.common.server)
    .action(async (opts) => {
      const client = new ServerClient(await resolveConnection({ server: opts.server }, t), t);
      const projectId = resolveProjectId(opts.projectId);
      const plugins =
        typeof opts.plugins === "string"
          ? opts.plugins
              .split(",")
              .map((s: string) => s.trim())
              .filter((s: string) => s.length > 0)
          : undefined;
      const res = await client.request<AgentCreateResponse>(
        "POST",
        `/api/projects/${encodeURIComponent(projectId)}/agents`,
        {
          agentId: String(opts.agentId),
          ...(opts.name !== undefined ? { name: String(opts.name) } : {}),
          ...(opts.description !== undefined ? { description: String(opts.description) } : {}),
          ...(plugins !== undefined && plugins.length > 0 ? { plugins } : {}),
        },
      );
      if (opts.json === true) {
        process.stdout.write(`${JSON.stringify(res.agent)}\n`);
        return;
      }
      process.stdout.write(`${t.agent.created(res.agent.agentId, projectId)}\n`);
    });

  registerApiCommands(agent, t);
}
