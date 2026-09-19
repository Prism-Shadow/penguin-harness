# Speech candidates and activity media editing

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`, `agent-development`
- **PR:** [#16](https://github.com/nicolaepocroianu/penguin-harness/pull/16)

Activities now show scene summaries and a media editor with language and type filters, editable speech scripts, voice selection, audio playback, and explicit candidate acceptance. Specification and manifest JSON remain available in advanced disclosures.

Speech generation uses Gemini TTS through AgentHub in a normal Harness Session. Add `GEMINI_API_KEY` to the selected Agent's Vault, save the script, and choose **Generate speech**. Follow the Session's normal tool approvals, listen to the candidate, and choose **Accept this audio**. The Session uses the Project's configured model to run the speech helper; the helper uses `gemini-3.1-flash-tts-preview`.

Regeneration creates a separate candidate and keeps the accepted audio. Failed or interrupted attempts do not replace it. A candidate from an older draft remains playable but requires fresh generation before acceptance. WAF assembly stages accepted speech into its isolated workspace and checks that the preview preserves its bytes.

## Compatibility

Restart the server before using speech generation. Existing drafts and generation history are retained. See [storage compatibility](2026-09-19-backward-compatibility.md) for migration and downgrade requirements.
