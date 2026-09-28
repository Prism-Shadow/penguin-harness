# Build stage with readiness checks

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `server`, `web`

Assembling a module moved into a Build stage in the Module Definition section. The stage
lists what stands between the draft and a module before the author presses **Assemble WAF
module**.

## Details

- `GET /api/projects/:projectId/activities/:activityId/readiness?wafRoot=` returns checks
  as codes and counts, which the App words:
  - the script is written and the specification is valid;
  - the media plan is current, missing or older than the specification;
  - speech bound per language, and each language's coverage of the default language's
    narrations;
  - images, video and animation bound;
  - this ref owns the module code;
  - a WAF checkout is found.
- The page adds two checks of its own: unsaved edits, and a proposal waiting in the
  conversation.
- A check the assembly route would refuse on disables **Assemble WAF module**. A warning
  leaves it enabled.
- The WAF checkout field, the book reading mode and **Assemble WAF module** moved there from
  under the Activity Script. The stage also shows the last assembly, whether it was built
  from an older draft, and its session.
- Module Definition can be opened once a specification exists, rather than only after a
  first assembly. The storyboard's **Assemble** opens the Build stage.
