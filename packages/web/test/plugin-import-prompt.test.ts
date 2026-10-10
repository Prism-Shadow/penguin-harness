/**
 * The plugin import dialog's sources:
 *
 * - The npm tab takes a package name, the link tab an https link to a repository or a tarball,
 *   and neither takes the other's: the server reads the two apart the same way. A plain http,
 *   file or ssh link, a path, a link with credentials, an alias behind a name and a description
 *   go to neither; they are for an Agent instead.
 * - The Agent's prompt names the source, asks for a review before anything is installed, and
 *   installs with `penguin plugin install` in this Project; a local folder is routed to the zip
 *   upload.
 * - The server's 409 is read as the question the replace confirm asks; any other message is
 *   not one.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPluginImportPrompt,
  classifyPluginSource,
  isNpmPluginName,
  isPluginLink,
  readReplaceQuestion,
} from "../src/features/plugins/plugin-import-prompt";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

beforeEach(() => {
  setActiveStrings(en);
});

describe("what the server installs as it is", () => {
  const names = ["@acme/notes", "notes@1.2.0", "notes@^1.2", "notes@latest"];
  const links = [
    "https://github.com/acme/notes",
    "git+https://github.com/acme/notes.git",
    "github:acme/notes#v1.0.0",
    "https://example.com/notes-1.0.0.tgz",
  ];
  const neither = [
    "",
    "the notes plugin from the docs",
    "http://example.com/notes.tgz",
    "file:../notes",
    "git+ssh://git@github.com/acme/notes.git",
    "https://user:secret@example.com/notes.tgz",
    "notes@npm:other",
    "/srv/plugins/notes",
    "../notes",
  ];

  it("is a package name on the npm tab, and nothing else", () => {
    for (const name of names) expect(isNpmPluginName(` ${name} `), name).toBe(true);
    for (const other of [...links, ...neither]) expect(isNpmPluginName(other), other).toBe(false);
  });

  it("is an https link on the link tab, and nothing else", () => {
    for (const link of links) expect(isPluginLink(` ${link} `), link).toBe(true);
    for (const other of [...names, ...neither]) expect(isPluginLink(other), other).toBe(false);
  });
});

describe("the prompt for an agent", () => {
  it("names the source, asks for a review first, and installs with the CLI in this Project", () => {
    const prompt = buildPluginImportPrompt("https://github.com/acme/notes", "proj-1");
    expect(prompt).toContain("https://github.com/acme/notes");
    expect(prompt).toContain("before installing anything");
    expect(prompt).toContain("penguin plugin install");
    expect(prompt).toContain("--project-id proj-1");
  });

  it("reads a link, a local folder and a description each in its own way", () => {
    expect(classifyPluginSource("https://github.com/acme/notes")).toBe("link");
    expect(classifyPluginSource("github:acme/notes")).toBe("link");
    expect(classifyPluginSource("/srv/plugins/notes")).toBe("localPath");
    expect(classifyPluginSource("C:\\plugins\\notes")).toBe("localPath");
    expect(classifyPluginSource("the notes plugin")).toBe("reference");
    // Each kind starts the prompt differently; the tail (the review, the command) is shared.
    const leads = ["https://x.dev/p", "/srv/p", "a plugin"].map(
      (source) => buildPluginImportPrompt(source, "p").split("\n")[0],
    );
    expect(new Set(leads).size).toBe(3);
  });
});

describe("the replace question", () => {
  it("is read out of the server's 409, and out of nothing else", () => {
    expect(
      readReplaceQuestion("Plugin @acme/notes is installed at 1.0.0; the zip holds 1.1.0."),
    ).toEqual({ name: "@acme/notes", installed: "1.0.0", incoming: "1.1.0" });
    expect(readReplaceQuestion("npm: 404 Not Found")).toBeNull();
  });
});
