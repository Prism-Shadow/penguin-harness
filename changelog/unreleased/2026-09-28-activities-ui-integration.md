# Activities integrated into the app shell

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `server`, `web`

The studio and home page now feel native to Penguin Harness—grouped layouts, status at a glance, and no lost context moving between the studio, chat, runs and settings.

## Details

**Activities home** is organized by product code instead of a flat list. Each product group shows its refs as cards with their status (running a stage, media plan out of date, built, or next step). The canonical ref is starred. Every ref is shown with a "+ New ref" card at the end of each group. Sort by recently edited or alphabetically by product code; the Recent strip is gone.

**Studio workspace** takes over the page when an activity is open. The app sidebar collapses to its icon rail. The section rail is grouped under labels: Write (Description, Specification, Features), Media (Scenes, Speech, Library), Build & ship (Module, Configuration, Assessment, Deploy), More (Stats, History). The right icon rail is now a labeled tab strip in the header: Stages · Player · Chat · Sessions. A breadcrumb replaces the back link (`Activities / <product> / <ref>`), with a chip showing the running stage. A run's session can be read inside the Sessions tab instead of opening chat on a separate page.

**Across the app**, activity runs are hidden from the global sidebar session list and live only in the studio's Sessions tab. Opening a run's chat shows a banner linking back to its activity. Run completion notifications open the activity. Activities appear in the quick switcher. Project media moved from `?view=media` to its own route `/activities/media` (the old link redirects). The deploy notice link now opens the deploy settings for admins. Discarding unsaved edits asks through the app's own dialog instead of `window.confirm`.

**Known limitation:** sidebar session counts can still include recent activity runs.
