/**
 * Agent API keys: `penguin_` + 43 base64url characters (32 random bytes), shown once at creation.
 * Only the sha256 of a key is stored, so authenticating a request is a lookup of a fixed-length
 * digest — its timing does not depend on how much of a guess matches a real key.
 */
import { createHash, randomBytes } from "node:crypto";

/** The marker every key starts with, so a leaked one is recognizable for what it is. */
export const AGENT_API_KEY_PREFIX = "penguin_";

/** How many leading characters of a key the list shows (`penguin_` + 8). */
const SHOWN_PREFIX_LENGTH = 16;

/** sha256 of a presented key, hex: what `agent_api_keys.token_hash` holds. */
export function hashAgentApiKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** A fresh key: the secret (handed to the caller once), its hash and the prefix the list shows. */
export function mintAgentApiKey(): {
  keyId: string;
  secret: string;
  tokenHash: string;
  prefix: string;
} {
  const secret = AGENT_API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return {
    keyId: randomBytes(12).toString("base64url"),
    secret,
    tokenHash: hashAgentApiKey(secret),
    prefix: secret.slice(0, SHOWN_PREFIX_LENGTH),
  };
}
