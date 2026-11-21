/**
 * The platform origins the key-authorization flows talk to, validated from their
 * environment variables. Pure vocabulary — the server's config assembly reads the
 * environment once and passes the result to the flow providers; these validators are
 * what both the assembly and the providers' defaults call.
 */
import { PENGUIN_GO_BASE_URL } from "./model-catalog/catalog.js";

/** HTTPS in production; plain HTTP is accepted only for an explicit loopback integration. */
export function normalizePenguinGoOrigin(raw: string | undefined): string {
  const value = raw?.trim() || new URL(PENGUIN_GO_BASE_URL).origin;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid PENGUIN_GO_ORIGIN=${value} (expected an absolute HTTP(S) origin)`);
  }
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      `Invalid PENGUIN_GO_ORIGIN=${value} (paths, credentials, query and fragment are not allowed)`,
    );
  }
  const loopback =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`Invalid PENGUIN_GO_ORIGIN=${value} (HTTPS required except for loopback HTTP)`);
  }
  return url.origin;
}

/**
 * Validates MODELSCOPE_BRIDGE_URL into a base URL with no trailing slash, or throws.
 *
 * Deliberately looser than normalizePenguinGoOrigin in exactly one place: a PATH PREFIX is
 * allowed, because the bridge is mounted under one in production
 * (`https://go.penguin.ooo/modelscope`) and strips it from the request itself — so the
 * prefix is part of the address the client must call. Credentials, query, fragment and
 * plaintext HTTP stay rejected.
 */
export function normalizeModelScopeBridgeUrl(raw: string | undefined): string {
  const value = raw?.trim() || "https://go.penguin.ooo/modelscope";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid MODELSCOPE_BRIDGE_URL=${value} (expected an absolute HTTP(S) URL)`);
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error(
      `Invalid MODELSCOPE_BRIDGE_URL=${value} (credentials, query and fragment are not allowed)`,
    );
  }
  if (url.protocol !== "https:") {
    throw new Error(`Invalid MODELSCOPE_BRIDGE_URL=${value} (HTTPS required)`);
  }
  // A bare origin parses as pathname "/", which must become "" rather than stay a slash, or
  // every appended route would read `//oauth/start`.
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}
