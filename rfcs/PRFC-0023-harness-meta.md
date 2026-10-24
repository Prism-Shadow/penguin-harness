# PRFC-0023 Harness Meta: every data root carries the record of its harness

[中文版](PRFC-0023-harness-meta.zh.md)

- Feature Name: `harness-meta`
- Start Date: 2026-10-23
- PRFC PR: none yet (native to this repository)
- Implementation PR: — (carried by its own implementation pull request once this RFC lands)

## Summary
[summary]: #summary

This RFC makes **harness meta** a required part of every data root: the file `hmr/harness.json` inside the root, recording which harness — platform, CLI, web, assets — the root currently holds. When a [distro channel](./PRFC-0021-distros.md#guide-level-explanation) provisions a data root, it lays the harness image its product carries down as that root's initial record, and that provisioning is a self-push. The meta reader has one affirmative result — the record's path and content — and every other situation arrives as a named exception, with a missing record and a damaged record under two different names.

## Motivation
[motivation]: #motivation

### Provisioning writes no record today

In the current state, harness meta is written by two events only: a hot push being received, and a machine install copying the sender's record. Every other channel's root starts without that file, and the cost shows up at once: on a machine installed yesterday the pushed-CLI loader answers "nothing pushed", version reports degrade to fewer facts, and a machine that was never pushed and never installed from a peer has no working remote-command face.

### The raw material already ships in every product

The release tarball and the desktop application already carry a complete harness image of their own build, in push format. They lay it beside themselves for machine installs and deliberately keep it out of the data root. So the decision that provisioning writes it down is what presence misses; the material already arrives at every machine's doorstep.

### The reader keeps one success and named failures

The HMR layer landed with a criterion: a missing record and a damaged record are two different facts, and the reading face reports each under its own name. Presence redefines absence, so this RFC fixes the reading face first: one affirmative result, the record itself, and named exceptions for every other situation. Provisioning then writes the record from the first moment a root exists.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### The concepts

- **Harness meta** — the record in a data root that says which harness the root currently holds: the file `hmr/harness.json`, holding content-addressed pointers to platform, CLI, and web assets together with their provenance.
- **Harness data root** — the per-machine root that stores the harness's state and stores; a [distro channel](./PRFC-0021-distros.md#guide-level-explanation) provisions it.
- **The meta reader** — the single reading entry of harness meta. It has one affirmative result: the record — the path `hmr/harness.json` under the root and the content it holds. Every other situation is a named exception, and two of them are the ones callers act on: **no record** (this root has never been provisioned or pushed) and **damaged record** (a record exists and cannot be read or parsed).

### Provisioning is a self-push

When a channel provisions a data root, it lays the harness image its product carries down as the root's initial record, with provenance marked as installed by this channel. The reading face sees the same thing it sees for a pushed record: it answers with the record, the machine's pushed-CLI face works from the first moment, and the first hot push replaces the record as any push replaces any record.

### What "no record" says after presence

Absence narrows from every freshly installed machine to roots that were never provisioned: a bare directory someone pointed the harness at, or a provisioning that could not write. Both exceptions keep their names. A provisioned root that was never pushed says "installed by channel X, never pushed" through its provenance, and it answers with its record.

### Presence leaves the entry alone

The record states what this root holds; which entry starts is decided by resolution, in [PRFC-0024](./PRFC-0024-cli-resolution.md#guide-level-explanation). A dev root carrying an install record still starts the dev way; the desktop shell still starts its server its own way.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### Where the record lives

The record is one file: `hmr/harness.json` inside the harness data root. The data root is the directory `PENGUIN_HOME` names, `~/.penguin/data` when it names none. The blobs the record points at live beside it under `hmr/store/`, and every pointer inside the record is relative to `hmr/`.

That relative path holds on every channel. What differs between channels is which directory each one makes its data root: the tarball, npm, and source channels use the directory above, the Docker image its mounted volume, the desktop application its profile directory, and a machines-installed peer the root it was installed into. A channel chooses the root; this RFC fixes the layout inside it.

### The minimal shape of the record

Content-addressed pointers to the three payload kinds plus assets; a provenance field that distinguishes installed (and by which channel) from pushed; and a marker for "provisioned, never pushed", so the narrowed absence stays expressible. The exact field shape is left to the implementation; this RFC fixes the reader's contract: one file at a fixed path, one affirmative result, provenance readable.

### One affirmative result, two named failures

The reader returns the record or raises. Two situations carry their own names: **no record**, for a root that holds nothing at the path, and **damaged record**, for a file that cannot be read or parsed. Each exception names the file it looked for. These two names are what callers branch on, and a reader that merges them, or that guesses around an absence, silently reverts the criterion this surface landed with. Presence makes the missing-record exception rarer and keeps it in place: roots that were never provisioned still exist, and they stay distinguishable from a root whose record is damaged.

### Provisioning writes the initial record

Per channel: the tarball's install scripts and the desktop's first run lay down the image the product already carries; the npm package and the Docker image gain an image of their own build at build time and lay it down the same way; a machines-installed peer keeps copying the sender's record at install. Every hand-installed release arrives pre-provisioned from now on. A provisioning that cannot write its record raises a named fault of its own at that moment. Handling of read-only or unwritable media is left to the implementation.

### One store, mirrored only in flight *(candidate)*

Today the release image and the checkout image live as parallel stores beside the data root's own store. Once provisioning writes the initial record, those mirrors become inputs: the channel's image is copied once, at provision time, and the data root's store is the only store that lives. Whether the mirrors are retired in the same motion or later is left open and recorded as a candidate.

### Store health is observable *(candidate)*

A record's files can be damaged in place. The reader names such damage when asked, but no channel asks unprompted today, and version reports merge "no record" with "damaged record" into a shrug. With the record always present, its health is worth surfacing: first-run and version surfaces name a damaged record, so the degradation becomes visible. The carrier and thresholds are left open and recorded as a candidate.

### Each channel's facets after this RFC

Every channel's **harness data root** facet becomes "provisioned with meta at provision time"; the machines-installed peer keeps its copy-at-install behavior and gains nothing; the two channels whose products carry an image start carrying it for themselves as well as for machine installs.

## Invariants
[invariants]: #invariants

### Meta is always present

> However a [distro channel](./PRFC-0021-distros.md#guide-level-explanation) provisions a machine, the [harness data root](./PRFC-0023-harness-meta.md#guide-level-explanation) it provisions carries [harness meta](./PRFC-0023-harness-meta.md#guide-level-explanation) from the first moment the root exists.

This is the floor this RFC lays, stated as a property of channels: whatever a channel does to a machine, the machine it leaves behind has a root that says what it holds. A future channel that ships a product without writing the record breaks this RFC.

### Each failure keeps its own name

> However meta comes to exist — provisioned, pushed, or restored — [the meta reader](./PRFC-0023-harness-meta.md#guide-level-explanation) answers with the record itself, and each failed read arrives under its own name: a missing record and a damaged record stay two.

The two names predate this RFC and outlive it. Presence narrows the missing one to roots that were never provisioned and leaves the damaged one as the fault a provisioning or a corrupted file can produce. A reading face that merges them tells a caller with a damaged record that nothing was ever pushed — the reply that quietly throws away a version the root still holds.

### The record leaves the entry alone

> However complete [harness meta](./PRFC-0023-harness-meta.md#guide-level-explanation) is, which entry starts the harness is still decided by [resolution](./PRFC-0024-cli-resolution.md#guide-level-explanation).

A record that obligates a start path would make every channel's launcher a servant of the record and every dev root a hostage of its own installed image. The record states what a root holds; resolution decides what runs. Keeping that seam is what lets this RFC lay its floor.

## Drawbacks
[drawbacks]: #drawbacks

Presence costs a marker inside the record ("provisioned, never pushed") that absence used to provide for free. Provisioning writes to disk where it used to write nothing, which adds a failure surface — read-only media, permissions — that must be handled. Every provisioned root stores a full harness payload it may never need, which is real space on small machines. And the dev checkout gains a record in its dev root, a behavior change for a channel that deliberately kept its dev root clean.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**The cost of "fix it when it breaks"**: the remote-command face of a bare-adopted machine is entirely broken today, and the user pays that cost before any fix can reach the machine.

**Presence beats probing an absence**: a reader that probes the product's image when the root has no record merges "no record" with "damaged record" — exactly the conflation the landed criterion forbids.

**The reading face reads one file**: it reads `hmr/harness.json` under the root and nothing else, so a machine whose record exists only in a mirror has no record it can act on.

**The cost of leaving this out**: PRFC-0024's resolution has nothing to resolve on a fresh install.

## Prior art
[prior-art]: #prior-art

Content-addressed stores (git's object database, the Nix store) are born together with their index, and "the repository has no objects" is a different sentence from "the object file is corrupt". Package managers carry an installed-state database from the moment of installation: dpkg's database exists because the install created it, and it stays. Browsers and editors initialize a complete profile on first run and treat absence as a diagnosis. The common shape is that the record of what a machine holds is born with the machine's provisioning.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

A few details are left to the implementation or to a later revision.

- The exact field shape of provenance and the "never pushed" marker.
- How a provisioning that cannot write is handled: a named fault with degraded operation, or a hard refusal.
- The carrier of the two named exceptions: error types, error codes, or both.
- Whether the mirrored install images are retired with this RFC or in a later motion.
- The carrier and thresholds of store-health observability.
- Whether the dev checkout provisions its dev root by the same rule or by a documented exception; its record exists, and this RFC leaves the dev tooling's presentation of it open.

## Future possibilities
[future-possibilities]: #future-possibilities

Once every root has a record, upgrade accounting can walk the record alone: plan-over and same-build comparisons read one file and handle one exception. Machine adoption becomes immediate, and a hand-installed release can be adopted and driven without a prior push. The provenance field can feed a visible surface — "installed by channel X, pushed to at T" — wherever version facts are shown.

---

## Changes

### v1.1.0

- The record has a fixed location: `hmr/harness.json` under the harness data root, with its blobs beside it under `hmr/store/`.
- The reader has one affirmative result — the record's path and content — and raises named exceptions for everything else, a missing record and a damaged record under two different names. Retired the invariant "Absence stays an answer"; it is replaced by "Each failure keeps its own name".
- References to the distro channel registry follow that RFC's number, PRFC-0021.

### v1.0.0

- Initial version (draft, native to this repository).
