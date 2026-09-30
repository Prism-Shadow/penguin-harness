/**
 * Server directory browsing:
 * GET /api/projects/:p/dirs?path=<absolute>.
 *
 * Lets the user interactively pick a Workspace directory (the Workspace picker). Defaults to
 * the home directory of the account running the service, and can be browsed all the way up
 * to the root `/` — reachability is governed by OS file permissions; the server does not
 * restrict browsing to within the Project directory tree (same convention as
 * workspace-guard). Lists folders and files alike, each with its kind and modification time:
 * the picker shows files dimmed so a folder reads as what it holds, and only folders can be
 * picked.
 *
 * A folder the service account may not read is an error with its own code
 * (`dir_permission_denied`), never an empty listing: on macOS an unanswered privacy prompt
 * (Desktop, Documents, Downloads) looks exactly like that, and an empty list sent people
 * looking for files that were there all along.
 *
 * POST /api/projects/:p/dirs/access is the picker's way out of that refusal in the desktop
 * app: see the route.
 *
 * `projectId` remains the authorization anchor: the caller must have access to that Project.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { DirAccessResponse, DirEntryInfo, DirListResponse } from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { HttpError } from "../errors.js";
import { requireValidId } from "../validate.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import { directorySkillsRoutes } from "./directory-skills.js";
import type { Desktop, DesktopApi } from "../../hmr/capabilities.js";
import type { Access } from "../../mechanisms/projects.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface DirsRouteDeps {
  access: Access;
  /** The desktop shell's service; null when this server was not started by the desktop shell. */
  desktop: Pick<DesktopApi, "requestFolderAccess"> | null;
}

export function dirsRoutes(deps: DirsRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);

    // Default starting point: home directory; an explicit path must be absolute (the frontend always sends back the realpath result).
    const raw = c.req.query("path");
    const requested = raw?.trim() ?? "";
    const home = requested === "";
    const real = await resolveBrowsableDir(home ? os.homedir() : requested);

    let dirents: import("node:fs").Dirent[];
    try {
      dirents = await fs.readdir(real, { withFileTypes: true });
    } catch (err) {
      throw dirReadError(err, real);
    }
    const entries = (await describeEntries(real, dirents)).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const parent = path.dirname(real);
    return c.json({
      path: real,
      parent: parent === real ? null : parent,
      entries,
      platform: process.platform,
      // Drive roots only answer the home request: that is the one the picker makes to build
      // its sidebar, and probing 26 letters on every folder change would be waste.
      ...(home && process.platform === "win32" ? { roots: await driveRoots() } : {}),
    } satisfies DirListResponse);
  });

  /**
   * The picker's "Allow access" for a folder macOS refused: the desktop shell's main process
   * reads it once in the app's own name, which is what makes macOS ask the user — a read from
   * this server, the shell's child, has been seen to fail silently instead. Once the app is
   * allowed, this server reads the folder too. Only this server's own shell can be asked, so
   * the route has no machine form, and only the desktop app's own window may call it (403
   * `desktop_shell_only`, like the reveal route): a browser tab on the same server has no shell
   * of its own to ask on the user's behalf. Without a shell there is nothing to ask (503
   * `shell_unreachable`); a shell that has not answered within FOLDER_ACCESS_TIMEOUT_MS is a
   * 504 `timeout`. The member is optional: a layer older than the picker's box has none.
   */
  app.post("/access", async (c) => {
    const projectId = requireValidId(c, "projectId");
    deps.access.requireProjectAccess(c.var.user.userId, projectId);
    if (c.var.sessionVia !== "desktop") {
      throw new HttpError(
        403,
        "desktop_shell_only",
        "Asking macOS for a folder is available from the desktop app's own window.",
      );
    }
    const body = (await c.req.json().catch(() => null)) as { path?: unknown } | null;
    const target = typeof body?.path === "string" ? body.path.trim() : "";
    if (!path.isAbsolute(target)) {
      throw new HttpError(400, "dir_not_absolute", "Directory must be an absolute path.");
    }
    const asked = deps.desktop?.requestFolderAccess?.(target) ?? null;
    if (asked === null) {
      throw new HttpError(503, "shell_unreachable", "The desktop shell is not listening.");
    }
    const result = await asked;
    if (result === null) {
      throw new HttpError(504, "timeout", "The desktop shell did not answer in time.");
    }
    return c.json({
      granted: result.granted,
      packaged: result.packaged,
    } satisfies DirAccessResponse);
  });

  return app;
}

/**
 * The HTTP answer for a filesystem call that failed on `dir`. A refusal (EACCES, or EPERM —
 * what macOS privacy protection returns for a folder the user has not allowed) gets its own
 * code so the picker can say so and name where to allow it; a missing path stays the 404 it
 * always was.
 */
export function dirReadError(err: unknown, dir: string): HttpError {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === "EACCES" || code === "EPERM") {
    return new HttpError(
      403,
      "dir_permission_denied",
      `The server is not allowed to read this directory: ${dir}.`,
    );
  }
  if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") {
    return new HttpError(404, "dir_not_found", `Directory does not exist: ${dir}.`);
  }
  return new HttpError(500, "dir_read_failed", `Could not read this directory: ${dir}.`);
}

/**
 * `requireProjectDir` with the refusal told apart from absence. That helper folds every
 * failure into "does not exist or is inaccessible", which is the right answer where a path is
 * being validated; here it is the question being asked.
 */
async function resolveBrowsableDir(target: string): Promise<string> {
  if (!path.isAbsolute(target)) {
    throw new HttpError(400, "dir_not_absolute", "Directory must be an absolute path.");
  }
  let real: string;
  let isDir: boolean;
  try {
    real = await fs.realpath(target);
    isDir = (await fs.stat(real)).isDirectory();
  } catch (err) {
    throw dirReadError(err, target);
  }
  if (!isDir) throw new HttpError(400, "not_a_dir", "Not a directory.");
  return real;
}

/**
 * Past this many entries only the dirent is read: a stat per entry is what gives a symlink
 * its target's kind and every row its time, and a folder of tens of thousands of files would
 * otherwise hold the listing for seconds. Beyond it, a symlink to a folder reads as a file.
 */
const STAT_LIMIT = 5000;

/**
 * Kind and modification time for each entry. stat follows symlinks, so a link to a folder is
 * browsable like one; an entry stat cannot reach (a dangling link, a refused one) keeps the
 * dirent's kind and no time rather than failing the whole folder.
 */
async function describeEntries(
  dir: string,
  dirents: import("node:fs").Dirent[],
): Promise<DirEntryInfo[]> {
  return Promise.all(
    dirents.map(async (d, index): Promise<DirEntryInfo> => {
      const full = path.join(dir, d.name);
      let isDir = d.isDirectory();
      let mtime: number | undefined;
      if (index < STAT_LIMIT) {
        try {
          const st = await fs.stat(full);
          isDir = st.isDirectory();
          mtime = Math.round(st.mtimeMs);
        } catch {
          // Keep the dirent's answer.
        }
      }
      return {
        name: d.name,
        path: full,
        kind: isDir ? "dir" : "file",
        ...(mtime !== undefined ? { mtime } : {}),
      };
    }),
  );
}

/** The drive roots that exist on a Windows host (`C:\`, …), for the picker's sidebar. */
async function driveRoots(): Promise<string[]> {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const found = await Promise.all(
    letters.map((letter) =>
      fs.access(`${letter}:\\`).then(
        () => `${letter}:\\`,
        () => null,
      ),
    ),
  );
  return found.filter((root): root is string => root !== null);
}

/** The Project-scoped directory routes; the repos and the access check are components of their own. */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "projects.dirs",
        prefix: "/api/projects/:projectId/dirs",
        auth: "user",
        order: 150,
      },
      {
        id: "projects.dir-skills",
        prefix: "/api/projects/:projectId/dir-skills",
        auth: "user",
        order: 160,
      },
    ],
  },
})
export class ProjectsRoutes {
  @Use() private readonly access!: Access;
  @Use() private readonly desktop!: Desktop;
  @Bind("projects.dirs") dirsRoutes!: Hono<AppEnv>;
  @Bind("projects.dir-skills") dirSkillsRoutes!: Hono<AppEnv>;
  setup() {
    this.dirsRoutes = dirsRoutes({ access: this.access, desktop: this.desktop.current() });
    this.dirSkillsRoutes = directorySkillsRoutes({ access: this.access });
  }
}
