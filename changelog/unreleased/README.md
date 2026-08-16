# Unreleased

- [2026-08-16] The runtime no longer owns the route table: a pushed platform gets first refusal on every request, so endpoints can be added or replaced by push instead of a rebuild (the upgrade channel itself stays runtime-owned). ([details](2026-08-16-platform-http-seam.md))

- [2026-08-15] Fixed the packaged and AppImage `penguin` launchers, which still pointed at the CLI's pre-rename `dist/index.js` entry and so could not start. ([details](2026-08-15-cli-entry-name.md))
