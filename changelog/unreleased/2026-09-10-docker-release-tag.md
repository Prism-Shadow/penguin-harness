# The release publishes the Docker image under its version again

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `ci`
- **PR:** PR_PLACEHOLDER

[中文版](2026-09-10-docker-release-tag.zh.md)

`docker.yml` tells a release build from a push to `main` by whether the `tag` input is set, not
by the event name. A `workflow_call` from the release workflow runs under the caller's event,
which for a tag push is `push` too, so the release builds of v0.2.10 and v0.2.11 moved `latest`
and published no `X.Y.Z` tag. Both versions were published afterwards by dispatching the
workflow with the tag, which took the right path all along; from here a release lands on its
exact version on the first run.
