/**
 * The agent browser's settings: its homepage, the page a new tab opens when it is given no
 * address and the toolbar's Home button goes to; and the Chrome the hosted backend launches,
 * when an admin names one instead of letting the server look for it.
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

/** An absolute path, as the file may hold one; anything else there is no path. */
function storedChromePath(value: unknown): string | null {
  return typeof value === "string" && path.isAbsolute(value) ? value : null;
}

/**
 * The settings out of the file's parsed JSON; whatever is missing or malformed is its default.
 * No Chrome path is no `chromePath` at all, in the file and in what is answered.
 */
function settingsOf(parsed: unknown): BuiltinBrowserSettings {
  const fields = (typeof parsed === "object" && parsed !== null ? parsed : {}) as {
    homepage?: unknown;
    chromePath?: unknown;
  };
  const chromePath = storedChromePath(fields.chromePath);
  return {
    homepage: storedHomepage(fields.homepage),
    ...(chromePath !== null ? { chromePath } : {}),
  };
}

export class SettingsStore {
  /** Writes run one after another, so the one asked for last is the one the file keeps. */
  private writing: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly file: string,
    private readonly log: (line: string) => void = () => {},
  ) {}

  async read(): Promise<BuiltinBrowserSettings> {
    try {
      return settingsOf(JSON.parse(await fs.promises.readFile(this.file, "utf8")));
    } catch (err) {
      return this.unreadable(err);
    }
  }

  /** The same, for a caller that cannot wait (which backend a call goes to is decided in line). */
  readSync(): BuiltinBrowserSettings {
    try {
      return settingsOf(JSON.parse(fs.readFileSync(this.file, "utf8")));
    } catch (err) {
      return this.unreadable(err);
    }
  }

  /**
   * Writes the fields given, already checked by the caller; one left out keeps what is stored.
   */
  write(update: Partial<BuiltinBrowserSettings>): Promise<BuiltinBrowserSettings> {
    const done = this.writing.then(async () => {
      const stored = await this.read();
      const chromePath = update.chromePath !== undefined ? update.chromePath : stored.chromePath;
      const saved: BuiltinBrowserSettings = {
        homepage: update.homepage !== undefined ? update.homepage : stored.homepage,
        ...(typeof chromePath === "string" ? { chromePath } : {}),
      };
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await atomicWriteFile(this.file, `${JSON.stringify(saved)}\n`);
      return saved;
    });
    this.writing = done.catch(() => undefined);
    return done;
  }

  private unreadable(err: unknown): BuiltinBrowserSettings {
    // No file is the normal state until something is first set.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      this.log(
        `builtin browser: the settings could not be read, using the defaults: ${String(err)}`,
      );
    }
    return { homepage: null };
  }
}
