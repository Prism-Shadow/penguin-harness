/**
 * CI selection against a real Git history and pnpm workspace, without installing dependencies.
 *
 * - Given a docs or landing edit, when planning CI, then only affected sites run, on Linux.
 * - Given a catalog README, an RFC or a CI test file edit, when planning CI, then no package job
 *   runs; given the release's npm script, only npm packaging does.
 * - Given README edits beside a landing edit, when planning CI, then the landing keeps its checks
 *   and the READMEs add none.
 * - Given a core edit, when planning CI, then its transitive consumers and native OS tests run.
 * - Given a web edit, when planning CI, then the gallery, landing and desktop are checked too.
 * - Given a web edit, when planning CI, then the web suite runs in two Linux jobs that each run
 *   half of every package's files and build what the web imports, not the web's own bundle nor
 *   the UI package's build, which only that bundle reads, and neither does the job testing the
 *   gallery; without the web among them, ui and cli run whole in one job.
 * - Given a server edit, when planning CI, then the server suite runs in two Linux jobs, each half
 *   of its files with the coverage of its half.
 * - Given a core edit, when planning CI, then the shard testing the desktop on macOS and Windows
 *   builds the desktop and what it imports, never the web bundle only a packed app reads.
 * - Given any typecheck, when planning CI, then its build selects the checked packages'
 *   dependencies and never a site bundle or the UI package's build.
 * - Given the gallery among the tested packages, when planning CI, then the one Linux job that
 *   tests it also runs its browser layout checks; without it, no job does.
 * - Given the web's inline boot script changes, when planning CI, then UI's copy guard runs.
 * - Given a plugin without declared consumers changes, when planning CI, then catalog readers run.
 * - Given a file moves between packages, when planning CI, then both owners are checked.
 * - Given a source file is deleted, when planning CI, then its surviving package is checked.
 * - Given a whole package disappears or moves, when planning CI, then all remaining packages run.
 * - Given a lockfile change inside one package's own entry, when planning CI, then that package and
 *   its dependents run, not the whole workspace, and npm packaging walks the publishing path; the
 *   desktop app is packed only when what the desktop resolves changed.
 * - Given a lockfile change to a version some packages resolve, when planning CI, then exactly the
 *   packages whose dependencies reach it run, with their dependents; a plugin among them brings
 *   the packages that read the plugins, as a change to its files does.
 * - Given a lockfile change to the root's toolchain or settings, or a lockfile that cannot be read,
 *   when planning CI, then all run.
 * - Given a shared config or unknown root input changes, when planning CI, then all run.
 * - Given the comparison base is absent or unusable, when planning CI, then all packages run.
 * - Given no changes or only changelog text, when planning CI, then no package jobs are needed.
 * - Given a new package, when planning CI, then it receives tests without editing a shard list.
 * - Given a release requests full validation, when planning CI, then every package and OS runs,
 *   macOS and Windows with the browser and site packages in a shard of their own (on Windows,
 *   two halves of it), and the Windows server suite in shards that together cover it once.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { lockfileImporters } from "../ci-lockfile.mjs";
import { planCI } from "../ci-plan.mjs";

const name = (short) => `@prismshadow/penguin-${short}`;
/**
 * The fixture's pnpm-lock.yaml, in the shape pnpm 11 writes: core resolves left-pad, the server
 * resolves express (which depends on tiny) and links core, the desktop resolves electron, the
 * landing resolves marked, a plugin resolves koffi, and the root's toolchain is vitest.
 */
const LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    devDependencies:
      vitest:
        specifier: ^4.0.0
        version: 4.0.0

  packages/core:
    dependencies:
      left-pad:
        specifier: ^1.0.0
        version: 1.0.0

  packages/desktop:
    devDependencies:
      electron:
        specifier: ^40.0.0
        version: 40.0.0

  packages/landing:
    devDependencies:
      marked:
        specifier: ^9.0.0
        version: 9.0.0

  packages/server:
    dependencies:
      '@prismshadow/penguin-core':
        specifier: workspace:*
        version: file:packages/core
      express:
        specifier: ^5.0.0
        version: 5.0.0

  plugins/sandbox-example:
    dependencies:
      koffi:
        specifier: ^3.0.0
        version: 3.1.6

packages:

  electron@40.0.0:
    resolution: {integrity: sha512-electron}

  express@5.0.0:
    resolution: {integrity: sha512-express}

  koffi@3.1.6:
    resolution: {integrity: sha512-koffi}

  left-pad@1.0.0:
    resolution: {integrity: sha512-left-pad}

  marked@9.0.0:
    resolution: {integrity: sha512-marked}

  tiny@1.0.0:
    resolution: {integrity: sha512-tiny}

  vitest@4.0.0:
    resolution: {integrity: sha512-vitest}

snapshots:

  '@prismshadow/penguin-core@file:packages/core':
    dependencies:
      left-pad: 1.0.0

  electron@40.0.0: {}

  express@5.0.0:
    dependencies:
      tiny: 1.0.0

  koffi@3.1.6: {}

  left-pad@1.0.0: {}

  marked@9.0.0: {}

  tiny@1.0.0: {}

  vitest@4.0.0: {}
`;
/** Edits of the fixture lockfile whose change reaches every package. */
const EVERY_PACKAGE = new Map([
  [
    "the root's toolchain",
    (lock) => lock.replace("        version: 4.0.0", "        version: 4.0.1"),
  ],
  ["a setting", (lock) => lock.replace("autoInstallPeers: true", "autoInstallPeers: false")],
  ["a version only the root resolves", (lock) => lock.replace("sha512-vitest}", "sha512-v2}")],
  ["the file, into something that is not a lockfile", () => "changed\n"],
]);
const members = (matrix) => new Set(matrix.include.flatMap((shard) => shard.packages));
const names = (...shorts) => new Set(shorts.map(name));

describe("affected CI", { concurrency: false }, () => {
  let cwd;
  let base;
  let allPackages;
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const write = (file, contents) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), contents);
  };
  const addPackage = (short, dependencies = [], root = "packages", scripts = true) => {
    const packageName = root === "plugins" ? `@penguinharness/${short}` : name(short);
    write(
      `${root}/${short}/package.json`,
      JSON.stringify({
        name: packageName,
        version: "1.0.0",
        private: true,
        dependencies: Object.fromEntries(dependencies.map((dep) => [name(dep), "workspace:*"])),
        ...(scripts
          ? {
              scripts: {
                build: "node --version",
                test: "node --version",
                typecheck: "node --version",
              },
            }
          : {}),
      }),
    );
    write(`${root}/${short}/src/index.js`, "export const original = true;\n");
    return packageName;
  };
  const commit = () => {
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "--quiet", "--no-gpg-sign", "-m", "fixture");
    return git("rev-parse", "HEAD");
  };
  const changed = (file) => {
    write(file, "changed\n");
    commit();
    return planCI({ cwd, base });
  };
  /** The packages a job's `build` input selects, resolved by pnpm as the setup action passes it. */
  const built = (filters) =>
    new Set(
      JSON.parse(
        execFileSync(
          "pnpm",
          [
            ...filters.split(",").flatMap((filter) => ["--filter", filter]),
            "list",
            "--recursive",
            "--depth",
            "-1",
            "--json",
          ],
          { cwd, encoding: "utf8" },
        ),
      ).map((project) => project.name),
    );

  before(() => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), "penguin-ci-plan-")));
    git("init", "--quiet");
    git("config", "user.name", "CI test");
    git("config", "user.email", "ci-test@example.invalid");
    const { packageManager } = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url)),
    );
    write("package.json", JSON.stringify({ name: "ci-fixture", private: true, packageManager }));
    write("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n  - "plugins/*"\n');
    allPackages = new Set([
      addPackage("core"),
      addPackage("server", ["core"]),
      addPackage("cli", ["server"]),
      addPackage("desktop", ["cli"]),
      addPackage("ui", ["core"]),
      addPackage("web", ["ui", "server"]),
      addPackage("ui-gallery", ["web"]),
      addPackage("docs"),
      addPackage("landing"),
      addPackage("sandbox-example", ["core"], "plugins"),
      addPackage("catalog-only", [], "plugins", false),
    ]);
    write("packages/web/index.html", "<html></html>\n");
    write("pnpm-lock.yaml", LOCKFILE);
    base = commit();
  });

  beforeEach(() => {
    // This history belongs only to the disposable fixture. Every changed file is committed.
    git("reset", "--hard", "--quiet", base);
  });

  after(() => rmSync(cwd, { recursive: true, force: true }));

  for (const site of ["docs", "landing"]) {
    it(`a ${site} edit checks affected sites only, without native or packaging jobs`, () => {
      const plan = changed(`packages/${site}/src/index.js`);
      const expected = site === "docs" ? names("docs", "landing") : names("landing");
      assert.deepEqual(new Set(plan.packages), expected);
      assert.deepEqual(members(plan.linux), expected);
      assert.equal(plan.full, false);
      assert.equal(plan.tests, true);
      assert.equal(plan.typecheck, true);
      assert.equal(plan.macos_tests, false);
      assert.equal(plan.windows_tests, false);
      assert.equal(plan.runtime, false);
      assert.equal(plan.packaging, false);
      assert.equal(plan.installer, false);
      assert.equal(plan.e2e, false);
    });
  }

  for (const file of [
    "README.md",
    "README.zh.md",
    "plugins/README.md",
    "plugins/README.zh.md",
    "rfcs/PRFC-0001-fixture.md",
    "scripts/test/ci-plan.test.mjs",
  ]) {
    it(`a ${file} edit selects no package job`, () => {
      const plan = changed(file);
      assert.equal(plan.full, false);
      assert.deepEqual(plan.packages, []);
      for (const matrix of [plan.linux, plan.macos, plan.windows]) {
        assert.deepEqual(matrix.include, []);
      }
      for (const job of [
        "tests",
        "macos_tests",
        "windows_tests",
        "typecheck",
        "plugins",
        "packaging",
        "runtime",
        "installer",
        "e2e",
      ]) {
        assert.equal(plan[job], false, `${job} should not run for ${file}`);
      }
    });
  }

  it("the release's npm script selects npm packaging, which walks it, and no package job", () => {
    const plan = changed("scripts/release-npm.sh");
    assert.equal(plan.full, false);
    assert.deepEqual(plan.packages, []);
    assert.equal(plan.packaging, true);
    for (const job of ["tests", "macos_tests", "windows_tests", "typecheck", "runtime", "e2e"]) {
      assert.equal(plan[job], false, `${job} should not run`);
    }
  });

  it("README and changelog edits beside a landing edit add nothing to the landing's checks", () => {
    write("README.md", "changed\n");
    write("README.zh.md", "changed\n");
    write("changelog/unreleased/2026-10-14-fixture.md", "changed\n");
    const plan = changed("packages/landing/content/blog/fixture.zh.md");
    assert.equal(plan.full, false);
    assert.deepEqual(new Set(plan.packages), names("landing"));
    assert.deepEqual(members(plan.linux), names("landing"));
    assert.equal(plan.tests, true);
    assert.equal(plan.typecheck, true);
    for (const job of [
      "macos_tests",
      "windows_tests",
      "plugins",
      "packaging",
      "runtime",
      "installer",
      "e2e",
    ]) {
      assert.equal(plan[job], false, `${job} should not run`);
    }
  });

  it("a core edit checks transitive consumers and native behavior on every OS", () => {
    const plan = changed("packages/core/src/index.js");
    for (const consumer of [
      "core",
      "server",
      "cli",
      "desktop",
      "ui",
      "web",
      "ui-gallery",
      "landing",
    ]) {
      assert.ok(plan.packages.includes(name(consumer)), `${consumer} consumes core`);
    }
    assert.ok(plan.packages.includes("@penguinharness/sandbox-example"));
    assert.ok(!plan.packages.includes(name("docs")));
    for (const matrix of [plan.linux, plan.macos, plan.windows]) {
      for (const consumer of ["core", "server", "cli", "desktop"]) {
        assert.ok(members(matrix).has(name(consumer)), `${consumer} needs platform coverage`);
      }
    }
    // Sites are covered once on Linux; only a full run takes them to macOS and Windows.
    for (const matrix of [plan.macos, plan.windows]) {
      assert.ok(!matrix.include.some((shard) => shard.shard === "sites"));
    }
    assert.equal(plan.installer, true);
    assert.equal(plan.e2e, true);
  });

  it("a web edit checks its desktop assets and gallery consumers without testing backend code", () => {
    const plan = changed("packages/web/src/index.js");
    assert.deepEqual(new Set(plan.packages), names("web", "ui-gallery", "desktop", "landing"));
    assert.equal(plan.macos_tests, false);
    assert.equal(plan.windows_tests, false);
    assert.equal(plan.runtime, false);
    assert.equal(plan.e2e, true);
    assert.equal(plan.packaging, false);
  });

  it("a core edit tests the desktop on macOS and Windows without building the web bundle", () => {
    const plan = changed("packages/core/src/index.js");
    for (const matrix of [plan.macos, plan.windows]) {
      const desktop = matrix.include.find((shard) => shard.packages.includes(name("desktop")));
      const selected = built(desktop.build);
      assert.ok(selected.has(name("desktop")), "the desktop's tests read its own build");
      assert.ok(selected.has(name("cli")), "and what it imports");
      assert.ok(!selected.has(name("web")), "only a packed app reads the web bundle");
      assert.ok(!selected.has(name("ui")), "nor the UI build that bundle copies");
    }
  });

  it("a server edit runs the server suite in two Linux jobs, each with the coverage of its half", () => {
    const plan = changed("packages/server/src/index.js");
    const halves = plan.linux.include.filter((shard) => shard.packages.includes(name("server")));
    assert.deepEqual(
      halves.map((shard) => [shard.shard, shard.coverage]),
      [
        ["server-1", true],
        ["server-2", true],
      ],
    );
    assert.ok(halves[0].tests.includes("test --shard=1/2 --coverage"));
    assert.ok(halves[1].tests.includes("test --shard=2/2 --coverage"));
  });

  it("a web edit runs the web suite in two halves that build what it imports, not its bundle", () => {
    const plan = changed("packages/web/src/index.js");
    const halves = plan.linux.include.filter((shard) => shard.packages.includes(name("web")));
    assert.deepEqual(
      halves.map((shard) => shard.shard),
      ["web-1", "web-2"],
    );
    assert.deepEqual(halves[0].packages, halves[1].packages);
    assert.ok(halves[0].tests.includes("--shard=1/2"));
    assert.equal(halves[0].tests.replaceAll("--shard=1/2", "--shard=2/2"), halves[1].tests);
    for (const half of halves) {
      const selected = built(half.build);
      assert.ok(selected.has(name("server")), `${half.shard} builds what the web imports`);
      assert.ok(!selected.has(name("web")), `${half.shard} does not build the web bundle`);
      assert.ok(!selected.has(name("ui")), `${half.shard} reads the UI package from source`);
    }
    // The shard testing the gallery builds the gallery and what it imports, not the web's bundle
    // (the gallery's build reads the web's sources) nor the UI build that bundle copies.
    const gallery = plan.linux.include.find((shard) => shard.packages.includes(name("ui-gallery")));
    const selected = built(gallery.build);
    assert.ok(selected.has(name("ui-gallery")));
    assert.ok(selected.has(name("server")), "what the web's sources import is built");
    assert.ok(!selected.has(name("web")));
    assert.ok(!selected.has(name("ui")));
  });

  it("runs the gallery's layout checks in the one Linux job that tests the gallery", () => {
    const withGallery = changed("packages/web/src/index.js");
    assert.deepEqual(
      withGallery.linux.include.filter((shard) => shard.gallery).map((shard) => shard.packages),
      withGallery.linux.include
        .filter((shard) => shard.packages.includes(name("ui-gallery")))
        .map((shard) => shard.packages),
    );
    assert.equal(withGallery.linux.include.filter((shard) => shard.gallery).length, 1);
    git("reset", "--hard", "--quiet", base);
    const withoutGallery = changed("packages/landing/src/index.js");
    assert.ok(!withoutGallery.linux.include.some((shard) => shard.gallery));
  });

  it("without the web among them, ui and cli run whole in one Linux job", () => {
    const plan = changed("packages/cli/src/index.js");
    const shard = plan.linux.include.find((entry) => entry.packages.includes(name("cli")));
    assert.equal(shard.shard, "web-cli");
    assert.ok(!shard.tests.includes("--shard"));
  });

  it("typecheck builds what the checked packages import, never a site bundle or the UI build", () => {
    const plan = changed("packages/web/src/index.js");
    const selected = built(plan.typecheck_build);
    for (const dependency of ["core", "server", "cli"]) {
      assert.ok(selected.has(name(dependency)), `${dependency} is imported by a checked package`);
    }
    for (const leaf of ["web", "ui-gallery", "docs", "landing", "desktop", "ui"]) {
      assert.ok(!selected.has(name(leaf)), `${leaf} is never built for a typecheck`);
    }
  });

  it("changing the inline web boot script selects the UI suite that checks its copy", () => {
    const plan = changed("packages/web/index.html");
    assert.ok(members(plan.linux).has(name("ui")));
  });

  it("a new consumer of an implicit dependency is checked without adding another manual edge", () => {
    addPackage("site-consumer", ["landing"]);
    const consumerBase = commit();
    write("packages/docs/src/index.js", "changed\n");
    commit();
    const plan = planCI({ cwd, base: consumerBase });
    assert.ok(members(plan.linux).has(name("site-consumer")));
  });

  it("an undeclared plugin's file change checks the catalog readers and their consumers", () => {
    const plan = changed("plugins/catalog-only/src/index.js");
    assert.equal(plan.plugins, true);
    assert.ok(plan.packages.includes("@penguinharness/catalog-only"));
    for (const reader of ["core", "docs", "landing", "server", "ui-gallery"]) {
      assert.ok(members(plan.linux).has(name(reader)), `${reader} reads plugin catalogs`);
    }
    assert.ok(
      !members(plan.linux).has("@penguinharness/catalog-only"),
      "content has no test script",
    );
  });

  it("a rename between existing packages checks both the old and new owners", () => {
    renameSync(join(cwd, "packages/landing/src/index.js"), join(cwd, "packages/docs/src/moved.js"));
    commit();
    assert.deepEqual(new Set(planCI({ cwd, base }).packages), names("landing", "docs"));
  });

  it("a deleted source file still selects the package that owned it", () => {
    rmSync(join(cwd, "packages/landing/src/index.js"));
    commit();
    const plan = planCI({ cwd, base });
    assert.equal(plan.full, false);
    assert.deepEqual(new Set(plan.packages), names("landing"));
  });

  for (const operation of ["delete", "move"]) {
    it(`a whole-package ${operation} cannot silently lose its old consumers`, () => {
      if (operation === "delete") rmSync(join(cwd, "packages/docs"), { recursive: true });
      else renameSync(join(cwd, "packages/docs"), join(cwd, "packages/renamed-docs"));
      commit();
      const plan = planCI({ cwd, base });
      const expected = new Set(allPackages);
      if (operation === "delete") expected.delete(name("docs"));
      assert.equal(plan.full, true);
      assert.deepEqual(new Set(plan.packages), expected);
    });
  }

  /** Commits the fixture lockfile with `edit` applied, which must change it, and plans. */
  const lockChanged = (edit) => {
    const next = edit(LOCKFILE);
    assert.notEqual(next, LOCKFILE, "the edit changes the lockfile");
    write("pnpm-lock.yaml", next);
    commit();
    return planCI({ cwd, base });
  };

  it("a lockfile change inside one package's own entry checks that package, not the workspace", () => {
    // The landing starts to depend on a version the lockfile already holds: its entry alone moves.
    const plan = lockChanged((lock) =>
      lock.replace(
        "        version: 9.0.0\n",
        "        version: 9.0.0\n      tiny:\n        specifier: ^1.0.0\n        version: 1.0.0\n",
      ),
    );
    assert.equal(plan.full, false);
    assert.deepEqual(new Set(plan.packages), names("landing"));
    assert.equal(plan.macos_tests, false);
    assert.equal(plan.windows_tests, false);
    assert.equal(plan.runtime, false);
    assert.equal(plan.packaging, true, "the npm path builds with what the lockfile resolves");
  });

  it("a version the desktop resolves packs the desktop app too", () => {
    const plan = lockChanged((lock) => lock.replace("sha512-electron}", "sha512-electron-2}"));
    assert.equal(plan.full, false);
    assert.ok(plan.packages.includes(name("desktop")));
    assert.equal(plan.runtime, true);
  });

  it("a changed version checks exactly the packages that resolve it, and their dependents", () => {
    // tiny's tarball changes: the server reaches it through express; core and the landing do not.
    const plan = lockChanged((lock) => lock.replace("sha512-tiny}", "sha512-tiny-republished}"));
    assert.equal(plan.full, false);
    assert.ok(plan.packages.includes(name("server")));
    assert.ok(plan.packages.includes(name("cli")), "the server's dependents are checked too");
    assert.ok(!plan.packages.includes(name("core")), "core resolves nothing that changed");
    assert.ok(!members(plan.linux).has(name("core")));
  });

  it("a version only a plugin resolves checks the plugin and the packages that read plugins", () => {
    const plan = lockChanged((lock) => lock.replace("sha512-koffi}", "sha512-koffi-republished}"));
    assert.equal(plan.full, false);
    assert.ok(plan.packages.includes("@penguinharness/sandbox-example"));
    for (const reader of ["core", "server", "docs", "landing"]) {
      assert.ok(plan.packages.includes(name(reader)), `${reader} reads the plugins`);
    }
  });

  it("a lockfile change to the root's toolchain validates the whole workspace", () => {
    const plan = lockChanged(EVERY_PACKAGE.get("the root's toolchain"));
    assert.equal(plan.full, true);
    assert.deepEqual(new Set(plan.packages), allPackages);
  });

  for (const file of [
    "tsconfig.base.json",
    "scripts/new-build-input.mjs",
    "unknown-root-input.txt",
  ]) {
    it(`a changed ${file} validates the whole workspace`, () => {
      const plan = changed(file);
      assert.equal(plan.full, true);
      assert.deepEqual(new Set(plan.packages), allPackages);
      assert.equal(plan.packaging, true);
      assert.equal(plan.runtime, true);
    });
  }

  for (const comparison of [undefined, "refs/heads/does-not-exist"]) {
    it(`${comparison === undefined ? "an absent" : "an unusable"} comparison base validates all packages`, () => {
      const plan = planCI({ cwd, base: comparison });
      assert.equal(plan.full, true);
      assert.deepEqual(new Set(plan.packages), allPackages);
    });
  }

  for (const onlyChangelog of [false, true]) {
    it(`${onlyChangelog ? "changelog-only changes" : "an unchanged tree"} need no package jobs`, () => {
      const plan = onlyChangelog
        ? changed("changelog/unreleased/2026-10-14-fixture.md")
        : planCI({ cwd, base });
      assert.equal(plan.full, false);
      assert.deepEqual(plan.packages, []);
      for (const job of [
        "tests",
        "macos_tests",
        "windows_tests",
        "typecheck",
        "plugins",
        "packaging",
        "runtime",
        "installer",
        "e2e",
      ]) {
        assert.equal(plan[job], false, `${job} should not run`);
      }
    });
  }

  it("a newly added package gets tests without being named in the planner", () => {
    const added = addPackage("future-package");
    commit();
    const plan = planCI({ cwd, base });
    assert.equal(plan.full, false);
    assert.deepEqual(new Set(plan.packages), new Set([added]));
    assert.ok(members(plan.linux).has(added));
  });

  it("full validation checks every package including additions on every OS and enables release gates", () => {
    write("README.md", "changed\n");
    const added = addPackage("future-package");
    commit();
    const plan = planCI({ cwd, base: git("rev-parse", "HEAD"), full: true });
    const expected = new Set([...allPackages, added]);
    assert.deepEqual(new Set(plan.packages), expected);
    expected.delete("@penguinharness/catalog-only");
    for (const matrix of [plan.linux, plan.macos, plan.windows]) {
      assert.deepEqual(members(matrix), expected);
    }
    for (const [matrix, siteShards] of [
      [plan.macos, ["sites"]],
      [plan.windows, ["sites-1", "sites-2"]],
    ]) {
      const sites = matrix.include.filter((shard) => shard.shard.startsWith("sites"));
      assert.deepEqual(
        sites.map((shard) => shard.shard),
        siteShards,
      );
      for (const shard of sites) {
        assert.deepEqual(
          new Set(shard.packages),
          names("ui", "web", "ui-gallery", "docs", "landing"),
        );
      }
      const rest = matrix.include.find((shard) => shard.shard === "rest");
      assert.ok(
        !rest.packages.some((pkg) => sites[0].packages.includes(pkg)),
        "each site runs once",
      );
    }
    // Every Windows server shard names the same count, and the shards are exactly 1..count.
    const serverShards = plan.windows.include
      .filter((shard) => shard.shard.startsWith("server-"))
      .map((shard) => /--shard=(\d+)\/(\d+)/.exec(shard.tests).slice(1).map(Number));
    const count = serverShards[0][1];
    assert.ok(count > 1);
    assert.deepEqual(
      serverShards,
      Array.from({ length: count }, (_, i) => [i + 1, count]),
    );
    for (const job of [
      "tests",
      "macos_tests",
      "windows_tests",
      "typecheck",
      "plugins",
      "packaging",
      "runtime",
      "installer",
      "e2e",
    ]) {
      assert.equal(plan[job], true, `${job} is required before release`);
    }
  });
});

// The planner validates the whole workspace on the reader's `whole`, which the test above walks
// once; the reader's other reasons for it are read from the reader itself, without a workspace.
describe("lockfile changes that reach every package", () => {
  for (const [change, edit] of [...EVERY_PACKAGE].filter(([c]) => c !== "the root's toolchain")) {
    it(`a change to ${change} names no subset of packages`, () => {
      const answer = lockfileImporters(LOCKFILE, edit(LOCKFILE));
      assert.ok(answer.whole, JSON.stringify(answer));
      assert.equal(answer.importers, undefined);
    });
  }
  it("an unchanged lockfile reaches no package", () => {
    assert.deepEqual(lockfileImporters(LOCKFILE, LOCKFILE), { importers: [] });
  });
});
