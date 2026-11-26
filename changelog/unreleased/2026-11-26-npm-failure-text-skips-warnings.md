# A failed plugin install named npm's error, not a warning npm printed first

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `server`

[中文版](2026-11-26-npm-failure-text-skips-warnings.zh.md)

When npm failed to install or look up a plugin, the server showed the first line of npm's stderr that said anything, and a line npm logged below its error level could take that place: an `.npmrc` key npm did not recognize, such as `always-auth`, made it print `npm warn Unknown user config "always-auth"` ahead of everything on every run, and that warning became the failure text. The server now passes over the lines npm prefixes with a lower log level (`npm warn`, `npm notice`, and the `http`, `info`, `verbose`, `silly` and `timing` lines a raised loglevel adds) and shows npm's error. A warning is shown only when npm printed nothing else. Which kind of failure it was, and which registry npm named, are still read from the whole output.
