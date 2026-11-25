/**
 * Given a generated design, both archives carry the same working sources and only data
 * varies with the conversation. The exported plugin is readable by the real library.
 * An install must load a tab and the correct board before verification can begin.
 * A smoke test must read back real changes and remove only its own item, even on failure.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { readLibraryPackage } from "@prismshadow/penguin-core";
import { archive } from "../src/archives.js";
import { build } from "esbuild";
const guide = {
  boardId: "checklist-example",
  design: {
    title: "Launch review",
    items: [{ group: "Review", task: "Read <em>notes</em>", doneWhen: "Review signed" }],
  },
};
describe("the generated checklist", () => {
  it("exports the installed workbench's exact sources inside an importable plugin", async () => {
    const plugin = unzipSync(archive(guide, "plugin")),
      board = unzipSync(archive(guide, "workbench"));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "checklist-package-"));
    try {
      for (const [name, source] of Object.entries(plugin)) {
        const file = path.join(dir, name);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, source);
      }
      expect(readLibraryPackage(dir).workbenches?.map((w) => w.name)).toEqual([guide.boardId]);
      for (const [name, source] of Object.entries(board))
        expect(plugin["workbenches/" + guide.boardId + "/" + name]).toEqual(source);
      expect(strFromU8(board["definition.ts"])).toContain(guide.design.items[0].task);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  it("proves the installed handler can save, check and remove an item without changing the user's items", async () => {
    const files = unzipSync(archive(guide, "workbench"));
    // Compile what a user actually downloaded, including the model's definition module.
    const built = await build({
      stdin: { contents: strFromU8(files["index.ts"]), loader: "ts" },
      format: "esm",
      bundle: true,
      write: false,
      plugins: [
        {
          name: "archive-source",
          setup(b) {
            b.onResolve({ filter: /^\.\/definition\.js$/ }, () => ({
              path: "definition.ts",
              namespace: "archive",
            }));
            b.onLoad({ filter: /.*/, namespace: "archive" }, (args) => ({
              contents: strFromU8(files[args.path]),
              loader: "ts",
            }));
          },
        },
      ],
    });
    const { default: template } = await import(
      "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].contents).toString("base64")
    );
    let state: unknown = null;
    const make = () =>
      template.modules.Workbench.create({
        use: {
          host: {
            getState: () => state,
            setState: async (value: unknown) => {
              state = structuredClone(value);
            },
          },
        },
      } as never).api.main.handle;
    const api = async (
      url: string,
      action?: { op: string; id: string; task?: string; group?: string; done?: boolean },
    ) => {
      const reply = await make()({
        path: "/" + url.split("/").pop(),
        method: action ? "POST" : "GET",
        body: action ?? null,
        headers: {},
        query: {},
      });
      if ((reply.status ?? 200) >= 400) throw Error(String(reply.status));
      return reply.body;
    };
    const before = await api("board");
    const id = "test-item";
    const task = "Temporary check";
    await api("items", { op: "add", id, task, group: "QA" });
    expect((await api("board")).items).toContainEqual(
      expect.objectContaining({ id, task, done: false }),
    );
    await api("items", { op: "check", id, done: true });
    expect((await api("board")).items).toContainEqual(expect.objectContaining({ id, done: true }));
    await api("items", { op: "remove", id });
    expect(await api("board")).toEqual(before);
  });
});
