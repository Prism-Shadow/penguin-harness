# A serious error offers "[Report]", and a crashed page shows a notice instead of going blank

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-11-02-report-issue-entry.zh.md)

An error that is a defect rather than something the person can fix now offers "[Report]". It opens a problem report the person can copy or send to the project's GitHub bug form, prefilled so it can be submitted as it opens. A part of the page that crashes while rendering shows "[Error]: this part of the page could not be shown [Reload] [Report]" in its place, instead of a blank window.

## Details

- Serious means:
  - the server's converged 500 (code `internal`), or a 5xx it did not name;
  - an exception the app did not expect;
  - a render crash.

  An answer the server named is not serious: validation, sign-in, permission, not found, a conflict, a machine out of reach, a proxy in the way, the network gone. Neither is a stop the person made. Those read exactly as before.
- The report is in English and holds what happened, the page as its route's pattern (never its ids), the error and when it happened, the PenguinHarness version, how it is installed and the OS. It ends with the error's stack and the components it crashed in. Keys, tokens and the account name in home-directory paths (`/Users/<name>`, `/home/<name>`, `C:\Users\<name>`) are taken out; nothing leaves the app until the person copies the report or opens the form.
- Where it appears:
  - error toasts for an action that failed on a serious error, which then stay 10 seconds;
  - the could-not-load notice when a conversation's history failed on a serious error, and the earlier-messages line at the top of a conversation. A history read the server failed with its converged error counts, and so does a history stream that kept breaking its own framing; a code the server named does not;
  - the crash notice around the page body (the sidebar keeps working, and going to another page tries again), around each dock panel (a broken panel leaves the conversation alone), and around the whole router.
- The conversation's request-failure details work as before, now built on the same kit.
- The UI package holds the kit: the report and its redaction, the bug-form link, the seriousness rule (`isSeriousError`), "[Report]" (`ReportIssueAction`), the one dialog (`ReportHost`), and the crash notice (`CrashBoundary`, `CrashNotice`). Error toasts and `LoadFailed` take an optional report. The app sets the version, install and OS once at its root.
- The gallery has a Report board: the crash notice, the error toasts with and without the entry, the could-not-load notice with the entry, and the dialog.
