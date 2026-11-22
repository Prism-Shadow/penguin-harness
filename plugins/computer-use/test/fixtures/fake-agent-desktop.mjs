// A stand-in for the agent-desktop program, the one fake at the program boundary. Started as
// `node fake-agent-desktop.mjs <scenario.json> <agent-desktop argv…>`. It records each call — its
// arguments, the environment and working directory it was given, and what arrived on stdin — in
// the scenario's log, then answers as the scenario says for its command: an envelope on stdout and
// an exit code, after an optional delay. A `screenshot` also writes its PNG to the path it was given.
//
// A scenario may instead describe the running apps (`world`), and the fake then matches names the
// way agent-desktop 1.3.1 does, which is not one way: `list-apps --app X` lists the apps whose name
// contains X, while a command's `--app X` takes an exact name or an alias (a bundle ID on macOS, a
// desktop entry on Linux) and answers APP_NOT_FOUND for a mere part of a name.
import fs from "node:fs";

const [scenarioFile, ...argv] = process.argv.slice(2);
const scenario = JSON.parse(fs.readFileSync(scenarioFile, "utf8"));
const stdin = (() => {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
})();
const command = argv.find((a) => !a.startsWith("-")) ?? argv[0] ?? "";
fs.appendFileSync(
  scenario.log,
  `${JSON.stringify({ argv, stdin, env: process.env, cwd: process.cwd() })}\n`,
);
const valueOf = (flag) => {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
};
function fromWorld(world) {
  const query = valueOf("--app")?.toLowerCase();
  if (command === "list-apps") {
    const apps = world.filter((a) => query === undefined || a.name.toLowerCase().includes(query));
    return { stdout: { version: "2.6", ok: true, command, data: { apps } } };
  }
  if (query === undefined) return undefined;
  const app = world.find(
    (a) =>
      a.name.toLowerCase() === query || (a.aliases ?? []).some((x) => x.toLowerCase() === query),
  );
  if (app === undefined) {
    return {
      exit: 1,
      stdout: {
        version: "2.6",
        ok: false,
        command,
        error: { code: "APP_NOT_FOUND", message: `No running application matches '${query}'` },
      },
    };
  }
  return { stdout: { version: "2.6", ok: true, command, data: { app: app.name, pid: app.pid } } };
}
const answer = scenario.answers?.[command] ??
  (scenario.world !== undefined ? fromWorld(scenario.world) : undefined) ?? {
    stdout: { version: "2.6", ok: true, command, data: {} },
  };
if (command === "screenshot" && answer.png !== undefined) {
  fs.writeFileSync(argv.at(-1), Buffer.from(answer.png, "base64"));
}
const finish = () => {
  if (answer.stdout !== undefined) {
    process.stdout.write(
      typeof answer.stdout === "string" ? answer.stdout : `${JSON.stringify(answer.stdout)}\n`,
    );
  }
  if (answer.stderr !== undefined) process.stderr.write(answer.stderr);
  process.exitCode = answer.exit ?? 0;
};
if (answer.delayMs !== undefined) setTimeout(finish, answer.delayMs);
else finish();
