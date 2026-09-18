# Native activity authoring and specification generation

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#3](https://github.com/nicolaepocroianu/penguin-harness/pull/3)

[中文](2026-09-19-activity-workspace.zh.md)

The Activities page lets Project owners create an activity by product code and reference number, save its description, and generate a specification through a Harness Session.

## Generation and review

Each attempt stores its input snapshot, Session reference, status, and collected output. Valid output applies only while the saved draft still matches the input revision. Conflicting or invalid candidates remain available for review. Owners can cancel a run or start a new attempt; interrupted runs are recorded without automatic retry.

Shutdown and hot replacement wait for an in-flight publication to finish before recording remaining runs as interrupted. History loads compact summaries, fetches candidate JSON when opened, and checks idle activities less frequently.

Candidate collection was bounded to 2 MiB and read through a verified file handle. Project deletion sealed new activity writes and waited for admitted publications before removing Sessions, records, and files. Candidate payloads were moved out of history metadata; see [backward compatibility](2026-09-19-backward-compatibility.md).

## Draft editing

Descriptions and validated specifications persist across page reloads. Revision checks prevent stale edits from replacing newer content. Project members can read activities; editing and generation require the Project owner. English and Chinese navigation and controls are included.

Unsaved edits prompt before leaving through navigation, browser history, Session links, or a Project switch. Declining a Project switch preserves the current selection and preferences.

The guard was extended to Project deletion and fallback selection after refresh. When access disappeared and leaving was declined, the editor retained copyable, read-only local text and stopped activity requests. Successful polling cleared transient load errors while preserving action conflicts. Activity errors received English and Chinese messages, and Activities became accessible from the collapsed navigation rail.
