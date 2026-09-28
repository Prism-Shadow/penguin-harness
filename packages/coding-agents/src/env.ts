/**
 * Child-process environment composition for spawned coding agents. Agents are third-party
 * programs: they get an allow-list of the host environment (path/locale/proxy plumbing
 * only) plus the definition's explicit vars, never a wholesale `process.env` — the same
 * shape the use-codex plugin's profile uses, generalized.
 */

const PASS_THROUGH =
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|LANG|LC_ALL|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS)$/i;

export function sandboxedAgentEnv(
  extra: Record<string, string> = {},
  inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value !== undefined && PASS_THROUGH.test(key)) env[key] = value;
  }
  return { ...env, ...extra };
}

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_ENV_VALUE = 8192;

/**
 * Names an agent definition may not set: the ones the sandbox passes through from the host
 * (overriding them breaks how the agent starts) and the ones Penguin sets itself.
 */
export function isReservedEnvKey(key: string): boolean {
  return PASS_THROUGH.test(key) || /^NO_BROWSER$/i.test(key) || /^PENGUIN_/i.test(key);
}

/**
 * Why an entry cannot be stored, or null when it can. An undefined value means "keep the
 * stored one" and only the name is checked.
 */
export function validateAgentEnvEntry(key: string, value: string | undefined): string | null {
  if (!ENV_KEY_PATTERN.test(key)) {
    return `${key}: a name starts with a letter or underscore and uses only letters, digits and underscores.`;
  }
  if (isReservedEnvKey(key)) return `${key} is set by Penguin and cannot be changed here.`;
  if (value === undefined) return null;
  if (value === "") return `${key}: the value is empty.`;
  if (/[\r\n]/.test(value)) return `${key}: the value cannot contain a line break.`;
  if (value.length > MAX_ENV_VALUE)
    return `${key}: the value is longer than ${MAX_ENV_VALUE} characters.`;
  return null;
}
