# The image publishes two tags only: `latest` from main, the exact version from a release

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `ci`, `docs`
- **PR:** [#661](https://github.com/Prism-Shadow/penguin-harness/pull/660)

[中文版](2026-09-10-docker-tags-latest-and-version.zh.md)

The Docker workflow no longer publishes the `main-<sha7>` twin on a push to main, nor the `X.Y` line and `stable` on a release. A push to `main` moves `latest` and nothing else; a release publishes the exact version `X.Y.Z` and nothing else. The image is still stamped with `main-<sha7>` or the version as its reported version.

## Details

- `.github/workflows/docker.yml`: the version step resolves one tag — `latest` for a push, the tag's version for a release — and the latest-Release lookup that moved `stable` is gone.
- Docs (`quickstart-docker`), the contributing guide and the design's delivery-channel note describe the two tags; the stray `main-*` and `0.2` tags already on Docker Hub have to be deleted by hand — a workflow only adds tags, and the publish token has no delete scope.
