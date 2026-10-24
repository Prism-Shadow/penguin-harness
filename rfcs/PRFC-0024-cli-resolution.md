# PRFC-0024 CLI Resolution: every channel resolves its CLI by declaration

[中文版](PRFC-0024-cli-resolution.zh.md)

- Feature Name: `cli-resolution`
- Start Date: 2026-10-23
- PRFC PR: none yet (native to this repository)
- Implementation PR: — (carried by its own implementation pull request once this RFC lands)

## Summary
[summary]: #summary

This RFC makes the choice of which CLI entry to run a named problem — **resolution** — shared by every consumer that runs the harness's CLI: server startup, remote machine commands, the push gate, and the user-facing command shim. Resolution answers from what the installation declares and what [harness meta](./PRFC-0023-harness-meta.md#guide-level-explanation) holds. Every [distro channel](./PRFC-0021-distros.md#guide-level-explanation)'s product ships a **pushed-CLI loader**, and a resolution that cannot find a usable loader answers with a named fault. The answer is a decision procedure with a fixed order: each state of the record and the declaration yields one entry or one named fault.

## Motivation
[motivation]: #motivation

### The loader's identity is a file name today

The pushed-CLI loader's identity is a file name agreed by convention across packages, versions, and machines. No declaration anywhere says "this is the loader"; the name is spelled independently in five places — a remote-command path, a startup check, a desktop launcher, the push gate, a package's bin map. When the name changes, those places break in three ways: one loudly, two silently, all at run time. A name used as a protocol field with nobody managing it as a protocol is the defect in one sentence.

### Two channels where the pushed CLI cannot arrive

The desktop product ships no loader at all; the Docker image's `PATH` entry is an extension-less symlink, which defeats the re-runnable start the mechanism depends on. On both channels a hot push of the CLI is received into the record and never runs, while the platform and web halves of the same push take effect — a product that is only half-updatable, the quietest way to break.

### The rework needs ground to stand on

The pushed CLI's rework is next: renaming, reshaping entries, changing how servers start, each of them walking across the scattered spellings of the name. Resolution as one declared, shared answer is the ground that rework needs; leaving resolution implicit is how a rename turns into one of three kinds of outage.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### The concepts

- **The installed entry** — the CLI entry a channel's product installs and a person types; what runs when nothing else is known.
- **The pushed-CLI loader** — the entry that loads whichever CLI the data root's record points at; it is itself a product of the installation and survives hot pushes.
- **Resolution** — the shared question "which entry runs this command", answered from what the installation declares and what the record holds.

### Every consumer asks the same question

A server supervisor deciding which entry to re-spawn, a remote machine command deciding what to invoke on the peer, the push gate deciding which loader to smoke-test a candidate against, and the command shim deciding what to put on the user's `PATH` — four consumers, one question. Today each answers it privately, with its own spelling and its own fallback habit; this RFC gives them one answer to share.

### Resolution answers in a fixed order

Resolution reads the record first and the declaration second. A root with no record runs the installed entry, a damaged record is a fault, and a record with a pushed CLI picks the loader. The loader answers `pushed` when the declaration names it and `legacy` when only the pre-declaration name does; a product that declares no loader and carries no legacy loader answers a fault. Every answer carries its name, and each consumer records the name it acted under.

### Identity by declaration

The loader identifies itself by declaration: an exported identity constant, a declaration in the package manifest, or a pointer in the record; which carrier wins is left open below. Resolution discovers the loader from the declaration. A rename that keeps the declaration intact is invisible to resolution; a rename that breaks it becomes a named fault at the point of discovery.

### Every channel ships its loader

Every channel's product carries a loadable pushed-CLI loader, asserted at build time on the release surface, so that reshaping a product does not silently drop the half of the harness that loads pushed code. What the assertion checks — entry and loader both present and loadable in every artifact — is this RFC's claim; how the release workflow phrases its failure is left open below.

### A fault is named

A resolution that cannot find a usable loader answers at the point of failure with a named fault; the reference section fixes the names. Where a lesser entry then runs anyway — the installed CLI in place of the pushed one — that fallback is a recorded, named decision. "A server that starts beats one that does not" stays available as a choice and stops being available as an accident. A rename that makes the pushed path vanish then becomes a report visible at install time.

### Cross-version peers

Remote commands resolve the peer's loader by asking: the peer declares, the caller reads, and the pair falls back to the legacy name during the transition window. Machines outlive their installers; the window and the probe's shape are candidates below, and the direction is fixed — a remote command no longer depends on one side's private spelling.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### The four consumers, one answer

1. **Startup** — a server that can re-spawn asks resolution for the entry and re-asks at every spawn, so a fresh push is picked up on the next restart without a reinstall.
2. **Remote machine commands** — the caller resolves what the peer declares and assembles no hard path; the probe comes first, and its outcome decides between the declared loader, the legacy name, and a named refusal.
3. **The push gate** — a candidate push is smoke-tested through the loader the receiving installation will actually run; a gate that tests a different loader from the one that will run is a gate on the wrong door.
4. **The command shim** — what the data root exposes on the user's `PATH` is resolution's answer, so the person typing `penguin` gets the same entry a supervisor would.

### Resolution: the inputs and the order

Resolution takes four inputs: the caller's own entry, the data root, the record that root holds, and the declaration the caller's product carries. Its answers are one entry with a reason, or one fault with a name.

1. **Self.** A caller whose own entry is the loader answers with itself, under the reason its name earns: `pushed` for the declared loader, `legacy` for the legacy name. The rule keeps a loader from loading itself.
2. **The record.** The meta reader of [PRFC-0023](./PRFC-0023-harness-meta.md#reference-level-explanation) answers with the record, no record, or a damaged record.
3. **No record.** A root that holds no record holds no pushed CLI, so the installed entry runs, under the reason `no-record`.
4. **A damaged record.** A record the reader cannot read or parse answers the fault `damaged-record`.
5. **The CLI pointer.** A record with no CLI entry at all holds no pushed CLI, so the installed entry runs, under the reason `no-pushed-cli`.
6. **An unusable pointer.** A CLI entry with no pointer, an empty or malformed pointer, or a pointer that resolves outside the store answers the fault `cli-pointer-unusable`.
7. **A pointer with no file.** A pointer the store no longer holds answers the fault `cli-bundle-missing`.
8. **The declared loader.** A product that declares a loader answers it under the reason `pushed` when the target is present, and the fault `loader-missing` when the target is absent.
9. **The legacy loader.** A product that declares no loader answers the legacy loader under the reason `legacy` while the transition window is open and that loader is present; with neither a declaration nor a legacy loader the answer is the fault `loader-absent`.

The first step that applies decides the answer, and later steps stay unread.

### The cases and their answers

| Record | CLI pointer | Declaration | Answer |
| --- | --- | --- | --- |
| record | present, file in the store | declared loader present | the loader — `pushed` |
| record | present, file in the store | declared loader absent | fault `loader-missing` |
| record | present, file in the store | no declaration, legacy loader present, window open | the legacy loader — `legacy` |
| record | present, file in the store | no declaration, no legacy loader | fault `loader-absent` |
| record | present, file missing from the store | any | fault `cli-bundle-missing` |
| record | present, pointer unusable | any | fault `cli-pointer-unusable` |
| record | no CLI entry | any | the installed entry — `no-pushed-cli` |
| no record | — | any | the installed entry — `no-record` |
| damaged record | — | any | fault `damaged-record` |
| the caller is the loader | — | — | the caller itself — `pushed` or `legacy` |

Presence decides the answer; loading is a report of its own. A loader present on disk that cannot load the CLI reports `loader-unloadable` as its first act, and a consumer that probes — the push gate before it accepts a push, the release assertion before it ships an artifact — turns a failed probe into that same fault before anything runs.

A consumer acts on the answer. A supervisor that must start a server runs the installed entry when the answer is a fault and records the fault name. The loader runs nothing on a fault and reports it, and reports `no-record` when a person or a remote command invokes it on a root that holds no record. A remote command surfaces the peer's fault unchanged. The command shim carries resolution's answer, so the entry a person reaches is the entry a supervisor would run. A consumer whose own entry cannot be re-spawned — an extension-less symlink on `PATH`, a source run through a TypeScript runner — runs the server in process and records the condition `entry-not-respawnable`.

### What each channel answers

Every channel's product installs one entry and declares one loader, and provisioning writes the root's first record ([PRFC-0023](./PRFC-0023-harness-meta.md#guide-level-explanation)). The table reads resolution's answer per channel, at the first run and after a push.

| Channel | Installed entry | Declared loader | First run | After a push |
| --- | --- | --- | --- | --- |
| npm package | the main CLI bin | the loader bin beside it | the loader — `pushed` | the loader — `pushed` |
| release tarball, universal included | the launcher script | the loader beside the installed CLI pair | the loader — `pushed` | the loader — `pushed` |
| Docker image | the extension-less symlink today, a re-runnable entry after the change below | the loader inside the image | the loader — `pushed`; the symlink entry answers `entry-not-respawnable` until it is reshaped | the loader — `pushed` |
| desktop application | the bundled CLI, started through the shell's launch entry | the packaged loader beside the launch entry | the loader — `pushed`; a product built without the loader answers `loader-absent` | the loader — `pushed` |
| source checkout | the built CLI; a source run has no re-runnable entry | the loader beside the built CLI | built run: the loader — `pushed`; source run: `entry-not-respawnable` | the loader — `pushed`; the dev root's provisioning stays open below |
| machines-installed peer | the loader, which is the peer's only CLI face | the same loader | the loader — `pushed`; a bare release never installed from a peer answers `no-record` | the loader — `pushed` |

A remote command is the one consumer that resolves across machines: it reads the peer's declaration and invokes the declared loader, and a peer built before declarations answers by the legacy name. The peer's own resolution then runs, so a peer whose record is damaged reports `damaged-record`, and a peer that was never pushed and never installed from a peer reports `no-record`.

### The transition window

The legacy name is the loader's file name in products built before the declaration: `penguin-hmr.js`. Resolution reads the declaration first and the legacy name second, and reaches the legacy name only where no declaration exists. An answer from the legacy name is recorded as `legacy`, so the window stays visible while it lasts.

A declaration that names a missing or unloadable loader answers its fault alone, and the legacy name stays unread. A new product with a broken declaration is a broken installation, and a fallback would hide it.

The window closes when the release line carrying declarations reaches the machines a deployment cares about. After that, the products drop the legacy branch, and a product without a declaration answers `loader-absent`. The length of the window, and the exact shape of the probe a caller uses on a peer, stay open below.

### Carriers of identity *(candidates)*

An exported constant from the loader module; a declaration in the package's manifest; a pointer in the harness meta record. The candidates differ in where a stale implementation fails loudly. The choice is left to the implementation round, with one fixed requirement: the carrier is a declaration, something a reader can consult.

### Channel assertions at build time *(candidate)*

The release surface asserts, per artifact: the entry exists, the loader exists beside or within it, and both load. The assertion belongs to the release workflow because the failure it catches is cross-package: an entry reshaped in one package while the loader beside it was reshaped in another.

### The two gap channels

For the channel whose `PATH` entry is an extension-less symlink, the entry gains a re-runnable shape (a real file, or a launcher), so resolution works there as everywhere else. For the desktop channel, an implementation line already demonstrates the shape — the shell starts through a launch entry that consults the record and runs the pushed CLI when there is one — and this RFC adopts the direction, with the entry's exact form left to the implementation.

### Division of labor with PRFC-0023

Resolution depends on presence: a reader that can trust the record to exist never has to guess around an absence. This RFC owns the seam declared there: harness meta states what a root holds, and resolution decides what runs.

## Invariants
[invariants]: #invariants

### Declarations identify, names are recorded

> However artifacts are named or renamed across [distro channels](./PRFC-0021-distros.md#guide-level-explanation), [resolution](./PRFC-0024-cli-resolution.md#guide-level-explanation) still identifies the [pushed-CLI loader](./PRFC-0024-cli-resolution.md#guide-level-explanation) by the declaration its product carries, and a file name answers only where no declaration exists, recorded as a legacy answer.

This is the property the whole RFC fixes. A name shared by convention across packages and machines fails three different ways at run time when it changes; a future rework that reintroduces recognition by file name brings that pattern back with it. The legacy name is the one place a name still answers, and it answers only while a product declares nothing; the answer is recorded, so the window can close on evidence and a name never sits beside a declaration.

### Every channel ships its loader

> However a [distro channel](./PRFC-0021-distros.md#guide-level-explanation)'s product is reshaped, it still ships the [pushed-CLI loader](./PRFC-0024-cli-resolution.md#guide-level-explanation); a product that cannot load pushed code is incomplete.

A channel that drops the loader silently splits its own update surface: platform and web pushes land, CLI pushes rot in the record. The invariant is what the build-time assertion defends; the assertion's wording can change, and the property may not be retired by accident.

### A fault is named

> However [resolution](./PRFC-0024-cli-resolution.md#guide-level-explanation) falls back to a lesser entry, the fallback is still a named, recorded decision.

Fallbacks are fine: a server that starts on the installed CLI genuinely beats one that does not. The present defect lies in the choice to fall back being made by nobody, silently, at the worst moment. Naming the fault turns a rework-discovered breakage into an installation-discovered one.

## Drawbacks
[drawbacks]: #drawbacks

A declared identity is one more protocol surface to design, version, and honor across an ecosystem of older machines. The transition window means two spellings are true at once, and someone must remember which one a given peer answers to. The probe adds a round trip to remote commands. Build-time assertions make the release more brittle — which is the point, and the cost is real: a red release for a missing loader is a red release.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**The cost of the file-name convention**: the name is already a protocol field — cross-package, cross-version, cross-machine — and the survey found nobody managing it as one; the convention is not cheaper, its bill simply arrives later, at run time.

**Build-time checks alone are not enough**: a build check sees one package's artifacts, and the breakages that matter sit between a caller's spelling and a peer's.

**One shared answer, not four private ones**: the defect's root is that every consumer answers alone; sharing the answer turns "who broke the name" from an archaeology question into a declaration's diff.

**The cost of leaving this out**: the pushed CLI rework proceeds on the word-of-mouth name, and the three-way breakage repeats, this time discovered by users.

## Prior art
[prior-art]: #prior-art

Node's `bin` map is a declared entry: a package says what it installs, and callers read the map. Java's jar manifest declares `Main-Class`, so a renamed class is a manifest edit and callers are untouched. Rust toolchains and version managers run through shims that resolve the declared tool at call time, surviving version swaps. systemd services resolve `ExecStart` from a declaration, and a missing binary is a named start failure. The shared lesson: entries that outlive renames are declared.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

A few details are left to the implementation or to a later revision.

- The carrier of identity: exported constant, package manifest, record pointer, or a combination.
- The carrier of a result name: a value, an exit code, a typed error, or a combination.
- The length of the transition window and the exact shape of the peer probe.
- Whether a failed build-time assertion is a hard release failure or a warning during the window.
- The exact entry shape for the two gap channels: the desktop launch entry's placement, and what the symlink channel's `PATH` face becomes.

## Future possibilities
[future-possibilities]: #future-possibilities

Resolution generalizes: the web assets and the platform halves of a push can be asserted per channel the way the loader is here, closing the "half-updatable product" shape for good. Peer capability negotiation — a peer declaring its loader, its version and its abilities — grows naturally out of the probe this RFC introduces.

---

## Changes

### v1.1.0

- Added the resolution procedure: four inputs, nine steps in a fixed order, and the table of cases with one entry or one named fault each.
- Added the per-channel answers: the installed entry, the declared loader, and resolution's answer at the first run and after a push, for all six channels.
- Added the transition window's handling: the legacy name answers only where no declaration exists, its answer is recorded as `legacy`, and a broken declaration answers its fault alone.
- Retired the invariant "Identity by declaration" and replaced it with "Declarations identify, names are recorded": the earlier sentence said identity comes from a declaration or the record, and the window answers by the legacy name.

### v1.0.0

- Initial version (draft, native to this repository).
