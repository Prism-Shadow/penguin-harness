// A workbench compiles against its host declaration in an Agent's folder, independent of npm.
const nodeFs = "node:fs/promises";
interface Entry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
}
interface Stat {
  size: number;
  mtimeMs: number;
  isFile(): boolean;
  isDirectory(): boolean;
}
interface Disk {
  readdir(dir: string | URL, opts: { withFileTypes: true }): Promise<Entry[]>;
  lstat(file: string | URL): Promise<Stat>;
  mkdir(dir: string, opts: { recursive: true }): Promise<unknown>;
  readFile(file: string | URL): Promise<Uint8Array>;
  writeFile(file: string, data: Uint8Array | string, opts?: { flag: string }): Promise<void>;
  copyFile(from: string | URL, to: string, mode: number): Promise<void>;
  link(from: string, to: string): Promise<void>;
  utimes(file: string, accessed: number, modified: number): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(file: string, opts: { force: boolean }): Promise<void>;
}

const deck = /^decks\/[a-z0-9][a-z0-9-]{0,63}\.bento\.json$/;
const history = /^history\/[a-z0-9][a-z0-9-]{0,63}\/\d{1,16}-(?:editor|agent)\.bento\.json$/;
const historyDir = /^history\/[a-z0-9][a-z0-9-]{0,63}$/;
const absent = (err: unknown) => (err as { code?: string })?.code === "ENOENT";
const MAX_BYTES = 40 * 1024 * 1024;

export function deckStorage(root: string, preview = new URL("../../.files/", import.meta.url)) {
  const disk: Promise<Disk> = import(nodeFs);
  const filePath = (name?: string) => (name === undefined ? root : root + "/" + name);
  const checked = (name: string) => {
    if (!deck.test(name) && !history.test(name)) throw new Error("Invalid presentation file");
    return filePath(name);
  };
  async function scan(at: (name: string) => string | URL) {
    const fs = await disk;
    const rows: { path: string; size: number; mtimeMs: number }[] = [];
    async function walk(dir: string) {
      let entries: Entry[];
      try {
        if (!(await fs.lstat(at(dir))).isDirectory()) return;
        entries = await fs.readdir(at(dir), { withFileTypes: true });
      } catch (err) {
        if (absent(err)) return;
        throw err;
      }
      for (const ent of entries) {
        const name = dir ? dir + "/" + ent.name : ent.name;
        if (ent.isDirectory() && (name === "decks" || name === "history" || historyDir.test(name)))
          await walk(name);
        if (!ent.isFile() || (!deck.test(name) && !history.test(name))) continue;
        const stat = await fs.lstat(at(name)).catch((err) => {
          if (absent(err)) return null;
          throw err;
        });
        if (stat?.isFile()) rows.push({ path: name, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
    await walk("");
    return rows;
  }
  let initialized: Promise<void> | undefined;
  async function ensure() {
    const fs = await disk;
    await fs.mkdir(root, { recursive: true });
    if (!(await fs.lstat(root)).isDirectory()) throw new Error("Invalid presentation folder");
    const marker = filePath(".bento-storage-v1");
    try {
      if ((await fs.lstat(marker)).isFile()) return;
      throw new Error("Invalid presentation migration marker");
    } catch (err) {
      if (!absent(err)) throw err;
    }
    // The preview kept files beside its source. Copy existing decks and history once. An
    // interrupted migration resumes without replacing newer documents in the host data folder.
    for (const entry of await scan((name) => new URL(name, preview))) {
      const dest = checked(entry.path);
      await ensureParent(entry.path);
      // Stage the complete file before making it visible. Linking refuses to replace a newer
      // deck, including one created on another request during the copy.
      const tmp = dest + "." + crypto.randomUUID() + ".tmp";
      try {
        await fs.copyFile(new URL(entry.path, preview), tmp, 1);
        await fs.utimes(tmp, entry.mtimeMs / 1000, entry.mtimeMs / 1000);
        await fs.link(tmp, dest);
      } catch (err) {
        if ((err as { code?: string }).code !== "EEXIST") throw err;
      } finally {
        await fs.rm(tmp, { force: true });
      }
    }
    try {
      await fs.writeFile(marker, "1", { flag: "wx" });
    } catch (err) {
      if ((err as { code?: string }).code !== "EEXIST") throw err;
    }
  }
  function ready() {
    return (initialized ??= ensure().catch((err) => {
      initialized = undefined;
      throw err;
    }));
  }
  async function ensureParent(name: string, create = true) {
    const fs = await disk;
    const parts = name.split("/").slice(0, -1);
    let dir = root;
    for (const part of parts) {
      dir += "/" + part;
      if (create) await fs.mkdir(dir, { recursive: true });
      if (!(await fs.lstat(dir)).isDirectory()) throw new Error("Invalid presentation folder");
    }
  }
  return {
    filePath,
    async listFiles() {
      await ready();
      return scan(filePath);
    },
    async readFile(name: string) {
      const dest = checked(name);
      await ready();
      const fs = await disk;
      try {
        await ensureParent(name, false);
        const stat = await fs.lstat(dest);
        if (!stat.isFile() || stat.size > MAX_BYTES)
          throw new Error("Invalid or oversized presentation");
        return await fs.readFile(dest);
      } catch (err) {
        if (absent(err)) return null;
        throw err;
      }
    },
    async writeFile(name: string, data: Uint8Array | string) {
      const dest = checked(name);
      await ready();
      const fs = await disk;
      if ((typeof data === "string" ? new TextEncoder().encode(data) : data).byteLength > MAX_BYTES)
        throw new Error("Presentation too large");
      await ensureParent(name);
      const tmp = dest + "." + crypto.randomUUID() + ".tmp";
      try {
        await fs.writeFile(tmp, data, { flag: "wx" });
        await fs.rename(tmp, dest);
      } finally {
        await fs.rm(tmp, { force: true });
      }
      const { size, mtimeMs } = await fs.lstat(dest);
      return { path: name, size, mtimeMs };
    },
    async removeFile(name: string) {
      const dest = checked(name);
      await ready();
      const fs = await disk;
      try {
        await ensureParent(name, false);
        await fs.rm(dest, { force: true });
      } catch (err) {
        if (!absent(err)) throw err;
      }
    },
  };
}
