/**
 * Probing a candidate port for a dev server, and the one question worth asking about it: can this
 * dev server be read from another origin at all?
 *
 * The distinction the panel needs is not "is something there" but "is it *this* kind of thing":
 * a Vite dev server answers with CORS (its default allows loopback origins), so the page's HTML
 * and its entry module can be fetched and read — which is also the check that this project can be
 * located precisely at all (`inline source map`). A server that answers but hides its body is
 * offered with that much said, and a port with nothing on it is not offered.
 *
 * Everything here is read-only and stays on loopback: a GET of a page the user pointed at.
 */
import {
  entryModuleUrl,
  hasSourceMap,
  PORT_CANDIDATES,
  type DevServerKind,
} from "./workbench-state";

/** A probe has to feel instant and must never hold the panel's spinner on a dead port. */
const PROBE_TIMEOUT_MS = 1500;

export interface PageInspection {
  kind: DevServerKind;
  /** Whether the entry module carries a map the resolver can read — the precise tier's precondition. */
  sourceMap: "present" | "none" | "unknown";
  /** The page's `<title>`, when it could be read: what tells two projects on one port apart. */
  title: string | null;
}

export interface PortProbe extends PageInspection {
  port: number;
  url: string;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function pageTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = match?.[1]?.trim();
  return title ? title.slice(0, 80) : null;
}

/** Look at one page. Never throws: an address that cannot be reached is `none`, which is an answer. */
export async function inspectPage(url: string): Promise<PageInspection> {
  const miss: PageInspection = { kind: "none", sourceMap: "unknown", title: null };
  try {
    const res = await fetchWithTimeout(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) return { ...miss, kind: "listening" };
    const html = await res.text();
    const entry = entryModuleUrl(html, url);
    let sourceMap: PageInspection["sourceMap"] = "unknown";
    if (entry !== null) {
      try {
        const moduleRes = await fetchWithTimeout(entry, { mode: "cors", credentials: "omit" });
        sourceMap = hasSourceMap(await moduleRes.text()) ? "present" : "none";
      } catch {
        sourceMap = "unknown";
      }
    } else {
      sourceMap = "none";
    }
    const vite = html.includes("/@vite/client") || html.includes("@vite/client");
    return {
      kind: vite || sourceMap === "present" ? "vite" : "page",
      sourceMap,
      title: pageTitle(html),
    };
  } catch {
    // CORS refused us, but something may still be listening. `no-cors` answers exactly that:
    // it resolves for any response at all and rejects only when nothing is there.
    try {
      await fetchWithTimeout(url, { mode: "no-cors", credentials: "omit" });
      return { ...miss, kind: "listening" };
    } catch {
      return miss;
    }
  }
}

/** Probe one candidate port. */
export async function probePort(port: number): Promise<PortProbe> {
  const url = `http://localhost:${port}/`;
  return { port, url, ...(await inspectPage(url)) };
}

/** Probe every candidate port, in parallel; the caller renders whatever came back. */
export async function probeCandidatePorts(): Promise<PortProbe[]> {
  const probes = await Promise.all(PORT_CANDIDATES.map((port) => probePort(port)));
  return probes.filter((probe) => probe.kind !== "none");
}
