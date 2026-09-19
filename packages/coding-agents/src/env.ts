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
