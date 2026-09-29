/**
 * Publishing a QA deploy's media: files only the draft holds are copied into the media clone
 * (its sparse set widened first), files the repository has are left, and files found nowhere
 * are named. The clone is the media repository, so the data's `media/loom/...` is `loom/...`
 * in it. git is a fake that answers from memory; the draft and the clone are temp dirs.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { draftSource, sparseCovers, syncMedia } from "../src/activities/deploy-media.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function tempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function put(root: string, relative: string, content: string) {
  const file = path.join(root, ...relative.split("/"));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

/** git over a media repository whose tree holds `tracked`, with a cone-mode sparse set. */
function fakeGit(tracked: string[], sparse: string[] = ["loom/words"]) {
  const calls: string[][] = [];
  return {
    calls,
    sparse,
    async git(args: string[]) {
      calls.push(args);
      if (args[0] === "sparse-checkout" && args[1] === "list")
        return { code: 0, stdout: sparse.join("\n") };
      if (args[0] === "sparse-checkout" && args[1] === "add") {
        sparse.push(...args.slice(2));
        return { code: 0, stdout: "" };
      }
      if (args[0] === "ls-tree") {
        const reference = args[args.length - 1]!;
        return { code: 0, stdout: tracked.includes(reference) ? `${reference}\n` : "" };
      }
      return { code: 1, stdout: "" };
    },
  };
}

describe("deploy media", () => {
  it("copies what only the draft holds, leaves what the repository has, and names what is nowhere", async () => {
    const clone = await tempDir("penguin-deploy-media-clone-");
    const draft = await tempDir("penguin-deploy-media-draft-");
    const other = await tempDir("penguin-deploy-media-draft2-");
    await put(draft, "loom/words/new.mp3", "new sound");
    await put(draft, "loom/words/same.mp3", "same");
    await put(clone, "loom/words/same.mp3", "same");
    await put(draft, "loom/words/changed.mp3", "fixed");
    await put(clone, "loom/words/changed.mp3", "old");
    await put(other, "shared/pic.png", "picture");
    const git = fakeGit(["common/click.mp3"]);
    const lines: string[] = [];
    const result = await syncMedia(
      {
        dir: clone,
        references: [
          "media/loom/words/new.mp3",
          "media/loom/words/same.mp3",
          "media/loom/words/changed.mp3",
          "media/shared/pic.png",
          "media/common/click.mp3",
          "media/loom/words/gone.mp3",
        ],
        draftRoots: [draft, other],
      },
      { git: git.git, log: (text) => lines.push(text) },
    );
    expect(result).toEqual({
      copied: ["loom/words/new.mp3", "loom/words/changed.mp3", "shared/pic.png"],
      missing: ["media/loom/words/gone.mp3"],
      present: 2,
    });
    expect(await fs.readFile(path.join(clone, "loom/words/new.mp3"), "utf8")).toBe("new sound");
    expect(await fs.readFile(path.join(clone, "loom/words/changed.mp3"), "utf8")).toBe("fixed");
    expect(await fs.readFile(path.join(clone, "shared/pic.png"), "utf8")).toBe("picture");
    // Only the folder outside the sparse set was added, once.
    expect(git.calls.filter((call) => call[1] === "add")).toEqual([
      ["sparse-checkout", "add", "shared"],
    ]);
    expect(lines.at(-1)).toBe("Media: 2 already in the repository, 3 copied, 1 missing.");
    // The draft is only read.
    expect(await fs.readFile(path.join(draft, "loom/words/new.mp3"), "utf8")).toBe("new sound");
  });

  it("adds no sparse folder to a media checkout that is not sparse", async () => {
    const clone = await tempDir("penguin-deploy-media-clone-");
    const draft = await tempDir("penguin-deploy-media-draft-");
    await put(draft, "shared/pic.png", "picture");
    const calls: string[][] = [];
    const result = await syncMedia(
      { dir: clone, references: ["media/shared/pic.png"], draftRoots: [draft] },
      {
        git: async (args) => {
          calls.push(args);
          // git's answer for a checkout with no sparse set.
          return args[1] === "list" ? { code: 128, stdout: "" } : { code: 1, stdout: "" };
        },
        log: () => {},
      },
    );
    expect(result.copied).toEqual(["shared/pic.png"]);
    expect(calls).toEqual([["sparse-checkout", "list"]]);
  });

  it("finds a draft's file only inside its media folder, and reads the sparse set as folders", async () => {
    const draft = await tempDir("penguin-deploy-media-draft-");
    await put(draft, "a.mp3", "a");
    expect(await draftSource("media/a.mp3", [draft])).toBe(path.join(draft, "a.mp3"));
    expect(await draftSource("media/../a.mp3", [draft])).toBeNull();
    expect(await draftSource("other/a.mp3", [draft])).toBeNull();
    expect(sparseCovers(["loom/words"], "loom/words/a.mp3")).toBe(true);
    expect(sparseCovers(["/loom/words/"], "loom/words/x/a.mp3")).toBe(true);
    expect(sparseCovers(["loom/words"], "loom/wordsmith/a.mp3")).toBe(false);
  });

  it("refuses a reference that would leave the clone", async () => {
    const clone = await tempDir("penguin-deploy-media-clone-");
    const git = fakeGit([]);
    const result = await syncMedia(
      { dir: clone, references: ["media/../../outside.mp3"], draftRoots: [] },
      { git: git.git, log: () => {} },
    );
    expect(result.missing).toEqual(["media/../../outside.mp3"]);
    expect(git.calls).toEqual([]);
  });
});
