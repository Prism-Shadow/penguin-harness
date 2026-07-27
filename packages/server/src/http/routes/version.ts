/**
 * Version routes: the running release identity, the update-check reminder, and the
 * admin-only self-update.
 *
 *   GET  /api/version               -> {version, buildDate} from core's VERSION / BUILD_DATE
 *   GET  /api/version/update-check  -> UpdateCheckService (fail-soft, cached, opt-out env;
 *                                      ?force=1 bypasses the cache for the manual check)
 *   POST /api/version/update        -> admin only: re-runs the CLI as `penguin update --yes`
 *
 * How the self-update works: `penguin server|web` exports PENGUIN_CLI_ENTRY (its own entry
 * script path) before importing this server, and this route re-runs that script as
 * `node <entry> update --yes` — the CLI's update command owns all install-kind detection,
 * download and replacement logic (packages/cli/src/commands/update.ts). A server started
 * any other way (tests, a custom embedding) has no CLI to run and reports "unsupported".
 * SECURITY: the spawned argv is a fixed literal list; nothing from the request flows into
 * the command, its arguments, or its environment.
 *
 * Interpreting the CLI's outcome: `penguin update` exits non-zero only when an upgrade was
 * attempted and failed; refusals (source checkout, unrecognized layout, Windows) print a
 * message and exit 0. Exit codes alone therefore cannot separate "updated" from
 * "unsupported", so the spawn forces PENGUIN_LANG=en and classifies by the refusal
 * messages' stable English fragments (packages/cli/src/i18n.ts, `update` section). That
 * matching is reliable here because the spawned CLI and this server ship in lockstep from
 * the same install — the strings can never be from a different release than this code.
 */
import { spawn } from "node:child_process";
import { BUILD_DATE, VERSION } from "@prismshadow/penguin-core";
import { Hono } from "hono";
import type { UpdateRunResponse, VersionResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";

/** Only the tail of the update output is kept (installer logs can be long). */
const OUTPUT_CAP = 64 * 1024;
/** The whole update (download + install) must finish within this window. */
const UPDATE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * English fragments of the CLI refusal messages (packages/cli/src/i18n.ts `update.*`),
 * one per refusal reason. `needsYes` / `cancelled` are omitted: `--yes` makes the
 * confirmation gate proceed unconditionally, so neither can occur here.
 */
const REFUSAL_MARKERS = [
  "runs from a source checkout", // sourceCheckout
  "Cannot tell how this penguin was installed", // unknownInstall
  "could not be identified", // npmUnknownManager
  "does not run on Windows", // windowsUnsupported
  "cannot run your package manager for you", // windowsGlobalInstall
];

/**
 * Maps the finished CLI run to an UpdateRunResponse. Exported for unit tests (tests never
 * spawn anything real). Exit 0 with a refusal message is "unsupported"; any other exit 0
 * is "updated" — including the CLI's "already on the latest version", because that means
 * the *install* is current and only a restart of this (older, in-memory) process is
 * missing, which is exactly what needsRestart says.
 */
export function classifyUpdateRun(exitCode: number, output: string): UpdateRunResponse {
  if (exitCode !== 0) return { status: "failed", output, needsRestart: false };
  if (REFUSAL_MARKERS.some((marker) => output.includes(marker))) {
    return { status: "unsupported", output, needsRestart: false };
  }
  return { status: "updated", output, needsRestart: true };
}

/** Runs `node <cliEntry> update --yes` to completion and classifies the outcome. */
function runSelfUpdate(cliEntry: string): Promise<UpdateRunResponse> {
  return new Promise((resolve) => {
    // PENGUIN_LANG=en pins the CLI's output language so classifyUpdateRun's markers match
    // regardless of the deployment's configured CLI language.
    const child = spawn(process.execPath, [cliEntry, "update", "--yes"], {
      env: { ...process.env, PENGUIN_LANG: "en" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-OUTPUT_CAP);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // A SIGTERM-ignoring child would otherwise leave this request hanging forever.
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, UPDATE_TIMEOUT_MS);
    timer.unref();

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        status: "failed",
        output: `${output}\n[failed to run the update command: ${err.message}]`.trim(),
        needsRestart: false,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({
          status: "failed",
          output:
            `${output}\n[the update run was killed after ${UPDATE_TIMEOUT_MS / 60_000} minutes]`.trim(),
          needsRestart: false,
        });
        return;
      }
      resolve(classifyUpdateRun(code ?? -1, output.trim()));
    });
  });
}

export function versionRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Two admins clicking "update" at once must not race two installers over the same
  // install dir: concurrent requests share the one in-flight run (and its result).
  let inflightRun: Promise<UpdateRunResponse> | null = null;

  app.get("/", (c) => {
    return c.json({ version: VERSION, buildDate: BUILD_DATE } satisfies VersionResponse);
  });

  app.get("/update-check", async (c) => {
    // ?force=1 (the web's manual "check for updates" action) bypasses the TTL cache;
    // see UpdateCheckService.check for why a user-initiated press-through is acceptable.
    return c.json(await deps.updateCheck.check(c.req.query("force") === "1"));
  });

  app.post("/update", async (c) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
    }
    const cliEntry = process.env.PENGUIN_CLI_ENTRY;
    if (!cliEntry) {
      return c.json({
        status: "unsupported",
        reason: "not_launched_via_cli",
        output: "",
        needsRestart: false,
      } satisfies UpdateRunResponse);
    }
    inflightRun ??= runSelfUpdate(cliEntry).finally(() => {
      inflightRun = null;
    });
    return c.json(await inflightRun);
  });

  return app;
}
