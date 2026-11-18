import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { deckStorage } from "../workbenches/slides/storage.js";

it("imports preview decks and history once and keeps newer edits and later deletions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bento-storage-"));
  try {
    const older = path.join(root, "preview"),
      current = path.join(root, "app", "data", "default_agent.slides");
    await mkdir(path.join(older, "decks"), { recursive: true });
    await mkdir(path.join(older, "history", "brief"), { recursive: true });
    await writeFile(path.join(older, "decks", "brief.bento.json"), "original");
    await writeFile(path.join(older, "history", "brief", "12-editor.bento.json"), "draft");
    await mkdir(path.join(current, "decks"), { recursive: true });
    await writeFile(path.join(current, "decks", "brief.bento.json"), "newer");
    const past = Math.trunc(Date.now() / 1000) - 86400;
    const historyFile = path.join("history", "brief", "12-editor.bento.json");
    await utimes(path.join(older, historyFile), past, past);
    const open = () => deckStorage(current, pathToFileURL(older + path.sep));
    const store = open();
    expect((await store.listFiles()).map((x) => x.path).sort()).toEqual([
      "decks/brief.bento.json",
      "history/brief/12-editor.bento.json",
    ]);
    expect(await readFile(store.filePath("decks/brief.bento.json"), "utf8")).toBe("newer");
    expect((await stat(path.join(current, historyFile))).mtimeMs).toBe(past * 1000);
    const h = await store.readFile("history/brief/12-editor.bento.json");
    expect(new TextDecoder().decode(h!)).toBe("draft");
    await store.writeFile("decks/brief.bento.json", "revised");
    expect(await readFile(store.filePath("decks/brief.bento.json"), "utf8")).toBe("revised");
    await store.removeFile("decks/brief.bento.json");
    expect(await open().readFile("decks/brief.bento.json")).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
