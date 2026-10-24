# PRFC-0024 CLI Resolution: every channel resolves its CLI by declaration

[中文版](PRFC-0024-cli-resolution.zh.md)

- Feature Name: `cli-resolution`
- Start Date: 2026-10-23
- PRFC PR: none yet (native to this repository)
- Implementation PR: — (carried by its own implementation pull request once this RFC lands)

## Summary
[summary]: #summary

This RFC makes the choice of which CLI entry to run a named problem — **resolution** — shared by every consumer that runs the harness's CLI: server startup, remote machine commands, the push gate, and the user-facing command shim. Resolution answers from what the installation declares and what [harness meta](./PRFC-0023-harness-meta.md#guide-level-explanation) holds. Every [distro channel](./PRFC-0021-distros.md#guide-level-explanation)'s product ships a **pushed-CLI loader**, and a resolution that cannot find a usable loader answers with a named fault.

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

### Identity by declaration

The loader identifies itself by declaration: an exported identity constant, a declaration in the package manifest, or a pointer in the record; which carrier wins is left open below. Resolution discovers the loader from the declaration. A rename that keeps the declaration intact is invisible to resolution; a rename that breaks it becomes a named fault at the point of discovery.

### Every channel ships its loader

Every channel's product carries a loadable pushed-CLI loader, asserted at build time on the release surface, so that reshaping a product does not silently drop the half of the harness that loads pushed code. What the assertion checks — entry and loader both present and loadable in every artifact — is this RFC's claim; how the release workflow phrases its failure is left open below.

### A fault is named

A resolution that cannot find a usable loader answers at the point of failure with a named fault. Where a lesser entry then runs anyway — the installed CLI in place of the pushed one — that fallback is a recorded, named decision. "A server that starts beats one that does not" stays available as a choice and stops being available as an accident. A rename that makes the pushed path vanish then becomes a report visible at install time.

### Cross-version peers

Remote commands resolve the peer's loader by asking: the peer declares, the caller reads, and the pair falls back to the legacy name during the transition window. Machines outlive their installers; the window and the probe's shape are candidates below, and the direction is fixed — a remote command no longer depends on one side's private spelling.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### The four consumers, one answer

1. **Startup** — a server that can re-spawn asks resolution for the entry and re-asks at every spawn, so a fresh push is picked up on the next restart without a reinstall.
2. **Remote machine commands** — the caller resolves what the peer declares and assembles no hard path; the probe comes first, and its outcome decides between the declared loader, the legacy name, and a named refusal.
3. **The push gate** — a candidate push is smoke-tested through the loader the receiving installation will actually run; a gate that tests a different loader from the one that will run is a gate on the wrong door.
4. **The command shim** — what the data root exposes on the user's `PATH` is resolution's answer, so the person typing `penguin` gets the same entry a supervisor would.

### Carriers of identity *(candidates)*

An exported constant from the loader module; a declaration in the package's manifest; a pointer in the harness meta record. The candidates differ in where a stale implementation fails loudly. The choice is left to the implementation round, with one fixed requirement: the carrier is a declaration, something a reader can consult.

### The transition window *(candidate)*

Machines installed before the declaration exists answer by the legacy name; callers try the declared identity first and fall back to the legacy spelling during the window; the window closes when the release line carrying declarations has reached the machines a deployment cares about. The length and the exact probe are implementation questions; the two-step shape — new name preferred, old name still honored — is recorded as a candidate.

### Channel assertions at build time *(candidate)*

The release surface asserts, per artifact: the entry exists, the loader exists beside or within it, and both load. The assertion belongs to the release workflow because the failure it catches is cross-package: an entry reshaped in one package while the loader beside it was reshaped in another.

### The two gap channels

For the channel whose `PATH` entry is an extension-less symlink, the entry gains a re-runnable shape (a real file, or a launcher), so resolution works there as everywhere else. For the desktop channel, an implementation line already demonstrates the shape — the shell starts through a launch entry that consults the record and runs the pushed CLI when there is one — and this RFC adopts the direction, with the entry's exact form left to the implementation.

### Division of labor with PRFC-0023

Resolution depends on presence: a reader that can trust the record to exist never has to guess around an absence. This RFC owns the seam declared there: harness meta states what a root holds, and resolution decides what runs.

## Invariants
[invariants]: #invariants

### Identity by declaration

> However artifacts are named or renamed across [distro channels](./PRFC-0021-distros.md#guide-level-explanation), [resolution](./PRFC-0024-cli-resolution.md#guide-level-explanation) still identifies the [pushed-CLI loader](./PRFC-0024-cli-resolution.md#guide-level-explanation) by declaration or record.

This is the property the whole RFC fixes. A name shared by convention across packages and machines fails three different ways at run time when it changes; a future rework that reintroduces recognition by file name brings that pattern back with it.

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
- The length of the transition window and the exact shape of the peer probe.
- Whether a failed build-time assertion is a hard release failure or a warning during the window.
- The exact entry shape for the two gap channels: the desktop launch entry's placement, and what the symlink channel's `PATH` face becomes.

## Future possibilities
[future-possibilities]: #future-possibilities

Resolution generalizes: the web assets and the platform halves of a push can be asserted per channel the way the loader is here, closing the "half-updatable product" shape for good. Peer capability negotiation — a peer declaring its loader, its version and its abilities — grows naturally out of the probe this RFC introduces.

---

## Changes

### v1.0.0

- Initial version (draft, native to this repository).
