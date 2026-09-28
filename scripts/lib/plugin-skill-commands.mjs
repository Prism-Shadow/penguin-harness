/**
 * The `penguin` command surface a shipped skill names, measured against the CLI registration of
 * the same revision.
 *
 * A skill under `plugins/<plugin>/skills/<name>/SKILL.md` is, above all, instructions to run
 * `penguin` commands, and the command surface belongs to `packages/cli/src/commands/*.ts` at the
 * same revision — a skill naming a command the CLI does not register is a broken instruction,
 * invisible until someone follows it. This module is that measurement, in one copy, for its two
 * consumers:
 *
 * - `scripts/check-plugin-skills.mjs` — the tree guard's `commands` rule, over every skill of
 *   every plugin;
 * - `plugins/agent-company/test/skills.test.mjs` — the company plugin's own suite, over its seven
 *   skills, which takes the registration reader from here.
 *
 * The registration is read statically (the CLI's `commander` is not installed where these run):
 * commander `X.command("name …")` declarations whose receiver `X` is `program` or a variable that
 * already holds a command path, across files — a group registered in one function and extended in
 * another (`registerX(server, t)`) binds the callee's parameter at the call site — resolved to a
 * fixed point. A template-literal registration (`proposal.command(\`${name} <number>\`)` inside a
 * helper) is expanded from the string literals the enclosing function's call sites pass for the
 * interpolated parameter. A registration this reader cannot trace is an error, never a skip:
 * silently shrinking the surface would turn a broken instruction into a passing check.
 *
 * What it does not measure:
 * - an invocation written in prose rather than inside a fenced block or an inline code span;
 * - flags: `penguin org channel --nope` resolves to `org channel` and passes, since options are
 *   not part of the registration read here;
 * - a skill that names no `penguin` command at all — there is nothing to resolve, so a consumer
 *   has to make such skills visible itself;
 * - another revision: a command that appears or disappears elsewhere is not knowable from this
 *   revision's registration, which is the only one read;
 * - relative links, stale paths and `reference/` files.
 *
 * Node builtins only: the company plugin's `package.json` is a published manifest without
 * `devDependencies`, and the guard runs before any install.
 */
import fs from "node:fs";
import path from "node:path";

const IDENT = "[A-Za-z_$][\\w$]*";

/** `const x = recv.command("…")` / `recv.command(\`…\`)`: 1 declared, 2 receiver, 4 quoted, 5 template. */
const COMMAND_DECLARATION = new RegExp(
  `(?:const\\s+(${IDENT})\\s*=\\s*)?(${IDENT})\\s*\\.\\s*command\\(\\s*(?:(["'])([^"']*)\\3|\`([^\`]*)\`)`,
  "g",
);
const REGISTER_FUNCTION = new RegExp(
  `export function (register[A-Za-z0-9_]*)\\s*\\(\\s*(${IDENT})\\s*:`,
  "g",
);
const REGISTER_CALL = new RegExp(`(register[A-Za-z0-9_]*)\\s*\\(\\s*(${IDENT})\\s*,`, "g");

/** A named function a template registration can sit in: `function f(…)` or `const f = (…) =>`. */
const FUNCTION_HEADER = new RegExp(
  `function\\s+(${IDENT})\\s*\\(([^)]*)\\)|(?:const|let)\\s+(${IDENT})\\s*=\\s*(?:async\\s*)?\\(([^)]*)\\)\\s*(?::[^=;{]*)?=>`,
  "g",
);
const INTERPOLATION = /\$\{\s*([^}]*?)\s*\}/g;

/** Index just past a quoted string starting at `start`, or -1 when it does not close. */
function skipString(source, start) {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") i++;
    else if (source[i] === quote) return i + 1;
    else if (source[i] === "\n") return -1;
  }
  return -1;
}

/**
 * The index of the bracket closing the one at `open` (`{` or `(`), skipping strings, comments and
 * template text (a `${…}` inside a template is code again). -1 when the scan cannot tell — the
 * caller then reports the registration as untraceable rather than guessing a span.
 */
function closingBracket(source, open) {
  const pairs = { "{": "}", "(": ")", "[": "]" };
  const stack = [source[open]];
  let i = open + 1;
  while (i < source.length) {
    const top = stack[stack.length - 1];
    const c = source[i];
    if (top === "`") {
      if (c === "\\") i += 2;
      else if (c === "`") (stack.pop(), i++);
      else if (c === "$" && source[i + 1] === "{") (stack.push("${"), (i += 2));
      else i++;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      i = source.indexOf("\n", i);
      if (i < 0) return -1;
    } else if (c === "/" && source[i + 1] === "*") {
      i = source.indexOf("*/", i + 2);
      if (i < 0) return -1;
      i += 2;
    } else if (c === '"' || c === "'") {
      i = skipString(source, i);
      if (i < 0) return -1;
    } else if (c === "`") {
      stack.push("`");
      i++;
    } else if (c in pairs) {
      stack.push(c);
      i++;
    } else if (c === "}" || c === ")" || c === "]") {
      const opened = stack.pop();
      const expected = opened === "${" ? "}" : pairs[opened];
      if (c !== expected) return -1;
      if (stack.length === 0) return i;
      i++;
    } else i++;
  }
  return -1;
}

/** The top-level comma-separated pieces of `source.slice(from, to)`, trimmed. */
function splitArguments(source, from, to) {
  const args = [];
  let start = from;
  let i = from;
  while (i < to) {
    const c = source[i];
    if (c === '"' || c === "'") {
      i = skipString(source, i);
      if (i < 0) return null;
    } else if (c === "`" || c === "(" || c === "{" || c === "[") {
      const close = c === "`" ? templateEnd(source, i) : closingBracket(source, i);
      if (close < 0) return null;
      i = close + 1;
    } else if (c === ",") {
      args.push(source.slice(start, i).trim());
      start = ++i;
    } else i++;
  }
  const last = source.slice(start, to).trim();
  if (last !== "" || args.length > 0) args.push(last);
  return args;
}

/** Index of the backtick closing the template literal opened at `start`. */
function templateEnd(source, start) {
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") i++;
    else if (source[i] === "`") return i;
    else if (source[i] === "$" && source[i + 1] === "{") {
      const close = closingBracket(source, i + 1);
      if (close < 0) return -1;
      i = close;
    }
  }
  return -1;
}

/** The value of a plain string literal (`"x"`, `'x'`, or a template without `${}`), else null. */
function stringLiteral(text) {
  const match = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1$/s.exec(text);
  if (match === null) return null;
  if (match[1] === "`" && match[2].includes("${")) return null;
  return match[2].replace(/\\(.)/g, "$1");
}

/** The parameter names of a parameter list: `name: string, n?: number = 1` → ["name", "n"]. */
function parameterNames(list) {
  return list
    .split(",")
    .map((param) => new RegExp(`^\\s*(?:\\.\\.\\.)?(${IDENT})`).exec(param)?.[1])
    .filter((name) => name !== undefined);
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

/**
 * Every named function of every file, with its parameters and its body span, for binding a
 * template registration's interpolations to the function it sits in.
 */
function functionsOf(source) {
  const functions = [];
  for (const match of source.matchAll(FUNCTION_HEADER)) {
    const name = match[1] ?? match[3];
    const params = parameterNames(match[2] ?? match[4]);
    const after = match.index + match[0].length;
    const brace = source.slice(after).search(/\S/);
    if (brace < 0 || source[after + brace] !== "{") continue;
    const open = after + brace;
    const close = closingBracket(source, open);
    functions.push({ name, params, start: match.index, open, close });
  }
  return functions;
}

/**
 * The raw registration strings a template literal stands for: each interpolation must be a
 * parameter of the innermost enclosing named function, and every call site of that function must
 * pass a string literal at that parameter's position. Returns `{ values }` or `{ untraced }`.
 */
function expandTemplate(template, at, file, sources, functionsByFile, relative) {
  const idents = [...template.matchAll(INTERPOLATION)].map((match) => match[1]);
  const where = `${relative(file)}:${lineOf(sources.get(file), at)}`;
  const enclosing = functionsByFile
    .get(file)
    .filter((fn) => fn.open < at && fn.close > at)
    .sort((a, b) => b.start - a.start);
  const owners = idents.map((ident) =>
    new RegExp(`^${IDENT}$`).test(ident)
      ? enclosing.find((fn) => fn.params.includes(ident))
      : undefined,
  );
  if (owners.some((owner) => owner === undefined) || new Set(owners).size !== 1) {
    return {
      untraced:
        `${where}: .command(\`${template}\`) interpolates ${idents.map((i) => `\${${i}}`).join(", ")}, ` +
        "which is not a parameter of one enclosing named function",
    };
  }
  const owner = owners[0];
  const positions = idents.map((ident) => owner.params.indexOf(ident));

  const values = [];
  const callPattern = new RegExp(`(?<![\\w$.])${owner.name.replace(/\$/g, "\\$")}\\s*\\(`, "g");
  for (const [callFile, source] of sources) {
    for (const call of source.matchAll(callPattern)) {
      if (callFile === file && call.index === owner.start) continue;
      if (/function\s+$/.test(source.slice(Math.max(0, call.index - 20), call.index))) continue;
      const open = call.index + call[0].length - 1;
      const close = closingBracket(source, open);
      const args = close < 0 ? null : splitArguments(source, open + 1, close);
      const site = `${relative(callFile)}:${lineOf(source, call.index)}`;
      const bound = args === null ? [null] : positions.map((p) => stringLiteral(args[p] ?? ""));
      if (bound.some((value) => value === null)) {
        return {
          untraced:
            `${where}: .command(\`${template}\`) — the call ${owner.name}(…) at ${site} ` +
            "does not pass a string literal for the interpolated parameter",
        };
      }
      let raw = template;
      idents.forEach((ident, k) => {
        raw = raw.replace(new RegExp(`\\$\\{\\s*${ident.replace(/\$/g, "\\$")}\\s*\\}`), bound[k]);
      });
      values.push(raw);
    }
  }
  if (values.length === 0) {
    return {
      untraced: `${where}: .command(\`${template}\`) sits in ${owner.name}, which nothing calls`,
    };
  }
  return { values };
}

/**
 * The commands the CLI under `cliCommandsDir` registers, as full paths (`"org ticket block"`)
 * with the number of positional arguments the registration declares (`.command("block
 * <ticket_id>")` → 1, `.command("ls")` → 0). `options.root` only shortens the paths in error
 * messages. Throws when the directory holds no command module, or when any registration cannot be
 * traced — the error's `untraced` array names each one.
 */
export function readCliCommands(cliCommandsDir, options = {}) {
  const root = options.root ?? process.cwd();
  const relative = (file) =>
    path.relative(root, path.join(cliCommandsDir, file)).split(path.sep).join("/");
  let files;
  try {
    files = fs
      .readdirSync(cliCommandsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => entry.name)
      .sort();
  } catch (err) {
    throw new Error(
      `cannot read the CLI registration under ${path.relative(root, cliCommandsDir)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (files.length === 0) {
    throw new Error(`no command modules under ${path.relative(root, cliCommandsDir)}`);
  }

  const sources = new Map(
    files.map((file) => [file, fs.readFileSync(path.join(cliCommandsDir, file), "utf8")]),
  );
  const functionsByFile = new Map(files.map((file) => [file, functionsOf(sources.get(file))]));
  // file → variable name → command path it holds; `program` is the root.
  const variables = new Map(files.map((file) => [file, new Map([["program", ""]])]));
  const functionParam = new Map();
  const calls = [];
  const declarations = [];
  const untraced = [];
  for (const [file, source] of sources) {
    for (const match of source.matchAll(REGISTER_FUNCTION)) {
      functionParam.set(match[1], { file, param: match[2] });
    }
    for (const match of source.matchAll(REGISTER_CALL)) {
      calls.push({ file, name: match[1], argument: match[2] });
    }
    for (const match of source.matchAll(COMMAND_DECLARATION)) {
      const [, declared, receiver, , quoted, template] = match;
      let raws;
      let shown;
      if (template === undefined) {
        raws = [quoted];
        shown = `"${quoted.trim()}"`;
      } else if (!template.includes("${")) {
        raws = [template];
        shown = `\`${template.trim()}\``;
      } else {
        const expanded = expandTemplate(
          template,
          match.index,
          file,
          sources,
          functionsByFile,
          relative,
        );
        if (expanded.untraced !== undefined) {
          untraced.push(expanded.untraced);
          continue;
        }
        raws = expanded.values;
        shown = `\`${template.trim()}\``;
        if (declared !== undefined && raws.length > 1) {
          untraced.push(
            `${relative(file)}:${lineOf(source, match.index)}: .command(${shown}) is bound to ` +
              `"${declared}" but stands for ${raws.length} commands`,
          );
          continue;
        }
      }
      declarations.push({ file, declared, receiver, raws, shown });
    }
  }

  const commands = new Map();
  const scan = (collectUntraced) => {
    for (const { file, declared, receiver, raws, shown } of declarations) {
      const vars = variables.get(file);
      const parent = vars.get(receiver);
      if (parent === undefined) {
        if (collectUntraced) collectUntraced.push(`${file}: .command(${shown}) on "${receiver}"`);
        continue;
      }
      for (const raw of raws) {
        const words = raw.trim().split(/\s+/);
        const fullPath = parent === "" ? words[0] : `${parent} ${words[0]}`;
        if (declared !== undefined) vars.set(declared, fullPath);
        commands.set(fullPath, { path: fullPath, arity: words.length - 1 });
      }
    }
    // A group registered in one module and extended in another: `registerX(server, t)` binds
    // registerX's own parameter to the path `server` holds at the call site.
    for (const call of calls) {
      const target = functionParam.get(call.name);
      if (target === undefined) continue;
      const parentPath = variables.get(call.file).get(call.argument);
      if (parentPath === undefined) continue;
      const targetVars = variables.get(target.file);
      if (!targetVars.has(target.param)) targetVars.set(target.param, parentPath);
    }
  };

  for (let pass = 0; pass < 5; pass++) scan(null);
  scan(untraced);
  if (untraced.length > 0) {
    const error = new Error(
      `command registrations this check cannot trace — the surface would be measured only in part:\n  - ${untraced.join("\n  - ")}`,
    );
    error.untraced = untraced;
    throw error;
  }
  return commands;
}

/**
 * A command path this revision's registration does not hold, grown from the registration itself:
 * a name written into a negative control is a claim about one revision's CLI and goes stale when
 * the CLI grows it, while a name grown from the registry read in the same run is absent at
 * whichever revision the caller runs on, by construction.
 */
export function unregisteredPath(commands, parent, seed) {
  let grown = parent === "" ? seed : `${parent} ${seed}`;
  while (commands.has(grown)) grown += "x";
  return grown;
}

/**
 * The text regions a `penguin` invocation can live in: the lines of every fenced block and every
 * inline code span, minus the inside of a double-quoted argument (`--prompt "… run penguin …"` is
 * prose someone reads, not a command the skill tells anyone to run).
 */
export function commandSegments(content) {
  const segments = [];
  for (const match of content.matchAll(/```[^\n]*\n([\s\S]*?)```/g))
    segments.push(...match[1].split("\n"));
  const outsideFences = content.replace(/```[^\n]*\n[\s\S]*?```/g, (block) =>
    " ".repeat(block.length),
  );
  for (const match of outsideFences.matchAll(/`([^`\n]+)`/g)) segments.push(match[1]);
  return segments.flatMap((segment) => segment.split('"').filter((_, index) => index % 2 === 0));
}

/** Every `penguin …` invocation in a skill, as the raw text and its whitespace-separated tokens. */
export function extractInvocations(content) {
  const invocations = [];
  for (const segment of commandSegments(content)) {
    for (const match of segment.matchAll(/\bpenguin\s+([^\s].*)$/g)) {
      const text = match[1].trim();
      const tokens = text.split(/\s+/).filter((token) => token !== "");
      if (tokens.length > 0) invocations.push({ text, tokens });
    }
  }
  return invocations;
}

/** A bare command-name token: what a subcommand is written as (`block`, `channel`, `ticket`). */
const isCommandWord = (token) => /^[a-z][a-z0-9-]*$/.test(token);

/**
 * Resolves one invocation against the registry: descend as long as the next token is a registered
 * subcommand of the path so far, then read the command's positional arguments. Placeholders
 * (`<ticket_id>`), flags (`--json`), grouped flags (`[--json]`) and a trailing comment (`# …`) are
 * not positionals; a bare word that is not a registered subcommand and does not fit the command's
 * arity is a mismatch, and so is a first token that is no command at all.
 */
export function resolveInvocation(tokens, commands) {
  let resolved = "";
  let index = 0;
  while (index < tokens.length && isCommandWord(tokens[index])) {
    const candidate = resolved === "" ? tokens[index] : `${resolved} ${tokens[index]}`;
    if (!commands.has(candidate)) break;
    resolved = candidate;
    index++;
  }
  if (resolved === "") {
    return { mismatch: `\`${tokens[0]}\` is not a command the CLI registers` };
  }
  const { arity } = commands.get(resolved);
  const positional = [];
  for (; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.startsWith("-") || token.startsWith("#")) break;
    if (isCommandWord(token)) positional.push(token);
  }
  if (positional.length > arity) {
    return {
      mismatch:
        `\`${resolved}\` is a command with ${arity} positional argument(s), so \`${positional.join(" ")}\` ` +
        `is neither a subcommand of \`${resolved}\` nor one of its arguments`,
    };
  }
  return { path: resolved };
}

/**
 * Every invocation in the given skills (`{ dirName, file, content }`), with the mismatches among
 * them; each invocation and mismatch carries its `skill` (the directory name) and each mismatch
 * its `file`.
 */
export function measureSkills(skills, commands) {
  const invocations = [];
  const mismatches = [];
  for (const skill of skills) {
    for (const invocation of extractInvocations(skill.content)) {
      invocations.push({ skill: skill.dirName, ...invocation });
      const result = resolveInvocation(invocation.tokens, commands);
      if (result.mismatch !== undefined) {
        mismatches.push({
          skill: skill.dirName,
          file: skill.file,
          ...invocation,
          mismatch: result.mismatch,
        });
      }
    }
  }
  return { invocations, mismatches };
}
