// @vitest-environment jsdom
/**
 * New folder in the Workspace finder (features/chat/workspace-finder.tsx), against a server
 * behind the package's fetch fake that keeps a small disk for this server and one for a machine.
 *
 * - Given a folder on screen, when New folder is pressed, a name typed and Enter pressed, the
 *   folder is made inside it on the browsed machine — this server, or a machine through that
 *   machine's own server — and it is listed and selected without being opened; Choose then
 *   hands back its path on that machine.
 * - Given a name the folder on screen already lists, the reason reads under the field as it is
 *   typed, and Enter sends nothing.
 * - Given a name the server refuses (taken meanwhile, or a folder it may not write), the reason
 *   reads under the field, the row stays on the name, and nothing new is selected.
 * - Given the row open with a name typed, Escape closes the row and not the finder, nothing is
 *   sent, and the row opens empty the next time.
 * - Given a folder the server may not read, New folder cannot be pressed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { DirEntryInfo, MachinesResponse } from "@prismshadow/penguin-server/api";
import { AuthProvider } from "../src/state/auth";
import { ProjectProvider } from "../src/state/project";
import { MachinesProvider } from "../src/state/machines";
import { SessionsProvider } from "../src/state/sessions";
import { WorkspaceFinder } from "../src/features/chat/workspace-finder";
import { S } from "../src/lib/strings";
import { ADMIN_ME } from "./helpers/admin-settings";
import {
  button,
  click,
  dialogs,
  field,
  mount,
  run,
  type,
  unmountAll,
  waitFor,
} from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FetchRequest } from "./helpers/fetch";
import { SignedIn } from "./helpers/signed-in";

const PROJECT = "proj";
const MACHINE = "M1";

const MACHINES: MachinesResponse = {
  machines: [
    {
      id: "ssh:lab",
      alias: "lab",
      machineId: MACHINE,
      installed: { version: "1.0.0", at: "2026-10-26T00:00:00.000Z" },
      local: false,
      connection: { pid: 1 },
      socket: null,
      api: null,
      root: "~/.penguin",
      status: null,
    },
  ],
  imageVersion: null,
  job: null,
  jobs: [],
} as unknown as MachinesResponse;

/** An event stream that never delivers anything: jsdom has no `EventSource`. */
class SilentEventSource {
  readyState = 0;
  onmessage: unknown = null;
  onopen: unknown = null;
  onerror: unknown = null;
  addEventListener(): void {}
  close(): void {}
}

/** A folder's entries on one machine's disk, by path; a missing path does not exist. */
type Disk = Map<string, DirEntryInfo[]>;

const entry = (dir: string, name: string, kind: "dir" | "file" = "dir"): DirEntryInfo => ({
  name,
  path: `${dir}/${name}`,
  kind,
});

interface World {
  /** Folder creates sent so far, on any server. */
  creates(): FetchRequest[];
  /** The next create is refused with this error instead. */
  refuseNext(status: number, code: string): void;
}

/**
 * This server's home `/home/me` holds `projects/` and `notes.txt`; the machine's `/srv` holds
 * `data/`; `/root` refuses to be read. A create makes the folder on the disk of the server the
 * request reached, or answers 409 `target_exists` when anything is at the path.
 */
function world(): World {
  const disks: Record<"here" | "there", Disk> = {
    here: new Map([
      ["/home/me", [entry("/home/me", "projects"), entry("/home/me", "notes.txt", "file")]],
      ["/home/me/projects", []],
    ]),
    there: new Map([
      ["/srv", [entry("/srv", "data")]],
      ["/srv/data", []],
    ]),
  };
  const home = { here: "/home/me", there: "/srv" };
  let refusal: { status: number; code: string } | null = null;
  const listing = (disk: Disk, path: string) => {
    const entries = disk.get(path);
    if (entries === undefined) return apiError(404, "dir_not_found");
    const parent = path.slice(0, path.lastIndexOf("/")) || "/";
    return json({ path, parent, entries, platform: "linux" });
  };
  const fetch = stubFetch((request) => {
    const { method, path, query, machine } = request;
    if (path === "/api/me") return json(ADMIN_ME);
    if (path === "/api/me/prefs") return json({ prefs: {} });
    if (path === "/api/projects") {
      return json({ projects: [{ projectId: PROJECT, role: "owner", ownerUserId: "admin" }] });
    }
    const project = `/api/projects/${PROJECT}`;
    if (path === `${project}/machines`) return json(MACHINES);
    if (path === `${project}/agents`) return json({ agents: [] });
    if (path === `${project}/dirs`) {
      const at = query.get("path") || home.here;
      if (at === "/root") return apiError(403, "dir_permission_denied");
      return listing(disks.here, at);
    }
    if (path === `${project}/machines/${MACHINE}/dirs`) {
      return listing(disks.there, query.get("path") || home.there);
    }
    if (path === `${project}/workspace-files/create` && method === "POST") {
      if (refusal !== null) {
        const answer = apiError(refusal.status, refusal.code);
        refusal = null;
        return answer;
      }
      const disk = machine === MACHINE ? disks.there : disks.here;
      const dir = query.get("workspace") ?? "";
      const { path: name } = request.body as { path: string; kind: string };
      const entries = disk.get(dir);
      if (entries === undefined) return apiError(400, "workspace_not_found");
      if (entries.some((e) => e.name === name)) return apiError(409, "target_exists");
      disk.set(dir, [...entries, entry(dir, name)]);
      disk.set(`${dir}/${name}`, []);
      return new Response(null, { status: 204 });
    }
    return apiError(404, "not_found");
  });
  return {
    creates: () =>
      fetch.requests.filter(
        (r) => r.method === "POST" && r.path === `/api/projects/${PROJECT}/workspace-files/create`,
      ),
    refuseNext: (status, code) => {
      refusal = { status, code };
    },
  };
}

/** Mounts the finder, open, on `machineId`'s home (or `workspace`, revealed in its parent). */
async function openFinder(opts: { machineId?: string | null; workspace?: string } = {}) {
  const onChoose = vi.fn();
  vi.stubGlobal("EventSource", SilentEventSource);
  await mount(
    h(
      AuthProvider,
      null,
      h(
        SignedIn,
        null,
        h(
          ProjectProvider,
          null,
          h(
            MachinesProvider,
            null,
            h(
              SessionsProvider,
              null,
              h(WorkspaceFinder, {
                open: true,
                onClose: () => {},
                onChoose,
                projectId: PROJECT,
                workspace: opts.workspace ?? "",
                machineId: opts.machineId ?? null,
                title: "Choose a folder",
                clearLabel: "No folder",
              }),
            ),
          ),
        ),
      ),
    ),
  );
  // The address bar names a folder once the first listing (or its refusal) has landed.
  await waitFor(() => document.querySelector('[aria-current="page"]') !== null);
  return { onChoose };
}

/** The names the list shows, in order. */
const rows = (): string[] =>
  [...document.querySelectorAll('[role="option"]')].map((r) => r.getAttribute("aria-label") ?? "");

/** The selected row's name, or null. */
const selectedRow = (): string | null =>
  document.querySelector('[role="option"][aria-selected="true"]')?.getAttribute("aria-label") ??
  null;

/** What the new-folder row says under its field, or null when it says nothing. */
const note = (): string | null => {
  const id = nameField().getAttribute("aria-describedby");
  return id === null ? null : (document.getElementById(id)?.textContent ?? null);
};

const nameField = () => field(S.files.newFolderName) as HTMLInputElement;
const hasNameField = () =>
  document.querySelector(`input[aria-label="${S.files.newFolderName}"]`) !== null;

const press = (target: Element, key: string) =>
  run(() =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
  );

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
});

describe("new folder in the Workspace finder", () => {
  it.each([
    { where: "this server", machineId: null, home: "/home/me", made: "/home/me/drafts" },
    { where: "a machine", machineId: MACHINE, home: "/srv", made: "/srv/drafts" },
  ])(
    "on $where, a named folder is made where the finder stands, selected without opening, and Choose takes it",
    async ({ machineId, home, made }) => {
      const server = world();
      const { onChoose } = await openFinder({ machineId });

      await click(button(S.files.newFolder));
      await type(nameField(), " drafts ");
      await press(nameField(), "Enter");
      await waitFor(() => selectedRow() === "drafts");

      expect(server.creates().map((r) => [r.machine, r.query.get("workspace"), r.body])).toEqual([
        [machineId, home, { path: "drafts", kind: "dir" }],
      ]);
      expect(hasNameField()).toBe(false);
      expect(rows()).toContain("drafts");
      // Still in the folder it was made in: the address bar's current segment is that folder.
      expect(document.querySelector('[aria-current="page"]')?.textContent).toBe(
        home.split("/").pop(),
      );

      await click(button(S.chat.finder.choose));
      expect(onChoose).toHaveBeenCalledWith(made, machineId);
    },
  );

  it("a name the folder already lists is refused as it is typed, and Enter sends nothing", async () => {
    const server = world();
    await openFinder();

    await click(button(S.files.newFolder));
    await type(nameField(), "notes.txt");
    expect(note()).toBe(S.chat.finder.newFolderExists("notes.txt"));

    await press(nameField(), "Enter");
    expect(server.creates()).toEqual([]);
    expect(nameField().value).toBe("notes.txt");
  });

  it.each([
    {
      why: "a name taken meanwhile",
      status: 409,
      code: "target_exists",
      reason: () => S.chat.finder.newFolderExists("drafts"),
    },
    {
      why: "a folder the server may not write",
      status: 403,
      code: "dir_write_denied",
      reason: () => S.errors.byCode.dir_write_denied,
    },
  ])(
    "$why is refused with the reason under the field, and the row stays on the name",
    async ({ status, code, reason }) => {
      const server = world();
      await openFinder();
      server.refuseNext(status, code);

      await click(button(S.files.newFolder));
      await type(nameField(), "drafts");
      await press(nameField(), "Enter");
      await waitFor(() => note() !== null);

      expect(note()).toBe(reason());
      expect(nameField().value).toBe("drafts");
      expect(selectedRow()).toBeNull();
      expect(rows()).not.toContain("drafts");
    },
  );

  it("Escape closes the row and not the finder, sends nothing, and the row opens empty again", async () => {
    const server = world();
    await openFinder();

    await click(button(S.files.newFolder));
    await type(nameField(), "drafts");
    await press(nameField(), "Escape");

    expect(hasNameField()).toBe(false);
    expect(dialogs()).toHaveLength(1);
    expect(server.creates()).toEqual([]);

    await click(button(S.files.newFolder));
    expect(nameField().value).toBe("");
  });

  it("a folder the server may not read offers no New folder", async () => {
    world();
    await openFinder({ workspace: "/root/inner" });
    await waitFor(() => document.body.textContent?.includes(S.chat.finder.deniedTitle) === true);

    expect(button(S.files.newFolder).disabled).toBe(true);
  });
});
