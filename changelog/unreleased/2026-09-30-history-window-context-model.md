# A history window names the model of the context it starts in

- **Date:** 2026-09-30
- **Type:** fix
- **Scope:** `server`, `web`, `docs`

[中文版](2026-09-30-history-window-context-model.zh.md)

A windowed read of `GET /api/sessions/:sessionId/messages` that started partway into a model context did not say which model that context ran on: the `session_meta` naming it heads the context's Trace file, ahead of the window. After an [in-session model switch](2026-09-16-in-session-model-switch.md) the Web App therefore priced the Tasks at the top of such a window on the Session's current model, and showed no "Model switched" marker for a switch whose old context began before the window. The page envelope now carries that model.

## Details

- Windowed responses gained `page.contextModel` (`{ provider, modelId }`): the model named by the `session_meta` heading the Trace file the window's first unit lies in. It is absent for a Session with no Trace. No record is repeated to say it, so windows still tile the transcript exactly.
- The Web App seeds every window it loads, the tail and each earlier page, with that model. A Task's cost estimate is priced on the model the Task ran on wherever the window starts, and a switch inside a window is marked even when the context it closed began before the window.
