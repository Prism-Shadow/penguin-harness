/**
 * The WebApp composition module: the app's frame and its router. Features reach it only through its slots —
 * a page is a contribution to `WebAppModule.pages` with the component bound by id, a provider of
 * the signed-in session one to `sessionProviders`, and an overlay or a headless runtime one to
 * `layers` (beside the columns, or over the page area with `area: "page"`) — so WebApp imports
 * no feature. A page the server contributes is drawn in an iframe (web-app/contributions.tsx),
 * never by a component of the app's. A module whose server half may not be running declares
 * that server module in `serverModules`; its drawn contributions wait for it
 * (lib/module-gate.ts), the shell's own included (gated-slots.ts). What it provides is the root component the app mounts, with the
 * contributions bound into it (web-app/deps.ts), and the user event handlers the sessions module
 * collects (state/user-events.ts), which the router hands to the session list. The layout mounts
 * the sidebar module's column and rail, and opens the chat module's drafts on the New chat
 * command.
 *
 * The kernel addresses a slot by the providing MODULE's name (`WebAppModule.pages`), while the
 * slot declaration hangs on the interface the module provides (`WebAppSlots` beside `WebApp`) —
 * the same split as the server's `HttpModule.routes` and `HttpSlots`.
 */
import type { ComponentType, ReactNode } from "react";
import type { ServerModuleData } from "@prismshadow/penguin-web-plugin";
import {
  Interface,
  Module,
  Provide,
  Use,
  type ClassCtx,
  type Contributed,
  type Slot,
} from "@prismshadow/penguin-core/kernel";

import type { UserEventHandlers } from "../state/user-events";
import { setServerModuleGates } from "../lib/module-gate";
import { gatedPagesOf, gatesOf, layersOf, sessionProvidersOf } from "./gated-slots";
import type { ChatDrafts } from "../features/chat";
import type { Sidebar } from "./sidebar/iface";
import { webAppDeps, type WebAppLayer, type WebAppSessionProvider } from "./deps";

import { pageTableOf, type PageData } from "./page-table";

import { AppRouter, type AppRouterProps } from "./router";

@Interface()
export abstract class WebApp {
  /** The whole routed app, everything it renders under WebApp's bindings. */
  abstract readonly Root: ComponentType<AppRouterProps>;
}

/** The data half of a `sessionProviders` or `layers` contribution. */
export interface Ordered {
  /** The contribution's place in its slot, ascending. */
  order: number;
}

/** The data half of a `layers` contribution. */
export interface LayerData extends Ordered {
  /**
   * `"page"`: mounted inside the main column after the page, in the page's own box, for a layer
   * whose surfaces cover the page and must outlive it (the App Center's running apps): they take
   * the page's size and follow every resize without measuring anything. Absent: beside the
   * columns, like every overlay and headless runtime.
   */
  area?: "page";
}

export interface WebAppSlots {
  /** A routed page; its component is the code half. */
  pages: Slot<PageData, ComponentType>;
  /** Providers of the signed-in session, mounted inside Project + Sessions, outermost first. */
  sessionProviders: Slot<Ordered, ComponentType<{ children: ReactNode }>>;
  /** Mounted once beside every page: overlays and headless runtimes, or over the page area. */
  layers: Slot<LayerData, ComponentType>;
  /** A server module the contributing web module needs: its contributions are drawn while it runs. */
  serverModules: ServerModuleData;
}

/** A slot's contributions by `order`, each with the component its module bound and its data. */
function byOrder<P, D extends Ordered = Ordered>(
  contributions: readonly Contributed[],
): ReadonlyArray<{ id: string; from: string; Component: ComponentType<P>; data: D }> {
  return [...contributions]
    .map((c) => ({
      id: c.id,
      from: c.from,
      Component: c.code as ComponentType<P>,
      data: c.data as unknown as D,
    }))
    .sort((a, b) => a.data.order - b.data.order);
}

@Module()
export class WebAppModule {
  @Provide() webApp!: WebApp;
  @Use() userEventHandlers!: UserEventHandlers;
  @Use() sidebar!: Sidebar;
  @Use() drafts!: ChatDrafts;
  setup({ contributions }: ClassCtx) {
    const gates = gatesOf(contributions.serverModules ?? []);
    setServerModuleGates(gates);
    const pages = gatedPagesOf(
      pageTableOf(contributions.pages ?? []),
      contributions.pages ?? [],
      gates,
    );
    const sessionProviders: readonly WebAppSessionProvider[] = sessionProvidersOf(
      byOrder<{ children: ReactNode }>(contributions.sessionProviders ?? []),
      gates,
    );
    const layers: readonly WebAppLayer[] = layersOf(
      byOrder<unknown, LayerData>(contributions.layers ?? []).map(
        ({ id, from, Component, data }) => ({
          id,
          from,
          Component,
          area: data.area === "page" ? "page" : "shell",
        }),
      ),
      gates,
    );
    const userEvents = this.userEventHandlers.all();
    this.webApp = {
      Root: webAppDeps.provide(
        {
          pages,
          sessionProviders,
          layers,
          userEvents,
          sidebar: this.sidebar,
          drafts: this.drafts,
        },
        AppRouter,
      ),
    };
  }
}
