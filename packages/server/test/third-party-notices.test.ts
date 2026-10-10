// The builtin prefix's THIRD-PARTY-NOTICES.md (scripts/lib/third-party-notices.mjs): every
// package's license text travels with it, borrowed only from the package a platform build is of.
import { describe, expect, it } from "vitest";
import { thirdPartyNotices } from "../../../scripts/lib/third-party-notices.mjs";

const where = { carrier: "penguin-builtin-plugins", location: "node_modules/" };
const koffi = {
  name: "koffi",
  version: "3.1.6",
  license: "MIT",
  author: "Niels Martignène",
  repository: { type: "git", url: "https://github.com/Koromix/koffi" },
  homepage: "https://koffi.dev/",
  optionalDependencies: { "@koromix/koffi-linux-x64": "3.1.6" },
  licenseFile: "LICENSE.txt",
  licenseText: "MIT License\r\n\r\nCopyright (C) 2026  Niels Martignène\r\n",
};
const koffiLinux = {
  name: "@koromix/koffi-linux-x64",
  version: "3.1.6",
  license: "MIT",
  author: "Niels Martignène",
  repository: { type: "git", url: "https://github.com/Koromix/koffi" },
};
const landlock = {
  name: "@deepseek-ai/node-addon-landlock-run",
  version: "0.1.1",
  license: "BSD-3-Clause",
  repository: {
    type: "git",
    url: "git+https://github.com/deepseek-harness/deepseek-harness.git",
    directory: "native/landlock-run/packages/entry",
  },
  licenseFile: "LICENSE",
  licenseText: "BSD 3-Clause License\n\nCopyright (c) DeepSeek\n",
};

describe("thirdPartyNotices", () => {
  it("lists and sections the packages sorted by name, whatever order they come in", () => {
    const notices = thirdPartyNotices([koffi, landlock, koffiLinux], where);
    const headings = notices.split("\n").filter((line) => line.startsWith("## "));
    expect(headings).toEqual([
      "## @deepseek-ai/node-addon-landlock-run@0.1.1",
      "## @koromix/koffi-linux-x64@3.1.6",
      "## koffi@3.1.6",
    ]);
    expect(notices).toContain(
      "`penguin-builtin-plugins` carries these 3 third-party packages in `node_modules/`",
    );
    expect(notices).toContain("- @deepseek-ai/node-addon-landlock-run@0.1.1 (BSD-3-Clause)");
    expect(thirdPartyNotices([koffiLinux, landlock, koffi], where)).toBe(notices);
  });

  it("includes each package's license id, source and full license text", () => {
    const notices = thirdPartyNotices([landlock], where);
    expect(notices).toContain("- License: BSD-3-Clause");
    expect(notices).toContain(
      "- Repository: https://github.com/deepseek-harness/deepseek-harness/tree/HEAD/native/landlock-run/packages/entry",
    );
    expect(notices).toContain(
      "License text from its `LICENSE`:\n\n```text\nBSD 3-Clause License\n\nCopyright (c) DeepSeek\n```",
    );
  });

  it("borrows the text of the package a platform build is of, and says so", () => {
    const notices = thirdPartyNotices([koffi, koffiLinux], where);
    const section = notices.slice(notices.indexOf("## @koromix/koffi-linux-x64@3.1.6"));
    expect(section).toContain(
      "This package ships no license file. License text from koffi@3.1.6, of which this is the prebuilt binary package (same author, same license):",
    );
    expect(section).toContain("```text\nMIT License\n\nCopyright (C) 2026  Niels Martignène\n```");
  });

  it("fails rather than ship a package without license text", () => {
    const stray = { name: "left-pad", version: "1.0.0", license: "MIT" };
    expect(() => thirdPartyNotices([koffi, stray], where)).toThrow(
      /no license text found for left-pad@1\.0\.0/,
    );
    // A platform package borrows only from a parent with the same author and license.
    const otherAuthor = { ...koffiLinux, author: "Someone Else" };
    expect(() => thirdPartyNotices([koffi, otherAuthor], where)).toThrow(
      /@koromix\/koffi-linux-x64@3\.1\.6/,
    );
  });
});
