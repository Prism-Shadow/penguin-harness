# Generate and review activity image candidates

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`, `skills`
- **PR:** [#20](https://github.com/nicolaepocroianu/penguin-harness/pull/20)

Activities gained image generation through normal Harness Sessions and tool approvals. Authors saved an image description, generated a PNG candidate, inspected it, and explicitly accepted it into the media plan. Regeneration preserved the accepted image until a replacement was reviewed and accepted.

The bundled AgentHub helper used the selected Agent's Vault credential, issued one provider request, and rejected incomplete or malformed output. Candidates remained immutable, draft conflicts prevented stale acceptance, and WAF assembly preserved accepted image bytes.

The restart requirement and downgrade handling were documented in [backward compatibility](2026-09-19-backward-compatibility.md).
