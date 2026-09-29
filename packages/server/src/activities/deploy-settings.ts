/**
 * The deploy settings: where Penguin deploys activities to (Jenkins for QA and PROD, its job
 * names, where deployed media is served from, the framework versions, the git identity).
 *
 * Server-wide and admin-only: one Jenkins serves the organisation. Everything but the two
 * Jenkins tokens is stored in `server_settings` under one key; the tokens live in a 0600 file
 * under PENGUIN_HOME (`DEPLOY_SECRETS_FILE`) and never leave the server — the App is told only
 * whether one is set.
 *
 * Pure: parsing, validation, the token merge and the masked view. The service does the I/O.
 */
import { HttpError } from "../http/errors.js";
import type { DeploySettingReason, DeploySettingsView } from "./deploy-types.js";

/** The `server_settings` key the non-secret settings are stored under. */
export const DEPLOY_SETTINGS_KEY = "activityDeploy";

/** Where the tokens are kept, relative to PENGUIN_HOME. */
export const DEPLOY_SECRETS_FILE = "secrets/activity-deploy.json";

/**
 * Where a deployed activity finds its media unless an admin says otherwise: the framework's
 * token, which the activity-data deploy recognises, publishes and points at its media host.
 */
export const DEFAULT_MEDIA_PUBLIC_BASE = "{{MEDIA}}/";

/** The framework's media token, which a media address may keep for the framework to replace. */
export const MEDIA_TOKEN = "{{MEDIA}}";

/** Longest a name (job, user, tier, environment) may be. */
export const NAME_MAX = 200;
/** Longest a URL or remote may be. */
export const URL_MAX = 500;
/** Longest a token may be. */
export const TOKEN_MAX = 1000;
/** Bounds of a wait, in minutes. */
export const TIMEOUT_MIN_MINUTES = 1;
export const TIMEOUT_MAX_MINUTES = 240;

/** The stored settings: the view without the tokens. */
export interface DeploySettings {
  qa: Omit<DeploySettingsView["qa"], "token">;
  prod: Omit<DeploySettingsView["prod"], "token">;
  jobs: DeploySettingsView["jobs"];
  repos: DeploySettingsView["repos"];
  git: DeploySettingsView["git"];
  timeouts: DeploySettingsView["timeouts"];
}

/** The tokens, as the secrets file holds them. */
export interface DeploySecrets {
  qaToken?: string;
  prodToken?: string;
}

/** What an update does to each token: absent keeps it, null clears it, a string replaces it. */
export interface DeployTokenChanges {
  qa?: string | null;
  prod?: string | null;
}

export function defaultDeploySettings(): DeploySettings {
  return {
    qa: {
      jenkinsUrl: "",
      username: "",
      tier: "qa",
      environment: "loom",
      frameworkVersion: "",
      activityBaseUrl: "",
    },
    prod: {
      jenkinsUrl: "",
      username: "",
      tier: "prod",
      environment: "DEFAULT",
      frameworkVersion: "",
    },
    jobs: { moduleBuild: "Build WAF Modules", activityDeploy: "WAF Activity Deploy" },
    repos: {
      mediaPublicBase: DEFAULT_MEDIA_PUBLIC_BASE,
    },
    git: { userName: "", userEmail: "" },
    timeouts: { buildMinutes: 30, deployMinutes: 30 },
  };
}

type Group = Record<string, unknown>;

function asGroup(value: unknown): Group {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Group) : {};
}

/**
 * The stored settings, read tolerantly: a field that is missing or of the wrong type takes
 * its default, so a row written before a field existed (or hand-edited) still reads.
 */
export function readDeploySettings(raw: string | null): DeploySettings {
  const defaults = defaultDeploySettings();
  let stored: Group = {};
  if (raw !== null) {
    try {
      stored = asGroup(JSON.parse(raw));
    } catch {
      stored = {};
    }
  }
  const pick = <T extends Record<string, string | number>>(name: keyof DeploySettings, base: T) => {
    const group = asGroup(stored[name]);
    const out = { ...base };
    for (const key of Object.keys(base) as (keyof T)[]) {
      const value = group[key as string];
      if (typeof value === typeof base[key]) out[key] = value as T[keyof T];
    }
    return out;
  };
  return {
    qa: pick("qa", defaults.qa),
    prod: pick("prod", defaults.prod),
    jobs: pick("jobs", defaults.jobs),
    repos: pick("repos", defaults.repos),
    git: pick("git", defaults.git),
    timeouts: pick("timeouts", defaults.timeouts),
  };
}

/** The secrets file's contents; anything unreadable is no tokens. */
export function readDeploySecrets(text: string | null): DeploySecrets {
  if (text === null) return {};
  try {
    const value = asGroup(JSON.parse(text));
    const out: DeploySecrets = {};
    if (typeof value.qaToken === "string" && value.qaToken) out.qaToken = value.qaToken;
    if (typeof value.prodToken === "string" && value.prodToken) out.prodToken = value.prodToken;
    return out;
  } catch {
    return {};
  }
}

/** A refused field: the App words `reason`; the message is for logs and API callers. */
function invalid(field: string, reason: DeploySettingReason, message: string): HttpError {
  return new HttpError(400, "invalid_deploy_setting", `${field}: ${message}`, undefined, {
    field,
    reason,
  });
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

function text(value: unknown, field: string, max = NAME_MAX): string {
  if (typeof value !== "string") throw invalid(field, "not_text", "must be a string.");
  const trimmed = value.trim();
  if (CONTROL.test(trimmed))
    throw invalid(field, "control_characters", "must not contain control characters.");
  if (trimmed.length > max) throw invalid(field, "too_long", `must be ${max} characters or fewer.`);
  return trimmed;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A web address the server will call or link to: https, or http on this machine only (a
 * local Jenkins while trying things out). No credentials in it, no query, no fragment; the
 * trailing slash is dropped so paths join cleanly. Empty means not set.
 */
export function normalizeHttpUrl(value: unknown, field: string): string {
  const raw = text(value, field, URL_MAX);
  if (raw === "") return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid(
      field,
      "not_address",
      "must be a full address, like https://jenkins.example.org.",
    );
  }
  const local = url.protocol === "http:" && LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !local)
    throw invalid(
      field,
      "https_required",
      "must start with https:// (http:// only for localhost).",
    );
  if (url.username || url.password)
    throw invalid(field, "credentials_in_address", "must not contain a user or password.");
  if (url.search || url.hash)
    throw invalid(field, "query_in_address", "must not have a query or fragment.");
  return url.toString().replace(/\/+$/, "");
}

/** `git@host:owner/repo.git` */
const SCP_REMOTE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~/-]+$/;

/**
 * A git remote a clone is made from: the scp-like SSH form, ssh://, or https:// (http:// on
 * localhost). The host's SSH keys authenticate; a remote carrying a password is refused, as
 * it would be stored in the clear.
 */
export function normalizeRemote(value: unknown, field: string): string {
  const raw = text(value, field, URL_MAX);
  if (raw === "") return "";
  if (SCP_REMOTE.test(raw) && !raw.includes("..")) return raw;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid(field, "not_remote", "must be a git remote, like git@github.com:owner/repo.git.");
  }
  const local = url.protocol === "http:" && LOOPBACK.has(url.hostname);
  if (url.protocol !== "ssh:" && url.protocol !== "https:" && !local)
    throw invalid(
      field,
      "remote_scheme",
      "must be an ssh:// or https:// remote, or git@host:owner/repo.git.",
    );
  if (url.password) throw invalid(field, "password_in_remote", "must not contain a password.");
  if (url.search || url.hash)
    throw invalid(field, "query_in_address", "must not have a query or fragment.");
  return raw;
}

/**
 * Whether a remote read from somewhere other than the settings (a module's package.json) is
 * one a clone may be made from: the same rule the settings' remotes pass.
 */
export function isAllowedRemote(remote: string): boolean {
  try {
    return normalizeRemote(remote, "remote") !== "";
  } catch {
    return false;
  }
}

/**
 * Where a deployed activity finds its media: a path on the activity's own host (`/media/`), a
 * web address (https, or http on localhost), or the framework's token (`{{MEDIA}}/`), which
 * the activity-data deploy recognises and replaces (the default). Always ends with one slash,
 * so a media path follows it directly; empty takes the default.
 */
export function normalizeMediaBase(value: unknown, field: string): string {
  const raw = text(value, field, URL_MAX);
  if (raw === "") return DEFAULT_MEDIA_PUBLIC_BASE;
  const refuse = () =>
    invalid(
      field,
      "not_media_base",
      "must be a path like /media/, an https:// address, or {{MEDIA}}/.",
    );
  if (/[\s"'<>`\\?#]/.test(raw)) throw refuse();
  const slashed = `${raw.replace(/\/+$/, "")}/`;
  if (raw.startsWith(MEDIA_TOKEN)) {
    if (slashed !== `${MEDIA_TOKEN}/`) throw refuse();
    return slashed;
  }
  if (raw.startsWith("/")) {
    if (raw.startsWith("//") || raw.split("/").some((part) => part === "." || part === ".."))
      throw refuse();
    return slashed;
  }
  try {
    new URL(raw);
  } catch {
    throw refuse();
  }
  return `${normalizeHttpUrl(raw, field)}/`;
}

/** "4.2", "4.2.1", "v4.2.1", "4.2.1-rc.1"; empty means not set. */
const FRAMEWORK_VERSION = /^v?\d+(?:\.\d+){0,2}(?:[-+][0-9A-Za-z.-]+)?$/;

function frameworkVersion(value: unknown, field: string): string {
  const raw = text(value, field, 64);
  if (raw !== "" && !FRAMEWORK_VERSION.test(raw))
    throw invalid(field, "not_version", "must be a version number, like 4.2.1.");
  return raw;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function email(value: unknown, field: string): string {
  const raw = text(value, field);
  if (raw !== "" && !EMAIL.test(raw))
    throw invalid(field, "not_email", "must be an email address.");
  return raw;
}

/** A job name: an empty one falls back to its default, so a job is always named. */
function jobName(value: unknown, field: string, fallback: string): string {
  return text(value, field) || fallback;
}

function minutes(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < TIMEOUT_MIN_MINUTES ||
    value > TIMEOUT_MAX_MINUTES
  )
    throw invalid(
      field,
      "minutes_range",
      `must be a whole number of minutes from ${TIMEOUT_MIN_MINUTES} to ${TIMEOUT_MAX_MINUTES}.`,
    );
  return value;
}

/** A token update: "" keeps the stored one, null clears it, anything else replaces it. */
function token(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw invalid(field, "not_text", "must be a string or null.");
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (/\s/.test(trimmed) || CONTROL.test(trimmed))
    throw invalid(field, "token_spaces", "must not contain spaces or control characters.");
  if (trimmed.length > TOKEN_MAX)
    throw invalid(field, "too_long", `must be ${TOKEN_MAX} characters or fewer.`);
  return trimmed;
}

function groupOf(input: Group, name: string): Group | null {
  const value = input[name];
  if (value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid(name, "not_object", "must be an object.");
  return value as Group;
}

/**
 * Applies an update to the stored settings. Every field is validated before anything is
 * returned, so a rejected update changes nothing; a field left out keeps its stored value.
 */
export function normalizeDeploySettings(
  input: unknown,
  current: DeploySettings,
): { settings: DeploySettings; tokens: DeployTokenChanges } {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw invalid("settings", "not_object", "must be an object.");
  const body = input as Group;
  const next: DeploySettings = structuredClone(current);
  const tokens: DeployTokenChanges = {};
  const set = <T>(group: Group | null, key: string, apply: (value: unknown) => T): T | undefined =>
    group && group[key] !== undefined ? apply(group[key]) : undefined;

  const qa = groupOf(body, "qa");
  next.qa.jenkinsUrl =
    set(qa, "jenkinsUrl", (v) => normalizeHttpUrl(v, "qa.jenkinsUrl")) ?? next.qa.jenkinsUrl;
  next.qa.username = set(qa, "username", (v) => text(v, "qa.username")) ?? next.qa.username;
  next.qa.tier = set(qa, "tier", (v) => text(v, "qa.tier")) ?? next.qa.tier;
  next.qa.environment =
    set(qa, "environment", (v) => text(v, "qa.environment")) ?? next.qa.environment;
  next.qa.frameworkVersion =
    set(qa, "frameworkVersion", (v) => frameworkVersion(v, "qa.frameworkVersion")) ??
    next.qa.frameworkVersion;
  next.qa.activityBaseUrl =
    set(qa, "activityBaseUrl", (v) => normalizeHttpUrl(v, "qa.activityBaseUrl")) ??
    next.qa.activityBaseUrl;
  if (qa && "token" in qa) {
    const change = token(qa.token, "qa.token");
    if (change !== undefined) tokens.qa = change;
  }

  const prod = groupOf(body, "prod");
  next.prod.jenkinsUrl =
    set(prod, "jenkinsUrl", (v) => normalizeHttpUrl(v, "prod.jenkinsUrl")) ?? next.prod.jenkinsUrl;
  next.prod.username = set(prod, "username", (v) => text(v, "prod.username")) ?? next.prod.username;
  next.prod.tier = set(prod, "tier", (v) => text(v, "prod.tier")) ?? next.prod.tier;
  next.prod.environment =
    set(prod, "environment", (v) => text(v, "prod.environment")) ?? next.prod.environment;
  next.prod.frameworkVersion =
    set(prod, "frameworkVersion", (v) => frameworkVersion(v, "prod.frameworkVersion")) ??
    next.prod.frameworkVersion;
  if (prod && "token" in prod) {
    const change = token(prod.token, "prod.token");
    if (change !== undefined) tokens.prod = change;
  }

  const defaults = defaultDeploySettings();
  const jobs = groupOf(body, "jobs");
  next.jobs.moduleBuild =
    set(jobs, "moduleBuild", (v) => jobName(v, "jobs.moduleBuild", defaults.jobs.moduleBuild)) ??
    next.jobs.moduleBuild;
  next.jobs.activityDeploy =
    set(jobs, "activityDeploy", (v) =>
      jobName(v, "jobs.activityDeploy", defaults.jobs.activityDeploy),
    ) ?? next.jobs.activityDeploy;

  const repos = groupOf(body, "repos");
  next.repos.mediaPublicBase =
    set(repos, "mediaPublicBase", (v) => normalizeMediaBase(v, "repos.mediaPublicBase")) ??
    next.repos.mediaPublicBase;

  const git = groupOf(body, "git");
  next.git.userName = set(git, "userName", (v) => text(v, "git.userName")) ?? next.git.userName;
  next.git.userEmail =
    set(git, "userEmail", (v) => email(v, "git.userEmail")) ?? next.git.userEmail;

  const timeouts = groupOf(body, "timeouts");
  next.timeouts.buildMinutes =
    set(timeouts, "buildMinutes", (v) => minutes(v, "timeouts.buildMinutes")) ??
    next.timeouts.buildMinutes;
  next.timeouts.deployMinutes =
    set(timeouts, "deployMinutes", (v) => minutes(v, "timeouts.deployMinutes")) ??
    next.timeouts.deployMinutes;

  return { settings: next, tokens };
}

/** The stored tokens after an update: absent keeps, null clears, a string replaces. */
export function mergeSecrets(stored: DeploySecrets, changes: DeployTokenChanges): DeploySecrets {
  const out: DeploySecrets = { ...stored };
  if (changes.qa === null) delete out.qaToken;
  else if (changes.qa !== undefined) out.qaToken = changes.qa;
  if (changes.prod === null) delete out.prodToken;
  else if (changes.prod !== undefined) out.prodToken = changes.prod;
  return out;
}

/** What the App is shown: the settings, with each token reduced to whether it is set. */
export function viewOf(settings: DeploySettings, secrets: DeploySecrets): DeploySettingsView {
  return {
    qa: { ...settings.qa, token: { set: Boolean(secrets.qaToken) } },
    prod: { ...settings.prod, token: { set: Boolean(secrets.prodToken) } },
    jobs: { ...settings.jobs },
    repos: { ...settings.repos },
    git: { ...settings.git },
    timeouts: { ...settings.timeouts },
  };
}

/**
 * The settings a deploy to QA cannot start without, by dotted path, in the order the
 * settings page lists them. PROD's own settings are checked when a PROD deploy is asked for.
 */
export function missingSettings(settings: DeploySettings, secrets: DeploySecrets): string[] {
  const required: Array<[string, string]> = [
    ["qa.jenkinsUrl", settings.qa.jenkinsUrl],
    ["qa.username", settings.qa.username],
    ["qa.token", secrets.qaToken ?? ""],
    ["qa.tier", settings.qa.tier],
    ["qa.environment", settings.qa.environment],
    ["qa.frameworkVersion", settings.qa.frameworkVersion],
    ["qa.activityBaseUrl", settings.qa.activityBaseUrl],
    ["jobs.moduleBuild", settings.jobs.moduleBuild],
    ["jobs.activityDeploy", settings.jobs.activityDeploy],
    ["git.userName", settings.git.userName],
    ["git.userEmail", settings.git.userEmail],
  ];
  return required.filter(([, value]) => value.trim() === "").map(([field]) => field);
}

/**
 * The settings a deploy to PROD cannot start without, by dotted path, in the order the
 * settings page lists them. The jobs and identity are QA's, checked by
 * `missingSettings` before QA could have run.
 */
export function missingProdSettings(settings: DeploySettings, secrets: DeploySecrets): string[] {
  const required: Array<[string, string]> = [
    ["prod.jenkinsUrl", settings.prod.jenkinsUrl],
    ["prod.username", settings.prod.username],
    ["prod.token", secrets.prodToken ?? ""],
    ["prod.tier", settings.prod.tier],
    ["prod.environment", settings.prod.environment],
    ["prod.frameworkVersion", settings.prod.frameworkVersion],
    ["jobs.activityDeploy", settings.jobs.activityDeploy],
  ];
  return required.filter(([, value]) => value.trim() === "").map(([field]) => field);
}
