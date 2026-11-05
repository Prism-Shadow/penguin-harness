/**
 * Third-party notices for an installed `node_modules` tree: one section per package, with its
 * license id, where it comes from and its full license text. The builtin plugin prefix
 * (scripts/build-plugins.mjs) redistributes the native dependencies of the plugins and what they
 * depend on (the DSH chain, koffi), and the MIT and BSD licenses of those packages require their
 * notice to travel with every copy.
 *
 * A package that ships no license file may borrow the text of the package it is a platform build
 * of — the one that lists it in `optionalDependencies` at the same version, same author and same
 * license id (koffi's `@koromix/koffi-<os>-<cpu>` packages). Any other package without license
 * text fails the build: an incomplete notice is not shipped.
 */
import fs from "node:fs";
import path from "node:path";

const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;

/**
 * Every package under the `node_modules` directory `dir`, nested ones included, as the plain
 * records thirdPartyNotices() takes. Reads files; the formatting is left to the pure function.
 */
export function readVendoredPackages(dir, into = []) {
  for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (entry.startsWith(".")) continue;
    const dirs = entry.startsWith("@")
      ? fs.readdirSync(path.join(dir, entry)).map((sub) => path.join(dir, entry, sub))
      : [path.join(dir, entry)];
    for (const pkg of dirs) {
      const manifest = JSON.parse(fs.readFileSync(path.join(pkg, "package.json"), "utf8"));
      const licenseFile = fs
        .readdirSync(pkg)
        .filter((f) => LICENSE_FILE.test(f))
        .sort()[0];
      into.push({
        name: manifest.name,
        version: manifest.version,
        license: manifest.license,
        author: personName(manifest.author),
        repository: manifest.repository,
        homepage: manifest.homepage,
        optionalDependencies: manifest.optionalDependencies,
        licenseFile,
        licenseText: licenseFile ? fs.readFileSync(path.join(pkg, licenseFile), "utf8") : undefined,
      });
      readVendoredPackages(path.join(pkg, "node_modules"), into);
    }
  }
  return into;
}

/** `author` as package.json writes it (`"Name <mail> (url)"` or `{ name }`), reduced to the name. */
function personName(author) {
  const raw = typeof author === "object" && author ? author.name : author;
  return typeof raw === "string" ? raw.replace(/\s*[<(].*$/, "").trim() || undefined : undefined;
}

/** A repository field (string or `{ url, directory }`) as a browsable URL, if it names one. */
function repositoryUrl(repository) {
  const raw = typeof repository === "string" ? repository : repository?.url;
  if (!raw) return undefined;
  const url = raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
  const dir = typeof repository === "object" ? repository.directory : undefined;
  return dir ? `${url}/tree/HEAD/${dir}` : url;
}

/** The package that lists `pkg` as an optional platform build of itself and may lend it text. */
function platformParent(pkg, packages) {
  return packages.find(
    (p) =>
      p !== pkg &&
      p.licenseText?.trim() &&
      p.optionalDependencies?.[pkg.name] === pkg.version &&
      p.version === pkg.version &&
      p.license === pkg.license &&
      p.author !== undefined &&
      p.author === pkg.author,
  );
}

/** A code fence longer than any backtick run inside `text`. */
function fenceFor(text) {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(longest + 1);
}

/**
 * The notices document for `packages` (records as readVendoredPackages() returns them), sorted
 * by name and version so the same tree always yields the same bytes. `carrier` is the package
 * that ships them and `location` where. Throws, naming every such package, when any has no
 * license text of its own or borrowed.
 */
export function thirdPartyNotices(packages, { carrier, location }) {
  const sorted = [...packages].sort((a, b) =>
    a.name === b.name ? (a.version < b.version ? -1 : 1) : a.name < b.name ? -1 : 1,
  );
  const missing = [];
  const sections = sorted.map((pkg) => {
    const id = `${pkg.name}@${pkg.version}`;
    const lines = [`## ${id}`, "", `- License: ${pkg.license ?? "(none declared)"}`];
    const repo = repositoryUrl(pkg.repository);
    if (repo) lines.push(`- Repository: ${repo}`);
    if (pkg.homepage) lines.push(`- Homepage: ${pkg.homepage}`);
    lines.push("");
    let text = pkg.licenseText?.trim() ? pkg.licenseText : undefined;
    if (text) {
      lines.push(`License text from its \`${pkg.licenseFile}\`:`);
    } else {
      const parent = platformParent(pkg, sorted);
      if (!parent) {
        missing.push(id);
        return "";
      }
      text = parent.licenseText;
      lines.push(
        `This package ships no license file. License text from ${parent.name}@${parent.version}, ` +
          "of which this is the prebuilt binary package (same author, same license):",
      );
    }
    const body = text.replace(/\r\n?/g, "\n").trimEnd();
    const fence = fenceFor(body);
    lines.push("", `${fence}text`, body, fence);
    return lines.join("\n");
  });
  if (missing.length > 0) {
    throw new Error(
      `third-party notices: no license text found for ${missing.join(", ")} — the package ships no LICENSE/LICENCE/COPYING file and is not a platform build of a package that does`,
    );
  }
  const header = [
    "# Third-party notices",
    "",
    `\`${carrier}\` carries these ${sorted.length} third-party packages in \`${location}\`, each under its own license, reproduced below.`,
    "",
    ...sorted.map((p) => `- ${p.name}@${p.version} (${p.license ?? "(none declared)"})`),
  ].join("\n");
  return `${[header, ...sections].join("\n\n")}\n`;
}
