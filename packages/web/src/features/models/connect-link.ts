/**
 * A link that opens the Models page on a provider's connect flow: the first-run guide's 「连接」
 * buttons. The page starts the flow once (owner only, and only for a group the catalog gives a
 * connect flow), then drops the parameter so a reload or a Back does not start it again.
 */

/** The query parameter naming the provider whose connect flow the Models page opens on. */
export const CONNECT_PARAM = "connect";

export function connectPath(providerId: string): string {
  return `/models?${CONNECT_PARAM}=${encodeURIComponent(providerId)}`;
}
