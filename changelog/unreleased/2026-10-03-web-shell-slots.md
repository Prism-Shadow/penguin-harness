# WebApp's session providers, layers and user events are slots

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `web`

[中文版](2026-10-03-web-WebApp-slots.zh.md)

Three more things the Web App's base named feature by feature are now slots the features contribute to. `WebAppSlots` gains `sessionProviders` (providers of the signed-in session, mounted inside Project and Sessions, outermost first) and `layers` (overlays and headless runtimes mounted once beside every page), both ordered by `order`. A new `SessionsModule` owns `userEvents`: each contribution is a handler with `event(ev, source)` and an optional `resync(source)`, and the module provides them, in order, as the `UserEventHandlers` interface, which the WebApp uses and hands to `SessionsProvider`.

- Company state moved from `state/company.tsx` to `features/company/company-state.tsx`. `CompanyModule` contributes `CompanyProvider` to `WebAppModule.sessionProviders`, so the router's `RequireAuth` nests whatever providers were contributed instead of naming it. The rest of the app reads it through `features/company/index.ts` (`useCompany`).
- The four components `AppLayout` mounted once are `WebAppModule.layers` contributions from their owners, in their old mount order: the terminal view pool's runtime (`TerminalModule`), the shortcut runtime (new `SettingsModule`), the built-in browser's layer (new `BuiltinBrowserModule`) and the command palette (new `PaletteModule`).
- `applyUserEvent` takes the handlers as a parameter. The list still handles its own events first; a resync calls every handler's `resync`, and every other event goes to every handler before the list refreshes for a work run or a schedule firing. Company, the built-in browser (this server's events only) and schedules (new `SchedulesModule`) contribute handlers from their own `module.ts`.
- `state/` and `web-app/router.tsx` import no feature. The boundary test treats `<name>.module.ts` as a module file too; the baseline loses 11 lines and gains 3 (`app-layout.tsx` and `sidebar.tsx` reading `features/company/index.ts`, and settings joining the cycle company and chat already share).
- Nothing users see changed.
