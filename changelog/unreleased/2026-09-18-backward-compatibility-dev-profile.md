# Backward compatibility: machine records from before profiles reached machines

- **Date:** 2026-09-18
- **Type:** process
- **Scope:** `server`
- **PR:** [#544](https://github.com/Prism-Shadow/penguin-harness/pull/544)

[中文版](2026-09-18-backward-compatibility-dev-profile.zh.md)

[Running an installed build as a second instance with `--dev`](2026-08-29-desktop-dev-profile.md)
made the profile hold on remote machines: a dev-profile instance reaches `~/.penguin-dev` there,
where every instance used to reach `~/.penguin`. The machine records a **dev-profile** data root
already holds (`machines` rows in `~/.penguin/dev-data/web.db`, written by `pnpm dev`,
`pnpm desktop` or an earlier `--dev` build) describe the release installation. Release-profile
records are unaffected: their layout is the one they were written under.

## The remembered port

A dev-profile row remembers the port the release server held on that machine, `remote_port`.

- When that port is the release default, 7364, it is ignored and the dev server starts on its
  own default. Starting there would succeed whenever the release server is down, and would
  then keep the port the release server comes back to.
- Any other remembered port is tried first. If the process exits without serving — the release
  server holds the port — the profile's default is tried once, and the row remembers whichever
  port the machine ends up serving on.

Neither rule is a migration shim, and nothing here is scheduled for removal. A remembered port
is a hint about a machine that other people use; "never the other profile's default" and "one
fallback to this profile's default" are how a hint is treated, for rows written by any build.

## The recorded installation

A dev-profile row that records an installed version recorded it for `~/.penguin`. The dev
instance now looks in `~/.penguin-dev`, finds no program, and the connect fails with the
machine's own words and offers the install. **Install once from the dev instance**; nothing on
the machine has to be removed first, and the release installation there is left as it is.

The row is not rewritten or cleared ahead of time: the record is corrected by that install, and
until then it is wrong only about a machine the dev instance cannot reach anyway.
