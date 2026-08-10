# Web App: outline windowing, a cost stat that stays put, attachments as user content, quieter failure and update chrome

## Conversation outline

The tick-rail minimap over the stream's left gutter now appears only once a conversation reaches 5 exchanges, and renders a sliding window of at most 20 turns either side of the active one instead of one tick per turn forever — the window recenters as reading position moves, shifts rather than shrinks at the ends, and small edge dots mark hidden ranges; global turn numbering is preserved and the toolbar dropdown fallback still lists every turn. Two overlap bugs went with it: the tick stack is height-adaptive with an overflow backstop, so very long runs can no longer spill ticks over the toolbar and composer; and the gutter-fit check, which compared against a hardcoded 768 px column, now resolves the column's real 48 rem width against the live root font size — under browser font scaling the old check kept the rail visible while the widened prose column ran beneath it.

## Cost stat

The toolbar cost chip could vanish mid-run: goal rounds reset the live task buckets while the running state blocked the session-total refetch, a page opened during an active run never fetched the accrued total at all, and the idle blip between queued follow-ups could clobber a known total with an empty response. The displayed figure is now sticky and monotone while a session runs — the last fetched total plus each finished Task's settled increment plus the open Task's live estimate, reconciled verbatim once the session is idle. The usage fetch fires on session open regardless of run state, and an empty response can no longer erase a known value.

## Attachments as user content

Uploaded file attachments belong to the user's message and now render like it: below the user text in the same right-aligned container and hover-timestamp footer as uploaded images, instead of a left-aligned system-notice banner above the bubble (`AttachedFilesBanner` becomes presentation-only; its caller owns alignment, animation and the timestamp). A files-only steering message also shows its attached-files banner inside the steering chip — previously the filenames were dropped entirely and the chip rendered empty.

## Quieter chrome

Tool rows no longer print stop-reason markers at all — `[failed]`, `[aborted]`, `[timeout]`, `[malformed]` and `[auth]` are gone; the status icon is the single carrier of the outcome, with the raw reason still in its tooltip and aria-label, and the Trace viewer keeping the literal per-event values. The home page's "new version" hint sheds its accent pill for plain superscript text set in the version line's own type; only the link affordance remains.
