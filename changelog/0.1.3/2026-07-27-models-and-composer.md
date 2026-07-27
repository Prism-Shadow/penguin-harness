# Models and composer: Kimi K3 on Fireworks; image upload joins the "+" menu, height and version-line fixes

## Kimi K3 on Fireworks

The preset catalog gains **Kimi K3** on Fireworks (`accounts/fireworks/models/kimi-k3`): a 1M-token context window, vision support, the OpenAI-compatible client against the shared Fireworks base URL, priced $0.30 / $3 / $15 per Mtok (cache read / cache write / output), slotted ahead of Kimi K2.7 Code in the provider's rows.

## Image upload moves into the composer's "+" menu

The image picker leaves its standalone toolbar button and becomes the first entry of the "+" extension menu, which now leads the toolbar row — one 8×8 slot instead of two, the difference between the phone row scrolling and not. The actual file input stays mounted outside the menu (the menu unmounts its items on select) and the entry clicks it, still inside the click's user-activation window, so the dialog opens. On a model without vision the entry stays usable and its hint explains that images send as scratchpad file paths instead; goal mode disables it, since goal rounds are text-only.

## Composer height follows the rendered value

The composer's auto-grow used to be called next to each state update through `requestAnimationFrame`, which races React's commit of the controlled textarea: when the callback won, it measured the old multi-line content and re-pinned the tall height — with nothing left to trigger a re-measure, the composer stayed expanded after every send. Sizing now lives in a single layout effect keyed on the text value, which runs after the commit and before paint, so the box sizes correctly on mount (restored multi-line drafts), while typing, and on the clear after a send, without flashing.

## A quieter version line

The new-chat draft page's version line drops the product-name prefix — bare `vX.Y.Z · Last updated …` — since the brand wordmark sits directly above it and the sidebar's version footer is bare too.
