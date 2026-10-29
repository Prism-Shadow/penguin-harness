# PRFC-0024 CLI Resolution: every channel resolves its CLI by declaration

[中文版](PRFC-0024-cli-resolution.zh.md)

- Feature Name: `cli-resolution`
- Start Date: 2026-10-23
- PRFC PR: none yet (native to this repository)
- Implementation PR: — (carried by this RFC's implementation branch; no pull request yet)

## Summary
[summary]: #summary

This RFC makes the choice of which CLI entry to run a named problem — **resolution** — shared by every consumer that runs the harness's CLI: server startup, remote machine commands, the push gate, and the user-facing command shim. Resolution answers from what the installation declares and what [harness meta](./PRFC-0023-harness-meta.md#guide-level-explanation) holds. Every [distro channel](./PRFC-0021-distros.md#guide-level-explanation)'s product ships a **pushed-CLI loader** — the desktop application's does not yet — and a resolution that cannot find a usable loader answers with a named fault. The answer is a decision procedure with a fixed order: each state of the record and the declaration yields one entry or one named fault.

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

Resolution answers from the root's record and the caller product's declaration. A root with no record runs the caller's entry, a damaged record is a fault, and a record with a pushed CLI picks the product's loader: `pushed` when the declaration names it, `legacy` when only the pre-declaration name does, a fault when neither is there. A caller that is the loader itself answers with itself and carries the bundle the record names. Every answer carries its name, and each consumer records the name it acted under.

### Identity by declaration

The loader identifies itself by a field in its package manifest, `penguin.pushedCliLoader`, holding the loader's path relative to that manifest. Resolution discovers the loader from that field. A rename that keeps the field intact is invisible to resolution; a rename that breaks it becomes a named fault at the point of discovery.

### Every channel ships its loader

Every channel's product carries a loadable pushed-CLI loader, asserted at build time on the release surface, so that reshaping a product does not silently drop the half of the harness that loads pushed code. What the assertion checks — entry and loader both present and loadable in every artifact — is this RFC's claim; how the release workflow phrases its failure is left open below. One channel does not ship one today: the desktop application carries no loader, so its data root answers the fault `loader-absent` until the desktop product ships one.

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

### Where the answer lives

Resolution is one function in the command-shim module, `packages/server/src/services/cli-shim.ts` — the module that already decides which CLI the `penguin` on a person's PATH runs — published as the server package's `@prismshadow/penguin-server/cli-shim` subpath, beside `./hmr/manifest` and `./version-report`. It sits outside the hot-update layer: that layer — `packages/hmr`, `packages/server/src/hmr/` and `packages/desktop/` — carries the store and the record's mechanism, and a change there ships by rebuilding and redeploying every installation, while the decision procedure is the part a deployment may want to change without that cost. The CLI's loader imports the same subpath, so the loader and the shim act on one answer, and no channel's packaging changes.

The record's five states are read in that module. The layer's reader answers three — `readPushedCli` says nothing pushed, a bundle, or broken — merging the two "nothing pushed" states into one and the three faults into one, so the resolver reads `<root>/hmr/harness.json` itself and projects onto the layer's three answers wherever the layer answers at all. A test pins that projection, so the two readers cannot drift apart unnoticed.

### Resolution: the inputs and the order

Resolution takes the caller's own entry and the data root. It reads two things from disk: the record that root holds, and the declaration the caller's product carries in the nearest package manifest above its entry. Its answers are one entry with a reason, or one fault with a name.

1. **Self, with a pushed CLI.** A caller whose own entry is its product's loader answers with itself, under the name it earns: `pushed` for the declared loader, `legacy` for the legacy name. The answer carries the pushed bundle, so a loader never loads itself.
2. **The record.** [PRFC-0023](./PRFC-0023-harness-meta.md#reference-level-explanation)'s record is read into the states steps 5 to 7 name; the resolver reads the file itself, because the layer's reader merges them (see "Where the answer lives").
3. **The declared loader.** A product that declares a loader answers it under the reason `pushed` when the target is present, and the fault `loader-missing` when the target is absent or the declaration is broken.
4. **The legacy loader.** A product that declares no loader answers the legacy loader under the reason `legacy` while the transition window is open and that loader is present; with neither a declaration nor a legacy loader the answer is the fault `loader-absent`.
5. **No record.** A root that holds no record holds no pushed CLI: the caller's own entry runs, under the reason `no-record`.
6. **The CLI pointer.** A record with no CLI entry at all holds no pushed CLI: the caller's own entry runs, under the reason `no-pushed-cli`.
7. **A record the resolver cannot use.** A record it cannot read or parse answers `damaged-record`; a CLI pointer with no path, an empty one, or one outside the store answers `cli-pointer-unusable`; a pointer whose file the store no longer holds answers `cli-bundle-missing`.

The first case that applies decides the answer. Cases 3 and 4 apply to a record that holds a pushed CLI; cases 5 to 7 apply to one that holds none.

### The cases and their answers

| Record | CLI pointer | Declaration | Answer |
| --- | --- | --- | --- |
| record | present, file in the store | declared loader present | the loader — `pushed` |
| record | present, file in the store | declared loader absent | fault `loader-missing` |
| record | present, file in the store | no declaration, legacy loader present, window open | the legacy loader — `legacy` |
| record | present, file in the store | no declaration, no legacy loader | fault `loader-absent` |
| record | present, file missing from the store | any | fault `cli-bundle-missing` |
| record | present, pointer unusable | any | fault `cli-pointer-unusable` |
| record | no CLI entry | any | the caller's own entry — `no-pushed-cli` |
| no record | — | any | the caller's own entry — `no-record` |
| damaged record | — | any | fault `damaged-record` |
| a pushed CLI, and the caller is its product's loader | — | — | the caller itself — `pushed` or `legacy` |

Presence decides the answer; loading is a report of its own. A loader present on disk that cannot load the CLI reports `loader-unloadable` as its first act, and a consumer that probes — the push gate before it accepts a push, the release assertion before it ships an artifact — turns a failed probe into that same fault before anything runs. A loader invoked on a root that holds no pushed CLI answers the reason of the last three cases, `no-record` or `no-pushed-cli`, or their fault: it is the entry there.

A consumer acts on the answer. A supervisor that must start a server runs the installed entry when the answer is a fault and records the fault name. The loader runs nothing on a fault and reports it, and reports `no-record` when a person or a remote command invokes it on a root that holds no record. A remote command surfaces the peer's fault unchanged. The command shim carries resolution's answer, so the entry a person reaches is the entry a supervisor would run. A consumer whose own entry cannot be re-spawned — an extension-less symlink on `PATH`, a source run through a TypeScript runner — runs the server in process and records the condition `entry-not-respawnable`.

### The declaration's shape

A product declares its loader in the package manifest of the package that ships it:

```json
"penguin": { "pushedCliLoader": "./dist/penguin-hmr.js" }
```

The value is a path relative to the manifest's directory, and resolution resolves it there; a value that climbs out of the package names no loader. A reader finds the manifest by walking up from the entry it holds — the nearest package manifest is the product's own — and resolves a bin symlink or a `PATH` link to the file it names first.

The field gives three answers, kept apart because the decision order treats them differently: declared, absent for a product from before the declaration, and broken for a field that names no usable file. A broken field answers `loader-missing`, and the legacy name stays unread.

The declaration travels with the product: the npm package ships its manifest, the release payload's `lib/` is that same package deployed with the field intact, the Docker image copies that `lib/`, the desktop application ships its own manifest beside its bundles, and a source checkout has the manifest in the tree. A peer's declaration is the same file in its program directory, so a caller reads it instead of spelling a path.

### What each channel answers

Every channel's product installs one entry, every product but the desktop application's declares a loader, and provisioning writes the root's first record ([PRFC-0023](./PRFC-0023-harness-meta.md#guide-level-explanation)). The table reads resolution's answer per channel, at the first run and after a push.

| Channel | Installed entry | Declared loader | First run | After a push |
| --- | --- | --- | --- | --- |
| npm package | the main CLI bin | the loader bin beside it | the loader — `pushed` | the loader — `pushed` |
| release tarball, universal included | the launcher script | the loader beside the installed CLI pair | the loader — `pushed` | the loader — `pushed` |
| Docker image | the extension-less symlink today, a re-runnable entry after the change below | the loader inside the image | the loader — `pushed`; the symlink entry answers `entry-not-respawnable` until it is reshaped | the loader — `pushed` |
| desktop application | the bundled CLI, started through the shell's launch entry | none today: the product ships no loader | fault `loader-absent` — the channel's gap, still open | fault `loader-absent`, until the product ships a loader |
| source checkout | the built CLI; a source run has no re-runnable entry | the loader beside the built CLI | built run: the loader — `pushed`; source run: `entry-not-respawnable` | the loader — `pushed`; the dev root's provisioning stays open below |
| machines-installed peer | the loader, which is the peer's only CLI face | the same loader | the loader — `pushed`; a bare release never installed from a peer answers `no-record` | the loader — `pushed` |

A remote command is the one consumer that resolves across machines: it reads the peer's declaration and invokes the declared loader, and a peer built before declarations answers by the legacy name. The peer's own resolution then runs, so a peer whose record is damaged reports `damaged-record`, and a peer that was never pushed and never installed from a peer reports `no-record`.

### The transition window

The legacy name is the loader's file name in products built before the declaration: `penguin-hmr.js`. Resolution reads the declaration first and the legacy name second, and reaches the legacy name only where no declaration exists. An answer from the legacy name is recorded as `legacy`, so the window stays visible while it lasts.

A declaration that names a missing or unloadable loader answers its fault alone, and the legacy name stays unread. A new product with a broken declaration is a broken installation, and a fallback would hide it.

The window closes when the release line carrying declarations reaches the machines a deployment cares about. After that, the products drop the legacy branch, and a product without a declaration answers `loader-absent`. The length of the window, and the exact shape of the probe a caller uses on a peer, stay open below.

### Carriers of identity

The carrier is the package manifest's `penguin.pushedCliLoader` field. Three properties decide it. A reader consults a manifest without running the product, which a person, a remote caller and a release assertion all need. A manifest belongs to one product, so each channel declares the loader its own artifact ships. And every channel's packaging already carries a manifest, so the declaration needs no second delivery mechanism.

The other two candidates each miss one of those. An exported identity constant is readable by running the product's code, which a remote caller and a build assertion cannot do. A pointer in the record describes one data root rather than a product, and a root that holds no record still has a loader to find.

### Channel assertions at build time *(candidate)*

The release surface asserts, per artifact: the entry exists, the loader exists beside or within it, and both load. The assertion belongs to the release workflow because the failure it catches is cross-package: an entry reshaped in one package while the loader beside it was reshaped in another. The desktop application's packed-tree check would be the first instance — it would fail a build whose manifest declares no loader, or whose declared loader did not travel into the app — and that check arrives with the loader itself.

### The two gap channels

For the channel whose `PATH` entry is an extension-less symlink, the entry gains a re-runnable shape (a real file, or a launcher), so resolution works there as everywhere else; the shape is still open below. For the desktop application, the product would ship the loader beside its bundled CLI and declare it in its own manifest, so that a desktop data root runs a pushed CLI like the other five channels. That change is not part of this version: the desktop package belongs to the hot-update layer, whose changes ship by rebuilding and redeploying every installation, so a desktop data root answers `loader-absent` today.

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

A few details stay open, each with the reason it cannot be settled here.

- The carrier of a result name: a value, an exit code, a typed error, or a combination. A consumer needs a name it can record and compare; which of the three carries it depends on the consumer, and the resolver now answers a value while a loader reports through its exit status.
- The length of the transition window: a release decision, because the window closes only when the release line carrying declarations has reached the machines a deployment cares about.
- The exact shape of the peer probe: it depends on what an older peer can answer, and no field in a manifest tells a caller how to ask.
- Whether a failed build-time assertion is a hard release failure or a warning during the window: the assertion is new, and the release has to carry it for a while before its false positives are known.
- What the symlink channel's `PATH` face becomes. The extension-less link is still what that image exposes, and reshaping it changes how a person reaches the CLI there.
- When the desktop application ships its loader. The product carries none, so its data root answers `loader-absent`; the change belongs to the hot-update layer.
- Whether the record's five states move into the layer's reader, leaving resolution a projection over one reader instead of a second reader of the same file.

## Future possibilities
[future-possibilities]: #future-possibilities

Resolution generalizes: the web assets and the platform halves of a push can be asserted per channel the way the loader is here, closing the "half-updatable product" shape for good. Peer capability negotiation — a peer declaring its loader, its version and its abilities — grows naturally out of the probe this RFC introduces.

---

## Changes

### v1.3.0

- Resolution lives in the command-shim module, `packages/server/src/services/cli-shim.ts`, published as `@prismshadow/penguin-server/cli-shim`: one function beside the code that already decides what `penguin` runs, where v1.2.0 had a module of its own.
- The answer carries the pushed bundle, so the loader reads the record once, through the same function the shim uses. The record's five states and the declaration's three answers stay; the second record reader and the helper that projected it are gone.
- The order is restated in seven cases: with a pushed CLI, a caller that is its loader answers itself and then the declared loader, the legacy loader, or a fault; without one, the caller's entry runs under `no-record` or `no-pushed-cli`, or the record's fault answers.

### v1.2.0

- Decided the carrier of identity: the package manifest's `penguin.pushedCliLoader` field, with the reasons and the two rejected candidates in "Carriers of identity".
- Added the declaration's reference shape: the field, its resolution against the manifest's directory, the walk from an entry to its package's manifest, and the declared, absent and broken answers.
- Added the record's five states as the resolver reads them: no record, damaged, no CLI section, unusable pointer, and pointer with no file. The layer's reader keeps its three answers; the resolver reads the record itself and projects onto them.
- Carried the procedure into code: one resolver answers which entry runs; the pushed-CLI loader reports its answer by name, and the command shim runs it. It lives outside the hot-update layer, published as a server-package subpath (see "Where the answer lives"). Machine remote commands and the push gate still answer privately.
- The Machines page reads the loader's failures by name — the reports this version introduces, and the sentences releases shipped before them — so a machine whose store holds no CLI keeps its "install it again from this page" remedy whichever release installed it.
- The desktop channel stays open: its product ships no loader and declares none, so a desktop data root answers `loader-absent`. Closing it changes the desktop package, which belongs to the hot-update layer.

### v1.1.0

- Added the resolution procedure: four inputs, nine steps in a fixed order, and the table of cases with one entry or one named fault each.
- Added the per-channel answers: the installed entry, the declared loader, and resolution's answer at the first run and after a push, for all six channels.
- Added the transition window's handling: the legacy name answers only where no declaration exists, its answer is recorded as `legacy`, and a broken declaration answers its fault alone.
- Retired the invariant "Identity by declaration" and replaced it with "Declarations identify, names are recorded": the earlier sentence said identity comes from a declaration or the record, and the window answers by the legacy name.

### v1.0.0

- Initial version (draft, native to this repository).
