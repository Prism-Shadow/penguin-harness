# Clean command output in non-interactive sessions

Command output no longer carries terminal color/control sequences into tool results, Traces, or model context.

## Details

- Command sessions remove inherited `FORCE_COLOR` settings and enforce the existing non-interactive color policy.
- A streaming VT parser strips control sequences even when an escape is split across `exec_command` and `input_command` output chunks.
- The CLI emits presentation colors only for a terminal and honors `NO_COLOR` and `TERM=dumb` when its output is redirected.
