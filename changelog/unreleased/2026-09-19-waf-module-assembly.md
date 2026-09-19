# WAF module assembly through activity Sessions

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#9](https://github.com/nicolaepocroianu/penguin-harness/pull/9)

[中文版](2026-09-19-waf-module-assembly.zh.md)

Activities gained module assembly from a saved, valid specification. Each attempt received a separate Harness Session workspace with WAF TypeScript runtime templates, a module definition, build configuration, and product-code/reference-number configuration.

## Assembly and preview

Assembly used the configured Agent and normal tool approvals for dependency installation, behavior implementation, builds, and preview preparation. WAF checkout discovery checked ancestor directories or an explicit root for framework, modules, and media. Shared checkout paths were supplied as read-only context.

The run collector required bounded, regular artifacts including compiled module JavaScript, a build log, and preview HTML/runtime files. It retained artifact hashes in the candidate record. Cancellation, restart recovery, and Project deletion used the activity lifecycle. Changed drafts produced conflicts without replacing their specifications.

Completed module runs linked to the existing isolated Session workspace preview. History distinguished specification and module attempts, marked older input revisions, and kept module candidates out of the specification editor. The preview displayed the Session's workspace files.

## Compatibility

Existing drafts and specification attempts were preserved. Migration and downgrade instructions are recorded in [backward compatibility](2026-09-19-backward-compatibility.md).
