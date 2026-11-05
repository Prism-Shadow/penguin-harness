// The masked view of the agent-porting reader: a parsed configuration printed by allowlist. What
// it cannot show to be harmless, it prints as `<redacted:N chars>`. Built-in modules only.
import {
  REFERENCE,
  chars,
  credentialFlag,
  isCredentialKey,
  isEnvName,
  lineKind,
  pathShaped,
  pathToken,
  referenceParts,
  safeKey,
  tokenish,
} from "./detect.mjs";

/** The keys whose string values print (after the detectors). */
const STRUCTURAL = new Set([
  // identity and shape
  "name",
  "id",
  "title",
  "type",
  "transport",
  "kind",
  "format",
  "version",
  "serverName",
  "matcher",
  "trigger",
  // a process
  "cwd",
  "timeout",
  "enabled",
  "disabled",
  // model and permission settings the mapping reads
  "model",
  "model_provider",
  "model_reasoning_effort",
  "reasoningEffort",
  "effortLevel",
  "effort",
  "thinkingLevel",
  "approval_policy",
  "approvalMode",
  "sandbox_mode",
  "defaultMode",
  "permissionMode",
]);
/** Hook events: a string straight under one is a shell line, printed as `command` is. */
const HOOK_EVENTS = new Set([
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "UserPromptSubmit",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "SessionStart",
  "SessionEnd",
  "Notification",
  "PreCompact",
  "PostCompact",
  "PermissionRequest",
]);
const URL_KEYS = new Set(["url", "httpUrl", "baseUrl", "base_url", "endpoint"]);
/** Prose: never printed here; `--show <file> --key <path>` prints it, best-effort masked. */
const PROSE_KEYS = new Set(["description", "prompt", "developer_instructions", "instructions"]);
/** Keys whose values are the names of variables, never their values. */
export const NAME_HOLDER = /(^|_)env_?(var|key)s?$/i;

/** A reference: its variable's name when that is a plain name, else its structure only. */
export function reference(s) {
  const { scheme, kind, name, plain, fallback } = referenceParts(s);
  return `${scheme}\${${kind}${plain ? name : chars(name)}${fallback ? ":-<redacted:default>" : ""}}`;
}

/** A URL: scheme, host and a first path segment of plain lower case; nothing else. */
export function url(s) {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(s);
  if (m === null) return chars(s);
  const [, scheme, authority, rest, query, hash] = m;
  const at = authority.lastIndexOf("@");
  const host = at === -1 ? authority : `<redacted:userinfo>@${authority.slice(at + 1)}`;
  let first = true;
  const pathPart = rest
    .split("/")
    .map((seg) => {
      if (seg === "") return seg;
      const shown = first && /^[a-z][a-z0-9._-]{0,31}$/.test(seg) && !tokenish(seg);
      first = false;
      return shown ? seg : chars(seg);
    })
    .join("/");
  return `${scheme}${host}${pathPart}${query ? "?<redacted:query>" : ""}${hash ? "#<redacted:fragment>" : ""}`;
}

/** A shell line: its program, and how many more words it has. */
export function commandLine(s) {
  const words = s.trim().split(/\s+/).filter(Boolean);
  const program = words.findIndex((w) => !/^[A-Za-z_]\w*=/.test(w));
  if (program === -1) return chars(s);
  const head = pathToken(words[program]) ? words[program] : chars(words[program]);
  const more = words.length - 1;
  return more === 0 ? head : `${head} <redacted:${more} more word${more === 1 ? "" : "s"}>`;
}

/**
 * One argument: a flag prints, and so does a word shaped like a path or a package (a `/`, an `@`,
 * a `.`, a leading `~`) that does not follow a credential flag. Any other word does not, after a
 * flag or not.
 */
function arg(item, prev) {
  if (REFERENCE.test(item)) return reference(item);
  if (/^--?[A-Za-z][\w.-]*$/.test(item)) return item;
  const flag = /^(--?[A-Za-z][\w.-]*)=(.*)$/s.exec(item);
  if (flag) return `${flag[1]}=${REFERENCE.test(flag[2]) ? reference(flag[2]) : chars(flag[2])}`;
  if (credentialFlag(prev)) return chars(item);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(item)) return url(item);
  return pathShaped(item) ? item : chars(item);
}

function stringAt(s, key, ctx) {
  if (ctx.names) return isEnvName(s) ? s : chars(s);
  if (REFERENCE.test(s)) return reference(s);
  if (ctx.credential) return chars(s);
  if (URL_KEYS.has(key)) return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? url(s) : chars(s);
  if (key === "command" || HOOK_EVENTS.has(key)) {
    return /\s/.test(s.trim()) ? commandLine(s) : pathToken(s) ? s : chars(s);
  }
  if (PROSE_KEYS.has(key)) {
    const lines = s.split("\n").length;
    return `<text: ${lines} line${lines === 1 ? "" : "s"}; read it with --show <file> --key ${ctx.path}>`;
  }
  if (STRUCTURAL.has(key)) {
    return s.length <= 200 && lineKind(s, false) === null && !tokenish(s) ? s : chars(s);
  }
  return chars(s);
}

/**
 * A parsed value masked by allowlist. `ctx`: `credential` under a credential key, `args` in an
 * argument list, `names` where the values are names of variables, `path` the dotted way here.
 */
export function mask(
  value,
  key = "",
  ctx = { credential: false, args: false, names: false, path: "" },
) {
  if (Array.isArray(value)) {
    return value.map((item, i) => {
      const here = { ...ctx, args: false, path: ctx.path === "" ? String(i) : `${ctx.path}.${i}` };
      return typeof item === "string" && ctx.args && !ctx.credential
        ? arg(item, value[i - 1])
        : mask(item, key, here);
    });
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // An `env` map's keys are variable names: they print in that convention only.
      const shown =
        key === "env" && !isEnvName(k) ? `<redacted key:${k.length} chars>` : safeKey(k);
      out[shown] = mask(v, k, {
        credential: ctx.credential || isCredentialKey(k),
        args: k === "args" || (k === "command" && Array.isArray(v)),
        names: NAME_HOLDER.test(k) || key === "env_http_headers",
        path: ctx.path === "" ? k : `${ctx.path}.${k}`,
      });
    }
    return out;
  }
  if (typeof value === "string") return stringAt(value, key, ctx);
  if (typeof value === "number" && ctx.credential) return "<redacted:number>";
  return value;
}

/** The value at a dotted path (`mcpServers.x.description`, `items.0.prompt`), or undefined. */
export function at(data, dotted) {
  let v = data;
  for (const seg of dotted.split(".")) v = v !== null && typeof v === "object" ? v[seg] : undefined;
  return v;
}
