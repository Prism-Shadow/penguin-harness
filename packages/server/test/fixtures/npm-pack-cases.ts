/**
 * Package directories and the file list `npm pack` publishes from each — what an install made
 * without npm must put in the prefix for the same upload. Each `packed` list is what
 * `npm pack --dry-run --json` (npm 11.19, npm-packlist 10) reported for `files` written to disk,
 * recorded on 2026-11-20 by writing each case to disk and asking npm. When npm's rules change,
 * ask npm again rather than editing a list by hand.
 */

export interface PackCase {
  files: Record<string, string>;
  packed: string[];
}

const pkg = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "@acme/probe", version: "1.0.0", ...extra });

export const NPM_PACK_CASES: Record<string, PackCase> = {
  "an .npmignore and no files field": {
    files: {
      "package.json": pkg(),
      "index.js": "",
      ".env": "SECRET=1",
      "secret.txt": "s",
      ".npmignore": ".env\nsecret.txt\n",
    },
    packed: ["index.js", "package.json"],
  },
  "only a .gitignore": {
    files: {
      "package.json": pkg(),
      "index.js": "",
      ".env": "SECRET=1",
      "build-cache/x.bin": "x",
      ".gitignore": ".env\nbuild-cache/\n",
    },
    packed: ["index.js", "package.json"],
  },
  "an .npmignore beside a .gitignore": {
    files: {
      "package.json": pkg(),
      "index.js": "",
      "a.log": "",
      "b.tmp": "",
      ".gitignore": "*.log\n",
      ".npmignore": "*.tmp\n",
    },
    packed: ["a.log", "index.js", "package.json"],
  },
  "files with npm's always-ignored names and a nested .npmignore": {
    files: {
      "package.json": pkg({ files: ["dist"] }),
      "dist/a.js": "",
      "dist/a.js.map": "",
      "dist/.DS_Store": "",
      "dist/x.orig": "",
      "dist/.npmignore": "*.map\n",
      "npm-debug.log": "",
      "src/a.ts": "",
      "README.md": "",
      LICENSE: "",
    },
    packed: ["LICENSE", "README.md", "dist/a.js", "package.json"],
  },
  "a bin target outside files": {
    files: {
      "package.json": pkg({ files: ["dist"], bin: { tool: "cli.js" } }),
      "dist/a.js": "",
      "cli.js": "#!/usr/bin/env node\n",
      "other.js": "",
    },
    packed: ["cli.js", "dist/a.js", "package.json"],
  },
  "a string bin and a ./ main": {
    files: {
      "package.json": pkg({ files: ["lib"], bin: "./bin/run.js", main: "./dist/index.js" }),
      "lib/a.js": "",
      "bin/run.js": "",
      "dist/index.js": "",
      "dist/other.js": "",
    },
    packed: ["bin/run.js", "lib/a.js", "package.json"],
  },
  "files globs and the always-included names": {
    files: {
      "package.json": pkg({ files: ["*.js", "lib/**/*.js", "docs/*"] }),
      "a.js": "",
      "a.ts": "",
      "lib/x/y.js": "",
      "lib/x/y.d.ts": "",
      "docs/one.md": "",
      "docs/deep/two.md": "",
      "Readme.markdown": "",
      "licence.txt": "",
      COPYING: "",
      "CHANGELOG.md": "",
    },
    packed: [
      "COPYING",
      "Readme.markdown",
      "a.js",
      "docs/deep/two.md",
      "docs/one.md",
      "lib/x/y.js",
      "licence.txt",
      "package.json",
    ],
  },
  "a nested .gitignore": {
    files: {
      "package.json": pkg(),
      "index.js": "",
      "sub/.gitignore": "*.secret\n",
      "sub/keep.js": "",
      "sub/drop.secret": "",
      "sub/deeper/also.secret": "",
    },
    packed: ["index.js", "package.json", "sub/keep.js"],
  },
  "a negation in .npmignore": {
    files: {
      "package.json": pkg(),
      ".npmignore": "*.env\n!keep.env\n",
      "drop.env": "",
      "keep.env": "",
      "index.js": "",
    },
    packed: ["index.js", "keep.env", "package.json"],
  },
  "lockfiles and VCS folders": {
    files: {
      "package.json": pkg(),
      "index.js": "",
      "package-lock.json": "{}",
      "yarn.lock": "",
      "pnpm-lock.yaml": "",
      "sub/package-lock.json": "{}",
      ".hg/x": "",
      "CVS/y": "",
      "._resource": "",
      ".x.swp": "",
      "build/config.gypi": "",
    },
    packed: ["index.js", "package.json", "sub/package-lock.json"],
  },
  "a negation in files": {
    files: {
      "package.json": pkg({ files: ["dist", "!dist/test"] }),
      "dist/a.js": "",
      "dist/test/a.test.js": "",
    },
    packed: ["dist/a.js", "package.json"],
  },
  "directories.bin": {
    files: {
      "package.json": pkg({ files: ["lib"], directories: { bin: "./tools" } }),
      "lib/a.js": "",
      "tools/one": "",
      "tools/two.js": "",
      "tools/.hidden": "",
    },
    packed: ["lib/a.js", "package.json", "tools/one", "tools/two.js"],
  },
  "a single file and a directory with its own .npmignore in files": {
    files: {
      "package.json": pkg({ files: ["dist/index.js", "types/"] }),
      "dist/index.js": "",
      "dist/extra.js": "",
      "types/a.d.ts": "",
      "types/.npmignore": "b.d.ts\n",
      "types/b.d.ts": "",
    },
    packed: ["dist/index.js", "package.json", "types/a.d.ts"],
  },
  "bin as an array, and a browser entry": {
    files: {
      "package.json": pkg({
        files: ["lib"],
        bin: ["./tools/a.js", "tools/b.js"],
        browser: "web/entry.js",
      }),
      "lib/x.js": "",
      "tools/a.js": "",
      "tools/b.js": "",
      "tools/c.js": "",
      "web/entry.js": "",
      "web/other.js": "",
    },
    packed: ["lib/x.js", "package.json", "tools/a.js", "tools/b.js", "web/entry.js"],
  },
  "anchored and directory patterns in .gitignore": {
    files: {
      "package.json": pkg(),
      ".gitignore": "/root-only.txt\nlogs/\n**/tmp\n",
      "root-only.txt": "",
      "sub/root-only.txt": "",
      "logs/a.log": "",
      "sub/logs/b.log": "",
      "a/tmp/c": "",
      "index.js": "",
    },
    packed: ["index.js", "package.json", "sub/root-only.txt"],
  },
};
