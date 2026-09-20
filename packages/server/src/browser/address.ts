/**
 * What the Browser may be pointed at, and which host names are its own.
 *
 * TWO KINDS OF ADDRESS. A loopback name — `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` —
 * typed into the Browser means the loopback of the machine the conversation's WORKSPACE is
 * on: that is where the dev server the agent just started is listening, and it is reached
 * through the connection held to that machine (or directly, for a Workspace on this server).
 * Any other name is a public address, fetched by this server the way its other outbound
 * traffic is. Nothing else exists: a name that resolves to a private, link-local or loopback
 * address is refused (egress.ts), so the Browser is never a way into the network this server
 * sits in.
 *
 * ITS OWN HOSTS. Every site is served on `<label>.localhost`, a host of its own, because a
 * cookie is scoped to a host and ignores the port: on any host the App also answers on, a
 * page could ride the session cookie. `<label>` is 26 base32 characters — 128 random bits,
 * a capability — and a DNS label, so browsers resolve it to the loopback with no DNS at all.
 */
import net from "node:net";

/** `<label>.localhost`: 26 lowercase base32 characters. */
const LABEL = /^[a-z2-7]{26}$/;
const BROWSER_HOST_SUFFIX = ".localhost";

/** The pattern `HttpModule.hosts` matches a request's hostname against (the manifest carries its source). */
export const BROWSER_HOST_PATTERN = "^[a-z2-7]{26}\\.localhost$";

/** The site label a Host header addresses, or null when the host is not a Browser host. */
export function browserLabelOf(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (!host.endsWith(BROWSER_HOST_SUFFIX)) return null;
  const label = host.slice(0, -BROWSER_HOST_SUFFIX.length);
  return LABEL.test(label) ? label : null;
}

export function browserHostOf(label: string): string {
  return `${label}${BROWSER_HOST_SUFFIX}`;
}

export type BrowserTarget =
  /** A port on the loopback of the Workspace's machine; `secure` = the server there speaks TLS. */
  | { kind: "workspace"; origin: string; port: number; secure: boolean }
  /** A public origin, fetched by this server. */
  | { kind: "public"; origin: string };

export type AddressRefusal = "invalid_url" | "unsupported_scheme" | "credentials_in_url";

function isLoopbackName(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "[::1]") return true;
  return net.isIPv4(host) && host.startsWith("127.");
}

/**
 * Reads an address as typed. A bare `localhost:3000` or `example.com` gets `http://` — what
 * a browser's own address bar does — and the path, query and fragment are the caller's to
 * keep: a target is an ORIGIN, because one site is one origin.
 */
export function parseBrowserAddress(
  typed: string,
): { target: BrowserTarget; url: URL } | { refused: AddressRefusal } {
  const text = typed.trim();
  if (text === "") return { refused: "invalid_url" };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    return { refused: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { refused: "unsupported_scheme" };
  }
  if (url.username !== "" || url.password !== "") return { refused: "credentials_in_url" };
  if (url.hostname === "") return { refused: "invalid_url" };

  if (isLoopbackName(url.hostname)) {
    const secure = url.protocol === "https:";
    const port = url.port === "" ? (secure ? 443 : 80) : Number(url.port);
    const origin = `${secure ? "https" : "http"}://localhost:${port}`;
    return { target: { kind: "workspace", origin, port, secure }, url };
  }
  return { target: { kind: "public", origin: url.origin }, url };
}

/** IPv4 ranges that are not the public internet. */
const NON_PUBLIC_V4: Array<[number, number]> = [
  [0x00000000, 8], // "this network"
  [0x0a000000, 8], // private
  [0x64400000, 10], // carrier-grade NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local, cloud metadata
  [0xac100000, 12], // private
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // documentation
  [0xc0a80000, 16], // private
  [0xc6120000, 15], // benchmarking
  [0xc6336400, 24], // documentation
  [0xcb007100, 24], // documentation
  [0xe0000000, 3], // multicast and reserved, broadcast included
];

function v4ToInt(address: string): number {
  return address.split(".").reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
}

/**
 * Whether an address is on the public internet — the only kind a public target may resolve
 * to. Everything that is not provably public is refused: an address family or a form this
 * does not recognise is not an opening.
 */
export function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const value = v4ToInt(address);
    return !NON_PUBLIC_V4.some(([base, bits]) => value >>> (32 - bits) === base >>> (32 - bits));
  }
  if (!net.isIPv6(address)) return false;
  const lower = address.toLowerCase();
  // An IPv4 address in IPv6 clothing is judged as the IPv4 address it is.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPublicAddress(mapped[1] as string);
  if (lower === "::" || lower === "::1") return false;
  const first = parseInt(lower.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (lower.startsWith("::ffff:")) return false; // mapped, in a form not read above
  if (lower.startsWith("64:ff9b:")) return false; // NAT64: an IPv4 address behind a prefix
  return true;
}
