import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { MediaWorkspacesPrototype } from "./manager.mts";

const help = `Media workspaces — runnable Git/LFS PROTOTYPE (Node >=24)

node packages/server/prototypes/media-workspaces/cli.mts <command> [options]

  init     --remote <URL-or-local-repo> [--branch main]
  create   --session <id> --name <name> --folder <repo-folder> [--folder ...]
  ensure   --session <id> --name <name> [--folder <additional-folder> ...]
  status   [--session <id>] [--name <name>]
  refresh  Fetch the base branch for FUTURE workspaces; existing branches stay pinned.

All commands accept --root <scratch-directory>.
Default: ~/.penguin/PROTOTYPE-media-workspaces
Commands print progress to stderr and their result as JSON to stdout.
Session IDs and names: lowercase letters, numbers and hyphens, up to 48 characters.
No automatic commits, pushes, removal or production session registration.
`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      root: {
        type: "string",
        default: path.join(os.homedir(), ".penguin", "PROTOTYPE-media-workspaces"),
      },
      remote: { type: "string" },
      branch: { type: "string", default: "main" },
      session: { type: "string" },
      name: { type: "string" },
      folder: { type: "string", multiple: true, default: [] },
      help: { type: "boolean" },
    },
  });
  const required = (value: string | undefined, flag: string) => {
    if (!value) throw new Error(`Missing --${flag}.`);
    return value;
  };
  const manager = new MediaWorkspacesPrototype(values.root, (message) => console.error(message));
  let result: unknown;
  if (values.help || !positionals.length) console.log(help);
  else {
    if (positionals.length !== 1) throw new Error("Supply exactly one command.");
    switch (positionals[0]) {
      case "init":
        result = await manager.init(required(values.remote, "remote"), values.branch);
        break;
      case "create":
        result = await manager.create(
          required(values.session, "session"),
          required(values.name, "name"),
          values.folder,
        );
        break;
      case "ensure":
        result = await manager.ensure(
          required(values.session, "session"),
          required(values.name, "name"),
          values.folder,
        );
        break;
      case "status":
        result = await manager.status(values.session, values.name);
        break;
      case "refresh":
        result = await manager.refresh();
        break;
      default:
        throw new Error(`Unknown command: ${positionals[0]}. Use --help.`);
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
