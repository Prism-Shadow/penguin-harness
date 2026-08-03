# File attachments in mid-run steering

A file-only composer message can now steer the Task already in progress instead of being queued as a follow-up.

## Details

- The steering API accepts scratchpad-backed file attachments with the same validation and size limits as normal Task inputs.
- Files written during a Task-completion race are removed before the API returns `not_running`.
- The Web composer sends and clears text, images, and files together when steering; selected Skills remain task-level input.
