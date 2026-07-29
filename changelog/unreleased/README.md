# Unreleased

Changes since v0.1.4. The version number is assigned at release, when this folder is renamed.

- [2026-07-28] Web App and CLI: duration and byte abbreviations now carry into the next unit instead of printing `1m60s` or `1024KB` — both helpers rounded the value they displayed but chose the unit (or the minute/second split) from the raw input. ([details](2026-07-28-duration-and-byte-formatting.md))
