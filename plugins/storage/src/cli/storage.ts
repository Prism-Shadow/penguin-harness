/**
 * `penguin storage` — the Storage page in the shell, a thin client over /api/me/storage: what
 * the data root holds, and its cleanup. What the caller sees is what the page shows them: a
 * member their Projects, an admin the whole data root.
 *
 *   penguin storage [--refresh]
 *   penguin storage clean [--older-than <days>] [--all] [--yes]
 *
 * `clean` is a dry run unless `--yes`: it lists the review, marking what a removal would take —
 * what the page ticks to begin with, or with `--all` every item — and with `--yes` removes those,
 * each judged again by the server. A removal takes a person's sign-in (`human_required` for the
 * local API token an Agent's shell holds). Both take `--json` (the response DTO) and `--server`.
 * The figures are measured in the background; the command waits for a measurement under way to
 * end, so what it prints is never an empty disk. An error is one line on stderr,
 * `error: <code>: <message>`, with exit code 1.
 * Docs: /docs/cli § "penguin storage".
 */
import type { Command } from "commander";
import { ApiError, ServerClient, resolveConnection } from "@prismshadow/penguin-library-cli";
import type { StorageCleanupResult, StorageCleanupReview, StorageUsage } from "../types.js";
import type { StorageMessages } from "./storage.messages.js";
import { formatSize, renderReview, renderUsage } from "./storage-output.js";

const BASE = "/api/me/storage";
/** Items one removal request may name (the server's own cap). */
const BATCH = 500;
/** How often, and how long at most, the command waits on a measurement under way. */
const POLL_MS = 1000;
const WAIT_MS = 120_000;

interface CommonOpts {
  json?: boolean;
  server?: string;
}

/** A failure found before or around a request, reported like an API error. */
class StorageCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function describeError(err: unknown, t: StorageMessages): { code: string; message: string } {
  if (err instanceof StorageCliError) return { code: err.code, message: err.message };
  if (err instanceof ApiError) {
    if (err.code === "human_required")
      return { code: err.code, message: t.storage.humanRequired() };
    // A server that runs no storage module answers the routes' prefix with the platform's 404.
    if (err.status === 404 && err.code === "not_found") {
      return { code: "storage_unavailable", message: t.storage.unavailable() };
    }
    return {
      code: err.code,
      message: err.status !== 401 && err.detail !== "" ? err.detail : err.message,
    };
  }
  return { code: "request_failed", message: err instanceof Error ? err.message : String(err) };
}

function action<A extends unknown[]>(
  t: StorageMessages,
  run: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args) => {
    try {
      await run(...args);
    } catch (err) {
      const { code, message } = describeError(err, t);
      process.stderr.write(`${t.storage.errorLine(code, message.replace(/\s+/g, " ").trim())}\n`);
      process.exitCode = 1;
    }
  };
}

async function connect(opts: CommonOpts, t: StorageMessages): Promise<ServerClient> {
  return new ServerClient(await resolveConnection({ server: opts.server }, t), t);
}

/** The usage once no measurement is under way (or the wait ran out): never a first empty read. */
async function settled(client: ServerClient, first: StorageUsage): Promise<StorageUsage> {
  let usage = first;
  const until = Date.now() + WAIT_MS;
  while (usage.measuring && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    usage = await client.request<StorageUsage>("GET", BASE);
  }
  return usage;
}

function parseDays(raw: string | undefined, t: StorageMessages): number | undefined {
  if (raw === undefined) return undefined;
  const days = /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : Number.NaN;
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new StorageCliError("bad_request", t.storage.daysInvalid(raw));
  }
  return days;
}

export function registerStorageCommand(storage: Command, t: StorageMessages): void {
  const s = t.storage;
  const leaf = (cmd: Command): Command =>
    cmd.option("--json", t.common.json).option("--server <url>", t.common.server);

  // `penguin storage` answers on its own and has a subcommand. `--json` and `--server` are its
  // options, which `clean` reads as well (`optsWithGlobals`): declared on both, the parent would
  // take them from `clean`'s argv wherever they stand, since the host's program reads options
  // anywhere in the line.
  leaf(storage.description(s.desc).option("--refresh", s.refresh)).action(
    action(t, async (opts: CommonOpts & { refresh?: boolean }) => {
      const client = await connect(opts, t);
      const first =
        opts.refresh === true
          ? await client.request<StorageUsage>("POST", `${BASE}/refresh`, {})
          : await client.request<StorageUsage>("GET", BASE);
      const usage = await settled(client, first);
      if (opts.json === true) process.stdout.write(`${JSON.stringify(usage)}\n`);
      else process.stdout.write(renderUsage(usage, t));
    }),
  );

  storage
    .command("clean")
    .description(s.cleanDesc)
    .option("--older-than <days>", s.olderThan)
    .option("--all", s.all)
    .option("--yes", s.yes)
    .action(
      action(t, async (_own: unknown, cmd: Command) => {
        const opts = cmd.optsWithGlobals<
          CommonOpts & { olderThan?: string; all?: boolean; yes?: boolean }
        >();
        const days = parseDays(opts.olderThan, t);
        const client = await connect(opts, t);
        const review = await client.request<StorageCleanupReview>(
          "GET",
          `${BASE}/cleanup${days !== undefined ? `?olderThanDays=${days}` : ""}`,
        );
        const chosen = review.items.filter((item) => opts.all === true || item.selected);
        const ids = new Set(chosen.map((item) => item.id));
        const bytes = chosen.reduce((sum, item) => sum + item.bytes, 0);
        if (opts.yes !== true) {
          if (opts.json === true) {
            process.stdout.write(`${JSON.stringify({ ...review, chosen: [...ids] })}\n`);
            return;
          }
          process.stdout.write(renderReview(review, ids, t));
          if (review.items.length > 0) {
            process.stdout.write(
              `\n${chosen.length > 0 ? s.wouldRemove(chosen.length, formatSize(bytes), review.items.length) : s.nothingChosen(review.items.length)}\n`,
            );
          }
          return;
        }
        const total: StorageCleanupResult = { removed: 0, bytes: 0, skipped: [] };
        const all = [...ids];
        for (let i = 0; i < all.length; i += BATCH) {
          const part = await client.request<StorageCleanupResult>("POST", `${BASE}/cleanup`, {
            items: all.slice(i, i + BATCH),
            olderThanDays: review.olderThanDays,
          });
          total.removed += part.removed;
          total.bytes += part.bytes;
          total.skipped.push(...part.skipped);
        }
        if (opts.json === true) {
          process.stdout.write(`${JSON.stringify(total)}\n`);
          return;
        }
        if (all.length === 0) {
          process.stdout.write(
            `${review.items.length === 0 ? s.nothing : s.nothingChosen(review.items.length)}\n`,
          );
          return;
        }
        const failed = total.skipped.filter((x) => x.reason === "failed").length;
        process.stdout.write(
          `${s.removed(total.removed, formatSize(total.bytes), total.skipped.length - failed, failed)}\n`,
        );
        if (failed > 0) process.exitCode = 1;
      }),
    );
}
