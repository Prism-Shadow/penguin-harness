# PRFC-0004 Plugin Scope

[中文版](PRFC-0004-plugin-scope.zh.md)

> **Source**: `rfcs/PRFC-0004-plugin-scope.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — a draft, see design PR [#104](https://github.com/Prism-Shadow/penguin-harness-design/pull/104) (draft).
> **Rev**: v1.0.0 (migrated into the main repository, taking the draft's current version); the conventions for this surface are in [README.md](README.md), and changes from version to version are recorded in `## Changes` at the end.

- Feature Name: `plugin-scope`
- Start Date: 2026-09-02
- PRFC PR: [Prism-Shadow/penguin-harness-design#104](https://github.com/Prism-Shadow/penguin-harness-design/pull/104)
- Implementation PR: Machine level at [Prism-Shadow/penguin-harness#769](https://github.com/Prism-Shadow/penguin-harness/pull/769) (settings groups); project level not started
- Fleet parity and hot loading: Original PRFC-0010 line ([#124](https://github.com/Prism-Shadow/penguin-harness-design/pull/124), [#180](https://github.com/Prism-Shadow/penguin-harness-design/pull/180); implementation [Prism-Shadow/penguin-harness#627](https://github.com/Prism-Shadow/penguin-harness/pull/627), [#778](https://github.com/Prism-Shadow/penguin-harness/pull/778)) merged into this document, number 0010 released

## Summary
[summary]: #summary

Multiple Projects run on one server. When a plugin is installed, who does it affect? This proposal answers: registration remains global—one installation installs one module tree, plugins are wired in together during App composition; what is hierarchical is configuration—machine level holds facts about this machine, project level holds each Project's preferences, and plugins take effect at the level where they have configuration. Scope is therefore a property of configuration, not of plugins themselves; plugins need not be categorized, and manifest need not declare which level they belong to. Machine level has landed as **settings groups**; project level remains a proposal.

This document also answers "on which machines does the plugin list take effect, and when": The plugin list is no longer one per server endpoint, but rather **one list per fleet**—stored in Project configuration, partitioned by machine ID. Once enabled in one place, it is enabled on this server endpoint and every machine it uses; plugins not in the list are removed, missing ones are added. Taking effect no longer requires process restart. When the list changes, the runtime uses the same park/boot cycle as hot updates to recompose the App; newly listed plugins enter the tree immediately, removed ones exit immediately. See "Fleet parity and hot loading" for details.

## Motivation
[motivation]: #motivation

### What are plugins and how do they enter today

Plugins are npm packages that add capabilities to this harness, installed by the deployer themselves. The repository comes with four sandbox backends—bwrap (Linux), Seatbelt (macOS), WSL (Windows: commands run in a dedicated WSL2 distribution constrained by bubblewrap) and DSH adapter—plus language packs, Claude Code surface, and Discord bot. Message channel connectors (Feishu, Telegram, QQ) are another slot plugins can fill; today they are filled by built-in implementations.

They enter this way: The plugins table in Project configuration lists package names (see "Fleet parity and hot loading" for list shape and per-machine partitioning). Packages express the Modules they provide via decorator classes; build generates an `ifaces.json` manifest. When the server composes the App, it wires these Modules into the platform's module tree; the entire tree is signature-checked together—if something required does not exist or something contributed has the wrong signature, composition stops with a named error.

### The problem: installing it means all Projects need it

One server hosts multiple Projects, often belonging to different teams, each with their own model credentials, running unrelated work. Yet plugin loading is per-process: even if only one Project lists it, its contribution takes effect for all Projects.

Imagine a server with two Projects open. Operations installed the bwrap sandbox backend. Team A runs untrusted third-party code and requires all commands to be offline, write-only to Workspace. Team B is debugging a build script that must connect to internal services; offline breaks it. Sandbox policy snapshots per Session today; server settings are just the default for new Sessions and the ceiling for non-admins. Both teams can each tighten their own Sessions, but "Team A's Project is always offline" has no place to be expressed, because there is no project-level configuration.

Imagine again: Team B wants to connect their Agent to their own Feishu group. The bot token belongs to Team B, should not be visible to Team A, should not be managed by operations. Yet long-lived connections are per-process; you cannot open one per Project. Today there is no place to put configuration where "credentials belong to Project, connection belongs to process."

Both scenarios share a root cause: "what is installed" and "who it affects" are defined in one file at one moment, when they are really two separate things. Whether to install depends on this machine—whether the package exists, whether native artifacts support the platform. Whether it affects depends on the Project—whether it wants this capability, how it should work. One file answering two questions leaves only two possible shapes, both wrong: plugins always global, Projects interfere; or a separate per-Project configuration face that contradicts "one registration."

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

A plugin passes through three gates from publication to taking effect, each where someone can stop it: whether this installation has the package (built-in plugins just carry a builtin tag; whether to install is still operator authorization); whether it gets wired into the module tree during composition; and whether any configuration level says it should work. The first two exist today; the third is what this proposal adds.

Configuration splits into two levels. Machine level writes operational facts about this machine—which backend is available, machine-local credentials and paths, concurrency limits—changed by admins in the "Plugins" page of the settings panel. Project level writes this Project's preferences—modes, switches, Project-owned credentials—in the Project's configuration file, one section per Module.

What matters is these two levels belong to configuration, not plugins. It is normal for one plugin to have configuration at both levels: a sandbox backend says at machine level how to find bwrap, reads at project level what mode this Project wants. It need not choose sides; there is no separate "machine plugins" and "project plugins" installation faces, no two loaders.

All plugin authors need to know: you read your own section. Machine level's already-landed read pattern is `PluginConfig.get(group_name)`, reading the settings group the module declares. Project level's proposed read pattern is `project(projectId)`, returning the section under this module's name, possibly empty. Empty means not in effect. If a contribution should just work when installed, like grammar for syntax highlighting, it should not read configuration; instead, contribute directly to the platform's slot.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### Registration

One installation installs one module tree; plugins register together during App composition, not instantiated per Project. The tree is signature-checked as a whole; trimming it for one Project invalidates that check, and the check is why this tree deserves trust.

### Machine level

Landed as **settings groups** (Prism-Shadow/penguin-harness#769).

- **Declaration.** A module contributes settings groups to `PluginConfigProvider.groups`. This is pure data contribution, written into the generated `ifaces.json`, so the page can list it without running the package. The contribution ID is the group name. Groups carry a title, description (with `…Zh` Chinese fields) and `properties`; field types are `string`, `secret`, `boolean`, `number`, `enum` or `list`; can declare defaults, `required`, number ranges and `pattern`. `parent` lets one group render inside another group's card—for example, sandbox backend groups render inside the sandbox card.
- **Storage.** `server_settings` table in web.db, one document per group, key `plugin-config:<group_name>`. No row means use the declared default; changes take effect immediately, no push needed. Values are stored separately on each server, not synced between machines (see "Plugin settings do not enter the manifest").
- **Reading.** Modules declaring groups `require` `PluginConfig`: `get(name)` returns stored value merged over default, `watch(name, cb)` fires after each save, `saved(name)` distinguishes saved choice from default.
- **Writing.** Admin interface only: `GET|PUT /api/admin/plugin-config`. UI is the "Plugins" page in settings, each card saves independently. Plugins read-only their own values; if machine facts could be rewritten by plugins, "what is this machine configured as" has no single owner.
- **Live status.** Groups can also contribute code via `PluginConfigPage.status`, giving content that changes at runtime: hint rows (tone `attention`, `muted` or `progress`; with `progress` the page re-reads every two seconds); post-save finalization `saved()`; buttons `actions()` and `run(id)` (`POST /api/admin/plugin-config/action`), whose returned `settled` makes the card finalize like after save; and unavailable enum options `unavailable()`, grayed out with reasons, rejected on save if selected.
- **Buttons change the machine, not settings.** One-time tasks on the machine (install WSL, initialize sandbox distribution) run via button from the plugin, progress and result write to hint rows; they do not write back any settings values, so "plugin read-only" still holds.

### Project level

Stored in Project's `.project_config.toml`, one section per Module: `[plugin.<module_name>]`. The `plugin.` prefix is required: top-level section names would collide with `models`, `command_policy` and other core keys, and core config parsing would read same-named sections as its own fields.

### Why neither level goes into parked documents

Sandbox settings currently park with platform context; plugin configuration does not follow this path. Parked documents only add fields, never version, and old runtime kernel rejects documents newer than itself. Putting third-party plugin schemas there means delegating rollback compatibility to plugin authors.

Sandbox settings themselves are machine level, already moved to `server_settings` (group `sandbox`, key `plugin-config:sandbox`). Parked documents still carry current policy across hot switch: on startup, if a saved document exists, use it; otherwise carry the switch's value. So data roots that never saved settings work unchanged, no migration needed.

### What plugins see

Not the whole config table, but two read patterns narrowed to the calling module name. This is hard requirement: `.project_config.toml` holds model credentials, stored 0600 on disk, not even system prompts can read it. You cannot hand the whole table over just because a plugin wants one section.

Machine level's schema is declared by plugins, platform validates and renders from it (see above). In the project level section, schema belongs to plugins; how it evolves uses the Module's existing `migrations` (chained by start version); platform interprets nothing inside.

### Platform does not merge the two levels

Both documents pass as-is to the plugin, which judges their relationship itself. Platform cannot write a generic merge rule, because only the plugin knows which direction in its schema is "stricter."

Platform's own hierarchical configuration is separate. Sandbox policy snapshots per Session: settings page value is the default for new Sessions and the ceiling for non-admins; filesystem modes and network levels (no network < local network < full access) can only tighten; modes this machine's backend cannot enforce are grayed and rejected. Platform implements this rule itself. Two semantics, two places to code, no need to fake one generic merge layer.

### Where you cannot read project level

Only call sites with projectId can read project level. Background plugins without Project context can only use machine level or walk Projects themselves; this is the natural result of hierarchy, not an exception.

"What plugins does this Project use" has no roster to query; the answer computes from "registered modules" and "has a project section."

The high-impact surfaces—command constraints, HTTP routes, tools—are consumed by the platform itself; scope is parsed by the platform, plugins are not expected to help.

### One ordering constraint on landing

Core's `addModel`, `removeModel`, `setDefaultModel`, `setVisionModel` are "read in, narrow to typed config, write back"; unknown sections vanish during narrowing. Before project level lands, these four must change to preserve unknown keys on whole-table read-write (server config service already does this). Otherwise one `penguin model add` and this Project's plugin config silently clears.

Right now the disk has no `[plugin.*]` sections, so this is only an ordering constraint, not a data compat issue.

## Fleet parity and hot loading
[fleet-parity]: #fleet-parity-and-hot-loading

Plugins are no longer "one list per server endpoint," but rather **one list per fleet**—once enabled in one place, it is enabled on this server endpoint and every machine it uses. Plugins not in the list are removed, missing ones are added. Taking effect no longer requires process restart. The runtime uses the same park/boot cycle as hot updates to recompose the App; newly listed plugins enter the tree immediately, removed ones exit immediately.

### Why you can't each manage your own anymore

Today's shape is per-deployment: `<root>/plugins.json` one per machine; Plugins page changes this machine's copy; plugins load only **at process startup**, restart required to take effect.

One machine, this makes sense. A fleet, it does not:

- **Cannot install.** Operators manage remote machines via Machines page—install, update, connect, restart all there. Plugins require logging in to each machine's server and clicking once each. This path does not exist in the product.
- **Runs where, plugins must be there.** Session surface (PRFC-0017) made this plain: Session builds on which machine, surface opens there. That server must carry the plugin that contributes the surface. This machine must also carry it, or "New conversation" has no such option. Same plugin, both places, each installed once.
- **Restart is expensive.** Sessions and terminals run on the machine. Restarting the whole server to enable one plugin interrupts work in progress.

Model credentials stopped being this way long ago: `syncModelsEverywhere` pushes the Project's model table to every machine it uses on config change and connect, for the same reason—"things running there need config there." Plugins lack the same path, plus "no restart needed to take effect."

### Shape for the operator

**For operators.** Plugins page as usual: check a plugin, it is installed. Difference is "installed" now means the whole fleet—this server, every machine it uses. The page lists per machine what this sync did: what was added, removed, which machines did not catch up and why. No need to log into any machine, no restart needed anywhere.

**Parity is strict.** The fleet's list is authoritative on this server; extra plugins on machines are removed. This is what "all machines the same" means literally. The price: **platform-specific sandbox backends get erased.** Windows uses `sandbox-mxc`, Linux `sandbox-bwrap`, neither works on the other side. Want a machine to keep its own backend? List that backend in the fleet manifest too. Machines that cannot resolve it show it as an inert error row, not dropping their usable one.

**Or just for some machines.** Plugins page top-right has a machine selector to switch perspective: "All machines" edits the shared list; pick one machine (including this one), you see what that machine actually runs. Install here only enables it on that machine, only that machine downloads it.

**Taking effect is immediate.** Plugins no longer wait for restart. List changes, server recomposes its App in place: new plugin modules enter the tree, removed ones do not. Running terminals and Sessions are unaffected—they are already resources that survive recomposition; hot updates do this every day.

### Hot loading

Loading happens inside the **platform**, no longer just at process startup. Today `loadPlugins` runs once in runtime's `index.ts`, publishes `PluginHost` to the resource registry; every time the platform composes an App, `pluginHostFrom` claims it. The change adds one path for "claiming again":

1. Platform reruns loading (loader is already in the platform package—`plugins-installed` route already uses it to read the manifest), gets a new `PluginHost`, overwrites that entry in the registry.
2. Platform asks runtime to **recompose the App with the same bundle**: park current App, dispose, `boot(bundle.impl, bundle.iface, doc, resources)`. This is exactly what `HmrHost.recoverPrevious` already does; trigger was startup failure, here the trigger is the plugin list changed.
3. New App's `pluginHostFrom` gets the new one; new plugin modules enter the tree, removed ones do not.

Three things must be in implementation:

- **Import cache.** Node caches `import()` per URL. First-listed packages are fine. **Same package with changed content** is not re-read, so imports need a query string determined by content, or "update plugin" silently keeps running old code.
- **Unload does not exist.** Node cannot unload modules. Removing a plugin means it no longer enters the tree; its code stays in process memory. Write that down honestly, do not pretend it unloads.
- **What survives.** pty, machine connections are resources that survive recomposition, same as hot updates. A surface's pty keeps running after recomposition; if its plugin is the one removed, the Session then 404s, pty gets reclaimed by registry's normal rules.

### Recomposition is platform's own affair, HMR layer unchanged

Recomposing the App is **policy**, not mechanism: it travels with the platform, lives above the seam. `packages/hmr` gains no methods for it (once thought of giving `Hmr` an optional `reload()`, rejected—mechanism layer cannot grow for business function).

Implementation shape: `platformImpl.create()` starts an **inner instance** (true module tree, kernel's own `boot`), returns an outer shell whose members all forward to the current inner instance. Recomposition is the platform calling kernel's `upgrade()` on the inner instance in its own queue—same impl, same iface, same parked doc, same swap as hot updates, just no new bundle. Startup fails, `boot()` recovers the previous tree using the parked doc, returns false. Runtime (HMR host) holds the same outer shell from start to end, unaware of swaps inside. Dispose launched by runtime (one push lands) first waits for recomposition in flight to finish, then releases the tree it left.

Thus no need for "old runtime downgrades to pending restart": all logic lives in the platform, works on any runtime. Routes trigger it through the mechanism interface `Reassembly.reassemble()` the platform provides.

### Manifest: Project config, process takes closure

The plugin manifest moves from data root's `plugins.json` to **Project configuration** (`.project_config.toml`, alongside `models`). The reason: it makes sync scope self-evident. Machines are **borrowed per Project**; model credentials already sync per Project (`syncModelsEverywhere(projectId)`); plugins follow the same line, scope needs no separate invention.

Manifest shape is one **`[plugins]` table**, keys are package names, values are requirements, like Cargo's `[dependencies]`:

```toml
[plugins]
"@scope/name" = "*"                   # the deployment's built-in version
"@scope/other" = "1.2.3"              # version requirement
"@scope/third" = { version = "1.2" }  # table form; future fields go here
```

Table not list because one entry can grow fields (version, options) without format change. String values are shorthand table form (version only); `"*"` means same as omit `version`. Reading is lenient: entries that are not string or table get dropped, rest works, one typo does not take down the Project's model config. Interface layer still passes by package name (`PUT { plugins: [name] }`); names retained preserve what the file asks for.

But **loading is per-process, not per-Project**: one module tree, one App. So config spreads per Project, effect takes **closure**:

- **On process startup and recomposition**, load the union of all Project manifests. If any Project wants a plugin, it is in the tree.
- **On sync to one machine**, send the **union of manifests of Projects using that machine**. One machine borrowed by one Project, that is its manifest. Shared by several Projects, it is their union. Strict parity operates on this union: what is not in the closure gets removed from that machine.

### Per-machine manifest

Under `[plugins]` can be sub-tables keyed by **machine ID**, listing plugins this machine runs besides the shared manifest:

```toml
[plugins]
"@scope/everywhere" = "*"

[plugins.Xk3v9Qa_bT2mLp0z]
"@scope/only-there" = "*"
"@scope/everywhere" = "1.2.3"   # when same name, this machine's entry wins
```

- **Key is the machine's own ID**: 16-char base64url generated on first server startup on that machine; unchanged if renamed, alias changed, or reinstalled. Not ssh alias—alias rename or pointing to another host means the manifest silently changes object. This machine also uses its own ID, no special `local` key.
- **One machine's running manifest** = shared table ∪ its own sub-table, same-name entries prefer the sub-table. Plugins only in one machine's sub-table run only there, download only there. Unknown-ID machines (no server has started there yet) take only the shared table.
- **Telling sub-tables from entries**: key looks like machine ID, value is a table with no `version` field, that is a machine sub-table. Writing always makes fields-less entries `"*"`, so no confusion.
- **This machine's loading**: platform composes App using this machine's ID to take closure. Plugins listed for other machines neither download nor load here; on delete, this machine's packages move off when not needed in this machine's closure.
- **Interface**: `POST { specifier, machineId? }` and `DELETE ?specifier&machineId` with `machineId` changes only that machine's sub-table. Without it, `POST` writes shared table, `DELETE` removes from all tables. Changes affecting only other machines write disk directly, do not recompose this machine's App. `PUT` rewrites only the shared table, the verb machines use to sync. `GET` each row reports `everywhere` (shared table lists it), `machines` (which sub-tables list it), `here` (does this machine run it); response carries this machine's `machineId`.
- **Plugins page**: top-right machine selector (appears only when other machines or sub-tables exist). "All machines" view lists all plugins; rows for partial machines mark "only on…". One machine's view lists only what that machine runs, status read from that machine itself (via `/server/<machineId>/api/…`); plugins in the shared table here cannot be removed, need to go back to "All machines" view.

### Plugin settings do not enter the manifest

Declared settings values each server saves in its own `web.db` (`plugin-config:<group>` in `server_settings`), not written to Project config, not synced across the fleet. Settings panel's "Plugins" page has the same machine selector (appears only when Project connects other machines): picking one machine, read, save and actions all go through `/server/<machineId>/api/admin/plugin-config` and land in that machine's own store. Settings do not copy between machines, so no "shared-fleet value"; each machine configures separately.

Must say plainly: **Contributions are fleet-wide.** Plugins enabled by one Project contribute things (session surfaces, sandbox backends, grammars) seen in every Project in this deployment. Config splits per Project, visibility does not. Whether to filter contributions per Project, see Unresolved.

### Fleet sync

`machines/plugins-sync.ts`, shape copies `models-sync.ts`:

- **Trigger**: when one Project's manifest writes (same fire-and-forget as model side's `void syncModelsEverywhere(projectId)`), plus catch up when connecting a machine—offline changes, reconnecting syncs them up.
- **Path**: tunnel call that machine's own `PUT /api/plugins/installed`, one normal authenticated call, same as models: peer validates, writes disk, does its own hot loading.
- **Strict parity**: what gets sent is the complete closure manifest of Projects on that machine—each Project's shared table plus the sub-table keyed by that machine's ID. Peer receives it as that Project's shared table. Extra in peer's shared table gets removed; peer's own sub-table stays out of the comparison.
- **On-demand download**: peer lacks, build does not ship them, peer first `POST` installs them itself (from npm, version requirements), then `PUT` the complete manifest. Plugins not listed for this machine never go over, never download there. Failed entries report separately, skip from this manifest, rest land fine.
- **Results report per machine**: what added, removed, unresolvable on that machine (e.g., still has not updated to a build with that plugin), which machines did not catch up. Unresolvable entries stay in the manifest showing as error rows—operator's choice, not something the sync should delete for them.

Built-in plugins have one hard dep: machines must update first to a **build carrying that plugin** (Machines page install/update), then the manifest syncs with something to resolve. npm-published plugins the on-demand path installs on the peer.

### Existing config: explicitly incompatible

Operators decided: **explicitly incompatible**, no migration, no double-read.

- Data root's `plugins.json` is no longer read. Manifest's only home is each Project's config.
- After upgrade, a deployment that previously had plugins starts with **no plugins**: sandbox backends, grammars, session surfaces gone from the tree until operators re-check them in the Project that needs them.
- Thus no compat code to write, no "keep this long, who cleans it" question—that is why it was chosen.
- Change is breaking: changelog entry carries `Breaking` metadata and a "compatibility" section, saying upgrades require re-enabling plugins, where to do it.
- Old file stays, no errors: platform does not read it, acts like it does not exist. Leaving it on disk helps rollback; rolling back to old platform reads it again.
- List form briefly existed before release (`plugins = ["…"]`); also not read: non-table values mean no such key. Project wants nothing until re-entered as a table in the page.

## Drawbacks
[drawbacks]: #drawbacks

Config surface goes from one place to two. Ops change half in settings panel "Plugins" page, Project owner changes the other half in Project config; when plugin behavior is wrong, need to look two places to figure out who defined it.

"Read your own section" is discipline, not enforcement. One plugin could insist on per-process mutable state and still interfere cross-Project. Platform can only guarantee the surfaces it consumes carry scope.

No roster of "what plugins does this Project have." It computes, so you cannot read one key to get the answer or change one key to toggle all.

Fleet parity and hot loading add three more costs:

- Strict parity erases platform-specific plugins on machines, most notably sandbox backends. Choose it means choose "fleet manifest is single truth"; operator must know and bear the cost.
- Hot loading makes "recompose App" from something operators actively do (push) to something toggling plugins can trigger. Failure handling paths are hit more often.
- Removed plugin code stays in memory; repeated add/remove makes the process slowly bloat. Node's limit, not a design choice.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

Most intuitive fix: categorize plugins, one class for machines, one for Projects. This path hardens the misalignment into plugin nature itself; three costs. Each plugin must pick a side, and the interesting ones cannot; both scenarios above carry machine facts and Project preference. Once in manifest it cannot change; manifest is published. Two classes need two install faces, two loaders.

Another idea: central enable list in Project config. Requires platform to grow a schema it does not understand, makes "enable" and "configure" two concepts that must stay in sync. Let config section's existence mean enable; one fewer concept, one fewer place to drift from reality.

Do nothing: plugins stay global, multiple Projects on one server stay interfering, policies that should be per-Project like sandboxing cannot be.

Fleet parity and hot loading considered:

- **Each machine manages its own** (status quo): false premise in a Machines page world—operators have no path to log in and click each one.
- **Union instead of strict parity**: keeps platform-specific sandbox backends, cannot make "all the same," which was required. Explained cost to operators, they chose strict parity.
- **Restart instead of hot loading**: `POST /:machineId/restart` exists, can restart each after sync. Rejected because the cost: interrupts Sessions and terminals running on the machine; hot-update mechanics built for "do not interrupt."
- **Do nothing**: surface plugins cannot work in a fleet—this machine needs it to show in "New conversation," machines need it to run, both manual only.

## Prior art
[prior-art]: #prior-art

Prior in this repo. `ProjectConfig`'s `[command_policy]` is one Project-owned policy: seeded from the factory at creation, thereafter its own. Each Session creation threads it into Environment. Project-level plugin config follows the same ownership rule. `server_settings` already the home of machine-level config; this proposal just adds one more class.

Sandbox contract already said the same thing. `SandboxPolicy` is "carried on each call, not fixed to provider": provider once per process, policy each call. This proposal just generalizes to all plugins—state does not instantiate per scope, scope threads in as a parameter.

VS Code's User / Workspace two-level settings do the same split; extensions have sections at both. Machine level's settings groups borrowed its declaration shape: extensions declare each key's type and default in manifest, host validates and forms. Difference: it merges both levels into one value for extensions; we do not: project-level sections are opaque JSON to the platform, only plugins know which direction is "stricter."

Fleet parity and hot loading priors:

- This repo's `machines/models-sync.ts`: existing answer to the same problem (things running there need config there); this follows its shape.
- `HmrHost.recoverPrevious`: existing action of recomposing the App in-place with the same bundle; hot loading reuses it.
- VS Code's extension enabling: install takes effect, no restart; its Settings Sync syncs extension sets to each account's machines, one roster across the fleet.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

Whether machine level is completely read-only for plugins can be revisited. This proposal takes read-only, writes go through admin interface only; buttons change the machine itself, not write back settings. If a scenario emerges where plugins must write settings (e.g., cache a probe result), reconsider.

Whether to add an agent level, defer for now. Tools already have second narrowing at Agent level (`tools.builtin`); prompts and connectors lack it. Wait for specific demand to add it.

Fleet parity and hot loading open questions:

- Whether contributions should filter per Project. Manifest is per-Project, but contributions in one tree are visible to every Project. To make "A's surfaces only appear in A," contributions need to carry who requested them and `/api/contributions` filters per current Project.
- How much of a sync failure on one machine counts as "fleet not in parity," and whether the page keeps showing the inconsistency until fixed.
- Whether sync should also trigger that machine's update (bring it to a build with the plugin), or stick to syncing manifest only, updates operator-driven.

## Future possibilities
[future-possibilities]: #future-possibilities

Project settings page could have a "plugins enabled" surface, same shape as Agent Skills tab, reading "registered modules × has a project section."

If the agent-level question above gets pushed by concrete demand, hierarchy becomes three levels, one more read pattern `agent(projectId, agentId)`, rest unchanged.

Further out: `command_policy` and sandbox settings now have their own storage each; if two-level config holds, they could converge to one shape. That is another proposal's work, not a reason to accept this one.

Fleet parity and hot loading further out:

- Plugin versions included in parity, not just "installed or not."
- Hot loading exposed to developing plugins: change code, reload immediately, no platform push needed.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the current version of the draft carried by design PR [#104](https://github.com/Prism-Shadow/penguin-harness-design/pull/104), identical to the source file.
