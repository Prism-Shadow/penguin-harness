/**
 * Machines routes, under a Project (admin only). Relative to `/api/projects/:projectId/machines`:
 *
 * GET  /                        — this machine and the ssh config's host aliases, the version
 *                                 this server would install, the last status probed for each,
 *                                 and the running or last job.
 * POST /probe                   — refresh the statuses of this Project's machines (one ssh
 *                                 round trip each), then answer the list.
 * POST /:machineId/install      — start an install and give the machine to this Project; 202,
 *                                 or 409 when one runs.
 * POST /:machineId/release      — drop it from this Project. The install stays.
 * POST /:machineId/connect      — bring that machine's server up and hold a tunnel to it; 202,
 *                                 or 409 when a connect already runs.
 * POST /:machineId/reconnect    — a person's Retry while the server brings a kept machine back:
 *                                 the next attempt now, or a new streak after it stopped; 200
 *                                 with the list, or 409 (`job_running`, `password_refused`,
 *                                 `not_kept_connected`).
 * POST /:machineId/stop-reconnecting — a person's Stop retrying: the streak stops now
 *                                 (`gaveUp: "cancelled"`); 200 with the list.
 * POST /:machineId/disconnect   — drop the tunnel (the remote server stays up).
 * POST /add                     — put machines in this Project's list, installing nothing.
 * GET  /ssh-hosts               — every host in the ssh config, with its block's user, host, port.
 * POST /ssh-hosts               — append a host block to this server's ~/.ssh/config, and store
 *                                 the password it signs in with when one is given; 201.
 * GET  /ssh-hosts/:alias        — that block read back, whether this app wrote it, and whether a
 *                                 password is stored for it (never the password).
 * PUT  /ssh-hosts/:alias        — rewrite a block this app wrote, and set or delete its password;
 *                                 404 none, 409 hand-written (its password alone may be set).
 * POST /:machineId/restart      — stop that machine's server and start it again; 202, or 409.
 * POST /:machineId/stop         — stop that machine's server and stop keeping it connected;
 *                                 202, or 409.
 * POST /:machineId/uninstall    — stop it and remove the program, and with `removeData` its
 *                                 data root; 202, or 409.
 * POST /:machineId/sync         — hand that connected machine the Project config now; 202, or
 *                                 409 (`not_connected`, `job_running`, …).
 * POST /:machineId/diagnose     — check what would stop an install or a connect there, writing
 *                                 nothing on it; 200, or 409 while a job works on it.
 * GET  /:machineId/dirs?path=   — browse that machine's directories over ssh.
 *
 * Under a Project because the page is, and because this Project's config, its Model
 * credentials included, goes to this Project's machines and no others (machines/models-sync.ts). The machine itself is not
 * project-scoped: connect, disconnect and dirs act on one host, shared by every Project using
 * it; what a Project owns is the membership.
 *
 * Admin rather than any logged-in user: installing spawns ssh with the SERVER ACCOUNT's keys
 * and writes a program directory on another machine — an owner's capability, not a visitor's.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  DirListResponse,
  MachineDiagnosis,
  MachineUninstallRequest,
  MachinesResponse,
  MachinesUseResponse,
  SshHostResponse,
  SshHostsResponse,
} from "../../api/types.js";
import { HttpError } from "../errors.js";
import { requireValidId } from "../validate.js";
import { answerOf } from "../../socket/stream-answer.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { MachinesService } from "../../machines/service.js";
import type { MachineEventHub } from "../../machines/event-hub.js";
import { machineEventsStream } from "../../machines/aggregate-stream.js";
import type { WatchedMachine } from "../../machines/aggregate-stream.js";
import type { Access } from "../../mechanisms/projects.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface MachinesRouteDeps {
  machines: MachinesService;
  access: Access;
  /** The generation's event hub, which holds one `/api/events` subscription per machine (machines/event-hub.ts). */
  events: MachineEventHub;
}

export function machinesRoutes(deps: MachinesRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Admin AND a member of the Project: the Project scope says WHICH machines are answered,
  // never who may reach them. Installing still spawns ssh with the server account's keys, so
  // a Project owner who is not an admin does not get that capability by owning a Project.
  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can install on a machine.");
    }
    deps.access.requireProjectAccess(c.var.user.userId, requireValidId(c, "projectId"));
    await next();
  });

  const state = (c: Context<AppEnv>): MachinesResponse => {
    const checkoutImage = deps.machines.checkoutImage();
    return {
      machines: deps.machines.list(requireValidId(c, "projectId")),
      imageVersion: deps.machines.imageVersion(),
      ...(checkoutImage === null ? {} : { checkoutImage }),
      job: deps.machines.job(),
      jobs: deps.machines.jobs(),
    };
  };

  /**
   * Every connected machine's own events, on ONE stream per tab — the aggregation the hub's
   * one-subscription-per-machine makes possible (machines/event-hub.ts, and docs § "One event
   * stream per machine"). Each event carries the machine it came from; `last-event-id` is
   * answered from the aggregate's own bounded buffer. The stream opens at once and the machines
   * attach as their targets resolve, so a slow machine cannot hold the tab's stream up; the
   * machines are read again on each of the stream's beats, so one connected after the tab opened
   * joins the stream the tab already holds (machines/aggregate-stream.ts).
   */
  app.get("/events", (c) => {
    const projectId = requireValidId(c, "projectId");
    // The machines this Project holds a connection to: the tab watches these, and a machine it
    // does not hold has no socket for the hub to subscribe over (its row says so already).
    const watched = (): WatchedMachine[] =>
      deps.machines.list(projectId).flatMap((machine) => {
        const machineId = machine.machineId;
        if (machine.local || machineId === null || machine.connection === null) return [];
        // Also what the hub re-reads when it dials this machine again after a failed dial.
        return [
          { machineId, target: () => deps.machines.proxyTarget(machineId).catch(() => null) },
        ];
      });
    return machineEventsStream(
      deps.events,
      watched,
      c.req.header("Last-Event-ID") ?? null,
      (line) => console.log(line),
      // The socket transport's answer, when the socket carried this call
      // (socket/stream-answer.ts): the events answer it directly.
      { answer: answerOf(c.req.raw) },
    );
  });

  /**
   * Bring machines into use — the one verb a person needs. Each is queued for the whole
   * pipeline (install if needed, hand over, connect, sync); what could be refused without
   * any ssh is answered by id in `refused`, and the rest report through `jobs`. 202 always:
   * the queue is the answer, even when some rows were refused.
   */
  app.post("/use", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const machines = Array.isArray(body.machines)
      ? body.machines.filter((m): m is string => typeof m === "string")
      : [];
    if (machines.length === 0) {
      throw new HttpError(400, "bad_request", "Name at least one machine to use.");
    }
    const { refused } = deps.machines.startUse(
      requireValidId(c, "projectId"),
      machines,
      body.replaceProgram === true,
    );
    return c.json({ ...state(c), refused } satisfies MachinesUseResponse, 202);
  });

  /**
   * Add a host to this server's ssh config. 201 with the list, which now names it; 400 with
   * the offending field when the entry would not survive as one line each; 409 when the
   * alias is already declared — ssh would take the earlier block and ignore this one.
   */
  /** A host entry as a request body carries it; the port may arrive as a string from a form. */
  const hostBody = (body: Record<string, unknown>) => {
    const str = (key: string) =>
      typeof body[key] === "string" ? (body[key] as string) : undefined;
    const portRaw = body.port;
    const port =
      typeof portRaw === "number"
        ? portRaw
        : typeof portRaw === "string" && portRaw.trim() !== ""
          ? Number(portRaw)
          : undefined;
    return {
      alias: str("alias") ?? "",
      hostName: str("hostName") ?? "",
      user: str("user"),
      port,
      identityFile: str("identityFile"),
    };
  };
  /** The password a body sets: a string stores it, null deletes it, anything else leaves it. */
  const passwordBody = (body: Record<string, unknown>): string | null | undefined =>
    typeof body.password === "string" ? body.password : body.password === null ? null : undefined;
  const invalid = (problem: { field: string; why: string }) =>
    new HttpError(
      400,
      "ssh_host_invalid",
      `${problem.field}: ${problem.why === "required" ? "required" : "must be one word, with no space or #"}`,
    );
  /** The refusals a host write and its password share. */
  const hostRefused = (
    refused:
      | { why: "invalid"; problem: { field: string; why: string } }
      | { why: "password-invalid"; problem: "required" | "invalid" }
      | { why: "password-unsupported"; detail: string; ssh: string },
  ): HttpError => {
    if (refused.why === "password-invalid") {
      return new HttpError(
        400,
        "ssh_password_invalid",
        refused.problem === "required"
          ? "password: required"
          : "password: must be one line of at most 1024 characters",
      );
    }
    if (refused.why === "password-unsupported") {
      return new HttpError(409, "ssh_password_unsupported", refused.detail, undefined, {
        ssh: refused.ssh,
      });
    }
    return invalid(refused.problem);
  };

  /** Every host in the ssh config, with what its own block says: the add dialog's rows. */
  app.get("/ssh-hosts", (c) =>
    c.json({ hosts: deps.machines.sshHosts() } satisfies SshHostsResponse),
  );

  /**
   * Add machines to this Project's list without installing anything: each gets a card whose one
   * thing to do is enabling it. Refusals by id, as `/use` answers them.
   */
  app.post("/add", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const machines = Array.isArray(body.machines)
      ? body.machines.filter((m): m is string => typeof m === "string")
      : [];
    if (machines.length === 0) {
      throw new HttpError(400, "bad_request", "Name at least one machine to add.");
    }
    const { refused } = deps.machines.addToProject(requireValidId(c, "projectId"), machines);
    return c.json({ ...state(c), refused } satisfies MachinesUseResponse);
  });

  app.post("/ssh-hosts", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const password = passwordBody(body);
    const added = await deps.machines.addSshHost(
      hostBody(body),
      typeof password === "string" ? password : undefined,
    );
    if (!added.ok) {
      if (added.why === "exists") {
        throw new HttpError(409, "ssh_host_exists", "That alias is already in the ssh config.");
      }
      throw hostRefused(added);
    }
    return c.json(state(c), 201);
  });

  /** A host's block read back — for the form that configures it — and whether it may be rewritten. */
  app.get("/ssh-hosts/:alias", (c) => {
    const found = deps.machines.sshHost(c.req.param("alias"));
    if (found === null) {
      throw new HttpError(
        404,
        "ssh_host_not_found",
        "No Host block for that alias in ~/.ssh/config itself; it may live in an included file.",
      );
    }
    return c.json({
      ...found.entry,
      editable: found.editable,
      ...(found.passwordSaved ? { passwordSaved: true as const } : {}),
    } satisfies SshHostResponse);
  });

  /**
   * Rewrite a block this app wrote, and set or delete its password. 404 when there is none; 409
   * when it was written by hand and the body would change it (its password alone may be set).
   */
  app.put("/ssh-hosts/:alias", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const { alias: _ignored, ...entry } = hostBody(body);
    const updated = await deps.machines.updateSshHost(
      c.req.param("alias"),
      entry,
      passwordBody(body),
    );
    if (!updated.ok) {
      if (updated.why === "not-found") {
        throw new HttpError(
          404,
          "ssh_host_not_found",
          "No Host block for that alias in ~/.ssh/config.",
        );
      }
      if (updated.why === "foreign") {
        throw new HttpError(
          409,
          "ssh_host_foreign",
          "That block was written by hand; edit it in ~/.ssh/config.",
        );
      }
      throw hostRefused(updated);
    }
    return c.json(state(c));
  });

  /** Stop using machines: connections dropped, membership released; the install over there stays. */
  app.post("/stop-using", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const machines = Array.isArray(body.machines)
      ? body.machines.filter((m): m is string => typeof m === "string")
      : [];
    if (machines.length === 0) {
      throw new HttpError(400, "bad_request", "Name at least one machine to stop using.");
    }
    deps.machines.stopUsing(requireValidId(c, "projectId"), machines);
    return c.json(state(c));
  });

  app.get("/", (c) => c.json(state(c)));

  // Probing is a POST because it spends ssh round trips — a GET that spawns processes is a
  // GET a proxy or a prefetch may fire on its own. The page drives the schedule, so nothing
  // here runs when nobody is looking at the page.
  app.post("/probe", async (c) => {
    await deps.machines.probeInstalled(requireValidId(c, "projectId"));
    return c.json(state(c));
  });

  app.post("/:machineId/install", async (c) => {
    // `replaceProgram`: the answer to a job that came back asking for it (see the job's
    // canReplaceProgram). Read leniently — an absent body is the ordinary install.
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const started = await deps.machines.startInstall(
      requireValidId(c, "projectId"),
      c.req.param("machineId"),
      body.replaceProgram === true,
    );
    if (!started.ok) {
      // Each refusal is its own code: the page renders a sentence per case, and "no image"
      // in particular is a property of THIS server rather than of the machine picked.
      if (started.why === "busy") {
        throw new HttpError(409, "install_running", "A job is already running on that machine.");
      }
      if (started.why === "self") {
        throw new HttpError(
          409,
          "self_install",
          "That is the machine this server runs on. It cannot push this build over the program directory it is running from.",
        );
      }
      if (started.why === "unknown-machine") {
        throw new HttpError(404, "unknown_machine", "No such host in this server's ssh config.");
      }
      throw new HttpError(
        409,
        "no_install_image",
        "This server has no install image to push. A packaged or installed server carries one, and a source checkout builds one for each install; this server is neither.",
      );
    }
    return c.json(state(c), 202);
  });

  app.post("/:machineId/connect", async (c) => {
    const started = await deps.machines.startConnect(c.req.param("machineId"));
    if (!started.ok) {
      if (started.why === "busy") {
        throw new HttpError(409, "connect_running", "A job is already running on that machine.");
      }
      if (started.why === "unknown-machine") {
        throw new HttpError(404, "unknown_machine", "No such host in this server's ssh config.");
      }
      if (started.why === "self") {
        throw new HttpError(
          409,
          "self_connect",
          "That is the machine this server runs on — you are already on it.",
        );
      }
      if (started.why === "not-installed") {
        throw new HttpError(
          409,
          "not_installed",
          "Nothing is installed on that machine yet. Install it first.",
        );
      }
      if (started.why === "unsupported") {
        throw new HttpError(
          409,
          "connect_unsupported",
          "A Windows machine cannot be connected yet: its sshd hands commands to cmd.exe, and there is no shell to hold a session on.",
        );
      }
      throw new HttpError(409, "connect_refused", "That machine cannot be connected to.");
    }
    return c.json(state(c), 202);
  });

  // A person's Retry while the server brings a machine back: the next attempt now, or after the
  // streak stopped a new one from the first attempt. Not a job — the list says how it goes.
  app.post("/:machineId/reconnect", (c) => {
    const answer = deps.machines.retryReconnect(c.req.param("machineId"));
    if (!answer.ok) {
      if (answer.why === "unknown-machine") {
        throw new HttpError(404, "unknown_machine", "No such host in this server's ssh config.");
      }
      if (answer.why === "busy") {
        throw new HttpError(
          409,
          "job_running",
          "A job is working on that machine; wait for it to finish.",
        );
      }
      if (answer.why === "password") {
        throw new HttpError(
          409,
          "password_refused",
          "That machine refused the password saved for it. Save its password again in its SSH settings; that tries again.",
        );
      }
      throw new HttpError(
        409,
        "not_kept_connected",
        "This server does not keep that machine connected, so there is nothing to bring back. Start it instead.",
      );
    }
    return c.json(state(c));
  });

  // A person's Stop retrying: the streak stops where it stands and waits for a Retry, and the
  // attempt under way is cut, so every verb can start on the machine at once. Nothing to stop
  // (the machine is up, or the streak already stopped) is not an error: a press that crossed the
  // attempt that ended it answers the list as it now stands.
  app.post("/:machineId/stop-reconnecting", (c) => {
    const answer = deps.machines.stopReconnecting(c.req.param("machineId"));
    if (!answer.ok) {
      throw new HttpError(404, "unknown_machine", "No such host in this server's ssh config.");
    }
    return c.json(state(c));
  });

  // Addressed by the machine's OWN id, like the proxy: this answers "what is on THAT
  // machine", and the ssh alias it happens to be reached through is not that machine's name.
  app.get("/:machineId/dirs", async (c) => {
    const listing = await deps.machines.listDirs(
      c.req.param("machineId"),
      c.req.query("path") ?? "",
    );
    if (listing === "denied") {
      throw new HttpError(
        403,
        "dir_permission_denied",
        "That machine does not allow reading this directory.",
      );
    }
    if (listing === null) {
      throw new HttpError(
        404,
        "dir_not_found",
        "That machine could not be reached, or that directory does not exist on it.",
      );
    }
    return c.json(listing satisfies DirListResponse);
  });

  /**
   * Drops a machine from this Project. Deliberately leaves the install alone: another Project
   * may be using it, and "stop listing this here" is not "go wipe that machine".
   */
  app.post("/:machineId/release", (c) => {
    deps.machines.release(requireValidId(c, "projectId"), c.req.param("machineId"));
    return c.json(state(c));
  });

  /**
   * Restarts that machine's server: stop, then start on the same port. What makes it worth a
   * control of its own is that a machine's FILES can be brought forward while it runs — a
   * replicated store, an install that matched — and only a restart makes the process match
   * them. 202, or 409 when a job already runs.
   */
  app.post("/:machineId/restart", async (c) => {
    const started = await deps.machines.startRestart(c.req.param("machineId"));
    if (!started.ok) {
      if (started.why === "busy")
        throw new HttpError(409, "job_running", "A job is already running on that machine.");
      if (started.why === "unknown-machine") {
        throw new HttpError(404, "unknown_machine", "No such host in this server's ssh config.");
      }
      if (started.why === "self") {
        throw new HttpError(409, "self_restart", "That is the machine this server runs on.");
      }
      throw new HttpError(409, "not_installed", "Nothing is installed on that machine yet.");
    }
    return c.json(state(c), 202);
  });

  /**
   * The answer to a stop or an uninstall that could not start: each refusal its own code, since
   * the page says each in a sentence of its own.
   */
  const refuseOnInstalled = (
    why: "busy" | "unknown-machine" | "not-installed" | "self" | "unsupported" | "not-connected",
  ): HttpError => {
    if (why === "busy") return new HttpError(409, "job_running", "A job is already running there.");
    if (why === "unknown-machine") {
      return new HttpError(404, "unknown_machine", "No such host in this server's ssh config.");
    }
    if (why === "self")
      return new HttpError(409, "self_machine", "That is the machine this server runs on.");
    if (why === "not-connected") {
      return new HttpError(409, "not_connected", "That machine is not connected.");
    }
    if (why === "unsupported") {
      return new HttpError(
        409,
        "connect_unsupported",
        "A Windows machine's server is not started or stopped from here, and its program is not removed from here.",
      );
    }
    return new HttpError(409, "not_installed", "Nothing is installed on that machine.");
  };

  /**
   * Stops that machine's server and stops keeping it connected: it stays stopped, across this
   * server's restarts too, until it is started again (`…/connect`). The install stays. A job,
   * 202; a machine it cannot reach fails at its first step with nothing changed.
   */
  app.post("/:machineId/stop", (c) => {
    const started = deps.machines.startStop(c.req.param("machineId"));
    if (!started.ok) throw refuseOnInstalled(started.why);
    return c.json(state(c), 202);
  });

  /**
   * Removes the program from that machine, its server stopped first; `removeData` takes its data
   * root too. The machine stays in the list as not installed. A job, 202.
   */
  app.post("/:machineId/uninstall", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as MachineUninstallRequest;
    const started = deps.machines.startUninstall(
      c.req.param("machineId"),
      body.removeData === true,
    );
    if (!started.ok) throw refuseOnInstalled(started.why);
    return c.json(state(c), 202);
  });

  /**
   * Hands that machine the config of every Project using it now — models, command policy,
   * new-chat defaults, plugin list — as a job, 202. Only a connected machine: one on another
   * build than this server's is refused at the job's first step, pointing at Update.
   */
  app.post("/:machineId/sync", (c) => {
    const started = deps.machines.startSyncConfig(c.req.param("machineId"));
    if (!started.ok) throw refuseOnInstalled(started.why);
    return c.json(state(c), 202);
  });

  /**
   * The connection check: ssh, platform, the installer's tools, the release download, disk and
   * port, asked of the machine without writing anything there (machines/diagnose.ts). A POST
   * because it spends ssh round trips and a few seconds of the machine's network.
   */
  app.post("/:machineId/diagnose", async (c) => {
    const result = await deps.machines.diagnose(c.req.param("machineId"));
    if (result === "unknown-machine") {
      throw new HttpError(404, "unknown_machine", "No such host in this server's ssh config.");
    }
    if (result === "self") {
      throw new HttpError(409, "self_diagnose", "That is the machine this server runs on.");
    }
    if (result === "busy") {
      throw new HttpError(409, "job_running", "A job is working on that machine; check it after.");
    }
    return c.json(result satisfies MachineDiagnosis);
  });

  app.post("/:machineId/disconnect", (c) => {
    deps.machines.disconnect(c.req.param("machineId"));
    return c.json(state(c));
  });

  return app;
}
