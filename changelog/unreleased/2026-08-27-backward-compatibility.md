# Backward compatibility: install-scoped browser state

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#508](https://github.com/Prism-Shadow/penguin-harness/pull/508)

[中文版](2026-08-27-backward-compatibility.zh.md)

[Scoping browser-persisted UI state to its data root](2026-08-26-install-scoped-local-state.md)
touched two things that outlive a release: a new file in the data root, `<root>/install-id`,
and a new `localStorage` entry, `penguin.installId`. Only the browser side needed a decision;
the file and the key are recorded here too, so a reader looking for "does my install need
anything?" finds every answer in one place.

(The batch dated 2026-08-26 has its own
[backward compatibility](2026-08-26-backward-compatibility.md) entry, about `web.db` and the
messaging bindings. The two are unrelated.)

## The browser that has keys but no recorded id

Every browser upgrading into this release holds the keys and has never recorded an install
id. That is indistinguishable from a browser whose data root was wiped, so the sweep would
have run on the first page load after the update, for everyone.

Chosen: **adopt the current id, sweep nothing.** A first sight records the id and leaves the
store exactly as it found it. Destroying legitimate state on upgrade — every user's draft,
pins, Workspace registry and read markers, on an install nobody had touched — would have been
a far worse defect than the one being fixed.

**Nothing here has to be removed later, and nobody is on the hook to remove it.** The adopt
branch is not a migration shim with an expiry: a browser with no recorded id is also a new
profile, a new machine, a fresh private window and anyone who has cleared their site data.
"First sight adopts" is the permanent rule of the comparison, and it reads the same in every
release after this one.

## What a user has to do, once

The cost of adopting is that state which was **already** stale when this shipped stays stale.
A user who wiped their data root before this release still sees the old Workspace, the old
draft and the old pins, because this release records the current root's id over that state
rather than clearing it.

Clearing it is manual, and there is exactly one way: clear site data for the app's origin in
the browser — in the desktop app, that state lives in Electron's userData directory rather
than in `PENGUIN_HOME`, which is why deleting the data root never reached it. Doing so also
resets the preferences the sweep is careful to keep: theme, language, accent, font scale,
display currency, terminal appearance, sidebar collapse, panel width, grouping/sorting mode,
nav-group collapse and the mid-run send mode.

Wipes from this release onward need none of that: the next page load recognises the new root
and clears the install-scoped keys by itself.

## The new file in the data root

`<root>/install-id` holds one line of printable ASCII and is written once, the first time a
root is used. It is an identity, not a credential: it authorizes nothing, and it is served to
unauthenticated callers on purpose.

It needs no decision. A build from before this change never reads it and never writes it, so
a downgrade ignores the file entirely and an upgrade back picks up the same id. Deleting the
file by hand costs one sweep on the next page load — the root then looks new, which is
exactly what it is claiming to be — and nothing else. A root that cannot be written reports
no identity at all, and an unknown identity sweeps nothing.

## The new `localStorage` key

`penguin.installId` was added alongside the keys the Web App already kept, and it is the one
key the sweep never removes: it is what the comparison reads. Builds from before this change
do not know the key and leave it alone, so a downgrade is invisible in both directions.

## Compatibility

No action is required on upgrade or on downgrade. The single manual step, for a user who wiped
a data root before this release, is above.
