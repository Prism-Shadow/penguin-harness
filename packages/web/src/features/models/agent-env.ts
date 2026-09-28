/**
 * An agent's environment variables as the Models page edits them: the naming rule the server
 * enforces, and the Vault-style request that keeps stored values by sending names alone.
 */
import type {
  CodingAgentEnvEntryInfo,
  CodingAgentEnvRequest,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED =
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|LANG|LC_ALL|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS|NO_BROWSER)$|^PENGUIN_/i;

/** Why a new variable name cannot be used, or null. Same rule as the server's. */
export function envKeyProblem(key: string): string | null {
  if (key === "") return S.common.requiredField;
  if (!KEY_PATTERN.test(key)) return S.models.cliEnvKeyInvalid;
  if (RESERVED.test(key)) return S.models.cliEnvKeyReserved;
  return null;
}

/** Every stored variable by name alone (which keeps its value), except `exclude`. */
export function keepAllExcept(
  entries: CodingAgentEnvEntryInfo[],
  exclude?: string,
): CodingAgentEnvRequest["entries"] {
  return entries.filter((e) => e.key !== exclude).map((e) => ({ key: e.key }));
}
