# PRFC-0005 Plugin Versioning

[中文版](PRFC-0005-plugin-versioning.zh.md)

> **Source**: `rfcs/PRFC-0005-plugin-versioning.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — a draft, see design PR [#106](https://github.com/Prism-Shadow/penguin-harness-design/pull/106) (draft).
> **Rev**: v1.0.0 (migrated into the main repository, taking the draft's current version); the conventions for this surface are in [README.md](README.md), and changes from version to version are recorded in `## Changes` at the end.

- Feature Name: `plugin-versioning`
- Start Date: 2026-09-02
- PRFC PR: [Prism-Shadow/penguin-harness-design#106](https://github.com/Prism-Shadow/penguin-harness-design/pull/106)
- Implementation PR: not started
- Depends on: PRFC-0004 "Plugin Scope"

## Summary
[summary]: #summary

One plugin, two Projects wanting different versions of it—what then? This proposal's answer: don't solve it inside one installation. Version belongs to the installation—one installation is one module tree and one plugin manifest, with only one copy of each package; project-level configuration says only how a plugin works here, never which version of it is wanted.

## Motivation
[motivation]: #motivation

### Background

Plugins are npm packages that add capabilities to this harness, listed by the deployer in the data root's `plugins.json` and wired into the platform's module tree when the server starts. The five currently in the repository are four sandbox backends and one language pack. Being npm packages, they have versions, they get upgraded, and some upgrades break compatibility.

One server hosts multiple Projects at the same time. PRFC-0004 already settled the scope of plugins: registration is global, what is hierarchical is configuration—machine level holds machine facts, project level holds each Project's intent. The question that follows immediately is which level versions fall on.

### The problem: one server, two Projects, two versions

Picture one server with two Projects open. The sandbox plugin ships v2, which changes the default semantics of masked paths—paths not listed were visible by default in v1, v2 hides them by default. Team A's configuration was written to v1's semantics; following the upgrade would block everything their build scripts need to read. Team B needs a new isolation dimension that only exists in v2. Operations has only this one server. What now?

If versions could be written into Project configuration, the answer looks direct: A writes `version = "^1"`, B writes `version = "^2"`, each takes what it needs. What this proposal sets out to show is that this road does not work—and why it must not be allowed to look workable.

### Why it must be answered now

When the question is answered decides how hard it is. If version became a field in project configuration, the system would gain the ability to express this conflict, while the module tree has no ability to carry it—whoever writes that field, the runtime's only move is to fail. Conversely, pin version to the installation and the conflict cannot be expressed at all; what remains to handle is only "how to let people know at install time."

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

One installation is one consistent set of versions. To know which version a Project uses, look at which installation it runs on.

A Project declares no versions, only configuration. The `[plugin.foo]` section says how foo works in this Project, not which version of foo this Project takes.

When two versions genuinely must be available at the same time, there are three roads, ordered by how likely each is to be used.

The first is also the answer for the overwhelming majority of cases: publish the breaking version as a new plugin. Change the package name and the module name; the two versions coexist, each occupying its own interface keys, each Project configuring its own. Semantically they are two incompatible things to begin with—using the existing namespace to say so truthfully is all it takes; no new mechanism is needed.

The second: express the difference as configuration rather than as versions. "A wants the old behavior, B wants the new" is nine times out of ten a matter of one configuration key; for how the section's schema evolves, use the Module's existing `migrations`—the new version can read what the old version wrote.

The third: split into two installations. A Machine is already the unit of "one provision set"—each has its own data root and `plugins.json`, and the installation push carries over any plugin payloads the target is missing. This is the legitimate way to isolate versions, not a detour.

Installing a second copy of a package with the same name is refused on the spot, stating clearly which version is already installed—no need to wait for the next startup to find out.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### Why the tree cannot hold two copies

Every interface between platform and plugin is registered in one global table, keyed `<package name>#<export name>`; the whole-tree check at startup does exactly this: take the table and verify one by one who requires what and who provides what, reporting a named error when signatures do not match.

What blocks two copies is three independent gates, none of them an oversight. Module names are unique within the tree, contribution ids are unique within the tree, and the interface table's keys have no version dimension.

The third gate is the truly fatal one. With two versions of the same package in the tree at once, two different signatures would appear under the same key, and the whole tree's signature-level check would thereupon lose its meaning. Even if the first two gates were relaxed—for example, by adding a version suffix to module names—the third still stops it.

### Versions do not enter project configuration

The `[plugin.<module name>]` section has no version field, and none is accepted. This is not an omission—it is this proposal's core constraint: a conflict that can be expressed is a conflict that must be resolved.

### Conflicts are reported at install time

The installation face compares against the installed manifest before writing into `plugins.json`; when a same-named package is already there, it is refused by name, stating which version is installed and that an installation holds only one copy.

Today `PluginHost.use` and the whole-tree check both throw at startup; installing says nothing, and the failure comes only at the next restart. Moving the judgment forward to the installation face also matches how this codebase fails everywhere else: block it, and say clearly who did the blocking.

## Drawbacks
[drawbacks]: #drawbacks

Upgrading a plugin upgrades the whole installation at once. One Project needs the new version, and the other Projects on the same installation switch with it; rollback is the same—plugin version and configuration go back together, with no way to roll back just one Project. The mitigation is PRFC-0004's hierarchical configuration—have a behavior-changing new version keep a project-level switch that lets old Projects retain the old behavior—but this takes the plugin author acting on it; the platform cannot force it.

One more thing to concede: this proposal gives no direct answer to the demand "two Projects want different versions"—only three indirect roads, and the most thorough of them does not come cheap.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

The module tree's value is that the whole of it is signature-checked together. Any scheme that allows two signatures under the same interface key must trade that check away, and the check is why this tree deserves trust. Pinning version to the installation is the only position that leaves this premise untouched.

Namespacing by version inside the tree—`foo@1` and `foo@2`—would add a version axis to `requires`: every dependency declaration, every resolution, every ifaces table would have to carry version semantics. Changing the entire signature table for a rare case does not pay.

One process per version, isolated by worker or subprocess, would require a new serialization boundary and a set of lifecycle management, and beyond that boundary there is no signature-level check. It moves the problem; it does not solve it.

The project-level version pin was covered above: it conjures up an expression the runtime cannot satisfy.

Do nothing, and the conflict still happens—only at startup, the error coming from tree validation, and what the operator sees is "duplicate module name" rather than "you installed two versions of the same plugin."

## Prior art
[prior-art]: #prior-art

The answers from the four ecosystems fall into two classes, and the dividing line is not "willing to install two copies at once"—it is whether the host has a global table indexed by name. Hosts without such a table can install two copies, at the price of the two copies not recognizing each other; hosts with one can hold only a single copy per installation.

npm takes the no-table road. Nested `node_modules` lets multiple copies of the same package coexist; which copy you use is decided by the path, and the price is that types and instances do not cross: `instanceof` fails, and what should be a singleton becomes several. Notably, npm itself knows this road does not work for plugins—that is exactly why `peerDependencies` exists, letting a plugin declare "this dependency must be satisfied by the host's copy; do not install me my own." In the ecosystem most tolerant of duplication, plugins are precisely the case that must be deduplicated.

Cargo's rules are finer, and closer to the question we are answering. It enforces unity within a single semver-compatible range: when two requirements written `=0.4.11` and `=0.4.8` collide, Cargo fails outright rather than building one copy of each. Coexistence is permitted only across incompatible ranges—for example, rand 0.6 and 0.7 both appearing in the dependency graph. The consequence gets a section of its own in the Cargo documentation, version-incompatibility hazards: once types from the two crates show up on each other's API boundaries, the compiler reports errors like "expected X, found X" that look insane. Cargo is willing to build two copies, but it concedes this holds only while the two never meet.

Cargo also has a more direct counterpart: the `links` key. A package declaring `links = "foo"` says it links a native library named foo, and Cargo rules at most one package per `links` value, forbidding two packages from linking the same native library, on the grounds of preventing duplicate symbols. This is exactly our situation: in a build system willing to build multiple copies of most dependencies, there still exists a class of globally unique names, whose uniqueness is enforced at resolution time, with violations rejected by a named error. Our interface key `<package name>#<export name>` belongs to exactly this class; the "refused by name at install time" described earlier has the same shape as `links`' rejection.

VS Code is on the has-a-table side, and is the one closest to this proposal. An extension's identity is `publisher.name`; one identity has one copy per installation, with no concept of multiple versions coexisting. `extensionDependencies` lists extension ids with no version ranges; the only version constraint is `engines.vscode`, and it constrains compatibility with the host, not relations between extensions—when the host is not new enough, the marketplace installs an older version that is still compatible, rather than letting two versions coexist. How breaking changes actually travel in this ecosystem is this proposal's first road: republish under a new id, leave the old one in place.

Helix offers another angle. Its extension point is tree-sitter grammars, and a grammar is pinned to an exact commit in `languages.toml` as `[[grammar]] source = { git = …, rev = … }`, one record per grammar name. Version conflict simply does not exist there, because a grammar is data: nothing links against it, no signature needs to align, and "version" degenerates into "which commit to take." This is directly useful to us: grammar contributions for syntax highlighting are likewise data on our side, this proposal's constraint does not apply to them, and that is exactly why they should go straight into the platform's slot without reading a configuration section (see PRFC-0004).

The cautionary tale is OSGi: one of the few hosts that has both a global registry and a commitment to multi-version coexistence, by giving every bundle its own ClassLoader—and what it bought is precisely the long-criticized family of problems where "the same class in another bundle is not the same class."

Taken together, this proposal takes VS Code's identity model—one copy per installation, identity is the name, breaking versions republish under a new name—and the rejection shape of Cargo's `links`: globally unique names, refused by name at resolution time. It does not take npm's and Cargo's leniency toward ordinary dependencies, because that leniency rests on "the two copies never meet," while our interface table requires precisely that everything meets in the same namespace.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

To what granularity the installation face refuses is not yet settled. Refuse every same-name-different-version outright, or allow "upgrade" as an explicit action—uninstall first, then install? The latter is convenient, but it must be made clear whether a plugin in active use can swap versions in place.

Whether splitting installations suffices will be seen in practice. If "one Project, one machine" turns from an escape hatch into the normal way of working, the Machine-side costs—one data root and one installation push per machine—become the dominant cost, and at that point in-process isolation will have to be reassessed.

## Future possibilities
[future-possibilities]: #future-possibilities

Since an installation holds only one copy, "which version is installed, and from where" has a definite answer, worth showing directly on the plugins page.

When multiple Machines each hold their own provision set, a comparison table of "which machine runs which version" would make the "split into two installations" road much easier to walk.

If "a breaking version is a new plugin" becomes the normal practice, the plugin catalog could offer conventions for it—for example, showing the same author's `foo` and `foo2` as two generations of one lineage. But that belongs to the catalog's design, and is not a reason to accept this document.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the current version of the draft carried by design PR [#106](https://github.com/Prism-Shadow/penguin-harness-design/pull/106), identical to the source file.
