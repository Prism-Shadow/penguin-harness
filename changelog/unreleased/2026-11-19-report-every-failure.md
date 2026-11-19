# Every failure offers "[Report]"; a refusal does not

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `ui`, `web`, `ui-gallery`

[中文版](2026-11-19-report-every-failure.zh.md)

"[Report]" used to appear only for a defect (the server's converged 500, a 5xx it did not name, an exception the app did not expect). It now appears after every failure the app shows, in a toast, inline beside the words, in the chat and in the recovery panel. A refusal reads as before, with no entry: a 4xx answer the server named (invalid input, a wrong password or an expired sign-in, no permission, something that is not there, a name taken or a state conflict, a size or rate limit) or a check the page made before sending anything. This widens the rule set out in [2026-11-02-report-issue-entry](2026-11-02-report-issue-entry.md).

## Details

- Three cases that 2026-11-02 left out are now failures and offer the entry: a 5xx the server named (a machine out of reach, an upstream service that failed, a timeout), an answer that is not the server's (a proxy's or a dev server's page), and no answer at all (the network gone, a machine that did not answer). A 4xx whose code ends in `_failed` or `_error` is a failure the server reported through a 4xx (`plugin_install_failed`, `import_failed`) and offers it too. A toast that carries the entry stays 10 seconds.
- A failure the app was told about in a result or a record, rather than one it caught, now offers a report too: a model test, protocol or vision detection, a messaging channel test, an MCP server test, a plugin that installed but did not load or whose parts could not all be removed, a plugin action that answered not ok, an update step, a machine job, a reconnecting machine's last failure, a config sync, a checkout's image build, a failed compaction.
- Words about the person's own machines or content stay out of the report: ssh's output, a machine's job log and config-sync detail, and an MCP server's own error. The report names the step and the reason code and says the words were left out. The Files panel, the folder finder, the directory browsers and the terminal replace the folder they work in with `<workspace>`.
- Toasts that said a caught error in their own words without the entry now carry it: the chat's actions, the built-in browser, messaging scans and tests, updates, the vault and MCP lists, bulk updates, archived conversations, Chrome pairing, the terminal and the Files panel.
- Inline failures that gain the entry after their words: the Machines page and its dialog (the failed job's step line, the last reconnect failure, the config sync line, the image build, the add and SSH host dialogs), the Files panel's listing, search, page source and version reads, the folder finder, the directory browsers (also the plugin Files tree and a Benchmark case), the App Center and app pages, a workbench's reload, restore, remove and history, the Trace panel and Trace file, and the Cost Center and its errors table.
- In the chat: a compaction that failed offers it after its reason, a failed MCP server row after its error, and a folded value that could not be fetched after "[Retry]".
- A page body or the app root that crashed falls back to the recovery panel, which now offers "[Report]" after the error, with the error and its stack; it shows the report in a dialog of its own. Since 2026-11-02 the panel had replaced the crash notice there without the entry.
- The report dialog's lead no longer claims a defect: "This may be a defect in PenguinHarness, or it may come from the network, a model provider or a connected machine."
- The UI package's report kit: the rule is `isReportable` (was `isSeriousError`); `Failure`, `reportFor` and `toldReport` build a failure's report; `FailureText` sets the words with the entry after them inside whatever line already holds the error. `ActivityGroup` takes `actions` on a head that does not expand. `LoadFailed` and `EmptyState` descriptions, the file panes' and add-machine dialog's errors, and `Input`'s error take a node.
- The gallery's Report board shows a failure's toast beside a refusal's, and inline failures: a danger line, a notice, a field's error beside an input error, and a told failure with its words left out.
