# A push ships the plugins it carries, not the previous push's

- **Date:** 2026-09-08
- **Type:** fix
- **Scope:** `server`

[中文版](2026-09-08-a-push-ships-its-own-plugins.zh.md)

Two ways a corrected plugin could arrive on a machine and the old one keep running. Both were found by pushing a fix to a real installation and watching it do nothing.

## Reuse asked for the name, not the file

The plugin host reuses what an earlier App imported, so module identity survives a swap. It matched on the **specifier alone** — but a push writes the builtin plugins to a new assets directory, so a specifier says nothing about which bytes are behind it. An entry held from before the push therefore kept running the previous build's code, forever: the push landed everywhere except the plugins.

Reuse now requires the specifier to still resolve to the **same file**. A different file is different code, and it is imported again. An entry from a generation before this field is simply re-imported, which is correct for it.

## The boot read the pointer it was replacing

A hot upgrade materializes its assets and publishes them **before** the new platform's `create()` runs, but commits `harness.json` only **after** that boot succeeds. A `create()` reading the committed pointer therefore reads the version it is replacing, and every push shipped plugins one version stale — a fix appeared to work only on the push after it.

The platform now loads the plugins of the version it is booting with (`hmr.assetsDir()`), not the committed one.
