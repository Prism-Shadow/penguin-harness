# Native activity authoring and specification generation

Date: 2026-09-19
Type: feature
Scope: server, web
PR: [#3](https://github.com/nicolaepocroianu/penguin-harness/pull/3)

[中文](2026-09-19-activity-workspace.zh.md)

The Activities page lets Project owners create an activity by product code and reference number, save its description, and generate a specification through a Harness Session.

## Generation and review

Each attempt stores its input snapshot, Session reference, status, and collected output. Valid output applies only while the saved draft still matches the input revision. Conflicting or invalid candidates remain available for review. Owners can cancel a run or start a new attempt; interrupted runs are recorded without automatic retry.

## Draft editing

Descriptions and validated specifications persist across page reloads. Revision checks prevent stale edits from replacing newer content. Project members can read activities; editing and generation require the Project owner. English and Chinese navigation and controls are included.
