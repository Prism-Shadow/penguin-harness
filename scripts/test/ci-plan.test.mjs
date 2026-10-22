/**
 * CI selection against a real Git history and pnpm workspace, without installing dependencies.
 *
 * - Given a docs or landing edit, when planning CI, then only affected sites run, on Linux.
 * - Given a catalog README edit, when planning CI, then only the README catalog check runs.
 * - Given README and landing edits together, when planning CI, then each keeps its own checks.
 * - Given README and core edits together, when planning CI, then core covers the catalog once.
 * - Given a core edit, when planning CI, then its transitive consumers and native OS tests run.
 * - Given a web edit, when planning CI, then the gallery, landing and desktop are checked too.
 * - Given a web edit, when planning CI, then the web suite runs in two Linux jobs that each run
 *   half of every package's files and build what the web imports, not the web's own bundle;
 *   without the web among them, ui and cli run whole in one job.
 * - Given any typecheck, when planning CI, then its build selects the checked packages'
 *   dependencies and never a site bundle.
 * - Given the gallery among the tested packages, when planning CI, then the one Linux job that
 *   tests it also runs its browser layout checks; without it, no job does.
 * - Given the web's inline boot script changes, when planning CI, then UI's copy guard runs.
 * - Given a plugin without declared consumers changes, when planning CI, then catalog readers run.
 * - Given a file moves between packages, when planning CI, then both owners are checked.
 * - Given a source file is deleted, when planning CI, then its surviving package is checked.
 * - Given a whole package disappears or moves, when planning CI, then all remaining packages run.
 * - Given a shared config, lockfile or unknown root input changes, when planning CI, then all run.
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
import { planCI } from "../ci-plan.mjs";

const name = (short) => `@prismshadow/penguin-${short}`;
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
      assert.equal(plan.readme, false);
    });
  }

  for (const file of ["README.md", "README.zh.md", "plugins/README.md", "plugins/README.zh.md"]) {
    it(`a ${file} edit checks the catalog without selecting core or its consumers`, () => {
      const plan = changed(file);
      assert.equal(plan.readme, true);
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

  it("README, changelog and landing edits keep the catalog check separate from site checks", () => {
    write("README.md", "changed\n");
    write("README.zh.md", "changed\n");
    write("changelog/unreleased/2026-10-14-fixture.md", "changed\n");
    const plan = changed("packages/landing/content/blog/fixture.zh.md");
    assert.equal(plan.readme, true);
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

  it("README and core edits use the core suite without a duplicate catalog job", () => {
    write("README.md", "changed\n");
    const plan = changed("packages/core/src/index.js");
    assert.equal(plan.readme, false);
    for (const matrix of [plan.linux, plan.macos, plan.windows]) {
      assert.ok(members(matrix).has(name("core")));
      assert.ok(members(matrix).has(name("server")));
    }
    assert.equal(plan.installer, true);
    assert.equal(plan.e2e, true);
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
    // The package graph does not declare desktop's web/dist payload, but its build must include it.
    const desktopBuild = plan.linux.include.find((shard) =>
      shard.packages.includes(name("desktop")),
    );
    assert.ok(desktopBuild.build.includes(`${name("web")}...`));
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
    }
    // Desktop's shard still carries the web bundle it packs.
    const desktop = plan.linux.include.find((shard) => shard.packages.includes(name("desktop")));
    assert.ok(built(desktop.build).has(name("web")));
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

  it("typecheck builds what the checked packages import, never a site bundle", () => {
    const plan = changed("packages/web/src/index.js");
    const selected = built(plan.typecheck_build);
    for (const dependency of ["core", "server", "ui", "cli"]) {
      assert.ok(selected.has(name(dependency)), `${dependency} is imported by a checked package`);
    }
    for (const leaf of ["web", "ui-gallery", "docs", "landing", "desktop"]) {
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

  for (const file of [
    "tsconfig.base.json",
    "pnpm-lock.yaml",
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
        "readme",
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
    assert.equal(plan.readme, false);
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
