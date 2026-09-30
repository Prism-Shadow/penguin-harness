/**
 * The built-in browser's settings: for now its homepage, the page a new tab opens when it is
 * given no address and the toolbar's Home button goes to.
 *
 * One small JSON file, `<root>/builtin-browser/settings.json`, written atomically and read on
 * every use rather than held in memory: across a hot swap the previous App and the next one
 * share the file for a moment, and neither may answer from a copy the other has replaced. No
 * file means the defaults; a file that cannot be read or parsed is logged and means them too.
 */
import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "@prismshadow/penguin-core";
import type { BuiltinBrowserSettings } from "../api/types.js";

export function settingsFile(root: string): string {
  return path.join(root, "builtin-browser", "settings.json");
}

/** A web page with a host, as the file may hold one; anything else there is no homepage. */
function storedHomepage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== ""
    ? url.href
    : null;
}

export class SettingsStore {
  /** Writes run one after another, so the one asked for last is the one the file keeps. */
  private writing: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly log: (line: string) => void = () => {},
  ) {}

  async read(): Promise<BuiltinBrowserSettings> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.promises.readFile(this.file, "utf8"));
    } catch (err) {
      // No file is the normal state until a homepage is first set.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.log(
          `builtin browser: the settings could not be read, using the defaults: ${String(err)}`,
        );
      }
      return { homepage: null };
    }
    const fields = typeof parsed === "object" && parsed !== null ? parsed : {};
    return { homepage: storedHomepage((fields as { homepage?: unknown }).homepage) };
  }

  /** Replaces the settings with `settings`, already checked by the caller. */
  write(settings: BuiltinBrowserSettings): Promise<BuiltinBrowserSettings> {
    const saved: BuiltinBrowserSettings = { homepage: settings.homepage };
    const body = `${JSON.stringify(saved)}\n`;
    const done = this.writing.then(async () => {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await atomicWriteFile(this.file, body);
      return saved;
    });
    this.writing = done.catch(() => undefined);
    return done;
  }
}
