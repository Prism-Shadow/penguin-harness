// `--emit` and `--append`: the agent-porting reader writes what it maps straight into the port
// folder, so the source's real values go file to file and never through the conversation. What it
// prints is a summary in the masked view's terms. Built-in modules only.
import fs from "node:fs";
import path from "node:path";
import { formatOf, parseConfig, parseYaml, splitFrontmatter } from "./parse.mjs";
import {
  PEM,
  chars,
  isCode,
  isCredentialName,
  isEnvName,
  isRefused,
  lineKind,
  pathToken,
  referenceParts,
  safeKey,
  tokenish,
} from "./detect.mjs";
import { commandLine, url as maskedUrl } from "./mask.mjs";

export const FRAMEWORKS = [
  "claude-code",
  "codex",
  "deepseek-harness",
  "qoder",
  "qwen-code",
  "workbuddy",
  "pi",
  "other",
];
const LEVELS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
const LEVEL_ALIASES = { minimal: "low", ultra: "max" };
/** The three source events a PenguinHarness hook point answers, and the point. */
const HOOK_POINTS = { PreToolUse: "pre_tool_use", Stop: "stop", UserPromptSubmit: "user_prompt" };
const ID_RULE = /^[a-z][a-z0-9_]{1,63}$/;

const say = (line) => console.log(line);
/** A plain object, or an empty one. */
const obj = (x) => (x !== null && typeof x === "object" && !Array.isArray(x) ? x : {});
/** A name a summary may print: an MCP server's, a flag's, a header's. Anything odd shows masked. */
const shownName = (s) => (/^[A-Za-z][\w.-]{0,40}$/.test(s) && !tokenish(s) ? s : chars(s));
/** An env name prints in the environment-variable convention only. */
const shownEnv = (k) => (isEnvName(k) ? k : `<redacted key:${k.length} chars>`);

/** A Vault key's name from plain parts (`docs`, `X-Api-Key` → `DOCS_X_API_KEY`). */
const vaultName = (...parts) =>
  parts
    .join("_")
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .replace(/^(\d)/, "_$1")
    .slice(0, 64) || "PORTED_SECRET";
/** A header name in its usual casing, which may name a Vault key; anything else does not. */
const headerPart = (h) =>
  /^(X-[A-Za-z0-9-]{1,40}|[A-Z][a-z]+(-[A-Z][a-z]+)*)$/.test(h) && !tokenish(h) ? h : null;
const flagPart = (f) => {
  const name = f.replace(/^-+/, "");
  return /^[a-z][a-z0-9-]{0,30}$/.test(name) ? name : null;
};

/**
 * A string's references rewritten the PenguinHarness way: `${VAR:-x}` loses its default,
 * `${credential:name}` becomes `${NAME}`, and (Qwen Code) `$VAR` becomes `${VAR}`. The names it
 * holds are Vault keys.
 */
function rewriteRefs(s, keys, framework) {
  let text = s.replace(/\$\{(credential:)?([^{}:]+)(:-[^}]*)?\}/gi, (all, credential, name) => {
    const key = credential ? vaultName(name) : name;
    if (!isEnvName(key)) return all;
    keys.add(key);
    return `\${${key}}`;
  });
  if (framework === "qwen-code") {
    text = text.replace(/(^|[^$\w{])\$([A-Z_][A-Z0-9_]*)\b/g, (all, lead, name) => {
      keys.add(name);
      return `${lead}\${${name}}`;
    });
  }
  return text;
}

/** A value that is only a reference to a plain name: the Vault key it reads, with its scheme. */
function plainRef(s) {
  const p = referenceParts(s);
  if (p === null || !p.plain) return null;
  return { scheme: p.scheme, key: p.kind ? vaultName(p.name) : p.name };
}

/**
 * Variables every shell has, which name a place or a setting on this machine, never a secret:
 * not Vault keys. PenguinHarness fills a server's `${…}` only from the Vault, so the summary asks
 * for the value here.
 */
const MACHINE_VARIABLES = new Set(["HOME", "PATH", "USER", "PWD", "TMPDIR", "SHELL", "LANG"]);

/** A value that looks like a credential however it is named. */
const looksSecret = (v) => tokenish(v) || lineKind(v, false) !== null || PEM.test(v);

/** Whether the word after `flag` is a credential. */
function credentialAfter(flag, value) {
  if (typeof flag !== "string" || !/^--?[A-Za-z]/.test(flag) || flag.includes("=")) return false;
  if (/^-[pP]$/.test(flag)) return !/^\d+([:/]\d+)*$/.test(value); // a port is not a password
  if (/^(-u|--user)$/.test(flag)) return value.includes(":");
  if (/^(--pw|--pin)$/.test(flag)) return true;
  return /^--/.test(flag) && isCredentialName(flag.replace(/^-+/, ""));
}

// ---- One MCP server --------------------------------------------------------------------------

/** The source's fields a server mapping reads; any other is dropped and named. */
const READ_FIELDS = new Set([
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "httpUrl",
  "type",
  "transport",
  "headers",
  "http_headers",
  "env_http_headers",
  "bearer_token_env_var",
  "env_vars",
  "timeout",
  "startup_timeout_sec",
  "startup_timeout_ms",
  "tool_timeout_sec",
  "oauth",
  "enabled",
  "disabled",
  "serverName",
]);

function mapServer(sourceName, spec, framework, used) {
  const notes = [];
  const keys = new Set();
  const secrets = [];
  let name = portedServerName(sourceName);
  if (name === "" || tokenish(name)) name = `server-${used.size + 1}`;
  const S = name;
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) {
    return { skipped: "its entry is not an object", name };
  }
  if (spec.enabled === false || spec.disabled === true)
    return { skipped: "disabled in the source", name };
  const config = {};

  // Transport.
  const type = String(spec.type ?? spec.transport ?? "").toLowerCase();
  let address = null;
  if (typeof spec.command === "string" || Array.isArray(spec.command)) {
    config.transport = "stdio";
  } else if (framework === "qwen-code" && typeof spec.httpUrl === "string") {
    config.transport = "http";
    address = spec.httpUrl;
  } else if (typeof spec.url === "string") {
    if (type === "ws") return { skipped: "a WebSocket server, which has no counterpart", name };
    config.transport =
      type === "sse" || (framework === "qwen-code" && type === "") ? "sse" : "http";
    address = spec.url;
  } else if (type === "ws") {
    return { skipped: "a WebSocket server, which has no counterpart", name };
  } else {
    return { skipped: "neither a command nor an address", name };
  }

  // A stdio process.
  if (config.transport === "stdio") {
    const cmd = Array.isArray(spec.command) ? spec.command[0] : spec.command;
    const extra = Array.isArray(spec.command) ? spec.command.slice(1) : [];
    if (typeof cmd !== "string" || cmd === "") return { skipped: "its command is empty", name };
    if (/CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT/.test(cmd)) {
      return { skipped: "it runs a file inside another tool's plugin", name };
    }
    config.command = rewriteRefs(cmd, keys, framework);
    const args = [...extra, ...(Array.isArray(spec.args) ? spec.args : [])];
    if (args.some((a) => a !== null && typeof a === "object")) {
      return { skipped: "its arguments hold a nested value", name };
    }
    if (args.length > 0) {
      let generic = 0;
      config.args = args.map((a, i) => {
        if (typeof a !== "string") return String(a);
        const ref = plainRef(a);
        if (ref) {
          keys.add(ref.key);
          return `${ref.scheme}\${${ref.key}}`;
        }
        if (credentialAfter(args[i - 1], a)) {
          const part = flagPart(args[i - 1]) ?? `ARG_${++generic}`;
          const key = vaultName(S, part);
          secrets.push(`args[${i}]`);
          keys.add(key);
          return `\${${key}}`;
        }
        const pair = /^(--?[A-Za-z][\w.-]*)=(.*)$/s.exec(a);
        if (pair && (credentialAfter(pair[1], pair[2]) || looksSecret(pair[2]))) {
          const key = vaultName(S, flagPart(pair[1]) ?? `ARG_${++generic}`);
          secrets.push(`args[${i}]`);
          keys.add(key);
          return `${pair[1]}=\${${key}}`;
        }
        if (looksSecret(a)) {
          const key = vaultName(S, `ARG_${++generic}`);
          secrets.push(`args[${i}]`);
          keys.add(key);
          return `\${${key}}`;
        }
        return rewriteRefs(a, keys, framework);
      });
    }
    if (typeof spec.cwd === "string") config.cwd = rewriteRefs(spec.cwd, keys, framework);
  }

  // An address.
  if (address !== null) {
    let u = address;
    const hostRef = /^\$\{([^{}:]+)(?::-([^}]*))?\}/.exec(u);
    if (hostRef) {
      if (hostRef[2] === undefined) {
        return { skipped: "its address comes from a variable, which cannot name a host", name };
      }
      u = hostRef[2] + u.slice(hostRef[0].length);
      notes.push(`${S}: the address's host came from a variable's default`);
    }
    const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(u);
    if (m === null) return { skipped: "its address does not parse", name };
    let [, scheme, authority, rest, query, hash] = m;
    if (authority.includes("@")) {
      authority = authority.slice(authority.lastIndexOf("@") + 1);
      notes.push(`${S}: the user info in its address was dropped; give it as a header`);
    }
    let pathKeys = 0;
    rest = rest
      .split("/")
      .map((seg) => {
        if (seg === "" || !looksSecret(seg)) return rewriteRefs(seg, keys, framework);
        const key = vaultName(S, pathKeys++ === 0 ? "PATH" : `PATH_${pathKeys}`);
        secrets.push("url path");
        keys.add(key);
        return `\${${key}}`;
      })
      .join("/");
    if (query) {
      query =
        "?" +
        query
          .slice(1)
          .split("&")
          .map((p) => {
            const eq = p.indexOf("=");
            if (eq === -1) return p;
            const param = p.slice(0, eq);
            const value = p.slice(eq + 1);
            const ref = plainRef(value);
            if (ref) {
              keys.add(ref.key);
              return `${param}=\${${ref.key}}`;
            }
            if (isCredentialName(param) || looksSecret(value)) {
              const key = vaultName(S, /^[A-Za-z][\w-]{0,30}$/.test(param) ? param : "QUERY");
              secrets.push(`url query ${shownName(param)}`);
              keys.add(key);
              return `${param}=\${${key}}`;
            }
            return rewriteRefs(p, keys, framework);
          })
          .join("&");
    }
    config.url = `${scheme}${authority}${rest}${query ?? ""}${hash ?? ""}`;
  }

  // The environment.
  const env = {};
  let genericEnv = 0;
  for (const [k, v] of Object.entries(obj(spec.env))) {
    if (v !== null && typeof v === "object") {
      notes.push(
        `${S}: env ${shownEnv(k)} holds a nested value, which an environment cannot; left out`,
      );
      continue;
    }
    const value = String(v);
    const ref = plainRef(value);
    if (ref && ref.scheme === "") {
      keys.add(ref.key);
      env[k] = `\${${ref.key}}`;
    } else if (
      isCredentialName(k) ||
      looksSecret(value) ||
      (framework === "pi" && value.startsWith("!"))
    ) {
      const key = isEnvName(k) ? k : vaultName(S, `ENV_${++genericEnv}`);
      secrets.push(`env ${shownEnv(k)}`);
      keys.add(key);
      env[k] = `\${${key}}`;
    } else {
      env[k] = rewriteRefs(value, keys, framework);
    }
  }
  for (const variable of Array.isArray(spec.env_vars) ? spec.env_vars : []) {
    if (typeof variable === "string" && isEnvName(variable)) {
      keys.add(variable);
      env[variable] = `\${${variable}}`;
    } else notes.push(`${S}: an env_vars entry that is not a variable name was left out`);
  }
  if (Object.keys(env).length > 0) config.env = env;

  // Headers.
  const headers = {};
  let genericHeader = 0;
  const sourceHeaders = { ...obj(spec.headers), ...obj(spec.http_headers) };
  for (const [h, v] of Object.entries(sourceHeaders)) {
    const value = String(v);
    const ref = plainRef(value);
    if (ref) {
      keys.add(ref.key);
      headers[h] = `${ref.scheme}\${${ref.key}}`;
    } else if (isCredentialName(h) || /^(authorization|cookie)$/i.test(h) || looksSecret(value)) {
      const scheme = /^(Bearer|Basic|Token)\s+/i.exec(value);
      const part = /^authorization$/i.test(h)
        ? "TOKEN"
        : (headerPart(h) ?? `HEADER_${++genericHeader}`);
      const key = vaultName(S, part);
      secrets.push(`header ${headerPart(h) ?? chars(h)}`);
      keys.add(key);
      headers[h] = `${scheme ? `${scheme[1]} ` : ""}\${${key}}`;
    } else {
      headers[h] = rewriteRefs(value, keys, framework);
    }
  }
  for (const [h, variable] of Object.entries(obj(spec.env_http_headers))) {
    const key =
      typeof variable === "string" && isEnvName(variable)
        ? variable
        : vaultName(S, headerPart(h) ?? `HEADER_${++genericHeader}`);
    keys.add(key);
    headers[h] = `\${${key}}`;
  }
  if (typeof spec.bearer_token_env_var === "string") {
    const key = isEnvName(spec.bearer_token_env_var)
      ? spec.bearer_token_env_var
      : vaultName(S, "TOKEN");
    keys.add(key);
    headers.Authorization = `Bearer \${${key}}`;
  }
  if (Object.keys(headers).length > 0) {
    if (config.transport === "stdio") notes.push(`${S}: headers on a stdio server were left out`);
    else config.headers = headers;
  }

  // Timeouts and sign-in.
  if (typeof spec.tool_timeout_sec === "number" && spec.tool_timeout_sec > 0) {
    config.timeoutMs = spec.tool_timeout_sec * 1000;
  }
  if (typeof spec.startup_timeout_sec === "number" && spec.startup_timeout_sec > 0) {
    config.connectTimeoutMs = spec.startup_timeout_sec * 1000;
  }
  if (typeof spec.startup_timeout_ms === "number" && spec.startup_timeout_ms > 0) {
    config.connectTimeoutMs = spec.startup_timeout_ms;
  }
  if (framework === "qwen-code" && typeof spec.timeout === "number" && spec.timeout > 0) {
    config.timeoutMs = spec.timeout;
  }
  if (spec.oauth && typeof spec.oauth === "object") {
    const o = spec.oauth;
    const oauth = {};
    const scopes = o.scopes ?? o.scope;
    if (Array.isArray(scopes)) oauth.scopes = scopes.filter((x) => typeof x === "string");
    else if (typeof scopes === "string") oauth.scopes = scopes.split(/[\s,]+/).filter(Boolean);
    const id = o.client_id ?? o.clientId;
    if (typeof id === "string" && !looksSecret(id))
      oauth.client_id = rewriteRefs(id, keys, framework);
    const secret = o.client_secret ?? o.clientSecret;
    if (typeof secret === "string" && secret !== "") {
      const ref = plainRef(secret);
      const key = ref ? ref.key : vaultName(S, "CLIENT_SECRET");
      if (!ref) secrets.push("oauth client secret");
      keys.add(key);
      oauth.client_secret = `\${${key}}`;
    }
    config.oauth = oauth;
    notes.push(
      `${S}: signs in with OAuth, which this version cannot do yet; it waits as "sign-in required" unless it also takes a token as Authorization: Bearer \${KEY}`,
    );
  }

  const dropped = Object.keys(spec).filter((k) => !READ_FIELDS.has(k));
  if (dropped.length > 0) notes.push(`${S}: fields left out: ${dropped.map(safeKey).join(", ")}`);
  const machine = [...keys].filter((k) => MACHINE_VARIABLES.has(k));
  if (machine.length > 0) {
    machine.forEach((k) => keys.delete(k));
    notes.push(
      `${S}: needs a path on this machine: ${machine.map((k) => `\${${k}}`).join(", ")} (PenguinHarness fills \${…} from the Vault only: replace it with the value, or set that key in the Vault)`,
    );
  }
  return { entry: { name, config }, keys, secrets, notes, name };
}

/** The MCP servers a parsed source holds, as `[sourceName, spec]`, and what it could not reach. */
function serversOf(data, framework, base, project, notes, profile) {
  const out = [];
  const take = (map) => {
    if (Array.isArray(map)) {
      // A subagent's list: names of servers configured elsewhere, or inline definitions.
      for (const item of map) {
        if (item && typeof item === "object" && typeof item.name === "string")
          out.push([item.name, item]);
      }
      return;
    }
    for (const [k, v] of Object.entries(obj(map))) out.push([k, v]);
  };
  if (framework === "deepseek-harness") {
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node === null || typeof node !== "object") return;
      if (
        node.name === "@deepseek-ai/dsh-mcp-client" &&
        node.config &&
        typeof node.config === "object"
      ) {
        const c = node.config;
        out.push([
          String(c.serverName ?? node.id ?? "server"),
          {
            ...c,
            serverName: undefined,
            transport: c.transport === "streamable-http" ? "http" : c.transport,
            type: c.transport === "streamable-http" ? "http" : c.transport,
          },
        ]);
        return;
      }
      if (node.name === "@deepseek-ai/dsh-mcp-manager" && node.config?.servers) {
        for (const [k, v] of Object.entries(obj(node.config.servers))) {
          const type = v?.transport === "streamable-http" ? "http" : v?.transport;
          out.push([k, { ...v, transport: type, type }]);
        }
        return;
      }
      if (/dsh-hooks-(claude-code|codex)$/.test(String(node.name ?? ""))) {
        notes.push(
          "a hooks row names a hooks file in its configPath: emit that file with --framework claude-code or codex",
        );
      }
      Object.values(node).forEach(walk);
    };
    walk(data);
    return out;
  }
  if (base === ".claude.json") {
    take(data.mcpServers);
    const projects = Object.entries(data.projects ?? {}).filter(
      ([, p]) => p && typeof p === "object" && p.mcpServers && Object.keys(p.mcpServers).length > 0,
    );
    if (project !== null) {
      const hit = projects.find(([dir]) => dir === project);
      if (hit) take(hit[1].mcpServers);
      else notes.push("no project of that path has MCP servers");
    } else if (projects.length > 0) {
      notes.push(
        `${projects.length} project(s) have their own MCP servers: emit again with --project <path> (list them with the masked view)`,
      );
    }
    return out;
  }
  take(data.mcpServers ?? data.mcp_servers);
  if (framework === "codex") {
    const profiles = Object.entries(obj(data.profiles)).filter(
      ([, p]) => Object.keys(obj(p?.mcp_servers)).length > 0,
    );
    if (profile !== null) {
      const hit = profiles.find(([name]) => name === profile);
      if (hit) take(hit[1].mcp_servers);
      else notes.push("no profile of that name has MCP servers");
    } else if (profiles.length > 0) {
      notes.push(
        `profile(s) ${profiles.map(([name]) => shownName(name)).join(", ")} have their own MCP servers, not ported: emit again with --profile <name>`,
      );
    }
  }
  return out;
}

// ---- Hooks -----------------------------------------------------------------------------------

/** A hook's timeout when the source sets none: Claude Code, Codex, Qoder and Qwen Code use 600 s. */
const DEFAULT_HOOK_TIMEOUT_S = 600;
/** How many stops in a row a ported Stop hook may block before its block is no longer forwarded. */
const MAX_STOP_BLOCKS = 3;

/**
 * The generated wrapper: runs the source's hook command in the Session's Workspace, with the
 * source tool's input, and speaks PenguinHarness's protocol. `guard` names it in its answers.
 */
function wrapperSource({ framework, event, point, matcher, command, timeoutS, guard }) {
  return `// Ported by the agent-porting skill from a ${framework} ${event} hook (${guard}). It runs the
// source's command in the Session's Workspace with that tool's input, and turns its answer into
// PenguinHarness's.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const COMMAND = ${JSON.stringify(command)};
const MATCHER = ${JSON.stringify(matcher)};
const EVENT = ${JSON.stringify(event)};
const POINT = ${JSON.stringify(point)};
const GUARD = ${JSON.stringify(guard)};
const MAX_STOP_BLOCKS = ${MAX_STOP_BLOCKS};
// PenguinHarness's tool names, by the names the source's matchers use.
const SOURCE_TOOLS = {
  exec_command: "Bash",
  read_file: "Read",
  edit_file: "Edit",
  write_file: "Write",
  run_subagent: "Task",
};

const input = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
const tool = SOURCE_TOOLS[input.tool_name] ?? input.tool_name ?? "";
if (POINT === "pre_tool_use" && MATCHER !== "" && MATCHER !== "*") {
  if (!new RegExp(\`^(?:\${MATCHER})$\`, "i").test(tool)) process.exit(0);
}

/** The Session's Workspace, from the head of the Trace it is writing; null without one. */
function workspace() {
  if (typeof input.trace_path !== "string") return null;
  try {
    const fd = fs.openSync(input.trace_path, "r");
    const buf = Buffer.alloc(262144);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const head = JSON.parse(buf.subarray(0, n).toString("utf8").split("\\n")[0]);
    const dir = head?.type === "session_meta" ? head.payload?.workspace : null;
    return typeof dir === "string" && fs.statSync(dir).isDirectory() ? dir : null;
  } catch {
    return null;
  }
}
const cwd = workspace() ?? process.cwd();

// How many stops in a row this hook blocked in this Session: kept outside the Agent State.
const stateFile = path.join(
  os.tmpdir(),
  "penguin-ported-hooks",
  createHash("sha256").update(import.meta.filename).digest("hex").slice(0, 16),
  \`\${String(input.session_id ?? "none").replace(/[^A-Za-z0-9_-]/g, "_")}.json\`,
);
const blocksSoFar = () => {
  try {
    return Number(JSON.parse(fs.readFileSync(stateFile, "utf8")).blocks) || 0;
  } catch {
    return 0;
  }
};
const recordBlocks = (n) => {
  try {
    if (n === 0) fs.rmSync(stateFile, { force: true });
    else {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({ blocks: n }));
    }
  } catch {}
};
const previous = POINT === "stop" ? blocksSoFar() : 0;

let toolInput = {};
try {
  toolInput = JSON.parse(input.arguments ?? "{}");
} catch {}
if (input.tool_name === "exec_command" && typeof toolInput.cmd === "string") {
  toolInput = { ...toolInput, command: toolInput.cmd };
}
const payload = {
  session_id: input.session_id,
  transcript_path: input.trace_path,
  cwd,
  hook_event_name: EVENT,
  ...(POINT === "pre_tool_use" ? { tool_name: tool, tool_input: toolInput } : {}),
  ...(POINT === "user_prompt" ? { prompt: input.prompt ?? "" } : {}),
  ...(POINT === "stop" ? { stop_hook_active: previous > 0 } : {}),
};
const run = spawnSync(COMMAND, {
  shell: true,
  cwd,
  input: JSON.stringify(payload),
  encoding: "utf8",
  env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  timeout: ${Math.max(1, timeoutS - 1) * 1000},
});
const reply = (value) => {
  process.stdout.write(JSON.stringify(value));
  process.exit(0);
};

// A command that could not start at all: a guard fails closed, anything else lets the event pass.
const failed =
  run.error && run.error.code !== "ETIMEDOUT"
    ? String(run.error.code ?? "spawn error")
    : run.status === 127
      ? "exit 127, command not found"
      : run.status === 126
        ? "exit 126, not executable"
        : null;
if (failed !== null) {
  if (POINT === "pre_tool_use") {
    reply({ decision: "deny", reason: \`the ported guard \${GUARD} could not run: \${failed}\` });
  }
  process.stderr.write(\`the ported hook \${GUARD} could not run: \${failed}\\n\`);
  process.exit(0);
}

const out = (run.stdout ?? "").trim();
let answer = null;
try {
  answer = out === "" ? null : JSON.parse(out);
} catch {}
const said =
  answer?.hookSpecificOutput?.permissionDecisionReason ?? answer?.reason ?? (run.stderr ?? "").trim();
const reason = String(said).slice(0, 500) || "the ported hook said so";
if (POINT === "pre_tool_use") {
  const decision =
    answer?.hookSpecificOutput?.permissionDecision ??
    (answer?.decision === "block" ? "deny" : answer?.decision === "approve" ? "allow" : null);
  if (run.status === 2 || decision === "deny") reply({ decision: "deny", reason });
  // PenguinHarness has no "ask" from a hook: the safe side is to refuse.
  if (decision === "ask") {
    reply({ decision: "deny", reason: \`the source hook asked for confirmation: \${reason}\` });
  }
  if (decision === "allow") reply({ decision: "allow", reason: "allowed by the ported hook" });
} else if (POINT === "stop") {
  const blocked = run.status === 2 || answer?.decision === "block";
  if (!blocked) {
    recordBlocks(0);
    process.exit(0);
  }
  if (previous >= MAX_STOP_BLOCKS) {
    recordBlocks(0);
    process.stderr.write(
      \`the ported Stop hook \${GUARD} blocked \${MAX_STOP_BLOCKS} stops in a row; this one goes through\\n\`,
    );
    process.exit(0);
  }
  recordBlocks(previous + 1);
  reply({ decision: "continue", input: reason, reason: "the ported Stop hook asked to go on" });
} else {
  const context =
    answer?.hookSpecificOutput?.additionalContext ?? (answer === null && run.status === 0 ? out : "");
  if (context) reply({ context });
}
process.exit(0);
`;
}

/** The hook groups a parsed source holds, by event. */
function hooksOf(data) {
  const h = data?.hooks && typeof data.hooks === "object" ? data.hooks : null;
  if (h !== null) return h;
  const events = Object.keys(data ?? {}).filter(
    (k) => /^[A-Z][A-Za-z]+$/.test(k) && Array.isArray(data[k]),
  );
  return events.length > 0 ? Object.fromEntries(events.map((e) => [e, data[e]])) : null;
}

/** An MCP server's name as `--emit` writes it: lower case, `[a-z0-9_-]`, a letter or digit first. */
export const portedServerName = (sourceName) =>
  String(sourceName)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "");

/**
 * A matcher with the server part of each `mcp__<server>__` named as `--emit` names the server,
 * and the server names it could not carry over.
 */
function portedMatcher(matcher, known) {
  const unknown = [];
  const text = matcher.replace(/mcp__([A-Za-z0-9 ._-]+?)__/g, (all, server) => {
    const name = portedServerName(server);
    if (name === "" || tokenish(name)) {
      unknown.push(chars(server));
      return all;
    }
    if (!known.has(name)) unknown.push(name);
    return `mcp__${name}__`;
  });
  return { text, unknown };
}

const SIDE_FILE = ".ported-sources.json";

function emitHooks(hooks, framework, out, summary, sourceKey, knownServers) {
  const dirName = `${framework}-hooks`;
  const dir = path.join(out, "agent_state", "hooks", dirName);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, "hooks.json"), "utf8"));
  } catch {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, ".");
    manifest = {
      name: dirName,
      description: `Hooks ported from ${framework}`,
      version: `${today}.1`,
      stop: [],
      pre_tool_use: [],
      user_prompt: [],
    };
  }
  // Emitting a source again replaces what it wrote before.
  let sources = {};
  try {
    sources = JSON.parse(fs.readFileSync(path.join(dir, SIDE_FILE), "utf8"));
  } catch {}
  const previous = new Set(sources[sourceKey] ?? []);
  for (const point of Object.values(HOOK_POINTS)) {
    manifest[point] = (manifest[point] ?? []).filter((entry) => !previous.has(entry.command));
  }
  for (const file of previous) fs.rmSync(path.join(dir, file), { force: true });
  const written = [];

  const shownMatcher = (m) =>
    m === ""
      ? "any"
      : m.length <= 100 && lineKind(m, false) === null && !tokenish(m)
        ? m
        : chars(m);
  let asks = false;
  for (const [event, groups] of Object.entries(hooks)) {
    const point = HOOK_POINTS[event];
    const list =
      typeof groups === "string" ? [{ hooks: [{ type: "command", command: groups }] }] : groups;
    if (!Array.isArray(list)) continue;
    const handlers = list.flatMap((g) =>
      (Array.isArray(g?.hooks) ? g.hooks : [g]).map((h) => ({
        matcher: String(g?.matcher ?? ""),
        h,
      })),
    );
    if (point === undefined) {
      summary.unmapped.push(
        `hooks on ${shownName(event)} (${handlers.length}): no PenguinHarness point`,
      );
      continue;
    }
    for (const { matcher, h } of handlers) {
      const where = `${event} [${shownMatcher(matcher)}]`;
      if (h?.type !== undefined && h.type !== "command") {
        summary.unmapped.push(`hook ${where}: a ${shownName(String(h.type))} handler`);
        continue;
      }
      const command = typeof h?.command === "string" ? h.command : "";
      if (command === "") {
        summary.unmapped.push(`hook ${where}: no command`);
        continue;
      }
      if (lineKind(command, false) !== null || command.split(/\s+/).some((w) => tokenish(w))) {
        summary.unmapped.push(
          `hook ${where}: its command holds a credential-looking value; port it by hand`,
        );
        continue;
      }
      if (/CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT/.test(command)) {
        summary.unmapped.push(
          `hook ${where}: its command runs a file inside another tool's plugin`,
        );
        continue;
      }
      const ported = portedMatcher(matcher, knownServers);
      if (ported.unknown.length > 0) {
        summary.notes.push(
          `hook ${where}: its matcher names MCP server(s) this port does not carry (yet): ${ported.unknown.join(", ")}`,
        );
      }
      const timeout =
        typeof h.timeout === "number" && h.timeout > 0
          ? Math.ceil(h.timeout)
          : DEFAULT_HOOK_TIMEOUT_S;
      const prefix = point.replace(/_/g, "-");
      const taken = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
      let n = 1;
      while (taken.has(`${prefix}-${n}.mjs`)) n++;
      const file = `${prefix}-${n}.mjs`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, file),
        wrapperSource({
          framework,
          event,
          point,
          matcher: ported.text,
          command,
          timeoutS: timeout,
          guard: `${dirName}/${file}`,
        }),
      );
      manifest[point].push({
        command: file,
        timeout,
        ...(point === "user_prompt" ? { trigger: "prompt" } : {}),
      });
      written.push(file);
      if (point === "pre_tool_use") asks = true;
      summary.wrote.push(
        `hook ${where} → hooks/${dirName}/${file}, running ${commandLine(command)} in the Workspace`,
      );
      if (point === "user_prompt") {
        summary.notes.push(
          `hook ${where}: its added context carries over; a block (exit 2, "decision": "block") cannot be expressed and lets the prompt through`,
        );
      }
    }
  }
  if (asks) {
    summary.notes.push(
      'a ported PreToolUse hook that answers "ask" denies instead ("the source hook asked for confirmation"): there is no asking from a hook here',
    );
  }
  if (written.length > 0 || previous.size > 0) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "hooks.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    if (written.length > 0) sources[sourceKey] = written;
    else delete sources[sourceKey];
    fs.writeFileSync(path.join(dir, SIDE_FILE), `${JSON.stringify(sources, null, 2)}\n`);
  }
  return written.length;
}

// ---- The port folder -------------------------------------------------------------------------

function loadManifest(out, summary) {
  const file = path.join(out, "manifest.json");
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  }
  const base = path
    .basename(path.resolve(out))
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_");
  summary.wrote.push("a new manifest.json: give it the Agent's name and description");
  return {
    format: "penguin-agent-zip/1",
    exportedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    agentId: ID_RULE.test(base) ? base : "ported_agent",
    parts: {
      skills: false,
      hooks: false,
      memory: false,
      workbenches: false,
      workbenchData: false,
      schedules: false,
      traces: { kind: "none" },
    },
    vaultKeys: [],
    redacted: [],
    definition: {},
  };
}

/** The best-effort findings of a text, as `line N kind` items. */
function flagsOf(text, code, offset = 0) {
  const flags = [];
  let inKey = false;
  text.split(/\r?\n/).forEach((line, n) => {
    if (inKey) {
      if (/-----END /.test(line)) inKey = false;
      return;
    }
    const kind = lineKind(line, code);
    if (kind === "private key block" && !/-----END /.test(line)) inKey = true;
    if (kind !== null) flags.push(`line ${n + 1 + offset}: ${kind}`);
  });
  return flags;
}

/** Appends `text` to `<out>/agent_state/AGENTS.md` under `heading`. */
function appendInstructions(target, heading, text) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const had = fs.existsSync(target) && fs.readFileSync(target, "utf8").trim() !== "";
  const block = `${had ? "\n" : ""}${heading ? `## ${heading}\n\n` : ""}${text.trim()}\n`;
  fs.appendFileSync(target, block);
  return text.trim().split("\n").length;
}

function effortOf(data, framework, profile) {
  if (framework === "codex" && profile !== null) {
    const own = obj(obj(data.profiles)[profile]).model_reasoning_effort;
    if (typeof own === "string") data = { ...data, model_reasoning_effort: own };
  }
  const raw =
    (framework === "codex"
      ? data.model_reasoning_effort
      : framework === "qoder" || framework === "qwen-code"
        ? data.model?.reasoningEffort
        : (data.effortLevel ?? data.model_reasoning_effort)) ?? data.effort;
  if (typeof raw !== "string") return null;
  const level = LEVEL_ALIASES[raw.toLowerCase()] ?? raw.toLowerCase();
  return LEVELS.has(level) ? level : { unknown: raw };
}

function modelOf(data) {
  const m = typeof data.model === "string" ? data.model : data.model?.name;
  return typeof m === "string" && m.length <= 100 && !tokenish(m) && lineKind(m, false) === null
    ? m
    : null;
}

/**
 * `--emit <source> --framework <name> --out <port folder> [--project <path>] [--confirmed]`:
 * maps the source's MCP servers, hooks, effort setting and (for a subagent file) instructions into
 * the port folder, and prints a summary that holds no value of the source.
 */
export function emit(file, { framework, out, project, profile = null, confirmed }) {
  if (!FRAMEWORKS.includes(framework)) {
    say(`# --framework must be one of ${FRAMEWORKS.join(", ")}`);
    return 2;
  }
  if (isRefused(file)) {
    say(`# ${file}: a credential store; not read`);
    return 3;
  }
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    say(`# ${file}: ${err.code ?? "unreadable"}`);
    return 1;
  }
  const format = formatOf(file);
  let data;
  let body = null;
  let bodyOffset = 0;
  try {
    if (format === "markdown") {
      const fm = splitFrontmatter(text);
      data = fm === null ? {} : (parseYaml(fm.block) ?? {});
      body = fm === null ? text : fm.body;
      bodyOffset = fm === null ? 0 : fm.lines;
    } else if (format === null) {
      say(`# ${file}: not a JSON, TOML, YAML or Markdown file; nothing emitted`);
      return 1;
    } else {
      data = parseConfig(text, format) ?? {};
    }
  } catch (err) {
    say(`# could not parse ${file}${err?.line ? ` (line ${err.line})` : ""}; nothing emitted`);
    return 1;
  }
  const summary = { wrote: [], unmapped: [], notes: [] };
  fs.mkdirSync(out, { recursive: true });
  const manifest = loadManifest(out, summary);
  if (manifest === null) {
    say(`# ${path.join(out, "manifest.json")} does not parse; nothing emitted`);
    return 1;
  }
  manifest.definition ??= {};
  manifest.vaultKeys ??= [];
  manifest.parts ??= {};
  const vault = new Set(manifest.vaultKeys);

  // MCP servers.
  const servers = serversOf(data, framework, path.basename(file), project, summary.notes, profile);
  const list = Array.isArray(manifest.definition.mcpServers) ? manifest.definition.mcpServers : [];
  const used = new Set(list.map((s) => s.name));
  for (const [sourceName, spec] of servers) {
    const r = mapServer(sourceName, spec, framework, used);
    if (r.skipped) {
      summary.unmapped.push(`mcp server ${shownName(r.name)}: ${r.skipped}`);
      continue;
    }
    const at = list.findIndex((s) => s.name === r.entry.name);
    if (at === -1) list.push(r.entry);
    else list[at] = r.entry;
    used.add(r.entry.name);
    r.keys.forEach((k) => vault.add(k));
    const c = r.entry.config;
    const target = c.transport === "stdio" ? commandLine(c.command) : maskedUrl(c.url);
    const counts = [
      c.args ? `${c.args.length} arg${c.args.length === 1 ? "" : "s"}` : null,
      c.env ? `env ${Object.keys(c.env).map(shownEnv).join(", ")}` : null,
      c.headers
        ? `headers ${Object.keys(c.headers)
            .map((h) => headerPart(h) ?? chars(h))
            .join(", ")}`
        : null,
    ].filter(Boolean);
    summary.wrote.push(
      `mcp server ${r.entry.name} (${c.transport}): ${target}${counts.length ? `; ${counts.join("; ")}` : ""}` +
        `${r.secrets.length ? `; to the Vault: ${r.secrets.join(", ")}` : ""}${at === -1 ? "" : " (replaced the one of that name)"}`,
    );
    summary.notes.push(...r.notes);
  }
  if (list.length > 0) manifest.definition.mcpServers = list;
  const named = Array.isArray(data.mcpServers)
    ? data.mcpServers.filter((x) => typeof x === "string")
    : [];
  if (named.length > 0) {
    summary.unmapped.push(
      `mcpServers names ${named.length} server(s) configured elsewhere: emit the file that defines them`,
    );
  }

  // Hooks.
  const hooks = format === "markdown" ? null : hooksOf(data);
  if (hooks !== null) {
    const known = new Set(list.map((server) => server.name));
    if (emitHooks(hooks, framework, out, summary, path.resolve(file), known) > 0) {
      manifest.parts.hooks = true;
    }
  }
  if (format === "markdown" && data.hooks) summary.unmapped.push("hooks scoped to this subagent");

  // Model.
  const effort = effortOf(data, framework, profile);
  if (typeof effort === "string") {
    manifest.definition.model = { ...(manifest.definition.model ?? {}), thinkingLevel: effort };
    summary.wrote.push(`thinking level ${effort}`);
  } else if (effort?.unknown) {
    summary.unmapped.push(`effort ${chars(effort.unknown)}: no thinking level matches`);
  }
  const model = modelOf(data);
  if (model)
    summary.notes.push(
      `the source model is ${model}: pick it, or the closest one, from the Project's catalog`,
    );

  // A subagent's own instructions: a Codex agent file, or a Markdown subagent.
  const instructions =
    typeof data.developer_instructions === "string"
      ? data.developer_instructions
      : format === "markdown"
        ? body
        : null;
  if (instructions !== null && instructions.trim() !== "") {
    const flags = flagsOf(instructions, false, format === "markdown" ? bodyOffset : 0);
    if (flags.length > 0 && !confirmed) {
      summary.unmapped.push(
        `instructions not written, they may hold a credential (best effort): ${flags.join("; ")}. Ask the user; emit again with --confirmed`,
      );
    } else {
      const n = appendInstructions(path.join(out, "agent_state", "AGENTS.md"), null, instructions);
      summary.wrote.push(
        `agent_state/AGENTS.md: ${n} line${n === 1 ? "" : "s"} of instructions${flags.length ? " (confirmed)" : ""}`,
      );
    }
    if (typeof data.name === "string" && manifest.name === undefined) manifest.name = data.name;
    if (typeof data.description === "string" && manifest.description === undefined) {
      manifest.description = data.description.split("\n")[0];
    }
  }

  manifest.vaultKeys = [...vault].sort();
  fs.writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  say(`# emitted ${file} (${framework}) into ${out}`);
  for (const line of summary.wrote) say(`+ ${line}`);
  for (const line of summary.unmapped) say(`- not ported: ${line}`);
  for (const line of summary.notes) say(`! ${line}`);
  say(`# vault keys in the manifest: ${manifest.vaultKeys.join(", ") || "none"}`);
  return 0;
}

/**
 * `--append <text file> --to <file> [--heading <text>] [--confirmed]`: copies a text file into
 * another, verbatim, without printing it. A frontmatter is left behind (a `paths` scope becomes
 * one sentence). A file the best-effort check flags is copied only with `--confirmed`.
 */
export function append(src, to, { heading, confirmed }) {
  if (isRefused(src)) {
    say(`# ${src}: a credential store; not read`);
    return 3;
  }
  let text;
  try {
    text = fs.readFileSync(src, "utf8");
  } catch (err) {
    say(`# ${src}: ${err.code ?? "unreadable"}`);
    return 1;
  }
  const fm = splitFrontmatter(text);
  let body = fm === null ? text : fm.body;
  let scope = "";
  if (fm !== null) {
    try {
      const meta = parseYaml(fm.block) ?? {};
      const paths = Array.isArray(meta.paths)
        ? meta.paths
        : typeof meta.paths === "string"
          ? [meta.paths]
          : [];
      if (paths.length > 0)
        scope = `These instructions apply when working on files matching ${paths.map((p) => `\`${p}\``).join(", ")}.\n\n`;
    } catch {}
  }
  const flags = flagsOf(body, isCode(src), fm === null ? 0 : fm.lines);
  if (flags.length > 0 && !confirmed) {
    say(`# ${src}: not copied; it may hold a credential (best effort): ${flags.join("; ")}`);
    say(
      "# ask the user whether it may travel with the Agent; if so, append again with --confirmed",
    );
    return 1;
  }
  const n = appendInstructions(to, heading, scope + body.trim());
  say(
    `# appended ${n} line${n === 1 ? "" : "s"} of ${src} to ${to}${fm !== null ? " (frontmatter left behind)" : ""}${flags.length ? " (confirmed)" : ""}`,
  );
  return 0;
}
