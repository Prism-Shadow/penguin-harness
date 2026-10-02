---
title: The Plugin Model
description: How a plugin is declared, installed and configured — a library plugin against a code package, the generated module manifest, and the four sandbox backends.
---

The harness has one plugin system holding two kinds of npm package, both of them directories under the repository's `plugins/` tree. They differ in what they carry and in who declares them:

- A **library plugin** carries content — the Skills and the hook package an *agent* runs. It is declared by a `plugin.json` manifest, and installing it copies that content onto an agent's `agent_state/`.
- A **code package** — the **server plugin** of [Skills & Plugins](/skills#server-plugins) — carries modules: decorated classes the *server* boots as children of its own tree. It has no `plugin.json`; a package is a plugin of this kind by being listed in a Project's config.

The repository ships 23 plugin directories: 14 library plugins and 9 code packages — the four `sandbox-*` backends, plus `claude-code`, `company-proposals`, `company-roadmaps`, `discord-bot` and `languages`.

- **Installing something?** See [Installing a plugin](#installing-a-plugin) for the two routes, and [Install a plugin on an agent](/skills#install-a-plugin-on-an-agent) for the page and the steps.
- **Giving a plugin options of its own?** See [Configuring a plugin](#configuring-a-plugin).
- **Writing a code package?** See [Code packages](#code-packages) and [The plugin contract](/server-boot#the-plugin-contract).
- **Wondering what confines a command?** See [The four sandbox backends](#the-four-sandbox-backends).

## The two kinds

| | Library plugin | Code package (server plugin) |
| --- | --- | --- |
| Carries | Skills and/or a hook package — content an agent reads and runs | Decorated modules — code the server boots |
| Manifest | `plugin.json`, with an `icon.svg` beside it | none; the generated `ifaces.json` beside `package.json` is the module payload |
| npm package | `@penguinharness/<name>` | any package name, as in `@prismshadow/penguin-plugin-sandbox-bwrap` |
| Declared by | the host package's dependency list — the built-in library | a Project's `[plugins]` table in `.project_config.toml` |
| Installed on | one agent, into `agent_state/skills/` and `agent_state/hooks/` | the server process, by loading the package |
| Runs where | in an agent's Session, as instructions and hook scripts | in the server, as nodes of its module tree |
| Examples | `agent-company`, `goal`, `humanizer` | the four `sandbox-*` backends, `discord-bot`, `languages` |

The files are the source of truth for both kinds. The library is read and parsed on every call with no cache, so an edited `plugin.json` or `SKILL.md` takes effect immediately; a code package's generated table is read every time it is loaded.

## Library plugins

A library plugin is a directory with a manifest, an icon and the content it ships:

```text
plugins/<plugin>/
├── plugin.json                # manifest — the plugin's single metadata holder
├── icon.svg                   # the icon of everything the plugin ships
├── skills/<name>/SKILL.md     # zero or more Skills (reference/… alongside)
└── hooks/*.mjs                # at most one hook package: plain Node scripts
```

`plugin.json` is where a plugin's metadata lives — its `version`, `category`, `preinstall` and hook points. A library `SKILL.md` carries only `name` and `description`; the loader stamps the plugin's version and short descriptions into each installed copy, the same way an installed hook package's `hooks.json` is generated from the manifest. [Plugin file format](/skills#plugin-file-format) lists the fields one by one.

Naming and versions follow one scheme. The plugin name is its directory name, matching `^[A-Za-z0-9_-]+$`, and the package is `@penguinharness/<name>` at `plugins/<name>/`. The manifest's `version` is `YYYY.MM.DD.N` — a date and a sequence number, compared by date and then by number, so `2026.08.29.10` follows `2026.08.29.9` — and it is separate from the package's npm version, which follows the release. Exactly five plugins carry `preinstall: false`, so `default_agent` is not initialized with them: `agent-company`, `agent-company-proposals`, `continual-learning`, `humanizer` and `use-claude-code`.

The library's extent is not a directory listing. The loader inside `@prismshadow/penguin-core` reads the `@penguinharness/*` entries of the host package's own dependencies and resolves each package through Node: core and the desktop app name all 14 plugins, the CLI names 13 of them — every one but `agent-company-proposals` — and `packages/server` names none, reaching them through core. In a workspace checkout the loader redirects each name to the repository's own `plugins/<name>/` — pnpm installs a `workspace:*` package as an injected snapshot that misses files added since, and a plugin you are editing has no build script to refresh it — while an npm install and the packed desktop app read the copy they carry. A declared package that Node cannot resolve throws with the path rather than quietly shrinking the library.

## Code packages

A code package is a set of modules, the same unit the harness itself is built from and written the same way: `@Component` / `@Module` classes whose `@Use`, `@Provide` and `@Bind` fields are their requirements, provisions and contributions.

Its default export is what the plugin *is*:

```ts
@Component({ contributes: { "SandboxModule.providers": [{ id: "…", name: "…", dimensions: ["fs-write"] }] } })
export class MyBackend {
  @Bind("…") provider!: SandboxProviderSource;
  setup() { this.provider = createProvider(); }
}

export default { modules: [MyBackend], replaces: [] } satisfies Plugin;
```

- `modules` adds nodes under the host's root.
- `replaces` stands in for nodes the host already has, by the replaced node's name — a component, a module, or a whole group with its children.

The contract — `Plugin`, the five kernel decorators and the sandbox, language and surface vocabularies — is the `@prismshadow/penguin-core/plugin` subpath; the interfaces a module may require are `@prismshadow/penguin-server/plugin`, types only, so a backend written against the sandbox vocabulary names core alone.

Manifests are generated, not written. The package's build runs `scripts/gen-ifaces.mjs` over its own tsconfig and ships the resulting `ifaces.json` beside its `package.json`. That table holds the manifest of every decorated class and the signature of every interface they name; it is the module payload, and it lets the host know what the package contains without executing it. A package without one ships no modules.

Before a plugin's modules are created, two checks run:

- Each class the default export names is checked against its manifest in the package's own table, so a stale build is an error named at load.
- The host interfaces the package compiled against are compared with the platform's by the TypeScript compiler. A table that carries no copy of an interface is logged as not compared rather than failed, because a pushed platform must not take plugins away from a machine for something the plugin did not do.

Then the whole tree — the host's nodes and every plugin's together — is checked as data before any node runs: requirements are resolved by signature and contributions validated against their slots, and a stand-in offering less than its consumers need is refused by name, so the App does not boot. [Server Boot and Subsystems](/server-boot#the-plugin-contract) describes the tree; [What a plugin is](/server-boot#what-a-plugin-is) has the boot order around it.

## Declaring a plugin

Which code packages a deployment runs is configuration, not a capability baked into the platform. Each Project asks for the ones it needs in its own config, and the server loads the union.

```toml
[plugins]
"@prismshadow/penguin-plugin-sandbox-bwrap" = "*"
"@scope/name" = "1.2.3"
```

Every key is a package name and every value a requirement in the shape of Cargo's `[dependencies]`; `"*"` asks for whatever version the deployment ships, and loading goes by the package name alone. Beside the shared table, a `[plugins.<machineId>]` table lists what one machine runs besides it, because machines are lent to Projects. The format and its tolerances are in the [Configuration Reference](/configuration#plugins).

Loading is per process, and three consequences follow:

- **The closure is what runs.** There is one module tree, so a plugin any Project asks for is in the tree and what it contributes is visible to all of them; a plugin every Project lists only for other machines is neither loaded nor installed here.
- **Failure is per entry and non-fatal.** An unresolvable or malformed entry is reported and skipped — that capability is unavailable — instead of failing the boot. A Project whose `.project_config.toml` cannot be read or parsed contributes nothing, and its list view reports the fault.
- **A change re-assembles the App.** Adding or removing a plugin applies without a process restart; agent runs in progress are stopped in every Project, and an edit that makes the new tree fail to boot is undone, so the list reads as it did before.

A specifier is looked up in one place: the generation `<data root>/plugins/current` points at, an npm prefix whose `node_modules/<name>` links to an entry of the plugin store (`<data root>/plugin-store/`). Every App boot resolves the Projects' tables against the store and activates that generation first; the plugins a hot push carried, the plugins the installation shipped and the packages fetched from the Plugins page all reach it through the store. A plugin is always named by its package, never by a path: a source checkout's dev build carries the plugins it just built in its bundled plugin directory (`packages/server/plugins/` for the dev server, `packages/cli/plugins/` for the built CLI), the way the CLI bundle carries its own. A package the harness ships is marked **built in**, and being shipped means installing it needs no download — not that it is installed: it loads when a Project asks for it, like every other plugin.

Neither directory grows without bound. After every activation that moves `current`, and once when the server starts, a sweep removes the generations other than the current and the previous one, and every store entry nothing needs. A store entry is kept while the current or the previous generation links it, any Project's table pins it, or it was stored less than a day ago. A package the build ships is stored again at the next activation that asks for it. The sweep also removes entries whose write never finished, and staging directories, once they are a day old. A sweep that fails only logs; it never fails a boot.

## Installing a plugin

**A library plugin installs on agents.** Install or uninstall it from the plugin's card on the **Plugins** page, or import a Skill or hook package from outside the library on the agent's settings page. The whole plugin is installed at once: its Skills land in `agent_state/skills/<name>/`, its hook package in `agent_state/hooks/<plugin>/` with a `hooks.json` generated from the manifest, and reinstalling from the library is how an installed copy is updated. See [Install a plugin on an agent](/skills#install-a-plugin-on-an-agent).

**A server plugin installs in a Project.** On the **Plugins** page, a server plugin's row shows its package, description, version and status; selecting **Install** under **Available** adds the package to the Project's `[plugins]` table and applies it.

Only admins see **Install** and **Remove**. A package that ships with PenguinHarness is added without a download. Any other package is first fetched from the npm registry into this machine's plugin store by the npm on the server's `PATH`. Only for that npm, the directory of the Node runtime running the server is appended to the end of `PATH`: the CLI bundle's own runtime carries npm, so a machine without npm can still fetch, while your own npm comes first. If npm fails, the row shows npm's first error line and the list stays as it was. The change reaches the server by re-assembly rather than a restart, and the row's status afterwards reads **running**, **restart to load** when the change could not be applied without one, or **failed to load** with the reason. Removing a plugin drops it from the Project's list; nothing is deleted from disk.

## Configuring a plugin

A plugin that needs settings declares them; the harness draws the form from the declaration and stores the values.

A declaration is a contribution to `PluginConfigProvider.groups`, so it is manifest data: it lands in the package's generated `ifaces.json` beside every other contribution, and the settings page can list and validate it without running the package. A group is a titled set of fields — a string, a secret, a boolean, a number, a choice among options, or a list of lines — optionally with a `parent` that draws the group inside another group's card. A group whose status changes at run time (the sandbox's backends) contributes that as code instead.

The declaration is the schema; the values belong to the deployment. They live in `server_settings`, one JSON document per group under `plugin-config:<group>` — **server-global**, like the plugin load itself, because plugins load once per process. A secret is stored in the clear beside the other settings the server keeps and masked at every API surface; a masked value sent back keeps the stored one. A first boot merges what is stored onto the declared defaults, so a reader always gets a complete document.

Delivery is a pull, and it is live: the module that declared a group reads it, and a save fires its watchers, which is how a plugin applies an edit without a restart or a re-assembly of the App. A group may also offer actions — steps a deployment has to take on the machine itself, such as installing WSL and initializing the Windows sandbox's distro — which the admin API runs and reports on. [Settings](/settings#plugins) describes the page: it is admin-only and server-global, and a plugin that declares no options has no card there.

## The four sandbox backends

The sandbox is the plugin system's largest user, and the clearest example of a code package. Its service in `packages/server` holds no backend and imports none: backends are plugin packages, and the Projects' lists say which ones exist. Each spawn's policy is routed to a backend that covers the dimensions the policy requires.

| Package | Platform | `fs-write` | `network` | `network-local` | `mask-paths` |
| --- | --- | --- | --- | --- | --- |
| `@prismshadow/penguin-plugin-sandbox-bwrap` | Linux | yes | yes | — | yes |
| `@prismshadow/penguin-plugin-sandbox-seatbelt` | macOS | yes | yes | yes | yes |
| `@prismshadow/penguin-plugin-sandbox-wsl` | Windows | yes | yes | — | yes |
| `@prismshadow/penguin-plugin-sandbox-dsh` | all three | yes | — | — | — |

The dimensions are `fs-write`, `network`, `network-local` and `mask-paths`, and a provider declares the subset it implements; saying nothing means `fs-write` alone. Routing is by capability rather than registration order: a policy needing only file effects goes to the first backend that covers it — the DSH adaptor, whose own chain picks bubblewrap, Landlock, Seatbelt or the Windows ACL runner per host — while a policy that also requires the network or masked paths goes to the first backend implementing those. Registration order only breaks ties between backends that both cover the request. A request nothing covers **fails closed**, naming what each backend covers, rather than letting a command run unconfined or quietly dropping a dimension it was asked for.

Windows is served by bubblewrap inside a dedicated WSL2 distro, so commands there run in Linux with Windows interop switched off. The three native backends declare options of their own — bwrap's program and its probe timeout, Seatbelt's program, the WSL distro's base Linux, packages, mirror and name, and whether Windows drives show read-only — as groups whose `parent` is `sandbox`, so they are drawn inside the sandbox card; the DSH adaptor ships no options. The `sandbox` group itself sets the mode, the network level, the masked paths and whether the temporary directory stays writable. [Sandbox](/settings#sandbox) describes what the card asks and what each answer means.

## Where the code lives

- `packages/core/src/plugin/` — the contract: `Plugin`, the decorators, and the sandbox, language and surface vocabularies.
- `packages/core/src/plugins/` — the library loader: which packages are plugins, their manifests and versions, and the category groups.
- `packages/server/src/plugin/` — the host: which plugins a process loads, the generated table reader, and the settings-group machinery.
- `packages/server/src/sandbox/` — the sandbox service, the dimension helpers and the `sandbox` settings group.
- `plugins/README.md` — the plugin tree's own index, with the library's categories and development commands.

Nothing under `packages/` depends on a plugin as code. The dependency runs the other way: a library plugin is content the SDK reads, and a code package compiles against the SDK's contract and is listed in a Project's config.
