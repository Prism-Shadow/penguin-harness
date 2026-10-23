# PRFC-0003 Plugin

[中文版](PRFC-0003-plugin.zh.md)

> **Source**: `rfcs/PRFC-0003-plugin.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — landed (default branch `main`, commit [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)).
> **Unmerged revision**: the open design PR [#279](https://github.com/Prism-Shadow/penguin-harness-design/pull/279) carries one unmerged revision against this document (the passage on enabling a local plugin directory via link; based on an older base of the design repository), not folded into this version; once it is merged or rejected, the rev is raised per the conventions and recorded in `## Changes`.
> **Rev**: v1.0.0 (migrated into the main repository); the conventions for this surface are in [README.md](README.md), and per-version changes are recorded in `## Changes` at the end.

- Feature Name: `plugin`
- Start Date: 2026-09-02
- PRFC PR: [Prism-Shadow/penguin-harness-design#107](https://github.com/Prism-Shadow/penguin-harness-design/pull/107)
- Implementation PR: merged [#383](https://github.com/Prism-Shadow/penguin-harness/pull/383) (the plugin platform); in flight [#672](https://github.com/Prism-Shadow/penguin-harness/pull/672) (installing from npm), [#727](https://github.com/Prism-Shadow/penguin-harness/pull/727) (packaging built-in plugins), [#614](https://github.com/Prism-Shadow/penguin-harness/pull/614) (a Project's plugin table loaded by the platform), [#450](https://github.com/Prism-Shadow/penguin-harness/pull/450) (the plugin table synced to machines, per-machine plugin tables)
- Related: PRFC-0001 "Module", PRFC-0002 "HMR v1", PRFC-0004 "Plugin Scope", PRFC-0005 "Plugin Versioning", PRFC-0010 "Fleet parity and hot loading"

## Summary
[summary]: #summary

The platform maintains a core framework; everything else plugs in as plugins. A plugin is an npm package whose contents are a set of Modules, written the same way as the platform's own nodes. Each time an App is created, the platform reads the union of all Project plugin tables, checks these Modules against their signatures, and starts them as child nodes of the module tree; through the platform's slots they contribute functionality and live for exactly one App generation. Plugin upgrades also take effect by re-creating the App, and state can be parked into the new generation. The plugin table syncs with a Project to every machine the Project uses; each machine installs and re-assembles on its own, without restarting the process. A plugin's scope of effect is decided by configuration: what is activated is the plugin's functionality, not the plugin itself.

## Motivation
[motivation]: #motivation

The platform maintains only the core framework: the module tree, the HMR layer, the runtimes of sessions and Agents, and the slots and interfaces that let features plug in. Features such as sandbox backends, session surfaces, message bots, and syntax highlighting are provided as plugins; they can be released on their own and installed or removed as needed, without modifying or re-releasing the platform.

For this to hold, three questions must have definite answers:

- **How a plugin's code enters a running server**, and how to guarantee that what it gets is what it asked for.
- **When to load.** The plugin list changes while the process is running, and the platform itself is replaced by hot pushes; after both of these events the plugin's code must still be the correct copy, without relying on a process restart.
- **Hot updates.** Plugins themselves release new versions too; an upgrade must not rely on restarting the process, and the old version's state must be able to carry into the new version.
- **A lifetime across multiple machines.** A Project's sessions can run on several machines; the plugin must be present on every machine that will use it, and the list must be the same one.
- **Scope of effect.** There is only one module tree, yet a plugin's functionality often should take effect only for some users, Agents, or Projects.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

From publication to taking effect, a plugin goes through these steps:

1. **Discovery.** The plugin page lists the plugins in the registries: the built-in index, plus published indexes. A registry provides only names and descriptions, and imports no code.
2. **Listing.** An admin adds the plugin to a Project's plugin table, that is, the `[plugins]` of `.project_config.toml`; entries meant for one machine only are written into `[plugins.<machineId>]`. Packages this build does not carry are first installed into the data root by `npm install`.
3. **Applying.** Writing the plugin table re-assembles the App: the new generation reads the plugin table, imports the plugins, and starts the module tree; terminals and connections are handed over; the process is not restarted.
4. **Syncing.** Every machine this Project uses receives its plugin table, and steps 2 and 3 repeat on that machine.
5. **Updating.** The plugin is re-listed at the new version; when the App re-assembles, the new code is imported, and the plugin's Modules can carry state into the new generation.
6. **Removal.** Deleted from the plugin table, its Modules are gone from the next App generation.

Throughout all of this, a plugin's code enters the process at exactly one moment: when the App is created.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### Principles

A plugin package writes its Modules as decorated classes: `@Component` or `@Module` classes, with `@Use`, `@Provide`, and `@Bind` fields as the code halves of its dependencies, provisions, and contributions. The default export lists the classes to start, and may also list the platform nodes it intends to replace. At build time, `gen-ifaces` runs against the package's own tsconfig, writing each class's manifest, together with the signature of every interface it mentions, into `ifaces.json`, which is published with the package. A package without `ifaces.json` carries no Modules.

By reading `ifaces.json`, the platform knows what the plugin wants, what it provides, and which slots it contributes to, without executing any plugin code. The plugin's Modules enter the same tree as the platform's nodes, and before any node is created the whole tree is checked structurally at the signature level (PRFC-0001): what it can `@Use` is only what the platform publishes as interfaces, and a signature mismatch is rejected by name. After passing the check, it is created as a child node of the platform's module tree and contributes to the slots: a sandbox backend contributes to `SandboxModule.providers`, and the web UI's pages and tabs, and the settings groups, each have their own slots.

A plugin runs in the same process as the platform. Isolation stops at the interfaces: the signature checks guarantee that it gets what was agreed, and place no limit on what it does with it afterwards.

### When loading happens

Plugins are loaded by the **platform**, during App creation — not handed to the platform by the runtime at startup. The rules for reading the plugin table are therefore platform code, updated by hot pushes.

An App is created at the following moments, re-loading the plugins every time:

- **Process startup.**
- **Hot push.** A new version of the platform takes over from the old one (PRFC-0002).
- **Plugin table change.** In the same process, the platform starts itself up once more using the kernel's `upgrade`, taking the same path as a hot push — only the bundle stays unchanged.
- **Recovery after a failed start.** When the new generation fails to start, the change is rolled back, and the previous parked documents are started once more.

Each creation does these things in order:

1. **Read the union.** The `.project_config.toml` of every Project under the data root is read from file, taking the union of `[plugins]` and this machine's own `[plugins.<machineId>]` (this machine's id is generated by its own server). There is only one module tree, and loading is per-process; for whom a plugin's functionality takes effect is decided by configuration — see "Scope of effect".
2. **Resolve.** Each package name is looked for in these places, in order: the data root's `<root>/plugins/` (installed from npm by an admin), the built-in plugins brought by the current hot push, the built-in plugins shipped with the installation directory, and the packages installed globally alongside the program.
3. **Import.** What the previous generation already imported, with the same file and the same modification time behind it, is reused as-is; everything else is re-imported, carrying the file's modification time. A hot push places the built-in plugins in a new asset directory, and an npm upgrade rewrites files in place; in both cases new code is therefore imported.
4. **Pair.** The manifests in `ifaces.json` are paired with the default-exported classes into module definitions. A package that cannot be resolved, fails to import, or collides on a name is skipped alone, the reason left in its row on the plugin page, without affecting startup.
5. **Start.** The plugin's Modules are checked and created along with the whole tree. Once this generation commits, the imported plugins are handed to the next generation for reuse.

So a Module lives for exactly one App generation: its contributions to the slots are not carried into the next generation — every generation contributes anew. State that must be kept across generations goes through park; see "Hot updates".

**The cost of a change.** A re-assembly hands over the same things a hot push does: terminals, connections, parked state. What cannot be handed over is the same too: the Agents currently running in all Projects are stopped, and calls awaiting approval are rejected. The plugin page says as much before applying. Two admins' changes are written one after another through a queue, and each re-assembly reads only the one written for it.

### Hot updates

A plugin's code can be swapped while the process is running, without restarting the process. All three kinds of change take effect through one and the same thing: the App is created once more.

- **Plugin upgrade.** An admin re-lists the plugin as `package@version` (without a version, the latest is taken): `npm install` rewrites the files in `<root>/plugins/` in place, the plugin table records this version requirement, and then the App re-assembles. The new generation sees that the files' modification time has changed and re-imports them with the new timestamps. When the plugin table is synced to machines it carries the version requirement, so every machine installs the same version.
- **Platform hot push.** A new build places the built-in plugins in a new asset directory, so the built-ins are re-imported; the files behind the npm-installed plugins are unchanged, so the objects the previous generation imported are reused as-is.
- **Plugin table change.** Listing or removing — each is one re-assembly.

**State across generations.** Like a platform node, a plugin's Modules may declare a versioned context and implement `park()`. The documents the old generation parked are stored by module name and handed to the same-named module as the new generation starts: the new version migrates the old documents up through its own `migrations`, and when it meets a version newer than itself (a rollback), it refuses them by name instead of misreading them. Contributions to the slots do not cross generations; every generation contributes anew, so replaced code leaves behind no registrations pointing at old code.

**Failure.** If the new version fails at validation or creation, the change is rolled back, the previous generation is restored on the original list, and the plugin page gets the answer "did not take effect".


### Where plugins come from

- **Shipped with the build.** Built-in plugins are sent out together with the platform build and with every hot push. Each plugin packs the code it needs at runtime into its own package; only native modules remain runtime dependencies. A push packs each package into a deterministic archive, which the platform unpacks once before loading the plugin.
- **Installed from npm.** `<root>/plugins/` is an ordinary npm prefix. Listing a package this build does not carry installs it here via `npm install`; dependencies, mirrors, and private scopes are all handled per npm's own configuration on that machine.
- **Registries.** The built-in index and the published indexes are responsible only for discovery.

A given package exists only once in an installation; the version belongs to the installation (PRFC-0005).

### Multiple machines

Whichever machines a Project borrows, its plugins must load on those machines: whichever machine a session runs on must provide the server-side capabilities it needs, such as the sandbox backend.

- **When to sync.** When a machine is connected, and after every change to the configuration of any Project that machine uses. Syncs targeting the same machine are merged: a change arriving during a sync triggers one more sync afterwards, which reads the latest configuration.
- **What is synced.** Each Project sends the portion it wants this machine to load: the shared `[plugins]` plus this machine's own `[plugins.<machineId>]`, the latter taking precedence, which lands there as that Project's shared table. **Strict parity**: whatever is extra on this machine gets removed (PRFC-0010). Plugins usable only on a particular platform are written into the corresponding machine's own table.
- **How it takes effect.** Through the tunnel, that machine's own `PUT /api/projects/:p/plugins/installed` is called: it validates, writes the configuration, installs the missing packages (those not carried by this build go through npm), and then re-assembles in its own process. A machine on an older build that cannot hot-load only records the list and reports that a restart is needed; packages that cannot be resolved are reported one by one, not silently dropped.
- **Built-in plugins travel with the build.** When this machine's build is handed to another machine, what is handed over is the archive; that machine unpacks it itself.
- **What is not synced.** Plugin settings are saved per server (PRFC-0004), and each machine's versions belong to its own installation.

### Removal and failure

Deleted from the plugin table, a plugin leaves the next App generation; when no Project on this server lists it anymore, `npm uninstall` removes the package from `<root>/plugins/`. A plugin that fails to load affects only itself, with the reason shown in its row on the plugin page.

### Scope of effect: loading and activation

Loading is per-process: there is only one module tree, and if any Project lists a plugin, its Modules are on the tree. But a plugin's **scope of effect** is not decided by whether it is on the tree — it is decided dynamically by configuration: what is activated is some functionality of the plugin, not the plugin itself.

This is already so today:

- A sandbox backend being on the tree does not mean commands are constrained. Whether a command is constrained, and how strictly, is decided by the policy of the Session it runs in; in one and the same process, one Session can be read-only while another has full access.
- The plugin library's quick start only writes a demo into the current Agent's draft; that is behavior of the library's metadata and the UI, not a contribution slot of the platform's module tree.

This road can go finer: enable a plugin's functionality for only some users, some Agents, or some Projects, with everyone else unaffected as before. Machine-level configuration has already landed; PRFC-0004's project-level configuration is still a proposal. The platform's own policies (the sandbox, for example) can go as fine as the Session.

Why plugins are not loaded per scope, one tree per Project for example:

- Whole-tree checking presupposes one tree; trimmed per Project, that check is void.
- Activation is a configuration read — change it and it takes effect at once; loading is a re-assembly, in which running state is handed over per [PRFC-0015](PRFC-0015-agent-state.md): no interruption when compatible; when not, the old run is stopped and resumed from the Trace.
- Granularity such as user, Agent, or Session is beyond what a plugin table can express, and should not be expressed by it.

The price is discipline: a plugin must carry the caller's context when reading configuration and decide for itself for whom this functionality is on. For the surfaces the platform itself consumes — command constraints, HTTP routes, tools — the scope is parsed by the platform; plugins are not expected to help.


## Drawbacks
[drawbacks]: #drawbacks

One plugin table change rebuilds the platform tree shared by all Projects; while state is compatible, running Tasks keep using the old code until the current Task ends. When it is not, they go through a stop and a resume (PRFC-0015).

A plugin runs in the same process as the platform; installing it means trusting its code.

Per-functionality activation rests on the plugin's own compliance: a plugin that does not read configuration and applies to everyone cannot be stopped by the platform, which can only guarantee that the surfaces it consumes itself carry scope.

Code re-imported at each hot update is a fresh module record; Node does not remove the old one from memory until the process restarts.

Strict parity removes the plugins that are extra on a machine; plugins specific to a platform must be written into each machine's own table, or they will be removed on the other machines.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**Loaded by the platform, not the runtime.** The runtime can only be updated by reinstalling; the platform can be hot-pushed. Which plugins to read, where to resolve them from, and how to reuse them are rules that change — kept in the platform, a machine installed long ago can learn the new rules from a push, with no one having to go restart or reinstall it.

**Re-assembly, not a process restart.** Hot push already has a path that hands over terminals, connections, and parked state; a plugin table change takes the same path, with only the bundle unchanged. Restarting the process would break the terminals and the connections to every machine.

**In-process, not a subprocess or worker.** A plugin contributes to slots, uses the interfaces the platform publishes, and is replaced together with the module tree. Placed outside the process, every slot and interface would have to become a cross-process protocol, and hot push would have one more copy of state to manage.

**Strict parity, not per-machine choice.** "The whole fleet uses the same plugins" is the promise operators want; with every machine choosing on its own, no one can say for sure what is running on a given machine. Per-machine differences are written out explicitly in `[plugins.<machineId>]`, rather than left to the machines to drift.

**npm.** Dependency resolution, mirrors, proxies, and private scopes are already configured the npm way on every machine.

## Prior art
[prior-art]: #prior-art

**VS Code extensions**: the contribution points in the manifest let the host know what an extension carries without executing it, and `ifaces.json` plays the same role. Extensions run in a separate extension-host process, and installing or removing one restarts that process; here there is no separate host process — what gets re-assembled is the App layer.

**Declarative configuration** (Kubernetes, Ansible): write down the desired state, and the system converges the actual state onto it, deleting what is extra. The plugin table's sync to machines takes this shape.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

Skills, hooks, and MCP Servers from the bundled plugin library are still installed per Agent in the form of `package.json` manifests; Workbench is likewise distributed through a plugin, but after installation it is loaded by the Agent applying its own module tree (05 "Plugin library", [PRFC-0020](PRFC-0020-agent-workbench.md)). Under this proposal, a plugin's contents are Modules only, so these ought to be Modules contributed to Agents; how to migrate them over, and what to do with the copies already installed into each Agent when migrating, is not yet decided.

How to roll back a failed plugin upgrade: `npm install` rewrites the files in `<root>/plugins/` before the re-assembly; when the re-assembly fails, the plugin table rolls back to the old version requirement, but what is on disk is already the new version, so the recovery start imports the new code once more. Whether a rollback should also put the package back to the old version is not yet decided.

## Future possibilities
[future-possibilities]: #future-possibilities

More activation dimensions: enable a plugin's functionality per user, per Agent. PRFC-0004 currently has only the machine and project levels; the agent level waits for specific demand.

Rebuild only the affected subtree, reducing what one plugin change must re-assemble.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the landed version from the design repository's default branch, identical to the source file.
