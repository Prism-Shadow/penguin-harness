/**
 * Terminals as the servers hold them, behind the package's fetch fake ({@link stubFetch}): this
 * server and any number of machines, each with shells of its own. A terminal is a pty on ONE
 * machine, so each source answers only for its own: `GET /api/terminals` lists a source's shells
 * (a machine's through `/server/<id>/api/…`), `DELETE /api/terminals/<id>` reaches the source that
 * holds the shell — and, as on the real server, only signals it: the shell is still listed alive
 * until the test says its pty exited ({@link TerminalWorld.exit}, {@link TerminalWorld.remove}).
 *
 * A source can stop answering (the request fails at the network, as an unreachable machine's
 * relay does) or answer every terminal request with one status: 404 is a runtime older than the
 * terminal API, 401 a sign-in that no longer holds (`/api/me` then answers 401 as well).
 */
import type { TerminalInfo } from "../../src/features/terminal/terminal-view";
import { ADMIN_ME } from "./admin-settings";
import { apiError, json, stubFetch } from "./fetch";
import type { FakeFetch, FetchRequest } from "./fetch";

/** A shell as a test names it: an id, alive unless said otherwise. */
export interface Shell {
  id: string;
  alive?: boolean;
  title?: string | null;
}

export interface TerminalWorld {
  fetch: FakeFetch;
  /** Puts a shell on a source (null = this server). */
  add(source: string | null, shell: Shell): void;
  /** The shell's pty exited: still listed, no longer alive. */
  exit(id: string): void;
  /** The server stops listing the shell at all. */
  remove(id: string): void;
  /** The source stops answering (true) or answers again (false). */
  unreachable(source: string | null, down?: boolean): void;
  /** The source answers every terminal request with `status`; null restores normal answers. */
  answerWith(source: string | null, status: number | null): void;
  /** The terminal requests that reached a source, optionally of one method. */
  requests(source: string | null, method?: string): FetchRequest[];
}

export function terminalWorld(
  initial: { here?: Shell[]; machines?: Record<string, Shell[]> } = {},
): TerminalWorld {
  /** Shells by source: "" is this server. */
  const shells = new Map<string, TerminalInfo[]>();
  const down = new Set<string>();
  const statuses = new Map<string, number>();
  const keyOf = (source: string | null) => source ?? "";
  let seq = 0;
  const add = (source: string | null, shell: Shell) => {
    seq += 1;
    const info: TerminalInfo = {
      id: shell.id,
      seq,
      name: `shell ${seq}`,
      cwd: "~",
      alive: shell.alive ?? true,
      title: shell.title ?? null,
    };
    shells.set(keyOf(source), [...(shells.get(keyOf(source)) ?? []), info]);
  };
  for (const shell of initial.here ?? []) add(null, shell);
  for (const [machine, list] of Object.entries(initial.machines ?? {})) {
    for (const shell of list) add(machine, shell);
  }

  const isTerminalPath = (path: string) =>
    path === "/api/terminals" || path.startsWith("/api/terminals/");
  const fetch = stubFetch((request) => {
    const source = keyOf(request.machine);
    if (request.path === "/api/me") {
      return statuses.get("") === 401 ? apiError(401, "unauthorized") : json(ADMIN_ME);
    }
    if (!isTerminalPath(request.path)) return apiError(404, "not_found");
    if (down.has(source)) throw new TypeError("Failed to fetch");
    const status = statuses.get(source);
    if (status !== undefined) return apiError(status, status === 404 ? "not_found" : "refused");
    const list = shells.get(source) ?? [];
    if (request.path === "/api/terminals" && request.method === "GET") {
      return json({ terminals: list });
    }
    const id = decodeURIComponent(request.path.slice("/api/terminals/".length));
    if (request.method === "DELETE" && list.some((t) => t.id === id)) {
      return new Response(null, { status: 204 });
    }
    return apiError(404, "terminal_not_found");
  });

  const update = (id: string, change: (list: TerminalInfo[]) => TerminalInfo[]) => {
    for (const [source, list] of shells) {
      if (list.some((t) => t.id === id)) shells.set(source, change(list));
    }
  };
  return {
    fetch,
    add,
    exit: (id) => update(id, (list) => list.map((t) => (t.id === id ? { ...t, alive: false } : t))),
    remove: (id) => update(id, (list) => list.filter((t) => t.id !== id)),
    unreachable: (source, isDown = true) => {
      if (isDown) down.add(keyOf(source));
      else down.delete(keyOf(source));
    },
    answerWith: (source, status) => {
      if (status === null) statuses.delete(keyOf(source));
      else statuses.set(keyOf(source), status);
    },
    requests: (source, method) =>
      fetch.requests.filter(
        (r) =>
          r.machine === source &&
          isTerminalPath(r.path) &&
          (method === undefined || r.method === method),
      ),
  };
}
