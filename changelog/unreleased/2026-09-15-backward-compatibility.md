# Backward compatibility

- **Date:** 2026-09-15
- **Type:** process
- **Scope:** `server`
- **PR:** [#626](https://github.com/Prism-Shadow/penguin-harness/pull/626)

[中文版](2026-09-15-backward-compatibility.zh.md)

One thing in this line outlives a release: the numbering of the database migrations it adds.

Earlier builds of this line numbered the machines columns 5 and the Session surface column 6. Released builds took 5 for the nickname and avatar columns on `users`, so those two now sit at 10 and 11, and a data root an earlier build of this line opened records a version at which the nickname and avatar migration reads as already applied. It is also the one migration whose columns `openDatabase` does not declare again at process start, so on such a root `users` would stay without them and every account read would fail.

A migration numbered 12, `user-profile-adoption`, adds the two columns where they are missing. Nothing to do by hand: it runs at the next start or the next push, and a root that took the migration in its proper place finds the columns in place and is left alone.

## Compatibility

The entry can go once no data root can still be running one of those earlier builds — the machines line's own release is the moment, and removing it is a single entry deleted from `MIGRATIONS`.
