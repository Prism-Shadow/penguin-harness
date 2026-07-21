# Language and theme carry across the landing page and the docs site

The two sites are separate SPAs deployed to one origin — penguin.ooo and penguin.ooo/docs/ — but each persisted its preferences under its own `localStorage` key (`penguin-landing.*` and `penguin-docs.*`). Picking dark mode or Chinese on one and clicking through to the other therefore dropped the visitor back to the system default, which read as the setting being ignored.

- Both sites now read and write one shared pair of keys, `penguin-site.theme` and `penguin-site.lang`, via a small `state/site-prefs.ts` module duplicated in each package (they share no package, exactly as `theme.tsx` and `locale.tsx` already are). The keys must stay identical on both sides; if they drift, the sync stops silently.
- The retired per-site keys are still read as a fallback, so a returning visitor keeps the choice they made before the change instead of being reset once.
- A `storage` listener covers the case where both sites are open at once: switching theme or language in one tab now updates the other without a reload. The site-to-site hop is a full page load and is served by the read on mount.
- The docs site's pre-paint theme script reads the shared key too, and the landing page — which had no such script — gained the same one. Without it, arriving at the landing page from a dark docs page flashed a white background before React booted.
- Reading `localStorage` is wrapped throughout: it throws outright in cookie-blocked and partitioned contexts, and a preference is not worth taking the page down for.

Verified against the assembled site (landing at `/`, docs under `/docs/`, one origin): a dark + Chinese choice made on the landing page survives the hop to the docs site and back, a change made on the docs side propagates the other way, and a profile carrying only the retired `penguin-docs.*` keys still renders dark and Chinese.
