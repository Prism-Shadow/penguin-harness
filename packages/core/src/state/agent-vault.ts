/**
 * Agent-level environment-variable vault (`<project>/<agent_id>/agent_state/.vault.toml`).
 *
 * Key-value pairs such as third-party API keys, configured per Agent: injected into that Agent
 * session's `exec_command` / `input_command` child-process environment, with key names disclosed
 * to the model via the system Prompt while values never enter the model context. Carries the same
 * trade-offs as a credential: stored in plaintext on disk, masked at the API layer. The file is
 * created/removed together with the Agent directory; its absence is treated as an empty table;
 * once emptied, the file is removed to avoid leaving a stray empty .vault.toml.
 * Docs: /docs/configuration § "Vault".
 */
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { agentVaultPath } from "./paths.js";
import { assertValidId } from "./agent-state.js";

/** Vault key-name constraint: matches shell environment variable names (starts with a letter or underscore, followed by letters/digits/underscores only). */
const VAULT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Vault value length cap: since values are injected into the child-process environment, Linux
 * caps a single env entry at roughly 128KB, and an oversized value would make every
 * exec_command spawn for that Agent fail (E2BIG) — so it's rejected on the write side (core and
 * the API layer share this same cap).
 */
export const VAULT_VALUE_MAX_LENGTH = 8192;

/** Whether a vault key name is valid (shell environment variable name rules). */
export function isValidVaultKey(key: string): boolean {
  return VAULT_KEY_PATTERN.test(key);
}

/** Validates a vault key name, throwing if invalid (core and the API layer share this same rule). */
export function assertValidVaultKey(key: string): void {
  if (!isValidVaultKey(key)) {
    throw new Error(
      `Invalid vault key ${JSON.stringify(key)}: only letters, digits and "_" are allowed, and it must not start with a digit.`,
    );
  }
}

/** Validates a vault value's length (see `VAULT_VALUE_MAX_LENGTH`), throwing if it exceeds the cap. */
export function assertValidVaultValue(key: string, value: string): void {
  if (value.length > VAULT_VALUE_MAX_LENGTH) {
    throw new Error(
      `Vault value for ${key} is too long: ${value.length} > ${VAULT_VALUE_MAX_LENGTH} characters.`,
    );
  }
}

/**
 * Reads the Agent vault: returns an empty table if the file doesn't exist.
 * A hand-edited file is filtered by the same rule as the write side: only string values are
 * accepted (numbers/dates etc. are ignored), and key names must follow shell variable name rules
 * (invalid keys are always ignored — otherwise they'd get injected into the Prompt/child-process
 * environment, and an invalid key surfaced by a GET view would make a full-table PUT 400, leaving
 * the vault page unable to add or remove any further entries).
 */
export async function loadAgentVault(
  root: string,
  projectId: string,
  agentId: string,
): Promise<Record<string, string>> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  let raw: string;
  try {
    raw = await fs.readFile(agentVaultPath(root, projectId, agentId), "utf8");
  } catch {
    return {};
  }
  const parsed: unknown = parseToml(raw) ?? {};
  const vault: Record<string, string> = {};
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && isValidVaultKey(k)) vault[k] = v;
    }
  }
  return vault;
}

/**
 * Writes the full table to the Agent vault: validates all key names first; an empty table
 * deletes the file (idempotent if it doesn't exist).
 * The directory is created automatically if it doesn't exist (the vault can be configured even
 * before the Agent is initialized).
 */
export async function saveAgentVault(
  root: string,
  projectId: string,
  agentId: string,
  vault: Record<string, string>,
): Promise<void> {
  assertValidId("project_id", projectId);
  assertValidId("agent_id", agentId);
  for (const key of Object.keys(vault)) assertValidVaultKey(key);
  const file = agentVaultPath(root, projectId, agentId);
  if (Object.keys(vault).length === 0) {
    await fs.rm(file, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  // The secret file is written to disk with mode 0600 (a hidden file blocks `ls`, not reads; mode
  // only takes effect on creation, so chmod is applied to converge an existing file too).
  await fs.writeFile(file, `${stringifyToml(vault)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.chmod(file, 0o600);
}

/**
 * Writes or updates one vault entry (added if it doesn't exist, overwritten if it does).
 * The key name must follow shell environment variable name rules (see `isValidVaultKey`), and the
 * value length is constrained by `VAULT_VALUE_MAX_LENGTH`; throws if invalid. Returns the updated
 * vault.
 */
export async function setVaultEntry(
  root: string,
  projectId: string,
  agentId: string,
  key: string,
  value: string,
): Promise<Record<string, string>> {
  assertValidVaultKey(key);
  assertValidVaultValue(key, value);
  const vault = await loadAgentVault(root, projectId, agentId);
  vault[key] = value;
  await saveAgentVault(root, projectId, agentId, vault);
  return vault;
}

/**
 * Removes one vault entry; idempotent if the key doesn't exist (no write happens). Once emptied,
 * the whole .vault.toml is removed. Returns the updated vault.
 */
export async function removeVaultEntry(
  root: string,
  projectId: string,
  agentId: string,
  key: string,
): Promise<Record<string, string>> {
  const vault = await loadAgentVault(root, projectId, agentId);
  if (!(key in vault)) return vault;
  delete vault[key];
  await saveAgentVault(root, projectId, agentId, vault);
  return vault;
}
