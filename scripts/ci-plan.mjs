#!/usr/bin/env node
// pnpm owns the workspace/dependency graph. This file adds CI shard placement and the
// file-based dependencies that package.json cannot describe (bundled web assets and catalogs).
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const prefix = "@prismshadow/penguin-";
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const command = (names, task) =>
  `pnpm ${names.map((name) => `--filter ${quote(name)}`).join(" ")} ${task}`;

export function planCI({ cwd = process.cwd(), base, full = false } = {}) {
  cwd = realpathSync(cwd);
  const run = (bin, args) =>
    execFileSync(bin, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const list = (filters = []) =>
    JSON.parse(run("pnpm", [...filters, "list", "--recursive", "--depth", "-1", "--json"]));
  const projects = list().filter((project) => resolve(project.path) !== resolve(cwd));
  for (const project of projects) {
    project.dir = relative(cwd, project.path).replaceAll("\\", "/");
    project.scripts =
      JSON.parse(readFileSync(`${project.path}/package.json`, "utf8")).scripts ?? {};
  }
  const byName = new Map(projects.map((project) => [project.name, project]));
  let files = [];
  let reason = full ? "Full validation requested" : "Changed packages and their dependents";
  if (!full) {
    try {
      if (!base) throw new Error("No successful comparison base");
      // No rename detection: moving a file affects both its old and new package.
      files = run("git", ["diff", "--name-only", "--no-renames", "-z", base, "HEAD"])
        .split("\0")
        .filter(Boolean);
    } catch {
      full = true;
      reason = "No usable comparison base; validating the whole workspace";
    }
  }
  const seeds = new Set();
  const add = (name) => {
    if (byName.has(name)) seeds.add(name);
  };
  for (const file of files) {
    const owner = projects.find((project) => file.startsWith(`${project.dir}/`));
    if (owner) add(owner.name);
    else if (/^(changelog\/|\.agents\/|\.github\/[^/]+\.md$|CHANGELOG(?:\.zh)?\.md$)/.test(file)) {
      continue;
    } else if (/^(README(?:\.zh)?\.md|plugins\/README(?:\.zh)?\.md)$/.test(file)) {
      // core's plugin-catalog tests read the root README tables.
      add(`${prefix}core`);
    } else {
      // Shared scripts/config/lockfile, deleted packages, and unknown paths fail open
      // to full validation rather than silently omitting their consumers.
      full = true;
      reason = `Shared or unclassified input changed: ${file}`;
    }
    if (file.startsWith("plugins/")) {
      // These tests enumerate the on-disk library, including plugins not imported by core.
      for (const name of ["core", "docs", "landing"]) add(`${prefix}${name}`);
    }
    if (file === "packages/web/index.html") add(`${prefix}ui`);
  }
  const affected = new Set(
    full
      ? projects.map((project) => project.name)
      : seeds.size
        ? list([...seeds].flatMap((name) => ["--filter", `...${name}`])).map((p) => p.name)
        : [],
  );
  affected.delete(JSON.parse(readFileSync(`${cwd}/package.json`, "utf8")).name);
  const nativeAffected = new Set(affected);
  // Expand implicit consumers through pnpm too, so future packages depending on
  // those consumers participate without another hand-maintained dependency list.
  while (true) {
    const implicit = new Set();
    // Electron carries web/dist via a file mapping, not an npm dependency.
    if (affected.has(`${prefix}web`)) implicit.add(`${prefix}desktop`);
    // Landing imports gallery/UI helpers and docs navigation, and its tests read
    // core's builtin benchmark catalog.
    if (["core", "docs", "ui", "ui-gallery"].some((name) => affected.has(`${prefix}${name}`))) {
      implicit.add(`${prefix}landing`);
    }
    const added = [...implicit].filter((name) => byName.has(name) && !affected.has(name));
    if (!added.length) break;
    for (const project of list(added.flatMap((name) => ["--filter", `...${name}`]))) {
      affected.add(project.name);
    }
  }
  const selected = projects.filter((project) => affected.has(project.name));
  const has = (name) => affected.has(`${prefix}${name}`);
  const build = (names) => {
    const builds = new Set(names.map((name) => `${name}...`));
    if (names.includes(`${prefix}desktop`)) builds.add(`${prefix}web...`);
    return [...builds].join(",");
  };
  const shard = (name, names, extra = {}) => ({
    shard: name,
    packages: names,
    build: build(names),
    tests: command(names, "test"),
    ...extra,
  });
  const tests = selected.filter((p) => p.scripts.test).map((p) => p.name);
  const core = tests.filter((name) => name === `${prefix}core`);
  const server = tests.filter((name) => name === `${prefix}server`);
  const webCli = tests.filter((name) => ["web", "ui", "cli"].some((p) => name === `${prefix}${p}`));
  const rest = tests.filter((name) => !core.includes(name) && !server.includes(name));
  const linuxRest = rest.filter((name) => !webCli.includes(name));
  // Browser/static-site behavior is covered once on Linux. Native runtime packages
  // still run on every OS; release validation retains the complete three-OS suite.
  const nativeRest = full
    ? rest
    : rest.filter(
        (name) =>
          nativeAffected.has(name) &&
          !["web", "ui", "ui-gallery", "docs", "landing"].some((p) => name === `${prefix}${p}`),
      );
  const linux = [
    shard("core", core),
    shard("server", server),
    shard("web-cli", webCli),
    shard("rest", linuxRest, { must_run: "sandbox-bwrap,sandbox-dsh" }),
  ].filter((s) => s.packages.length);
  // Collect coverage during the existing Linux run, never in a duplicate test job.
  // These three packages configure V8 to include untested source files as well.
  for (const entry of linux) {
    const covered = entry.packages.filter((name) =>
      ["core", "server", "web"].some((p) => name === `${prefix}${p}`),
    );
    const ordinary = entry.packages.filter((name) => !covered.includes(name));
    entry.coverage = covered.length > 0;
    entry.tests = [
      ...covered.map((name) =>
        command(
          [name],
          "test --coverage --coverage.reporter=text-summary --coverage.reporter=json-summary --coverage.reporter=lcov",
        ),
      ),
      ...(ordinary.length ? [command(ordinary, "test")] : []),
    ].join(" && ");
  }
  const macos = [
    shard("core", core),
    shard("server", server),
    shard("rest", nativeRest, {
      smoke: nativeAffected.has(`${prefix}desktop`),
      must_run: "sandbox-seatbelt,sandbox-dsh",
    }),
  ].filter((s) => s.packages.length);
  const windows = [
    shard("core", core),
    ...[1, 2, 3].map((i) =>
      shard(`server-${i}`, server, {
        tests: command(server, `exec vitest run --shard=${i}/3`),
      }),
    ),
    shard("rest", nativeRest, { must_run: "sandbox-dsh" }),
  ].filter((s) => s.packages.length);
  const types = selected.filter((p) => p.scripts.typecheck).map((p) => p.name);
  return {
    full,
    reason,
    packages: selected.map((p) => p.name),
    tests: tests.length > 0,
    macos_tests: macos.length > 0,
    windows_tests: windows.length > 0,
    linux: { include: linux },
    macos: { include: macos },
    windows: { include: windows },
    typecheck: types.length > 0,
    typecheck_build: build(types),
    typecheck_command: types.length ? command(types, "typecheck") : "",
    plugins: full || files.some((file) => file.startsWith("plugins/")),
    packaging:
      full ||
      files.some(
        (file) =>
          /^(packages|plugins)\/[^/]+\/(package\.json|tsup\.config\.[^/]+|vite\.config\.[^/]+)$/.test(
            file,
          ) ||
          /^(packages\/core\/src\/index\.ts|packages\/server\/src\/plugin\/|packages\/(core|server|cli)\/test\/(build-info|version|deploy-same-build|plugin-registry)\.test\.ts)/.test(
            file,
          ),
      ),
    installer: full || has("cli") || files.some((file) => /(^|\/)install\.(sh|ps1)$/.test(file)),
    runtime: full || files.some((file) => file.startsWith("packages/desktop/")),
    runtime_matrix: {
      include: [
        { os: "ubuntu-latest", platform: "--linux" },
        { os: "macos-latest", platform: "--mac" },
        { os: "windows-latest", platform: "--win" },
      ],
    },
    e2e: full || has("web") || has("server"),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const plan = planCI({ base: process.env.CI_BASE, full: process.env.CI_FULL === "true" });
  console.log(JSON.stringify(plan, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    for (const [key, value] of Object.entries(plan)) {
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `${key}=${typeof value === "string" ? value.replaceAll("\n", " ").replaceAll("\r", " ") : JSON.stringify(value)}\n`,
      );
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## CI scope\n\n${plan.reason}\n\n${plan.packages.length ? plan.packages.map((name) => `- \`${name}\``).join("\n") : "No package tasks are needed."}\n`,
    );
  }
}
