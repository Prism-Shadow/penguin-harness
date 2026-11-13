# A Benchmark keeps its references

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1433](https://github.com/Prism-Shadow/penguin-harness/pull/1433)

[中文版](2026-11-03-benchmark-manifest-references.zh.md)

`benchmark_config.toml` now reads and writes `references`, the list of links to where a package's tasks come from (a paper, an upstream repository), as RFC-0001 defines it. Before, the key was dropped, so saving a Benchmark that carried it, such as an imported one being published, wrote the links out of the file. Every reference must be an http(s) link; anything else is refused as `benchmark_manifest_invalid`.
